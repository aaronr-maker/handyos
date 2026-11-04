import { useState } from 'react';
import { listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { editTimeAction, hoursMinutes, initials, Punch, type TimeEdit } from '@/modules/timetrack';
import { dayKey } from '../calc';
import { loadTimeFacts, weekReport } from '../service';

const pretty = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dayName = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

/** A person's weekly timesheet: what was clocked each day, the hours the week is heading for, and (for admins and owners) everyone's. */
export default function TimesheetsScreen() {
  const { companyId, role, user } = useSession();
  const editTime = useAction(editTimeAction);
  const isAdmin = role === 'owner' || role === 'admin';
  const [who, setWho] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date());
  const [now] = useState(() => Date.now());
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, loading, error, reload } = useAsync(async () => ({ facts: await loadTimeFacts(companyId), team: await listTeamMembers() }), [companyId]);
  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load timesheets.'}</p>;

  const { facts, team } = data;
  const person = isAdmin && who ? who : user.id;
  const nameOf = (id: string) => team.find((m) => m.id === id)?.full_name || team.find((m) => m.id === id)?.email || 'Team member';
  const report = weekReport(facts, person, date, now);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(report.weekStart + i * 86_400_000 + 3_600_000 * 12));
  const thisWeek = now >= report.weekStart && now < report.weekEnd;
  const jobTitle = (id: string) => facts.jobs.find((j) => j.id === id)?.title ?? 'Job';
  const editedBy = (id: string) => {
    const e: TimeEdit[] = facts.edits.filter((x) => x.entity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return e.length ? { initials: initials(nameOf(e[0].edited_by)), who: nameOf(e[0].edited_by), count: e.length } : null;
  };
  const canEdit = isAdmin || person === user.id;
  const change = async (entity: 'job' | 'shift', id: string, patch: { start?: string; end?: string | null }) => {
    setNote(null);
    const reason = window.prompt('Why are you changing this time? (optional)') ?? null;
    const err = resultError(await editTime({ entity, id, ...patch, reason: reason?.trim() || null }));
    if (err) setNote({ ok: false, text: err });
    else reload();
  };
  const shiftsOf = (key: string) => facts.shifts.filter((s) => s.user_id === person && dayKey(Date.parse(s.clock_in)) === key).sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  const entriesOf = (key: string) => facts.entries.filter((e) => e.user_id === person && dayKey(Date.parse(e.clock_in)) === key).sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  const week = (d: number) => setDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + d));
  const eff = report.efficiency;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Timesheets</h1>
          <p className="muted">{isAdmin ? "Anyone's week. You can correct anyone's time; each change is logged." : 'Your week. You can correct your own time; each change is logged.'}</p>
        </div>
      </header>

      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {isAdmin && (
          <label className="muted">
            Person
            <select value={person} onChange={(e) => setWho(e.target.value)}>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name || m.email}
                  {m.id === user.id ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="secondary" onClick={() => week(-7)}>
          ← Earlier week
        </button>
        <strong>
          {pretty(report.weekStart)} to {pretty(report.weekEnd - 1)}
          {thisWeek ? ' (this week)' : ''}
        </strong>
        <button type="button" className="secondary" disabled={thisWeek} onClick={() => week(7)}>
          Later week →
        </button>
      </div>
      {note && <p className={note.ok ? 'notice' : 'err'}>{note.text}</p>}

      <div className="card" style={report.over && thisWeek ? { borderColor: '#dc2626' } : undefined}>
        <h2>{nameOf(person)}: this week</h2>
        <dl className="totals">
          <dt>Clocked so far</dt>
          <dd>{hoursMinutes(report.clocked)}</dd>
          {thisWeek && (
            <>
              <dt>Scheduled and still ahead this week</dt>
              <dd>{hoursMinutes(report.scheduled_remaining)}</dd>
              <dt>
                Efficiency rate
                <span className="muted small-note" style={{ display: 'block' }}>
                  {eff.defaulted ? `Not enough finished jobs yet (${eff.jobs}), so 1.00 is used.` : `Their time on ${eff.jobs} finished jobs compared with the time scheduled for them.`}
                </span>
              </dt>
              <dd>{eff.rate.toFixed(2)}</dd>
              <dt>
                <strong>Projected for the week</strong>
                <span className="muted small-note" style={{ display: 'block' }}>
                  Clocked + scheduled ahead × efficiency rate. Drive time between jobs is not scheduled, so it is not in this.
                </span>
              </dt>
              <dd style={report.over ? { color: '#dc2626' } : undefined}>
                <strong>{hoursMinutes(report.projected)}</strong>
              </dd>
            </>
          )}
        </dl>
        {thisWeek && report.over && <p className="err">On track for {hoursMinutes(report.projected)}, over the {report.limit / 60}-hour limit. A manager is alerted.</p>}
      </div>

      {days.map((key) => {
        const shifts = shiftsOf(key);
        const entries = entriesOf(key);
        const d = report.byDay[key];
        return (
          <div key={key} className="card">
            <h2>
              {dayName(key)} <span className="muted small-note">{d ? hoursMinutes(d.day > 0 ? d.day : d.job) : ''}</span>
            </h2>
            {shifts.length === 0 && entries.length === 0 && <p className="muted small-note">Nothing clocked.</p>}
            {shifts.length > 0 && <h3>Day clock</h3>}
            {shifts.map((s) => (
              <Punch key={s.id} start={s.clock_in} end={s.clock_out} canEdit={canEdit} editedBy={editedBy(s.id)} onChange={(p) => void change('shift', s.id, p)} />
            ))}
            {entries.length > 0 && <h3>On jobs</h3>}
            {entries.map((e) => (
              <div key={e.id}>
                <span className="muted small-note">{jobTitle(e.job_id)}</span>
                <Punch start={e.clock_in} end={e.clock_out} canEdit={canEdit} editedBy={editedBy(e.id)} onChange={(p) => void change('job', e.id, p)} />
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
