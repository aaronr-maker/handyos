import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { sendMessageSafely, supabaseMessageStore, type SendEnv } from '../_lib/messageSend.js';
import { serverEnv } from '../_lib/store.js';

/** POST { message_id }: delivers one saved customer message by email or text, when a person asks. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { message_id?: string };
  await respond(res, () => {
    const deps = realDeps();
    const e = process.env;
    const sending: SendEnv = { MESSAGES_DISABLED: e.MESSAGES_DISABLED, RESEND_API_KEY: e.RESEND_API_KEY, RESEND_FROM: e.RESEND_FROM, TWILIO_ACCOUNT_SID: e.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: e.TWILIO_AUTH_TOKEN, TWILIO_FROM: e.TWILIO_FROM };
    const env = { ...deps.env, ...sending };
    return sendMessageSafely({ ...deps, env }, supabaseMessageStore(serverEnv()), bearer(req), String(body.message_id ?? ''));
  });
}
