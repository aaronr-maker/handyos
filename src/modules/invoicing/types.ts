import type { BaseRecord, Cents, Id } from '@/core';
import type { EstimateLineItem } from '@/modules/estimates';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface Invoice extends BaseRecord {
  /** 1001, 1002, ... per company. */
  invoice_number: number;
  /** Who is billed (the property manager for a managed rental, else the owner). */
  customer_id: Id;
  /** Who it is labeled as owed by (the owner; the manager when no owner is listed). */
  owed_by_customer_id: Id | null;
  property_id: Id | null;
  job_id: Id | null;
  title: string;
  status: InvoiceStatus;
  line_items: EstimateLineItem[];
  /** Tax rate in basis points: 825 = 8.25%. */
  tax_rate_bps: number;
  subtotal_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
  amount_paid_cents: Cents;
  /** ISO dates (YYYY-MM-DD). */
  due_date: string;
  issued_on: string | null;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
}
