import type { BaseRecord, Cents, Id } from '@/core';

/** What the pool is taken from. */
export type P4PBasis = 'revenue' | 'gross_profit' | 'net_profit';

export const BASIS_LABELS: Record<P4PBasis, { title: string; detail: string }> = {
  revenue: { title: 'Revenue', detail: 'Everything invoiced for the job, before any costs.' },
  gross_profit: { title: 'Gross profit', detail: 'Revenue minus materials and other non-labor costs.' },
  net_profit: { title: 'Net profit', detail: 'Revenue minus every cost, including labor.' },
};

/**
 * What a level does:
 *  - seller: the person who sold the job
 *  - worker: the people who worked the job, shared by each person's hours
 *  - supervisor: the people who oversee the level below it (the bosses of whoever got paid on the level beneath)
 */
export type LevelKind = 'seller' | 'worker' | 'supervisor';

export const KIND_LABELS: Record<LevelKind, string> = {
  seller: 'Sells the job',
  worker: 'Works the job (shared by hours)',
  supervisor: 'Oversees the level below',
};

export interface P4PSettings extends BaseRecord {
  basis: P4PBasis;
  /** Share of the basis the company keeps first, in basis points (1000 = 10%). */
  company_reserve_bps: number;
}

/** One level of the pool. Names are the company's own ("Technician", "Field operative", ...). */
export interface P4PLevel extends BaseRecord {
  name: string;
  kind: LevelKind;
  /** Share of the pool this level receives, in basis points. */
  percent_bps: number;
  sort_order: number;
}

/** A person's place in the structure: which level they are on and who they report to. */
export interface TeamStructure extends BaseRecord {
  user_id: Id;
  level_id: Id | null;
  reports_to: Id | null;
}

export interface P4PRun extends BaseRecord {
  job_id: Id;
  basis: P4PBasis;
  basis_cents: Cents;
  reserve_bps: number;
  reserve_cents: Cents;
  pool_cents: Cents;
  company_total_cents: Cents;
  snapshot: unknown;
  finalized_by: Id | null;
  finalized_at: string;
}

export interface P4PPayout extends BaseRecord {
  run_id: Id;
  job_id: Id;
  user_id: Id;
  level_name: string;
  minutes: number;
  amount_cents: Cents;
  /** ISO date once it has been paid out. */
  paid_on: string | null;
}
