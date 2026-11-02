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
