import { describe, expect, it } from 'vitest';
import type { Deps, Env, Store } from '../api/_lib/qb';
import { findPrivateDetail, handyChat } from '../api/_lib/handyChat';

const baseEnv: Env = { OPENAI_API_KEY: 'sk-test', HANDY_MODEL: 'test-model' };
function world(over: { env?: Partial<Env>; role?: string; reply?: unknown; status?: number } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const store = {
    userFromToken: async (t: string) => (t === 'tok' ? { id: 'u1' } : null),
    membership: async () => ({ companyId: 'co1', role: over.role ?? 'owner' }),
  } as unknown as Store;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const status = over.status ?? 200;
    return new Response(JSON.stringify(status === 200 ? (over.reply ?? { choices: [{ message: { role: 'assistant', content: 'Hello' } }] }) : { error: { message: 'bad thing' } }), { status });
  }) as unknown as typeof fetch;
  const deps: Deps = { env: { ...baseEnv, ...over.env }, store, fetch: fakeFetch, now: () => 0 };
  return { deps, calls };
}
const say = (text: string) => ({ messages: [{ role: 'user' as const, content: text }] });

describe('the check for private details', () => {
  it('finds emails, phone numbers, Social Security and card numbers, and lets placeholders, ids and dates through', () => {
    expect(findPrivateDetail('email pat@example.com')).toMatch(/email/);
    expect(findPrivateDetail('call 512-555-0147 today')).toMatch(/phone/);
    expect(findPrivateDetail('(512) 555 0147')).toMatch(/phone/);
    expect(findPrivateDetail('ssn 123-45-6789')).toMatch(/Social/);
    expect(findPrivateDetail('card 4242 4242 4242 4242')).toMatch(/card/);
    expect(findPrivateDetail('Customer 1 at Address 2 wants the gate fixed on 2027-01-05, job 4f2a1c3e-1234-4567-8901-abcdef012345, $1,250.00')).toBeNull();
    expect(findPrivateDetail('4242 4242 4242 4241')).toBeNull(); // not a valid card number
  });
});

describe('Handy on Grok instead of OpenAI', () => {
  const xai = { HANDY_PROVIDER: 'xai', XAI_API_KEY: 'xai-test-key', HANDY_MODEL: 'grok-test' };
  it('sends the typed chat to xAI with its own key and model, and does not send OpenAI-only settings', async () => {
    const w = world({ env: xai });
    const r = await handyChat(w.deps, 'tok', say('What is on today?'));
    expect(r.message.content).toBe('Hello');
    expect(w.calls[0].url).toBe('https://api.x.ai/v1/chat/completions');
    expect(w.calls[0].headers.Authorization).toBe('Bearer xai-test-key');
    expect(w.calls[0].body.model).toBe('grok-test');
    expect(w.calls[0].body).not.toHaveProperty('store');
  });
  it('uses a different address when one is set, still checks for private details, and says what is missing in plain words', async () => {
    const w = world({ env: { ...xai, XAI_BASE_URL: 'https://api.example.test/v1/' } });
    await handyChat(w.deps, 'tok', say('Hi'));
    expect(w.calls[0].url).toBe('https://api.example.test/v1/chat/completions');
    await expect(handyChat(world({ env: xai }).deps, 'tok', say('email pat@example.com'))).rejects.toThrow(/email/);
    await expect(handyChat(world({ env: { HANDY_PROVIDER: 'xai', HANDY_MODEL: 'g' } }).deps, 'tok', say('Hi'))).rejects.toThrow(/XAI_API_KEY/);
    await expect(handyChat(world({ env: { HANDY_PROVIDER: 'xai', XAI_API_KEY: 'k', HANDY_MODEL: '' } }).deps, 'tok', say('Hi'))).rejects.toThrow(/HANDY_MODEL/);
    await expect(handyChat(world({ env: xai, status: 401 }).deps, 'tok', say('Hi'))).rejects.toThrow(/Grok did not accept the key/);
  });
});

describe('Handy on the server', () => {
  it('sends the conversation to OpenAI with the key, asks it not to store anything, and returns only the new message', async () => {
    const w = world({ reply: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'week_hours', arguments: '{}' } }], extra: 'ignored' } }] } });
    const tools = [{ type: 'function' as const, function: { name: 'week_hours', description: 'x', parameters: { type: 'object', properties: {} } } }];
    const r = await handyChat(w.deps, 'tok', { ...say('How many hours does Person 1 have?'), tools });
    expect(r.message.tool_calls?.[0].function.name).toBe('week_hours');
    expect(r.message).not.toHaveProperty('extra');
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(w.calls[0].headers.Authorization).toBe('Bearer sk-test');
    expect(w.calls[0].body).toMatchObject({ model: 'test-model', store: false, tool_choice: 'auto' });
  });

  it('sends nothing when private details are in the conversation, when the person is not allowed, or when it is not set up', async () => {
    const leak = world();
    await expect(handyChat(leak.deps, 'tok', say('text pat@example.com'))).rejects.toThrow(/email address/);
    expect(leak.calls).toHaveLength(0);
    const toolLeak = world();
    await expect(handyChat(toolLeak.deps, 'tok', { messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '{"to":"512-555-0147"}' } }] }] })).rejects.toThrow(/phone number/);
    await expect(handyChat(world().deps, null, say('hi'))).rejects.toThrow(/Sign in/);
    await expect(handyChat(world({ role: 'tech' }).deps, 'tok', say('hi'))).rejects.toThrow(/role/);
    const noKey = world({ env: { OPENAI_API_KEY: '' } });
    await expect(handyChat(noKey.deps, 'tok', say('hi'))).rejects.toThrow(/OPENAI_API_KEY/);
    expect(noKey.calls).toHaveLength(0);
  });

  it('turns OpenAI refusals into plain messages, and limits how long a conversation can be', async () => {
    await expect(handyChat(world({ status: 401 }).deps, 'tok', say('hi'))).rejects.toThrow(/did not accept the key/);
    await expect(handyChat(world({ status: 429 }).deps, 'tok', say('hi'))).rejects.toThrow(/slow down or .* credit/);
    await expect(handyChat(world({ status: 400 }).deps, 'tok', say('hi'))).rejects.toThrow(/bad thing/);
    await expect(handyChat(world().deps, 'tok', { messages: Array.from({ length: 61 }, () => ({ role: 'user' as const, content: 'hi' })) })).rejects.toThrow(/too long/);
  });
});
