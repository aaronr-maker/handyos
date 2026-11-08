import { describe, expect, it } from 'vitest';
import { offerSentence, openSlots, pickOffers, zonedTime, type EstimateBlocks } from '../src/modules/receptionist/availability';

const TZ = 'America/Chicago';
const blocks: EstimateBlocks = { timezone: TZ, week: { tue: [{ start: '16:00', end: '18:00' }], wed: [{ start: '08:00', end: '10:00' }] }, slotMinutes: 60, bufferMinutes: 30, noticeHours: 12, horizonDays: 14 };
const sellers = [{ id: 'ross', name: 'Aaron Ross' }, { id: 'cham', name: 'Aaron Chamernick' }];
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
    const five = slots.filter((s) => s.start === at('2027-01-05', '17:00')).map((s) => s.seller).sort();
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

  it('says it the way a person would, and says nothing when nothing is open', () => {
    const two = pickOffers(openSlots({ now: NOW, blocks, sellers, busy: [] }), TZ);
    expect(offerSentence(two)).toMatch(/^We have tomorrow at 4 PM with Aaron (Ross|Chamernick), or .+ with Aaron (Ross|Chamernick)\. Would one of those work for you\?$/);
    expect(offerSentence([])).toBe('');
    expect(pickOffers([], TZ)).toEqual([]);
  });
});
