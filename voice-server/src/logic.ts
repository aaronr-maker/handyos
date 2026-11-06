import { createHmac, timingSafeEqual } from 'node:crypto';

/** Same as api/_lib/streamToken.ts in the main app (this server is deployed on its own, so it carries its own copy). */
export const streamToken = (secret: string, callSid: string, companyId: string): string => createHmac('sha256', secret).update(`${callSid}:${companyId}`).digest('hex');

export function validStreamToken(secret: string, callSid: string, companyId: string, token: string): boolean {
  const a = Buffer.from(streamToken(secret, callSid, companyId));
  const b = Buffer.from(token || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Twilio labels the audio it sends: `inbound` is the customer's voice, `outbound` is the team member's. */
export const speakerOf = (track: string): 'caller' | 'team' => (track === 'outbound' ? 'team' : 'caller');

export interface Line {
  speaker: 'caller' | 'team';
  body: string;
  at: number;
}

/** The transcript as plain text for the summary, oldest first, cut to the most recent part if it is very long. */
export function transcriptText(lines: Line[], maxChars = 24000): string {
  const text = [...lines]
    .sort((a, b) => a.at - b.at)
    .map((l) => `${l.speaker === 'caller' ? 'Customer' : 'Team'}: ${l.body}`)
    .join('\n');
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

export const SUMMARY_PROMPT = `You write short notes for a handyman company's office after a phone call. Use only what was said; never guess. If something was not said, write "not given". Format exactly:
Who: (name, and number or address if said)
Needs: (the job or problem, in one or two lines)
Where / when: (address and timing, if said)
Next step: (what was promised or what the team should do)
Anything urgent or unsafe: (yes, with what, or no)`;

/** The text sent to the model for a summary, or null when there was nothing worth summarizing. */
export const summaryRequest = (lines: Line[]): { system: string; user: string } | null => (lines.filter((l) => l.body.trim()).length < 2 ? null : { system: SUMMARY_PROMPT, user: transcriptText(lines) });
