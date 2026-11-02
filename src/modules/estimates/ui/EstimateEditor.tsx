import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { centsToInput, formatMoney, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { CustomerPropertyPicker, type WhoValue } from '@/modules/customers';
import { createEstimateAction, updateEstimateAction } from '../actions';
import { getEstimate } from '../services/estimateService';
import { listPriceItems } from '../services/priceBookService';
import { computeTotals } from '../totals';

interface Line {
  description: string;
  quantity: string;
  unit: string;
  price: string;
  cost: number;
  taxable: boolean;
  price_book_item_id: string | null;
}

const blankLine = (): Line => ({ description: '', quantity: '1', unit: 'each', price: '', cost: 0, taxable: true, price_book_item_id: null });

/** Create a new estimate, or edit a draft. */
export default function EstimateEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { companyId } = useSession();
  const create = useAction(createEstimateAction);
  const update = useAction(updateEstimateAction);

  const base = useAsync(
    async () => ({
      priceItems: (await listPriceItems(companyId)).filter((i) => i.active),
      existing: id ? await getEstimate(companyId, id) : undefined,
    }),
    [companyId, id],
  );

  if (base.loading) return <p className="muted">Loading…</p>;
  if (editing && !base.data?.existing) return <p className="err">Estimate not found.</p>;
  if (editing && base.data!.existing!.status !== 'draft') {
    return (
      <section className="page">
        <p className="err">Only a draft can be edited. Sent estimates can no longer be changed.</p>
        <Link to={`/estimates/${id}`}>Back to the estimate</Link>
      </section>
    );
  }
  return <Form key={id ?? 'new'} data={base.data!} onSave={async (v) => {
    const res = editing ? await update({ estimate_id: id!, ...v }) : await create(v);
    const message = resultError(res);
    if (!message && res.status === 'ok') navigate(`/estimates/${(res.output as { id: string }).id}`);
    return message;
  }} />;
}

interface FormProps {
  data: { priceItems: Awaited<ReturnType<typeof listPriceItems>>; existing?: Awaited<ReturnType<typeof getEstimate>> };
  onSave(v: {
    customer_id: string | null;
    property_id: string | null;
    title: string;
    line_items: { description: string; quantity: number; unit: string; unit_price_cents: number; unit_cost_cents: number; taxable: boolean; price_book_item_id: string | null }[];
    tax_rate_bps: number;
    valid_until: string | null;
    notes: string | null;
  }): Promise<string | null>;
}

function Form({ data, onSave }: FormProps) {
  const ex = data.existing;
  // For an existing estimate the billed customer and property are known; the property decides billing again on save.
  const [who, setWho] = useState<WhoValue>({ customerId: ex?.customer_id ?? '', propertyId: ex?.property_id ?? '' });
  const [title, setTitle] = useState(ex?.title ?? '');
  const [lines, setLines] = useState<Line[]>(
    ex ? ex.line_items.map((l) => ({ description: l.description, quantity: String(l.quantity), unit: l.unit, price: centsToInput(l.unit_price_cents), cost: l.unit_cost_cents, taxable: l.taxable, price_book_item_id: l.price_book_item_id })) : [blankLine()],
  );
  const [taxPct, setTaxPct] = useState(ex ? String(ex.tax_rate_bps / 100) : '0');
  const [validUntil, setValidUntil] = useState(ex?.valid_until ?? '');
  const [notes, setNotes] = useState(ex?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = lines.map((l) => ({ quantity: Number(l.quantity), cents: parseMoney(l.price), taxable: l.taxable }));
  const rate = Number(taxPct);
  const totals = computeTotals(
    parsed.map((p) => ({ quantity: Number.isFinite(p.quantity) ? p.quantity : 0, unit_price_cents: p.cents ?? 0, taxable: p.taxable })),
    Number.isFinite(rate) ? Math.round(rate * 100) : 0,
  );

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    const items = [];
    for (const [i, l] of lines.entries()) {
      const cents = parseMoney(l.price);
      if (cents === null) return setError(`Line ${i + 1}: enter a price like 95 or 95.50`);
      items.push({ description: l.description, quantity: Number(l.quantity), unit: l.unit || 'each', unit_price_cents: cents, unit_cost_cents: l.cost, taxable: l.taxable, price_book_item_id: l.price_book_item_id });
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setError('Tax rate must be between 0 and 100');
    setBusy(true);
    const message = await onSave({
      customer_id: who.propertyId ? null : who.customerId || null,
      property_id: who.propertyId || null,
      title,
      line_items: items,
      tax_rate_bps: Math.round(rate * 100),
      valid_until: validUntil || null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <section className="page">
      <Link to={ex ? `/estimates/${ex.id}` : '/estimates'} className="muted">
        ← {ex ? `Estimate #${ex.estimate_number}` : 'Estimates'}
      </Link>
      <header className="page-header">
        <h1>{ex ? `Edit estimate #${ex.estimate_number}` : 'New estimate'}</h1>
      </header>

      <div className="card">
        <h2>Who is it for?</h2>
        <CustomerPropertyPicker value={who} onChange={setWho} />
      </div>

      <div className="card">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix fence gate" />
        </label>
        <h2>Line items</h2>
        {lines.map((l, i) => (
          <div key={i} className="line">
            <input placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
            <div className="row">
              <label className="grow">
                Qty
                <input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              </label>
              <label className="grow">
                Unit
                <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
              </label>
              <label className="grow">
                Price ($)
                <input inputMode="decimal" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={l.taxable} onChange={(e) => setLine(i, { taxable: e.target.checked })} />
                Taxable
              </label>
              <span className="muted">{formatMoney(Math.round((Number(l.quantity) || 0) * (parseMoney(l.price) ?? 0)))}</span>
              {lines.length > 1 && (
                <button type="button" className="link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
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
              const item = data.priceItems.find((p) => p.id === e.target.value);
              if (!item) return;
              const fresh: Line = { description: item.name, quantity: '1', unit: item.unit, price: centsToInput(item.unit_price_cents), cost: item.unit_cost_cents, taxable: item.taxable, price_book_item_id: item.id };
              setLines(lines.length === 1 && !lines[0].description && !lines[0].price ? [fresh] : [...lines, fresh]);
            }}
          >
            <option value="">Add from the price book…</option>
            {data.priceItems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatMoney(p.unit_price_cents)} / {p.unit}
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={() => setLines([...lines, blankLine()])}>
            Add a custom line
          </button>
        </div>
      </div>

      <div className="card">
        <label>
          Tax rate (%) <span className="muted">(applies to taxable lines)</span>
          <input inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
        </label>
        <label>
          Good until <span className="muted">(optional)</span>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
        <label>
          Notes for the customer <span className="muted">(optional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <dl className="totals">
          <dt>Subtotal</dt>
          <dd>{formatMoney(totals.subtotal_cents)}</dd>
          <dt>Tax</dt>
          <dd>{formatMoney(totals.tax_cents)}</dd>
          <dt>
            <strong>Total</strong>
          </dt>
          <dd>
            <strong>{formatMoney(totals.total_cents)}</strong>
          </dd>
        </dl>
        {error && <p className="err">{error}</p>}
        <button disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </section>
  );
}
