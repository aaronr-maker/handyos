import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { syncMonth } from '../_lib/qb.js';

/** POST { month: "2026-10", method?: "Cash" (the default) | "Accrual" }: the month's cost accounts from QuickBooks, for review in the app. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { month?: string; method?: string };
  await respond(res, () => syncMonth(realDeps(), bearer(req), String(body.month ?? ''), body.method === 'Accrual' ? 'Accrual' : 'Cash'));
}
