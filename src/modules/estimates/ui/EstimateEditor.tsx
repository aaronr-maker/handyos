import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { resultError, useAction, useAsync, useSession } from '@/core';
import { CustomerPropertyPicker, type WhoValue } from '@/modules/customers';
import { createEstimateAction, updateEstimateAction } from '../actions';
import { getEstimate } from '../services/estimateService';
import { listPriceItems } from '../services/priceBookService';
import { LineItemsEditor, TotalsSummary } from './LineItemsEditor';
import { blankLine, editorTotals, parseEditorLines, toEditorLines, type EditorLine } from './lines';

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
  const [lines, setLines] = useState<EditorLine[]>(ex ? toEditorLines(ex.line_items) : [blankLine()]);
  const [taxPct, setTaxPct] = useState(ex ? String(ex.tax_rate_bps / 100) : '0');
  const [validUntil, setValidUntil] = useState(ex?.valid_until ?? '');
  const [notes, setNotes] = useState(ex?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = editorTotals(lines, taxPct);
  const rate = Number(taxPct);

  const save = async () => {
    setError(null);
    const parsed = parseEditorLines(lines);
    if ('error' in parsed) return setError(parsed.error);
    const items = parsed.items;
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
        <LineItemsEditor lines={lines} onChange={setLines} priceItems={data.priceItems} />
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
        <TotalsSummary subtotal={totals.subtotal_cents} tax={totals.tax_cents} total={totals.total_cents} />
        {error && <p className="err">{error}</p>}
        <button disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </section>
  );
}
