import { useState } from 'react';
import { centsToInput, listTeamMembers, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { setPayRateAction } from '../actions';
import { listPayRates } from '../services/jobCostService';

/** What each person costs per hour. Only owners and admins see and change this. */
export function PayRates({ onChanged }: { onChanged(): void }) {
  const { companyId, role } = useSession();
  const setRate = useAction(setPayRateAction);
  const { data, reload } = useAsync(async () => ({ team: await listTeamMembers(), rates: await listPayRates(companyId) }), [companyId]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (role !== 'owner' && role !== 'admin') return null;

  return (
    <details className="card">
      <summary>Pay rates (what each person costs you per hour)</summary>
      <p className="muted">Used to cost the hours on the time clock. Private to owners and admins.</p>
      {data?.team.map((m) => {
        const current = data.rates.find((r) => r.user_id === m.id);
        const value = typed[m.id] ?? (current ? centsToInput(current.hourly_cost_cents) : '');
        return (
          <div key={m.id} className="row small rate-row">
            <span className="grow">{m.full_name || m.email}</span>
            <input inputMode="decimal" placeholder="$ per hour" value={value} onChange={(e) => setTyped({ ...typed, [m.id]: e.target.value })} />
            <button
              className="secondary"
              onClick={async () => {
                const cents = parseMoney(value);
                if (cents === null) return setError('Enter an hourly amount like 35 or 35.50');
                const message = resultError(await setRate({ user_id: m.id, hourly_cost_cents: cents }));
                setError(message);
                if (!message) {
                  reload();
                  onChanged();
                }
              }}
            >
              Save
            </button>
          </div>
        );
      })}
      {error && <p className="err">{error}</p>}
    </details>
  );
}
