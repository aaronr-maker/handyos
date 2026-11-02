import { z } from 'zod';
import { defineAction } from '@/core';
import { createInvoice, getInvoice, setInvoiceStatus } from './services/invoiceService';

export const createInvoiceAction = defineAction({
  name: 'invoicing.create',
  module: 'invoicing',
  description: 'Create a draft invoice.',
  input: z.object({
    customer_id: z.string().min(1),
    job_id: z.string().nullable().default(null),
    total_cents: z.number().int().positive(),
    due_date: z.iso.date(),
  }),
  risk: 'low',
  requiresApproval: false,
  example: { customer_id: 'customer-id', job_id: null, total_cents: 19000, due_date: '2026-12-15' },
  async handler(input, ctx) {
    const invoice = createInvoice(ctx.companyId, input);
    await ctx.events.emit(ctx.companyId, 'invoice.created', {
      invoiceId: invoice.id,
      customerId: invoice.customer_id,
      totalCents: invoice.total_cents,
    });
    return invoice;
  },
});

export const sendInvoiceAction = defineAction({
  name: 'invoicing.send',
  module: 'invoicing',
  description: 'Send an invoice to the customer.',
  input: z.object({ invoice_id: z.string().min(1) }),
  risk: 'medium',
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { invoice_id: 'invoice-id' },
  async handler(input, ctx) {
    const existing = getInvoice(ctx.companyId, input.invoice_id);
    if (!existing) throw new Error('Invoice not found');
    if (existing.status === 'void') throw new Error('Cannot send a void invoice');
    const invoice = setInvoiceStatus(ctx.companyId, existing.id, 'sent');
    await ctx.events.emit(ctx.companyId, 'invoice.sent', { invoiceId: invoice.id, customerId: invoice.customer_id });
    return invoice;
  },
});

export const flagOverdueAction = defineAction({
  name: 'invoicing.flag_overdue',
  module: 'invoicing',
  description: 'Mark an unpaid, past-due invoice overdue and announce it so reminders can follow.',
  input: z.object({ invoice_id: z.string().min(1) }),
  risk: 'low',
  requiresApproval: false,
  example: { invoice_id: 'invoice-id' },
  async handler(input, ctx) {
    const existing = getInvoice(ctx.companyId, input.invoice_id);
    if (!existing) throw new Error('Invoice not found');
    if (existing.status === 'paid' || existing.status === 'void') throw new Error(`Invoice is ${existing.status}`);
    const daysOverdue = Math.max(0, Math.floor((Date.now() - Date.parse(existing.due_date)) / 86_400_000));
    const invoice = setInvoiceStatus(ctx.companyId, existing.id, 'overdue');
    await ctx.events.emit(ctx.companyId, 'invoice.overdue', {
      invoiceId: invoice.id,
      customerId: invoice.customer_id,
      amountDueCents: invoice.total_cents - invoice.amount_paid_cents,
      daysOverdue,
    });
    return invoice;
  },
});

export const voidInvoiceAction = defineAction({
  name: 'invoicing.void',
  module: 'invoicing',
  description: 'Void an invoice. Cannot be undone.',
  input: z.object({ invoice_id: z.string().min(1), reason: z.string().min(1).max(500) }),
  risk: 'high',
  requiresApproval: true,
  example: { invoice_id: 'invoice-id', reason: 'Duplicate invoice' },
  async handler(input, ctx) {
    if (!getInvoice(ctx.companyId, input.invoice_id)) throw new Error('Invoice not found');
    const invoice = setInvoiceStatus(ctx.companyId, input.invoice_id, 'void');
    await ctx.events.emit(ctx.companyId, 'invoice.voided', { invoiceId: invoice.id, reason: input.reason });
    return invoice;
  },
});
