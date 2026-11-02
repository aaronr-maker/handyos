import type { Cents, Id } from '@/core';
import type { LevelKind, P4PBasis } from './p4pTypes';

export interface CalcLevel {
  id: Id;
  name: string;
  kind: LevelKind;
  percent_bps: number;
  sort_order: number;
}

export interface CalcInputs {
  basis: P4PBasis;
  company_reserve_bps: number;
  levels: CalcLevel[];
  /** user id -> the person they report to */
  reports_to: Record<Id, Id | null | undefined>;
  /** What the job brought in and cost. */
  revenue_cents: Cents;
  /** Materials and other non-labor costs. */
  non_labor_cost_cents: Cents;
  total_cost_cents: Cents;
  sold_by: Id | null;
  /** user id -> minutes worked on the job */
  minutes: Record<Id, number>;
}

export interface Allocation {
  user_id: Id;
  amount_cents: Cents;
  /** Share of the level this person received (0..1). */
  share: number;
}

export interface LevelResult {
  level_id: Id;
  name: string;
  kind: LevelKind;
  percent_bps: number;
  amount_cents: Cents;
  allocations: Allocation[];
  /** The part of this level's amount nobody could receive (no seller, no boss set, ...). It stays with the company. */
  unallocated_cents: Cents;
  /** Plain-language reason when part of the amount was unallocated. */
  note: string | null;
}

export interface P4PResult {
  basis: P4PBasis;
  basis_cents: Cents;
  reserve_bps: number;
  reserve_cents: Cents;
  pool_cents: Cents;
  levels: LevelResult[];
  /** Total per person across levels. */
  by_user: Record<Id, Cents>;
  /** The reserve plus anything not allocated; what the company keeps. */
  company_total_cents: Cents;
  total_minutes: number;
}

/** Splits `total` cents by weights using largest remainders, so the parts add up exactly. Entries with weight 0 get 0. */
export function splitCents(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = total - parts.reduce((n, x) => n + x, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i] > 0) {
      parts[i]++;
      left--;
    }
  }
  return parts;
}

/** The amount the pool is taken from, never negative. */
export function basisAmount(i: Pick<CalcInputs, 'basis' | 'revenue_cents' | 'non_labor_cost_cents' | 'total_cost_cents'>): Cents {
  const raw = i.basis === 'revenue' ? i.revenue_cents : i.basis === 'gross_profit' ? i.revenue_cents - i.non_labor_cost_cents : i.revenue_cents - i.total_cost_cents;
  return Math.max(0, raw);
}

/**
 * Works out who gets what for one job.
 *  1. basis (revenue / gross profit / net profit), never below zero
 *  2. the company keeps its reserve percent first; the rest is the pool
 *  3. each level takes its percent of the pool (levels run in their order)
 *       seller: the person who sold the job
 *       worker: everyone who clocked time, by their share of the hours
 *       supervisor: the bosses of whoever received money on the level below, weighted by what flowed up through them
 *  4. whatever can't be given to anyone (no seller, nobody set as a boss) stays with the company
 */
export function computeP4P(i: CalcInputs): P4PResult {
  const basis_cents = basisAmount(i);
  const reserve_cents = Math.round((basis_cents * i.company_reserve_bps) / 10000);
  const pool_cents = basis_cents - reserve_cents;
  const levels = [...i.levels].sort((a, b) => a.sort_order - b.sort_order);
  const by_user: Record<Id, Cents> = {};
  const results: LevelResult[] = [];
  const give = (user: Id, cents: Cents) => {
    by_user[user] = (by_user[user] ?? 0) + cents;
  };

  const workers = Object.entries(i.minutes).filter(([, m]) => m > 0);
  // who the next supervisor level answers to: user (or null = nobody) -> weight
  let below: Map<Id | null, number> | null = null;

  for (const level of levels) {
    const amount = Math.floor((pool_cents * level.percent_bps) / 10000);
    let weights: Map<Id | null, number>;
    let note: string | null = null;

    if (level.kind === 'seller') {
      weights = new Map([[i.sold_by, 1]]);
      if (!i.sold_by) note = 'No seller is recorded for this job.';
    } else if (level.kind === 'worker') {
      weights = new Map(workers.map(([u, m]) => [u, m]));
      if (workers.length === 0) {
        weights = new Map([[null, 1]]);
        note = 'Nobody clocked time on this job.';
      }
      below = new Map(weights);
    } else {
      const source: Map<Id | null, number> = below ?? new Map<Id | null, number>([[null, 1]]);
      weights = new Map();
      for (const [user, w] of source) {
        const boss = user === null ? null : (i.reports_to[user] ?? null);
        weights.set(boss, (weights.get(boss) ?? 0) + w);
      }
      if (weights.has(null)) note = 'Some people on the level below have nobody set to report to.';
      below = new Map(weights);
    }

    const entries = [...weights.entries()];
    const parts = splitCents(amount, entries.map(([, w]) => w));
    const total = entries.reduce((n, [, w]) => n + w, 0);
    const allocations: Allocation[] = [];
    let unallocated = 0;
    entries.forEach(([user, w], idx) => {
      if (user === null) unallocated += parts[idx];
      else if (parts[idx] > 0 || w > 0) {
        allocations.push({ user_id: user, amount_cents: parts[idx], share: total > 0 ? w / total : 0 });
        give(user, parts[idx]);
      }
    });
    results.push({ level_id: level.id, name: level.name, kind: level.kind, percent_bps: level.percent_bps, amount_cents: amount, allocations, unallocated_cents: unallocated, note });
  }

  const paid_out = Object.values(by_user).reduce((n, x) => n + x, 0);
  return {
    basis: i.basis,
    basis_cents,
    reserve_bps: i.company_reserve_bps,
    reserve_cents,
    pool_cents,
    levels: results,
    by_user,
    company_total_cents: basis_cents - paid_out,
    total_minutes: workers.reduce((n, [, m]) => n + m, 0),
  };
}

/** Why a setup can't be saved, or null when it is fine. */
export function validateSetup(reserve_bps: number, levels: Pick<CalcLevel, 'name' | 'kind' | 'percent_bps'>[]): string | null {
  if (reserve_bps < 0 || reserve_bps > 10000) return 'The company share must be between 0% and 100%.';
  if (levels.some((l) => !l.name.trim())) return 'Every level needs a name.';
  if (levels.some((l) => l.percent_bps < 0 || l.percent_bps > 10000)) return 'Each level must be between 0% and 100%.';
  const sum = levels.reduce((n, l) => n + l.percent_bps, 0);
  if (sum > 10000) return `The levels add up to ${(sum / 100).toFixed(2).replace(/\.00$/, '')}%, which is more than 100% of the pool.`;
  if (levels.filter((l) => l.kind === 'seller').length > 1) return 'Only one level can be the seller level.';
  if (levels.filter((l) => l.kind === 'worker').length > 1) return 'Only one level can be the worker level.';
  return null;
}
