/** What Handy has used, and an estimate of what it cost. Prices are whatever the owner enters from OpenAI's pricing page. */
export interface Usage {
  seconds: number;
  text_in: number;
  text_out: number;
  audio_in: number;
  audio_out: number;
}
/** Dollars per million tokens. */
export interface Rates {
  text_in?: number;
  text_out?: number;
  audio_in?: number;
  audio_out?: number;
}

export const noUsage = (): Usage => ({ seconds: 0, text_in: 0, text_out: 0, audio_in: 0, audio_out: 0 });

export function addUsage(a: Usage, b: Partial<Usage>): Usage {
  return {
    seconds: a.seconds + (b.seconds ?? 0),
    text_in: a.text_in + (b.text_in ?? 0),
    text_out: a.text_out + (b.text_out ?? 0),
    audio_in: a.audio_in + (b.audio_in ?? 0),
    audio_out: a.audio_out + (b.audio_out ?? 0),
  };
}

/** The estimated cost in dollars, or null while no prices have been entered. */
export function estimateCost(u: Usage, r: Rates): number | null {
  const entered = Object.values(r).some((v) => typeof v === 'number' && v > 0);
  if (!entered) return null;
  const per = (tokens: number, rate?: number) => (tokens / 1_000_000) * (rate ?? 0);
  return per(u.text_in, r.text_in) + per(u.text_out, r.text_out) + per(u.audio_in, r.audio_in) + per(u.audio_out, r.audio_out);
}

interface VoiceUsage {
  input_token_details?: { text_tokens?: number; audio_tokens?: number };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

/** The usage the voice service reports after an answer (its field names), in our four counts. */
export function fromVoiceUsage(u: VoiceUsage | undefined): Partial<Usage> {
  return {
    text_in: u?.input_token_details?.text_tokens ?? 0,
    audio_in: u?.input_token_details?.audio_tokens ?? 0,
    text_out: u?.output_token_details?.text_tokens ?? 0,
    audio_out: u?.output_token_details?.audio_tokens ?? 0,
  };
}

export const dollars = (n: number) => (n > 0 && n < 0.01 ? 'under 1 cent' : '$' + n.toFixed(2));
