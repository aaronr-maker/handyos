import { centsToInput, formatMoney, parseMoney } from '@/core';
import type { PriceBookItem } from '../types';
import { blankLine, type EditorLine } from './lines';

interface Props {
  lines: EditorLine[];
  onChange(lines: EditorLine[]): void;
  priceItems: PriceBookItem[];
}

/** The line-item list with "add from price book" and "custom line". Shared by estimates and invoices. */
export function LineItemsEditor({ lines, onChange, priceItems }: Props) {
  const set = (i: number, patch: Partial<EditorLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div>
      <h2>Line items</h2>
      {lines.map((l, i) => (
        <div key={i} className="line">
          <input placeholder="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
          <div className="row">
            <label className="grow">
              Qty
              <input inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            </label>
            <label className="grow">
              Unit
              <input value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} />
            </label>
            <label className="grow">
              Price ($)
              <input inputMode="decimal" value={l.price} onChange={(e) => set(i, { price: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={l.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} />
              Taxable
            </label>
            <span className="muted">{formatMoney(Math.round((Number(l.quantity) || 0) * (parseMoney(l.price) ?? 0)))}</span>
            {lines.length > 1 && (
              <button type="button" className="link" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="row">
        <select
          value=""
          onChange={(e) => {
            const item = priceItems.find((p) => p.id === e.target.value);
            if (!item) return;
            const fresh: EditorLine = { description: item.name, quantity: '1', unit: item.unit, price: centsToInput(item.unit_price_cents), cost: item.unit_cost_cents, taxable: item.taxable, price_book_item_id: item.id };
            onChange(lines.length === 1 && !lines[0].description && !lines[0].price ? [fresh] : [...lines, fresh]);
          }}
        >
          <option value="">Add from the price book…</option>
          {priceItems.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatMoney(p.unit_price_cents)} / {p.unit}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={() => onChange([...lines, blankLine()])}>
          Add a custom line
        </button>
      </div>
    </div>
  );
}

/** Subtotal / tax / total block. */
export function TotalsSummary({ subtotal, tax, total }: { subtotal: number; tax: number; total: number }) {
  return (
    <dl className="totals">
      <dt>Subtotal</dt>
      <dd>{formatMoney(subtotal)}</dd>
      <dt>Tax</dt>
      <dd>{formatMoney(tax)}</dd>
      <dt>
        <strong>Total</strong>
      </dt>
      <dd>
        <strong>{formatMoney(total)}</strong>
      </dd>
    </dl>
  );
}
