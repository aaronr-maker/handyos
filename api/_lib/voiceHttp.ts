import type { VercelRequest } from '@vercel/node';
import type { VoiceDeps, VoiceStore } from './voiceCalls.js';

/** Twilio sends form fields; Vercel hands them over as an object (or, rarely, a string). */
export function formBody(req: VercelRequest): Record<string, string> {
  const b = req.body as unknown;
  if (typeof b === 'string') return Object.fromEntries(new URLSearchParams(b)) as Record<string, string>;
  return Object.fromEntries(Object.entries((b as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v)]));
}

export const voiceDeps = (store: VoiceStore): VoiceDeps => ({ store, env: { TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN, APP_URL: process.env.APP_URL, VOICE_AI_READY: process.env.VOICE_AI_READY }, now: () => Date.now() });
