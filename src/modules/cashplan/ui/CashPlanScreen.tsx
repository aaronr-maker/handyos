import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, useAsync, useSession } from '@/core';
import { listInvoices } from '@/modules/invoicing';
import { listJobs } from '@/modules/jobs';
import { jobEconomics } from '@/modules/jobcosting';
import { listPayments } from '@/modules/payments';
import { addPlans, BUCKETS, planPayment, type PaymentPlan } from '../calc';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The Monday of the week a date falls in. */
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const pretty = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Where the money from a week's payments should go, job by job. It only suggests; the owner moves the money. */
export default function CashPlanScreen() {
  const { companyId, role } = useSession();
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error } = useAsync(async () => {
    const [payments, invoices, jobs] = await Promise.all([listPayments(companyId), listInvoices(companyId), listJobs(companyId)]);
    const economics = await jobEconomics(companyId, [...new Set(invoices.map((i) => i.job_id).filter((id): id is string => !!id))]);
    return { payments, invoices, jobs, economics };
  }, [companyId]);

  if (role !== 'owner' && role !== 'admin' && role !== 'office') return <p className="muted">Only the owner, admins and office can see the cash plan.</p>;

  const from = iso(monday);
  const sunday = addDays(monday, 6);
  const to = iso(sunday);
  const thisWeek = from === iso(mondayOf(new Date()));

  // the week's payments, grouped by the job they were paid to
  const byJob = new Map<string, { jobId: string | null; items: { id: string; amount: number; date: string; invoiceId: string | null; invoiceNo: number | undefined; plan: PaymentPlan }[] }>();
  for (const p of data?.payments ?? []) {
    if (p.received_on < from || p.received_on > to) continue;
    const inv = data!.invoices.find((i) => i.id === p.invoice_id);
    const jobId = inv?.job_id ?? null;
    const plan = planPayment({ amount_cents: p.amount_cents, invoice_total_cents: inv?.total_cents ?? 0, invoice_tax_cents: inv?.tax_cents ?? 0, job: jobId ? (data!.economics[jobId] ?? null) : null });
    const key = jobId ?? 'none';
    const group = byJob.get(key) ?? { jobId, items: [] };
    group.items.push({ id: p.id, amount: p.amount_cents, date: p.received_on, invoiceId: inv?.id ?? null, invoiceNo: inv?.invoice_number, plan });
    byJob.set(key, group);
  }
  const groups = [...byJob.values()].map((g) => ({ ...g, job: g.jobId ? data?.jobs.find((j) => j.id === g.jobId) : undefined, received: g.items.reduce((n, x) => n + x.amount, 0), totals: addPlans(g.items.map((x) => x.plan)) }));
  groups.sort((a, b) => (b.job?.job_number ?? 0) - (a.job?.job_number ?? 0));
  const all = addPlans(groups.map((g) => ({ buckets: g.totals, notes: [] })));
  const received = groups.reduce((n, g) => n + g.received, 0);
  const paymentCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Cash plan</h1>
          <p className="muted">Where the money you received this week should go, job by job. This only suggests; you move the money yourself.</p>
        </div>
      </header>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="secondary" onClick={() => setMonday(addDays(monday, -7))}>
          ← Earlier week
        </button>
        <strong>
          {pretty(monday)} to {pretty(sunday)}, {sunday.getFullYear()}
          {thisWeek ? ' (this week)' : ''}
        </strong>
        <button type="button" className="secondary" onClick={() => setMonday(addDays(monday, 7))} disabled={thisWeek}>
          Later week →
        </button>
        <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Jump to
          <input type="date" value="" onChange={(e) => e.target.value && setMonday(mondayOf(new Date(`${e.target.value}T12:00:00`)))} aria-label="Jump to the week of this date" />
        </label>
      </div>
      <p className="muted small-note">Weeks run Monday to Sunday and cover payments by the date they were received.</p>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="card">
            <h2>Move this money</h2>
            <p className="muted">
              {formatMoney(received)} received on {groups.length} job{groups.length === 1 ? '' : 's'} ({paymentCount} payment{paymentCount === 1 ? '' : 's'}).
            </p>
            {groups.length === 0 ? (
              <p className="muted">No payments were received this week.</p>
            ) : (
              <dl className="totals">
                {BUCKETS.map((b) => (
                  <div key={b.id} style={{ display: 'contents' }}>
                    <dt>
                      {b.label}
                      <span className="muted small-note" style={{ display: 'block' }}>
                        {b.hint}
                      </span>
                    </dt>
                    <dd>{formatMoney(all[b.id])}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {groups.map((g) => {
            const key = g.jobId ?? 'none';
            return (
              <div key={key} className="card">
                <h2>{g.job ? (
                  <Link to={`/jobs/${g.job.id}`}>
                    Job #{g.job.job_number} · {g.job.title}
                  </Link>
                ) : (
                  'Not tied to a job'
                )}</h2>
                <p className="muted">
                  {formatMoney(g.received)} received this week
                </p>
                <dl className="totals">
                  {BUCKETS.filter((b) => g.totals[b.id] !== 0 || b.id === 'profit').map((b) => (
                    <div key={b.id} style={{ display: 'contents' }}>
                      <dt>{b.label}</dt>
                      <dd>{formatMoney(g.totals[b.id])}</dd>
                    </div>
                  ))}
                </dl>
                {[...new Set(g.items.flatMap((x) => x.plan.notes))].map((n) => (
                  <p key={n} className="muted small-note">
                    {n}
                  </p>
                ))}
                <button type="button" className="link" onClick={() => setOpen(open === key ? null : key)}>
                  {open === key ? 'Hide' : 'Show'} the {g.items.length} payment{g.items.length === 1 ? '' : 's'}
                </button>
                {open === key &&
                  g.items.map((x) => (
                    <p key={x.id} className="muted">
                      {formatMoney(x.amount)} on {x.date}
                      {x.invoiceId && (
                        <>
                          {' · '}
                          <Link to={`/invoices/${x.invoiceId}`}>Invoice #{x.invoiceNo ?? '?'}</Link>
                        </>
                      )}
                    </p>
                  ))}
              </div>
            );
          })}
          <p className="muted small-note">
            How it is worked out: each payment pays its share of the job&apos;s costs (hours clocked so far at your company hourly cost, split into wages, payroll tax and running costs; materials; the pay-for-performance pool), after sales tax. The company reserve comes
            next, and what is left is profit. Early in a job the costs are estimates from the hours clocked so far.
          </p>
        </>
      )}
    </section>
  );
}
