import { Link } from 'react-router-dom';
import { listTeamMembers, useAsync, useSession } from '@/core';
import { loadStandards } from '../service';
import type { Confidence } from '../standards';
import { hm } from './fmt';

const BADGE: Record<Confidence, { text: string; color: string }> = {
  good: { text: 'Solid', color: '#15803d' },
  some: { text: 'Getting there', color: '#b45309' },
  learning: { text: 'Learning', color: '#6b7280' },
};

/** How long each service takes per unit, learned from the company's own jobs. */
export default function StandardTimes() {
  const { companyId, role } = useSession();
  const { data, loading, error } = useAsync(async () => ({ standards: await loadStandards(companyId), team: await listTeamMembers() }), [companyId]);
  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can see standard times.</p>;
  if (loading) return <p className="muted">Working it out…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not work out the standard times.'}</p>;
  const { standards, team } = data;
  const nameOf = (id: string) => team.find((m) => m.id === id)?.full_name || team.find((m) => m.id === id)?.email || 'Team member';
  const known = standards.services.filter((s) => s.minutes_per_unit !== null);
  const learning = standards.services.filter((s) => s.minutes_per_unit === null);

  return (
    <section className="page">
      <Link to="/time" className="muted">
        ← My time
      </Link>
      <header className="page-header">
        <div>
          <h1>Standard times</h1>
          <p className="muted">How long each service takes, learned from your own jobs. A time a tech measured counts first; a job nobody timed adds a clue, and every job sharpens the picture.</p>
        </div>
      </header>

      <div className="card">
        <h2>Services</h2>
        {known.length === 0 && <p className="muted">Nothing learned yet. Once jobs have tasks and time on them, the standard times appear here.</p>}
        {known.length > 0 && (
          <table className="by-month">
            <thead>
              <tr>
                <th>Service</th>
                <th>Standard</th>
                <th>Based on</th>
                <th>How sure</th>
              </tr>
            </thead>
            <tbody>
              {known.map((s) => (
                <tr key={s.key}>
                  <td>{s.name}</td>
                  <td>
                    <strong>
                      {s.minutes_per_unit} min per {s.unit}
                    </strong>
                    <span className="muted small-note" style={{ display: 'block' }}>
                      {s.unit === 'each' ? `${hm(s.minutes_per_unit ?? 0)} each` : `${hm((s.minutes_per_unit ?? 0) * 100)} per 100 ${s.unit}`}
                    </span>
                    {s.disagrees && (
                      <span className="err small-note" style={{ display: 'block' }}>
                        Timed jobs say {s.minutes_per_unit}, but untimed jobs suggest about {Math.round(s.disagrees.other * 100) / 100}. Worth a look.
                      </span>
                    )}
                  </td>
                  <td>
                    {s.measured_tasks > 0 ? `${s.measured_tasks} timed task${s.measured_tasks === 1 ? '' : 's'}` : `${s.inferred_jobs} job${s.inferred_jobs === 1 ? '' : 's'} (worked out, not timed)`}
                    {s.spread !== null && <span className="muted small-note" style={{ display: 'block' }}>spread {Math.round(s.spread * 100)}%</span>}
                  </td>
                  <td style={{ color: BADGE[s.confidence].color, fontWeight: 600 }}>{BADGE[s.confidence].text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {standards.overhead_per_visit !== null && <p className="muted">Each visit also carries about {hm(standards.overhead_per_visit)} of overhead (customer, cleanup, time between tasks).</p>}
        {learning.length > 0 && (
          <p className="muted small-note">
            Still learning, with no time yet: {learning.map((s) => s.name).join(', ')}. Time a task, or finish a job with only this service, to start them off.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Jobs that don't fit</h2>
        {standards.outliers.length === 0 ? (
          <p className="muted">No finished job is far from what the standards predict.</p>
        ) : (
          <>
            <p className="muted small-note">Finished jobs that took much longer or shorter than the standards predict: a complication, a callback, a clock left running, or a wrong entry.</p>
            {standards.outliers.map((o) => (
              <p key={o.job_id}>
                <Link to={`/time/job/${o.job_id}`}>{o.title}</Link>: took {hm(o.actual)}, expected about {hm(o.predicted)} ({o.ratio > 1 ? `${Math.round((o.ratio - 1) * 100)}% over` : `${Math.round((1 - o.ratio) * 100)}% under`})
              </p>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h2>How fast each tech works</h2>
        {standards.tech_speed.length === 0 ? (
          <p className="muted">Needs at least three timed tasks for a person.</p>
        ) : (
          <table className="by-month">
            <thead>
              <tr>
                <th>Person</th>
                <th>Compared with the standards</th>
                <th>Timed tasks</th>
              </tr>
            </thead>
            <tbody>
              {standards.tech_speed.map((t) => (
                <tr key={t.user_id}>
                  <td>{nameOf(t.user_id)}</td>
                  <td>
                    {t.ratio.toFixed(2)} <span className="muted small-note">{t.ratio > 1 ? `${Math.round((t.ratio - 1) * 100)}% slower` : t.ratio < 1 ? `${Math.round((1 - t.ratio) * 100)}% faster` : 'on the standard'}</span>
                  </td>
                  <td>{t.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small-note">The standards are an average of everyone, so someone slightly above or below 1.00 is normal. These numbers feed efficiency and the constraint dashboard.</p>
      </div>
    </section>
  );
}
