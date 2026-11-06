import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { askAssistant, listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { assignJobAction } from '@/modules/jobs';
import { loadTimeFacts, WEEK_LIMIT_MINUTES } from '@/modules/timesheets';
import { hoursMinutes } from '@/modules/timetrack';
import { closeAlertAction, refreshAlertsAction } from '../actions';
import { listAlerts } from '../service';
import { setOpenAlerts } from '../store';
import { suggestAssignees, suggestReassignments } from '../suggest';

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The manager's desk: what needs a decision, with Handy's suggested fix next to each. */
export default function DeskScreen() {
  const { companyId, role } = useSession();
  const refresh = useAction(refreshAlertsAction);
  const closeAlert = useAction(closeAlertAction);
  const assign = useAction(assignJobAction);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    // look at everyone's week first, so the alerts are up to date when they are listed
    await refresh({});
    const [alerts, facts, team] = await Promise.all([listAlerts(companyId), loadTimeFacts(companyId), listTeamMembers()]);
    return { alerts, facts, team, now: Date.now() };
  }, [companyId]);

  // check again every five minutes while the desk is open
  const again = useRef(reload);
  useEffect(() => {
    again.current = reload;
  });
  useEffect(() => {
    const t = window.setInterval(() => again.current(), 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);

  const openNow = data?.alerts.filter((a) => a.status === 'open');
  useEffect(() => {
    if (openNow) setOpenAlerts(openNow);
  }, [openNow]);

  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can see the to-do list.</p>;
  if (loading) return <p className="muted">Looking at everyone's week…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load the desk.'}</p>;

  const { alerts, facts, team, now } = data;
  const nameOf = (id: string) => team.find((m) => m.id === id)?.full_name || team.find((m) => m.id === id)?.email || 'A team member';
  const candidates = team.filter((m) => m.role === 'tech' || m.role === 'admin').map((m) => m.id);
  const open = alerts.filter((a) => a.status === 'open');
  const closed = alerts.filter((a) => a.status !== 'open').slice(0, 20);
  const unassigned = facts.jobs.filter((j) => j.status === 'scheduled' && j.scheduled_start && j.scheduled_end && Date.parse(j.scheduled_end) > now && !facts.assignments.some((a) => a.job_id === j.id));

  const moveJob = async (jobId: string, from: string | null, to: string, alertId?: string) => {
    setNote(null);
    const current = facts.assignments.filter((a) => a.job_id === jobId).map((a) => a.user_id);
    const err = resultError(await assign({ job_id: jobId, user_ids: [...new Set([...current.filter((u) => u !== from), to])] }));
    if (err) return setNote({ ok: false, text: err });
    if (alertId) await closeAlert({ alert_id: alertId, status: 'resolved', resolution: `Moved a job to ${nameOf(to)}` });
    setNote({ ok: true, text: `Done: the job is now with ${nameOf(to)}.` });
    reload();
  };
  const close = async (id: string, status: 'resolved' | 'dismissed') => {
    const err = resultError(await closeAlert({ alert_id: id, status, resolution: null }));
    if (err) setNote({ ok: false, text: err });
    else reload();
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>To-do</h1>
          <p className="muted">
            {open.length + unassigned.length === 0 ? 'All clear. Nothing needs you right now.' : `${open.length + unassigned.length} thing${open.length + unassigned.length === 1 ? '' : 's'} to do.`} Handy suggests a fix for each; nothing changes until you click. Tick an item when it's handled.
          </p>
        </div>
      </header>
      {note && <p className={note.ok ? 'notice' : 'err'}>{note.text}</p>}

      <h2>Needs you</h2>
      {open.length === 0 && (
        <div className="card">
          <p className="muted">No open alerts. The app checks everyone's week while the app is open and pops up anything new.</p>
        </div>
      )}
      {open.map((a) => {
        const fixes = a.kind === 'overtime_risk' ? suggestReassignments({ facts, overUser: a.subject_user_id, candidates: candidates.filter((c) => c !== a.subject_user_id), now, limit: WEEK_LIMIT_MINUTES }) : [];
        return (
          <div key={a.id} className="card todo" style={{ borderColor: a.severity === 'critical' ? '#dc2626' : '#f59e0b' }}>
            <input type="checkbox" aria-label={`Mark handled: ${a.title}`} checked={false} onChange={() => void close(a.id, 'resolved')} />
            <div className="todo-body">
            <h3>{a.title}</h3>
            <p className="muted">{a.detail}</p>
            {a.kind === 'overtime_risk' && (
              <>
                <p>
                  <strong>Handy suggests:</strong> {fixes.length === 0 ? 'nobody has room to take a job, or the jobs left have already started. You could reschedule a job to next week.' : 'move these jobs so the week fits.'}
                </p>
                {fixes.map((f) => (
                  <div key={f.jobId} className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      <Link to={`/jobs/${f.jobId}`}>{f.jobTitle}</Link> <span className="muted small-note">{when(f.start)}</span>
                      <span className="muted small-note" style={{ display: 'block' }}>
                        Saves {hoursMinutes(f.savedMinutes)} of {nameOf(a.subject_user_id)}'s week. {nameOf(f.toUserId)} would be at {hoursMinutes(f.toProjected)}.
                      </span>
                    </span>
                    <button type="button" onClick={() => void moveJob(f.jobId, a.subject_user_id, f.toUserId, fixes.length === 1 ? a.id : undefined)}>
                      Move to {nameOf(f.toUserId)}
                    </button>
                  </div>
                ))}
              </>
            )}
            {a.kind === 'forgotten_clock' && (
              <p>
                <strong>Handy suggests:</strong> open <Link to="/timesheets">their timesheet</Link> and set the correct end time (your change is logged).
              </p>
            )}
            <div className="row">
              <button type="button" className="secondary" onClick={() => askAssistant({ title: a.title, prompt: `${a.title}. ${a.detail} Alert id: ${a.id}. What do you suggest?` })}>
                ✱ Talk it over with Handy
              </button>
              <button type="button" className="link" onClick={() => void close(a.id, 'dismissed')}>
                Dismiss (not a problem)
              </button>
            </div>
            </div>
          </div>
        );
      })}

      <h2>Jobs to staff</h2>
      {unassigned.length === 0 && (
        <div className="card">
          <p className="muted">Every scheduled job has someone on it.</p>
        </div>
      )}
      {unassigned.map((j) => {
        const options = suggestAssignees({ facts, job: { id: j.id, scheduled_start: j.scheduled_start!, scheduled_end: j.scheduled_end! }, candidates, now, limit: WEEK_LIMIT_MINUTES });
        return (
          <div key={j.id} className="card todo">
            <input type="checkbox" disabled checked={false} readOnly aria-label="Ticks itself once someone is assigned" title="Ticks itself once someone is assigned" />
            <div className="todo-body">
            <h3>
              <Link to={`/jobs/${j.id}`}>{j.title}</Link> has nobody assigned
            </h3>
            <p className="muted">Scheduled {when(j.scheduled_start!)}.</p>
            <p>
              <strong>Handy suggests:</strong> {options.length === 0 ? 'nobody is free then with room in their week. You may need to reschedule it.' : 'these people are free and stay under the weekly limit.'}
            </p>
            <button type="button" className="secondary" onClick={() => askAssistant({ title: j.title, prompt: `The job "${j.title}" (job id ${j.id}) is scheduled for ${when(j.scheduled_start!)} and nobody is assigned. Who should take it?` })}>
              ✱ Talk it over with Handy
            </button>
            {options.slice(0, 3).map((o) => (
              <div key={o.userId} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  {nameOf(o.userId)} <span className="muted small-note">would be at {hoursMinutes(o.projected)} this week</span>
                </span>
                <button type="button" onClick={() => void moveJob(j.id, null, o.userId)}>
                  Assign
                </button>
              </div>
            ))}
            </div>
          </div>
        );
      })}

      {closed.length > 0 && (
        <>
          <button type="button" className="link" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide' : 'Show'} done ({closed.length})
          </button>
          {showClosed &&
            closed.map((a) => (
              <div key={a.id} className="todo done">
                <input type="checkbox" checked readOnly disabled aria-label="Done" />
                <div className="todo-body">
                  {a.title}
                  {a.resolution ? ` · ${a.resolution}` : a.status === 'dismissed' ? ' · dismissed' : ''}
                </div>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
