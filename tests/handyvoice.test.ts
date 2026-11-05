import { describe, expect, it } from 'vitest';
import type { Deps, Env, Store } from '../api/_lib/qb';
import { handyVoiceSession } from '../api/_lib/handyChat';
import { createMasker, createSpokenMasker } from '../src/modules/handy/mask';
import { createVoiceHandler, voiceTools, type VoiceEvent } from '../src/modules/handy/voice';
import type { TurnDeps } from '../src/modules/handy/chat';

const PAT = '4f2a1c3e-1234-4567-8901-abcdef012345';
const known = [{ kind: 'customer' as const, id: PAT, label: 'Pat Miller', aliases: ['Pat Miller'] }, { kind: 'property' as const, id: 'c0ffee00-2222-4333-8444-ddddeeeeffff', label: '123 Oak Street', aliases: ['123 Oak Street'] }];

describe('masking for a spoken conversation', () => {
  it('calls each customer and property "Customer 1", "Property 1" for the call and maps them back to real names', () => {
    const m = createSpokenMasker(known);
    expect(m.mask('Pat Miller at 123 Oak Street, and Pat Miller again')).toBe('Customer 1 at Property 1, and Customer 1 again');
    expect(m.unmask('Move the job for Customer 1 at Property 1')).toBe('Move the job for Pat Miller at 123 Oak Street');
    expect(m.mask('mail pat@x.com')).toBe('mail Email 1');
    expect(m.unmask('Customer 7 is not known')).toBe('Customer 7 is not known');
  });
});

describe('what the voice model reports', () => {
  function harness(over: Partial<TurnDeps> = {}) {
    const sent: unknown[] = [];
    const log: string[] = [];
    const ran: string[] = [];
    const turn: TurnDeps = {
      masker: createSpokenMasker(known),
      system: '',
      tools: [],
      callModel: async () => ({ role: 'assistant', content: null }),
      runRead: async (name) => {
        ran.push(name);
        return { job: 'Fix gate', customer: 'Pat Miller' };
      },
      isAction: (n) => n === 'assign_job',
      confirm: async () => true,
      runAction: async () => 'Moved the job to Sam.',
      ...over,
    };
    const handle = createVoiceHandler({ turn, send: (e) => sent.push(e), onUser: (t) => log.push(`user:${t}`), onHandy: (t) => log.push(`handy:${t}`), onAction: (a) => log.push(`action:${a}`), onStatus: (s) => log.push(`status:${s}`), onError: (m) => log.push(`error:${m}`) });
    return { handle, sent, log, ran, masker: turn.masker };
  }
  const ev = (e: VoiceEvent) => e;

  it('writes down what was said, with the real names put back, and follows the call\'s status', async () => {
    const h = harness();
    h.masker.mask('Pat Miller at 123 Oak Street'); // a look-up result went to the voice model first, so it knows Customer 1 and Property 1
    await h.handle(ev({ type: 'input_audio_buffer.speech_started' }));
    await h.handle(ev({ type: 'conversation.item.input_audio_transcription.completed', transcript: ' Who has the Oak Street job? ' }));
    await h.handle(ev({ type: 'response.output_audio.delta' }));
    await h.handle(ev({ type: 'response.output_audio_transcript.done', transcript: 'Customer 1 has it, at Property 1.' }));
    await h.handle(ev({ type: 'response.audio_transcript.done', transcript: 'Done.' })); // the older spelling
    await h.handle(ev({ type: 'response.done' }));
    expect(h.log).toEqual(['status:listening', 'user:Who has the Oak Street job?', 'status:speaking', 'handy:Pat Miller has it, at 123 Oak Street.', 'handy:Done.', 'status:listening']);
  });

  it('looks things up when asked, hands back a masked answer, and tells the voice to carry on', async () => {
    const h = harness();
    await h.handle(ev({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'upcoming_jobs', arguments: '{}' }));
    expect(h.ran).toEqual(['upcoming_jobs']);
    expect(h.sent).toEqual([
      { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'c1', output: '{"job":"Fix gate","customer":"Customer 1"}' } },
      { type: 'response.create' },
    ]);
    await h.handle(ev({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'upcoming_jobs', arguments: '{}' })); // the same call twice is answered once
    expect(h.sent).toHaveLength(2);
  });

  it('asks before changing anything, and reports a refusal to the voice', async () => {
    const yes = harness();
    await yes.handle(ev({ type: 'response.function_call_arguments.done', call_id: 'a1', name: 'assign_job', arguments: '{"job_id":"j1","person":"Sam"}' }));
    expect(yes.log).toContain('action:Moved the job to Sam.');
    const no = harness({ confirm: async () => false });
    await no.handle(ev({ type: 'response.function_call_arguments.done', call_id: 'a2', name: 'assign_job', arguments: '{}' }));
    expect(no.log).toContain('action:Declined: assign_job');
    expect(JSON.stringify(no.sent[0])).toContain('Nothing was changed');
  });

  it('shows errors and converts tools to the voice model\'s shape', async () => {
    const h = harness();
    await h.handle(ev({ type: 'error', error: { message: 'rate limit' } }));
    expect(h.log).toEqual(['error:rate limit']);
    expect(voiceTools([{ type: 'function', function: { name: 'team', description: 'd', parameters: { type: 'object' } } }])).toEqual([{ type: 'function', name: 'team', description: 'd', parameters: { type: 'object' } }]);
    void createMasker;
  });
});

describe('the voice pass on the server', () => {
  const env: Env = { OPENAI_API_KEY: 'sk-test' };
  function world(over: { env?: Partial<Env>; status?: number; reply?: unknown } = {}) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const store = { userFromToken: async (t: string) => (t === 'tok' ? { id: 'u1' } : null), membership: async () => ({ companyId: 'c', role: 'owner' }) } as unknown as Store;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      const status = over.status ?? 200;
      return new Response(JSON.stringify(status === 200 ? (over.reply ?? { value: 'ek_short_lived' }) : { error: { message: 'nope' } }), { status });
    }) as unknown as typeof fetch;
    return { deps: { env: { ...env, ...over.env }, store, fetch: fakeFetch, now: () => 0 } as Deps, calls };
  }
  const body = { instructions: 'You are Handy.', tools: [{ type: 'function', name: 'team', description: 'd', parameters: {} }] };

  it('hands back a short-lived pass and the call\'s setup, never the real key', async () => {
    const w = world();
    const r = await handyVoiceSession(w.deps, 'tok', body);
    expect(r).toEqual({ secret: 'ek_short_lived', model: 'gpt-realtime' });
    expect(JSON.stringify(r)).not.toContain('sk-test');
    expect(w.calls[0].url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(w.calls[0].body).toMatchObject({ session: { type: 'realtime', model: 'gpt-realtime', instructions: 'You are Handy.' } });
    expect((await handyVoiceSession(world({ reply: { client_secret: { value: 'ek_old' } } }).deps, 'tok', body)).secret).toBe('ek_old');
  });

  it('refuses without a sign-in, without the key, or when the setup holds private details, and explains OpenAI refusals', async () => {
    await expect(handyVoiceSession(world().deps, null, body)).rejects.toThrow(/Sign in/);
    await expect(handyVoiceSession(world({ env: { OPENAI_API_KEY: '' } }).deps, 'tok', body)).rejects.toThrow(/OPENAI_API_KEY/);
    const leak = world();
    await expect(handyVoiceSession(leak.deps, 'tok', { ...body, instructions: 'call 512-555-0147' })).rejects.toThrow(/phone number/);
    expect(leak.calls).toHaveLength(0);
    await expect(handyVoiceSession(world({ status: 401 }).deps, 'tok', body)).rejects.toThrow(/did not accept the key/);
    await expect(handyVoiceSession(world({ status: 400 }).deps, 'tok', body)).rejects.toThrow(/nope/);
  });
});


describe('Handy talking while a change is still waiting', () => {
  it('is stopped from answering, because nothing has been done yet, and is allowed to speak once the result is in', async () => {
    const sent: { type?: string }[] = [];
    let release: (v: boolean) => void = () => undefined;
    const handle = createVoiceHandler({
      turn: { masker: createMasker([]), system: '', tools: [], callModel: async () => ({ role: 'assistant', content: null }), runRead: async () => ({}), isAction: () => true, confirm: () => new Promise<boolean>((r) => (release = r)), runAction: async () => 'Sent the email.' },
      send: (e) => sent.push(e as { type?: string }),
      onUser: () => undefined,
      onHandy: () => undefined,
      onAction: () => undefined,
      onStatus: () => undefined,
      onError: () => undefined,
    });
    const call = handle({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'send_message', arguments: '{}' });
    await Promise.resolve();
    await handle({ type: 'response.created' }); // Handy begins to say "it's sent" while the confirmation is still open
    expect(sent.map((e) => e.type)).toEqual(['response.cancel', 'output_audio_buffer.clear']);
    handle.say('Please tap the button.'); // the app's own prompt is allowed through
    await handle({ type: 'response.created' });
    expect(sent.map((e) => e.type)).toEqual(['response.cancel', 'output_audio_buffer.clear', 'response.create']);
    release(true);
    await call;
    await handle({ type: 'response.created' }); // after the result is in, he can speak freely
    expect(sent.map((e) => e.type)).toEqual(['response.cancel', 'output_audio_buffer.clear', 'response.create', 'conversation.item.create', 'response.create']);
  });
});
