import { useState } from 'react';
import { listTeamMembers, resultError, useAction, useAsync, useSession } from '@/core';
import { upcomingJobsFor, loadTimeFacts } from '@/modules/timesheets';
import { offerSentence, openSlots, pickOffers, type EstimateBlocks, type Weekday } from '../availability';
import { saveEstimateTimesAction } from '../actions';
import { clock, nextStart, slotStarts, startsToBlocks } from '../slots';
import { getEstimateBlocks } from '../service';

const DAYS: [Weekday, string][] = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];

/** The times set aside for in-home estimates, and a preview of what the receptionist would offer a caller right now. */
export default function EstimateTimesScreen() {
  const { companyId } = useSession();
  const save = useAction(saveEstimateTimesAction);
  const { data, loading, error, reload } = useAsync(async () => ({ blocks: await getEstimateBlocks(companyId), team: await listTeamMembers(), facts: await loadTimeFacts(companyId) }), [companyId]);
  const [edit, setEdit] = useState<EstimateBlocks | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [copying, setCopying] = useState<Weekday | null>(null);
  const [targets, setTargets] = useState<Weekday[]>([]);
  const [now] = useState(() => Date.now());

  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load estimate times.'}</p>;
  const b = edit ?? data.blocks;
  const set = (patch: Partial<EstimateBlocks>) => setEdit({ ...b, ...patch });
  const setDay = (d: Weekday, list: { start: string; end: string }[]) => set({ week: { ...b.week, [d]: list } });

  const sellers = data.team.filter((m) => m.is_seller).map((m) => ({ id: m.id, name: m.full_name || m.email }));
  const busy = sellers.flatMap((s) => upcomingJobsFor(data.facts, s.id).map((j) => ({ seller: s.id, start: Date.parse(j.scheduled_start), end: Date.parse(j.scheduled_end) })));
  const offers = pickOffers(openSlots({ now, blocks: b, sellers, busy }), b.timezone);

  const submit = async () => {
    const err = resultError(await save({ timezone: b.timezone, week: b.week, slot_minutes: 60, buffer_minutes: b.bufferMinutes, notice_hours: b.noticeHours, horizon_days: b.horizonDays }));
    if (err) return setNote({ ok: false, text: err });
    setNote({ ok: true, text: 'Saved.' });
    setEdit(null);
    reload();
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 style={{ fontSize: '1.4rem' }}>Estimate times</h2>
          <p className="muted">The days and hours you set aside for free in-home estimates. The AI receptionist only offers these, and only with team members marked as sellers on the Team page.</p>
        </div>
      </header>
      <div className="card">
        <h2>Times set aside</h2>
        <p className="muted small-note">Pick the start of each one-hour slot. The end fills in by itself.</p>
        {DAYS.map(([d, label]) => {
          const starts = slotStarts(b.week[d]);
          const setStarts = (next: string[]) => setDay(d, startsToBlocks(next));
          return (
            <div key={d} style={{ margin: '8px 0' }}>
              <strong style={{ display: 'inline-block', width: 100 }}>{label}</strong>
              {starts.map((st, i) => (
                <span key={`${st}-${i}`} className="row" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
                  <input type="time" defaultValue={st} onBlur={(e) => e.target.value && e.target.value !== st && setStarts(starts.map((x, j) => (j === i ? e.target.value : x)))} />
                  <span className="muted small-note">to {clock(startsToBlocks([st])[0]?.end ?? st)}</span>
                  <button type="button" className="link" onClick={() => setStarts(starts.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
              <button type="button" className="secondary" style={{ minHeight: 36 }} onClick={() => setStarts([...starts, nextStart(starts)])}>
                + Add time
              </button>
              {starts.length > 0 && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setCopying(copying === d ? null : d);
                    setTargets([]);
                  }}
                >
                  Copy to other days
                </button>
              )}
              {copying === d && (
                <div className="card" style={{ margin: '8px 0 8px 100px', padding: 12 }}>
                  <p className="muted small-note">Copy {label}'s times to:</p>
                  <div className="row" style={{ gap: 12 }}>
                    {DAYS.filter(([x]) => x !== d).map(([x, name]) => (
                      <label key={x} className="check" style={{ margin: 0 }}>
                        <input type="checkbox" checked={targets.includes(x)} onChange={(e) => setTargets(e.target.checked ? [...targets, x] : targets.filter((t) => t !== x))} />
                        {name}
                      </label>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button type="button" className="secondary" style={{ minHeight: 36 }} onClick={() => setTargets((['mon', 'tue', 'wed', 'thu', 'fri'] as Weekday[]).filter((x) => x !== d))}>
                      Weekdays
                    </button>
                    <button type="button" className="secondary" style={{ minHeight: 36 }} onClick={() => setTargets(DAYS.map(([x]) => x).filter((x) => x !== d))}>
                      Every day
                    </button>
                    <button
                      type="button"
                      style={{ minHeight: 36 }}
                      disabled={targets.length === 0}
                      onClick={() => {
                        const week = { ...b.week };
                        for (const t of targets) week[t] = startsToBlocks(starts);
                        set({ week });
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
        <div className="row">
          <label className="grow">
            Travel time kept between jobs (minutes)
            <input type="number" min={0} max={240} value={b.bufferMinutes} onChange={(e) => set({ bufferMinutes: Number(e.target.value) || 0 })} />
          </label>
          <label className="grow">
            Needs at least this much notice (hours)
            <input type="number" min={0} max={336} value={b.noticeHours} onChange={(e) => set({ noticeHours: Number(e.target.value) || 0 })} />
          </label>
          <label className="grow">
            Offer times up to this many days ahead
            <input type="number" min={1} max={90} value={b.horizonDays} onChange={(e) => set({ horizonDays: Number(e.target.value) || 14 })} />
          </label>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <button type="button" onClick={() => void submit()} disabled={!edit}>
            Save
          </button>
          {note && <span className={note.ok ? 'notice' : 'err'}>{note.text}</span>}
        </div>
      </div>
      <div className="card">
        <h2>What a caller would hear right now</h2>
        {sellers.length === 0 ? (
          <p className="muted">Nobody is marked as a seller yet. On the Team page, tick “Does in-home estimates (seller)” for the people who do them.</p>
        ) : offers.length === 0 ? (
          <p className="muted">Nothing is open. Add times above, or check that your sellers have room on their calendars.</p>
        ) : (
          <p>“{offerSentence(offers)}”</p>
        )}
        <p className="muted small-note">Sellers: {sellers.map((s) => s.name).join(', ') || 'none'}.</p>
      </div>
    </section>
  );
}
