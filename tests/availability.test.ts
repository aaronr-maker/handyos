import { describe, expect, it } from 'vitest';
import { offerSentence, openSlots, pickOffers, zonedTime, type EstimateBlocks } from '../api/_lib/availability';

const TZ = 'America/Chicago';
const blocks: EstimateBlocks = {
  timezone: TZ,
  week: { tue: [{ start: '16:00', end: '18:00' }], wed: [{ start: '08:00', end: '10:00' }] },
  slotMinutes: 60,
  bufferMinutes: 30,
  noticeHours: 12,
  horizonDays: 14,
};
const sellers = [
  { id: 'ross', name: 'Aaron Ross' },
  { id: 'cham', name: 'Aaron Chamernick' },
];
// Monday, January 4, 2027, 9 AM Chicago
const NOW = zonedTime('2027-01-04', '09:00', TZ);
const at = (date: string, hhmm: string) => zonedTime(date, hhmm, TZ);

describe('estimate availability', () => {
  it('converts a wall-clock time in a time zone, including across daylight saving', () => {
    expect(new Date(zonedTime('2027-01-04', '09:00', TZ)).toISOString()).toBe('2027-01-04T15:00:00.000Z'); // CST, UTC-6
    expect(new Date(zonedTime('2027-07-06', '09:00', TZ)).toISOString()).toBe('2027-07-06T14:00:00.000Z'); // CDT, UTC-5
  });

  it('offers slots only inside the blocks set aside, for each seller, soonest first', () => {
    const slots = openSlots({ now: NOW, blocks, sellers, busy: [] });
    expect(slots[0]).toMatchObject({ start: at('2027-01-05', '16:00'), say: 'tomorrow at 4 PM' });
    expect(new Set(slots.slice(0, 4).map((s) => s.start))).toEqual(new Set([at('2027-01-05', '16:00'), at('2027-01-05', '17:00')]));
    expect(slots.every((s) => s.start >= NOW + 12 * 3_600_000)).toBe(true);
    expect(slots.some((s) => new Date(s.start).getUTCDay() === 4)).toBe(false); // nothing on Thursday
  });

  it('skips a seller who is busy (with the travel buffer around the job)', () => {
    const busy = [{ seller: 'ross', start: at('2027-01-05', '14:00'), end: at('2027-01-05', '15:45') }]; // ends 3:45, buffer to 4:15
    const slots = openSlots({ now: NOW, blocks, sellers, busy });
    const four = slots.filter((s) => s.start === at('2027-01-05', '16:00')).map((s) => s.seller);
    expect(four).toEqual(['cham']);
    const five = slots
      .filter((s) => s.start === at('2027-01-05', '17:00'))
      .map((s) => s.seller)
      .sort();
    expect(five).toEqual(['cham', 'ross']);
  });

  it('respects the notice period', () => {
    const late = openSlots({ now: at('2027-01-05', '10:00'), blocks, sellers, busy: [] }); // 4 PM is 6 hours away: too soon
    expect(late[0].start).toBeGreaterThan(at('2027-01-05', '18:00'));
  });

  it('picks two real choices: a different seller or day, not the same person an hour later', () => {
    const slots = openSlots({ now: NOW, blocks, sellers, busy: [] });
    const two = pickOffers(slots, TZ);
    expect(two).toHaveLength(2);
    expect(two[0].seller === two[1].seller && two[0].start !== two[1].start).toBe(false);
    const oneSeller = pickOffers(openSlots({ now: NOW, blocks, sellers: [sellers[0]], busy: [] }), TZ);
    expect(new Date(oneSeller[0].start).getUTCDate() === new Date(oneSeller[1].start).getUTCDate()).toBe(false); // different days
  });

  it('says what the two choices share only once, and dates the way people do', () => {
    const offer = (seller: string, name: string, day: string, at: string) => ({ seller, sellerName: name, start: 0, end: 0, say: `${day} at ${at}`, day, at });
    expect(offerSentence([offer('r', 'Aaron Ross', 'tomorrow', '4 PM'), offer('r', 'Aaron Ross', 'Monday, November 16th', '4 PM')])).toBe(
      'We have tomorrow or Monday, November 16th at 4 PM with Aaron Ross. Would one of those work for you?',
    );
    expect(offerSentence([offer('r', 'Aaron Ross', 'tomorrow', '4 PM'), offer('r', 'Aaron Ross', 'tomorrow', '5 PM')])).toBe(
      'We have tomorrow at 4 PM or at 5 PM with Aaron Ross. Would one of those work for you?',
    );
    expect(offerSentence([offer('r', 'Aaron Ross', 'tomorrow', '4 PM'), offer('c', 'Aaron Chamernick', 'Wednesday', '8 AM')])).toBe(
      'We have tomorrow at 4 PM with Aaron Ross or Wednesday at 8 AM with Aaron Chamernick. Would one of those work for you?',
    );
    expect(offerSentence([offer('r', 'Aaron Ross', 'tomorrow', '4 PM'), offer('c', 'Aaron Chamernick', 'Wednesday', '4 PM')])).toBe(
      'We have tomorrow with Aaron Ross or Wednesday with Aaron Chamernick, both at 4 PM. Would one of those work for you?',
    );
    expect(offerSentence([offer('r', 'Aaron Ross', 'tomorrow', '4 PM')])).toBe('We have tomorrow at 4 PM with Aaron Ross. Would that work for you?');
    const far = openSlots({ now: NOW, blocks: { ...blocks, week: { mon: [{ start: '16:00', end: '17:00' }] } }, sellers: [sellers[0]], busy: [] });
    expect(far.map((x) => x.say)).toContain('Monday, January 11th at 4 PM');
  });
  it('says nothing when nothing is open', () => {
    expect(offerSentence([])).toBe('');
    expect(pickOffers([], TZ)).toEqual([]);
  });

  it('uses real drive times: a long drive from the last job rules out a slot a short one would allow', () => {
    // Ross has a job ending 3:00 PM at "far"; the estimate is at "home-town". Far is 50 minutes away, so a 4 PM slot (1 hour gap) works, but not 3:45.
    const drive = (a: string, b: string) => (a === 'far' && b === 'town' ? 50 : a === 'town' && b === 'far' ? 50 : 10);
    const busy = [{ seller: 'ross', start: at('2027-01-05', '14:00'), end: at('2027-01-05', '15:00'), place: 'far' }];
    const b2 = { ...blocks, week: { tue: [{ start: '15:30', end: '18:00' }] }, slotMinutes: 60 };
    const times = (travel?: object) =>
      openSlots({ now: NOW, blocks: b2, sellers: [sellers[0]], busy, ...(travel ? { travel: travel as never } : {}) })
        .filter((x) => x.start < at('2027-01-06', '00:00'))
        .map((x) => new Date(x.start).toISOString());
    const real = times({ target: 'town', drive });
    expect(real).not.toContain(new Date(at('2027-01-05', '15:30')).toISOString()); // only 30 minutes after the job, needs 50
    expect(real).toContain(new Date(at('2027-01-05', '16:30')).toISOString());
    // with no drive time known it falls back to the 30 minute backup buffer
    const backup = times({ target: 'town', drive: () => null });
    expect(backup).toContain(new Date(at('2027-01-05', '15:30')).toISOString());
  });

  it('also checks the drive from the new address to the next job, and from home when the day has no earlier job', () => {
    const drive = (a: string, b: string) => (a === 'town' && b === 'next' ? 45 : a === 'house' ? 90 : 5);
    const busy = [{ seller: 'ross', start: at('2027-01-05', '17:30'), end: at('2027-01-05', '18:30'), place: 'next' }];
    const b2 = { ...blocks, week: { tue: [{ start: '07:00', end: '18:00' }] } };
    const times = openSlots({ now: NOW, blocks: b2, sellers: [sellers[0]], busy, travel: { target: 'town', homes: { ross: 'house' }, drive } }).map((x) => new Date(x.start).toISOString());
    expect(times).not.toContain(new Date(at('2027-01-05', '16:00')).toISOString()); // ends 5:00, next job 5:30, drive 45
    expect(times).toContain(new Date(at('2027-01-05', '15:00')).toISOString());
    // 90 minutes from home, and people set out at 7:00: nothing before 8:30
    expect(times).not.toContain(new Date(at('2027-01-05', '08:00')).toISOString());
    expect(times).toContain(new Date(at('2027-01-05', '09:00')).toISOString());
  });
});

describe("each seller's own working hours", () => {
  const week = { tue: [{ start: '16:00', end: '19:00' }] };
  const b2: EstimateBlocks = { timezone: TZ, week, slotMinutes: 60, bufferMinutes: 30, noticeHours: 12, horizonDays: 14 };
  const times = (hours?: object) =>
    openSlots({ now: NOW, blocks: b2, sellers: [{ id: 'ross', name: 'Aaron Ross', ...(hours ? { hours: hours as never } : {}) }], busy: [] })
      .filter((s) => s.start < at('2027-01-06', '00:00'))
      .map((s) => new Date(s.start).toISOString());
  const iso = (hhmm: string) => new Date(at('2027-01-05', hhmm)).toISOString();

  it('offers nothing outside the hours a person works, and a day with no hours is a day off', () => {
    expect(times()).toEqual([iso('16:00'), iso('17:00'), iso('18:00')]); // no hours set: no limit
    expect(times({ tue: [{ start: '07:00', end: '17:30' }] })).toEqual([iso('16:00')]); // done at 5:30, so only the 4 PM hour fits
    expect(times({ mon: [{ start: '08:00', end: '17:00' }] })).toEqual([]); // not working Tuesday
  });
  it('counts the drive from home against when the person starts work', () => {
    const drive = () => 50;
    const hours = { tue: [{ start: '15:30', end: '19:00' }] };
    const got = openSlots({ now: NOW, blocks: b2, sellers: [{ id: 'ross', name: 'Aaron Ross', hours }], busy: [], travel: { target: 'town', homes: { ross: 'house' }, drive } })
      .filter((s) => s.start < at('2027-01-06', '00:00'))
      .map((s) => new Date(s.start).toISOString());
    expect(got).not.toContain(iso('16:00')); // starts work 3:30, needs 50 minutes: earliest arrival 4:20
    expect(got).toContain(iso('17:00'));
  });
});
