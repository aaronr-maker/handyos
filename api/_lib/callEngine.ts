/**
 * The phone tree engine. One piece of code that follows a company's call tree, used for the in-app "test call" and for real
 * calls, so what you test is what callers get. It has no imports and does no network work: give it the tree, the business
 * hours, the team's phone numbers and what just happened (a key pressed, a ring that was not answered), and it says what to
 * do next. A second function turns that into the instructions Twilio understands (TwiML).
 */
export type NodeKind = 'start' | 'hours' | 'job' | 'clock' | 'direct' | 'area' | 'say' | 'menu' | 'ring' | 'voicemail' | 'ai' | 'forward' | 'hangup';

export interface MenuOption {
  digit: string;
  label: string;
}

export interface NodeData {
  /** say: what to say */
  text?: string;
  /** menu, voicemail: what to say first */
  prompt?: string;
  /** menu: "Press 1 for ..." choices */
  options?: MenuOption[];
  /** direct: customers whose calls skip everything else and go straight to the next block */
  customers?: string[];
  /** area: groups of area codes, each with its own exit (like West Plains: 417 and 573, Mountain Home: 870) */
  areas?: { label: string; codes: string[] }[];
  /** ring: team members to ring (their phone app only; a personal phone number is never dialed) */
  people?: string[];
  numbers?: string[];
  /** ring: also ring whoever is assigned to this caller's open job (when the caller is a customer with one) */
  assigned?: boolean;
  /** ring: only ring team members who are on the clock right now (extra numbers always ring) */
  onlyClockedIn?: boolean;
  /** ring: how to reach each person: their phone app, their cell number, or both. Older trees with `app: true` mean both; otherwise the cell. */
  reach?: 'app' | 'cell' | 'both';
  app?: boolean;
  /** ring: everyone at once, or one after another */
  mode?: 'all' | 'in_order';
  /** ring, forward: how long to ring before giving up */
  seconds?: number;
  /** voicemail: who to tell about a new message */
  notify?: string[];
  /** forward: the number to send the call to */
  number?: string;
  /** a name for the block, shown on the canvas */
  label?: string;
}

export interface FlowNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  data: NodeData;
}
/** `handle` is the exit the line leaves from (see `portsOf`). */
export interface FlowEdge {
  id: string;
  source: string;
  handle: string;
  target: string;
  /** Only for drawing: which side of the block the line leaves from and arrives at. The call logic ignores these. */
  from?: 'r' | 'b' | 't';
  to?: 'l' | 't' | 'b';
}
export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export interface Hours {
  timezone: string;
  /** Open stretches per weekday, "HH:MM" to "HH:MM" (24-hour). No stretch = closed all day. */
  week: Record<Day, { open: string; close: string }[]>;
}

export interface Env {
  /** Now, in ms. */
  now: number;
  hours: Hours;
  /** No longer used: calls never go to personal phone numbers. Kept so older callers still type-check. */
  phones?: Record<string, string>;
  /** Team member id -> name (for the test call). */
  names?: Record<string, string>;
  /** Team members on the clock right now. Missing (like in the test call) means everyone counts as clocked in. */
  clockedIn?: string[];
  /** Team members assigned to the open jobs of the customer who is calling (empty when the caller is new or has no open job). */
  callerCrew?: string[];
  /** The number the caller is calling from, as Twilio gives it (like +14175550100). */
  callerNumber?: string;
  /** The ids of the customers whose phone number matches the caller (empty for a new caller). */
  callerCustomers?: string[];
  /** True once the AI receptionist is connected; until then the AI block's "unavailable" exit is used. */
  aiReady?: boolean;
}

export const DEFAULT_HOURS: Hours = {
  timezone: 'America/Chicago',
  week: { mon: [{ open: '08:00', close: '17:00' }], tue: [{ open: '08:00', close: '17:00' }], wed: [{ open: '08:00', close: '17:00' }], thu: [{ open: '08:00', close: '17:00' }], fri: [{ open: '08:00', close: '17:00' }], sat: [], sun: [] },
};

// ---- the exits each kind of block has ----
export interface Port {
  id: string;
  label: string;
}
export function portsOf(node: Pick<FlowNode, 'kind' | 'data'>): Port[] {
  switch (node.kind) {
    case 'start':
    case 'say':
      return [{ id: 'next', label: 'then' }];
    case 'hours':
      return [
        { id: 'open', label: 'Open' },
        { id: 'closed', label: 'Closed' },
      ];
    case 'direct':
      return [
        { id: 'yes', label: 'On my direct list' },
        { id: 'no', label: 'Not on the list' },
      ];
    case 'area':
      return [...(node.data.areas ?? []).map((a, i) => ({ id: `a${i}`, label: a.label.trim() || `Area ${i + 1}` })), { id: 'other', label: 'Anywhere else' }];
    case 'clock':
      return [
        { id: 'yes', label: 'Someone is on the clock' },
        { id: 'no', label: 'Nobody is on the clock' },
      ];
    case 'job':
      return [
        { id: 'yes', label: 'Has an open job' },
        { id: 'no', label: 'No open job / new caller' },
      ];
    case 'menu':
      return [...(node.data.options ?? []).map((o) => ({ id: o.digit, label: `Press ${o.digit}${o.label ? `: ${o.label}` : ''}` })), { id: 'none', label: 'No answer / wrong key' }];
    case 'ring':
    case 'forward':
      return [{ id: 'noanswer', label: "If they don't answer" }];
    case 'ai':
      return [{ id: 'unavailable', label: 'If the assistant is not available' }];
    default:
      return [];
  }
}

const target = (flow: Flow, nodeId: string, handle: string) => flow.edges.find((e) => e.source === nodeId && e.handle === handle)?.target ?? null;
const nodeOf = (flow: Flow, id: string) => flow.nodes.find((n) => n.id === id);

// ---- business hours ----
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Is the business open at this moment, in the business's own time zone? */
export function isOpen(hours: Hours, now: number): boolean {
  let weekday: string;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: hours.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
    weekday = (parts.find((p) => p.type === 'weekday')?.value ?? 'Mon').slice(0, 3).toLowerCase();
    minutes = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  } catch {
    return false;
  }
  return (hours.week[weekday as Day] ?? []).some((r) => minutes >= toMinutes(r.open) && minutes < toMinutes(r.close));
}

// ---- walking the tree ----
export type Pause =
  | { type: 'menu'; node: string; prompt: string; options: MenuOption[]; attempt: number }
  | { type: 'dial'; node: string; numbers: string[]; who: string[]; seconds: number; index: number; total: number }
  | { type: 'record'; node: string; prompt: string; notify: string[] }
  | { type: 'ai'; node: string }
  | { type: 'hangup'; node: string | null };

export interface Step {
  /** Things to say before the pause. */
  say: string[];
  pause: Pause;
  /** The blocks passed through, for the call log. */
  trail: string[];
}

const SORRY = "Sorry, we can't take your call right now. Goodbye.";
const MAX_STEPS = 30;

/** The words spoken for a menu: the prompt, then "Press 1 for ..." for each choice. */
export function menuSpeech(prompt: string, options: MenuOption[]): string {
  return [prompt.trim(), ...options.filter((o) => o.digit).map((o) => `Press ${o.digit}${o.label ? ` for ${o.label}` : ''}.`)].filter(Boolean).join(' ');
}

/**
 * Who to ring. Calls only ever go to a team member's phone app (`client:<id>`), never to a personal phone number: numbers typed
 * into old trees, team phone numbers and "send to a number" blocks are ignored here, and toTwiml refuses to write a <Number> at all.
 */
function ringStep(node: FlowNode, env: Env, index: number): Pause {
  const onTheClock = (id: string) => !node.data.onlyClockedIn || !env.clockedIn || env.clockedIn.includes(id);
  const stillOnTeam = (id: string) => !env.names || !!env.names[id];
  const ids = [...new Set([...(node.data.people ?? []), ...(node.data.assigned ? (env.callerCrew ?? []) : [])])].filter(onTheClock).filter(stillOnTeam);
  const entries = ids.map((id) => ({ numbers: [`client:${id}`], who: env.names?.[id] ?? 'a team member' }));
  const seconds = Math.min(60, Math.max(8, node.data.seconds ?? 20));
  if (node.data.mode === 'in_order') {
    const one = entries[index];
    return { type: 'dial', node: node.id, numbers: one ? one.numbers : [], who: one ? [one.who] : [], seconds, index, total: entries.length };
  }
  return { type: 'dial', node: node.id, numbers: entries.flatMap((e) => e.numbers), who: entries.map((e) => e.who), seconds, index: 0, total: 1 };
}

/** The area code of a US number ("+14175550100" or "417-555-0100" give "417"), or "" when it is not one. */
export function areaCodeOf(number: string | undefined): string {
  const d = (number ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1, 4);
  return d.length === 10 ? d.slice(0, 3) : '';
}

/** Follows the tree from a block until something has to happen (a menu, a ring, a recording, a hang-up). */
export function walk(flow: Flow, from: string | null, env: Env, say: string[] = [], trail: string[] = []): Step {
  let current = from;
  for (let i = 0; i < MAX_STEPS; i++) {
    const node = current ? nodeOf(flow, current) : undefined;
    if (!node) return { say: [...say, SORRY], pause: { type: 'hangup', node: current }, trail };
    trail.push(node.id);
    const go = (handle: string) => target(flow, node.id, handle);
    switch (node.kind) {
      case 'start':
        current = go('next');
        break;
      case 'hours':
        current = go(isOpen(env.hours, env.now) ? 'open' : 'closed');
        break;
      case 'direct': {
        const list = node.data.customers ?? [];
        current = go((env.callerCustomers ?? []).some((c) => list.includes(c)) ? 'yes' : 'no');
        break;
      }
      case 'area': {
        const code = areaCodeOf(env.callerNumber);
        const at = (node.data.areas ?? []).findIndex((a) => a.codes.map((c) => c.replace(/\D/g, '')).includes(code));
        current = go(at >= 0 ? `a${at}` : 'other');
        break;
      }
      case 'clock': {
        // who counts: the people picked on the block, or anyone on the team; with no clock data (the test call) it counts as yes
        const who = node.data.people?.length ? node.data.people : Object.keys(env.names ?? {});
        const someone = !env.clockedIn || who.some((id) => env.clockedIn?.includes(id));
        current = go(someone ? 'yes' : 'no');
        break;
      }
      case 'job':
        current = go((env.callerCrew ?? []).length > 0 ? 'yes' : 'no');
        break;
      case 'say':
        if (node.data.text?.trim()) say = [...say, node.data.text.trim()];
        current = go('next');
        break;
      case 'menu':
        return { say, pause: { type: 'menu', node: node.id, prompt: menuSpeech(node.data.prompt ?? '', node.data.options ?? []), options: node.data.options ?? [], attempt: 1 }, trail };
      case 'ring':
        return { say, pause: ringStep(node, env, 0), trail };
      case 'forward':
        // sending a call to a phone number is not allowed: nobody to ring, so it follows the "if they don't answer" line
        return { say, pause: { type: 'dial', node: node.id, numbers: [], who: [], seconds: 8, index: 0, total: 1 }, trail };
      case 'voicemail':
        return { say, pause: { type: 'record', node: node.id, prompt: node.data.prompt?.trim() || 'Please leave a message after the beep and we will call you back.', notify: node.data.notify ?? [] }, trail };
      case 'ai':
        if (env.aiReady) return { say, pause: { type: 'ai', node: node.id }, trail };
        current = go('unavailable');
        if (!current) return { say, pause: { type: 'record', node: node.id, prompt: 'Please leave a message after the beep and we will call you back.', notify: [] }, trail };
        break;
      case 'hangup':
        return { say, pause: { type: 'hangup', node: node.id }, trail };
    }
  }
  return { say: [...say, SORRY], pause: { type: 'hangup', node: null }, trail };
}

/** A key was pressed (or none): follow that choice, or ask again, or take the "wrong key" exit. */
export function afterMenu(flow: Flow, nodeId: string, digit: string | null, env: Env, attempt = 1): Step {
  const node = nodeOf(flow, nodeId);
  if (!node || node.kind !== 'menu') return walk(flow, null, env);
  const options = node.data.options ?? [];
  if (digit && options.some((o) => o.digit === digit) && target(flow, nodeId, digit)) return walk(flow, target(flow, nodeId, digit), env, [], [nodeId]);
  const none = target(flow, nodeId, 'none');
  if (none) return walk(flow, none, env, [digit ? "Sorry, that isn't one of the choices." : "Sorry, I didn't get that."], [nodeId]);
  if (attempt < 3) return { say: [digit ? "Sorry, that isn't one of the choices." : "Sorry, I didn't get that."], pause: { type: 'menu', node: nodeId, prompt: menuSpeech(node.data.prompt ?? '', options), options, attempt: attempt + 1 }, trail: [nodeId] };
  return { say: [SORRY], pause: { type: 'hangup', node: nodeId }, trail: [nodeId] };
}

/** A ring ended. If someone picked up, the call is done; otherwise try the next person, or take the "don't answer" exit. */
export function afterDial(flow: Flow, nodeId: string, answered: boolean, env: Env, index = 0): Step {
  const node = nodeOf(flow, nodeId);
  if (!node) return walk(flow, null, env);
  if (answered) return { say: [], pause: { type: 'hangup', node: nodeId }, trail: [nodeId] };
  if (node.kind === 'ring' && node.data.mode === 'in_order') {
    const next = ringStep(node, env, index + 1);
    if (next.type === 'dial' && next.numbers.length > 0) return { say: [], pause: next, trail: [nodeId] };
  }
  return walk(flow, target(flow, nodeId, 'noanswer'), env, [], [nodeId]);
}

// ---- checking a tree before it is used ----
export interface Problem {
  node: string | null;
  text: string;
  /** 'error' stops the tree from being used; 'warning' is worth a look. */
  level: 'error' | 'warning';
}

export function validateFlow(flow: Flow): Problem[] {
  const out: Problem[] = [];
  const starts = flow.nodes.filter((n) => n.kind === 'start');
  if (starts.length !== 1) out.push({ node: null, level: 'error', text: starts.length === 0 ? 'The tree needs a starting point.' : 'The tree has more than one starting point.' });
  const named = (n: FlowNode) => n.data.label || ({ start: 'Call comes in', hours: 'Business hours', job: 'Open-job check', clock: 'On the clock', direct: 'Direct list', area: 'Area code', say: 'Greeting', menu: 'Menu', ring: 'Ring', voicemail: 'Voicemail', ai: 'AI receptionist', forward: 'Forward', hangup: 'Hang up' } as const)[n.kind];
  for (const n of flow.nodes) {
    for (const p of portsOf(n)) {
      if (p.id === 'none' || p.id === 'unavailable') continue; // these have a built-in way to carry on
      if (!target(flow, n.id, p.id)) out.push({ node: n.id, level: n.kind === 'ring' || n.kind === 'forward' ? 'warning' : 'error', text: `${named(n)}: "${p.label}" doesn't go anywhere yet.` });
    }
    if (n.kind === 'menu' && (n.data.options ?? []).length === 0) out.push({ node: n.id, level: 'error', text: `${named(n)} has no choices.` });
    if (n.kind === 'menu') {
      const digits = (n.data.options ?? []).map((o) => o.digit);
      if (new Set(digits).size !== digits.length) out.push({ node: n.id, level: 'error', text: `${named(n)} uses the same key twice.` });
    }
    if (n.kind === 'ring' && (n.data.people ?? []).length === 0 && !n.data.assigned) out.push({ node: n.id, level: 'error', text: `${named(n)} has nobody to ring.` });
    if (n.kind === 'forward') out.push({ node: n.id, level: 'error', text: `${named(n)}: calls are never sent to a phone number. Remove this block (use Ring people, which rings the phone app).` });
  }
  // blocks nothing leads to
  if (starts.length === 1) {
    const seen = new Set<string>();
    const stack = [starts[0].id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of flow.edges) if (e.source === id) stack.push(e.target);
    }
    for (const n of flow.nodes) if (!seen.has(n.id)) out.push({ node: n.id, level: 'warning', text: `${named(n)} can't be reached from the start.` });
  }
  // a loop of blocks that never waits for anything would spin forever
  const quiet = new Set(['start', 'hours', 'say']);
  for (const n of flow.nodes.filter((x) => quiet.has(x.kind))) {
    let cur: FlowNode | undefined = n;
    for (let i = 0; i < flow.nodes.length + 1 && cur && quiet.has(cur.kind); i++) {
      const handles = portsOf(cur).map((p) => target(flow, cur!.id, p.id)).filter(Boolean) as string[];
      if (handles.length === 0) break;
      cur = nodeOf(flow, handles[0]);
      if (cur?.id === n.id) {
        out.push({ node: n.id, level: 'error', text: `${named(n)} loops back to itself without ever waiting for the caller.` });
        break;
      }
    }
  }
  return out;
}

// ---- Twilio instructions ----
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface TwimlOptions {
  /** The address Twilio comes back to after each step, e.g. https://app.example.com/api/voice/step */
  stepUrl: string;
  /** The caller's number, so the person who answers sees who is calling. */
  callerId?: string;
  /** A voice Twilio offers, like Polly.Joanna. */
  voice: string;
  /** Where Twilio reports a finished recording. */
  recordingUrl: string;
  /** When set, the audio of a connected call is also sent here to be typed out (a live transcript). Nothing is stored. */
  stream?: { url: string; params: Record<string, string> };
  /** The AI receptionist's address and pass; when set, the AI block connects the call to it. */
  assistant?: { url: string; params: Record<string, string> };
  /** This call's id, passed along to a ringing phone app so it can show this call's transcript. */
  callSid?: string;
}

/** Turns a step into the instructions Twilio understands. */
export function toTwiml(step: Step, o: TwimlOptions): string {
  const say = (t: string) => `<Say voice="${esc(o.voice)}">${esc(t)}</Say>`;
  const link = (q: Record<string, string | number>) => `${o.stepUrl}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&amp;')}`;
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>', ...step.say.map(say)];
  const p = step.pause;
  switch (p.type) {
    case 'menu':
      out.push(`<Gather input="dtmf" numDigits="1" timeout="6" action="${link({ node: p.node, ev: 'menu', attempt: p.attempt })}">${say(p.prompt)}</Gather>`);
      out.push(`<Redirect method="POST">${link({ node: p.node, ev: 'menu', attempt: p.attempt })}</Redirect>`); // nothing pressed
      break;
    case 'dial':
      if (!p.numbers.some((n) => n.startsWith('client:'))) out.push(`<Redirect method="POST">${link({ node: p.node, ev: 'dial', idx: p.index, answered: 0 })}</Redirect>`);
      else {
        // the live transcript starts when the first ring starts and follows the call to its end
        if (o.stream && p.index === 0) out.push(`<Start><Stream url="${esc(o.stream.url)}" track="both_tracks">${Object.entries(o.stream.params).map(([k, v]) => `<Parameter name="${esc(k)}" value="${esc(v)}"/>`).join('')}</Stream></Start>`);
        out.push(`<Dial timeout="${p.seconds}" answerOnBridge="true"${o.callerId ? ` callerId="${esc(o.callerId)}"` : ''} action="${link({ node: p.node, ev: 'dial', idx: p.index })}">${p.numbers.filter((n) => n.startsWith('client:')).map((n) => `<Client><Identity>${esc(n.slice(7))}</Identity>${o.callSid ? `<Parameter name="parent" value="${esc(o.callSid)}"/>` : ''}</Client>`).join('')}</Dial>`);
      }
      break;
    case 'record':
      out.push(say(p.prompt));
      out.push(`<Record maxLength="120" playBeep="true" finishOnKey="#" action="${link({ node: p.node, ev: 'record' })}" recordingStatusCallback="${esc(o.recordingUrl)}" recordingStatusCallbackMethod="POST"/>`);
      out.push(say('Thank you. Goodbye.'), '<Hangup/>');
      break;
    case 'ai':
      if (o.assistant) out.push(`<Connect><Stream url="${esc(o.assistant.url)}">${Object.entries(o.assistant.params).map(([k, v]) => `<Parameter name="${esc(k)}" value="${esc(v)}"/>`).join('')}</Stream></Connect>`);
      else out.push(say('One moment.'), '<Hangup/>'); // not connected: nothing to hand the call to
      break;
    case 'hangup':
      out.push('<Hangup/>');
      break;
  }
  out.push('</Response>');
  return out.join('');
}

/** A starter tree: open hours greet and offer a menu; closed hours take a voicemail. */
export function starterFlow(): Flow {
  return {
    nodes: [
      { id: 'start', kind: 'start', x: 0, y: 140, data: {} },
      { id: 'hours', kind: 'hours', x: 220, y: 140, data: {} },
      { id: 'greet', kind: 'say', x: 470, y: 20, data: { text: 'Thank you for calling That Handyman Van.' } },
      { id: 'menu', kind: 'menu', x: 720, y: 20, data: { prompt: '', options: [{ digit: '1', label: 'Aaron' }, { digit: '2', label: 'our service team' }] } },
      { id: 'ring1', kind: 'ring', x: 1000, y: 0, data: { people: [], mode: 'all', seconds: 20 } },
      { id: 'ring2', kind: 'ring', x: 1000, y: 200, data: { people: [], mode: 'all', seconds: 20 } },
      { id: 'closed', kind: 'say', x: 470, y: 330, data: { text: "Thank you for calling That Handyman Van. We're closed right now." } },
      { id: 'vm', kind: 'voicemail', x: 720, y: 330, data: { prompt: 'Please leave your name, number and what you need, and we will call you back.', notify: [] } },
    ],
    edges: [
      { id: 'e1', source: 'start', handle: 'next', target: 'hours' },
      { id: 'e2', source: 'hours', handle: 'open', target: 'greet' },
      { id: 'e3', source: 'hours', handle: 'closed', target: 'closed' },
      { id: 'e4', source: 'greet', handle: 'next', target: 'menu' },
      { id: 'e5', source: 'menu', handle: '1', target: 'ring1' },
      { id: 'e6', source: 'menu', handle: '2', target: 'ring2' },
      { id: 'e7', source: 'ring1', handle: 'noanswer', target: 'vm' },
      { id: 'e8', source: 'ring2', handle: 'noanswer', target: 'vm' },
      { id: 'e9', source: 'closed', handle: 'next', target: 'vm' },
    ],
  };
}
