import type { Cents } from '@/core';
import type { CostCategory } from './rateTypes';

/** "2026-10" for a timestamp, in the viewer's time zone. */
export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Minutes clocked per month ("2026-10"). Entries still clocked in count up to `now`. */
export function minutesByMonth(entries: { clock_in: string; clock_out: string | null }[], now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const m = Math.max(0, Math.round(((e.clock_out ? Date.parse(e.clock_out) : now) - Date.parse(e.clock_in)) / 60000));
    const k = monthKey(e.clock_in);
    out[k] = (out[k] ?? 0) + m;
  }
  return out;
}

export interface RateInputs {
  lines: { amount_cents: Cents; category: CostCategory }[];
  /** Man-hours worked in the month, in minutes. */
  minutes: number;
  /** Target margin on the price, in basis points. */
  target_margin_bps: number;
}

export interface RateResult {
  wages_cents: Cents;
  payroll_tax_cents: Cents;
  overhead_cents: Cents;
  /** Everything counted toward the hourly cost. */
  counted_cents: Cents;
  excluded_cents: Cents;
  hours: number;
  /** Counted costs divided by man-hours; null when no hours were worked. */
  cost_per_hour_cents: Cents | null;
  /** Cost per hour grossed up for the target margin: cost / (1 - margin). */
  price_per_hour_cents: Cents | null;
  /** Share of every hourly dollar that is wages / payroll tax / other costs, in basis points. */
  wages_share_bps: number;
  payroll_tax_share_bps: number;
  overhead_share_bps: number;
  /** The hourly cost split into those three parts, in cents (adds up to cost_per_hour_cents). */
  per_hour: { wages_cents: Cents; payroll_tax_cents: Cents; overhead_cents: Cents } | null;
}

/**
 * The company hourly rate: all counted costs for the month divided by the man-hours worked that month.
 * The price adds the target margin (margin is a share of the price: cost $60 at a 40% margin is a $100 price).
 */
export function computeRate(i: RateInputs): RateResult {
  const sum = (c: CostCategory) => i.lines.filter((l) => l.category === c).reduce((n, l) => n + l.amount_cents, 0);
  const wages = sum('wages');
  const tax = sum('payroll_tax');
  const overhead = sum('overhead');
  const counted = wages + tax + overhead;
  const hours = i.minutes / 60;
  const cost = hours > 0 && counted > 0 ? Math.round(counted / hours) : null;
  const margin = Math.min(i.target_margin_bps, 9500) / 10000;
  const price = cost === null ? null : Math.round(cost / (1 - margin));
  const bps = (part: Cents) => (counted > 0 ? Math.round((part / counted) * 10000) : 0);

  let perHour: RateResult['per_hour'] = null;
  if (cost !== null) {
    const w = Math.round((wages / counted) * cost);
    const t = Math.round((tax / counted) * cost);
    perHour = { wages_cents: w, payroll_tax_cents: t, overhead_cents: cost - w - t }; // the last part absorbs rounding
  }
  return {
    wages_cents: wages,
    payroll_tax_cents: tax,
    overhead_cents: overhead,
    counted_cents: counted,
    excluded_cents: sum('excluded'),
    hours,
    cost_per_hour_cents: cost,
    price_per_hour_cents: price,
    wages_share_bps: bps(wages),
    payroll_tax_share_bps: bps(tax),
    overhead_share_bps: bps(overhead),
    per_hour: perHour,
  };
}

export interface Crew {
  people: number;
  days_per_week: number;
  hours_per_day: number;
  /** Weeks worked in a year (a year has 52 weeks, but the crew does not work all of them). */
  working_weeks: number;
}

/** Man-hours a crew would work in a year, in minutes: people x days a week x hours a day x working weeks. */
export const crewMinutesPerYear = (c: Crew): number => Math.round(c.people * c.days_per_week * c.hours_per_day * c.working_weeks * 60);

/** Man-hours the crew would work across `months` months, in minutes (a year's hours spread evenly over 12 months). */
export const crewMinutes = (c: Crew, months: number): number => Math.round((crewMinutesPerYear(c) * months) / 12);

export interface WindowMonth {
  lines: { amount_cents: Cents; category: CostCategory }[];
  /** Man-hours from the time clock or typed in, in minutes. */
  minutes: number;
}

/**
 * The rate over several months: all their counted costs together divided by all their man-hours together (so a busy month
 * counts for more than a quiet one). With a crew schedule the hours come from the schedule instead of the months' own hours.
 */
export function computeWindowRate(months: WindowMonth[], targetMarginBps: number, crew: Crew | null): RateResult & { minutes: number } {
  const minutes = crew ? crewMinutes(crew, months.length) : months.reduce((n, m) => n + m.minutes, 0);
  const result = computeRate({ lines: months.flatMap((m) => m.lines), minutes, target_margin_bps: targetMarginBps });
  return { ...result, minutes };
}
