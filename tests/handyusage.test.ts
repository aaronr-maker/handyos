import { describe, expect, it } from 'vitest';
import type { Deps, Env, Store } from '../api/_lib/qb';
import { handyChat, handyVoiceSession } from '../api/_lib/handyChat';
import { addUsage, dollars, estimateCost, fromVoiceUsage, noUsage } from '../src/modules/handy/usage';
import { createVoiceHandler } from '../src/modules/handy/voice';
import { createMasker } from '../src/modules/handy/mask';

describe('what Handy costs', () => {
  it('adds usage up and estimates the cost from prices per million tokens, or says none are entered', () => {
    const u = addUsage(addUsage(noUsage(), { text_in: 500_000, text_out: 100_000, seconds: 60 }), { audio_in: 200_000, audio_out: 50_000, seconds: 30 });
    expect(u).toEqual({ seconds: 90, text_in: 500_000, text_out: 100_000, audio_in: 200_000, audio_out: 50_000 });
    expect(estimateCost(u, {})).toBeNull();
    // $2 per million text in, $8 out, $32 voice in, $64 voice out: 1.00 + 0.80 + 6.40 + 3.20
    expect(estimateCost(u, { text_in: 2, text_out: 8, audio_in: 32, audio_out: 64 })).toBeCloseTo(11.4, 5);
    expect(estimateCost(u, { audio_in: 10 })).toBeCloseTo(2, 5); // a price left out counts as nothing
    expect(dollars(0.004)).toBe('under 1 cent');
    expect(dollars(11.4)).toBe('$11.40');
  });

  it('reads the usage the voice service reports after each answer', () => {
    expect(fromVoiceUsage({ input_token_details: { text_tokens: 10, audio_tokens: 200 }, output_token_details: { text_tokens: 5, audio_tokens: 80 } })).toEqual({ text_in: 10, audio_in: 200, text_out: 5, audio_out: 80 });
    expect(fromVoiceUsage(undefined)).toEqual({ text_in: 0, audio_in: 0, text_out: 0, audio_out: 0 });
    const seen: Partial<ReturnType<typeof noUsage>>[] = [];
    const handle = createVoiceHandler({
      turn: { masker: createMasker([]), system: '', tools: [], callModel: async () => ({ role: 'assistant', content: null }), runRead: async () => ({}), isAction: () => false, confirm: async () => true, runAction: async () => '' },
      send: () => undefined,
      onUser: () => undefined,
      onHandy: () => undefined,
      onAction: () => undefined,
      onStatus: () => undefined,
      onError: () => undefined,
      onUsage: (x) => seen.push(x),
    });
    return handle({ type: 'response.done', response: { usage: { input_token_details: { audio_tokens: 50 }, output_token_details: { audio_tokens: 20 } } } }).then(() => expect(seen).toEqual([{ text_in: 0, audio_in: 50, text_out: 0, audio_out: 20 }]));
  });
});

describe('usage and voice choice on the server', () => {
  const env: Env = { OPENAI_API_KEY: 'sk-test' };
  const store = { userFromToken: async () => ({ id: 'u1' }), membership: async () => ({ companyId: 'c', role: 'owner' }) } as unknown as Store;
  const make = (reply: unknown) => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;
    return { deps: { env, store, fetch: fakeFetch, now: () => 0 } as Deps, bodies };
  };

  it('passes the tokens used by a typed answer back to the app', async () => {
    const w = make({ choices: [{ message: { role: 'assistant', content: 'Hi' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } });
    const r = await handyChat(w.deps, 'tok', { messages: [{ role: 'user', content: 'hello' }] });
    expect(r.usage).toEqual({ input: 120, output: 30 });
  });

  it('speaks in cedar unless the server is set to another voice, and still accepts a voice the service has', async () => {
    const pick = async (voice?: string) => {
      const w = make({ value: 'ek_x' });
      await handyVoiceSession(w.deps, 'tok', { instructions: 'You are Handy.', tools: [], ...(voice ? { voice } : {}) });
      return ((w.bodies[0].session as { audio: { output: { voice: string } } }).audio.output.voice);
    };
    expect(await pick('marin')).toBe('marin');
    expect(await pick('not-a-voice')).toBe('cedar');
    expect(await pick()).toBe('cedar');
  });
});
