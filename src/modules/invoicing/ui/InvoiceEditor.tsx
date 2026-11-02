import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { resultError, useAction, useAsync, useSession } from '@/core';
import { CustomerPropertyPicker, type WhoValue } from '@/modules/customers';
import { LineItemsEditor, TotalsSummary, blankLine, editorTotals, getEstimate, listPriceItems, parseEditorLines, toEditorLines, type EditorLine } from '@/modules/estimates';
import { getJob } from '@/modules/jobs';
import { createInvoiceAction, updateInvoiceAction } from '../actions';
import { addDays, getInvoice } from '../services/invoiceService';

type PriceItems = Awaited<ReturnType<typeof listPriceItems>>;

/** Create a new invoice (optionally from a job, with ?job=ID), or edit a draft. */
export default function InvoiceEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const jobId = params.get('job');
  const { companyId } = useSession();
  const base = useAsync(async () => {
    const existing = id ? await getInvoice(companyId, id) : undefined;
    const job = !existing && jobId ? await getJob(companyId, jobId) : undefined;
    const estimate = job?.estimate_id ? await getEstimate(companyId, job.estimate_id) : undefined;
    return { priceItems: (await listPriceItems(companyId)).filter((i) => i.active), existing, job, estimate };
  }, [companyId, id, jobId]);

  if (base.loading) return <p className="muted">Loading…</p>;
  if (id && !base.data?.existing) return <p className="err">Invoice not found.</p>;
  if (base.data?.existing && base.data.existing.status !== 'draft') {
    return (
      <section className="page">
        <p className="err">Only a draft can be edited. Sent invoices can no longer be changed.</p>
        <Link to={`/invoices/${id}`}>Back to the invoice</Link>
      </section>
    );
  }
  return <Form key={id ?? jobId ?? 'new'} data={base.data!} />;
}

function Form({ data }: { data: { priceItems: PriceItems; existing?: Awaited<ReturnType<typeof getInvoice>>; job?: Awaited<ReturnType<typeof getJob>>; estimate?: Awaited<ReturnType<typeof getEstimate>> } }) {
  const { existing: ex, job, estimate } = data;
  const navigate = useNavigate();
  const create = useAction(createInvoiceAction);
  const update = useAction(updateInvoiceAction);

  const [who, setWho] = useState<WhoValue>({ customerId: ex?.customer_id ?? job?.customer_id ?? '', propertyId: ex?.property_id ?? job?.property_id ?? '' });
  const [title, setTitle] = useState(ex?.title ?? job?.title ?? '');
  const [lines, setLines] = useState<EditorLine[]>(ex ? toEditorLines(ex.line_items) : estimate ? toEditorLines(estimate.line_items) : [blankLine()]);
  const [taxPct, setTaxPct] = useState(ex ? String(ex.tax_rate_bps / 100) : estimate ? String(estimate.tax_rate_bps / 100) : '0');
  const [dueDate, setDueDate] = useState(ex?.due_date ?? addDays(new Date().toISOString().slice(0, 10), 14));
  const [notes, setNotes] = useState(ex?.notes ?? estimate?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totals = editorTotals(lines, taxPct);

  const save = async () => {
    setError(null);
    const parsed = parseEditorLines(lines);
    if ('error' in parsed) return setError(parsed.error);
    const rate = Number(taxPct);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setError('Tax rate must be between 0 and 100');
    setBusy(true);
    const body = {
      customer_id: who.propertyId ? null : who.customerId || null,
      property_id: who.propertyId || null,
      job_id: ex?.job_id ?? job?.id ?? null,
      title,
      line_items: parsed.items,
      tax_rate_bps: Math.round(rate * 100),
      due_date: dueDate,
      notes: notes.trim() || null,
    };
    const res = ex ? await update({ invoice_id: ex.id, ...body }) : await create(body);
    const message = resultError(res);
    setBusy(false);
    if (message) setError(message);
    else if (res.status === 'ok') navigate(`/invoices/${(res.output as { id: string }).id}`);
  };

  return (
    <section className="page">
      <Link to={ex ? `/invoices/${ex.id}` : '/invoices'} className="muted">
        ← {ex ? `Invoice #${ex.invoice_number}` : 'Invoices'}
      </Link>
      <header className="page-header">
        <h1>{ex ? `Edit invoice #${ex.invoice_number}` : 'New invoice'}</h1>
      </header>
      {job && <p className="notice">For job #{job.job_number}. {estimate ? 'Lines copied from its estimate.' : 'This job has no estimate, so add the lines below.'}</p>}

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
          Due date
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
