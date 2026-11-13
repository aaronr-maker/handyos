import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serverEnv } from '../store.js';
import { bookEstimate, driveLookup, findOffers, requestCallback, supabaseReceptionistStore } from '../receptionistApi.js';

/**
 * The phone assistant's three requests, made by the voice server during a call: find open estimate times, book one, ask for a
 * callback. Only the voice server can call them (it shares STREAM_SECRET with this app), and the company comes from the call it
 * already verified, never from what a caller says.
 */
const allowed = (req: VercelRequest): boolean => {
  const secret = (process.env.STREAM_SECRET ?? '').trim();
  const sent = String(req.headers['x-voice-secret'] ?? '');
  const a = Buffer.from(secret);
  const b = Buffer.from(sent);
  return secret.length >= 16 && a.length === b.length && timingSafeEqual(a, b);
};

const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default function ai(action: 'availability' | 'book' | 'callback') {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') return void res.status(405).json({ error: 'Use POST.' });
    if (!allowed(req)) return void res.status(403).json({ error: 'Not allowed.' });
    try {
      const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as Record<string, unknown>;
      const companyId = text(body.companyId, 60);
      if (!companyId) return void res.status(400).json({ error: 'No company.' });
      const env = serverEnv();
      const store = supabaseReceptionistStore(env);
      const drives = driveLookup({ fetch, now: () => Date.now() }, { ...env, ORS_API_KEY: process.env.ORS_API_KEY, ORS_BASE_URL: process.env.ORS_BASE_URL }, companyId);
      const now = Date.now();
      if (action === 'availability') {
        const address = text(body.address);
        if (address.length < 6) return void res.status(200).json({ ok: false, reason: 'I need the full street address first.' });
        return void res.status(200).json(await findOffers(store, drives, companyId, address, now));
      }
      if (action === 'book') {
        const start = Number(body.start);
        const r = await bookEstimate(store, drives, companyId, { address: text(body.address), name: text(body.name, 100), phone: text(body.phone, 30), sellerId: text(body.sellerId, 60), start, language: text(body.language, 40) || undefined, notes: text(body.notes, 600) || undefined, callSid: text(body.callSid, 60) || undefined }, now);
        return void res.status(200).json(r);
      }
      const r = await requestCallback(store, companyId, { name: text(body.name, 100) || undefined, phone: text(body.phone, 30) || undefined, address: text(body.address) || undefined, language: text(body.language, 40) || undefined, notes: text(body.notes, 1000) || 'Asked for a call back.', callSid: text(body.callSid, 60) || undefined });
      return void res.status(200).json(r);
    } catch (err) {
      console.error('The phone assistant request failed:', err instanceof Error ? err.message : err);
      return void res.status(200).json({ ok: false, reason: 'Something went wrong on our side.' });
    }
  };
}
