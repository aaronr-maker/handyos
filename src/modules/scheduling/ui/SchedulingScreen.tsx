import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { fromDateTimeLocal, listTeamMembers, resultError, toDateTimeLocal, useAction, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { assignJobAction, type Job } from '@/modules/jobs';
import { efficiencyFor, loadTimeFacts } from '@/modules/timesheets';
import { addCalendarEventAction, removeCalendarEventAction, rescheduleJobAction } from '../actions';
import { KIND_LABEL, listCalendarEvents } from '../events';
import type { CalendarEvent } from '../types';
import { dayCapacity, hoursText, WORKDAY_MINUTES } from '../capacity';

const DAY = 86_400_000;
const FIRST_HOUR = 6;
const LAST_HOUR = 20;
const HOUR_PX = 44;
const DEFAULT_MIN = 120;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const UNASSIGNED = '';

interface Drag {
  jobId: string;
  from: string | null; // the column it was picked up from; null from the "needs a date" tray
}

/** Gives overlapping jobs in one column their own side-by-side lanes. */
function lanes(jobs: Job[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  const ends: number[] = [];
  for (const j of [...jobs].sort((a, b) => a.scheduled_start!.localeCompare(b.scheduled_start!))) {
    const s = Date.parse(j.scheduled_start!);
    let l = ends.findIndex((e) => e <= s);
    if (l < 0) l = ends.length;
    ends[l] = Date.parse(j.scheduled_end ?? j.scheduled_start!) || s + DEFAULT_MIN * 60000;
    out.set(j.id, { lane: l, of: 1 });
  }
  for (const v of out.values()) v.of = Math.max(1, ends.length);
  return out;
}

/**
 * The week as a picture: days across, hours down, and inside each day a column for unassigned jobs and one for each technician.
 * Drag a job onto a technician to give it to them (and to the time you drop it at). Each technician's day shows how full it is,
 * allowing for how long their jobs usually really take, and how much more work fits.
 */
export default function SchedulingScreen() {
  const { companyId, role, user } = useSession();
  const reschedule = useAction(rescheduleJobAction);
  const addEvent = useAction(addCalendarEventAction);
  const removeEvent = useAction(removeCalendarEventAction);
  const assign = useAction(assignJobAction);
  const { data, loading, error, reload } = useAsync(
    async () => ({ facts: await loadTimeFacts(companyId), customers: await listCustomers(companyId), team: await listTeamMembers(), events: await listCalendarEvents(companyId) }),
    [companyId],
  );
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [problem, setProblem] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [picking, setPicking] = useState('');
  const [now] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ who: '', kind: 'time_off' as CalendarEvent['kind'], title: '', allDay: true, from: '', to: '' });
  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const jobs = (data?.facts.jobs ?? []).filter((j) => j.status !== 'completed');
  const crewOf = (jobId: string) => (data?.facts.assignments ?? []).filter((a) => a.job_id === jobId).map((a) => a.user_id);
  const nameOf = (id: string) => {
    const m = data?.team.find((x) => x.id === id);
    return m ? m.full_name || m.email || 'Team member' : 'Team member';
  };
  const customer = (id: string) => {
    const c = data?.customers.find((x) => x.id === id);
    return c ? customerLabel(c) : '';
  };

  const events = data?.events ?? [];
  const boss = role === 'owner' || role === 'admin' || role === 'office';
  /** The part of an entry that falls on one day, as minutes from midnight (clipped to that day). */
  const eventOn = (e: CalendarEvent, d: Date) => {
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const a = Math.max(Date.parse(e.starts_at), from);
    const b = Math.min(Date.parse(e.ends_at), from + DAY);
    return b > a ? { startMin: Math.round((a - from) / 60000), endMin: Math.round((b - from) / 60000) } : null;
  };
  const eventLabel = (e: CalendarEvent) => (boss || e.user_id === user.id ? e.title || KIND_LABEL[e.kind] : KIND_LABEL[e.kind]);
  const saveEvent = async () => {
    const who = form.who || user.id;
    const start = form.allDay ? new Date(`${form.from.slice(0, 10)}T00:00:00`) : new Date(form.from);
    const end = form.allDay ? new Date(`${(form.to || form.from).slice(0, 10)}T23:59:00`) : new Date(form.to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return setProblem('Pick when it starts and ends.');
    const message = resultError(await addEvent({ user_id: who, kind: form.kind, title: form.title.trim() || null, starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: form.allDay }));
    setProblem(message);
    if (!message) {
      setAdding(false);
      setForm({ ...form, title: '', from: '', to: '' });
      reload();
    }
  };

  // the days on screen: one day, a week, or the six weeks that make up a month grid
  const monthFirst = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const rangeStart = view === 'day' ? anchor : view === 'week' ? startOfWeek(anchor) : startOfWeek(monthFirst);
  const rangeDays = view === 'day' ? 1 : view === 'week' ? 7 : 42;
  const days = Array.from({ length: rangeDays }, (_, i) => new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + i));
  const scheduled = jobs.filter((j) => j.scheduled_start);
  const unscheduled = jobs.filter((j) => !j.scheduled_start);
  const weekJobs = scheduled.filter((j) => Date.parse(j.scheduled_start!) >= days[0].getTime() && Date.parse(j.scheduled_start!) < days[days.length - 1].getTime() + DAY);
  // columns: every technician, plus anybody who has work this week
  const rangeEnd = days[days.length - 1].getTime() + DAY;
  const people = (data?.team ?? []).filter(
    (m) =>
      m.role === 'tech' ||
      weekJobs.some((j) => crewOf(j.id).includes(m.id)) ||
      events.some((e) => e.user_id === m.id && Date.parse(e.starts_at) < rangeEnd && Date.parse(e.ends_at) > days[0].getTime()),
  );
  const columns = [UNASSIGNED, ...people.map((p) => p.id)];
  const rates = Object.fromEntries(people.map((p) => [p.id, data ? efficiencyFor(data.facts, p.id, now) : { rate: 1, jobs: 0, defaulted: true }]));
  const today = new Date(now);

  const inColumn = (col: string, d: Date) => scheduled.filter((j) => sameDay(new Date(j.scheduled_start!), d) && (col === UNASSIGNED ? crewOf(j.id).length === 0 : crewOf(j.id).includes(col)));

  const durationMin = (j: Job) => (j.scheduled_start && j.scheduled_end ? Math.max(15, Math.round((Date.parse(j.scheduled_end) - Date.parse(j.scheduled_start)) / 60000)) : DEFAULT_MIN);

  const drop = async (e: DragEvent<HTMLDivElement>, col: string, d: Date) => {
    e.preventDefault();
    setOver(null);
    const dragged = drag;
    setDrag(null);
    const job = jobs.find((j) => j.id === dragged?.jobId);
    if (!dragged || !job) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.min(LAST_HOUR * 60 - 30, Math.max(FIRST_HOUR * 60, FIRST_HOUR * 60 + Math.round((((e.clientY - rect.top) / HOUR_PX) * 60) / 30) * 30));
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes);
    const end = new Date(start.getTime() + durationMin(job) * 60000);
    const crew = crewOf(job.id).filter((id) => id !== dragged.from);
    const next = col === UNASSIGNED ? crew : [...new Set([...crew, col])];
    setProblem(null);
    const sameCrew = next.length === crewOf(job.id).length && next.every((id) => crewOf(job.id).includes(id));
    if (!sameCrew) {
      const a = resultError(await assign({ job_id: job.id, user_ids: next }));
      if (a) return setProblem(a);
    }
    const r = resultError(await reschedule({ job_id: job.id, start: start.toISOString(), end: end.toISOString() }));
    if (r) setProblem(r);
    reload();
  };

  const moveByPicker = async (job: Job) => {
    const start = fromDateTimeLocal(picking);
    if (!start) return setProblem('Pick a date and time first.');
    const end = new Date(Date.parse(start) + durationMin(job) * 60000).toISOString();
    const message = resultError(await reschedule({ job_id: job.id, start, end }));
    setProblem(message);
    if (!message) {
      setOpenJob(null);
      reload();
    }
  };
  const setCrew = async (job: Job, id: string) => {
    const message = resultError(await assign({ job_id: job.id, user_ids: id ? [id] : [] }));
    setProblem(message);
    if (!message) reload();
  };

  const card = (j: Job, col: string | null, lane?: { lane: number; of: number }) => {
    const style =
      lane && j.scheduled_start
        ? (() => {
            const s = new Date(j.scheduled_start);
            const top = Math.max(0, ((s.getHours() * 60 + s.getMinutes() - FIRST_HOUR * 60) / 60) * HOUR_PX);
            const height = Math.max(26, (durationMin(j) / 60) * HOUR_PX - 2);
            return { top, height, left: `${(lane.lane / lane.of) * 100}%`, width: `${100 / lane.of}%` };
          })()
        : undefined;
    return (
      <div
        key={`${j.id}-${col}`}
        className={`wk-job ${col === null ? 'wk-tray' : ''} ${openJob === j.id ? 'wk-open' : ''}`}
        style={style}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', j.id);
          e.dataTransfer.effectAllowed = 'move';
          setDrag({ jobId: j.id, from: col });
        }}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        onClick={() => {
          setOpenJob(openJob === j.id ? null : j.id);
          setPicking(toDateTimeLocal(j.scheduled_start));
        }}
        title={`#${j.job_number} ${j.title}`}
      >
        {j.scheduled_start && <strong>{time(j.scheduled_start)}</strong>} #{j.job_number} {j.title}
        <span className="muted">{customer(j.customer_id)}</span>
      </div>
    );
  };

  const step = (n: number) =>
    setAnchor(
      view === 'day'
        ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + n)
        : view === 'week'
          ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * n)
          : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1),
    );
  const title =
    view === 'day'
      ? anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : view === 'week'
        ? `Week of ${startOfWeek(anchor).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
        : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const selected = jobs.find((j) => j.id === openJob);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Schedule</h1>
          <p className="muted">
            {title}. {view === 'month' ? 'Click a day to open it.' : 'Drag a job onto a technician to assign it.'}
          </p>
        </div>
        <div className="row push-right">
          <button type="button" className="secondary" onClick={() => setAdding(!adding)}>
            + Time off / appointment
          </button>
          <Link to="/jobs/new" className="button">
            New job
          </Link>
        </div>
      </header>

      <div className="row" style={{ alignItems: 'center' }}>
        <div className="seg" role="group" aria-label="View">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button key={v} className={view === v ? '' : 'secondary'} onClick={() => setView(v)}>
              {v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        <button className="secondary" onClick={() => step(-1)}>
          ← Previous
        </button>
        <button className="secondary" onClick={() => setAnchor(startOfDay(new Date()))}>
          Today
        </button>
        <button className="secondary" onClick={() => step(1)}>
          Next →
        </button>
      </div>

      {(error || problem) && <p className="err">{error ?? problem}</p>}
      {loading && <p className="muted">Loading…</p>}

      {adding && (
        <div className="card" style={{ margin: '10px 0' }}>
          <h2>Time off or an appointment</h2>
          <p className="muted small-note">It goes on the calendar and nothing else can be scheduled over it, including estimates the phone assistant books.</p>
          <div className="row">
            {boss && (
              <label className="grow">
                Whose calendar
                <select value={form.who || user.id} onChange={(e) => setForm({ ...form, who: e.target.value })}>
                  {(data?.team ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grow">
              What it is
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CalendarEvent['kind'] })}>
                <option value="time_off">Time off</option>
                <option value="appointment">Personal appointment</option>
                <option value="other">Other (busy)</option>
              </select>
            </label>
            <label className="grow">
              Note (optional)
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Dentist" />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked, from: '', to: '' })} />
            All day (or several days)
          </label>
          <div className="row">
            <label className="grow">
              {form.allDay ? 'First day' : 'Starts'}
              <input type={form.allDay ? 'date' : 'datetime-local'} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </label>
            <label className="grow">
              {form.allDay ? 'Last day (leave empty for one day)' : 'Ends'}
              <input type={form.allDay ? 'date' : 'datetime-local'} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <button type="button" onClick={() => void saveEvent()}>
              Put it on the calendar
            </button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ margin: '10px 0' }}>
        <strong>Needs a date ({unscheduled.length})</strong> <span className="muted">Drag one into the week.</span>
        <div className="wk-trayrow">
          {unscheduled.length === 0 && <span className="muted">Everything is scheduled.</span>}
          {unscheduled.map((j) => card(j, null))}
        </div>
      </div>

      {selected && (
        <div className="card" style={{ marginBottom: 10 }}>
          <strong>
            <Link to={`/jobs/${selected.id}`}>
              #{selected.job_number} {selected.title}
            </Link>
          </strong>{' '}
          <span className="muted">{customer(selected.customer_id)}</span>
          <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
            <select value={crewOf(selected.id)[0] ?? ''} onChange={(e) => void setCrew(selected, e.target.value)}>
              <option value="">Unassigned</option>
              {(data?.team ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name || m.email}
                </option>
              ))}
            </select>
            <input type="datetime-local" value={picking} onChange={(e) => setPicking(e.target.value)} />
            <button className="secondary" onClick={() => void moveByPicker(selected)}>
              {selected.scheduled_start ? 'Move' : 'Schedule'}
            </button>
          </div>
        </div>
      )}

      {view === 'month' && (
        <div className="mo">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="mo-head">
              {d}
            </div>
          ))}
          {days.map((d) => {
            const list = scheduled.filter((j) => sameDay(new Date(j.scheduled_start!), d));
            const unassigned = list.filter((j) => crewOf(j.id).length === 0).length;
            const bookedMin = list.reduce((n, j) => n + durationMin(j), 0);
            return (
              <button
                key={d.toISOString()}
                className={`mo-day ${d.getMonth() !== anchor.getMonth() ? 'mo-out' : ''} ${sameDay(d, today) ? 'mo-today' : ''}`}
                onClick={() => {
                  setAnchor(startOfDay(d));
                  setView('day');
                }}
              >
                <span className="mo-num">{d.getDate()}</span>
                {list.length > 0 && (
                  <span className="mo-info">
                    {list.length} job{list.length === 1 ? '' : 's'} · {hoursText(bookedMin)}
                  </span>
                )}
                {unassigned > 0 && <span className="pill medium">{unassigned} unassigned</span>}
                {events.some((e) => eventOn(e, d)) && <span className="pill">{new Set(events.filter((e) => eventOn(e, d)).map((e) => e.user_id)).size} away</span>}
                <span className="mo-bars">
                  {people.map((p) => {
                    const cap = dayCapacity(
                      list.filter((j) => crewOf(j.id).includes(p.id)).map((j) => ({ start: j.scheduled_start!, end: j.scheduled_end })),
                      rates[p.id]?.rate ?? 1,
                    );
                    const pct = Math.min(100, Math.round((cap.expectedMin / WORKDAY_MINUTES) * 100));
                    return cap.bookedMin === 0 ? null : (
                      <span key={p.id} className="mo-bar" title={`${nameOf(p.id)}: ${cap.over ? 'full' : `room ${hoursText(cap.roomMin)}`}`}>
                        <span className={cap.over ? 'wk-fill over' : pct > 85 ? 'wk-fill warn' : 'wk-fill'} style={{ width: `${pct}%` }} />
                      </span>
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {view !== 'month' && (
        <div className={`wk-scroll ${view === 'day' ? 'wk-single' : ''}`}>
          <div className="wk">
            <div className="wk-axis">
              <div className="wk-dayname">&nbsp;</div>
              <div className="wk-head" />
              {hours.map((h) => (
                <div key={h} className="wk-hour" style={{ height: HOUR_PX }}>
                  {new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })}
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d.toISOString()} className={`wk-day ${sameDay(d, today) ? 'wk-today' : ''}`}>
                <div className="wk-dayname">{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <div className="wk-cols">
                  {columns.map((col) => {
                    const list = inColumn(col, d);
                    const cap =
                      col === UNASSIGNED
                        ? null
                        : dayCapacity(
                            list.map((j) => ({ start: j.scheduled_start!, end: j.scheduled_end })),
                            rates[col]?.rate ?? 1,
                          );
                    const pct = cap ? Math.min(100, Math.round((cap.expectedMin / WORKDAY_MINUTES) * 100)) : 0;
                    const key = `${col}|${d.toDateString()}`;
                    const lane = lanes(list);
                    return (
                      <div key={col} className="wk-col">
                        <div
                          className="wk-head"
                          title={
                            cap
                              ? `Jobs usually take ${Math.round((rates[col]?.rate ?? 1) * 100)}% of the booked time${rates[col]?.defaulted ? ' (not enough finished jobs yet to know, so 100%)' : ''}.`
                              : 'Jobs nobody has been given yet'
                          }
                        >
                          <strong>{col === UNASSIGNED ? 'Unassigned' : nameOf(col).split(' ')[0]}</strong>
                          {cap && (
                            <>
                              <div className="wk-bar">
                                <div className={cap.over ? 'wk-fill over' : pct > 85 ? 'wk-fill warn' : 'wk-fill'} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="wk-cap">{cap.over ? `over by ${hoursText(cap.expectedMin - WORKDAY_MINUTES)}` : `room ${hoursText(cap.roomMin)}`}</span>
                            </>
                          )}
                        </div>
                        <div
                          className={`wk-body ${over === key ? 'wk-over' : ''}`}
                          style={{ height: hours.length * HOUR_PX }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (over !== key) setOver(key);
                          }}
                          onDragLeave={() => setOver((o) => (o === key ? null : o))}
                          onDrop={(e) => void drop(e, col, d)}
                        >
                          {list.map((j) => card(j, col, lane.get(j.id)))}
                          {col !== UNASSIGNED &&
                            events
                              .filter((e) => e.user_id === col)
                              .map((e) => {
                                const seg = eventOn(e, d);
                                if (!seg) return null;
                                const top = Math.max(0, ((seg.startMin - FIRST_HOUR * 60) / 60) * HOUR_PX);
                                const bottom = Math.min(hours.length * HOUR_PX, ((seg.endMin - FIRST_HOUR * 60) / 60) * HOUR_PX);
                                if (bottom <= 0 || top >= hours.length * HOUR_PX) return null;
                                return (
                                  <div
                                    key={`${e.id}-${d.toDateString()}`}
                                    className={`wk-event ${openEvent === e.id ? 'wk-open' : ''}`}
                                    style={{ top, height: Math.max(22, bottom - top) }}
                                    onClick={() => setOpenEvent(openEvent === e.id ? null : e.id)}
                                    title={eventLabel(e)}
                                  >
                                    <strong>{eventLabel(e)}</strong>
                                    {openEvent === e.id && (boss || e.user_id === user.id) && (
                                      <button
                                        type="button"
                                        className="link"
                                        onClick={async (ev) => {
                                          ev.stopPropagation();
                                          const message = resultError(await removeEvent({ event_id: e.id }));
                                          setProblem(message);
                                          if (!message) reload();
                                        }}
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="muted small-note">“Room” is how much more booked time fits in an 8-hour day, counting how long each person's jobs usually really take.</p>
    </section>
  );
}
