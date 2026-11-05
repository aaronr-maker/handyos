import type { TurnDeps, WireTool } from './chat';
import { executeToolCall } from './chat';
import { fromVoiceUsage, type Usage } from './usage';

/**
 * Handy's voice: a live call with OpenAI's voice model. The browser holds the microphone and the call; the server only hands out a
 * short-lived pass (it never sees the audio). Handy's look-ups and changes run in the app exactly as in the text chat: the same
 * tools, the same permissions, the same "Do it" card before anything changes.
 */

/** The voice model wants tools without the `function` wrapper. */
export const voiceTools = (tools: WireTool[]) => tools.map((t) => ({ type: 'function' as const, name: t.function.name, description: t.function.description, parameters: t.function.parameters }));

export type VoiceStatus = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

export interface VoiceEvent {
  type?: string;
  transcript?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  error?: { message?: string };
  response?: { usage?: Parameters<typeof fromVoiceUsage>[0] };
}

export interface VoiceDeps {
  turn: TurnDeps;
  /** Sends an event to the voice model. */
  send(event: unknown): void;
  onUser(text: string): void;
  onHandy(text: string): void;
  /** Something Handy did or was turned down on, for the record. */
  onAction(line: string): void;
  onStatus(status: VoiceStatus): void;
  onError(message: string): void;
  /** What a spoken answer used (reported by the voice service). */
  onUsage?(u: Partial<Usage>): void;
}

/**
 * Reads what the voice model reports and reacts. Events come in two spellings across versions of the service; both are handled.
 * A look-up or change Handy asks for is carried out and the result handed back, then he carries on talking.
 */
export function createVoiceHandler(d: VoiceDeps): (event: VoiceEvent) => Promise<void> {
  const answered = new Set<string>();
  return async (ev) => {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        return d.onStatus('listening');
      case 'input_audio_buffer.speech_stopped':
        return d.onStatus('thinking');
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) d.onUser(ev.transcript.trim());
        return;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        return d.onStatus('speaking');
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (ev.transcript?.trim()) d.onHandy(d.turn.masker.unmask(ev.transcript.trim()));
        return;
      case 'response.done':
        d.onUsage?.(fromVoiceUsage(ev.response?.usage));
        return d.onStatus('listening');
      case 'error':
        return d.onError(ev.error?.message ?? 'The voice service reported a problem.');
      case 'response.function_call_arguments.done': {
        if (!ev.call_id || !ev.name || answered.has(ev.call_id)) return;
        answered.add(ev.call_id);
        d.onStatus('thinking');
        const out = await executeToolCall(ev.name, ev.arguments ?? '{}', d.turn);
        if (out.action) d.onAction(out.action);
        d.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: out.result } });
        d.send({ type: 'response.create' });
      }
    }
  };
}

/** The settings for a call: how Handy behaves, what he can use, and that his words are written down. */
export function voiceSession(instructions: string, tools: WireTool[]) {
  return { instructions, tools: voiceTools(tools) };
}

export const VOICE_RULES = `
Sound like a warm, relaxed, friendly office manager: unhurried, with natural pauses, never robotic or salesy.
You are speaking out loud, so keep answers short and natural, one or two sentences, and say numbers the way a person would ("about forty-two hours").
Before you change anything, say what you are about to do and ask if that is right; then call the tool. The person also taps a confirmation on screen, so never claim something is done until the tool says so.
If you are not sure you heard a name or number right, ask again instead of guessing.`;

/** Connects the microphone to the voice model and returns how to talk to it and how to hang up. Only runs in a browser. */
export async function connectVoice(i: { secret: string; model: string; onEvent: (e: VoiceEvent) => void; onClosed: () => void }): Promise<{ send(event: unknown): void; close(): void }> {
  const pc = new RTCPeerConnection();
  const audio = document.createElement('audio');
  audio.autoplay = true;
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0];
  };
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  pc.addTrack(mic.getTracks()[0], mic);
  const channel = pc.createDataChannel('oai-events');
  channel.onmessage = (m) => {
    try {
      i.onEvent(JSON.parse(String(m.data)) as VoiceEvent);
    } catch {
      // an event that is not JSON is ignored
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') i.onClosed();
  };
  await pc.setLocalDescription(await pc.createOffer());
  const headers = { Authorization: `Bearer ${i.secret}`, 'Content-Type': 'application/sdp' };
  // the current address first, the earlier one if the service does not know it
  let res = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers, body: pc.localDescription!.sdp });
  if (res.status === 404) res = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(i.model)}`, { method: 'POST', headers, body: pc.localDescription!.sdp });
  if (!res.ok) {
    mic.getTracks().forEach((t) => t.stop());
    pc.close();
    throw new Error(`The voice service would not start the call (${res.status}).`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  return {
    send: (event) => {
      if (channel.readyState === 'open') channel.send(JSON.stringify(event));
    },
    close: () => {
      mic.getTracks().forEach((t) => t.stop());
      channel.close();
      pc.close();
      audio.srcObject = null;
    },
  };
}
