import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serverEnv } from '../store.js';
import { handleStep, supabaseVoiceStore, VoiceError } from '../voiceCalls.js';
import { formBody, voiceDeps } from '../voiceHttp.js';

/** Twilio comes back here after each step of a call (a key pressed, a ring that ended, a recording). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // the router adds its own `action` field; Twilio signed the address without it
    const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    params.delete('action');
    const raw = params.toString();
    const query = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
    const xml = await handleStep(voiceDeps(supabaseVoiceStore(serverEnv()), req), query, raw, formBody(req), req.headers['x-twilio-signature'] as string | undefined);
    res.status(200).setHeader('Content-Type', 'text/xml').send(xml);
  } catch (err) {
    if (err instanceof VoiceError) return void res.status(err.status).send(err.message);
    console.error('Call step failed:', err instanceof Error ? err.message : err);
    res.status(200).setHeader('Content-Type', 'text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>');
  }
}
