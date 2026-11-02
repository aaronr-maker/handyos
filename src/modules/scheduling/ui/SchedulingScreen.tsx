import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fromDateTimeLocal, listTeamMembers, resultError, toDateTimeLocal, useAction, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { listAssignments, listJobs, type Job } from '@/modules/jobs';
import { rescheduleJobAction } from '../actions';

const DAY = 86_400_000;
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export default function SchedulingScreen() {
  const { companyId } = useSession();
  const reschedule = useAction(rescheduleJobAction);
  const { data, loading, error, reload } = useAsync(
    async () => ({
      jobs: await listJobs(companyId),
      assignments: await listAssignments(companyId),
      customers: await listCustomers(companyId),
      team: await listTeamMembers(),
    }),
    [companyId],
  );
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [who, setWho] = useState('');
  const [picking, setPicking] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const nameOf = (id: string) => {
    const m = data?.team.find((x) => x.id === id);
    return m ? m.full_name || m.email || 'Team member' : 'Team member';
  };
  const customer = (id: string) => {
    const c = data?.customers.find((x) => x.id === id);
    return c ? customerLabel(c) : '';
  };
  const crew = (jobId: string) => (data?.assignments ?? []).filter((a) => a.job_id === jobId).map((a) => a.user_id);
  const visible = (j: Job) => !who || crew(j.id).includes(who);

  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY));
  const scheduled = (data?.jobs ?? []).filter((j) => j.scheduled_start && j.status !== 'completed' && visible(j));
  const unscheduled = (data?.jobs ?? []).filter((j) => !j.scheduled_start && j.status !== 'completed' && visible(j));
  const today = new Date();

  const move = async (job: Job) => {
    const start = fromDateTimeLocal(picking[job.id] ?? '');
    if (!start) return setProblem('Pick a date and time first.');
    const message = resultError(await reschedule({ job_id: job.id, start }));
    setProblem(message);
    if (!message) {
      setPicking({ ...picking, [job.id]: '' });
      reload();
    }
  };

  const picker = (job: Job, label: string) => (
    <div className="row small">
      <input
        type="datetime-local"
        value={picking[job.id] ?? toDateTimeLocal(job.scheduled_start)}
        onChange={(e) => setPicking({ ...picking, [job.id]: e.target.value })}
      />
      <button className="secondary" onClick={() => void move(job)}>
        {label}
      </button>
    </div>
  );

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Schedule</h1>
          <p className="muted">
            Week of {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link to="/jobs/new" className="button push-right">
          New job
        </Link>
      </header>

      <div className="row">
        <button className="secondary" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))}>
          ← Previous
        </button>
        <button className="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          This week
        </button>
        <button className="secondary" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))}>
          Next →
        </button>
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {(data?.team ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name || m.email}
            </option>
          ))}
        </select>
      </div>

      {(error || problem) && <p className="err">{error ?? problem}</p>}
      {loading && <p className="muted">Loading…</p>}

      <div className="week">
        {days.map((d) => {
          const jobs = scheduled.filter((j) => sameDay(new Date(j.scheduled_start!), d)).sort((a, b) => a.scheduled_start!.localeCompare(b.scheduled_start!));
          return (
            <div key={d.toISOString()} className={`day card ${sameDay(d, today) ? 'today' : ''}`}>
              <h3>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</h3>
              {jobs.length === 0 && <p className="muted">Nothing scheduled</p>}
              {jobs.map((j) => (
                <div key={j.id} className="slot">
                  <strong>
                    {time(j.scheduled_start!)}
                    {j.scheduled_end && ` – ${time(j.scheduled_end)}`}
                  </strong>
                  <Link to={`/jobs/${j.id}`}>
                    #{j.job_number} {j.title}
                  </Link>
                  <span className="muted">{[customer(j.customer_id), crew(j.id).map(nameOf).join(', ')].filter(Boolean).join(' · ')}</span>
                  {picker(j, 'Move')}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Needs a date ({unscheduled.length})</h2>
        {unscheduled.length === 0 && <p className="muted">Everything is scheduled.</p>}
        {unscheduled.map((j) => (
          <div key={j.id} className="slot">
            <Link to={`/jobs/${j.id}`}>
              <strong>
                #{j.job_number} {j.title}
              </strong>
            </Link>
            <span className="muted">{[customer(j.customer_id), crew(j.id).map(nameOf).join(', ')].filter(Boolean).join(' · ')}</span>
            {picker(j, 'Schedule')}
          </div>
        ))}
        {scheduled.length === 0 && unscheduled.length === 0 && !loading && <p className="muted">No open jobs yet.</p>}
      </div>
    </section>
  );
}
