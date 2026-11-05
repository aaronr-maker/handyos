import { listTeamMembers, useAsync, useSession } from '@/core';
import type { Kpi } from '../kpis';
import { loadDashboard } from '../service';
import { COLORS } from './palette';
import { Bar, KpiTile, Pipeline } from './Visuals';

const AREAS: Kpi['area'][] = ['Sales', 'Production', 'Profit', 'Cash'];
const pct = (v: number | null) => (v === null ? '' : `${Math.round(v * 100)}%`);
const money = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');

/** Your numbers on one page, and the one thing holding the business back right now. */
export default function DashboardScreen() {
  const { companyId, role } = useSession();
  const { data, loading, error } = useAsync(async () => ({ dash: await loadDashboard(companyId), team: await listTeamMembers() }), [companyId]);
  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can see the dashboard.</p>;
  if (loading) return <p className="muted">Working out your numbers…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load the dashboard.'}</p>;
  const { dash, team } = data;
  const nameOf = (id: string) => team.find((m) => m.id === id)?.full_name || team.find((m) => m.id === id)?.email || 'Team member';
  const c = dash.constraint;
  const tone = c.id === 'none' ? COLORS.good : c.id === 'unknown' ? COLORS.unknown : COLORS.bad;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">The last 30 days, compared with the 30 before. Targets are common starting points for a service business.</p>
        </div>
      </header>

      <div className="card" style={{ borderColor: tone, borderWidth: 2 }}>
        <p className="muted small-note">YOUR CONSTRAINT RIGHT NOW</p>
        <Pipeline constraint={c} />
        <h2 style={{ color: tone }}>{c.label}</h2>
        {c.why.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <h3>Things to try</h3>
        <ul>
          {c.tries.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="muted small-note">The constraint is the first stage, from work coming in to money coming back, that is holding the business back. Fix it, and the next one shows up.</p>
      </div>

      {AREAS.map((area) => (
        <div key={area}>
          <h2>{area}</h2>
          <div className="kpi-grid">
            {dash.kpis
              .filter((k) => k.area === area)
              .map((k) => (
                <KpiTile key={k.id} k={k} />
              ))}
          </div>
        </div>
      ))}

      <div className="card">
        <h2>Sellers</h2>
        {dash.sellers.length === 0 ? (
          <p className="muted">No decided estimates in the last 30 days.</p>
        ) : (
          <table className="by-month">
            <thead>
              <tr>
                <th>Seller</th>
                <th>Close rate</th>
                <th>Approved</th>
                <th>Sold</th>
              </tr>
            </thead>
            <tbody>
              {dash.sellers.map((s) => (
                <tr key={s.user_id}>
                  <td>{nameOf(s.user_id)}</td>
                  <td>{s.rate === null ? '' : <Bar value={s.rate} max={1} label={pct(s.rate)} />}</td>
                  <td>
                    {s.approved} of {s.decided}
                  </td>
                  <td>{money(s.sold_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Techs</h2>
        {dash.techs.length === 0 ? (
          <p className="muted">No job time in the last 30 days.</p>
        ) : (
          <table className="by-month">
            <thead>
              <tr>
                <th>Tech</th>
                <th>Hours on jobs</th>
                <th>Efficiency rate</th>
              </tr>
            </thead>
            <tbody>
              {dash.techs.map((t) => (
                <tr key={t.user_id}>
                  <td>{nameOf(t.user_id)}</td>
                  <td><Bar value={t.hours} max={Math.max(...dash.techs.map((x) => x.hours), 1)} label={String(t.hours)} /></td>
                  <td>{t.efficiency === null ? '' : <Bar value={Math.min(t.efficiency, 2)} max={2} color={t.efficiency <= 1.1 ? '#15803d' : t.efficiency <= 1.4 ? '#b45309' : '#dc2626'} label={t.efficiency.toFixed(2)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small-note">Efficiency rate is their actual time divided by the time scheduled for them (1.00 is on schedule, lower is faster). Standard times will add a per-service view.</p>
      </div>
    </section>
  );
}
