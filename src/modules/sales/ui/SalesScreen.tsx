import { useState } from 'react';
import { listTeamMembers, useAsync, useSession } from '@/core';
import { loadSales } from '../service';
import type { Board, Needs, SellerRow } from '../calc';

const money = (cents: number | null) => (cents === null ? '—' : '$' + Math.round(cents / 100).toLocaleString('en-US'));
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const PERIODS = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
] as const;

const COLOR = { enough: '#15803d', close: '#b45309', short: '#dc2626', unknown: '#9ca3af' } as const;

function Verdict({ n }: { n: Needs }) {
  const color = COLOR[n.verdict];
  const need = n.targetEstimates;
  const fill = need ? Math.min(100, Math.round((n.sentPerMonth / need) * 100)) : 0;
  const headline =
    n.verdict === 'unknown'
      ? 'Not enough to tell yet'
      : n.verdict === 'enough'
        ? 'Yes, you are sending enough estimates'
        : n.verdict === 'close'
          ? 'Close, but a little short'
          : 'No, you need to send more estimates';
  return (
    <div className="card" style={{ borderColor: color, borderWidth: 2 }}>
      <p className="muted small-note">ARE WE SENDING ENOUGH ESTIMATES TO BE PROFITABLE?</p>
      <h2 style={{ color }}>{headline}</h2>
      {n.verdict === 'unknown' ? (
        <p>{n.missing}</p>
      ) : (
        <>
          <p>
            To cover your crew and your profit target you need about <strong>{money(n.targetSalesCents)}</strong> in sales a month ({money(n.breakEvenSalesCents)} just to break even). At your average
            ticket and close rate, that means about <strong>{Math.ceil(need ?? 0)} estimates a month</strong> ({Math.ceil(n.breakEvenEstimates ?? 0)} to break even).
          </p>
          <p>
            You are sending about <strong>{Math.round(n.sentPerMonth)} a month</strong>
            {n.gap !== null && (n.gap >= 0 ? `, ${Math.round(n.gap)} more than you need.` : `, ${Math.abs(Math.round(n.gap))} fewer than you need.`)}
          </p>
          <div
            role="img"
            aria-label={`Sending ${Math.round(n.sentPerMonth)} of ${Math.ceil(need ?? 0)} needed`}
            style={{ background: '#e2e8f0', borderRadius: 6, height: 14, overflow: 'hidden', maxWidth: 520 }}
          >
            <div style={{ width: `${fill}%`, height: '100%', background: color }} />
          </div>
        </>
      )}
    </div>
  );
}

const MEDAL = ['🥇', '🥈', '🥉'];

/** One category: the leader up top, everyone ranked below with bars. */
function BoardCard({ b, nameOf, me }: { b: Board; nameOf: (id: string | null) => string; me: string }) {
  const best = Math.max(...b.leaders.map((l) => Math.abs(l.value)), 1e-9);
  const worst = Math.min(...b.leaders.map((l) => Math.abs(l.value)), best);
  const width = (l: Board['leaders'][number]) => (b.id === 'pace' ? Math.max(8, 100 - ((Math.abs(l.value) - worst) / (best || 1)) * 60) : Math.max(8, (l.value / best) * 100));
  return (
    <div className="card board">
      <h2>{b.title}</h2>
      <p className="muted small-note">{b.rule}</p>
      {b.leaders.length === 0 ? (
        <p className="muted">Nobody yet. First one on the board gets the crown!</p>
      ) : (
        <ol className="board-list">
          {b.leaders.map((l, i) => (
            <li key={l.user_id} className={i === 0 ? 'board-first' : ''}>
              <span className="board-medal">{MEDAL[i] ?? `${i + 1}.`}</span>
              <span className="board-name">
                {nameOf(l.user_id)}
                {l.user_id === me ? ' (you)' : ''}
              </span>
              <span className="board-bar">
                <span style={{ width: `${width(l)}%` }} />
              </span>
              <strong>{l.shown}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Who is selling, estimate by estimate, and whether enough are going out. */
export default function SalesScreen() {
  const { companyId, role, user } = useSession();
  const [days, setDays] = useState<number>(30);
  const { data, loading, error } = useAsync(async () => ({ sales: await loadSales(companyId, days), team: await listTeamMembers() }), [companyId, days]);
  const boss = role === 'owner' || role === 'admin';
  const nameOf = (id: string | null) => (id ? data?.team.find((m) => m.id === id)?.full_name || data?.team.find((m) => m.id === id)?.email || 'Team member' : 'Nobody recorded');
  const top = Math.max(1, ...(data?.sales.sellers.map((s) => s.soldCents) ?? [1]));

  const line = (r: SellerRow, label: string, strong = false) => (
    <tr key={label} style={strong ? { fontWeight: 800 } : undefined}>
      <td>{label}</td>
      <td>{r.sent}</td>
      <td>{pct(r.closeRate)}</td>
      <td>{r.approved}</td>
      <td>{money(r.avgTicketCents)}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 60, background: '#f1f5f9', borderRadius: 4, height: 10 }}>
            <div style={{ width: `${strong ? 0 : Math.max(2, (r.soldCents / top) * 100)}%`, height: '100%', background: '#15803d', borderRadius: 4 }} />
          </div>
          <span>{money(r.soldCents)}</span>
        </div>
      </td>
    </tr>
  );

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Sales</h1>
          <p className="muted">
            {boss ? 'Who is selling, the top performer in each category, and whether we are sending enough estimates.' : 'The top performer in each category. Who is going to be number one?'}
          </p>
        </div>
      </header>
      <div className="seg" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.days} className={days === p.days ? '' : 'secondary'} onClick={() => setDays(p.days)}>
            {p.label}
          </button>
        ))}
      </div>
      {loading && <p className="muted">Working it out…</p>}
      {error && <p className="err">{error}</p>}
      {data && (
        <>
          <div className="boards">
            {data.sales.boards.map((b) => (
              <BoardCard key={b.id} b={b} nameOf={nameOf} me={user.id} />
            ))}
          </div>
          {boss && <Verdict n={data.sales.needs} />}
          {boss && (
            <div className="card">
              <h2>By person</h2>
              {data.sales.sellers.length === 0 ? (
                <p className="muted">No estimates were sent or decided in this period.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="by-month">
                    <thead>
                      <tr>
                        <th>Seller</th>
                        <th>Estimates sent</th>
                        <th>Close rate</th>
                        <th>Approved</th>
                        <th>Average ticket</th>
                        <th>Sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sales.sellers.map((s) => line(s, nameOf(s.user_id)))}
                      {line(data.sales.total, 'Everyone', true)}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted small-note">“Sold” is the total of the estimates customers approved in this period (before tax). Close rate is approved out of approved plus declined.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
