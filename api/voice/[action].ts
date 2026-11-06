import type { VercelRequest, VercelResponse } from '@vercel/node';
import audio from '../_lib/voiceRoutes/audio.js';
import incoming from '../_lib/voiceRoutes/incoming.js';
import recording from '../_lib/voiceRoutes/recording.js';
import step from '../_lib/voiceRoutes/step.js';

/**
 * One function for all the phone addresses (/api/voice/incoming, /step, /recording, /audio), because the free Vercel plan
 * allows only 12 functions in all.
 */
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = { incoming, step, recording, audio };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = String(Array.isArray(req.query.action) ? req.query.action[0] : req.query.action ?? '');
  const route = Object.hasOwn(routes, name) ? routes[name] : null;
  if (!route) return void res.status(404).json({ error: 'Not found.' });
  await route(req, res);
}
