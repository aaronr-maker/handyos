import { useState } from 'react';
import { afterDial, afterMenu, DAYS, walk, type Env, type Flow, type Hours, type Pause } from '../../../../api/_lib/callEngine';
import type { Person } from './CallTree';

const ALL_DAY: Hours['week'] = Object.fromEntries(DAYS.map((d) => [d, [{ open: '00:00', close: '23:59' }]])) as unknown as Hours['week'];
const NEVER: Hours['week'] = Object.fromEntries(DAYS.map((d) => [d, []])) as unknown as Hours['week'];

const makeEnv = (when: 'open' | 'closed', people: Person[], crew: string, offClock: boolean, number: string, direct: string[]): Env => ({
  callerNumber: number,
  callerCustomers: direct,
  clockedIn: offClock ? [] : undefined,
  callerCrew: crew ? [crew] : [],
  now: Date.now(),
  hours: { timezone: 'America/Chicago', week: when === 'open' ? ALL_DAY : NEVER },
  names: Object.fromEntries(people.map((p) => [p.id, p.name])),
});

type Line = { who: 'caller' | 'system' | 'you'; text: string };

/**
 * A pretend call, inside the app: the same engine that answers real calls follows your tree, and you play the caller (press a key,
 * answer or ignore the ring). Nothing is dialed.
 */
export function TestCall({ flow, people, companyName, disabled }: { flow: Flow; people: Person[]; companyName: string; disabled: boolean }) {
  const [when, setWhen] = useState<'open' | 'closed'>('open');
  const [lines, setLines] = useState<Line[]>([]);
  const [pause, setPause] = useState<Pause | null>(null);
  const [crew, setCrew] = useState('');
  const [offClock, setOffClock] = useState(false);
  const [number, setNumber] = useState('+14175550100');
  const [isDirect, setIsDirect] = useState(false);

  const env = () => makeEnv(when, people, crew, offClock, number, isDirect ? flow.nodes.flatMap((n) => n.data.customers ?? []) : []);

  const show = (step: { say: string[]; pause: Pause }, extra: Line[] = []) => {
    const out: Line[] = [...extra, ...step.say.map((t) => ({ who: 'system' as const, text: t }))];
    const p = step.pause;
    if (p.type === 'menu') out.push({ who: 'system', text: p.prompt });
    if (p.type === 'dial') out.push({ who: 'you', text: p.numbers.length ? `Ringing ${p.who.join(' and ')} for up to ${p.seconds} seconds…` : 'Nobody to ring.' });
    if (p.type === 'record') out.push({ who: 'system', text: p.prompt }, { who: 'you', text: '📼 The caller leaves a voicemail. The call ends.' });
    if (p.type === 'ai') out.push({ who: 'you', text: '🤖 The AI receptionist takes the call.' });
    if (p.type === 'hangup') out.push({ who: 'you', text: '⛔ The call ends.' });
    setLines((l) => [...l, ...out]);
    setPause(p.type === 'menu' || p.type === 'dial' ? p : null);
  };

  const start = () => {
    setLines([{ who: 'caller', text: `📞 Someone calls ${companyName}…` }]);
    const startNode = flow.nodes.find((n) => n.kind === 'start');
    show(walk(flow, startNode?.id ?? null, env()));
  };
  const press = (digit: string | null) => {
    if (pause?.type !== 'menu') return;
    show(afterMenu(flow, pause.node, digit, env(), pause.attempt), [{ who: 'caller', text: digit ? `The caller presses ${digit}.` : 'The caller presses nothing.' }]);
  };
  const answer = (answered: boolean) => {
    if (pause?.type !== 'dial') return;
    show(afterDial(flow, pause.node, answered, env(), pause.index), [{ who: 'you', text: answered ? '✅ Somebody answers. The call is connected.' : '❌ Nobody answers.' }]);
  };

  return (
    <div className="card">
      <h2>Try it: a pretend call</h2>
      <p className="muted">You play the caller. Nothing is dialed.</p>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label>
          Pretend it is
          <select value={when} onChange={(e) => setWhen(e.target.value as 'open' | 'closed')}>
            <option value="open">during business hours</option>
            <option value="closed">after hours</option>
          </select>
        </label>
        <label>
          Pretend the caller is
          <select value={crew} onChange={(e) => setCrew(e.target.value)}>
            <option value="">a new caller</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                a customer whose open job is assigned to {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pretend the caller's number is
          <input value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={isDirect} onChange={(e) => setIsDirect(e.target.checked)} />
          Pretend the caller is on my direct list
        </label>
        <label className="check">
          <input type="checkbox" checked={offClock} onChange={(e) => setOffClock(e.target.checked)} />
          Pretend nobody is on the clock
        </label>
        <button type="button" onClick={start} disabled={disabled}>
          Start the call
        </button>
      </div>
      {disabled && <p className="muted small-note">Fix the problems above first.</p>}
      <div style={{ margin: '10px 0' }}>
        {lines.map((l, i) => (
          <p key={i} style={{ margin: '4px 0', padding: '6px 10px', borderRadius: 8, background: l.who === 'system' ? '#f1f5f9' : l.who === 'caller' ? '#ecfdf5' : '#fffbeb' }}>
            {l.who === 'system' ? '🔊 ' : ''}
            {l.text}
          </p>
        ))}
      </div>
      {pause?.type === 'menu' && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {pause.options.map((o) => (
            <button key={o.digit} type="button" className="secondary" onClick={() => press(o.digit)}>
              Press {o.digit}
              {o.label ? `: ${o.label}` : ''}
            </button>
          ))}
          <button type="button" className="secondary" onClick={() => press('9')}>
            Press a wrong key
          </button>
          <button type="button" className="secondary" onClick={() => press(null)}>
            Press nothing
          </button>
        </div>
      )}
      {pause?.type === 'dial' && (
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="secondary" onClick={() => answer(true)}>
            They answer
          </button>
          <button type="button" className="secondary" onClick={() => answer(false)}>
            Nobody answers
          </button>
        </div>
      )}
    </div>
  );
}
