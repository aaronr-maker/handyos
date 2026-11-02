import { useState } from 'react';
import { formatMoney, listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { finalizePayoutAction } from '../p4pActions';
import { BASIS_LABELS } from '../p4pTypes';
import { jobP4P } from '../services/p4pService';

/** The pay-for-performance breakdown for one job: a projection until it is finished and paid, then a locked-in payout. */
export function JobP4PPanel({ jobId, onChanged }: { jobId: string; onChanged(): void }) {
  const { companyId, role } = useSession();
  const finalize = useAction(finalizePayoutAction);
  const { data, loading, error, reload } = useAsync(async () => ({ p: await jobP4P(companyId, jobId), team: await listTeamMembers() }), [companyId, jobId]);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (!data) return <p className="err">{error}</p>;
  const { p, team } = data;
  const r = p.result;
  const name = (id: string) => {
    const m = team.find((x) => x.id === id);
    return m ? m.full_name || m.email || 'Team member' : 'Someone';
  };
  const noLevels = r.levels.length === 0;
  const canFinalize = (role === 'owner' || role === 'admin') && p.status === 'ready';

  return (
    <div className="card">
      <h2>Pay-for-performance</h2>
      {p.status === 'finalized' && <p className="notice">Paid out and locked in {p.run ? new Date(p.run.finalized_at).toLocaleDateString() : ''}.</p>}
      {p.status === 'not_ready' && <p className="muted">A projection. {p.reason}</p>}
      {p.status === 'ready' && <p className="notice">This job is finished and fully paid, so its payout can be locked in.</p>}
      {noLevels ? (
        <p className="muted">No pay-for-performance levels are set up yet (Settings, Pay-for-performance).</p>
      ) : (
        <dl className="totals">
          <dt>{BASIS_LABELS[r.basis].title}</dt>
          <dd>{formatMoney(r.basis_cents)}</dd>
          <dt>Company keeps first ({r.reserve_bps / 100}%)</dt>
          <dd>{formatMoney(r.reserve_cents)}</dd>
          <dt>
            <strong>The pool</strong>
          </dt>
          <dd>
            <strong>{formatMoney(r.pool_cents)}</strong>
          </dd>
          {r.levels.map((l) => (
            <PayLine key={l.level_id} title={`${l.name} (${l.percent_bps / 100}%)`} amount={l.amount_cents}>
              {l.allocations.map((a) => `${name(a.user_id)} ${formatMoney(a.amount_cents)}`).join(', ') || 'nobody'}
              {l.unallocated_cents > 0 && ` · ${formatMoney(l.unallocated_cents)} stays with the company${l.note ? ` (${l.note})` : ''}`}
            </PayLine>
          ))}
          <dt>
            <strong>Company total</strong>
          </dt>
          <dd>
            <strong>{formatMoney(r.company_total_cents)}</strong>
          </dd>
        </dl>
      )}
      {problem && <p className="err">{problem}</p>}
      {canFinalize && (
        <button
          onClick={async () => {
            if (!confirm('Lock in this payout? It can only be done once.')) return;
            const message = resultError(await finalize({ job_id: jobId }));
            setProblem(message);
            if (!message) {
              reload();
              onChanged();
            }
          }}
        >
          Lock in this payout
        </button>
      )}
    </div>
  );
}

function PayLine({ title, amount, children }: { title: string; amount: number; children: React.ReactNode }) {
  return (
    <>
      <dt>
        {title}
        <div className="muted small-note">{children}</div>
      </dt>
      <dd>{formatMoney(amount)}</dd>
    </>
  );
}
