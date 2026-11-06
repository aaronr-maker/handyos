import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serverEnv } from '../store.js';
import { handleIncoming, supabaseVoiceStore, VoiceError } from '../voiceCalls.js';
import { formBody, voiceDeps } from '../voiceHttp.js';

/** Twilio calls this when a customer rings the company's number. Answers with instructions for the call. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const xml = await handleIncoming(voiceDeps(supabaseVoiceStore(serverEnv())), formBody(req), req.headers['x-twilio-signature'] as string | undefined);
    res.status(200).setHeader('Content-Type', 'text/xml').send(xml);
  } catch (err) {
    if (err instanceof VoiceError) return void res.status(err.status).send(err.message);
    console.error('Incoming call failed:', err instanceof Error ? err.message : err);
    res.status(200).setHeader('Content-Type', 'text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, something went wrong. Please call again in a moment.</Say><Hangup/></Response>');
  }
}
