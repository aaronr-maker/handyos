import { createMemoryRepo, type Cents, type Id } from '@/core';
import type { Invoice, InvoiceStatus } from '../types';

const invoices = createMemoryRepo<Invoice>();

export function createInvoice(
  companyId: Id,
  data: { customer_id: Id; job_id: Id | null; total_cents: Cents; due_date: string },
): Invoice {
  return invoices.insert(companyId, { ...data, status: 'draft', amount_paid_cents: 0 });
}

export function getInvoice(companyId: Id, id: Id): Invoice | undefined {
  return invoices.get(companyId, id);
}

export function listInvoices(companyId: Id): Invoice[] {
  return invoices.list(companyId);
}

export function setInvoiceStatus(companyId: Id, id: Id, status: InvoiceStatus): Invoice {
  return invoices.update(companyId, id, { status });
}

/** Applies a payment; marks the invoice paid once the balance reaches zero. */
export function applyPayment(companyId: Id, id: Id, amountCents: Cents): Invoice {
  const inv = invoices.get(companyId, id);
  if (!inv) throw new Error('Invoice not found');
  const paid = inv.amount_paid_cents + amountCents;
  return invoices.update(companyId, id, {
    amount_paid_cents: paid,
    status: paid >= inv.total_cents ? 'paid' : inv.status,
  });
}
