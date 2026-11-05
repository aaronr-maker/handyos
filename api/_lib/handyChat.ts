import { ApiError, type Deps } from './qb.js';

/**
 * The server's part of Handy: it checks who is asking, checks that no private details are about to leave, and passes the
 * conversation to OpenAI with the company's key. It keeps nothing: conversations are stored by the app in the company's
 * own database, and OpenAI is asked not to store them (`store: false`, plus the zero-retention agreement).
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const MAX_MESSAGES = 60;
const MAX_CHARS = 60_000;
const MAX_TOOLS = 25;
const ROLES = ['owner', 'admin', 'office'];

const isLuhn = (digits: string) => {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt && (n *= 2) > 9) n -= 9;
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

/**
 * A last check on what is about to be sent: the app swaps names, phones and addresses for placeholders first, so none of
 * these should turn up. Returns what was found ("an email address"), or null when the text is clean.
 */
export function findPrivateDetail(text: string): string | null {
  const t = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  if (/[\w.+-]+@[\w-]+(\.[\w-]+)+/.test(t)) return 'an email address';
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) return 'what looks like a Social Security number';
  for (const m of t.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && isLuhn(digits)) return 'what looks like a card number';
  }
  if (/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(t)) return 'a phone number';
  return null;
}

async function requireStaff(deps: Deps, token: string | null) {
  if (!token) throw new ApiError(401, 'Sign in first.');
  const user = await deps.store.userFromToken(token);
  if (!user) throw new ApiError(401, 'Sign in first.');
  const m = await deps.store.membership(user.id);
  if (!m) throw new ApiError(403, 'You are not part of a company.');
  if (!ROLES.includes(m.role)) throw new ApiError(403, 'Handy is not available for your role yet.');
  return { companyId: m.companyId, userId: user.id };
}

/** One turn: the conversation so far (already masked) goes in; Handy's next message (words and/or things he wants to do) comes out. */
export async function handyChat(deps: Deps, token: string | null, body: { messages?: ChatMessage[]; tools?: ToolDef[] }): Promise<{ message: ChatMessage; usage: { input: number; output: number } }> {
  await requireStaff(deps, token);
  const key = deps.env.OPENAI_API_KEY;
  if (!key) throw new ApiError(503, 'Handy is not set up yet: the OpenAI key is missing on the server (OPENAI_API_KEY).');
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (messages.length === 0 || messages.length > MAX_MESSAGES) throw new ApiError(400, 'That conversation is too long. Start a new chat.');
  if (tools.length > MAX_TOOLS) throw new ApiError(400, 'Too many tools.');
  const chars = messages.reduce((n, m) => n + (m.content?.length ?? 0) + JSON.stringify(m.tool_calls ?? '').length, 0);
  if (chars > MAX_CHARS) throw new ApiError(400, 'That conversation is too long. Start a new chat.');
  for (const m of messages) {
    const found = findPrivateDetail(`${m.content ?? ''} ${m.tool_calls?.map((c) => c.function.arguments).join(' ') ?? ''}`);
    if (found) throw new ApiError(422, `Handy did not send this because it contained ${found}. Remove it and try again, or use a name instead.`);
  }

  const res = await deps.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: deps.env.HANDY_MODEL || 'gpt-4.1', messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), store: false }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    const why = err.error?.message ?? `answered ${res.status}`;
    if (res.status === 401) throw new ApiError(502, 'OpenAI did not accept the key. Check OPENAI_API_KEY in Vercel.');
    if (res.status === 429) throw new ApiError(502, `OpenAI says to slow down or that the account is out of credit: ${why}`);
    throw new ApiError(502, `OpenAI could not answer: ${why}`);
  }
  const json = (await res.json()) as { choices?: { message?: ChatMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const message = json.choices?.[0]?.message;
  if (!message) throw new ApiError(502, 'OpenAI sent back nothing. Try again.');
  return {
    message: { role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) },
    usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 },
  };
}

/**
 * Hands the browser a short-lived pass to start a voice call with OpenAI. The audio goes straight from the phone to OpenAI;
 * this server never hears it. The call's instructions and tools are fixed here, and checked for private details first.
 */
/** The voices a call can use (the service's own names). */
export const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

export async function handyVoiceSession(deps: Deps, token: string | null, body: { instructions?: string; tools?: unknown[]; voice?: string }): Promise<{ secret: string; model: string }> {
  await requireStaff(deps, token);
  const key = deps.env.OPENAI_API_KEY;
  if (!key) throw new ApiError(503, 'Handy is not set up yet: the OpenAI key is missing on the server (OPENAI_API_KEY).');
  const instructions = typeof body.instructions === 'string' ? body.instructions : '';
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (!instructions || instructions.length > 8000 || tools.length > MAX_TOOLS) throw new ApiError(400, 'That voice session was not set up correctly.');
  const found = findPrivateDetail(`${instructions} ${JSON.stringify(tools)}`);
  if (found) throw new ApiError(422, `Handy did not start the call because its setup contained ${found}.`);
  const model = deps.env.HANDY_VOICE_MODEL || 'gpt-realtime';
  const res = await deps.fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 120 },
      session: {
        type: 'realtime',
        model,
        instructions,
        tools,
        tool_choice: 'auto',
        audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' } }, output: { voice: body.voice && VOICES.includes(body.voice) ? body.voice : deps.env.HANDY_VOICE || 'cedar' } },
      },
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (res.status === 401) throw new ApiError(502, 'OpenAI did not accept the key. Check OPENAI_API_KEY in Vercel.');
    throw new ApiError(502, `OpenAI could not start a voice call: ${err.error?.message ?? `answered ${res.status}`}`);
  }
  const json = (await res.json()) as { value?: string; client_secret?: { value?: string } };
  const secret = json.value ?? json.client_secret?.value;
  if (!secret) throw new ApiError(502, 'OpenAI did not give a voice pass. Try again.');
  return { secret, model };
}
