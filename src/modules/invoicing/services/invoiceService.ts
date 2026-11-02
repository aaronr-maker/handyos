import { createRepo, nextCompanyNumber, type Cents, type Id } from '@/core';
import { computeTotals } from '@/modules/estimates';
import type { Invoice, InvoiceStatus } from '../types';
import type { EstimateLineItem } from '@/modules/estimates';

const invoices = createRepo<Invoice>('invoices');

const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (isoDate: string, days: number) => new Date(Date.parse(isoDate) + days * 86_400_000).toISOString().slice(0, 10);

export interface InvoiceDraft {
  customer_id: Id;
  owed_by_customer_id: Id | null;
  property_id: Id | null;
  job_id: Id | null;
  title: string;
  line_items: EstimateLineItem[];
  tax_rate_bps: number;
  due_date: string;
  notes: string | null;
}

export async function createInvoice(companyId: Id, draft: InvoiceDraft): Promise<Invoice> {
  return invoices.insert(companyId, {
    ...draft,
    ...computeTotals(draft.line_items, draft.tax_rate_bps),
    invoice_number: await nextCompanyNumber(companyId, 'invoice'),
    status: 'draft',
    amount_paid_cents: 0,
    issued_on: null,
    sent_at: null,
    paid_at: null,
    voided_at: null,
    void_reason: null,
  });
}

/** Only drafts can be edited; once sent, an invoice is what the customer received. */
export async function updateDraft(companyId: Id, id: Id, draft: InvoiceDraft): Promise<Invoice> {
  const existing = await invoices.get(companyId, id);
  if (!existing) throw new Error('Invoice not found');
  if (existing.status !== 'draft') throw new Error('Only a draft can be edited. Sent invoices can no longer be changed.');
  return invoices.update(companyId, id, { ...draft, ...computeTotals(draft.line_items, draft.tax_rate_bps) });
}

export const getInvoice = (companyId: Id, id: Id) => invoices.get(companyId, id);
export const listInvoices = async (companyId: Id) => (await invoices.list(companyId)).sort((a, b) => b.invoice_number - a.invoice_number);

export const balanceOf = (i: Pick<Invoice, 'total_cents' | 'amount_paid_cents'>): Cents => i.total_cents - i.amount_paid_cents;

export async function sendInvoice(companyId: Id, id: Id): Promise<Invoice> {
  const existing = await invoices.get(companyId, id);
  if (!existing) throw new Error('Invoice not found');
  if (existing.status === 'void') throw new Error('Cannot send a void invoice');
  if (existing.status === 'paid') throw new Error('This invoice is already paid');
  if (existing.line_items.length === 0 || existing.total_cents <= 0) throw new Error('Add at least one priced line before sending');
  const issued = existing.issued_on ?? today();
  // keep the due date the person chose, but never before the day it was sent
  const due = existing.due_date < issued ? issued : existing.due_date;
  return invoices.update(companyId, id, { status: existing.status === 'overdue' ? 'overdue' : 'sent', sent_at: new Date().toISOString(), issued_on: issued, due_date: due });
}

export async function voidInvoice(companyId: Id, id: Id, reason: string): Promise<Invoice> {
  const existing = await invoices.get(companyId, id);
  if (!existing) throw new Error('Invoice not found');
  if (existing.status === 'void') throw new Error('This invoice is already void');
  if (existing.amount_paid_cents > 0) throw new Error('This invoice has payments on it. Refund them first, then void it.');
  return invoices.update(companyId, id, { status: 'void', voided_at: new Date().toISOString(), void_reason: reason });
}

/**
 * Applies a payment (positive) or refund (negative) to an invoice and keeps its status right:
 * paid once nothing is owed; back to sent/overdue if a refund reopens a balance.
 */
export async function applyPayment(companyId: Id, id: Id, amountCents: Cents): Promise<Invoice> {
  const inv = await invoices.get(companyId, id);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'void') throw new Error('This invoice is void');
  if (inv.status === 'draft') throw new Error('Send the invoice before recording a payment');
  const paid = inv.amount_paid_cents + amountCents;
  if (paid < 0) throw new Error('That refund is more than was paid');
  if (paid > inv.total_cents) throw new Error('That payment is more than the amount owed');
  let status: InvoiceStatus = inv.status;
  if (paid >= inv.total_cents) status = 'paid';
  else if (inv.status === 'paid') status = inv.due_date < today() ? 'overdue' : 'sent';
  return invoices.update(companyId, id, { amount_paid_cents: paid, status, paid_at: status === 'paid' ? new Date().toISOString() : null });
}

export async function markOverdue(companyId: Id, id: Id): Promise<{ invoice: Invoice; daysOverdue: number }> {
  const inv = await invoices.get(companyId, id);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status !== 'sent' && inv.status !== 'overdue') throw new Error(`A ${inv.status} invoice can't be overdue`);
  if (inv.due_date >= today()) throw new Error('This invoice is not past its due date yet');
  const daysOverdue = Math.floor((Date.parse(today()) - Date.parse(inv.due_date)) / 86_400_000);
  return { invoice: await invoices.update(companyId, id, { status: 'overdue' }), daysOverdue };
}

/** Invoices that were sent, still owe money, and are past their due date and not yet flagged. */
export async function findNewlyOverdue(companyId: Id): Promise<Invoice[]> {
  return (await invoices.list(companyId)).filter((i) => i.status === 'sent' && i.due_date < today() && balanceOf(i) > 0);
}
