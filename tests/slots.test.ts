import { describe, expect, it } from 'vitest';
import { clock, nextStart, slotStarts, startsToBlocks } from '../src/modules/receptionist/slots';

describe('one-hour estimate slots', () => {
  it('shows an older 4 to 6 PM block as two slots, and keeps start times in order without repeats', () => {
    expect(slotStarts([{ start: '16:00', end: '18:00' }])).toEqual(['16:00', '17:00']);
    expect(slotStarts([{ start: '08:00', end: '09:00' }, { start: '16:00', end: '17:00' }, { start: '08:00', end: '09:00' }])).toEqual(['08:00', '16:00']);
    expect(slotStarts(undefined)).toEqual([]);
    expect(slotStarts([{ start: '16:00', end: '16:30' }])).toEqual([]); // not a full hour
  });
  it('makes a one-hour block from each start time', () => {
    expect(startsToBlocks(['17:00', '16:00', '16:00'])).toEqual([{ start: '16:00', end: '17:00' }, { start: '17:00', end: '18:00' }]);
    expect(startsToBlocks(['23:30'])).toEqual([]); // cannot finish by midnight
  });
  it('suggests the hour after the last slot, or 4 PM for an empty day', () => {
    expect(nextStart([])).toBe('16:00');
    expect(nextStart(['16:00', '17:00'])).toBe('18:00');
  });
  it('writes times the way people read them', () => {
    expect(clock('16:00')).toBe('4:00 PM');
    expect(clock('08:30')).toBe('8:30 AM');
  });
});
