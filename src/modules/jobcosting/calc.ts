import type { Cents, Id } from '@/core';
import { monthKey } from './rateCalc';

export interface TimeSlice {
  user_id: Id;
  clock_in: string;
  clock_out: string | null;
}

export interface CostInputs {
  /** Invoiced amounts for the job (void invoices already left out). */
  invoiced_cents: Cents;
  collected_cents: Cents;
  entries: TimeSlice[];
  /** user id -> hourly cost in cents. */
  rates: Record<Id, Cents>;
  /** Costs recorded by hand. */
  costs: { kind: 'labor' | 'material' | 'other'; amount_cents: Cents }[];
  /** What the estimate expected the job to cost (sum of quantity x unit cost), if there was one. */
  expected_cost_cents: Cents | null;
  /**
   * When set, labor is valued at the company hourly cost for the month the time was worked (falling back to the
   * most recent month with a rate) instead of each person's own pay rate.
   */
  burdened?: { rates: Record<string, Cents>; fallback: Cents | null };
  /** "now" for entries that are still clocked in. */
  now?: number;
}

export interface JobCostResult {
  labor_minutes: number;
  labor_cents: Cents;
  material_cents: Cents;
  other_cents: Cents;
  total_cost_cents: Cents;
  invoiced_cents: Cents;
  collected_cents: Cents;
  profit_cents: Cents;
  /** Profit as a share of what was invoiced, in percent (null when nothing is invoiced yet). */
  margin_pct: number | null;
  expected_cost_cents: Cents | null;
  /** People on the clock with no pay rate set (their time is counted at $0 until a rate is entered). */
  unrated_user_ids: Id[];
  /** Months of work with no company hourly cost saved (counted at $0 until it is). Only when the company rate is used. */
  missing_rate_months: string[];
  labor_method: 'person' | 'company_rate';
}

const minutesOf = (e: TimeSlice, now: number) => Math.max(0, Math.round(((e.clock_out ? Date.parse(e.clock_out) : now) - Date.parse(e.clock_in)) / 60000));

/** Profit and margin for one job. Labor = clocked hours x each person's hourly cost, plus any hand-entered labor costs. */
export function computeJobCost(i: CostInputs): JobCostResult {
  const now = i.now ?? Date.now();
  let laborMinutes = 0;
  let laborCents = 0;
  const unrated = new Set<Id>();
  const missing = new Set<string>();
  for (const e of i.entries) {
    const m = minutesOf(e, now);
    laborMinutes += m;
    if (i.burdened) {
      const month = monthKey(e.clock_in);
      const rate = i.burdened.rates[month] ?? i.burdened.fallback ?? undefined;
      if (rate === undefined) missing.add(month);
      laborCents += Math.round((m / 60) * (rate ?? 0));
    } else {
      const rate = i.rates[e.user_id];
      if (rate === undefined) unrated.add(e.user_id);
      laborCents += Math.round((m / 60) * (rate ?? 0));
    }
  }
  const sum = (kind: 'labor' | 'material' | 'other') => i.costs.filter((c) => c.kind === kind).reduce((n, c) => n + c.amount_cents, 0);
  const labor = laborCents + sum('labor');
  const material = sum('material');
  const other = sum('other');
  const total = labor + material + other;
  const profit = i.invoiced_cents - total;
  return {
    labor_minutes: laborMinutes,
    labor_cents: labor,
    material_cents: material,
    other_cents: other,
    total_cost_cents: total,
    invoiced_cents: i.invoiced_cents,
    collected_cents: i.collected_cents,
    profit_cents: profit,
    margin_pct: i.invoiced_cents > 0 ? Math.round((profit / i.invoiced_cents) * 1000) / 10 : null,
    expected_cost_cents: i.expected_cost_cents,
    unrated_user_ids: [...unrated],
    missing_rate_months: [...missing].sort(),
    labor_method: i.burdened ? 'company_rate' : 'person',
  };
}
