import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { driveMinutes, supabaseTravelStore, travelSettings } from '../_lib/travel.js';
import { ApiError } from '../_lib/qb.js';
import { serverEnv } from '../_lib/store.js';

/** POST { pairs: [{ from, to }] } (addresses): drive minutes for each trip, for signed-in members of a company. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { pairs?: { from?: string; to?: string }[] };
  await respond(res, async () => {
    const token = bearer(req);
    if (!token) throw new ApiError(401, 'Sign in first.');
    const deps = realDeps();
    const user = await deps.store.userFromToken(token);
    const member = user ? await deps.store.membership(user.id) : null;
    if (!member) throw new ApiError(403, 'You are not part of a company here.');
    const pairs = (body.pairs ?? []).slice(0, 200).map((p) => ({ from: String(p.from ?? '').slice(0, 300), to: String(p.to ?? '').slice(0, 300) }));
    const minutes = await driveMinutes(deps, supabaseTravelStore(serverEnv()), travelSettings(process.env), member.companyId, pairs);
    return { minutes };
  });
}
