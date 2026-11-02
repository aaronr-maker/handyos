import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler';
import { startConnect } from '../_lib/qb';

/** POST: returns the QuickBooks sign-in address for the signed-in owner/admin's company. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  await respond(res, () => startConnect(realDeps(), bearer(req)));
}
