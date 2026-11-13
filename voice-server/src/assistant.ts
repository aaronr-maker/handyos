import { WebSocket } from 'ws';
import { ASSISTANT_TOOLS, ASSISTANT_VOICE, assistantInstructions, toolAnswer, validStreamToken, type Line } from './logic.js';

/**
 * The AI receptionist on a live call: Twilio's phone audio goes to OpenAI's realtime voice model, and its speech comes back to the
 * caller. The model can only do three things, each one a request to the company's own server (find times, book, ask for a
 * callback); everything else is conversation. Each line spoken is saved for the call screen, and a summary is written at the end.
 */
export interface AssistantDeps {
  openaiKey: string;
  streamSecret: string;
  appUrl: string;
  model: string;
  companyName: string;
  saveLine: (companyId: string, callSid: string, speaker: 'caller' | 'assistant', body: string) => void;
  finish: (companyId: string, callSid: string, lines: Line[]) => void;
}

export function handleAssistantCall(twilio: WebSocket, d: AssistantDeps) {
  let streamSid = '';
  let callSid = '';
  let companyId = '';
  let from = '';
  let openai: WebSocket | null = null;
  let hangUpAfterSpeech = false;
  let finished = false;
  const lines: Line[] = [];
  const queue: string[] = [];

  const toOpenAI = (m: unknown) => openai?.readyState === WebSocket.OPEN && openai.send(JSON.stringify(m));
  const remember = (speaker: 'caller' | 'assistant', body: string) => {
    if (!body.trim()) return;
    lines.push({ speaker: speaker === 'caller' ? 'caller' : 'team', body, at: Date.now() });
    d.saveLine(companyId, callSid, speaker, body.trim());
  };
  const end = () => {
    if (finished) return;
    finished = true;
    setTimeout(() => {
      openai?.close();
      if (twilio.readyState === WebSocket.OPEN) twilio.close();
      if (companyId && callSid) d.finish(companyId, callSid, lines);
    }, 800);
  };

  /** Asks the company's server to do something on the call's behalf. Only this server may ask (the shared secret), and the company comes from the verified call. */
  async function ask(action: 'ai_availability' | 'ai_book' | 'ai_callback', body: Record<string, unknown>) {
    try {
      const res = await fetch(`${d.appUrl.replace(/\/+$/, '')}/api/voice/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-voice-secret': d.streamSecret },
        body: JSON.stringify({ ...body, companyId, callSid }),
      });
      return (await res.json()) as unknown;
    } catch {
      return { ok: false, reason: 'Something went wrong on our side.' };
    }
  }

  async function runTool(name: string, args: Record<string, unknown>, callId: string) {
    let result: unknown;
    if (name === 'find_times') result = await ask('ai_availability', { address: args.address });
    else if (name === 'book_estimate')
      result = await ask('ai_book', { sellerId: args.seller_id, start: args.start, name: args.name, phone: args.phone, address: args.address, language: args.language, notes: args.notes });
    else if (name === 'request_callback') result = await ask('ai_callback', { name: args.name, phone: args.phone ?? from, address: args.address, language: args.language, notes: args.notes });
    else if (name === 'end_call') {
      hangUpAfterSpeech = true;
      result = { ok: true };
    } else result = { ok: false, reason: 'Unknown tool.' };
    toOpenAI({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: toolAnswer(result) } });
    toOpenAI({ type: 'response.create' });
  }

  function startOpenAI() {
    openai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(d.model)}`, { headers: { Authorization: `Bearer ${d.openaiKey}` } });
    openai.on('open', () => {
      toOpenAI({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: d.model,
          instructions: assistantInstructions(d.companyName, from),
          output_modalities: ['audio'],
          audio: {
            input: { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', interrupt_response: true } },
            output: { format: { type: 'audio/pcmu' }, voice: ASSISTANT_VOICE },
          },
          tools: ASSISTANT_TOOLS,
          tool_choice: 'auto',
        },
      });
      toOpenAI({ type: 'response.create', response: { instructions: 'The caller just connected. Greet them now.' } });
      for (const a of queue.splice(0)) toOpenAI({ type: 'input_audio_buffer.append', audio: a });
    });
    openai.on('message', (raw) => {
      let m: { type?: string; delta?: string; transcript?: string; item?: { type?: string; name?: string; arguments?: string; call_id?: string }; error?: { message?: string } };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (m.type) {
        case 'response.output_audio.delta':
        case 'response.audio.delta':
          if (m.delta && streamSid && twilio.readyState === WebSocket.OPEN) twilio.send(JSON.stringify({ event: 'media', streamSid, media: { payload: m.delta } }));
          break;
        case 'input_audio_buffer.speech_started':
          // the caller spoke over the assistant: stop what is playing
          if (streamSid && twilio.readyState === WebSocket.OPEN) twilio.send(JSON.stringify({ event: 'clear', streamSid }));
          break;
        case 'conversation.item.input_audio_transcription.completed':
          remember('caller', m.transcript ?? '');
          break;
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          remember('assistant', m.transcript ?? '');
          break;
        case 'response.output_item.done':
          if (m.item?.type === 'function_call' && m.item.name && m.item.call_id) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(m.item.arguments || '{}') as Record<string, unknown>;
            } catch {
              /* the model sent something that is not JSON: treat as no arguments */
            }
            void runTool(m.item.name, args, m.item.call_id);
          }
          break;
        case 'response.done':
          // after the goodbye has been spoken, hang up
          if (hangUpAfterSpeech) setTimeout(end, 2500);
          break;
        case 'error':
          console.error('OpenAI said:', m.error?.message);
          break;
      }
    });
    openai.on('error', (e) => console.error('OpenAI connection problem:', e.message));
    openai.on('close', () => end());
  }

  twilio.on('message', (raw) => {
    let m: { event?: string; streamSid?: string; start?: { streamSid?: string; customParameters?: Record<string, string> }; media?: { payload?: string } };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.event === 'start') {
      const p = m.start?.customParameters ?? {};
      if (!validStreamToken(d.streamSecret, p.callSid ?? '', p.companyId ?? '', p.token ?? '')) {
        console.error('Refused an assistant call without a valid token.');
        return twilio.close();
      }
      streamSid = m.start?.streamSid ?? m.streamSid ?? '';
      callSid = p.callSid;
      companyId = p.companyId;
      from = p.from ?? '';
      startOpenAI();
    } else if (m.event === 'media' && m.media?.payload) {
      if (openai?.readyState === WebSocket.OPEN) toOpenAI({ type: 'input_audio_buffer.append', audio: m.media.payload });
      else queue.push(m.media.payload);
    } else if (m.event === 'stop') end();
  });
  twilio.on('close', () => end());
}
