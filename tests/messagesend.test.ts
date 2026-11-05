import { describe, expect, it } from 'vitest';
import type { Deps, Store } from '../api/_lib/qb';
import { sendMessage, toE164, type MessageStore, type SendEnv, type StoredMessage } from '../api/_lib/messageSend';

const RESEND_KEY = 're_' + 'a1B2c3D4e5F6g7H8i9J0kLmN';
const SID = 'AC' + '0123456789abcdef0123456789abcdef';
const TOKEN = 'token' + 'x'.repeat(27);

function world(over: { env?: SendEnv; role?: string; msg?: Partial<StoredMessage>; contact?: { name: string; email: string | null; phone: string | null } | null; status?: number } = {}) {
  const marked: { id: string; status: string; provider_ref: string | null; error: string | null }[] = [];
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const msg: StoredMessage = { id: 'm1', customer_id: 'c1', channel: 'sms', body: 'Hi Pat, running late.', direction: 'outbound', status: 'queued', ...over.msg };
  const mstore: MessageStore = {
    getMessage: async () => msg,
    customerContact: async () => (over.contact === undefined ? { name: 'Pat Miller', email: 'pat@example.com', phone: '(512) 555-0147' } : over.contact),
    companyName: async () => 'That Handyman Van LLC',
    markMessage: async (_c, id, r) => void marked.push({ id, ...r }),
  };
  const store = { userFromToken: async (t: string) => (t === 'tok' ? { id: 'u1' } : null), membership: async () => ({ companyId: 'co1', role: over.role ?? 'owner' }) } as unknown as Store;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string>, body: String(init?.body) });
    const status = over.status ?? 200;
    return new Response(JSON.stringify(status === 200 ? { id: 're_123', sid: 'SM123' } : { message: 'Invalid number' }), { status });
  }) as unknown as typeof fetch;
  const env: SendEnv = { RESEND_API_KEY: RESEND_KEY, RESEND_FROM: 'office@thathandymanvan.com', TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15125550000', ...over.env };
  const deps = { env, store, fetch: fakeFetch, now: () => 0 } as unknown as Deps & { env: Deps['env'] & SendEnv };
  return { deps, mstore, marked, calls };
}

describe('delivering a saved message', () => {
  it('turns phone numbers into the form Twilio wants', () => {
    expect(toE164('(512) 555-0147')).toBe('+15125550147');
    expect(toE164('1-512-555-0147')).toBe('+15125550147');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('555-0147')).toBeNull();
  });

  it('sends a text through Twilio and records it as sent with the service reference', async () => {
    const w = world();
    expect(await sendMessage(w.deps, w.mstore, 'tok', 'm1')).toEqual({ status: 'sent' });
    expect(w.calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/' + SID + '/Messages.json');
    expect(new URLSearchParams(w.calls[0].body).get('To')).toBe('+15125550147');
    expect(w.calls[0].headers.Authorization).toBe('Basic ' + Buffer.from(SID + ':' + TOKEN).toString('base64'));
    expect(w.marked).toEqual([{ id: 'm1', status: 'sent', provider_ref: 'SM123', error: null }]);
  });

  it('sends an email through Resend with the company name, and records it', async () => {
    const w = world({ msg: { channel: 'email' } });
    expect(await sendMessage(w.deps, w.mstore, 'tok', 'm1')).toEqual({ status: 'sent' });
    expect(w.calls[0].url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(w.calls[0].body)).toMatchObject({ from: 'office@thathandymanvan.com', to: ['pat@example.com'], subject: 'A message from That Handyman Van LLC', text: 'Hi Pat, running late.' });
    expect(w.marked[0]).toMatchObject({ status: 'sent', provider_ref: 're_123' });
  });

  it('records a failure with the reason instead of claiming it was sent, and never sends twice', async () => {
    const bad = world({ status: 400 });
    expect(await sendMessage(bad.deps, bad.mstore, 'tok', 'm1')).toMatchObject({ status: 'failed', error: 'The text was not sent: Invalid number' });
    expect(bad.marked[0]).toMatchObject({ status: 'failed', provider_ref: null });
    const done = world({ msg: { status: 'sent' } });
    expect(await sendMessage(done.deps, done.mstore, 'tok', 'm1')).toEqual({ status: 'already_sent' });
    expect(done.calls).toHaveLength(0);
  });

  it('fails clearly when the customer has no phone or email, and refuses when the service is not set up, switched off, or the person may not send', async () => {
    const noPhone = world({ contact: { name: 'Lee', email: 'l@x.com', phone: null } });
    expect(await sendMessage(noPhone.deps, noPhone.mstore, 'tok', 'm1')).toMatchObject({ status: 'failed', error: expect.stringMatching(/no phone number/) });
    expect(noPhone.calls).toHaveLength(0);
    const notSet = world({ env: { TWILIO_AUTH_TOKEN: '' } });
    await expect(sendMessage(notSet.deps, notSet.mstore, 'tok', 'm1')).rejects.toThrow(/not set up yet/);
    expect(notSet.marked).toHaveLength(0); // not set up is not the message's fault, so it stays waiting
    const off = world({ env: { MESSAGES_DISABLED: '1' } });
    await expect(sendMessage(off.deps, off.mstore, 'tok', 'm1')).rejects.toThrow(/switched off/);
    await expect(sendMessage(world({ role: 'tech' }).deps, world().mstore, 'tok', 'm1')).rejects.toThrow(/Only the owner/);
    await expect(sendMessage(world().deps, world().mstore, null, 'm1')).rejects.toThrow(/Sign in/);
  });
});

import { sendMessageSafely } from '../api/_lib/messageSend';

describe('a surprise while sending', () => {
  it('is reported with what went wrong, without any key or token in it', async () => {
    const w = world();
    const broken: MessageStore = { ...w.mstore, getMessage: async () => { throw new Error('connection refused using key re_abc123XYZ789secret'); } };
    await expect(sendMessageSafely(w.deps, broken, 'tok', 'm1')).rejects.toThrow(/Sending failed on the server: connection refused using key \[hidden\]/);
    await expect(sendMessageSafely(world({ env: { MESSAGES_DISABLED: '1' } }).deps, w.mstore, 'tok', 'm1')).rejects.toThrow(/switched off/); // known problems keep their own wording
  });
});

import { sendSettingProblem } from '../api/_lib/messageSend';

describe('checking the sending settings for pasting mistakes', () => {
  const good = { RESEND_API_KEY: RESEND_KEY, RESEND_FROM: 'That Handyman Van <aaronr@thathandymanvan.com>', TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15125550000' };

  it('accepts good settings, including a name and address in angle brackets', () => {
    expect(sendSettingProblem(good, 'email')).toBeNull();
    expect(sendSettingProblem({ ...good, RESEND_FROM: 'office@thathandymanvan.com' }, 'email')).toBeNull();
    expect(sendSettingProblem(good, 'sms')).toBeNull();
  });

  it('names a key pasted with extra lines or text, and never shows it', () => {
    const multi = `Bearer ${RESEND_KEY}\n\nanother line`;
    const m = sendSettingProblem({ ...good, RESEND_API_KEY: multi }, 'email');
    expect(m).toMatch(/not just a Resend key/);
    expect(m).not.toContain(RESEND_KEY);
    expect(sendSettingProblem({ ...good, RESEND_API_KEY: RESEND_KEY + '\n' }, 'email')).toMatch(/not just a Resend key/);
    expect(sendSettingProblem({ ...good, RESEND_API_KEY: 'sk-wrong-kind-of-key-123456789' }, 'email')).toMatch(/starts with re_/);
    expect(sendSettingProblem({ ...good, RESEND_FROM: 'not an address' }, 'email')).toMatch(/RESEND_FROM/);
  });

  it('checks the Twilio settings too', () => {
    expect(sendSettingProblem({ ...good, TWILIO_ACCOUNT_SID: 'wrong' }, 'sms')).toMatch(/TWILIO_ACCOUNT_SID/);
    expect(sendSettingProblem({ ...good, TWILIO_AUTH_TOKEN: 'short' }, 'sms')).toMatch(/TWILIO_AUTH_TOKEN/);
    expect(sendSettingProblem({ ...good, TWILIO_FROM: '512-555-0000' }, 'sms')).toMatch(/TWILIO_FROM/);
  });

  it('is reported to the person when sending, and nothing is sent', async () => {
    const w = world({ env: { RESEND_API_KEY: RESEND_KEY + '\nextra' }, msg: { channel: 'email' } });
    await expect(sendMessage(w.deps, w.mstore, 'tok', 'm1')).rejects.toThrow(/not just a Resend key/);
    expect(w.calls).toHaveLength(0);
  });
});
