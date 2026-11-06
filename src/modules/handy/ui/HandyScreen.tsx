import { useState } from 'react';
import { askAssistant, listTeamMembers, useAsync, useSession } from '@/core';
import { deleteThread, getRates, listThreads, listUsage, saveRates } from '../service';
import { addUsage, dollars, estimateCost, noUsage, type Rates } from '../usage';

const RATE_FIELDS: { key: keyof Rates; label: string }[] = [
  { key: 'text_in', label: 'Text in' },
  { key: 'text_out', label: 'Text out' },
  { key: 'audio_in', label: 'Voice in' },
  { key: 'audio_out', label: 'Voice out' },
];

/** Past conversations with Handy, and what he has cost this month. */
export default function HandyScreen() {
  const { companyId, user, role } = useSession();
  const isAdmin = role === 'owner' || role === 'admin';
  const [typedRates, setTypedRates] = useState<Record<string, string> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    const [threads, usage, rates, team] = await Promise.all([listThreads(companyId), listUsage(companyId), getRates(companyId), listTeamMembers()]);
    return { threads, usage, rates, team };
  }, [companyId]);

  const mine = (data?.threads ?? []).filter((t) => t.user_id === user.id);
  const others = isAdmin ? (data?.threads ?? []).filter((t) => t.user_id !== user.id) : [];

  // this calendar month, everyone's (admins) or just your own
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const rows = (data?.usage ?? []).filter((u) => u.created_at >= monthStart && (isAdmin || u.user_id === user.id));
  const total = rows.reduce((n, r) => addUsage(n, r), noUsage());
  const calls = rows.filter((r) => r.kind === 'voice');
  const rates = data?.rates ?? {};
  const cost = estimateCost(total, rates);
  const people = [...new Set(rows.map((r) => r.user_id))].map((id) => {
    const used = rows.filter((r) => r.user_id === id).reduce((n, r) => addUsage(n, r), noUsage());
    const m = data?.team.find((x) => x.id === id);
    return { id, name: m?.full_name || m?.email || 'Team member', used, cost: estimateCost(used, rates), calls: rows.filter((r) => r.user_id === id && r.kind === 'voice').length };
  });
  const tokens = (u: typeof total) => u.text_in + u.text_out + u.audio_in + u.audio_out;
  const form = typedRates ?? Object.fromEntries(RATE_FIELDS.map((f) => [f.key, rates[f.key] === undefined ? '' : String(rates[f.key])]));

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Handy</h1>
          <p className="muted">Your office assistant. Use the Handy button at the bottom of any screen, or start here.</p>
        </div>
        <button type="button" onClick={() => askAssistant({ title: 'New chat', prompt: '' })}>
          Open Handy
        </button>
      </header>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      <div className="card">
        <h2>What Handy has cost this month</h2>
        <dl className="totals">
          <dt>Voice calls</dt>
          <dd>
            {calls.length} · {Math.round(calls.reduce((n, c) => n + c.seconds, 0) / 60)} min
          </dd>
          <dt>Typed answers</dt>
          <dd>{rows.filter((r) => r.kind === 'text').length}</dd>
          <dt>Tokens used</dt>
          <dd>{tokens(total).toLocaleString('en-US')}</dd>
          <dt>
            <strong>Estimated cost</strong>
          </dt>
          <dd>
            <strong>{cost === null ? 'enter the prices below' : dollars(cost)}</strong>
          </dd>
        </dl>
        {isAdmin && people.length > 0 && (
          <table className="by-month">
            <thead>
              <tr>
                <th>Person</th>
                <th>Calls</th>
                <th>Tokens</th>
                <th>Estimate</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.calls}</td>
                  <td>{tokens(p.used).toLocaleString('en-US')}</td>
                  <td>{p.cost === null ? '' : dollars(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isAdmin && (
          <>
            <h3>Prices (dollars per million tokens)</h3>
            <p className="muted small-note">Copy these from OpenAI's pricing page for the models Handy uses. The app multiplies them by the tokens used. It is an estimate: OpenAI's own usage page is the real bill.</p>
            <div className="row">
              {RATE_FIELDS.map((f) => (
                <label key={f.key} className="grow">
                  {f.label}
                  <input inputMode="decimal" value={form[f.key] ?? ''} onChange={(e) => setTypedRates({ ...form, [f.key]: e.target.value })} />
                </label>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                const next: Rates = {};
                for (const f of RATE_FIELDS) {
                  const n = Number(form[f.key]);
                  if (form[f.key]?.trim() && Number.isFinite(n) && n >= 0) next[f.key] = n;
                }
                await saveRates(companyId, next);
                setNote('Saved.');
                setTypedRates(null);
                reload();
              }}
            >
              Save prices
            </button>
            {note && <p className="notice">{note}</p>}
          </>
        )}
      </div>

      <div className="card list">
        <h2>Your conversations</h2>
        {mine.length === 0 && <p className="muted">No conversations yet.</p>}
        {mine.map((t) => (
          <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              {t.title} <span className="muted small-note">{new Date(t.updated_at).toLocaleDateString()}</span>
            </span>
            <button
              type="button"
              className="link"
              onClick={async () => {
                if (!window.confirm('Delete this conversation?')) return;
                try {
                  await deleteThread(companyId, t.id);
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : 'Could not delete it.');
                }
                reload();
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <div className="card list">
          <h2>Everyone else's (owners and admins can see these)</h2>
          {others.map((t) => (
            <p key={t.id}>
              {t.title} <span className="muted small-note">{new Date(t.updated_at).toLocaleDateString()}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
