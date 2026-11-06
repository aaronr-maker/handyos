import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps } from '../handler.js';
import { serverEnv } from '../store.js';

/**
 * GET ?id=<voicemail id>: plays one voicemail for a signed-in owner, admin or office person. Twilio keeps recordings behind the
 * account's login, so the server fetches it and hands over the sound. The address it fetches comes from our own database
 * (never from the browser) and must be Twilio's.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const token = bearer(req);
    if (!token) return void res.status(401).json({ error: 'Sign in first.' });
    const deps = realDeps();
    const user = await deps.store.userFromToken(token);
    const member = user ? await deps.store.membership(user.id) : null;
    if (!member || !['owner', 'admin', 'office'].includes(member.role)) return void res.status(403).json({ error: 'Only the owner, admins and office can hear voicemails.' });
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !auth) return void res.status(503).json({ error: 'Twilio is not set up on the server yet (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN).' });
    const db = createClient(serverEnv().SUPABASE_URL as string, serverEnv().SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });
    const { data } = await db.from('voicemails').select('recording_url').eq('company_id', member.companyId).eq('id', String(req.query.id ?? '')).maybeSingle();
    const url = data?.recording_url as string | undefined;
    if (!url || !url.startsWith('https://api.twilio.com/')) return void res.status(404).json({ error: 'That voicemail was not found.' });
    const upstream = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}` } });
    if (!upstream.ok) return void res.status(502).json({ error: 'Twilio would not hand over the recording.' });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error('Playing a voicemail failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
