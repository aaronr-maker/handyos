import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { markPayoutsPaidAction } from '../p4pActions';
import { listPayouts } from '../services/p4pService';

/** Who is owed what from locked-in payouts, with a way to mark a person's payouts as paid. Owners and admins. */
export default function PayoutsReport() {
  const { companyId, role } = useSession();
  const markPaid = useAction(markPayoutsPaidAction);
  const { data, loading, error, reload } = useAsync(async () => ({ payouts: await listPayouts(companyId), team: await listTeamMembers() }), [companyId]);
  const [problem, setProblem] = useState<string | null>(null);

  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can see everyone's payouts.</p>;
  const name = (id: string) => {
    const m = data?.team.find((x) => x.id === id);
    return m ? m.full_name || m.email || 'Team member' : 'Someone';
  };
  const people = [...new Set((data?.payouts ?? []).map((p) => p.user_id))].map((id) => {
    const rows = data!.payouts.filter((p) => p.user_id === id);
    const unpaid = rows.filter((p) => !p.paid_on);
    return { id, total: rows.reduce((n, p) => n + p.amount_cents, 0), owed: unpaid.reduce((n, p) => n + p.amount_cents, 0), unpaidIds: unpaid.map((p) => p.id) };
  });

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Job costing
      </Link>
      <header className="page-header">
        <div>
          <h1>Payouts</h1>
          <p className="muted">Pay-for-performance that has been locked in, by person.</p>
        </div>
      </header>
      {(error || problem) && <p className="err">{error ?? problem}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && people.length === 0 && (
        <div className="card">
          <p className="muted">Nothing locked in yet. Open a finished, paid job in Job costing and lock in its payout.</p>
        </div>
      )}
      {people.length > 0 && (
        <div className="card list">
          {people.map((p) => (
            <div key={p.id} className="contact-row">
              <div>
                <strong>{name(p.id)}</strong>
                <div className="muted">
                  {formatMoney(p.total)} earned · {formatMoney(p.owed)} not paid yet
                </div>
              </div>
              {p.owed > 0 && (
                <button
                  className="secondary"
                  onClick={async () => {
                    if (!confirm(`Mark ${formatMoney(p.owed)} as paid to ${name(p.id)} today?`)) return;
                    const message = resultError(await markPaid({ payout_ids: p.unpaidIds }));
                    setProblem(message);
                    if (!message) reload();
                  }}
                >
                  Mark {formatMoney(p.owed)} paid
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
