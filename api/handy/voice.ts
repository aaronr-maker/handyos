import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { handyVoiceSession } from '../_lib/handyChat.js';

/** POST { instructions, tools }: a short-lived pass for a voice call with OpenAI. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { instructions?: string; tools?: unknown[]; voice?: string };
  await respond(res, () => handyVoiceSession(realDeps(), bearer(req), body));
}
