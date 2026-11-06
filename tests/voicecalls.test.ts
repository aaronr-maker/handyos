import { describe, expect, it } from 'vitest';
import { DEFAULT_HOURS, starterFlow, type Flow } from '../api/_lib/callEngine';
import { handleIncoming, handleRecording, handleStep, twilioSignature, verifyTwilio, VoiceError, type VoiceDeps, type VoiceStore } from '../api/_lib/voiceCalls';

const TOKEN = 'twilio-auth-token-for-tests';
const BASE = 'https://app.example.com';
const NOW = Date.parse('2027-01-06T16:00:00Z'); // Wednesday 10:00 in Chicago: open

function tree(): Flow {
  const f = starterFlow();
  f.nodes.find((n) => n.id === 'ring1')!.data.people = ['aaron'];
  f.nodes.find((n) => n.id === 'ring2')!.data.people = ['sam'];
  return f;
}

function world(over: { flow?: Flow | null; now?: number; known?: boolean } = {}) {
  const logs: { callSid: string; patch: { from?: string; to?: string; trail?: string[]; outcome?: string } }[] = [];
  const mails: { callSid: string; from: string | null; recordingUrl: string; seconds: number }[] = [];
  const store: VoiceStore = {
    findCompany: async (to) => (over.known === false || to !== '+15125550000' ? null : { companyId: 'co1', hours: DEFAULT_HOURS, voice: 'Polly.Joanna' }),
    activeFlow: async () => (over.flow === undefined ? tree() : over.flow),
    team: async () => ({ phones: { aaron: '+15125550001', sam: '+15125550002' }, names: { aaron: 'Aaron', sam: 'Sam' } }),
    logCall: async (_c, callSid, patch) => void logs.push({ callSid, patch }),
    saveVoicemail: async (_c, v) => void mails.push(v),
  };
  const deps: VoiceDeps = { store, env: { TWILIO_AUTH_TOKEN: TOKEN, APP_URL: BASE }, now: () => over.now ?? NOW };
  const sign = (path: string, params: Record<string, string>, query = '') => twilioSignature(TOKEN, `${BASE}${path}${query ? `?${query}` : ''}`, params);
  return { deps, logs, mails, sign };
}

describe('only Twilio can make the phone addresses act', () => {
  it('checks the signature Twilio adds, and rejects anything else', () => {
    const params = { CallSid: 'CA1', From: '+15125559999', To: '+15125550000' };
    const sig = twilioSignature(TOKEN, `${BASE}/api/voice/incoming`, params);
    expect(verifyTwilio(TOKEN, `${BASE}/api/voice/incoming`, params, sig)).toBe(true);
    expect(verifyTwilio(TOKEN, `${BASE}/api/voice/incoming`, { ...params, From: '+1000' }, sig)).toBe(false);
    expect(verifyTwilio(TOKEN, `${BASE}/api/voice/other`, params, sig)).toBe(false);
    expect(verifyTwilio('other-token', `${BASE}/api/voice/incoming`, params, sig)).toBe(false);
    expect(verifyTwilio(TOKEN, `${BASE}/api/voice/incoming`, params, undefined)).toBe(false);
  });

  it('refuses a call without the right signature, and says so plainly when the phone system is not set up', async () => {
    const w = world();
    const params = { CallSid: 'CA1', From: '+15125559999', To: '+15125550000' };
    await expect(handleIncoming(w.deps, params, 'forged')).rejects.toThrow(/did not come from Twilio/);
    await expect(handleIncoming({ ...w.deps, env: {} }, params, 'x')).rejects.toBeInstanceOf(VoiceError);
    expect(w.logs).toHaveLength(0);
  });
});

describe('a customer calls', () => {
  const params = { CallSid: 'CA1', From: '+15125559999', To: '+15125550000' };

  it('during hours hears the greeting and menu, and the call is logged', async () => {
    const w = world();
    const xml = await handleIncoming(w.deps, params, w.sign('/api/voice/incoming', params));
    expect(xml).toContain('Thank you for calling That Handyman Van.');
    expect(xml).toContain('Press 1 for Aaron. Press 2 for our service team.');
    expect(w.logs[0]).toMatchObject({ callSid: 'CA1', patch: { from: '+15125559999', to: '+15125550000', outcome: 'started' } });
    expect(w.logs[0].patch.trail).toEqual(['start', 'hours', 'greet', 'menu']);
  });

  it('after hours hears that the company is closed and gets the voicemail', async () => {
    const w = world({ now: Date.parse('2027-01-07T02:00:00Z') });
    const xml = await handleIncoming(w.deps, params, w.sign('/api/voice/incoming', params));
    expect(xml).toContain('closed right now.');
    expect(xml).toContain('<Record ');
  });

  it('a number that is not the company\'s, or a company with no tree, gets a polite goodbye, never a crash', async () => {
    const wrong = world();
    const p = { ...params, To: '+15125557777' };
    expect(await handleIncoming(wrong.deps, p, wrong.sign('/api/voice/incoming', p))).toContain('<Hangup/>');
    const none = world({ flow: null });
    expect(await handleIncoming(none.deps, params, none.sign('/api/voice/incoming', params))).toContain('not able to take your call');
  });
});

describe('after each step', () => {
  const base = { CallSid: 'CA1', From: '+15125559999', To: '+15125550000' };

  it('a key press rings the right person, with the caller\'s own number shown', async () => {
    const w = world();
    const q = { node: 'menu', ev: 'menu', attempt: '1' };
    const raw = 'node=menu&ev=menu&attempt=1';
    const params = { ...base, Digits: '1' };
    const xml = await handleStep(w.deps, q, raw, params, w.sign('/api/voice/step', params, raw));
    expect(xml).toContain('<Number>+15125550001</Number>');
    expect(xml).toContain('callerId="+15125559999"');
  });

  it('a ring nobody answered goes to the voicemail; a ring that was answered ends quietly', async () => {
    const w = world();
    const raw = 'node=ring1&ev=dial&idx=0';
    const noAnswer = { ...base, DialCallStatus: 'no-answer' };
    expect(await handleStep(w.deps, { node: 'ring1', ev: 'dial', idx: '0' }, raw, noAnswer, w.sign('/api/voice/step', noAnswer, raw))).toContain('<Record ');
    const answered = { ...base, DialCallStatus: 'completed' };
    const xml = await handleStep(w.deps, { node: 'ring1', ev: 'dial', idx: '0' }, raw, answered, w.sign('/api/voice/step', answered, raw));
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Record');
    expect(w.logs.at(-1)?.patch.outcome).toBe('answered');
  });

  it('a key press that is not a digit is treated as no answer, and a forged step is refused', async () => {
    const w = world();
    const raw = 'node=menu&ev=menu&attempt=1';
    const params = { ...base, Digits: "1'; drop" };
    const xml = await handleStep(w.deps, { node: 'menu', ev: 'menu', attempt: '1' }, raw, params, w.sign('/api/voice/step', params, raw));
    expect(xml).toContain('<Gather'); // asked again
    await expect(handleStep(w.deps, { node: 'menu', ev: 'menu' }, raw, params, 'forged')).rejects.toThrow(/did not come from Twilio/);
  });

  it('saves a voicemail when Twilio says the recording is ready', async () => {
    const w = world();
    const params = { ...base, RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1', RecordingDuration: '23' };
    await handleRecording(w.deps, params, w.sign('/api/voice/recording', params));
    expect(w.mails).toEqual([{ callSid: 'CA1', from: '+15125559999', recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3', seconds: 23 }]);
    await expect(handleRecording(w.deps, params, 'forged')).rejects.toBeInstanceOf(VoiceError);
  });
});
