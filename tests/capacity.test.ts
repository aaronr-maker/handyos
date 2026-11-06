import { describe, expect, it } from 'vitest';
import { dayCapacity, hoursText } from '../src/modules/scheduling/capacity';

const job = (h1: number, h2: number) => ({ start: new Date(2027, 0, 4, h1).toISOString(), end: new Date(2027, 0, 4, h2).toISOString() });

describe('day capacity', () => {
  it('an empty day has the whole workday free', () => {
    expect(dayCapacity([], 1)).toMatchObject({ bookedMin: 0, freeMin: 480, roomMin: 480, over: false });
  });
  it('a slower worker (rate 1.25) fits less new work', () => {
    const c = dayCapacity([job(8, 12)], 1.25); // 4h booked becomes 5h of work, 3h free, room for 2h24 -> 2h15
    expect(c.expectedMin).toBe(300);
    expect(c.freeMin).toBe(180);
    expect(c.roomMin).toBe(135);
  });
  it('a faster worker (rate 0.7) has extra room', () => {
    const c = dayCapacity([job(8, 13)], 0.7); // 5h booked is 3.5h of work, 4.5h free, room 6h
    expect(c.freeMin).toBe(270);
    expect(c.roomMin).toBe(380 - 380 % 15);
  });
  it('flags an overbooked day and never goes negative', () => {
    const c = dayCapacity([job(7, 17)], 1);
    expect(c).toMatchObject({ over: true, freeMin: 0, roomMin: 0 });
  });
  it('formats time', () => {
    expect(hoursText(150)).toBe('2h 30m');
    expect(hoursText(120)).toBe('2h');
    expect(hoursText(45)).toBe('45m');
  });
});
