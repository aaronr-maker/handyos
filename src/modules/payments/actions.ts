import { z } from 'zod';
import { defineAction } from '@/core';
import { applyPayment, getInvoice } from '@/modules/invoicing';
import { savePayment } from './services/paymentService';

const today = () => new Date().toISOString().slice(0, 10);
const methods = z.enum(['card', 'cash', 'check', 'bank_transfer', 'other']);

export const recordPaymentAction = defineAction({
  name: 'payments.record',
  module: 'payments',
  description: 'Record a payment received against a sent invoice (cash, check, card, bank transfer). The invoice balance and status update.',
  input: z.object({
    invoice_id: z.string().min(1),
    amount_cents: z.number().int().positive('Enter an amount greater than zero'),
    method: methods,
    received_on: z.iso.date().default(today),
    note: z.string().trim().max(500).nullable().default(null),
  }),
  roles: ['owner', 'admin', 'office'],
  risk: 'medium',
  // Money in the books: an AI agent can propose it, a person confirms.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { invoice_id: 'invoice-id', amount_cents: 19000, method: 'check', received_on: '2026-12-01', note: 'Check #1042' },
  async handler(input, ctx) {
    if (!(await getInvoice(ctx.companyId, input.invoice_id))) throw new Error('Invoice not found');
    // the invoice checks the amount and state first, so a bad payment is never saved
    await applyPayment(ctx.companyId, input.invoice_id, input.amount_cents);
    const payment = await savePayment(ctx.companyId, { ...input, provider_ref: null, recorded_by: ctx.actor.kind === 'user' ? ctx.actor.id : null });
    await ctx.events.emit(ctx.companyId, 'payment.received', { invoiceId: input.invoice_id, amountCents: input.amount_cents });
    return payment;
  },
});

export const refundPaymentAction = defineAction({
  name: 'payments.refund',
  module: 'payments',
  description: 'Refund money to a customer against an invoice. Only an owner or admin can refund; an AI agent can only propose one for a person to approve.',
  input: z.object({
    invoice_id: z.string().min(1),
    amount_cents: z.number().int().positive('Enter an amount greater than zero'),
    method: methods.default('other'),
    reason: z.string().trim().min(1, 'Say why').max(500),
  }),
  roles: ['owner', 'admin'],
  risk: 'high',
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { invoice_id: 'invoice-id', amount_cents: 5000, method: 'other', reason: 'Goodwill credit' },
  async handler(input, ctx) {
    if (!(await getInvoice(ctx.companyId, input.invoice_id))) throw new Error('Invoice not found');
    await applyPayment(ctx.companyId, input.invoice_id, -input.amount_cents);
    const payment = await savePayment(ctx.companyId, {
      invoice_id: input.invoice_id,
      amount_cents: -input.amount_cents,
      method: input.method,
      provider_ref: null,
      received_on: today(),
      note: input.reason,
      recorded_by: ctx.actor.kind === 'user' ? ctx.actor.id : null,
    });
    await ctx.events.emit(ctx.companyId, 'payment.refunded', { invoiceId: input.invoice_id, amountCents: input.amount_cents });
    return payment;
  },
});
