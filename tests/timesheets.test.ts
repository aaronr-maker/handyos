import { describe, expect, it } from 'vitest';
import { clockedWeek, efficiencyRate, projectWeek, scheduledRemaining, weekRange } from '../src/modules/timesheets';

const H = 3_600_000;
const t = (day: number, h: number, m = 0) => new Date(2027, 0, day, h, m).toISOString(); // January 2027 (the 4th is a Monday)

describe('weekly timesheet math', () => {
  it('runs a week from Monday to Sunday', () => {
    const { start, end } = weekRange(new Date(2027, 0, 7, 15)); // Thursday Jan 7
    expect(new Date(start).getDate()).toBe(4);
    expect(new Date(start).getDay()).toBe(1);
    expect((end - start) / H).toBe(168);
    expect(new Date(weekRange(new Date(2027, 0, 10, 23)).start).getDate()).toBe(4); // Sunday still belongs to that week
  });

  it('counts the day clock where it was used and the job clock on days without one', () => {
    const { start, end } = weekRange(new Date(2027, 0, 5));
    const w = clockedWeek({
      shifts: [{ clock_in: t(4, 7), clock_out: t(4, 16) }], // Monday 9h on the day clock
      entries: [
        { clock_in: t(4, 8), clock_out: t(4, 14) }, // Monday job time (not added: the day clock covers it)
        { clock_in: t(5, 8), clock_out: t(5, 13) }, // Tuesday: no shift, so 5h of job time counts
      ],
      from: start,
      to: end,
      now: new Date(2027, 0, 8).getTime(),
    });
    expect(w.total).toBe(14 * 60);
  });

  it('counts a stretch that is still running up to now, and stays inside the week', () => {
    const { start, end } = weekRange(new Date(2027, 0, 5));
    const now = new Date(2027, 0, 5, 10).getTime();
    expect(clockedWeek({ shifts: [{ clock_in: t(5, 7), clock_out: null }], entries: [], from: start, to: end, now }).total).toBe(180);
    expect(clockedWeek({ shifts: [{ clock_in: t(3, 22), clock_out: t(4, 2) }], entries: [], from: start, to: end, now }).total).toBe(120); // only the part after Monday 00:00
  });

  it('works out the efficiency rate as actual over scheduled hours, with a default until there is history', () => {
    expect(efficiencyRate([{ actual: 120, scheduled: 120 }])).toEqual({ rate: 1, jobs: 1, defaulted: true });
    const e = efficiencyRate([{ actual: 132, scheduled: 120 }, { actual: 66, scheduled: 60 }, { actual: 330, scheduled: 300 }]);
    expect(e).toEqual({ rate: 1.1, jobs: 3, defaulted: false });
    expect(efficiencyRate([{ actual: 10, scheduled: 100 }, { actual: 10, scheduled: 100 }, { actual: 10, scheduled: 100 }]).rate).toBe(0.5); // kept in a sensible range
  });

  it('counts only the scheduled time still ahead this week', () => {
    const now = new Date(2027, 0, 6, 12).getTime(); // Wednesday noon
    const { end } = weekRange(new Date(now));
    const jobs = [
      { id: 'a', start: t(6, 10), end: t(6, 14) }, // started: 2h left
      { id: 'b', start: t(7, 8), end: t(7, 12) }, // 4h
      { id: 'c', start: t(11, 8), end: t(11, 12) }, // next week: not counted
      { id: 'd', start: t(5, 8), end: t(5, 12) }, // already past
    ];
    expect(scheduledRemaining(jobs, now, end)).toBe(6 * 60);
  });

  it('projects the week as clocked plus the scheduled time left times the efficiency rate, and goes over at 40 hours', () => {
    const eff = { rate: 1.1, jobs: 10, defaulted: false };
    // 20h clocked, 20h scheduled left x 1.1 = 22h -> 42h: over
    const over = projectWeek(20 * 60, 20 * 60, eff);
    expect(over.projected).toBe(42 * 60);
    expect(over.over).toBe(true);
    // exactly 40 is not over
    expect(projectWeek(20 * 60, Math.round((20 * 60) / 1.1), eff).over).toBe(false);
    expect(projectWeek(10 * 60, 20 * 60, { rate: 1, jobs: 0, defaulted: true }).projected).toBe(30 * 60);
  });
});
