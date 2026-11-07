import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOURS, walk, toTwiml, type Flow } from '../api/_lib/callEngine';
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

describe('ringing the phone app', () => {
  const flow = (app: boolean): Flow => ({ nodes: [{ id: 'start', kind: 'start', x: 0, y: 0, data: {} }, { id: 'r', kind: 'ring', x: 0, y: 0, data: { people: ['u1'], app, mode: 'all', seconds: 20 } }], edges: [{ id: 'e', source: 'start', handle: 'next', target: 'r' }] });
  const env = { now: Date.parse('2027-01-06T16:00:00Z'), hours: DEFAULT_HOURS, phones: { u1: '+15125550001' } };
  it('dials the app and the cell together when asked, and only the cell otherwise', () => {
    const xml = (app: boolean) => toTwiml(walk(flow(app), 'start', env), { stepUrl: 'https://x/step', voice: 'v', recordingUrl: 'https://x/rec' });
    expect(xml(true)).toContain('<Client><Identity>u1</Identity></Client><Number>+15125550001</Number>');
    expect(xml(false)).not.toContain('<Client>');
  });
  it('never rings the app of someone who is no longer on the team', () => {
    const gone = walk(flow(true), 'start', { ...env, names: { someoneElse: 'Sam' }, phones: {} });
    expect(gone.pause).toMatchObject({ type: 'dial', numbers: [] });
    const here = walk(flow(true), 'start', { ...env, names: { u1: 'Alex' }, phones: {} });
    expect(here.pause).toMatchObject({ numbers: ['client:u1'] });
  });
  it('rings only people on the clock when the block says so, and falls through when nobody is', () => {
    const f = (only: boolean): Flow => ({ nodes: [{ id: 'start', kind: 'start', x: 0, y: 0, data: {} }, { id: 'r', kind: 'ring', x: 0, y: 0, data: { people: ['u1', 'u2'], onlyClockedIn: only, mode: 'all', seconds: 20 } }], edges: [{ id: 'e', source: 'start', handle: 'next', target: 'r' }] });
    const phones = { u1: '+15125550001', u2: '+15125550002' };
    expect(walk(f(true), 'start', { ...env, phones, clockedIn: ['u2'] }).pause).toMatchObject({ numbers: ['+15125550002'] });
    expect(walk(f(true), 'start', { ...env, phones, clockedIn: [] }).pause).toMatchObject({ numbers: [] });
    expect(walk(f(false), 'start', { ...env, phones, clockedIn: ['u2'] }).pause).toMatchObject({ numbers: ['+15125550001', '+15125550002'] });
    expect(walk(f(true), 'start', { ...env, phones }).pause).toMatchObject({ numbers: ['+15125550001', '+15125550002'] }); // the test call has no clock data
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
    const phones = { u1: '+15125550001', u2: '+15125550002' };
    expect(walk(f, 'start', { ...env, phones, callerCrew: ['u2'] }).pause).toMatchObject({ node: 'crew', numbers: ['+15125550002'] });
    expect(walk(f, 'start', { ...env, phones, callerCrew: [] }).pause).toMatchObject({ node: 'boss', numbers: ['+15125550001'] });
    expect(walk(f, 'start', { ...env, phones }).pause).toMatchObject({ node: 'boss' });
  });
  it('rings someone with an app but no cell number', () => {
    const noPhone = walk(flow(true), 'start', { ...env, phones: {} });
    expect(noPhone.pause).toMatchObject({ type: 'dial', numbers: ['client:u1'] });
  });
});
