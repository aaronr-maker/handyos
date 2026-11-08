/**
 * In-home estimates are one-hour slots, so Aaron picks start times and the end follows. Behind the scenes the times are kept as
 * blocks (start and end); these convert between the two so older settings (like 4 to 6 PM) show up as two slots (4 and 5 PM).
 */
export interface Block {
  start: string;
  end: string;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toText = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const SLOT_MINUTES = 60;

/** The start of every one-hour slot in the blocks, in order. */
export function slotStarts(blocks: Block[] | undefined): string[] {
  const out = new Set<number>();
  for (const b of blocks ?? []) for (let t = toMin(b.start); t + SLOT_MINUTES <= toMin(b.end); t += SLOT_MINUTES) out.add(t);
  return [...out].sort((a, b) => a - b).map(toText);
}

/** One block per start time, one hour long. A start too late in the day to finish by midnight is left out. */
export function startsToBlocks(starts: string[]): Block[] {
  return [...new Set(starts.filter((s) => /^\d{2}:\d{2}$/.test(s) && toMin(s) + SLOT_MINUTES <= 24 * 60))].sort().map((s) => ({ start: s, end: toText(toMin(s) + SLOT_MINUTES) }));
}

/** "4:00 PM" for a 24-hour time. */
export const clock = (t: string) => new Date(2000, 0, 1, Math.floor(toMin(t) / 60), toMin(t) % 60).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** The time to suggest when adding a slot: an hour after the last one, or 4 PM for an empty day. */
export const nextStart = (starts: string[]): string => (starts.length ? toText(Math.min(toMin(starts[starts.length - 1]) + SLOT_MINUTES, 23 * 60)) : '16:00');
