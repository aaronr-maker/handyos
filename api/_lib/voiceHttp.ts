import type { VercelRequest } from '@vercel/node';
import type { VoiceDeps, VoiceStore } from './voiceCalls.js';

/** Twilio sends form fields; Vercel hands them over as an object (or, rarely, a string). */
export function formBody(req: VercelRequest): Record<string, string> {
  const b = req.body as unknown;
  if (typeof b === 'string') return Object.fromEntries(new URLSearchParams(b)) as Record<string, string>;
  return Object.fromEntries(Object.entries((b as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v)]));
}

/** The public address a request came in on. */
export function originOf(req: VercelRequest): string | undefined {
  const pick = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h)?.split(',')[0].trim();
  const host = pick(req.headers['x-forwarded-host']) || pick(req.headers.host);
  return host ? `${pick(req.headers['x-forwarded-proto']) || 'https'}://${host}` : undefined;
}

export const voiceDeps = (store: VoiceStore, req?: VercelRequest): VoiceDeps => ({ store, origin: req ? originOf(req) : undefined, env: { TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN, APP_URL: process.env.APP_URL, VOICE_AI_READY: process.env.VOICE_AI_READY, VOICE_STREAM_URL: process.env.VOICE_STREAM_URL, STREAM_SECRET: process.env.STREAM_SECRET }, now: () => Date.now() });
