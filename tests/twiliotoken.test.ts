import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { areaCodeOf, DEFAULT_HOURS, toTwiml, validateFlow, walk, type Flow } from '../api/_lib/callEngine';
import { tokenSettings, voiceAccessToken } from '../api/_lib/twilioToken';

const S = { accountSid: 'AC' + 'a'.repeat(32), apiKeySid: 'SK' + 'b'.repeat(32), apiKeySecret: 'secret-'.padEnd(32, 'x'), pushCredentialSid: 'CR' + 'c'.repeat(32) };

describe('the phone app calling pass', () => {
  it('is a signed token for one person that allows incoming calls and names the push credential', () => {
    const jwt = voiceAccessToken(S, 'user-1', 1_800_000_000);
    const [h, p, sig] = jwt.split('.');
    expect(sig).toBe(createHmac('sha256', S.apiKeySecret).update(`${h}.${p}`).digest('base64url'));
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toMatchObject({ iss: S.apiKeySid, sub: S.accountSid, exp: 1_800_003_600, grants: { identity: 'user-1', voice: { incoming: { allow: true }, push_credential_sid: S.pushCredentialSid } } });
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ alg: 'HS256', cty: 'twilio-fpa;v=1' });
  });
  it('says which setting is missing', () => {
    expect(tokenSettings({ TWILIO_ACCOUNT_SID: S.accountSid })).toEqual({ problem: expect.stringContaining('TWILIO_API_KEY_SID') });
    expect(tokenSettings({ TWILIO_ACCOUNT_SID: S.accountSid, TWILIO_API_KEY_SID: S.apiKeySid, TWILIO_API_KEY_SECRET: S.apiKeySecret, TWILIO_PUSH_CREDENTIAL_SID: S.pushCredentialSid })).toHaveProperty('settings');
  });
});

describe('ringing the phone app, and never a personal phone', () => {
  const env = { now: Date.parse('2027-01-06T16:00:00Z'), hours: DEFAULT_HOURS, names: { u1: 'Alex', u2: 'Sam' } };
  const line = (node: object): Flow => ({ nodes: [{ id: 'start', kind: 'start', x: 0, y: 0, data: {} }, { id: 'r', kind: 'ring', x: 0, y: 0, data: { mode: 'all', seconds: 20, ...node } }], edges: [{ id: 'e', source: 'start', handle: 'next', target: 'r' }] });
  const xml = (f: Flow, e = env) => toTwiml(walk(f, 'start', e), { stepUrl: 'https://x/step', voice: 'v', recordingUrl: 'https://x/rec', callSid: 'CA1' });

  it('dials the phone app of each person picked', () => {
    expect(xml(line({ people: ['u1'] }))).toContain('<Client><Identity>u1</Identity><Parameter name="parent" value="CA1"/></Client>');
  });
  it('never dials a phone number, however the tree or the team list is set up', () => {
    const odd = line({ people: ['u1'], numbers: ['+15125559999'], reach: 'cell', app: true });
    const out = xml(odd, { ...env, phones: { u1: '+15125550001' } } as typeof env);
    expect(out).not.toContain('<Number>');
    expect(out).not.toContain('+15125559999');
    expect(out).not.toContain('+15125550001');
    // a "send to a number" block rings nobody
    const forward: Flow = { nodes: [{ id: 'start', kind: 'start', x: 0, y: 0, data: {} }, { id: 'f', kind: 'forward', x: 0, y: 0, data: { number: '+15125559999' } }], edges: [{ id: 'e', source: 'start', handle: 'next', target: 'f' }] };
    expect(xml(forward)).not.toContain('<Number>');
    expect(validateFlow(forward).some((p) => p.level === 'error' && /never sent to a phone number/.test(p.text))).toBe(true);
  });
  it('never rings the app of someone who is no longer on the team', () => {
    expect(walk(line({ people: ['gone'] }), 'start', env).pause).toMatchObject({ type: 'dial', numbers: [] });
    expect(walk(line({ people: ['u1'] }), 'start', env).pause).toMatchObject({ numbers: ['client:u1'] });
  });
  it('sends a caller with an open job to the crew of that job, and anyone else down the other line', () => {
    const f: Flow = {
      nodes: [
        { id: 'start', kind: 'start', x: 0, y: 0, data: {} },
        { id: 'job', kind: 'job', x: 0, y: 0, data: {} },
        { id: 'crew', kind: 'ring', x: 0, y: 0, data: { people: [], assigned: true, mode: 'all', seconds: 20 } },
        { id: 'boss', kind: 'ring', x: 0, y: 0, data: { people: ['u1'], mode: 'all', seconds: 20 } },
      ],
      edges: [
        { id: 'e1', source: 'start', handle: 'next', target: 'job' },
        { id: 'e2', source: 'job', handle: 'yes', target: 'crew' },
        { id: 'e3', source: 'job', handle: 'no', target: 'boss' },
      ],
    };
    expect(walk(f, 'start', { ...env, callerCrew: ['u2'] }).pause).toMatchObject({ node: 'crew', numbers: ['client:u2'] });
    expect(walk(f, 'start', { ...env, callerCrew: [] }).pause).toMatchObject({ node: 'boss', numbers: ['client:u1'] });
  });
  it('rings only people on the clock when the block says so, and rings nobody when none is', () => {
    const f = line({ people: ['u1', 'u2'], onlyClockedIn: true });
    expect(walk(f, 'start', { ...env, clockedIn: ['u2'] }).pause).toMatchObject({ numbers: ['client:u2'] });
    expect(walk(f, 'start', { ...env, clockedIn: [] }).pause).toMatchObject({ numbers: [] });
    expect(walk(f, 'start', env).pause).toMatchObject({ numbers: ['client:u1', 'client:u2'] });
  });
});

describe('the "anyone on the clock?" split', () => {
  const f: Flow = {
    nodes: [
      { id: 'start', kind: 'start', x: 0, y: 0, data: {} },
      { id: 'c', kind: 'clock', x: 0, y: 0, data: { people: ['u1'] } },
      { id: 'in', kind: 'ring', x: 0, y: 0, data: { people: ['u1'], mode: 'all', seconds: 20 } },
      { id: 'out', kind: 'ring', x: 0, y: 0, data: { people: ['u2'], mode: 'all', seconds: 20 } },
    ],
    edges: [
      { id: 'e1', source: 'start', handle: 'next', target: 'c' },
      { id: 'e2', source: 'c', handle: 'yes', target: 'in' },
      { id: 'e3', source: 'c', handle: 'no', target: 'out' },
    ],
  };
  const env = { now: Date.parse('2027-01-06T16:00:00Z'), hours: DEFAULT_HOURS, names: { u1: 'A', u2: 'B' } };
  it('sends the call one way when the person is clocked in and the other way when not', () => {
    expect(walk(f, 'start', { ...env, clockedIn: ['u1'] }).pause).toMatchObject({ node: 'in' });
    expect(walk(f, 'start', { ...env, clockedIn: ['u2'] }).pause).toMatchObject({ node: 'out' });
    expect(walk(f, 'start', { ...env, clockedIn: [] }).pause).toMatchObject({ node: 'out' });
    expect(walk(f, 'start', env).pause).toMatchObject({ node: 'in' }); // no clock data (the test call): counts as yes
  });
});

describe('the direct list and area code routing', () => {
  const env = { now: Date.parse('2027-01-06T16:00:00Z'), hours: DEFAULT_HOURS, names: { u1: 'Alex' } };
  it('sends listed customers straight to the next block and everyone else down the other line', () => {
    const f: Flow = {
      nodes: [
        { id: 'start', kind: 'start', x: 0, y: 0, data: {} },
        { id: 'd', kind: 'direct', x: 0, y: 0, data: { customers: ['c1', 'c2'] } },
        { id: 'me', kind: 'ring', x: 0, y: 0, data: { people: ['u1'], mode: 'all', seconds: 20 } },
        { id: 'ai', kind: 'say', x: 0, y: 0, data: { text: 'The assistant' } },
      ],
      edges: [
        { id: 'e1', source: 'start', handle: 'next', target: 'd' },
        { id: 'e2', source: 'd', handle: 'yes', target: 'me' },
        { id: 'e3', source: 'd', handle: 'no', target: 'ai' },
      ],
    };
    expect(walk(f, 'start', { ...env, callerCustomers: ['c2'] }).pause).toMatchObject({ node: 'me' });
    expect(walk(f, 'start', { ...env, callerCustomers: ['someone-else'] }).trail).toContain('ai');
    expect(walk(f, 'start', env).trail).toContain('ai');
  });
  it('knows an area code however the number is written', () => {
    expect(areaCodeOf('+14175550100')).toBe('417');
    expect(areaCodeOf('(870) 555-0100')).toBe('870');
    expect(areaCodeOf('555')).toBe('');
    expect(areaCodeOf(undefined)).toBe('');
  });
  it('sends callers down the line for their area, and everyone else down "anywhere else"', () => {
    const f: Flow = {
      nodes: [
        { id: 'start', kind: 'start', x: 0, y: 0, data: {} },
        { id: 'a', kind: 'area', x: 0, y: 0, data: { areas: [{ label: 'West Plains', codes: ['417', '573'] }, { label: 'Mountain Home', codes: ['870'] }] } },
        { id: 'wp', kind: 'say', x: 0, y: 0, data: { text: 'West Plains' } },
        { id: 'mh', kind: 'say', x: 0, y: 0, data: { text: 'Mountain Home' } },
        { id: 'el', kind: 'say', x: 0, y: 0, data: { text: 'Elsewhere' } },
      ],
      edges: [
        { id: 'e1', source: 'start', handle: 'next', target: 'a' },
        { id: 'e2', source: 'a', handle: 'a0', target: 'wp' },
        { id: 'e3', source: 'a', handle: 'a1', target: 'mh' },
        { id: 'e4', source: 'a', handle: 'other', target: 'el' },
      ],
    };
    const go = (n?: string) => walk(f, 'start', { ...env, callerNumber: n }).trail.at(-1);
    expect(go('+14175550100')).toBe('wp');
    expect(go('+18705550100')).toBe('mh');
    expect(go('+12145550100')).toBe('el');
    expect(go(undefined)).toBe('el');
  });
});
