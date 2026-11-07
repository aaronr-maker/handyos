import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps } from '../handler.js';
import { tokenSettings, voiceAccessToken } from '../twilioToken.js';

/** The phone app asks for its calling pass here (signed in as the person it is for). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const token = bearer(req);
    if (!token) return void res.status(401).json({ error: 'Sign in first.' });
    const deps = realDeps();
    const user = await deps.store.userFromToken(token);
    const member = user ? await deps.store.membership(user.id) : null;
    if (!user || !member) return void res.status(403).json({ error: 'You are not part of a company here.' });
    const found = tokenSettings(process.env);
    if ('problem' in found) return void res.status(503).json({ error: found.problem });
    // the identity is the person's id, which is exactly what the call tree rings ("client:<id>")
    res.status(200).json({ token: voiceAccessToken(found.settings, user.id, Math.floor(Date.now() / 1000)), identity: user.id });
  } catch (err) {
    console.error('Making a calling pass failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
