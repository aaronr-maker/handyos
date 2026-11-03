import type { BaseRecord, Cents, Id } from '@/core';

/** How an account counts toward the hourly cost. */
export type CostCategory = 'wages' | 'payroll_tax' | 'overhead' | 'excluded';

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  wages: 'Wages',
  payroll_tax: 'Payroll tax',
  overhead: 'Other running costs',
  excluded: 'Not counted',
};

export type CostSource = 'manual' | 'quickbooks_csv' | 'quickbooks_api';

/** One month of company costs. `month` is the first day of the month (YYYY-MM-01). */
export interface OverheadMonth extends BaseRecord {
  month: string;
  source: CostSource;
  /** Man-hours to divide by, in minutes (null = use the time clock). */
  hours_minutes: number | null;
  hours_from_clock: boolean;
  /** The result for the month, saved for job costing. */
  cost_per_hour_cents: Cents | null;
  imported_at: string;
}

export interface OverheadLine extends BaseRecord {
  month_id: Id;
  account_name: string;
  amount_cents: Cents;
  category: CostCategory;
}

export interface AccountMap extends BaseRecord {
  account_name: string;
  category: CostCategory;
}

export interface RateSettings extends BaseRecord {
  /** Target margin on the price, in basis points (3000 = 30%). */
  target_margin_bps: number;
  /** Value labor in job costing at the company hourly cost instead of each person's own pay rate. */
  use_in_job_costing: boolean;
}
