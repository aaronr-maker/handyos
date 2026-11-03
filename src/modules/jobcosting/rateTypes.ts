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
  /** Where the account sits in QuickBooks, like "Supplies" or "Job Expenses > Job Materials" (empty at the top level). */
  group_path: string;
  /** Which part of the Profit and Loss it came from ("manual" if typed in). */
  section: 'cogs' | 'expense' | 'other_expense' | 'manual';
  amount_cents: Cents;
  category: CostCategory;
}

/** The key a remembered category is stored under: the account's name together with where it sits. */
export const accountKey = (account: string, group: string) => (group ? `${group} > ${account}` : account).toLowerCase();

/** One income account for a month, from the Profit and Loss (sales, services, discounts given...). */
export interface IncomeLine extends BaseRecord {
  month_id: Id;
  account_name: string;
  group_path: string;
  kind: 'income' | 'other_income';
  amount_cents: Cents;
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
  /** Which accounting method to ask QuickBooks for. */
  accounting_method: 'cash' | 'accrual';
  /** The months averaged for the rate ("2026-08", ...), usually three. */
  rate_months: string[];
  /** Where the hours come from: the time clock (or hours typed per month), or the crew's schedule. */
  hours_mode: 'clock' | 'capacity';
  crew_people: number | null;
  crew_days_per_week: number | null;
  crew_hours_per_day: number;
  /** Weeks worked in a year (default 50 of 52). */
  working_weeks: number;
  /** The resulting company hourly cost, saved so job costing can use it. */
  cost_per_hour_cents: Cents | null;
}
