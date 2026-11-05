/**
 * Confirming by voice. In a call, Handy says what he is about to do ("I'll change Pat's email to ... Is that right?"), the
 * person answers out loud, and he carries on. The rules for whether a spoken answer counts live here, in plain code, so that
 * they never depend on the AI's own judgment:
 *   - only a short, clear "yes" counts; anything with a "no", "wait", "but", "change" or a question does not;
 *   - the "yes" has to come after Handy finished his read-back (and be heard within a few seconds of his tool request);
 *   - everything Handy is about to save (the new email, the name, the message words) has to actually appear in what he read
 *     aloud, so he cannot read one thing and do another;
 *   - only certain kinds of change can be confirmed by voice at all. Anything else, or anything unclear, falls back to the card
 *     on screen, where the person taps.
 */
export type Verdict = { kind: 'yes' } | { kind: 'no' } | { kind: 'feedback'; said: string } | { kind: 'unknown' };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9@. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const words = (s: string) => norm(s).replace(/[@.]/g, ' ').split(' ').filter(Boolean);

const YES_ANCHOR = new Set(['yes', 'yeah', 'yep', 'yup', 'correct', 'sure', 'ok', 'okay', 'exactly', 'absolutely', 'affirmative', 'confirm', 'confirmed']);
const YES_FILLER = new Set(['that', 'thats', 'is', 'it', 'do', 'go', 'ahead', 'please', 'sounds', 'looks', 'good', 'great', 'perfect', 'fine', 'save', 'send', 'and', 'yes', 'thanks', 'thank', 'you']);
const NO_WORDS = new Set(['no', 'nope', 'not', 'dont', 'stop', 'cancel', 'wait', 'wrong', 'never', 'nah', 'hold', 'hang']);
const BLOCKERS = new Set(['but', 'change', 'actually', 'instead', 'except', 'however', 'maybe', 'what', 'who', 'why', 'how', 'when', 'which', 'different', 'rather']);

/** True only for a short, clear yes ("yes", "yeah, do it", "that's right", "sounds good"). */
export function isYes(text: string): boolean {
  const w = words(text);
  if (w.length === 0 || w.length > 6) return false;
  if (w.some((x) => NO_WORDS.has(x) || BLOCKERS.has(x))) return false;
  // "that's right" and "right" count; "is that right" (a question, or Handy's own words echoed back) does not
  if (/^(yes |yeah |yep )?((thats|that is) )?right$/.test(norm(text))) return true;
  return w.some((x) => YES_ANCHOR.has(x) || (x === 'good' && w.includes('sounds')) || (x === 'ahead' && w.includes('go'))) && w.every((x) => YES_ANCHOR.has(x) || YES_FILLER.has(x));
}

/** True for a short, clear no ("no", "wait", "don't", "cancel that"). */
export function isNo(text: string): boolean {
  const w = words(text);
  if (w.length === 0 || w.length > 6) return false;
  return w.some((x) => NO_WORDS.has(x)) && !w.some((x) => YES_ANCHOR.has(x));
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Does the read-back contain this value, however a spoken transcript might write it (an email as "name at site dot com", a phone as digits)? */
function covers(spoken: string, value: string): boolean {
  const said = alnum(spoken);
  const v = value.trim();
  if (!v) return true;
  if (v.includes('@')) {
    const asSpoken = alnum(v.replace(/@/g, ' at ').replace(/\./g, ' dot '));
    return said.includes(alnum(v)) || said.includes(asSpoken);
  }
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 7 && digits.length >= v.replace(/\s/g, '').length - 4) return spoken.replace(/\D/g, '').includes(digits);
  if (v.length >= 40) return said.includes(alnum(v));
  // names and short phrases: the first word is enough ("Sam" for "Sam Lee"), the rest of a short value is checked loosely
  const first = alnum(v.split(/\s+/)[0]);
  return first.length < 2 || said.includes(first);
}

/** Keys that point at a record or choose a mode: nothing Handy would read out. */
const REFERENCE = new Set(['customer', 'contact', 'property', 'job_id', 'alert_id', 'channel', 'display_name_source', 'is_property_manager', 'status']);

/** Every value Handy is about to save must appear in what he read aloud. False when there is nothing to check (he must read something). */
export function spokenCovers(args: Record<string, unknown>, spoken: string): boolean {
  const values = Object.entries(args)
    .filter(([k, v]) => !REFERENCE.has(k) && typeof v === 'string' && v.trim() !== '')
    .map(([, v]) => v as string);
  if (values.length === 0) return false;
  return values.every((v) => covers(spoken, v));
}

/** The kinds of change that may be confirmed by voice. Anything else needs a tap. */
export const VOICE_CONFIRMABLE = new Set(['assign_job', 'close_alert', 'send_message', 'create_customer', 'update_customer', 'add_customer_contact', 'update_contact', 'update_address']);

/**
 * Keeps track of what Handy last said and what the person said after it, and decides what a tool request means. `wait` gives the
 * person's answer time to be written down (it arrives separately from the audio), then returns a verdict.
 */
export interface SpokenConfirm {
  handySaid(text: string): void;
  userSaid(text: string): void;
  judge(name: string, args: Record<string, unknown>, waitMs?: number): Promise<Verdict>;
}

export function createSpokenConfirm(now: () => number = Date.now, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): SpokenConfirm {
  // what Handy said recently (newest last), and the person's latest answer; a yes is used once
  const handy: { text: string; at: number }[] = [];
  let user: { text: string; at: number } | null = null;
  let usedAt = -1;
  return {
    handySaid(text) {
      handy.push({ text, at: now() });
      if (handy.length > 6) handy.shift();
    },
    userSaid(text) {
      user = { text, at: now() };
    },
    async judge(name, args, waitMs = 2500) {
      if (!VOICE_CONFIRMABLE.has(name) || handy.length === 0) return { kind: 'unknown' };
      // the answer is transcribed separately from the audio, so give it a moment to arrive
      const deadline = now() + waitMs;
      const oldest = handy[0].at;
      while ((!user || user.at <= usedAt || user.at < oldest) && now() < deadline) await sleep(100);
      if (!user || user.at <= usedAt) return { kind: 'unknown' };
      const answer = user;
      if (isNo(answer.text)) {
        usedAt = answer.at;
        return { kind: 'no' };
      }
      if (isYes(answer.text)) {
        // the yes counts when it answers a read-back that contained everything to be saved. Handy often says something short
        // right after the yes ("sending it now"), so any recent read-back that came before the answer will do.
        const readBack = [...handy].reverse().find((h) => h.at <= answer.at && spokenCovers(args, h.text));
        if (!readBack) return { kind: 'unknown' };
        usedAt = answer.at;
        return { kind: 'yes' };
      }
      usedAt = answer.at;
      return { kind: 'feedback', said: answer.text };
    },
  };
}
