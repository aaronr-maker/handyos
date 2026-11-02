import type { Cents } from '@/core';
import type { EstimateLineItem } from './types';

export interface Totals {
  subtotal_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
}

/** Line totals in cents (quantity x price, rounded), tax only on taxable lines, rate in basis points (825 = 8.25%). */
export function computeTotals(items: Pick<EstimateLineItem, 'quantity' | 'unit_price_cents' | 'taxable'>[], taxRateBps: number): Totals {
  let subtotal = 0;
  let taxable = 0;
  for (const i of items) {
    const line = Math.round(i.quantity * i.unit_price_cents);
    subtotal += line;
    if (i.taxable) taxable += line;
  }
  const tax = Math.round((taxable * taxRateBps) / 10000);
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}

export const lineTotal = (i: Pick<EstimateLineItem, 'quantity' | 'unit_price_cents'>): Cents => Math.round(i.quantity * i.unit_price_cents);
