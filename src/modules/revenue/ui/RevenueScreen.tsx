import { useRef, useState } from 'react';
import { fileToCsvText, formatMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { listInvoices } from '@/modules/invoicing';
import { listJobs } from '@/modules/jobs';
import { monthlyIncome } from '@/modules/jobcosting';
import { listPayments } from '@/modules/payments';
import { importRevenueHistoryAction, removeRevenueImportAction } from '../actions';
import { buildEntries, GROUP_LABELS, groupRevenue, LAUNCH_MONTH, type GroupBy } from '../calc';
import { FIELD_LABELS, readEntries, readRevenueFile, type Field, type ParsedFile } from '../importParse';
import { listHistory } from '../service';

const GROUPS = Object.keys(GROUP_LABELS) as GroupBy[];
const FIELDS = Object.keys(FIELD_LABELS) as Field[];
const monthName = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** Revenue by day, week, month, quarter, year, job or customer: imported history before launch, HandyOS from then on. */
export default function RevenueScreen() {
  const { companyId, role } = useSession();
  const importHistory = useAction(importRevenueHistoryAction);
  const removeImport = useAction(removeRevenueImportAction);
  const [by, setBy] = useState<GroupBy>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [file, setFile] = useState<{ name: string; parsed: ParsedFile } | null>(null);
  const [cols, setCols] = useState<Record<Field, number>>({ date: -1, amount: -1, customer: -1, job: -1, invoice: -1 });
  const [source, setSource] = useState('');
  const [replace, setReplace] = useState(true);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [income, payments, invoices, jobs, customers, history] = await Promise.all([monthlyIncome(companyId), listPayments(companyId), listInvoices(companyId), listJobs(companyId), listCustomers(companyId), listHistory(companyId)]);
    return { income, payments, invoices, jobs, customers, history };
  }, [companyId]);

  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can see revenue.</p>;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setNote(null);
    try {
      const parsed = readRevenueFile(await fileToCsvText(f));
      if (!parsed) return setNote({ ok: false, text: 'That file does not look like a list of invoices or payments. It needs a header row with at least a date and an amount column.' });
      setFile({ name: f.name, parsed });
      setCols(parsed.guess);
      setSource(f.name.replace(/\.[^.]+$/, ''));
    } catch {
      setNote({ ok: false, text: "That file couldn't be read. Use Excel (.xlsx) or CSV." });
    }
  };
  const preview = file && cols.date >= 0 && cols.amount >= 0 ? readEntries(file.parsed.rows, cols) : null;

  const doImport = async () => {
    if (!preview || !source.trim()) return;
    setBusy(true);
    setNote(null);
    for (let i = 0; i < Math.max(1, preview.entries.length); i += 2000) {
      const res = await importHistory({ source: source.trim(), replace: replace && i === 0, rows: preview.entries.slice(i, i + 2000).map((e) => ({ received_on: e.date, amount_cents: e.amount_cents, customer: e.customer, job: e.job, invoice_ref: e.invoice_ref })) });
      const err = resultError(res);
      if (err) {
        setBusy(false);
        return setNote({ ok: false, text: err });
      }
    }
    setBusy(false);
    setNote({ ok: true, text: `Loaded ${preview.entries.length} rows as "${source.trim()}".` });
    setFile(null);
    if (input.current) input.current.value = '';
    reload();
  };

  const names = (() => {
    if (!data) return null;
    const customer = (id: string) => {
      const c = data.customers.find((x) => x.id === id);
      return c ? customerLabel(c) : '';
    };
    return {
      customer,
      job: (id: string | null) => {
        const j = id ? data.jobs.find((x) => x.id === id) : undefined;
        return j ? `#${j.job_number} ${j.title}` : '';
      },
    };
  })();

  const built =
    data && names
      ? buildEntries({
          history: data.history,
          payments: data.payments.map((p) => {
            const inv = data.invoices.find((i) => i.id === p.invoice_id);
            return { received_on: p.received_on, amount_cents: p.amount_cents, invoice_total_cents: inv?.total_cents ?? 0, invoice_tax_cents: inv?.tax_cents ?? 0, customer: inv ? names.customer(inv.customer_id) : '', job: names.job(inv?.job_id ?? null) };
          }),
          quickbooks: data.income.map((m) => ({ month: m.month, income_cents: m.income_cents })),
          launch: LAUNCH_MONTH,
        })
      : null;
  const inRange = (e: { date: string }) => (!from || e.date >= from) && (!to || e.date <= to);
  const view = built ? { entries: built.entries.filter(inRange), monthlyOnly: built.monthlyOnly.filter(inRange) } : null;
  const rows = view ? groupRevenue(view, by) : [];
  const total = rows.reduce((n, r) => n + r.cents, 0);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.cents)));
  const imports = data ? [...data.history.reduce((m, h) => m.set(h.source, (m.get(h.source) ?? 0) + 1), new Map<string, number>())] : [];
  const hasMonthlyOnly = (view?.monthlyOnly.length ?? 0) > 0;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Revenue</h1>
          <p className="muted">History from your old systems up to the launch, then HandyOS from {monthName(LAUNCH_MONTH)}. Sales tax is left out of HandyOS payments.</p>
        </div>
      </header>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="card">
            <h2>Revenue by</h2>
            <div className="chips">
              {GROUPS.map((g) => (
                <button key={g} type="button" className={`chip ${by === g ? 'on' : ''}`} onClick={() => setBy(g)}>
                  {GROUP_LABELS[g]}
                </button>
              ))}
            </div>
            <div className="row">
              <label className="grow">
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="grow">
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <p>
              <strong>{formatMoney(total)}</strong> <span className="muted">in {rows.length} {GROUP_LABELS[by].toLowerCase()}
              {rows.length === 1 ? '' : by === 'customer' ? 's' : by === 'quarter' ? 's' : 's'}</span>
            </p>
            {rows.length === 0 && <p className="muted">Nothing to show yet. Load your past invoices below, or record payments in HandyOS.</p>}
            {rows.map((r) => (
              <div key={r.key} style={{ margin: '8px 0' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    {r.label} <span className="muted small-note">· {r.count}</span>
                  </span>
                  <strong>{formatMoney(r.cents)}</strong>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--border, #e5e7eb)' }}>
                  <div style={{ height: 8, borderRadius: 4, width: `${Math.round((Math.max(0, r.cents) / max) * 100)}%`, background: 'var(--accent, #15803d)' }} />
                </div>
              </div>
            ))}
            {hasMonthlyOnly && (by === 'month' || by === 'quarter' || by === 'year') && (
              <p className="muted small-note">Some months have only a monthly total from your QuickBooks Profit and Loss, with no invoice rows. They are counted here, but not in the day, week, job or customer views.</p>
            )}
            {hasMonthlyOnly && !(by === 'month' || by === 'quarter' || by === 'year') && (
              <p className="muted small-note">Months that only have a QuickBooks monthly total are left out of this view. Load that period&apos;s invoice list to include them.</p>
            )}
          </div>

          <div className="card">
            <h2>Load past invoices</h2>
            <p className="muted">
              Export your invoices or payments from QuickBooks (Reports → Transaction List by Customer, or Sales by Customer Detail) or from your old CRM (Excel or CSV), and choose the file. One row per invoice or payment, with a date and amount; customer and job make the Customer and Job views work. Load up to December 31, {Number(LAUNCH_MONTH.slice(0, 4)) - 1}.
            </p>
            <input ref={input} type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />
            {file && (
              <>
                <div className="row">
                  {FIELDS.map((f) => (
                    <label key={f} className="grow">
                      {FIELD_LABELS[f]}
                      <select value={cols[f]} onChange={(e) => setCols({ ...cols, [f]: Number(e.target.value) })}>
                        <option value={-1}>{f === 'date' || f === 'amount' ? 'Choose…' : '(none)'}</option>
                        {file.parsed.headers.map((h, i) => (h ? (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ) : null))}
                      </select>
                    </label>
                  ))}
                </div>
                {preview && (
                  <p className="muted">
                    {preview.entries.length} rows, {formatMoney(preview.entries.reduce((n, e) => n + e.amount_cents, 0))}, from {preview.entries.map((e) => e.date).sort()[0] ?? '—'} to {preview.entries.map((e) => e.date).sort().pop() ?? '—'}
                    {preview.skipped > 0 && ` (${preview.skipped} rows without a date and amount, like totals, were skipped)`}.
                  </p>
                )}
                <label>
                  Name for this load
                  <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. QuickBooks 2025" />
                </label>
                <label className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                  <span>Replace an earlier load with this same name (so loading a file twice never doubles it)</span>
                </label>
                <button type="button" disabled={busy || !preview || preview.entries.length === 0 || !source.trim()} onClick={() => void doImport()}>
                  {busy ? 'Loading…' : 'Load these rows'}
                </button>
              </>
            )}
            {note && <p className={note.ok ? 'notice' : 'err'}>{note.text}</p>}
            {imports.length > 0 && (
              <>
                <h3>Already loaded</h3>
                {imports.map(([name, count]) => (
                  <div key={name} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {name} <span className="muted small-note">· {count} rows</span>
                    </span>
                    <button
                      type="button"
                      className="link"
                      onClick={async () => {
                        if (!window.confirm(`Remove everything loaded as "${name}"?`)) return;
                        const err = resultError(await removeImport({ source: name }));
                        if (err) setNote({ ok: false, text: err });
                        else reload();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
