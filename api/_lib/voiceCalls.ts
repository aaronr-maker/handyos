import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterDial, afterMenu, DAYS, DEFAULT_HOURS, toTwiml, walk, type Env, type Flow, type Hours, type Step } from './callEngine.js';

/**
 * Answering the phone. Twilio calls these functions when a customer rings the company's number and after each step
 * (a key pressed, a ring that ended, a recording). Each answer is a set of instructions (TwiML) built by the call tree
 * engine. Everything Twilio sends is checked against its signature first, so nobody else can make this address act.
 */
export interface CompanyPhone {
  companyId: string;
  hours: Hours;
  voice: string;
}

export interface VoiceStore {
  /** The company whose Twilio number was called. */
  findCompany(toNumber: string): Promise<CompanyPhone | null>;
  /** The tree that answers the phone, if one is switched on. */
  activeFlow(companyId: string): Promise<Flow | null>;
  /** Team member id -> phone, and id -> name. */
  team(companyId: string): Promise<{ phones: Record<string, string>; names: Record<string, string> }>;
  logCall(companyId: string, callSid: string, patch: { from?: string; to?: string; trail?: string[]; outcome?: string }): Promise<void>;
  saveVoicemail(companyId: string, v: { callSid: string; from: string | null; recordingUrl: string; seconds: number }): Promise<void>;
}

export interface VoiceDeps {
  store: VoiceStore;
  env: { TWILIO_AUTH_TOKEN?: string; APP_URL?: string; VOICE_AI_READY?: string };
  now: () => number;
}

export class VoiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Twilio signs each request: HMAC-SHA1 of the full address plus every field (sorted by name), with the account's auth token. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function verifyTwilio(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const a = Buffer.from(twilioSignature(authToken, url, params));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const FALLBACK_SAY = 'Thank you for calling. We are not able to take your call right now. Please try again later.';

function check(deps: VoiceDeps, path: string, query: string, params: Record<string, string>, signature: string | undefined): string {
  const token = deps.env.TWILIO_AUTH_TOKEN;
  const base = deps.env.APP_URL;
  if (!token || !base) throw new VoiceError(503, 'The phone system is not set up on the server yet (TWILIO_AUTH_TOKEN and APP_URL).');
  const url = `${base.replace(/\/$/, '')}${path}${query ? `?${query}` : ''}`;
  if (!verifyTwilio(token, url, params, signature)) throw new VoiceError(403, 'This request did not come from Twilio.');
  return base.replace(/\/$/, '');
}

const env = (deps: VoiceDeps, c: CompanyPhone, team: { phones: Record<string, string>; names: Record<string, string> }): Env => ({ now: deps.now(), hours: c.hours, phones: team.phones, names: team.names, aiReady: deps.env.VOICE_AI_READY === '1' });

const render = (step: Step, base: string, c: CompanyPhone, callerId?: string) => toTwiml(step, { stepUrl: `${base}/api/voice/step`, voice: c.voice, recordingUrl: `${base}/api/voice/recording`, callerId });

const hangupWith = (text: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${text}</Say><Hangup/></Response>`;

/** A customer is calling the company's number. */
export async function handleIncoming(deps: VoiceDeps, params: Record<string, string>, signature: string | undefined): Promise<string> {
  const base = check(deps, '/api/voice/incoming', '', params, signature);
  const company = await deps.store.findCompany(params.To ?? '');
  if (!company) return hangupWith(FALLBACK_SAY);
  const flow = await deps.store.activeFlow(company.companyId);
  if (!flow) return hangupWith(FALLBACK_SAY);
  const team = await deps.store.team(company.companyId);
  const start = flow.nodes.find((n) => n.kind === 'start');
  const step = walk(flow, start?.id ?? null, env(deps, company, team));
  await deps.store.logCall(company.companyId, params.CallSid ?? '', { from: params.From, to: params.To, trail: step.trail, outcome: 'started' });
  return render(step, base, company, params.From);
}

/** Twilio comes back after a step: `query` says which block and what happened. */
export async function handleStep(deps: VoiceDeps, query: Record<string, string>, rawQuery: string, params: Record<string, string>, signature: string | undefined): Promise<string> {
  const base = check(deps, '/api/voice/step', rawQuery, params, signature);
  const company = await deps.store.findCompany(params.To ?? params.Called ?? '');
  if (!company) return hangupWith(FALLBACK_SAY);
  const flow = await deps.store.activeFlow(company.companyId);
  if (!flow) return hangupWith(FALLBACK_SAY);
  const team = await deps.store.team(company.companyId);
  const e = env(deps, company, team);
  const node = query.node ?? '';
  let step: Step;
  let outcome = 'in progress';
  if (query.ev === 'menu') {
    const digit = params.Digits && /^[0-9*#]$/.test(params.Digits) ? params.Digits : null;
    step = afterMenu(flow, node, digit, e, Number(query.attempt) || 1);
  } else if (query.ev === 'dial') {
    const answered = params.DialCallStatus === 'completed' || params.DialCallStatus === 'answered';
    step = afterDial(flow, node, answered, e, Number(query.idx) || 0);
    if (answered) outcome = 'answered';
  } else if (query.ev === 'record') {
    step = { say: [], pause: { type: 'hangup', node }, trail: [node] };
    outcome = 'voicemail';
  } else {
    step = { say: [], pause: { type: 'hangup', node: null }, trail: [] };
  }
  await deps.store.logCall(company.companyId, params.CallSid ?? '', { trail: step.trail, outcome });
  return render(step, base, company, params.From);
}

/** Twilio says a voicemail recording is ready. */
export async function handleRecording(deps: VoiceDeps, params: Record<string, string>, signature: string | undefined): Promise<void> {
  check(deps, '/api/voice/recording', '', params, signature);
  const company = await deps.store.findCompany(params.To ?? params.Called ?? '');
  if (!company || !params.RecordingUrl) return;
  await deps.store.saveVoicemail(company.companyId, { callSid: params.CallSid ?? '', from: params.From ?? null, recordingUrl: `${params.RecordingUrl}.mp3`, seconds: Number(params.RecordingDuration) || 0 });
}

// ---- the real database side (server key) ----
const norm = (n: string) => n.replace(/[^\d+]/g, '');

export function supabaseVoiceStore(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): VoiceStore {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the server.');
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return {
    async findCompany(to) {
      const { data } = await db.from('call_settings').select('company_id, number, timezone, hours, voice');
      const row = (data ?? []).find((r) => r.number && norm(String(r.number)) === norm(to));
      if (!row) return null;
      const week = { ...DEFAULT_HOURS.week };
      for (const d of DAYS) if (row.hours && Array.isArray((row.hours as Record<string, unknown>)[d])) week[d] = (row.hours as Record<string, { open: string; close: string }[]>)[d];
      return { companyId: row.company_id as string, hours: { timezone: (row.timezone as string) || DEFAULT_HOURS.timezone, week }, voice: (row.voice as string) || 'Polly.Joanna' };
    },
    async activeFlow(companyId) {
      const { data } = await db.from('call_flows').select('graph').eq('company_id', companyId).eq('active', true).maybeSingle();
      return (data?.graph as Flow | undefined) ?? null;
    },
    async team(companyId) {
      const [{ data: phones }, { data: users }] = await Promise.all([db.from('team_phones').select('user_id, phone').eq('company_id', companyId), db.from('users').select('id, full_name, email').eq('company_id', companyId)]);
      return {
        phones: Object.fromEntries((phones ?? []).map((p) => [p.user_id as string, p.phone as string])),
        names: Object.fromEntries((users ?? []).map((u) => [u.id as string, ((u.full_name as string) || (u.email as string) || 'a team member').split(' ')[0]])),
      };
    },
    async logCall(companyId, callSid, patch) {
      if (!callSid) return;
      const { data: existing } = await db.from('call_log').select('trail').eq('company_id', companyId).eq('call_sid', callSid).maybeSingle();
      const trail = [...((existing?.trail as string[] | undefined) ?? []), ...(patch.trail ?? [])];
      const row = { company_id: companyId, call_sid: callSid, trail, ...(patch.from ? { from_number: patch.from } : {}), ...(patch.to ? { to_number: patch.to } : {}), ...(patch.outcome ? { outcome: patch.outcome } : {}) };
      const { error } = await db.from('call_log').upsert(row, { onConflict: 'company_id,call_sid' });
      if (error) console.error('Saving the call log failed:', error.message);
    },
    async saveVoicemail(companyId, v) {
      const { error } = await db.from('voicemails').upsert({ company_id: companyId, call_sid: v.callSid, from_number: v.from, recording_url: v.recordingUrl, duration_seconds: v.seconds }, { onConflict: 'company_id,call_sid' });
      if (error) console.error('Saving the voicemail failed:', error.message);
    },
  };
}
