import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serverEnv } from '../store.js';
import { handleRecording, supabaseVoiceStore, VoiceError } from '../voiceCalls.js';
import { formBody, voiceDeps } from '../voiceHttp.js';

/** Twilio tells us a voicemail recording is ready. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await handleRecording(voiceDeps(supabaseVoiceStore(serverEnv())), formBody(req), req.headers['x-twilio-signature'] as string | undefined);
    res.status(200).send('ok');
  } catch (err) {
    if (err instanceof VoiceError) return void res.status(err.status).send(err.message);
    console.error('Saving a voicemail failed:', err instanceof Error ? err.message : err);
    res.status(500).send('error');
  }
}
