import type { BaseRecord, Cents, Id } from '@/core';

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'declined';

export interface EstimateLineItem {
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: Cents;
  /** What it costs you (for job costing); never shown to the customer. */
  unit_cost_cents: Cents;
  taxable: boolean;
  price_book_item_id: Id | null;
}

export interface Estimate extends BaseRecord {
  /** 1001, 1002, ... per company. */
  estimate_number: number;
  /** Who is billed: the property manager for a managed rental, else the owner. */
  customer_id: Id;
  /** Who it is labeled as owed by: the owner (the manager when no owner is listed). */
  owed_by_customer_id: Id | null;
  property_id: Id | null;
  /** The team member who sold the job (earns the seller share of pay-for-performance). */
  sold_by: Id | null;
  title: string;
  status: EstimateStatus;
  line_items: EstimateLineItem[];
  /** Tax rate in basis points: 825 = 8.25%. */
  tax_rate_bps: number;
  subtotal_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
  /** ISO date. */
  valid_until: string | null;
  notes: string | null;
  sent_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
}

export type PriceKind = 'service' | 'material' | 'fee';

/** Something you can quote: a service, material or fee, with what you charge and what it costs you. */
export interface PriceBookItem extends BaseRecord {
  name: string;
  description: string | null;
  kind: PriceKind;
  /** "each", "hour", "ft", ... */
  unit: string;
  unit_price_cents: Cents;
  unit_cost_cents: Cents;
  taxable: boolean;
  active: boolean;
}
