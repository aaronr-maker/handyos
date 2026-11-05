/**
 * Swaps private details for IDs before anything is sent to the AI provider, and back again for the screen. People in the
 * company keep using real names everywhere; the IDs exist only on the way out.
 *
 * A customer, contact or property the company knows about always gets the same ID, in every conversation: "C-4F2A1C3E",
 * "K-…" for a contact, "P-…" for a property (the first part of the record's own id). That way a job can be tied to its
 * owner, manager and address without a name ever leaving. Emails, phone numbers and long numbers found in the text become
 * "Email 1", "Phone 1", "Number 1", kept for the conversation.
 */
export type EntityKind = 'customer' | 'contact' | 'property';
export interface KnownEntity {
  kind: EntityKind;
  /** The record's own id. */
  id: string;
  /** What to show for it on the screen. */
  label: string;
  /** Everything it can be called in text (names, company name, street address...). */
  aliases: string[];
}

export type MaskMap = Record<string, string>; // placeholder -> real value (emails, phones, numbers)

const PREFIX: Record<EntityKind, string> = { customer: 'C', contact: 'K', property: 'P' };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GENERIC = 'Email|Phone|Number';

/** The ID a record is sent as. */
export const maskId = (kind: EntityKind, id: string) => `${PREFIX[kind]}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export interface Masker {
  mask(text: string): string;
  unmask(text: string): string;
  /** The record an ID (or spoken "Customer 1") in some text stands for, so a tool can act on the right customer. */
  resolve(text: string): { kind: EntityKind; id: string } | null;
  /** The placeholders for emails, phones and numbers, to save with the conversation. */
  map(): MaskMap;
}

export function createMasker(known: KnownEntity[], existing: MaskMap = {}): Masker {
  const map: MaskMap = { ...existing };
  const byValue = new Map<string, string>(Object.entries(map).map(([token, value]) => [value.toLowerCase(), token]));
  const counts: Record<string, number> = {};
  for (const token of Object.keys(map)) {
    const m = /^(\w+) (\d+)$/.exec(token);
    if (m) counts[m[1]] = Math.max(counts[m[1]] ?? 0, Number(m[2]));
  }
  const genericToken = (kind: string, value: string): string => {
    const key = value.trim().toLowerCase();
    const have = byValue.get(key);
    if (have) return have;
    counts[kind] = (counts[kind] ?? 0) + 1;
    const token = `${kind} ${counts[kind]}`;
    map[token] = value.trim();
    byValue.set(key, token);
    return token;
  };

  // each text a record can be called -> the record; longest first so "Mary Ann Smith" goes before "Mary"; very short names are left alone
  const byAlias = new Map<string, KnownEntity>();
  for (const e of known) for (const a of e.aliases) if (a.trim().length >= 3 && !byAlias.has(a.trim().toLowerCase())) byAlias.set(a.trim().toLowerCase(), e);
  const aliases = [...byAlias.keys()].sort((a, b) => b.length - a.length);
  const names = aliases.length ? new RegExp(`(?<![\\w])(${aliases.map(escape).join('|')})(?![\\w])`, 'gi') : null;
  const byToken = new Map(known.map((e) => [maskId(e.kind, e.id), e]));

  return {
    mask(text) {
      // emails, phone numbers and long numbers first (a known name can sit inside an email address), then known names and addresses
      let out = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => genericToken('Email', m));
      out = out.replace(/(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/g, (m) => genericToken('Phone', m));
      out = out.replace(/(?<![\w-])\d{9,}(?![\w-])/g, (m) => genericToken('Number', m));
      if (names) out = out.replace(names, (m) => {
        const e = byAlias.get(m.toLowerCase());
        return e ? maskId(e.kind, e.id) : m;
      });
      return out;
    },
    unmask(text) {
      return text
        .replace(/\b([CKP])-([0-9A-F]{8})\b/g, (m) => byToken.get(m)?.label ?? m)
        .replace(new RegExp(`\\b(${GENERIC}) (\\d+)\\b`, 'g'), (m, kind: string, n: string) => map[`${kind} ${n}`] ?? m);
    },
    resolve(text) {
      const m = /\b([CKP])-([0-9A-F]{8})\b/.exec(text);
      const e = m ? byToken.get(m[0]) : undefined;
      return e ? { kind: e.kind, id: e.id } : null;
    },
    map: () => ({ ...map }),
  };
}

const SPOKEN_WORD: Record<string, EntityKind> = { Customer: 'customer', Contact: 'contact', Property: 'property' };
const WORD: Record<EntityKind, string> = { customer: 'Customer', contact: 'Contact', property: 'Property' };

/**
 * The same masking for a spoken conversation: an ID read aloud ("C dash four F two A...") is unusable, so each customer,
 * contact and property is called "Customer 1", "Property 2"... for the length of the call, and mapped back to the real name
 * on screen. (What a person says out loud still reaches the voice service as audio; this covers what the app sends in text.)
 */
export function createSpokenMasker(known: KnownEntity[], existing: MaskMap = {}): Masker {
  const inner = createMasker(known, existing);
  const labels = new Map(known.map((e) => [maskId(e.kind, e.id), e.label]));
  const toSpoken = new Map<string, string>();
  const fromSpoken = new Map<string, string>(); // "Customer 1" -> ID
  const counts: Record<string, number> = {};
  const spokenFor = (id: string) => {
    const have = toSpoken.get(id);
    if (have) return have;
    const kind = Object.entries({ C: 'customer', K: 'contact', P: 'property' }).find(([p]) => id.startsWith(`${p}-`))![1] as EntityKind;
    counts[kind] = (counts[kind] ?? 0) + 1;
    const spoken = `${WORD[kind]} ${counts[kind]}`;
    toSpoken.set(id, spoken);
    fromSpoken.set(spoken, id);
    return spoken;
  };
  return {
    mask: (text) => inner.mask(text).replace(/\b[CKP]-[0-9A-F]{8}\b/g, (m) => (labels.has(m) ? spokenFor(m) : m)),
    unmask: (text) =>
      inner.unmask(text.replace(new RegExp(`\\b(${Object.keys(SPOKEN_WORD).join('|')}) (\\d+)\\b`, 'g'), (m) => fromSpoken.get(m) ?? m)),
    resolve(text) {
      const spoken = new RegExp(`\\b(${Object.keys(SPOKEN_WORD).join('|')}) (\\d+)\\b`).exec(text);
      const viaSpoken = spoken ? fromSpoken.get(spoken[0]) : undefined;
      return inner.resolve(viaSpoken ?? text);
    },
    map: () => inner.map(),
  };
}
