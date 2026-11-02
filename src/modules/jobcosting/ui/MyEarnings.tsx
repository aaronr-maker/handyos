import { Link } from 'react-router-dom';
import { formatMoney, useAsync, useSession } from '@/core';
import { listJobs } from '@/modules/jobs';
import { listPayouts } from '../services/p4pService';

/** A person's own pay-for-performance: what they earned on each finished job, and what has been paid. */
export default function MyEarnings() {
  const { companyId, user, role } = useSession();
  const { data, loading, error } = useAsync(async () => ({ payouts: await listPayouts(companyId), jobs: await listJobs(companyId) }), [companyId]);

  const mine = (data?.payouts ?? []).filter((p) => p.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const total = mine.reduce((n, p) => n + p.amount_cents, 0);
  const paid = mine.filter((p) => p.paid_on).reduce((n, p) => n + p.amount_cents, 0);
  const job = (id: string) => data?.jobs.find((j) => j.id === id);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>My earnings</h1>
          <p className="muted">Your share of the pay-for-performance pool on finished, paid jobs.</p>
        </div>
      </header>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && (
        <div className="card">
          <dl className="totals">
            <dt>Earned in total</dt>
            <dd>{formatMoney(total)}</dd>
            <dt>Already paid out</dt>
            <dd>{formatMoney(paid)}</dd>
            <dt>
              <strong>Waiting to be paid</strong>
            </dt>
            <dd>
              <strong>{formatMoney(total - paid)}</strong>
            </dd>
          </dl>
        </div>
      )}
      {data && mine.length === 0 && (
        <div className="card">
          <p className="muted">Nothing yet. Your share shows up once a job you worked is finished, paid, and paid out.</p>
        </div>
      )}
      {mine.length > 0 && (
        <div className="card list">
          {mine.map((p) => {
            const j = job(p.job_id);
            return (
              <Link key={p.id} to={`/jobs/${p.job_id}`} className="stack">
                <strong>
                  {formatMoney(p.amount_cents)} · {j ? `#${j.job_number} ${j.title}` : 'Job'}
                </strong>
                <span className="muted">
                  {p.level_name}
                  {p.minutes > 0 && ` · ${Math.floor(p.minutes / 60)}h ${p.minutes % 60}m on the job`} · {p.paid_on ? `paid ${p.paid_on}` : 'not paid yet'}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {role === 'tech' && <p className="muted">Questions about a payout? Ask your manager.</p>}
    </section>
  );
}
