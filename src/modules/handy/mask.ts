/**
 * Swaps private details for placeholders before anything is sent to the AI provider, and back again for the screen.
 * Names and addresses the company knows about (customers, contacts, properties) become "Customer 1", "Address 2"...;
 * emails, phone numbers and long number runs found in the text become "Email 1", "Phone 1", "Number 1". The same
 * detail always gets the same placeholder within a conversation (the map is saved with it).
 */
export type MaskKind = 'Customer' | 'Address' | 'Contact';
export interface KnownDetail {
  kind: MaskKind;
  value: string;
}

export type MaskMap = Record<string, string>; // placeholder -> real value

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KINDS = 'Customer|Address|Contact|Email|Phone|Number';
const TOKEN = new RegExp(`\\b(${KINDS}) (\\d+)\\b`, 'g');

export interface Masker {
  mask(text: string): string;
  unmask(text: string): string;
  map(): MaskMap;
}

export function createMasker(known: KnownDetail[], existing: MaskMap = {}): Masker {
  const map: MaskMap = { ...existing };
  const byValue = new Map<string, string>(Object.entries(map).map(([token, value]) => [value.toLowerCase(), token]));
  const counts: Record<string, number> = {};
  for (const token of Object.keys(map)) {
    const m = /^(\w+) (\d+)$/.exec(token);
    if (m) counts[m[1]] = Math.max(counts[m[1]] ?? 0, Number(m[2]));
  }
  const tokenFor = (kind: string, value: string): string => {
    const key = value.trim().toLowerCase();
    const have = byValue.get(key);
    if (have) return have;
    counts[kind] = (counts[kind] ?? 0) + 1;
    const token = `${kind} ${counts[kind]}`;
    map[token] = value.trim();
    byValue.set(key, token);
    return token;
  };

  // longest first, so "Mary Ann Smith" is replaced before "Mary"; very short values (under 3 letters) are left alone
  const details = [...new Map(known.filter((k) => k.value.trim().length >= 3).map((k) => [k.value.trim().toLowerCase(), k])).values()].sort((a, b) => b.value.length - a.value.length);
  const names = details.length ? new RegExp(`(?<![\\w])(${details.map((d) => escape(d.value.trim())).join('|')})(?![\\w])`, 'gi') : null;
  const kindOf = new Map(details.map((d) => [d.value.trim().toLowerCase(), d.kind]));

  return {
    mask(text) {
      // emails, phone numbers and long numbers first (a known name can sit inside an email address), then known names and addresses
      let out = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => tokenFor('Email', m));
      out = out.replace(/(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/g, (m) => tokenFor('Phone', m));
      out = out.replace(/(?<![\w-])\d{9,}(?![\w-])/g, (m) => tokenFor('Number', m));
      if (names) out = out.replace(names, (m) => tokenFor(kindOf.get(m.toLowerCase()) ?? 'Customer', m));
      return out;
    },
    unmask(text) {
      return text.replace(TOKEN, (m, kind: string, n: string) => map[`${kind} ${n}`] ?? m);
    },
    map: () => ({ ...map }),
  };
}
