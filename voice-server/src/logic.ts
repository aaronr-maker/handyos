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
export const summaryRequest = (lines: Line[]): { system: string; user: string } | null =>
  lines.filter((l) => l.body.trim()).length < 2 ? null : { system: SUMMARY_PROMPT, user: transcriptText(lines) };

// ---- the AI receptionist ----

/** The woman's voice the assistant speaks with (OpenAI's own voice name). */
export const ASSISTANT_VOICE = 'marin';

/**
 * What the assistant is told. The rules about price and about what it may promise are firm; everything it can actually do is done
 * by tools that the company's server controls (it only reads out what the tools return).
 */
export function assistantInstructions(company: string, callerNumber: string): string {
  return `You are the automated phone assistant for ${company}, a home-repair company. You speak with a warm, relaxed, friendly woman's voice. Keep answers short, one or two sentences, and sound natural. Say numbers and times the way a person would.

Start by saying hello, that you are ${company}'s automated assistant, and asking how you can help.

LANGUAGE: Answer in whatever language the caller speaks, and switch if they switch. Tools return English; say it naturally in the caller's language. After you find times (find_times tells you which languages the team speaks), if the caller's language is not English and is not among the team's languages, say kindly that you are happy to help but that there may be a language barrier with the technician, for their notice and convenience, then carry on.

YOUR JOB: Book free in-home estimates and take messages.
1. Find out what they need, their name, and the street address of the job (city and state too). The number they are calling from is ${callerNumber || 'unknown'}: ask if that is the best number to reach them, or get another.
2. When you have the full street address, call find_times. Say the sentence it returns, exactly, then wait for the caller to choose.
3. When the caller chooses one of the offered times, repeat their name, address and the time back and ask if that is right. Then call book_estimate with that time's seller_id and start exactly as find_times gave them. If it says the time is no longer open, say so, and offer the new sentence it gives.
4. If they need a time outside the offered times, or want something you cannot do, say: "Yeah, no problem. We can have a technician call you and set up a time outside our normal estimate times to get you taken care of." Then call request_callback with their details and what they asked for.
5. When it is done, thank them and call end_call.

FIRM RULES:
- Never give, guess or discuss prices. If asked about price, say in-home estimates are free, and that we don't give estimates over the phone because there may be materials, service minimums or trip charges; a technician will get the quote to them.
- Never promise a time that find_times did not give you, a particular technician, or that any work will be done by a date.
- If anything sounds like an emergency (gas smell, fire, flooding, someone in danger), tell them to hang up and call 911 if anyone is in danger, then call request_callback marked URGENT.
- If you are not sure you heard a name, number or address right, ask again. Spell back street names when unsure.
- If you cannot help, take a message with request_callback. Never leave a caller without next steps.`;
}

/** The three things the assistant can do besides talk, plus hanging up. */
export const ASSISTANT_TOOLS = [
  {
    type: 'function',
    name: 'find_times',
    description: 'Find open in-home estimate times for the job address. Returns the sentence to say, the offered times (with seller_id and start), and which languages the team speaks.',
    parameters: { type: 'object', properties: { address: { type: 'string', description: 'Full street address of the job, with city and state.' } }, required: ['address'] },
  },
  {
    type: 'function',
    name: 'book_estimate',
    description: 'Book the in-home estimate the caller chose. Use the seller_id and start exactly as find_times returned them.',
    parameters: {
      type: 'object',
      properties: {
        seller_id: { type: 'string' },
        start: { type: 'number', description: 'The start value of the chosen time.' },
        name: { type: 'string' },
        phone: { type: 'string', description: 'The best number to reach them.' },
        address: { type: 'string' },
        language: { type: 'string', description: "The caller's language, like English or Spanish." },
        notes: { type: 'string', description: 'What the job is, in English.' },
      },
      required: ['seller_id', 'start', 'name', 'phone', 'address'],
    },
  },
  {
    type: 'function',
    name: 'request_callback',
    description: 'Ask the office to call the person back (a time outside the estimate times, a question you cannot answer, or an urgent matter).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        language: { type: 'string' },
        notes: { type: 'string', description: 'What they need and when, in English. Start with URGENT if it is urgent.' },
      },
      required: ['notes'],
    },
  },
  { type: 'function', name: 'end_call', description: 'Hang up after saying goodbye.', parameters: { type: 'object', properties: {} } },
] as const;

/** A tool's answer for the AI: short, and never anything beyond what the company's server said. */
export const toolAnswer = (result: unknown): string => JSON.stringify(result ?? { ok: false, reason: 'No answer.' }).slice(0, 4000);
