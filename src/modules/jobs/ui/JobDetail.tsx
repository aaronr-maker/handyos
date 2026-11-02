import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDateTime, formatDuration, fromDateTimeLocal, resultError, toDateTimeLocal, useAction, useAsync, useRuntime, useSession } from '@/core';
import { customerLabel, getCustomer, getProperty } from '@/modules/customers';
import { assignJobAction, clockInAction, clockOutAction, completeJobAction, updateJobAction } from '../actions';
import { getJob, getOpenEntry, listAssignments, listTimeEntries } from '../services/jobService';
import { statusClass, statusLabel } from './status';
import { useTeam } from './useTeam';

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export default function JobDetail() {
  const { id = '' } = useParams();
  const { companyId, user, role } = useSession();
  const { actions } = useRuntime();
  const { members, nameOf } = useTeam();
  const update = useAction(updateJobAction);
  const assign = useAction(assignJobAction);
  const complete = useAction(completeJobAction);
  const clockIn = useAction(clockInAction);
  const clockOut = useAction(clockOutAction);

  const { data, loading, error, reload } = useAsync(async () => {
    const job = await getJob(companyId, id);
    if (!job) return null;
    const [billTo, owedBy, property, assignments, entries, mine] = await Promise.all([
      getCustomer(companyId, job.customer_id),
      job.owed_by_customer_id ? getCustomer(companyId, job.owed_by_customer_id) : undefined,
      job.property_id ? getProperty(companyId, job.property_id) : undefined,
      listAssignments(companyId),
      listTimeEntries(companyId),
      getOpenEntry(companyId, user.id),
    ]);
    return { job, billTo, owedBy, property, assigned: assignments.filter((a) => a.job_id === id).map((a) => a.user_id), entries: entries.filter((e) => e.job_id === id), mine };
  }, [companyId, id, user.id]);

  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
  const now = useNow(Boolean(data?.mine));

  if (loading) return <p className="muted">Loading…</p>;
  if (!data) {
    return (
      <section className="page">
        <Link to="/jobs">← Jobs</Link>
        <p className="err">{error ?? 'Job not found.'}</p>
      </section>
    );
  }
  const { job, billTo, owedBy, property, assigned, entries, mine } = data;
  const done = job.status === 'completed';
  const act = async (run: () => Promise<Parameters<typeof resultError>[0]>) => {
    const message = resultError(await run());
    setProblem(message);
    if (!message) reload();
    return message;
  };
  const minutesOf = (e: { clock_in: string; clock_out: string | null }) =>
    Math.max(0, Math.round(((e.clock_out ? Date.parse(e.clock_out) : now) - Date.parse(e.clock_in)) / 60000));
  const totalMinutes = entries.reduce((n, e) => n + minutesOf(e), 0);
  const onThisJob = mine?.job_id === job.id;

  return (
    <section className="page">
      <Link to="/jobs" className="muted">
        ← Jobs
      </Link>
      <header className="page-header">
        <div>
          <h1>
            #{job.job_number} · {job.title}
          </h1>
          <p>
            <span className={statusClass[job.status]}>{statusLabel[job.status]}</span>
          </p>
        </div>
        {!editing && !done && (
          <button
            className="secondary push-right"
            onClick={() => {
              setTitle(job.title);
              setNotes(job.notes ?? '');
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </header>
      {problem && <p className="err">{problem}</p>}

      {editing ? (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!(await act(() => update({ job_id: job.id, title, notes: notes.trim() || null })))) setEditing(false);
          }}
        >
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Notes
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="card">
          <p>
            <span className="muted">Billed to: </span>
            {billTo ? <Link to={`/customers/${billTo.id}`}>{customerLabel(billTo)}</Link> : 'Unknown'}
            {owedBy && owedBy.id !== billTo?.id && (
              <>
                <br />
                <span className="muted">Owed by: </span>
                <Link to={`/customers/${owedBy.id}`}>{customerLabel(owedBy)}</Link>
              </>
            )}
          </p>
          {property && (
            <p>
              <span className="muted">Property: </span>
              {[property.address_line1, property.city, property.state].filter(Boolean).join(', ')}
            </p>
          )}
          {job.notes && <p className="notes">{job.notes}</p>}
          {job.estimate_id && (
            <p>
              <Link to={`/estimates/${job.estimate_id}`}>See the estimate</Link>
            </p>
          )}
        </div>
      )}

      {!done && (
        <div className="card">
          <h2>Time clock</h2>
          {onThisJob ? (
            <>
              <p>
                Clocked in since {formatDateTime(mine!.clock_in)} · <strong>{formatDuration(minutesOf(mine!))}</strong>
              </p>
              <label>
                Note <span className="muted">(optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What got done" />
              </label>
              <button
                onClick={async () => {
                  if (!(await act(() => clockOut({ note: note.trim() || null })))) setNote('');
                }}
              >
                Clock out
              </button>
            </>
          ) : mine ? (
            <p className="muted">You're clocked in to another job. Clock out of it first.</p>
          ) : (
            <button onClick={() => void act(() => clockIn({ job_id: job.id }))}>Clock in</button>
          )}
        </div>
      )}

      <div className="card">
        <h2>Schedule</h2>
        <p>{job.scheduled_start ? `${formatDateTime(job.scheduled_start)}${job.scheduled_end ? ` to ${formatDateTime(job.scheduled_end)}` : ''}` : <span className="muted">Not scheduled yet</span>}</p>
        {!done && (
          <>
            <div className="row">
              <label className="grow">
                Start
                <input type="datetime-local" value={start || toDateTimeLocal(job.scheduled_start)} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="grow">
                End <span className="muted">(optional)</span>
                <input type="datetime-local" value={end || toDateTimeLocal(job.scheduled_end)} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <button
              className="secondary"
              disabled={!(start || job.scheduled_start)}
              onClick={async () => {
                const s = fromDateTimeLocal(start || toDateTimeLocal(job.scheduled_start));
                if (!s) return;
                // scheduling is another module's job: call its action by name
                const res = await actions.executeByName('scheduling.reschedule_job', { job_id: job.id, start: s, end: end ? fromDateTimeLocal(end) : undefined }, { companyId, actor: user, role });
                const message = resultError(res);
                setProblem(message);
                if (!message) {
                  setStart('');
                  setEnd('');
                  reload();
                }
              }}
            >
              {job.scheduled_start ? 'Reschedule' : 'Schedule'}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2>Crew</h2>
        {members.map((m) => (
          <label key={m.id} className="check">
            <input
              type="checkbox"
              checked={assigned.includes(m.id)}
              disabled={done}
              onChange={(e) => void act(() => assign({ job_id: job.id, user_ids: e.target.checked ? [...assigned, m.id] : assigned.filter((x) => x !== m.id) }))}
            />
            {m.full_name || m.email}
          </label>
        ))}
      </div>

      <div className="card">
        <h2>Time on this job {entries.length > 0 && <span className="muted">· {formatDuration(totalMinutes)} total</span>}</h2>
        {entries.length === 0 && <p className="muted">Nobody has clocked in yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="contact-row">
            <div>
              <strong>{nameOf(e.user_id)}</strong>
              <div className="muted">
                {formatDateTime(e.clock_in)} {e.clock_out ? `to ${formatDateTime(e.clock_out)}` : '· still working'}
                {e.note && ` · ${e.note}`}
              </div>
            </div>
            <div>{formatDuration(minutesOf(e))}</div>
          </div>
        ))}
      </div>

      {!done && (
        <button
          onClick={() => confirm('Mark this job completed? Anyone still clocked in will be clocked out.') && void act(() => complete({ job_id: job.id }))}
        >
          Mark job completed
        </button>
      )}
      {done && <p className="notice">Completed {formatDateTime(job.completed_at)}.</p>}
    </section>
  );
}
