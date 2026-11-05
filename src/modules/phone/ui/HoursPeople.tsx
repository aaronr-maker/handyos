import { useState } from 'react';
import { resultError, useAction } from '@/core';
import { DAYS, type Day } from '../../../../api/_lib/callEngine';
import { savePhoneSettingsAction, setTeamPhoneAction } from '../actions';
import type { PhoneSettings } from '../service';
import type { Person } from './CallTree';

const NAMES: Record<Day, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const ar = (d: Day, s: PhoneSettings) => s.hours.week[d][0];
const VOICES = ['Polly.Joanna', 'Polly.Matthew', 'Polly.Salli', 'Polly.Joey'];

/** The business number, opening hours, greeting voice, and the number to ring for each team member. */
export function HoursPeople({ settings, people, onSaved }: { settings: PhoneSettings; people: Person[]; onSaved: () => void }) {
  const saveSettings = useAction(savePhoneSettingsAction);
  const setPhone = useAction(setTeamPhoneAction);
  const [s, setS] = useState(settings);
  const [phones, setPhones] = useState<Record<string, string>>(() => Object.fromEntries(people.map((p) => [p.id, p.phone])));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const setDay = (d: Day, patch: { open?: string; close?: string } | 'closed' | 'open') =>
    setS((cur) => {
      const first = cur.hours.week[d][0];
      const next = patch === 'closed' ? [] : patch === 'open' ? [{ open: '08:00', close: '17:00' }] : [{ open: first?.open ?? '08:00', close: first?.close ?? '17:00', ...patch }];
      return { ...cur, hours: { ...cur.hours, week: { ...cur.hours.week, [d]: next } } };
    });

  const save = async () => {
    setNote(null);
    const err = resultError(await saveSettings({ number: s.number, timezone: s.hours.timezone, voice: s.voice, week: s.hours.week }));
    if (err) return setNote({ ok: false, text: err });
    for (const p of people) {
      if ((phones[p.id] ?? '') === p.phone) continue;
      const e = resultError(await setPhone({ user_id: p.id, phone: phones[p.id] ?? '' }));
      if (e) return setNote({ ok: false, text: `${p.name}: ${e}` });
    }
    setNote({ ok: true, text: 'Saved.' });
    onSaved();
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Business number</h2>
        <label>
          The Twilio number customers call
          <input value={s.number} placeholder="+15125550000" onChange={(e) => setS({ ...s, number: e.target.value })} />
        </label>
        <p className="muted small-note">
          In Twilio, open this number and set “A call comes in” to Webhook, POST, to: <code>{`${window.location.origin}/api/voice/incoming`}</code>
        </p>
        <label>
          Greeting voice
          <select value={s.voice} onChange={(e) => setS({ ...s, voice: e.target.value })}>
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v.replace('Polly.', '')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Business hours</h2>
        <label>
          Time zone
          <input value={s.hours.timezone} onChange={(e) => setS({ ...s, hours: { ...s.hours, timezone: e.target.value } })} />
        </label>
        {DAYS.map((d) => {
          const r = ar(d, s);
          return (
            <div key={d} className="row" style={{ alignItems: 'center', margin: '6px 0' }}>
              <strong style={{ width: 100 }}>{NAMES[d]}</strong>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!r} onChange={(e) => setDay(d, e.target.checked ? 'open' : 'closed')} /> Open
              </label>
              {r && (
                <>
                  <input type="time" value={r.open} onChange={(e) => setDay(d, { open: e.target.value })} />
                  to
                  <input type="time" value={r.close} onChange={(e) => setDay(d, { close: e.target.value })} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Who to ring</h2>
        <p className="muted">The cell number that rings when a call is sent to each person.</p>
        {people.map((p) => (
          <label key={p.id}>
            {p.name}
            <input value={phones[p.id] ?? ''} placeholder="+15125550001" onChange={(e) => setPhones({ ...phones, [p.id]: e.target.value })} />
          </label>
        ))}
      </div>
      <button type="button" onClick={save}>
        Save
      </button>
      {note && <p className={note.ok ? 'ok' : 'err'}>{note.text}</p>}
    </div>
  );
}
