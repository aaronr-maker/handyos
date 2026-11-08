/**
 * Which in-home estimate times are open. Aaron sets aside blocks of time for estimates (by weekday); only team members signed off as
 * sellers can be booked; a seller is free for a slot when nothing else on their calendar (a job or another estimate, with the travel
 * buffer around it) overlaps it. The AI receptionist offers the two best choices from this. Pure functions, no database.
 */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface EstimateBlocks {
  timezone: string;
  /** Open stretches set aside for estimates, "HH:MM" 24-hour in the company's time zone. */
  week: Partial<Record<Weekday, { start: string; end: string }[]>>;
  /** How long one in-home estimate is booked for. */
  slotMinutes: number;
  /** Empty time kept before and after another booking (driving). */
  bufferMinutes: number;
  /** Nothing is offered sooner than this from now. */
  noticeHours: number;
  /** How many days ahead to look. */
  horizonDays: number;
}

export interface Seller {
  id: string;
  name: string;
}

export interface Busy {
  seller: string;
  start: number;
  end: number;
}

export interface Offer {
  seller: string;
  sellerName: string;
  /** ms since epoch */
  start: number;
  end: number;
  /** a ready-to-say description, like "Tuesday at 4 PM" */
  say: string;
}

const MIN = 60_000;
const DAY = 86_400_000;

/** The UTC moment for a wall-clock time ("2027-01-05", "16:00") in a time zone. */
export function zonedTime(date: string, hhmm: string, timezone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - t;
  };
  // the offset can change across the guess (daylight saving), so settle on it in two passes
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

const localDate = (t: number, timezone: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

const sayTime = (t: number, timezone: string, now: number) => {
  const day = localDate(t, timezone);
  const today = localDate(now, timezone);
  const tomorrow = localDate(now + DAY, timezone);
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(t)).replace(':00', '');
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(new Date(t));
  const within6 = t - now < 6 * DAY;
  const label =
    day === today
      ? 'today'
      : day === tomorrow
        ? 'tomorrow'
        : within6
          ? weekday
          : `${weekday} the ${new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long', day: 'numeric' }).format(new Date(t))}`;
  return `${label} at ${clock}`;
};

/** Every open slot for every seller, soonest first. */
export function openSlots(i: { now: number; blocks: EstimateBlocks; sellers: Seller[]; busy: Busy[] }): Offer[] {
  const { now, blocks, sellers, busy } = i;
  const earliest = now + blocks.noticeHours * 60 * MIN;
  const slot = blocks.slotMinutes * MIN;
  const buffer = blocks.bufferMinutes * MIN;
  const out: Offer[] = [];
  for (let n = 0; n <= blocks.horizonDays; n++) {
    const date = localDate(now + n * DAY, blocks.timezone);
    const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    for (const block of blocks.week[weekday] ?? []) {
      const open = zonedTime(date, block.start, blocks.timezone);
      const close = zonedTime(date, block.end, blocks.timezone);
      for (let start = open; start + slot <= close; start += slot) {
        if (start < earliest) continue;
        for (const s of sellers) {
          const clash = busy.some((b) => b.seller === s.id && b.start < start + slot + buffer && b.end > start - buffer);
          if (!clash) out.push({ seller: s.id, sellerName: s.name, start, end: start + slot, say: sayTime(start, blocks.timezone, now) });
        }
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.sellerName.localeCompare(b.sellerName));
}

/**
 * The two choices to say out loud: the soonest slot, then the soonest one that is a different day or a different seller, so the
 * caller has a real choice. Fewer than two when that is all there is.
 */
export function pickOffers(slots: Offer[], timezone: string, count = 2): Offer[] {
  if (slots.length === 0) return [];
  const chosen = [slots[0]];
  const day = (o: Offer) => localDate(o.start, timezone);
  for (const o of slots.slice(1)) {
    if (chosen.length >= count) break;
    if (chosen.every((c) => c.seller !== o.seller || day(c) !== day(o))) {
      // prefer a different seller, or at least a different day, over the same seller later the same day
      if (chosen.every((c) => c.seller !== o.seller) || chosen.every((c) => day(c) !== day(o))) chosen.push(o);
    }
  }
  return chosen;
}

/** What the assistant says: "We have tomorrow at 4 PM with Aaron Ross, or Wednesday at 8 AM with Aaron Chamernick. Would one of those work?" */
export function offerSentence(offers: Offer[]): string {
  if (offers.length === 0) return '';
  const part = (o: Offer) => `${o.say} with ${o.sellerName}`;
  return offers.length === 1 ? `We have ${part(offers[0])}. Would that work for you?` : `We have ${part(offers[0])}, or ${part(offers[1])}. Would one of those work for you?`;
}
