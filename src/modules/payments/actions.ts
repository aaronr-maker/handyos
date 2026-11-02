import { z } from 'zod';
import { defineAction } from '@/core';
import { recordPayment } from './services/paymentService';

export const recordPaymentAction = defineAction({
  name: 'payments.record',
  module: 'payments',
  description: 'Record a payment received against an invoice.',
  input: z.object({
    invoice_id: z.string().min(1),
    amount_cents: z.number().int().positive(),
    method: z.enum(['card', 'cash', 'check', 'other']),
  }),
  risk: 'medium',
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { invoice_id: 'invoice-id', amount_cents: 19000, method: 'check' },
  async handler(input, ctx) {
    const payment = recordPayment(ctx.companyId, { ...input, provider_ref: null });
    await ctx.events.emit(ctx.companyId, 'payment.received', {
      invoiceId: input.invoice_id,
      amountCents: input.amount_cents,
    });
    return payment;
  },
});

export const refundPaymentAction = defineAction({
  name: 'payments.refund',
  module: 'payments',
  description: 'Refund money to a customer. Always needs a human to approve.',
  input: z.object({
    invoice_id: z.string().min(1),
    amount_cents: z.number().int().positive(),
    reason: z.string().min(1).max(500),
  }),
  risk: 'high',
  requiresApproval: true,
  example: { invoice_id: 'invoice-id', amount_cents: 5000, reason: 'Goodwill credit' },
  async handler(input, ctx) {
    const payment = recordPayment(ctx.companyId, {
      invoice_id: input.invoice_id,
      amount_cents: -input.amount_cents,
      method: 'other',
      provider_ref: null,
    });
    await ctx.events.emit(ctx.companyId, 'payment.refunded', {
      invoiceId: input.invoice_id,
      amountCents: input.amount_cents,
    });
    return payment;
  },
});
