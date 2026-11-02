import type { BaseRecord, Cents, Id } from '@/core';

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'declined';

export interface EstimateLineItem {
  description: string;
  quantity: number;
  unit_price_cents: Cents;
}

export interface Estimate extends BaseRecord {
  customer_id: Id;
  title: string;
  status: EstimateStatus;
  line_items: EstimateLineItem[];
  total_cents: Cents;
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
