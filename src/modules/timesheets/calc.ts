import type { Id } from '@/core';

export const WEEK_LIMIT_MINUTES = 40 * 60;

const pad = (n: number) => String(n).padStart(2, '0');
/** "2027-01-05" in the viewer's time zone. */
export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Monday 00:00 to the next Monday 00:00 (local time) of the week a date falls in. */
export function weekRange(date: Date): { start: number; end: number } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}

interface Stretch {
  clock_in: string;
  clock_out: string | null;
}

/** Minutes of a stretch inside [from, to]; a stretch still running counts up to `now`. */
export function minutesWithin(s: Stretch, from: number, to: number, now: number): number {
  const a = Math.max(Date.parse(s.clock_in), from);
  const b = Math.min(s.clock_out ? Date.parse(s.clock_out) : now, to);
  return Math.max(0, Math.round((b - a) / 60000));
}

export interface ClockedWeek {
  /** Minutes clocked in the week: the day clock where it was used, otherwise the job clock. */
  total: number;
  byDay: Record<string, { day: number; job: number }>;
}

/**
 * What a person clocked in a week. For each day the day clock (shift) is what counts; on a day with no shift, the time
 * on jobs counts instead, so someone who only uses the job clock is still counted.
 */
export function clockedWeek(i: { shifts: Stretch[]; entries: Stretch[]; from: number; to: number; now: number }): ClockedWeek {
  const byDay: ClockedWeek['byDay'] = {};
  const add = (list: Stretch[], field: 'day' | 'job') => {
    for (const s of list) {
      const m = minutesWithin(s, i.from, i.to, i.now);
      if (m <= 0) continue;
      const key = dayKey(Math.max(Date.parse(s.clock_in), i.from));
      byDay[key] ??= { day: 0, job: 0 };
      byDay[key][field] += m;
    }
  };
  add(i.shifts, 'day');
  add(i.entries, 'job');
  const total = Object.values(byDay).reduce((n, d) => n + (d.day > 0 ? d.day : d.job), 0);
  return { total, byDay };
}

export interface EfficiencySample {
  /** Minutes the tech actually spent on the job. */
  actual: number;
  /** Minutes the job was scheduled for. */
  scheduled: number;
}

export interface Efficiency {
  /** Actual time divided by scheduled time: 1.1 means jobs take them 10% longer than scheduled. */
  rate: number;
  jobs: number;
  /** True when there was not enough history, so 1.0 is used. */
  defaulted: boolean;
}

/** A person's efficiency rate from their finished jobs: actual hours over scheduled hours (kept between 0.5 and 2.0). */
export function efficiencyRate(samples: EfficiencySample[], minJobs = 3): Efficiency {
  const good = samples.filter((s) => s.scheduled >= 15 && s.actual > 0);
  if (good.length < minJobs) return { rate: 1, jobs: good.length, defaulted: true };
  const rate = good.reduce((n, s) => n + s.actual, 0) / good.reduce((n, s) => n + s.scheduled, 0);
  return { rate: Math.min(2, Math.max(0.5, Math.round(rate * 100) / 100)), jobs: good.length, defaulted: false };
}

export interface ScheduledJob {
  id: Id;
  start: string;
  end: string;
}

/** Scheduled minutes still ahead this week (from now to the end of the week). */
export function scheduledRemaining(jobs: ScheduledJob[], now: number, weekEnd: number): number {
  return jobs.reduce((n, j) => {
    const a = Math.max(Date.parse(j.start), now);
    const b = Math.min(Date.parse(j.end), weekEnd);
    return n + Math.max(0, Math.round((b - a) / 60000));
  }, 0);
}

export interface WeekProjection {
  clocked: number;
  scheduled_remaining: number;
  efficiency: Efficiency;
  /** Clocked so far plus the scheduled time still ahead, stretched by the efficiency rate. */
  projected: number;
  limit: number;
  over: boolean;
}

export function projectWeek(clocked: number, remaining: number, efficiency: Efficiency, limit = WEEK_LIMIT_MINUTES): WeekProjection {
  const projected = clocked + Math.round(remaining * efficiency.rate);
  return { clocked, scheduled_remaining: remaining, efficiency, projected, limit, over: projected > limit };
}
