import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { handyChat, type ChatMessage, type ToolDef } from '../_lib/handyChat.js';

/** POST { messages, tools }: Handy's next message. The conversation arrives already masked and is never stored here. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { messages?: ChatMessage[]; tools?: ToolDef[] };
  await respond(res, () => handyChat(realDeps(), bearer(req), body));
}
