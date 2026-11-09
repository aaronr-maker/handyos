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
  /** Where that job is (an address). When missing, the backup travel time is used around it. */
  place?: string;
}

/** Real drive times: where the new estimate would be, where each person's day starts, and a lookup of minutes between two addresses. */
export interface Travel {
  /** The address of the job the estimate is for. */
  target: string;
  /** Each seller's home base address, by seller id. */
  homes?: Record<string, string>;
  /** Drive minutes from one address to another, or null when it is not known. */
  drive: (from: string, to: string) => number | null;
  /** When people can set out in the morning ("HH:MM"). Default 07:00. */
  dayStart?: string;
}

export interface Offer {
  seller: string;
  sellerName: string;
  /** ms since epoch */
  start: number;
  end: number;
  /** a ready-to-say description, like "Tuesday at 4 PM" */
  say: string;
  /** the day on its own ("tomorrow", "Monday, November 16th") and the time on its own ("4 PM") */
  day: string;
  at: string;
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

const sayTime = (t: number, timezone: string, now: number): { day: string; at: string } => {
  const day = localDate(t, timezone);
  const today = localDate(now, timezone);
  const tomorrow = localDate(now + DAY, timezone);
  const at = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(t)).replace(':00', '');
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(new Date(t));
  const within6 = t - now < 6 * DAY;
  const dayOfMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: 'numeric' }).format(new Date(t)));
  const ordinal = `${dayOfMonth}${dayOfMonth % 100 >= 11 && dayOfMonth % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][dayOfMonth % 10] ?? 'th')}`;
  const month = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long' }).format(new Date(t));
  const label = day === today ? 'today' : day === tomorrow ? 'tomorrow' : within6 ? weekday : `${weekday}, ${month} ${ordinal}`;
  return { day: label, at };
};

/** Every open slot for every seller, soonest first. */
export function openSlots(i: { now: number; blocks: EstimateBlocks; sellers: Seller[]; busy: Busy[]; travel?: Travel }): Offer[] {
  const { now, blocks, sellers, busy, travel } = i;
  const earliest = now + blocks.noticeHours * 60 * MIN;
  const slot = blocks.slotMinutes * MIN;
  const out: Offer[] = [];
  for (let n = 0; n <= blocks.horizonDays; n++) {
    const date = localDate(now + n * DAY, blocks.timezone);
    const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    for (const block of blocks.week[weekday] ?? []) {
      const open = zonedTime(date, block.start, blocks.timezone);
      const close = zonedTime(date, block.end, blocks.timezone);
      const dayOpen = zonedTime(date, travel?.dayStart ?? '07:00', blocks.timezone);
      // can this seller be at the estimate for [start, start + slot)? Real drive times when known, the backup buffer otherwise.
      const fits = (seller: string, start: number): boolean => {
        const end = start + slot;
        const gap = (from: string | undefined, to: string | undefined) => {
          const m = travel && from && to ? travel.drive(from, to) : null;
          return (m === null ? blocks.bufferMinutes : m) * MIN;
        };
        const mine = busy.filter((b) => b.seller === seller);
        if (mine.some((b) => b.start < end && b.end > start)) return false; // overlaps another booking
        const before = mine.filter((b) => b.end <= start && localDate(b.end, blocks.timezone) === date).sort((a, b) => b.end - a.end)[0];
        const after = mine.filter((b) => b.start >= end && localDate(b.start, blocks.timezone) === date).sort((a, b) => a.start - b.start)[0];
        if (before && before.end + gap(before.place, travel?.target) > start) return false;
        if (after && end + gap(travel?.target, after.place) > after.start) return false;
        // nothing earlier that day: the day starts at home
        if (!before && travel?.homes?.[seller] && start - gap(travel.homes[seller], travel.target) < dayOpen) return false;
        // jobs the day before or after only matter through the backup buffer when no address is known
        if (!travel) return !mine.some((b) => b.start < end + blocks.bufferMinutes * MIN && b.end > start - blocks.bufferMinutes * MIN);
        return true;
      };
      for (let start = open; start + slot <= close; start += slot) {
        if (start < earliest) continue;
        for (const s of sellers) {
          if (fits(s.id, start)) {
            const when = sayTime(start, blocks.timezone, now);
            out.push({ seller: s.id, sellerName: s.name, start, end: start + slot, say: `${when.day} at ${when.at}`, day: when.day, at: when.at });
          }
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
  const [one, two] = offers;
  if (!one) return '';
  if (!two) return `We have ${one.say} with ${one.sellerName}. Would that work for you?`;
  // anything the two choices share is said once, at the end, so it never sounds like a repeat
  const sameDay = one.day === two.day;
  const sameAt = one.at === two.at;
  const sameWho = one.seller === two.seller;
  const phrase = (o: Offer, withDay: boolean) => [withDay && o.day, !sameAt && `at ${o.at}`, !sameWho && `with ${o.sellerName}`].filter(Boolean).join(' ');
  const tail = [sameAt && `${sameWho ? '' : 'both '}at ${one.at}`, sameWho && `with ${one.sellerName}`].filter(Boolean).join(' ');
  const comma = sameAt && !sameWho ? ',' : '';
  return `We have ${phrase(one, true)} or ${phrase(two, !sameDay)}${tail ? `${comma} ${tail}` : ''}. Would one of those work for you?`;
}
