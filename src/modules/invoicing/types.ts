import type { BaseRecord, Cents, Id } from '@/core';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface Invoice extends BaseRecord {
  customer_id: Id;
  job_id: Id | null;
  status: InvoiceStatus;
  total_cents: Cents;
  amount_paid_cents: Cents;
  /** ISO date (YYYY-MM-DD). */
  due_date: string;
}
