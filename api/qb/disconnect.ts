import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler';
import { disconnect } from '../_lib/qb';

/** POST: unlinks the company's QuickBooks and deletes the stored tokens. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  await respond(res, () => disconnect(realDeps(), bearer(req)));
}
