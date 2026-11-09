import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { ApiError } from '../_lib/qb.js';
import { serverEnv } from '../_lib/store.js';
import { driveMinutes, suggestAddresses, supabaseTravelStore, travelSettings } from '../_lib/travel.js';

/**
 * POST /api/travel/times { pairs: [{ from, to }] }: drive minutes for each trip.
 * POST /api/travel/suggest { text }: address suggestions for what is typed so far.
 * Both are for signed-in members of a company; the map key stays here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const action = String(Array.isArray(req.query.action) ? req.query.action[0] : req.query.action ?? '');
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { pairs?: { from?: string; to?: string }[]; text?: string };
  await respond(res, async () => {
    const token = bearer(req);
    if (!token) throw new ApiError(401, 'Sign in first.');
    const deps = realDeps();
    const user = await deps.store.userFromToken(token);
    const member = user ? await deps.store.membership(user.id) : null;
    if (!member) throw new ApiError(403, 'You are not part of a company here.');
    const settings = travelSettings(process.env);
    if (action === 'suggest') return { suggestions: await suggestAddresses(deps, settings, String(body.text ?? '').slice(0, 200)) };
    if (action === 'times') {
      const pairs = (body.pairs ?? []).slice(0, 200).map((p) => ({ from: String(p.from ?? '').slice(0, 300), to: String(p.to ?? '').slice(0, 300) }));
      return { minutes: await driveMinutes(deps, supabaseTravelStore(serverEnv()), settings, member.companyId, pairs) };
    }
    throw new ApiError(404, 'Not found.');
  });
}
