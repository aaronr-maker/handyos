import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fileToCsvText, formatDuration, formatMoney, isSupabaseConfigured, parseCsv, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import type { TreeRow } from '../pnlTree';
import { defaultCategory, parsePnl, type PnlLine, type PnlReported } from '../qbPnl';
import { computeWindowRate, crewMinutes, type Crew } from '../rateCalc';
import { saveOverheadMonthAction, saveRateSettingsAction } from '../rateActions';
import { accountKey, type CostCategory, type CostSource } from '../rateTypes';
import { disconnectQuickbooks, pullQuickbooksMonth, quickbooksLink, startQuickbooksConnect } from '../services/integrationService';
import { clockedByMonth, getAccountMap, getMonth, getRateSettings, listMonths } from '../services/rateService';
import { PnlSummary } from './PnlSummary';
import { PnlTable } from './PnlTable';

/** One account's amount in one month. Manual rows are costs typed in by hand. */
interface Row {
  account: string;
  group: string;
  section: PnlLine['section'] | 'manual';
  cents: number;
  /** Only for rows typed in by hand (the others are sorted by account, in `categories`). */
  category?: CostCategory;
}

interface MonthState {
  rows: Row[];
  reported: PnlReported | null;
  /** Hours typed in for the month ("" = use the time clock). */
  hoursText: string;
  source: CostSource;
  partial: boolean;
}

const MAX_MONTHS = 6;
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const lastFullMonths = (n: number) => {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    d.setMonth(d.getMonth() - 1);
    out.unshift(keyOf(d));
  }
  return out;
};
const monthName = (key: string, short = false) => new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', short ? { month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' });
const lineKey = (r: Pick<Row, 'section' | 'group' | 'account'>) => `${r.section}|${r.group}|${r.account}`.toLowerCase();

/** The company hourly rate: the costs of the chosen months (usually 3) divided by the man-hours worked in them. */
export default function CompanyRate() {
  const { companyId, role } = useSession();
  const [params] = useSearchParams();
  const saveMonth = useAction(saveOverheadMonthAction);
  const saveSettings = useAction(saveRateSettingsAction);

  const [months, setMonths] = useState<Record<string, MonthState>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [categories, setCategories] = useState<Record<string, CostCategory>>({});
  const [margin, setMargin] = useState('30');
  const [useRate, setUseRate] = useState(false);
  const [method, setMethod] = useState<'cash' | 'accrual'>('cash');
  const [hoursMode, setHoursMode] = useState<'clock' | 'capacity'>('clock');
  const [people, setPeople] = useState('');
  const [days, setDays] = useState('');
  const [hoursPerDay, setHoursPerDay] = useState('8');
  const [weeks, setWeeks] = useState('50');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveNotice, setSaveNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ month: '', account: '', amount: '', category: 'overhead' as CostCategory });
  const fileText = useRef<string | null>(null);
  const [fileColumns, setFileColumns] = useState<{ label: string; index: number }[]>([]);
  const [fileColumn, setFileColumn] = useState<number | null>(null);
  const [columnMonth, setColumnMonth] = useState(lastFullMonths(1)[0]);

  const data = useAsync(async () => {
    const [settings, map, clocked, link, saved] = await Promise.all([
      getRateSettings(companyId),
      getAccountMap(companyId),
      clockedByMonth(companyId),
      quickbooksLink(companyId),
      listMonths(companyId).then((list) => Promise.all(list.map((m) => getMonth(companyId, m.month.slice(0, 7))))),
    ]);
    return { settings, map, clocked, link, saved: saved.filter((s): s is NonNullable<typeof s> => s !== null) };
  }, [companyId]);

  // Fill the editable fields from what is saved, once, when it first loads.
  const loaded = useRef(false);
  const d = data.data;
  useEffect(() => {
    if (!d || loaded.current) return;
    loaded.current = true;
    const s = d.settings;
    setSelected(s.rate_months.length ? s.rate_months : lastFullMonths(3));
    setMargin(String(s.target_margin_bps / 100));
    setUseRate(s.use_in_job_costing);
    setMethod(s.accounting_method);
    setHoursMode(s.hours_mode);
    setPeople(s.crew_people === null ? '' : String(s.crew_people));
    setDays(s.crew_days_per_week === null ? '' : String(s.crew_days_per_week));
    setHoursPerDay(String(s.crew_hours_per_day));
    setWeeks(String(s.working_weeks));
    const cats: Record<string, CostCategory> = { ...d.map };
    const loadedMonths: Record<string, MonthState> = {};
    for (const m of d.saved) {
      const key = m.month.month.slice(0, 7);
      loadedMonths[key] = {
        rows: m.lines.map((l) => ({ account: l.account_name, group: l.group_path, section: l.section, cents: l.amount_cents, category: l.section === 'manual' ? l.category : undefined })),
        reported: null,
        hoursText: !m.month.hours_from_clock && m.month.hours_minutes !== null ? String(m.month.hours_minutes / 60) : '',
        source: m.month.source,
        partial: false,
      };
      for (const l of m.lines) if (l.section !== 'manual') cats[accountKey(l.account_name, l.group_path)] ??= l.category;
    }
    setCategories(cats);
    setMonths(loadedMonths);
  }, [d]);

  const categoryOf = (r: Row): CostCategory => r.category ?? categories[accountKey(r.account, r.group)] ?? defaultCategory(r.account, r.section === 'manual' ? 'expense' : r.section, r.group);

  // ---- bringing costs in ----
  const addMonths = (incoming: Record<string, MonthState>) => setMonths((cur) => ({ ...cur, ...incoming }));
  const fromLines = (lines: PnlLine[], reported: PnlReported, source: CostSource, partial: boolean, keep?: MonthState): MonthState => ({
    rows: [...lines.map((l) => ({ account: l.account, group: l.group, section: l.section, cents: l.amount_cents })), ...(keep?.rows.filter((r) => r.section === 'manual') ?? [])],
    reported,
    hoursText: keep?.hoursText ?? '',
    source,
    partial,
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    let text: string;
    try {
      text = await fileToCsvText(file);
    } catch {
      return setNotice({ ok: false, text: "That file couldn't be read. Choose the Profit and Loss report saved as Excel (.xlsx) or CSV." });
    }
    if (parseCsv(text).length < 2) return setNotice({ ok: false, text: 'That file looks empty.' });
    fileText.current = text;
    const first = parsePnl(text);
    if (first.lines.length === 0) return setNotice({ ok: false, text: first.warnings[0] ?? 'No costs found in that file.' });

    if (first.available_months.length > 0) {
      // one column per month: read every month in the file
      const incoming: Record<string, MonthState> = {};
      for (const key of first.available_months) {
        const r = parsePnl(text, key);
        incoming[key] = fromLines(r.lines, r.reported, 'quickbooks_csv', first.partial_months.includes(key), months[key]);
      }
      addMonths(incoming);
      setFileColumns([]);
      const full = first.available_months.filter((k) => !first.partial_months.includes(k));
      setSelected(full.slice(-3));
      setNotice({ ok: true, text: `Read ${first.available_months.length} months from the file. The last 3 full months are selected below; change them if you like.` });
    } else if (first.columns.length > 1) {
      // several columns that are not months: ask which one, and which month it is for
      setFileColumns(first.columns);
      setFileColumn(first.column);
      addMonths({ [columnMonth]: fromLines(first.lines, first.reported, 'quickbooks_csv', false, months[columnMonth]) });
      setSelected((cur) => (cur.includes(columnMonth) ? cur : [...cur, columnMonth].sort()));
      setNotice({ ok: true, text: `This report has ${first.columns.length} columns that are not months. Choose below which column is for the month you pick.` });
    } else {
      const key = first.month_guess ?? lastFullMonths(1)[0];
      setFileColumns([]);
      addMonths({ [key]: fromLines(first.lines, first.reported, 'quickbooks_csv', false, months[key]) });
      setSelected((cur) => (cur.includes(key) ? cur : [...cur, key].sort().slice(-MAX_MONTHS)));
      setNotice({ ok: true, text: `Read ${first.lines.length} accounts for ${monthName(key)}. Import more months, or pick the months to use below.${first.warnings.length ? ' ' + first.warnings.join(' ') : ''}` });
    }
  };

  const chooseColumn = (index: number, month: string) => {
    if (!fileText.current) return;
    const r = parsePnl(fileText.current, undefined, index);
    setFileColumn(index);
    addMonths({ [month]: fromLines(r.lines, r.reported, 'quickbooks_csv', false, months[month]) });
  };

  const pull = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const incoming: Record<string, MonthState> = {};
      let accounts = 0;
      for (const key of selected) {
        const r = await pullQuickbooksMonth(key, method === 'cash' ? 'Cash' : 'Accrual');
        accounts += r.lines.length;
        incoming[key] = fromLines(r.lines, r.reported, 'quickbooks_api', false, months[key]);
      }
      addMonths(incoming);
      setNotice(
        accounts === 0
          ? { ok: false, text: `QuickBooks has no costs recorded for ${selected.map((k) => monthName(k)).join(', ')}. A test company only has sample data for certain months, so try other months.` }
          : { ok: true, text: `Pulled ${accounts} accounts for ${selected.length} month${selected.length === 1 ? '' : 's'} from QuickBooks. Check how each one counts below, then save.` },
      );
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not reach QuickBooks.' });
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    try {
      window.location.href = (await startQuickbooksConnect()).url;
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not start the connection.' });
    }
  };

  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can see the company hourly rate.</p>;

  // ---- the window: the selected months, combined ----
  const available = [...new Set([...Object.keys(months), ...selected])].sort().reverse();
  const toggle = (key: string) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= MAX_MONTHS ? cur : [...cur, key].sort()));

  const combined = new Map<string, TreeRow & { removeFrom?: { month: string; at: number } }>();
  const monthLines = selected.map((key) => {
    const st = months[key];
    const counted = (st?.rows ?? []).map((r) => ({ amount_cents: r.cents, category: categoryOf(r) }));
    (st?.rows ?? []).forEach((r, at) => {
      if (r.section === 'manual') {
        combined.set(`manual|${key}|${at}`, { account: `${r.account}`, group: monthName(key, true), section: 'manual', cents: r.cents, category: categoryOf(r), removable: true, removeFrom: { month: key, at } });
        return;
      }
      const k = lineKey(r);
      const have = combined.get(k);
      if (have) have.cents += r.cents;
      else combined.set(k, { account: r.account, group: r.group, section: r.section, cents: r.cents, category: categoryOf(r) });
    });
    return { key, counted };
  });
  const treeRows = [...combined.values()].map((r, index) => ({ ...r, index }));
  const entries = [...combined.values()];

  const crew: Crew | null = hoursMode === 'capacity' && people.trim() !== '' && days.trim() !== '' ? { people: Number(people), days_per_week: Number(days), hours_per_day: Number(hoursPerDay) || 0, working_weeks: Number(weeks) || 0 } : null;
  const crewValid = crew !== null && [crew.people, crew.days_per_week, crew.hours_per_day, crew.working_weeks].every((n) => Number.isFinite(n) && n >= 0);
  const hoursFor = (key: string) => {
    const t = months[key]?.hoursText.trim() ?? '';
    return t === '' ? (d?.clocked[key] ?? 0) : Math.round((Number(t) || 0) * 60);
  };
  const marginBps = Math.round((Number(margin) || 0) * 100);
  const windowMonths = monthLines.map((m) => ({ lines: m.counted, minutes: hoursFor(m.key) }));
  const rate = computeWindowRate(windowMonths, Math.min(9500, marginBps), hoursMode === 'capacity' && crewValid ? crew : null);
  const rangeLabel = selected.length === 0 ? 'No months chosen' : selected.length === 1 ? monthName(selected[0]) : `${monthName(selected[0], true)} to ${monthName(selected[selected.length - 1], true)}`;

  const sumReported = (): PnlReported | null => {
    const list = selected.map((k) => months[k]?.reported);
    if (list.length === 0 || list.some((r) => !r)) return null;
    const add = (key: keyof PnlReported) => (list.some((r) => r![key] === null) ? null : list.reduce((n, r) => n + (r![key] as number), 0));
    return { income: add('income'), cogs: add('cogs'), gross_profit: add('gross_profit'), expenses: add('expenses'), net_operating_income: add('net_operating_income'), other_expenses: add('other_expenses'), net_income: add('net_income') };
  };

  const submit = async () => {
    setSaveNotice(null);
    if (selected.length === 0) return setSaveNotice({ ok: false, text: 'Choose at least one month.' });
    const empty = selected.filter((k) => (months[k]?.rows.length ?? 0) === 0);
    if (empty.length) return setSaveNotice({ ok: false, text: `No costs loaded for ${empty.map((k) => monthName(k)).join(', ')}. Import a report or pull from QuickBooks first.` });
    if (hoursMode === 'capacity' && !crewValid) return setSaveNotice({ ok: false, text: "Enter how many people work and how many days a week, or switch to the time clock's hours." });
    for (const k of selected) {
      const t = months[k].hoursText.trim();
      if (hoursMode === 'clock' && t !== '' && !Number.isFinite(Number(t))) return setSaveNotice({ ok: false, text: `Hours for ${monthName(k)} must be a number.` });
    }
    setBusy(true);
    for (const key of selected) {
      const st = months[key];
      const t = st.hoursText.trim();
      const res = await saveMonth({
        month: key,
        source: st.source,
        hours_override_minutes: t === '' ? null : Math.round(Number(t) * 60),
        lines: st.rows.map((r) => ({ account_name: r.account, group_path: r.group, section: r.section, amount_cents: r.cents, category: categoryOf(r) })),
      });
      const err = resultError(res);
      if (err) {
        setBusy(false);
        return setSaveNotice({ ok: false, text: `${monthName(key)}: ${err}` });
      }
    }
    const res = await saveSettings({
      target_margin_bps: Math.min(9500, marginBps),
      use_in_job_costing: useRate,
      accounting_method: method,
      rate_months: [...selected],
      hours_mode: hoursMode,
      crew_people: crewValid ? crew!.people : null,
      crew_days_per_week: crewValid ? crew!.days_per_week : null,
      crew_hours_per_day: Number(hoursPerDay) || 8,
      working_weeks: Math.max(1, Math.min(52, Math.round(Number(weeks) || 50))),
    });
    setBusy(false);
    const err = resultError(res);
    if (err) setSaveNotice({ ok: false, text: err });
    else setSaveNotice({ ok: true, text: `Saved. Your cost per man-hour is ${rate.cost_per_hour_cents === null ? 'not available yet' : formatMoney(rate.cost_per_hour_cents)}.${useRate ? ' Job costing now values labor at this hourly cost.' : ''}` });
  };

  const link = d?.link;
  const qb = params.get('qb');
  const crewPerMonth = crewValid && crew ? crewMinutes(crew, 1) : 0;

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Job costing
      </Link>
      <header className="page-header">
        <div>
          <h1>Company hourly rate</h1>
          <p className="muted">Your costs over the months you choose, divided by the man-hours worked in them.</p>
        </div>
      </header>
      {qb === 'connected' && <p className="notice">QuickBooks is connected. Choose your months and pull their costs.</p>}
      {qb === 'cancelled' && <p className="muted">The QuickBooks connection was cancelled.</p>}
      {qb === 'error' && <p className="err">{connectProblem(params.get('reason'), params.get('detail'))}</p>}

      <div className="card">
        <h2>1. Bring in your costs</h2>
        <p className="muted">
          Choose the <strong>Profit and Loss by Month</strong> report from QuickBooks (cash basis; the Excel file or a CSV both work). It has a column for each month, so one file gives you every month.
          Or connect QuickBooks below.
        </p>
        <label>
          QuickBooks Profit and Loss (Excel .xlsx or .csv)
          <input type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {fileColumns.length > 1 && (
          <div className="row">
            <label className="grow">
              Which column is the month?
              <select value={fileColumn ?? ''} onChange={(e) => chooseColumn(Number(e.target.value), columnMonth)}>
                {fileColumns.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Month
              <input
                type="month"
                value={columnMonth}
                onChange={(e) => {
                  setColumnMonth(e.target.value);
                  if (fileColumn !== null) chooseColumn(fileColumn, e.target.value);
                  setSelected((cur) => (cur.includes(e.target.value) ? cur : [...cur, e.target.value].sort()));
                }}
              />
            </label>
          </div>
        )}
        <label>
          Accounting method <span className="muted">(for pulling from QuickBooks; a file already has its own)</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'accrual')}>
            <option value="cash">Cash basis</option>
            <option value="accrual">Accrual basis</option>
          </select>
        </label>
        {isSupabaseConfigured && (
          <div className="qb">
            {link?.status === 'connected' ? (
              <>
                <p>
                  <span className="pill ok">QuickBooks connected</span> {link.label}
                  {link.last_error && <span className="err"> · {link.last_error}</span>}
                </p>
                <div className="row">
                  <button className="secondary" disabled={busy || selected.length === 0} onClick={() => void pull()}>
                    {busy ? 'Pulling from QuickBooks…' : `Pull the ${selected.length} selected month${selected.length === 1 ? '' : 's'} from QuickBooks`}
                  </button>
                  <button
                    className="link"
                    onClick={async () => {
                      if (!confirm('Disconnect QuickBooks? Saved months are kept.')) return;
                      await disconnectQuickbooks().catch((e: Error) => setNotice({ ok: false, text: e.message }));
                      data.reload();
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <button className="secondary" onClick={() => void connect()}>
                Connect QuickBooks
              </button>
            )}
          </div>
        )}
        {notice && <p className={notice.ok ? 'notice' : 'err'}>{notice.text}</p>}
      </div>

      <div className="card">
        <h2>2. Which months should be averaged?</h2>
        <p className="muted">Pick the months to use (usually the last 3 full months). Costs and hours are added up across them.</p>
        <div className="chips">
          {available.length === 0 && <span className="muted">Import a report above to see its months.</span>}
          {available.map((k) => {
            const st = months[k];
            const on = selected.includes(k);
            return (
              <button key={k} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => toggle(k)} aria-pressed={on}>
                {monthName(k, true)}
                {st?.partial && <span className="chip-note"> part month</span>}
                {!st && <span className="chip-note"> no costs yet</span>}
              </button>
            );
          })}
        </div>
        <label>
          Add another month
          <input type="month" value="" onChange={(e) => e.target.value && setSelected((cur) => (cur.includes(e.target.value) || cur.length >= MAX_MONTHS ? cur : [...cur, e.target.value].sort()))} />
        </label>
        {selected.length > 3 && <p className="muted small-note">You've picked {selected.length} months. Three is usual; more months smooth things out further.</p>}
      </div>

      {selected.some((k) => months[k]) && (
        <div className="card">
          <h2>3. Your costs, {rangeLabel}</h2>
          <p className="muted">Tick what counts toward the hourly cost. A choice applies to that account in every month, and is remembered.</p>
          <PnlTable
            rows={treeRows}
            reported={sumReported()}
            monthLabel={rangeLabel}
            method={method}
            onInclude={(indexes, include) => {
              // ticked = counted: an account that was left out comes back as the kind of cost it normally is
              const next = (e: (typeof entries)[number]): CostCategory => {
                if (!include) return 'excluded';
                const guess = defaultCategory(e.account, e.section === 'manual' ? 'expense' : e.section, e.group);
                return guess === 'excluded' ? 'overhead' : guess;
              };
              const forAccounts: Record<string, CostCategory> = {};
              const forManual: { month: string; at: number; category: CostCategory }[] = [];
              for (const i of indexes) {
                const e = entries[i];
                if (e.removeFrom) forManual.push({ ...e.removeFrom, category: next(e) });
                else forAccounts[accountKey(e.account, e.group)] = next(e);
              }
              setCategories((cur) => ({ ...cur, ...forAccounts }));
              if (forManual.length) {
                setMonths((cur) => {
                  const out = { ...cur };
                  for (const m of forManual) out[m.month] = { ...out[m.month], rows: out[m.month].rows.map((r, j) => (j === m.at ? { ...r, category: m.category } : r)) };
                  return out;
                });
              }
            }}
            onKind={(i) => {
              // wages -> payroll tax -> other running costs -> wages
              const e = entries[i];
              const order: CostCategory[] = ['wages', 'payroll_tax', 'overhead'];
              const category = order[(order.indexOf(e.category) + 1) % order.length];
              if (e.removeFrom) {
                const { month, at } = e.removeFrom;
                setMonths((cur) => ({ ...cur, [month]: { ...cur[month], rows: cur[month].rows.map((r, j) => (j === at ? { ...r, category } : r)) } }));
              } else setCategories((cur) => ({ ...cur, [accountKey(e.account, e.group)]: category }));
            }}
            onRemove={(i) => {
              const e = entries[i];
              if (e.removeFrom) setMonths((cur) => ({ ...cur, [e.removeFrom!.month]: { ...cur[e.removeFrom!.month], rows: cur[e.removeFrom!.month].rows.filter((_, j) => j !== e.removeFrom!.at) } }));
            }}
          />
          <PnlSummary rows={treeRows} reported={sumReported()} />
          <div className="row cost-add">
            <select aria-label="Month for the cost" value={manual.month || selected[selected.length - 1] || ''} onChange={(e) => setManual({ ...manual, month: e.target.value })}>
              {selected.map((k) => (
                <option key={k} value={k}>
                  {monthName(k, true)}
                </option>
              ))}
            </select>
            <input className="grow" placeholder="Add a cost by hand: name" value={manual.account} onChange={(e) => setManual({ ...manual, account: e.target.value })} />
            <input inputMode="decimal" placeholder="$ amount" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const cents = parseMoney(manual.amount);
                const month = manual.month || selected[selected.length - 1];
                if (!manual.account.trim() || cents === null || !month) return setNotice({ ok: false, text: 'Give the cost a name and an amount.' });
                setMonths((cur) => ({
                  ...cur,
                  [month]: { ...(cur[month] ?? { rows: [], reported: null, hoursText: '', source: 'manual' as CostSource, partial: false }), rows: [...(cur[month]?.rows ?? []), { account: manual.account.trim(), group: '', section: 'manual', cents, category: manual.category }] },
                }));
                setManual({ ...manual, account: '', amount: '' });
              }}
            >
              Add
            </button>
          </div>
          <p className="muted small-note">"Not counted" is for things already charged to each job (like job materials) or that aren't running costs (owner draws, interest).</p>
        </div>
      )}

      <div className="card">
        <h2>4. Man-hours worked</h2>
        <div className="choices">
          <label className={`choice-card ${hoursMode === 'clock' ? 'on' : ''}`}>
            <input type="radio" name="hours" checked={hoursMode === 'clock'} onChange={() => setHoursMode('clock')} />
            <strong>From the time clock</strong>
            <span className="muted">The hours your techs clocked in each month, or hours you type in.</span>
          </label>
          <label className={`choice-card ${hoursMode === 'capacity' ? 'on' : ''}`}>
            <input type="radio" name="hours" checked={hoursMode === 'capacity'} onChange={() => setHoursMode('capacity')} />
            <strong>From my crew's schedule</strong>
            <span className="muted">People × days a week × hours a day, over the working weeks of the year.</span>
          </label>
        </div>

        {hoursMode === 'clock' ? (
          selected.length === 0 ? (
            <p className="muted">Choose your months above.</p>
          ) : (
            <div className="hours-grid">
              {selected.map((k) => (
                <label key={k}>
                  {monthName(k, true)} hours
                  <input
                    inputMode="decimal"
                    value={months[k]?.hoursText ?? ''}
                    placeholder={`${((d?.clocked[k] ?? 0) / 60).toFixed(1)} on the clock`}
                    onChange={(e) => setMonths((cur) => ({ ...cur, [k]: { ...(cur[k] ?? { rows: [], reported: null, source: 'manual' as CostSource, partial: false }), hoursText: e.target.value } }))}
                  />
                </label>
              ))}
              <p className="muted small-note">Leave a box empty to use that month's time-clock hours. Type the hours in for months before the time clock was in use.</p>
            </div>
          )
        ) : (
          <>
            <div className="row">
              <label className="grow">
                People working
                <input inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="e.g. 3" />
              </label>
              <label className="grow">
                Days a week
                <input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} placeholder="e.g. 5" />
              </label>
              <label className="grow">
                Hours a day
                <input inputMode="decimal" value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} />
              </label>
              <label className="grow">
                Working weeks a year
                <input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
              </label>
            </div>
            <p className="muted small-note">A year has 52 weeks, but the crew works about {weeks || 50} of them.</p>
            {crewValid && crew && (
              <p>
                {crew.people} × {crew.days_per_week} days × {crew.hours_per_day} h × {crew.working_weeks} weeks = <strong>{(crewMinutes(crew, 12) / 60).toLocaleString('en-US', { maximumFractionDigits: 0 })} hours a year</strong>, about {(crewPerMonth / 60).toLocaleString('en-US', { maximumFractionDigits: 0 })} a month, or{' '}
                <strong>{(crewMinutes(crew, selected.length) / 60).toLocaleString('en-US', { maximumFractionDigits: 0 })} hours</strong> over your {selected.length} month{selected.length === 1 ? '' : 's'}.
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>5. Your hourly rate</h2>
        <label>
          Target margin (% of the price you charge)
          <input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </label>
        <dl className="totals">
          <dt>Costs counted ({selected.length} month{selected.length === 1 ? '' : 's'})</dt>
          <dd>{formatMoney(rate.counted_cents)}</dd>
          <dt>Man-hours</dt>
          <dd>{rate.hours.toLocaleString('en-US', { maximumFractionDigits: 1 })}</dd>
          <dt>
            <strong>Cost per man-hour</strong>
          </dt>
          <dd>
            <strong>{rate.cost_per_hour_cents === null ? 'needs costs and hours' : formatMoney(rate.cost_per_hour_cents)}</strong>
          </dd>
          <dt>
            <strong>Hourly price at {margin || 0}% margin</strong>
          </dt>
          <dd>
            <strong>{rate.price_per_hour_cents === null ? '' : formatMoney(rate.price_per_hour_cents)}</strong>
          </dd>
        </dl>
        {selected.length > 1 && hoursMode === 'clock' && (
          <table className="by-month">
            <thead>
              <tr>
                <th>Month</th>
                <th>Counted costs</th>
                <th>Hours</th>
                <th>Cost / hour</th>
              </tr>
            </thead>
            <tbody>
              {monthLines.map((m) => {
                const counted = m.counted.filter((l) => l.category !== 'excluded').reduce((n, l) => n + l.amount_cents, 0);
                const mins = hoursFor(m.key);
                return (
                  <tr key={m.key}>
                    <td>{monthName(m.key, true)}</td>
                    <td>{formatMoney(counted)}</td>
                    <td>{formatDuration(mins)}</td>
                    <td>{mins > 0 && counted > 0 ? formatMoney(Math.round(counted / (mins / 60))) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rate.per_hour && (
          <>
            <h3 className="sub-h">Where each hour's cost goes</h3>
            <dl className="totals">
              <dt>Into the wages account ({rate.wages_share_bps / 100}%)</dt>
              <dd>{formatMoney(rate.per_hour.wages_cents)}</dd>
              <dt>Payroll taxes ({rate.payroll_tax_share_bps / 100}%)</dt>
              <dd>{formatMoney(rate.per_hour.payroll_tax_cents)}</dd>
              <dt>Other running costs ({rate.overhead_share_bps / 100}%)</dt>
              <dd>{formatMoney(rate.per_hour.overhead_cents)}</dd>
            </dl>
            <p className="muted small-note">So for every hour a job is worked, about {((rate.wages_share_bps + rate.payroll_tax_share_bps) / 100).toFixed(1)}% of its cost needs to go to wages and payroll tax to keep payroll funded.</p>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={useRate} onChange={(e) => setUseRate(e.target.checked)} />
          Use this hourly cost for labor in job costing (instead of each person's own pay rate)
        </label>
        {saveNotice && <p className={saveNotice.ok ? 'notice' : 'err'}>{saveNotice.text}</p>}
        <button disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Save this rate'}
        </button>
      </div>
    </section>
  );
}

/** Plain-language help for why connecting QuickBooks failed (the codes come from the server, and carry no secrets). */
function connectProblem(reason: string | null, detail: string | null): string {
  switch (reason) {
    case 'state':
      return 'The sign-in took too long or was interrupted. Click Connect QuickBooks and try again.';
    case 'missing':
      return 'QuickBooks did not send back what we needed. Click Connect QuickBooks and try again.';
    case 'token':
      if (detail === 'invalid_client') return 'Intuit did not accept the app keys. Check INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET in Vercel: they must be the Development keys from the same Intuit app while INTUIT_ENV is sandbox.';
      if (detail === 'invalid_grant') return 'Intuit did not accept the sign-in code. Make sure the Redirect URI in your Intuit app is exactly the same as INTUIT_REDIRECT_URI in Vercel, then click Connect QuickBooks again.';
      return `Intuit refused the connection (${detail ?? 'unknown reason'}). Check the Intuit keys and Redirect URI, then try again.`;
    case 'save':
      return 'QuickBooks approved the connection, but saving it failed. Check that the integrations SQL file (20261116000000_integrations.sql) was run and that SUPABASE_SERVICE_ROLE_KEY in Vercel is the Supabase secret key.';
    default:
      return 'QuickBooks could not be connected. Try again, or ask your admin to check the setup.';
  }
}
