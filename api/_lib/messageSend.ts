import { createClient } from '@supabase/supabase-js';
import { ApiError, type Deps } from './qb.js';

/**
 * Delivering a saved customer message by email (Resend) or text (Twilio). It runs only when a person asks for it, reads the
 * message and the customer's contact from the database itself (nothing about where it goes comes from the browser), and records
 * the result: 'sent' with the service's reference, or 'failed' with a plain reason. Messages are never marked sent unless the
 * service accepted them. Settings (all on the server): RESEND_API_KEY and RESEND_FROM for email; TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_FROM for texts. MESSAGES_DISABLED=1 stops all sending.
 */
export interface StoredMessage {
  id: string;
  customer_id: string;
  channel: 'sms' | 'email';
  body: string;
  direction: 'outbound' | 'inbound';
  status: 'queued' | 'sent' | 'failed';
}
export interface MessageStore {
  getMessage(companyId: string, id: string): Promise<StoredMessage | null>;
  customerContact(companyId: string, customerId: string): Promise<{ name: string; email: string | null; phone: string | null } | null>;
  companyName(companyId: string): Promise<string>;
  markMessage(companyId: string, id: string, result: { status: 'sent' | 'failed'; provider_ref: string | null; error: string | null }): Promise<void>;
}

export interface SendEnv {
  MESSAGES_DISABLED?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
}

/** Digits to the +1XXXXXXXXXX form Twilio wants (US numbers); anything else is passed through if it already starts with +. */
export function toE164(phone: string): string | null {
  const d = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+') && d.length >= 8) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

async function reason(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string | { message?: string } };
  const text = j.message ?? (typeof j.error === 'string' ? j.error : j.error?.message);
  return text ? `${text}` : `the service answered ${res.status}`;
}

/** Sends one saved message. Returns the new status. */
export async function sendMessage(
  deps: Deps & { env: Deps['env'] & SendEnv },
  mstore: MessageStore,
  token: string | null,
  messageId: string,
): Promise<{ status: 'sent' | 'failed' | 'already_sent'; error?: string }> {
  if (!token) throw new ApiError(401, 'Sign in first.');
  const user = await deps.store.userFromToken(token);
  if (!user) throw new ApiError(401, 'Sign in first.');
  const m = await deps.store.membership(user.id);
  if (!m || !['owner', 'admin', 'office'].includes(m.role)) throw new ApiError(403, 'Only the owner, admins and office can send messages.');
  const env = deps.env;
  if (env.MESSAGES_DISABLED === '1' || env.MESSAGES_DISABLED === 'true') throw new ApiError(423, 'Sending messages is switched off on the server.');

  const msg = await mstore.getMessage(m.companyId, messageId);
  if (!msg || msg.direction !== 'outbound') throw new ApiError(404, 'That message was not found.');
  if (msg.status === 'sent') return { status: 'already_sent' };
  const contact = await mstore.customerContact(m.companyId, msg.customer_id);
  if (!contact) throw new ApiError(404, 'That customer was not found.');

  const fail = async (error: string) => {
    await mstore.markMessage(m.companyId, msg.id, { status: 'failed', provider_ref: null, error });
    return { status: 'failed' as const, error };
  };

  if (msg.channel === 'email') {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM) throw new ApiError(503, 'Email sending is not set up yet (RESEND_API_KEY and RESEND_FROM are missing on the server).');
    if (!contact.email) return fail('There is no email address on file for this customer.');
    const company = await mstore.companyName(m.companyId);
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [contact.email], subject: `A message from ${company}`, text: msg.body }),
    });
    if (!res.ok) return fail(`Email was not sent: ${await reason(res)}`);
    const id = ((await res.json().catch(() => ({}))) as { id?: string }).id ?? null;
    await mstore.markMessage(m.companyId, msg.id, { status: 'sent', provider_ref: id, error: null });
    return { status: 'sent' };
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) throw new ApiError(503, 'Text sending is not set up yet (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are missing on the server).');
  const to = contact.phone ? toE164(contact.phone) : null;
  if (!to) return fail(contact.phone ? 'The phone number on file does not look like a valid number.' : 'There is no phone number on file for this customer.');
  const res = await deps.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: msg.body }).toString(),
  });
  if (!res.ok) return fail(`The text was not sent: ${await reason(res)}`);
  const sid = ((await res.json().catch(() => ({}))) as { sid?: string }).sid ?? null;
  await mstore.markMessage(m.companyId, msg.id, { status: 'sent', provider_ref: sid, error: null });
  return { status: 'sent' };
}

/** The real database side (server key). */
export function supabaseMessageStore(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): MessageStore {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the server.');
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return {
    async getMessage(companyId, id) {
      const { data } = await db.from('messages').select('id, customer_id, channel, body, direction, status').eq('company_id', companyId).eq('id', id).maybeSingle();
      return (data as StoredMessage | null) ?? null;
    },
    async customerContact(companyId, customerId) {
      const { data } = await db.from('customers').select('name, email, phone').eq('company_id', companyId).eq('id', customerId).maybeSingle();
      return data ? { name: data.name as string, email: (data.email as string | null) ?? null, phone: (data.phone as string | null) ?? null } : null;
    },
    async companyName(companyId) {
      const { data } = await db.from('companies').select('name').eq('id', companyId).maybeSingle();
      return (data?.name as string | undefined) ?? 'your service company';
    },
    async markMessage(companyId, id, r) {
      const { error } = await db.from('messages').update({ status: r.status, provider_ref: r.provider_ref, error: r.error }).eq('company_id', companyId).eq('id', id);
      if (error) throw new Error(`Saving the result: ${error.message}`);
    },
  };
}

/**
 * Sends one message, and turns any surprise into a message that says what went wrong (without secrets), so the Messages page
 * shows a real reason instead of "something went wrong".
 */
export async function sendMessageSafely(
  deps: Deps & { env: Deps['env'] & SendEnv },
  mstore: MessageStore,
  token: string | null,
  messageId: string,
): Promise<{ status: 'sent' | 'failed' | 'already_sent'; error?: string }> {
  try {
    return await sendMessage(deps, mstore, token, messageId);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    console.error('Sending a message failed:', reason);
    throw new ApiError(500, `Sending failed on the server: ${reason.replace(/(sk|re|key|token)[-_][A-Za-z0-9_-]{8,}/gi, '[hidden]').slice(0, 300)}`);
  }
}
