import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { WebSocket, WebSocketServer } from 'ws';
import { handleAssistantCall } from './assistant.js';
import { speakerOf, summaryRequest, validStreamToken, type Line } from './logic.js';

/**
 * Receives a phone call's audio from Twilio (Media Streams), has OpenAI type it out as the call happens, saves each line for the
 * HandyOS call screen, and writes a short summary when the call ends. Audio is never saved.
 *
 * Settings: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STREAM_SECRET (same as in Vercel).
 * Optional: TRANSCRIBE_MODEL (default gpt-4o-mini-transcribe), SUMMARY_MODEL (default gpt-4o-mini), PORT.
 */
const env = process.env;
const need = (k: string) => {
  const v = env[k]?.trim();
  if (!v) throw new Error(`${k} is not set.`);
  return v;
};
const OPENAI_KEY = need('OPENAI_API_KEY');
const STREAM_SECRET = need('STREAM_SECRET');
// settings pasted with spaces, quotes, a trailing slash or a /rest/v1 tail are cleaned up
const tidyUrl = (u: string) =>
  u
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/+$/, '');
const URL_ = tidyUrl(need('SUPABASE_URL'));
const KEY = need('SUPABASE_SERVICE_ROLE_KEY').replace(/\s|^["']|["']$/g, '');
const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const why = (e: { message?: string; code?: string; details?: string; hint?: string }, status?: number, statusText?: string) =>
  JSON.stringify({ status, statusText, message: e.message, code: e.code, details: e.details, hint: e.hint, keyStartsWith: KEY.slice(0, 6), urlHost: new URL(URL_).host });
const TRANSCRIBE_MODEL = env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const SUMMARY_MODEL = env.SUMMARY_MODEL || 'gpt-4o-mini';

const http = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : '');
});
// two kinds of call audio arrive here: /stream (live transcript of a call to someone's phone) and /ai (the AI receptionist)
const wss = new WebSocketServer({ noServer: true });
const assistantWss = new WebSocketServer({ noServer: true });
http.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  const target = path === '/stream' ? wss : path === '/ai' ? assistantWss : null;
  if (!target) return void socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});
const APP_URL = (env.APP_URL ?? '').trim();
assistantWss.on('connection', (twilio) => {
  if (!APP_URL) {
    console.error('APP_URL is not set on this server, so the AI receptionist cannot reach the company app. Set APP_URL (like https://app.example.com).');
    return twilio.close();
  }
  handleAssistantCall(twilio, {
    openaiKey: OPENAI_KEY,
    streamSecret: STREAM_SECRET,
    appUrl: APP_URL,
    model: env.AI_REALTIME_MODEL || 'gpt-realtime',
    companyName: env.COMPANY_NAME || 'That Handyman Van',
    saveLine: (companyId, callSid, speaker, body) => {
      void db
        .from('call_transcripts')
        .insert({ company_id: companyId, call_sid: callSid, speaker, body })
        .then(({ error }) => error && console.error('Saving a line failed:', error.message));
    },
    finish: (companyId, callSid, lines) => void summarize(companyId, callSid, lines).catch((e) => console.error('Summary problem:', e instanceof Error ? e.message : e)),
  });
});

interface Leg {
  ws: WebSocket;
  ready: boolean;
  queue: string[];
}

/** One connection to OpenAI that types out one side of the call. */
function openLeg(onText: (text: string) => void): Leg {
  const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', { headers: { Authorization: `Bearer ${OPENAI_KEY}` } });
  const leg: Leg = { ws, ready: false, queue: [] };
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        type: 'session.update',
        session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcmu' }, transcription: { model: TRANSCRIBE_MODEL, language: 'en' }, turn_detection: { type: 'server_vad' } } } },
      }),
    );
    leg.ready = true;
    for (const a of leg.queue) ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: a }));
    leg.queue = [];
  });
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(String(raw)) as { type?: string; transcript?: string; error?: { message?: string } };
      if (m.type === 'conversation.item.input_audio_transcription.completed' && m.transcript?.trim()) onText(m.transcript.trim());
      if (m.type === 'error') console.error('OpenAI said:', m.error?.message);
    } catch {
      /* ignore anything that is not JSON */
    }
  });
  ws.on('error', (e) => console.error('OpenAI connection problem:', e.message));
  return leg;
}

async function summarize(companyId: string, callSid: string, lines: Line[]) {
  const req = summaryRequest(lines);
  if (!req) return;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      store: false,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  });
  if (!res.ok) return console.error('The summary request failed:', res.status);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const summary = json.choices?.[0]?.message?.content?.trim();
  if (!summary) return;
  const { error, status, statusText } = await db.from('call_log').update({ summary }).eq('company_id', companyId).eq('call_sid', callSid);
  if (error) console.error('Saving the summary failed:', why(error, status, statusText));
}

wss.on('connection', (twilio) => {
  let companyId = '';
  let callSid = '';
  const legs: Record<string, Leg> = {};
  const lines: Line[] = [];

  const hear = (speaker: 'caller' | 'team') => (body: string) => {
    lines.push({ speaker, body, at: Date.now() });
    void db
      .from('call_transcripts')
      .insert({ company_id: companyId, call_sid: callSid, speaker, body })
      .then(({ error, status, statusText }) => {
        if (error) console.error('Saving a transcript line failed:', why(error, status, statusText));
      });
  };

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    // give the last words a moment to arrive, then close and summarize
    setTimeout(() => {
      for (const l of Object.values(legs)) l.ws.close();
      if (companyId && callSid) void summarize(companyId, callSid, lines).catch((e) => console.error('Summary problem:', e instanceof Error ? e.message : e));
    }, 2500);
  };

  twilio.on('message', (raw) => {
    let m: { event?: string; start?: { customParameters?: Record<string, string> }; media?: { track?: string; payload?: string } };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.event === 'start') {
      const p = m.start?.customParameters ?? {};
      if (!validStreamToken(STREAM_SECRET, p.callSid ?? '', p.companyId ?? '', p.token ?? '')) {
        console.error('Refused a stream without a valid token.');
        return twilio.close();
      }
      callSid = p.callSid;
      companyId = p.companyId;
    } else if (m.event === 'media' && callSid && m.media?.payload) {
      const track = m.media.track === 'outbound' ? 'outbound' : 'inbound';
      const leg = (legs[track] ??= openLeg(hear(speakerOf(track))));
      if (leg.ready) leg.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: m.media.payload }));
      else leg.queue.push(m.media.payload);
    } else if (m.event === 'stop') finish();
  });
  twilio.on('close', finish);
});

http.listen(Number(env.PORT) || 8080, () => console.log('Voice server listening.'));
