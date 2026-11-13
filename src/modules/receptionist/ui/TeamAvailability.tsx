import { useState } from 'react';
import { listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { saveTeamAvailabilityAction } from '../actions';
import type { Weekday } from '../availability';
import { getAvailability } from '../service';

type Week = Partial<Record<Weekday, { start: string; end: string }[]>>;
const DAYS: [Weekday, string][] = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];

/** When each team member works. Estimate times are only offered inside these hours, and the drive from home starts when work starts. */
export default function TeamAvailability() {
  const { companyId } = useSession();
  const save = useAction(saveTeamAvailabilityAction);
  const { data, loading, error, reload } = useAsync(async () => ({ team: await listTeamMembers(), saved: await getAvailability(companyId) }), [companyId]);
  const [who, setWho] = useState('');
  const [edit, setEdit] = useState<Week | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [copying, setCopying] = useState<Weekday | null>(null);
  const [targets, setTargets] = useState<Weekday[]>([]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load the team.'}</p>;
  const person = who || data.team[0]?.id || '';
  const week: Week = edit ?? data.saved[person] ?? {};
  const hasSchedule = !!data.saved[person] || !!edit;
  const setDay = (d: Weekday, list: { start: string; end: string }[]) => setEdit({ ...week, [d]: list });

  const submit = async () => {
    const err = resultError(await save({ user_id: person, week }));
    if (err) return setNote({ ok: false, text: err });
    setNote({ ok: true, text: 'Saved.' });
    setEdit(null);
    reload();
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 style={{ fontSize: '1.4rem' }}>Team availability</h2>
          <p className="muted">
            When each person works. Estimate times are only offered inside these hours, a day with nothing listed is a day off, and the drive from home starts when their day starts. Someone with no
            schedule saved has no limit.
          </p>
        </div>
      </header>
      <div className="card">
        <label>
          Person
          <select
            value={person}
            onChange={(e) => {
              setWho(e.target.value);
              setEdit(null);
              setNote(null);
            }}
          >
            {data.team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || m.email}
              </option>
            ))}
          </select>
        </label>
        {!hasSchedule && <p className="muted small-note">No schedule saved yet, so there is no limit on this person. Add times below to set one.</p>}
        {DAYS.map(([d, label]) => {
          const list = week[d] ?? [];
          return (
            <div key={d} className="sched-row">
              <strong className="sched-day">{label}</strong>
              <div className="sched-times">
                {list.length === 0 && <span className="muted">Day off</span>}
                {list.map((blk, i) => (
                  <span key={i} className="sched-block">
                    <input
                      type="time"
                      value={blk.start}
                      onChange={(e) =>
                        setDay(
                          d,
                          list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                        )
                      }
                    />
                    <span className="muted">to</span>
                    <input
                      type="time"
                      value={blk.end}
                      onChange={(e) =>
                        setDay(
                          d,
                          list.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="sched-x"
                      aria-label="Remove these hours"
                      onClick={() =>
                        setDay(
                          d,
                          list.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <div className="sched-actions">
                <button type="button" className="secondary" onClick={() => setDay(d, [...list, { start: '07:00', end: '16:00' }])}>
                  + Add hours
                </button>
                {list.length > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setCopying(copying === d ? null : d);
                      setTargets([]);
                    }}
                  >
                    Copy to…
                  </button>
                )}
              </div>
              {copying === d && (
                <div className="sched-copy">
                  <p className="muted small-note">Copy {label}'s hours to:</p>
                  <div className="row" style={{ gap: 12 }}>
                    {DAYS.filter(([x]) => x !== d).map(([x, name]) => (
                      <label key={x} className="check" style={{ margin: 0 }}>
                        <input type="checkbox" checked={targets.includes(x)} onChange={(e) => setTargets(e.target.checked ? [...targets, x] : targets.filter((t) => t !== x))} />
                        {name}
                      </label>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button type="button" className="secondary" onClick={() => setTargets((['mon', 'tue', 'wed', 'thu', 'fri'] as Weekday[]).filter((x) => x !== d))}>
                      Weekdays
                    </button>
                    <button type="button" className="secondary" onClick={() => setTargets(DAYS.map(([x]) => x).filter((x) => x !== d))}>
                      Every day
                    </button>
                    <button
                      type="button"
                      disabled={targets.length === 0}
                      onClick={() => {
                        const next = { ...week };
                        for (const t of targets) next[t] = list.map((blk) => ({ ...blk }));
                        setEdit(next);
                        setCopying(null);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="row" style={{ alignItems: 'center' }}>
          <button type="button" onClick={() => void submit()} disabled={!edit}>
            Save
          </button>
          {note && <span className={note.ok ? 'notice' : 'err'}>{note.text}</span>}
        </div>
      </div>
    </section>
  );
}
