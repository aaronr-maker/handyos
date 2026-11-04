import type { Id } from '@/core';
import type { InvoicePayload, PaymentPayload } from './service';
import type { SyncRecord } from './types';

export interface QueueInvoice {
  kind: 'invoice';
  id: Id;
  label: string;
  date: string;
  cents: number;
  state: 'sent' | 'failed' | 'waiting';
  error: string | null;
  payload: InvoicePayload;
}
export interface QueuePayment {
  kind: 'payment';
  id: Id;
  label: string;
  date: string;
  cents: number;
  state: 'sent' | 'failed' | 'waiting' | 'needs_invoice' | 'refund';
  error: string | null;
  payload: PaymentPayload;
}
export type QueueItem = QueueInvoice | QueuePayment;

interface InvoiceIn {
  id: Id;
  invoice_number: number;
  title: string;
  status: string;
  issued_on: string | null;
  due_date: string;
  total_cents: number;
  tax_cents: number;
  notes: string | null;
  customer: { name: string; email: string | null };
  line_items: { description: string; quantity: number; unit_price_cents: number; taxable: boolean }[];
}
interface PaymentIn {
  id: Id;
  invoice_id: Id;
  amount_cents: number;
  method: string;
  received_on: string;
  provider_ref: string | null;
}

/**
 * What would be sent to QuickBooks and what already was: invoices that are out (not drafts or voided) dated on or after the
 * start day, and the payments on them. A payment waits until its invoice has been sent; refunds are left for QuickBooks by hand.
 */
export function buildQueue(invoices: InvoiceIn[], payments: PaymentIn[], records: Pick<SyncRecord, 'entity' | 'local_id' | 'qb_id' | 'error'>[], startDate: string): QueueItem[] {
  const rec = new Map(records.map((r) => [`${r.entity}:${r.local_id}`, r]));
  const out: QueueItem[] = [];
  const live = new Map<Id, InvoiceIn>();
  for (const inv of invoices) {
    if (inv.status === 'draft' || inv.status === 'void') continue;
    const date = inv.issued_on ?? inv.due_date;
    if (date < startDate) continue;
    live.set(inv.id, inv);
    const r = rec.get(`invoice:${inv.id}`);
    out.push({
      kind: 'invoice',
      id: inv.id,
      label: `Invoice #${inv.invoice_number} · ${inv.customer.name}`,
      date,
      cents: inv.total_cents,
      state: r?.qb_id ? 'sent' : r?.error ? 'failed' : 'waiting',
      error: r?.error ?? null,
      payload: {
        local_id: inv.id,
        number: inv.invoice_number,
        title: inv.title,
        date,
        due_date: inv.due_date,
        customer: inv.customer,
        lines: inv.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unit_cents: l.unit_price_cents, taxable: l.taxable })),
        tax_cents: inv.tax_cents,
        notes: inv.notes,
      },
    });
  }
  for (const p of payments) {
    const inv = live.get(p.invoice_id);
    if (!inv || p.received_on < startDate) continue;
    const r = rec.get(`payment:${p.id}`);
    const invoiceSent = !!rec.get(`invoice:${p.invoice_id}`)?.qb_id;
    out.push({
      kind: 'payment',
      id: p.id,
      label: `Payment on invoice #${inv.invoice_number}`,
      date: p.received_on,
      cents: p.amount_cents,
      state: r?.qb_id ? 'sent' : p.amount_cents <= 0 ? 'refund' : r?.error ? 'failed' : invoiceSent ? 'waiting' : 'needs_invoice',
      error: r?.error ?? null,
      payload: { local_id: p.id, invoice_local_id: p.invoice_id, date: p.received_on, amount_cents: p.amount_cents, method: p.method, reference: p.provider_ref },
    });
  }
  // invoices before their payments, oldest first
  return out.sort((a, b) => (a.kind === b.kind ? a.date.localeCompare(b.date) : a.kind === 'invoice' ? -1 : 1));
}
