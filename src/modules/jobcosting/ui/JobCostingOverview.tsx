import { Link } from 'react-router-dom';
import { formatMoney, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { listJobs } from '@/modules/jobs';
import { costJob, loadCostingData } from '../services/jobCostService';
import { PayRates } from './PayRates';

export function JobCostingOverview() {
  const { companyId } = useSession();
  const { data, loading, error, reload } = useAsync(
    async () => ({ jobs: await listJobs(companyId), costing: await loadCostingData(companyId), customers: await listCustomers(companyId) }),
    [companyId],
  );

  const rows = (data?.jobs ?? [])
    .filter((j) => j.status !== 'unscheduled')
    .map((j) => ({ job: j, cost: costJob(j, data!.costing, null) }));
  const totals = rows.reduce((t, r) => ({ invoiced: t.invoiced + r.cost.invoiced_cents, cost: t.cost + r.cost.total_cost_cents }), { invoiced: 0, cost: 0 });
  const margin = totals.invoiced > 0 ? Math.round(((totals.invoiced - totals.cost) / totals.invoiced) * 1000) / 10 : null;
  const name = (id: string) => {
    const c = data?.customers.find((x) => x.id === id);
    return c ? customerLabel(c) : '';
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Job costing</h1>
          <p className="muted">
            {data ? `${formatMoney(totals.invoiced)} invoiced · ${formatMoney(totals.invoiced - totals.cost)} profit${margin !== null ? ` (${margin}%)` : ''}` : ' '}
          </p>
        </div>
      </header>
      <div className="row">
        <Link to="rate" className="button secondary">
          Company hourly rate
        </Link>
        <Link to="payouts" className="button secondary">
          Payouts
        </Link>
      </div>
      <PayRates onChanged={reload} />
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && rows.length === 0 && (
        <div className="card">
          <p className="muted">Costs show up once jobs are scheduled and worked.</p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="card list">
          {rows.map(({ job, cost }) => (
            <Link key={job.id} to={job.id} className="stack">
              <strong>
                #{job.job_number} · {job.title}
              </strong>
              <span className="muted">
                {name(job.customer_id)} · invoiced {formatMoney(cost.invoiced_cents)} · cost {formatMoney(cost.total_cost_cents)} ·{' '}
                <span className={cost.profit_cents < 0 ? 'err' : ''}>
                  profit {formatMoney(cost.profit_cents)}
                  {cost.margin_pct !== null && ` (${cost.margin_pct}%)`}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
