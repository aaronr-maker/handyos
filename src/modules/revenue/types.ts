import type { BaseRecord, Cents } from '@/core';

/** One invoice or payment from an older system. */
export interface RevenueHistory extends BaseRecord {
  /** YYYY-MM-DD */
  received_on: string;
  amount_cents: Cents;
  customer: string;
  job: string;
  invoice_ref: string;
  /** The name of the import it came from. */
  source: string;
}

/** One piece of revenue, from an old import or a payment in HandyOS: what the report groups. */
export interface RevenueEntry {
  date: string;
  amount_cents: Cents;
  customer: string;
  job: string;
  source: string;
}
