import { centsToInput, parseMoney } from '@/core';
import { computeTotals } from '../totals';
import type { EstimateLineItem } from '../types';

/** A line as typed in a form (text boxes), before it is turned into cents. */
export interface EditorLine {
  description: string;
  quantity: string;
  unit: string;
  price: string;
  cost: number;
  taxable: boolean;
  price_book_item_id: string | null;
}

export const blankLine = (): EditorLine => ({ description: '', quantity: '1', unit: 'each', price: '', cost: 0, taxable: true, price_book_item_id: null });

export const toEditorLines = (items: EstimateLineItem[]): EditorLine[] =>
  items.map((l) => ({
    description: l.description,
    quantity: String(l.quantity),
    unit: l.unit,
    price: centsToInput(l.unit_price_cents),
    cost: l.unit_cost_cents,
    taxable: l.taxable,
    price_book_item_id: l.price_book_item_id,
  }));

/** Turns typed lines into line items, or says which line is wrong. */
export function parseEditorLines(lines: EditorLine[]): { items: EstimateLineItem[] } | { error: string } {
  const items: EstimateLineItem[] = [];
  for (const [i, l] of lines.entries()) {
    const cents = parseMoney(l.price);
    if (cents === null) return { error: `Line ${i + 1}: enter a price like 95 or 95.50` };
    items.push({ description: l.description, quantity: Number(l.quantity), unit: l.unit || 'each', unit_price_cents: cents, unit_cost_cents: l.cost, taxable: l.taxable, price_book_item_id: l.price_book_item_id });
  }
  return { items };
}

/** Live totals for typed lines and a tax rate typed as a percent. */
export function editorTotals(lines: EditorLine[], taxPct: string) {
  const rate = Number(taxPct);
  return computeTotals(
    lines.map((l) => ({ quantity: Number.isFinite(Number(l.quantity)) ? Number(l.quantity) : 0, unit_price_cents: parseMoney(l.price) ?? 0, taxable: l.taxable })),
    Number.isFinite(rate) ? Math.round(rate * 100) : 0,
  );
}
