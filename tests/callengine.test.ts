import { describe, expect, it } from 'vitest';
import { afterDial, afterMenu, DEFAULT_HOURS, isOpen, menuSpeech, starterFlow, toTwiml, validateFlow, walk, type Env, type Flow } from '../api/_lib/callEngine';

// Wednesday, January 6, 2027. 10:00 in Chicago is 16:00 UTC; 20:00 in Chicago is 02:00 UTC the next day.
const OPEN_TIME = Date.parse('2027-01-06T16:00:00Z');
const NIGHT = Date.parse('2027-01-07T02:00:00Z');
const SATURDAY = Date.parse('2027-01-09T17:00:00Z');
const env = (now: number, extra: Partial<Env> = {}): Env => ({ now, hours: DEFAULT_HOURS, phones: { aaron: '+15125550001', sam: '+15125550002', pat: '+15125550003' }, names: { aaron: 'Aaron', sam: 'Sam', pat: 'Pat' }, ...extra });

/** The starter tree with real people on its two ring blocks. */
function tree(): Flow {
  const f = starterFlow();
  f.nodes.find((n) => n.id === 'ring1')!.data.people = ['aaron'];
  f.nodes.find((n) => n.id === 'ring2')!.data.people = ['sam', 'pat'];
  return f;
}
const twiml = (step: ReturnType<typeof walk>) => toTwiml(step, { stepUrl: 'https://app.example.com/api/voice/step', voice: 'Polly.Joanna', recordingUrl: 'https://app.example.com/api/voice/recording', callerId: '+15125559999' });

describe('business hours', () => {
  it('is open inside the hours and closed at night and on weekends, in the business time zone', () => {
    expect(isOpen(DEFAULT_HOURS, OPEN_TIME)).toBe(true);
    expect(isOpen(DEFAULT_HOURS, NIGHT)).toBe(false);
    expect(isOpen(DEFAULT_HOURS, SATURDAY)).toBe(false);
    expect(isOpen(DEFAULT_HOURS, Date.parse('2027-01-06T14:00:00Z'))).toBe(true); // 8:00 exactly: open
    expect(isOpen(DEFAULT_HOURS, Date.parse('2027-01-06T23:00:00Z'))).toBe(false); // 17:00 exactly: closed
  });

  it('supports split days (a lunch break) and a different time zone', () => {
    const split = { timezone: 'America/Chicago', week: { ...DEFAULT_HOURS.week, wed: [{ open: '08:00', close: '12:00' }, { open: '13:00', close: '17:00' }] } };
    expect(isOpen(split, Date.parse('2027-01-06T18:30:00Z'))).toBe(false); // 12:30
    expect(isOpen(split, Date.parse('2027-01-06T20:00:00Z'))).toBe(true); // 14:00
    expect(isOpen({ ...DEFAULT_HOURS, timezone: 'America/New_York' }, Date.parse('2027-01-06T13:30:00Z'))).toBe(true); // 8:30 in New York
  });
});

describe('following the tree', () => {
  it('during hours: greets, then waits at the menu, saying the choices from the list', () => {
    const s = walk(tree(), 'start', env(OPEN_TIME));
    expect(s.say).toEqual(['Thank you for calling That Handyman Van.']);
    expect(s.pause).toMatchObject({ type: 'menu', node: 'menu', prompt: 'Press 1 for Aaron. Press 2 for our service team.' });
    expect(menuSpeech('Welcome.', [{ digit: '1', label: 'Aaron' }])).toBe('Welcome. Press 1 for Aaron.');
  });

  it('after hours: says it is closed and takes a voicemail', () => {
    const s = walk(tree(), 'start', env(NIGHT));
    expect(s.say).toEqual(["Thank you for calling That Handyman Van. We're closed right now."]);
    expect(s.pause).toMatchObject({ type: 'record', node: 'vm' });
  });

  it('a menu key goes where that key leads: one person, or everyone at once', () => {
    const one = afterMenu(tree(), 'menu', '1', env(OPEN_TIME));
    expect(one.pause).toMatchObject({ type: 'dial', node: 'ring1', numbers: ['client:aaron'], who: ['Aaron'] });
    const all = afterMenu(tree(), 'menu', '2', env(OPEN_TIME));
    expect(all.pause).toMatchObject({ type: 'dial', node: 'ring2', numbers: ['client:sam', 'client:pat'] });
  });

  it('asks again for a wrong key, up to three times, then hangs up politely', () => {
    const f = tree();
    const first = afterMenu(f, 'menu', '9', env(OPEN_TIME), 1);
    expect(first.say[0]).toMatch(/isn't one of the choices/);
    expect(first.pause).toMatchObject({ type: 'menu', attempt: 2 });
    expect(afterMenu(f, 'menu', null, env(OPEN_TIME), 2).pause).toMatchObject({ type: 'menu', attempt: 3 });
    expect(afterMenu(f, 'menu', null, env(OPEN_TIME), 3).pause.type).toBe('hangup');
  });

  it('uses the "no answer / wrong key" exit when the tree has one', () => {
    const f = tree();
    f.edges.push({ id: 'ex', source: 'menu', handle: 'none', target: 'vm' });
    expect(afterMenu(f, 'menu', null, env(OPEN_TIME)).pause).toMatchObject({ type: 'record' });
  });

  it('when nobody answers, goes where the tree says (voicemail), but when someone answers the call is done', () => {
    expect(afterDial(tree(), 'ring1', false, env(OPEN_TIME)).pause).toMatchObject({ type: 'record', node: 'vm' });
    expect(afterDial(tree(), 'ring1', true, env(OPEN_TIME)).pause).toMatchObject({ type: 'hangup' });
  });

  it('can ring people one after another, and only then take the "no answer" exit', () => {
    const f = tree();
    const ring = f.nodes.find((n) => n.id === 'ring2')!;
    ring.data.mode = 'in_order';
    const first = afterMenu(f, 'menu', '2', env(OPEN_TIME)).pause;
    expect(first).toMatchObject({ type: 'dial', numbers: ['client:sam'], who: ['Sam'], index: 0, total: 2 });
    const second = afterDial(f, 'ring2', false, env(OPEN_TIME), 0).pause;
    expect(second).toMatchObject({ type: 'dial', numbers: ['client:pat'], who: ['Pat'], index: 1 });
    expect(afterDial(f, 'ring2', false, env(OPEN_TIME), 1).pause).toMatchObject({ type: 'record' });
  });

  it('skips a team member with no phone number, and goes straight to "no answer" when nobody can be rung', () => {
    const f = tree();
    f.nodes.find((n) => n.id === 'ring1')!.data.people = ['ghost'];
    const s = afterMenu(f, 'menu', '1', env(OPEN_TIME));
    expect(s.pause).toMatchObject({ type: 'dial', numbers: [] });
    expect(afterDial(f, 'ring1', false, env(OPEN_TIME)).pause).toMatchObject({ type: 'record' });
  });

  it('uses the AI block when it is connected, and its "not available" exit until then', () => {
    const f: Flow = {
      nodes: [
        { id: 'start', kind: 'start', x: 0, y: 0, data: {} },
        { id: 'ai', kind: 'ai', x: 0, y: 0, data: {} },
        { id: 'vm', kind: 'voicemail', x: 0, y: 0, data: {} },
      ],
      edges: [
        { id: '1', source: 'start', handle: 'next', target: 'ai' },
        { id: '2', source: 'ai', handle: 'unavailable', target: 'vm' },
      ],
    };
    expect(walk(f, 'start', env(OPEN_TIME)).pause).toMatchObject({ type: 'record' });
    expect(walk(f, 'start', env(OPEN_TIME, { aiReady: true })).pause).toMatchObject({ type: 'ai' });
  });

  it('never hangs on a tree that goes nowhere or loops: it says sorry and hangs up', () => {
    const lost: Flow = { nodes: [{ id: 'start', kind: 'start', x: 0, y: 0, data: {} }], edges: [] };
    const s = walk(lost, 'start', env(OPEN_TIME));
    expect(s.pause.type).toBe('hangup');
    expect(s.say[0]).toMatch(/can't take your call/);
    const loop: Flow = { nodes: [{ id: 'a', kind: 'say', x: 0, y: 0, data: { text: 'hi' } }, { id: 'b', kind: 'say', x: 0, y: 0, data: { text: 'there' } }], edges: [{ id: '1', source: 'a', handle: 'next', target: 'b' }, { id: '2', source: 'b', handle: 'next', target: 'a' }] };
    expect(walk(loop, 'a', env(OPEN_TIME)).pause.type).toBe('hangup');
  });
});

describe('checking a tree', () => {
  it('passes the starter tree once its rings have people, and says what is missing otherwise', () => {
    expect(validateFlow(tree()).filter((p) => p.level === 'error')).toEqual([]);
    const blank = validateFlow(starterFlow());
    expect(blank.filter((p) => p.level === 'error').map((p) => p.text)).toEqual(expect.arrayContaining([expect.stringMatching(/Ring has nobody to ring/)]));
  });

  it('finds an exit that goes nowhere, a repeated key, a missing start, a block nothing leads to, and a loop', () => {
    const f = tree();
    f.edges = f.edges.filter((e) => e.id !== 'e6'); // key 2 leads nowhere
    f.nodes.find((n) => n.id === 'menu')!.data.options!.push({ digit: '1', label: 'again' });
    f.nodes.push({ id: 'lonely', kind: 'hangup', x: 0, y: 0, data: {} });
    const text = validateFlow(f).map((p) => p.text).join(' | ');
    expect(text).toMatch(/Press 2: our service team" doesn't go anywhere/);
    expect(text).toMatch(/uses the same key twice/);
    expect(text).toMatch(/Hang up can't be reached/);
    expect(validateFlow({ nodes: [], edges: [] })[0].text).toMatch(/needs a starting point/);
    const loop: Flow = { nodes: [{ id: 'start', kind: 'start', x: 0, y: 0, data: {} }, { id: 'a', kind: 'say', x: 0, y: 0, data: { text: 'hi' } }], edges: [{ id: '1', source: 'start', handle: 'next', target: 'a' }, { id: '2', source: 'a', handle: 'next', target: 'a' }] };
    expect(validateFlow(loop).map((p) => p.text).join(' ')).toMatch(/loops back to itself/);
  });
});

describe('what Twilio is told', () => {
  it('speaks the greeting, gathers one key, and comes back to the same menu if nothing is pressed', () => {
    const x = twiml(walk(tree(), 'start', env(OPEN_TIME)));
    expect(x).toContain('<Say voice="Polly.Joanna">Thank you for calling That Handyman Van.</Say>');
    expect(x).toContain('<Gather input="dtmf" numDigits="1" timeout="6" action="https://app.example.com/api/voice/step?node=menu&amp;ev=menu&amp;attempt=1">');
    expect(x).toContain('Press 1 for Aaron. Press 2 for our service team.');
    expect(x).toContain('<Redirect method="POST">https://app.example.com/api/voice/step?node=menu');
  });

  it('rings the phone apps with the caller\'s own number shown, and comes back to say what happened', () => {
    const x = twiml(afterMenu(tree(), 'menu', '2', env(OPEN_TIME)));
    expect(x).toContain('<Dial timeout="20" answerOnBridge="true" callerId="+15125559999" action="https://app.example.com/api/voice/step?node=ring2&amp;ev=dial&amp;idx=0">');
    expect(x).toContain('<Client><Identity>sam</Identity></Client><Client><Identity>pat</Identity></Client>');
  });

  it('records a voicemail with a beep and says thank you', () => {
    const x = twiml(walk(tree(), 'start', env(NIGHT)));
    expect(x).toContain('<Record maxLength="120" playBeep="true"');
    expect(x).toContain('recordingStatusCallback="https://app.example.com/api/voice/recording"');
    expect(x).toContain('Thank you. Goodbye.</Say><Hangup/>');
  });

  it('escapes anything typed into a greeting so it cannot break the instructions', () => {
    const f = tree();
    f.nodes.find((n) => n.id === 'greet')!.data.text = 'Smith & Sons <b>"best"</b>';
    const x = twiml(walk(f, 'start', env(OPEN_TIME)));
    expect(x).toContain('Smith &amp; Sons &lt;b&gt;&quot;best&quot;&lt;/b&gt;');
    expect(x).not.toContain('<b>');
  });
});
