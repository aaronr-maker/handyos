export interface DayJob {
  id: string;
  start: string | null;
  status: string;
}

/** Local-day bounds (ms) for the day containing `now`. */
export function dayBounds(now: number): { from: number; to: number } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const from = d.getTime();
  return { from, to: from + 86_400_000 };
}

export const isToday = (iso: string | null, now: number) => {
  if (!iso) return false;
  const { from, to } = dayBounds(now);
  const t = Date.parse(iso);
  return t >= from && t < to;
};

export const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

export const hoursText = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** A one-line summary of the day: "3 jobs today, first at 8:00 AM." */
export function daySummary(jobs: { start: string }[], extra: string[]): string {
  const sorted = [...jobs].sort((a, b) => a.start.localeCompare(b.start));
  const parts: string[] = [];
  if (sorted.length === 0) parts.push('Nothing is scheduled for today.');
  else parts.push(`${sorted.length} ${sorted.length === 1 ? 'job' : 'jobs'} today, first at ${new Date(sorted[0].start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
  return [...parts, ...extra].join(' ');
}

export interface Contactable {
  id: string;
  label: string;
  phone: string | null;
}

/** People matching what was typed, by name or digits of the number; capped so the list stays short. */
export function matchContacts(all: Contactable[], query: string, limit = 6): Contactable[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const d = q.replace(/\D/g, '');
  return all.filter((c) => c.label.toLowerCase().includes(q) || (d.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(d))).slice(0, limit);
}
