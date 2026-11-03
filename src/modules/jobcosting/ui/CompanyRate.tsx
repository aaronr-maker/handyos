import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { centsToInput, formatDuration, formatMoney, isSupabaseConfigured, parseCsv, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { saveOverheadMonthAction, saveRateSettingsAction } from '../rateActions';
import { computeRate } from '../rateCalc';
import { defaultCategory, parsePnl, type PnlLine } from '../qbPnl';
import { CATEGORY_LABELS, type CostCategory, type CostSource } from '../rateTypes';
import { disconnectQuickbooks, pullQuickbooksMonth, quickbooksLink, startQuickbooksConnect } from '../services/integrationService';
import { clockedMinutes, getAccountMap, getMonth, getRateSettings } from '../services/rateService';

interface Row {
  account: string;
  amount: string;
  category: CostCategory;
  section: PnlLine['section'] | 'manual';
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
      if (detail === 'invalid_grant') return "Intuit did not accept the sign-in code. Make sure the Redirect URI in your Intuit app is exactly the same as INTUIT_REDIRECT_URI in Vercel, then click Connect QuickBooks again.";
      return `Intuit refused the connection (${detail ?? 'unknown reason'}). Check the Intuit keys and Redirect URI, then try again.`;
    case 'save':
      return 'QuickBooks approved the connection, but saving it failed. Check that the integrations SQL file (20261116000000_integrations.sql) was run and that SUPABASE_SERVICE_ROLE_KEY in Vercel is the Supabase secret key.';
    default:
      return 'QuickBooks could not be connected. Try again, or ask your admin to check the setup.';
  }
}

const lastMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthName = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const CATEGORIES = Object.keys(CATEGORY_LABELS) as CostCategory[];

/** The company hourly rate: a month of costs divided by the man-hours clocked that month. */
export default function CompanyRate() {
  const { companyId, role } = useSession();
  const [params] = useSearchParams();
  const save = useAction(saveOverheadMonthAction);
  const saveSettings = useAction(saveRateSettingsAction);

  const [month, setMonth] = useState(lastMonth);
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<CostSource>('manual');
  const [hoursText, setHoursText] = useState('');
  // `notice` is about getting costs in (shown by the import/pull buttons); `saveNotice` is about saving (shown by the Save button)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveNotice, setSaveNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [margin, setMargin] = useState('30');
  const [useRate, setUseRate] = useState(false);
  const [manual, setManual] = useState({ account: '', amount: '', category: 'overhead' as CostCategory });

  const data = useAsync(async () => {
    const [settings, saved, clocked, map, link] = await Promise.all([getRateSettings(companyId), getMonth(companyId, month), clockedMinutes(companyId, month), getAccountMap(companyId), quickbooksLink(companyId)]);
    return { settings, saved, clocked, map, link };
  }, [companyId, month]);

  // Fill the editable fields from what's saved for the chosen month (or start empty) whenever it loads.
  const d = data.data;
  useEffect(() => {
    if (!d) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMargin(String(d.settings.target_margin_bps / 100));
    setUseRate(d.settings.use_in_job_costing);
    setRows(d.saved ? d.saved.lines.map((l) => ({ account: l.account_name, amount: centsToInput(l.amount_cents), category: l.category, section: 'manual' as const })) : []);
    setSource(d.saved?.month.source ?? 'manual');
    setHoursText(d.saved && !d.saved.month.hours_from_clock && d.saved.month.hours_minutes !== null ? String(d.saved.month.hours_minutes / 60) : '');
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the month's saved data (re)loads
  }, [d?.saved?.month.id, month, d !== undefined]);

  const fromPnl = (lines: PnlLine[], src: CostSource) => {
    const map = d?.map ?? {};
    setRows(lines.map((l) => ({ account: l.account, amount: centsToInput(l.amount_cents), category: map[l.account.toLowerCase()] ?? defaultCategory(l.account, l.section, l.group), section: l.section })));
    setSource(src);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    const text = await file.text();
    if (parseCsv(text).length < 2) return setNotice({ ok: false, text: 'That file looks empty.' });
    const result = parsePnl(text);
    if (result.lines.length === 0) return setNotice({ ok: false, text: result.warnings[0] ?? 'No costs found in that file.' });
    if (result.month_guess && result.month_guess !== month) setMonth(result.month_guess);
    fromPnl(result.lines, 'quickbooks_csv');
    setNotice({ ok: true, text: `Read ${result.lines.length} accounts${result.month_guess ? ` for ${monthName(result.month_guess)}` : ''}. Check how each one counts, then save.${result.warnings.length ? ' ' + result.warnings.join(' ') : ''}` });
  };

  const pull = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await pullQuickbooksMonth(month, 'Accrual');
      fromPnl(r.lines, 'quickbooks_api');
      setNotice(
        r.lines.length === 0
          ? { ok: false, text: `QuickBooks has no costs recorded for ${monthName(month)}. A test company only has sample data for certain months, so try another month.` }
          : { ok: true, text: `Pulled ${r.lines.length} accounts for ${monthName(month)} from QuickBooks. Check how each one counts below, then save.` },
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

  const parsed = rows.map((r) => ({ ...r, cents: parseMoney(r.amount.replace(/^-/, '')) === null ? null : (r.amount.trim().startsWith('-') ? -1 : 1) * (parseMoney(r.amount.replace(/^-/, '')) as number) }));
  const hoursOverride = hoursText.trim() === '' ? null : Math.round(Number(hoursText) * 60);
  const minutes = hoursOverride ?? d?.clocked ?? 0;
  const marginBps = Math.round((Number(margin) || 0) * 100);
  const rate = computeRate({ lines: parsed.filter((p) => p.cents !== null).map((p) => ({ amount_cents: p.cents as number, category: p.category })), minutes, target_margin_bps: marginBps });
  const qb = params.get('qb');

  const submit = async () => {
    setSaveNotice(null);
    if (parsed.some((p) => p.cents === null)) return setSaveNotice({ ok: false, text: 'Every amount needs to be a number, like 1200 or 1200.50.' });
    if (hoursOverride !== null && !Number.isFinite(hoursOverride)) return setSaveNotice({ ok: false, text: 'Hours must be a number.' });
    setBusy(true);
    const res = await save({ month, source, hours_override_minutes: hoursOverride, lines: parsed.map((p) => ({ account_name: p.account.trim(), amount_cents: p.cents as number, category: p.category })) });
    const settingsRes = await saveSettings({ target_margin_bps: Math.min(9500, marginBps), use_in_job_costing: useRate });
    setBusy(false);
    const err = resultError(res) ?? resultError(settingsRes);
    if (err) setSaveNotice({ ok: false, text: err });
    else {
      setSaveNotice({ ok: true, text: `Saved ${monthName(month)}.${useRate ? ' Job costing now values labor at this hourly cost.' : ''}` });
      data.reload();
    }
  };

  const link = d?.link;
  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Job costing
      </Link>
      <header className="page-header">
        <div>
          <h1>Company hourly rate</h1>
          <p className="muted">All company costs for a month divided by the man-hours worked that month.</p>
        </div>
      </header>
      {qb === 'connected' && <p className="notice">QuickBooks is connected. Pick a month and pull its costs.</p>}
      {qb === 'cancelled' && <p className="muted">The QuickBooks connection was cancelled.</p>}
      {qb === 'error' && <p className="err">{connectProblem(params.get('reason'), params.get('detail'))}</p>}

      <div className="card">
        <label>
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <h2>1. The month's costs</h2>
        <p className="muted">
          From QuickBooks: either connect it below, or export the <strong>Profit and Loss</strong> report for the month as a CSV file (in QuickBooks: Reports, Profit and Loss, pick the month, then Export, CSV) and choose it here.
        </p>
        <label>
          Import a QuickBooks Profit and Loss (.csv)
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
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
                  <button className="secondary" disabled={busy} onClick={() => void pull()}>
                    {busy ? 'Pulling from QuickBooks…' : `Pull ${monthName(month)} from QuickBooks`}
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

        {rows.length > 0 && (
          <div className="cost-rows">
            {rows.map((r, i) => (
              <div key={i} className="cost-row">
                <input aria-label="Account" className="grow" value={r.account} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))} />
                <input aria-label="Amount" inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <select aria-label="How it counts" value={r.category} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, category: e.target.value as CostCategory } : x)))}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <button type="button" className="link" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="row cost-add">
          <input className="grow" placeholder="Add a cost by hand: name" value={manual.account} onChange={(e) => setManual({ ...manual, account: e.target.value })} />
          <input inputMode="decimal" placeholder="$ amount" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
          <select aria-label="How it counts" value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value as CostCategory })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (!manual.account.trim() || parseMoney(manual.amount) === null) return setNotice({ ok: false, text: 'Give the cost a name and an amount.' });
              setRows([...rows, { account: manual.account.trim(), amount: manual.amount, category: manual.category, section: 'manual' }]);
              setManual({ account: '', amount: '', category: 'overhead' });
            }}
          >
            Add
          </button>
        </div>
        <p className="muted small-note">
          "Not counted" is for things already charged to each job (like job materials) or that aren't running costs (owner draws, interest). Your choices are remembered for next month.
        </p>
      </div>

      <div className="card">
        <h2>2. Man-hours worked in {monthName(month)}</h2>
        <p>
          The time clock recorded <strong>{formatDuration(d?.clocked ?? 0)}</strong> this month.
        </p>
        <label>
          Or enter the total hours by hand <span className="muted">(for months before the time clock was in use; leave blank to use the clock)</span>
          <input inputMode="decimal" value={hoursText} onChange={(e) => setHoursText(e.target.value)} placeholder="e.g. 820" />
        </label>
      </div>

      <div className="card">
        <h2>3. Your hourly rate</h2>
        <label>
          Target margin (% of the price you charge)
          <input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </label>
        <dl className="totals">
          <dt>Costs counted</dt>
          <dd>{formatMoney(rate.counted_cents)}</dd>
          <dt>Man-hours</dt>
          <dd>{rate.hours.toFixed(1)}</dd>
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
          {busy ? 'Saving…' : `Save ${monthName(month)}`}
        </button>
      </div>
    </section>
  );
}
