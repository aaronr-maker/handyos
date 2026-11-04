import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, useAsync, useSession } from '@/core';
import { listInvoices } from '@/modules/invoicing';
import { jobEconomics } from '@/modules/jobcosting';
import { listPayments } from '@/modules/payments';
import { addPlans, BUCKETS, planPayment, type PaymentPlan } from '../calc';

type Range = 'week' | 'month' | 'last_month' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'all', label: 'Everything' },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function bounds(range: Range): { from: string; to: string } {
  const now = new Date();
  if (range === 'week') return { from: iso(new Date(now.getTime() - 6 * 86_400_000)), to: '9999-12-31' };
  if (range === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: '9999-12-31' };
  if (range === 'last_month') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return { from: '0000-01-01', to: '9999-12-31' };
}

/** Where the money from payments should go. It only suggests; the owner moves the money. */
export default function CashPlanScreen() {
  const { companyId, role } = useSession();
  const [range, setRange] = useState<Range>('month');
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error } = useAsync(async () => {
    const [payments, invoices] = await Promise.all([listPayments(companyId), listInvoices(companyId)]);
    const jobs = await jobEconomics(companyId, [...new Set(invoices.map((i) => i.job_id).filter((id): id is string => !!id))]);
    return { payments, invoices, jobs };
  }, [companyId]);

  if (role !== 'owner' && role !== 'admin' && role !== 'office') return <p className="muted">Only the owner, admins and office can see the cash plan.</p>;

  const { from, to } = bounds(range);
  const rows = (data?.payments ?? [])
    .filter((p) => p.received_on >= from && p.received_on <= to)
    .map((p) => {
      const inv = data!.invoices.find((i) => i.id === p.invoice_id);
      const plan: PaymentPlan = planPayment({ amount_cents: p.amount_cents, invoice_total_cents: inv?.total_cents ?? 0, invoice_tax_cents: inv?.tax_cents ?? 0, job: inv?.job_id ? (data!.jobs[inv.job_id] ?? null) : null });
      return { p, inv, plan };
    });
  const totals = addPlans(rows.map((r) => r.plan));
  const received = rows.reduce((n, r) => n + r.p.amount_cents, 0);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Cash plan</h1>
          <p className="muted">Where the money you received should go. This only suggests; you move the money yourself.</p>
        </div>
      </header>
      <div className="chips">
        {RANGES.map((r) => (
          <button key={r.id} type="button" className={`chip ${range === r.id ? 'on' : ''}`} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="card">
            <h2>Move this money</h2>
            <p className="muted">{formatMoney(received)} received in {rows.length} payment{rows.length === 1 ? '' : 's'}.</p>
            {rows.length === 0 ? (
              <p className="muted">No payments in this time.</p>
            ) : (
              <dl className="totals">
                {BUCKETS.map((b) => (
                  <div key={b.id} style={{ display: 'contents' }}>
                    <dt title={b.hint}>
                      {b.label}
                      <span className="muted small-note" style={{ display: 'block' }}>
                        {b.hint}
                      </span>
                    </dt>
                    <dd>{formatMoney(totals[b.id])}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {rows.length > 0 && (
            <div className="card list">
              <h2>Payment by payment</h2>
              {rows.map(({ p, inv, plan }) => (
                <div key={p.id} className="stack">
                  <button type="button" className="link" onClick={() => setOpen(open === p.id ? null : p.id)} style={{ textAlign: 'left' }}>
                    <strong>{formatMoney(p.amount_cents)}</strong> · Invoice #{inv?.invoice_number ?? '?'} · {p.received_on} {open === p.id ? '▾' : '▸'}
                  </button>
                  {open === p.id && (
                    <>
                      <dl className="totals">
                        {BUCKETS.filter((b) => plan.buckets[b.id] !== 0 || b.id === 'profit').map((b) => (
                          <div key={b.id} style={{ display: 'contents' }}>
                            <dt>{b.label}</dt>
                            <dd>{formatMoney(plan.buckets[b.id])}</dd>
                          </div>
                        ))}
                      </dl>
                      {plan.notes.map((n) => (
                        <p key={n} className="muted small-note">
                          {n}
                        </p>
                      ))}
                      {inv && (
                        <Link to={`/invoices/${inv.id}`} className="muted">
                          Open invoice
                        </Link>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="muted small-note">
            How it is worked out: each payment pays its share of the job&apos;s costs (hours clocked so far at your company hourly cost, split into wages, payroll tax and running costs; materials; the pay-for-performance pool), after sales tax. The company reserve comes
            next, and what is left is profit. Early in a job the costs are estimates from the hours clocked so far.
          </p>
        </>
      )}
    </section>
  );
}
