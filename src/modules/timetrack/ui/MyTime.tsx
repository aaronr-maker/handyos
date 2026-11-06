import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resultError, useAction, useAsync, useSession } from '@/core';
import { clockInAction, clockOutAction, getOpenEntry, listAssignments, listJobs } from '@/modules/jobs';
import { setGeofenceConsentAction, shiftInAction, shiftOutAction, startTaskAction, stopTaskAction } from '../actions';
import { getConsent, hasConsented, listSites, listTasks, openShift, openTimer } from '../service';
import { clock } from './fmt';
import { useArrival } from './useArrival';

/** A tech's day: clock in for the day, start the job (or get reminded on arrival), time the tasks, stop. */
export default function MyTime() {
  const { companyId, user } = useSession();
  const shiftIn = useAction(shiftInAction);
  const shiftOut = useAction(shiftOutAction);
  const jobIn = useAction(clockInAction);
  const jobOut = useAction(clockOutAction);
  const startTask = useAction(startTaskAction);
  const stopTask = useAction(stopTaskAction);
  const setConsent = useAction(setGeofenceConsentAction);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [shift, entry, timer, consent, sites, assignments, jobs] = await Promise.all([openShift(companyId, user.id), getOpenEntry(companyId, user.id), openTimer(companyId, user.id), getConsent(companyId, user.id), listSites(companyId), listAssignments(companyId), listJobs(companyId)]);
    const mine = new Set(assignments.filter((a) => a.user_id === user.id).map((a) => a.job_id));
    const tasks = entry ? await listTasks(companyId, entry.job_id) : [];
    return { shift, entry, timer, consent, sites, jobs: jobs.filter((j) => mine.has(j.id) && j.status !== 'completed'), allJobs: jobs, tasks };
  }, [companyId, user.id]);

  const consented = hasConsented(data?.consent ?? null);
  const mySites = (data?.sites ?? []).filter((s) => data?.jobs.some((j) => j.id === s.job_id)).map((s) => ({ ...s, skip: !!data?.entry }));
  const arrival = useArrival(consented && !data?.entry, mySites);

  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load your time.'}</p>;
  const { shift, entry, timer, tasks } = data;
  const job = entry ? data.allJobs.find((j) => j.id === entry.job_id) : null;
  const arrived = arrival.jobId ? data.jobs.find((j) => j.id === arrival.jobId) : null;

  const run = async (p: Promise<Parameters<typeof resultError>[0]>) => {
    setNote(null);
    const err = resultError(await p);
    if (err) setNote({ ok: false, text: err });
    reload();
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>My time</h1>
          <p className="muted">Clock in for the day, time your jobs, and time the tasks on them.</p>
        </div>
      </header>
      {note && <p className={note.ok ? 'notice' : 'err'}>{note.text}</p>}

      <div className="card">
        <h2>Today</h2>
        {shift ? (
          <>
            <p>
              Clocked in for the day since <strong>{clock(shift.clock_in)}</strong>.
            </p>
            <button type="button" className="secondary" disabled={!!entry} onClick={() => void run(shiftOut({}))}>
              Clock out for the day
            </button>
            {entry && <p className="muted small-note">Stop your job time first.</p>}
          </>
        ) : (
          <button type="button" onClick={() => void run(shiftIn({}))}>
            Clock in for the day
          </button>
        )}
      </div>

      {arrived && !entry && (
        <div className="card">
          <p>
            <strong>You're at {arrived.title}.</strong> Start your time on this job?
          </p>
          <button
            type="button"
            onClick={async () => {
              if (!shift) await shiftIn({});
              await run(jobIn({ job_id: arrived.id }));
            }}
          >
            Start job time
          </button>
        </div>
      )}
      {arrival.problem && <p className="err">{arrival.problem}</p>}

      {entry && job ? (
        <div className="card">
          <h2>
            <Link to={`/time/job/${job.id}`}>{job.title}</Link>
          </h2>
          <p className="muted">On this job since {clock(entry.clock_in)}. Anything not on a task counts as job overhead (the customer, cleanup) and is shared evenly across the tasks.</p>
          {tasks.length > 1 && !timer && (
            <p className="notice">This job has {tasks.length} tasks. Start the one you're working on so its time is counted.</p>
          )}
          {tasks.length === 0 && (
            <p className="muted small-note">
              No tasks on this job yet. <Link to={`/time/job/${job.id}`}>Add or load them</Link>.
            </p>
          )}
          <div className="list">
            {tasks.map((t) => {
              const on = timer?.task_id === t.id;
              return (
                <div key={t.id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    <strong>{t.name}</strong> <span className="muted small-note">{t.quantity} {t.unit}</span>
                  </span>
                  {on ? (
                    <button type="button" className="secondary" onClick={() => void run(stopTask({}))}>
                      Stop task
                    </button>
                  ) : (
                    <button type="button" onClick={() => void run(startTask({ task_id: t.id }))}>
                      Start task
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="secondary" onClick={() => void run(jobOut({ note: null }))}>
            Stop job time
          </button>
          <p className="muted small-note">Stopping the job also stops the task timer.</p>
        </div>
      ) : (
        <div className="card">
          <h2>Start a job</h2>
          {data.jobs.length === 0 ? (
            <p className="muted">No jobs are assigned to you right now.</p>
          ) : (
            <div className="list">
              {data.jobs.map((j) => (
                <div key={j.id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    <strong>{j.title}</strong>
                    <span className="muted small-note"> #{j.job_number}</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!shift) await shiftIn({});
                      await run(jobIn({ job_id: j.id }));
                    }}
                  >
                    Start job time
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Arrival reminders</h2>
        <p className="muted">
          If you agree, the app uses your phone's location to remind you to start job time when you arrive at a job you are assigned to. It does not look at your location any other time, and it only uses jobs that have a location set. You can turn it off whenever you like.
          Reminders while the app is closed need the phone app, set up on your phone.
        </p>
        <label className="row" style={{ alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => {
              if (e.target.checked && 'geolocation' in navigator) navigator.geolocation.getCurrentPosition(() => undefined, () => undefined); // asks the phone for permission
              void run(setConsent({ consent: e.target.checked }));
            }}
          />
          <span>I agree to location-based reminders on my phone</span>
        </label>
      </div>
    </section>
  );
}
