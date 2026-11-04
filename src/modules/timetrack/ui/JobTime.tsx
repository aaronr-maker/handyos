import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { getJob } from '@/modules/jobs';
import { addTaskAction, editTimeAction, loadTasksAction, removeTaskAction, setJobSiteAction } from '../actions';
import { checkJobTime, splitJobTime } from '../calc';
import { jobTimeData } from '../service';
import type { TimeEntity } from '../types';
import { clock, fromLocalInput, hm, initials, toLocalInput } from './fmt';

/** One job's time: each tech's own punches (editable only by that tech, greyed out for the others), and the split into task time and overhead. */
export default function JobTime() {
  const { id = '' } = useParams();
  const { companyId, role, user } = useSession();
  const userId = user.id;
  const editTime = useAction(editTimeAction);
  const loadTasks = useAction(loadTasksAction);
  const addTask = useAction(addTaskAction);
  const removeTask = useAction(removeTaskAction);
  const setSite = useAction(setJobSiteAction);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState({ name: '', quantity: '1', unit: 'each' });

  const { data, loading, error, reload } = useAsync(async () => {
    const [job, time, team] = await Promise.all([getJob(companyId, id), jobTimeData(companyId, id), listTeamMembers()]);
    return { job, time, team };
  }, [companyId, id]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data?.job) return <p className="err">{error ?? 'Job not found.'}</p>;
  const { job, time, team } = data;
  const nameOf = (uid: string) => team.find((m) => m.id === uid)?.full_name || team.find((m) => m.id === uid)?.email || 'Team member';
  const taskName = (tid: string) => time.tasks.find((t) => t.id === tid)?.name ?? 'Task';
  const split = splitJobTime({ tasks: time.tasks, entries: time.entries, timers: time.timers });
  const flags = checkJobTime({ tasks: time.tasks, entries: time.entries, timers: time.timers, jobDone: job.status === 'completed', nameOf });
  const canEdit = (owner: string) => role !== 'tech' || owner === userId;
  const editedBy = (entityId: string) => {
    const e = time.edits.filter((x) => x.entity_id === entityId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return e.length ? { initials: initials(nameOf(e[0].edited_by)), count: e.length, who: nameOf(e[0].edited_by) } : null;
  };

  const change = async (entity: TimeEntity, rowId: string, patch: { start?: string; end?: string | null }) => {
    setNote(null);
    const reason = window.prompt('Why are you changing this time? (optional)') ?? null;
    const err = resultError(await editTime({ entity, id: rowId, ...patch, reason: reason?.trim() || null }));
    if (err) setNote({ ok: false, text: err });
    else reload();
  };

  const Punch = ({ entity, rowId, owner, start, end }: { entity: TimeEntity; rowId: string; owner: string; start: string; end: string | null }) => {
    const mine = canEdit(owner);
    const who = editedBy(rowId);
    return (
      <div className="row" style={{ alignItems: 'center', gap: 8, opacity: mine ? 1 : 0.5, flexWrap: 'wrap' }}>
        <input type="datetime-local" aria-label="Start" disabled={!mine} defaultValue={toLocalInput(start)} onBlur={(e) => e.target.value && fromLocalInput(e.target.value) !== new Date(start).toISOString() && void change(entity, rowId, { start: fromLocalInput(e.target.value) })} />
        <span>to</span>
        <input type="datetime-local" aria-label="End" disabled={!mine} defaultValue={toLocalInput(end)} onBlur={(e) => e.target.value && (!end || fromLocalInput(e.target.value) !== new Date(end).toISOString()) && void change(entity, rowId, { end: fromLocalInput(e.target.value) })} />
        {end === null && <span className="muted small-note">still running</span>}
        {who && (
          <span className="muted small-note" title={`Changed ${who.count} time${who.count === 1 ? '' : 's'}; last by ${who.who}`}>
            edited by {who.initials}
          </span>
        )}
      </div>
    );
  };

  const stampOf = (e: (typeof time.entries)[number]) => `${clock(e.clock_in)}${e.clock_out ? ` to ${clock(e.clock_out)}` : ' (running)'}`;
  void stampOf;

  return (
    <section className="page">
      <Link to={`/jobs/${job.id}`} className="muted">
        ← Job #{job.job_number}
      </Link>
      <header className="page-header">
        <div>
          <h1>Time on {job.title}</h1>
          <p className="muted">Each tech's punches, and how the job's time splits into task time and overhead.</p>
        </div>
      </header>
      {note && <p className={note.ok ? 'notice' : 'err'}>{note.text}</p>}
      {flags.map((f, n) => (
        <p key={n} className="err">
          {f.text}
        </p>
      ))}

      <div className="card">
        <h2>Tasks</h2>
        {time.tasks.length === 0 && (
          <>
            <p className="muted">No tasks yet. Techs time a task when a job has more than one.</p>
            {job.estimate_id && (
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  const err = resultError(await loadTasks({ job_id: job.id }));
                  if (err) setNote({ ok: false, text: err });
                  else reload();
                }}
              >
                Make the tasks from the estimate
              </button>
            )}
          </>
        )}
        {split.tasks.length > 0 && (
          <table className="by-month">
            <thead>
              <tr>
                <th>Task</th>
                <th>Task time</th>
                <th>Shared overhead</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {split.tasks.map((t) => {
                const task = time.tasks.find((x) => x.id === t.task_id)!;
                return (
                  <tr key={t.task_id}>
                    <td>
                      {task.name} <span className="muted small-note">{task.quantity} {task.unit}</span>
                    </td>
                    <td>{hm(t.direct)}</td>
                    <td>{hm(t.overhead)}</td>
                    <td>
                      <strong>{hm(t.total)}</strong>
                    </td>
                    <td>
                      {role !== 'tech' && t.total === 0 && (
                        <button
                          type="button"
                          className="link"
                          onClick={async () => {
                            const err = resultError(await removeTask({ task_id: t.task_id }));
                            if (err) setNote({ ok: false, text: err });
                            else reload();
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="row">
          <input className="grow" placeholder="Add a task, e.g. Gutter clean out" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input inputMode="decimal" aria-label="Quantity" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} style={{ maxWidth: 80 }} />
          <input aria-label="Unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} style={{ maxWidth: 80 }} />
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const err = resultError(await addTask({ job_id: job.id, name: draft.name, quantity: Number(draft.quantity) || 1, unit: draft.unit || 'each', price_book_item_id: null }));
              if (err) setNote({ ok: false, text: err });
              else {
                setDraft({ name: '', quantity: '1', unit: 'each' });
                reload();
              }
            }}
          >
            Add
          </button>
        </div>
        <dl className="totals">
          <dt>Task time (timed directly)</dt>
          <dd>{hm(split.direct_minutes)}</dd>
          <dt>Job overhead (customer, cleanup, between tasks)</dt>
          <dd>{hm(split.overhead_minutes)}</dd>
          <dt>
            <strong>Total on the job</strong>
          </dt>
          <dd>
            <strong>{hm(split.job_minutes)}</strong>
          </dd>
        </dl>
        {split.unassigned_minutes > 0 && <p className="muted small-note">{hm(split.unassigned_minutes)} of overhead could not go to a task because the job has none.</p>}
      </div>

      {split.techs.length === 0 && (
        <div className="card">
          <p className="muted">Nobody has tracked time on this job yet.</p>
        </div>
      )}
      {split.techs.map((tech) => (
        <div key={tech.user_id} className="card" style={{ opacity: canEdit(tech.user_id) ? 1 : 0.85 }}>
          <h2>
            {nameOf(tech.user_id)}
            {tech.user_id === userId ? ' (you)' : ''}
          </h2>
          <p className="muted">
            {hm(tech.job_minutes)} on the job: {hm(tech.task_minutes)} on tasks and {hm(tech.overhead_minutes)} overhead
            {!canEdit(tech.user_id) && ' · you can see this time but only they can change it'}
          </p>
          <h3>Job time</h3>
          {time.entries
            .filter((e) => e.user_id === tech.user_id)
            .sort((a, b) => a.clock_in.localeCompare(b.clock_in))
            .map((e) => (
              <Punch key={e.id} entity="job" rowId={e.id} owner={e.user_id} start={e.clock_in} end={e.clock_out} />
            ))}
          {time.timers.some((t) => t.user_id === tech.user_id) && <h3>Task time</h3>}
          {time.timers
            .filter((t) => t.user_id === tech.user_id)
            .sort((a, b) => a.started_at.localeCompare(b.started_at))
            .map((t) => (
              <div key={t.id}>
                <span className="muted small-note">{taskName(t.task_id)}</span>
                <Punch entity="task" rowId={t.id} owner={t.user_id} start={t.started_at} end={t.ended_at} />
              </div>
            ))}
        </div>
      ))}

      <div className="card">
        <h2>Job location</h2>
        <p className="muted small-note">For arrival reminders on techs' phones (only for techs who agreed to them). Stand at the job and tap the button, or ask the office to do it.</p>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            navigator.geolocation.getCurrentPosition(
              async (p) => {
                const err = resultError(await setSite({ job_id: job.id, lat: p.coords.latitude, lng: p.coords.longitude, radius_m: 150 }));
                setNote(err ? { ok: false, text: err } : { ok: true, text: 'Job location saved.' });
              },
              () => setNote({ ok: false, text: 'Could not get your location. Allow location for this site, then try again.' }),
              { enableHighAccuracy: true, timeout: 15000 },
            )
          }
        >
          Set this job's location to where I am now
        </button>
      </div>
    </section>
  );
}
