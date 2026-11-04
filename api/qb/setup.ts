import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { listSetup } from '../_lib/qbPush.js';

/** POST: the company's QuickBooks income accounts, deposit accounts and sales tax codes, to choose from in the sync settings. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  await respond(res, () => listSetup(realDeps(), bearer(req)));
}
