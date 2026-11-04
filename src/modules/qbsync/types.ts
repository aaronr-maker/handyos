import type { BaseRecord, Id } from '@/core';

/** The company's choices for sending invoices and payments to QuickBooks. Sending starts switched off. */
export interface SyncSettings extends BaseRecord {
  enabled: boolean;
  income_account_id: string | null;
  income_account_name: string | null;
  deposit_account_id: string | null;
  deposit_account_name: string | null;
  tax_code_id: string | null;
  tax_code_name: string | null;
  /** Only invoices and payments dated on or after this day are sent (YYYY-MM-DD). */
  start_date: string;
}

/** What happened the last time one invoice or payment was sent. */
export interface SyncRecord extends BaseRecord {
  entity: 'invoice' | 'payment';
  local_id: Id;
  qb_id: string | null;
  error: string | null;
}

export const DEFAULT_START = '2027-01-01';
