import { duplicateKeys } from './import/mapping';
import type { Customer } from './types';

export interface DuplicateGroup {
  customers: Customer[];
  /** Why these look like the same customer. */
  reasons: string[];
}

const normName = (c: Customer) => c.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Suggests groups of customers that may be the same person: same email, same phone number, or the same
 * (full) name. These are only suggestions; a person decides what to merge.
 */
export function findDuplicateGroups(all: Customer[]): DuplicateGroup[] {
  const parent = new Map<string, string>(all.map((c) => [c.id, c.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const reasons = new Map<string, Set<string>>();
  const seen = new Map<string, string>();

  const link = (key: string, reason: string, c: Customer) => {
    const first = seen.get(key);
    if (!first) {
      seen.set(key, c.id);
      return;
    }
    parent.set(find(c.id), find(first));
    const r = reasons.get(find(first)) ?? new Set();
    r.add(reason);
    reasons.set(find(first), r);
  };

  for (const c of all) {
    for (const k of duplicateKeys({ ...c, external_ref: null })) {
      if (k.startsWith('e:')) link(k, 'same email', c);
      else if (k.startsWith('p:')) link(k, 'same phone number', c);
    }
    const n = normName(c);
    // a single first name ("Mike") is too common to suggest on its own
    if (n.includes(' ') || c.company_name) link(`n:${n}`, 'same name', c);
  }

  const groups = new Map<string, Customer[]>();
  for (const c of all) groups.set(find(c.id), [...(groups.get(find(c.id)) ?? []), c]);
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const why = new Set<string>();
      for (const [r, set] of reasons) if (find(r) === root) set.forEach((x) => why.add(x));
      return { customers: members, reasons: [...why] };
    });
}
