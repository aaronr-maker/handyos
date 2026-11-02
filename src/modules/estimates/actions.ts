import { z } from 'zod';
import { defineAction } from '@/core';
import { createEstimate, getEstimate, setEstimateStatus } from './services/estimateService';

const lineItem = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit_price_cents: z.number().int().nonnegative(),
});

export const createEstimateAction = defineAction({
  name: 'estimates.create',
  module: 'estimates',
  description: 'Create a draft estimate for a customer.',
  input: z.object({
    customer_id: z.string().min(1),
    title: z.string().min(1).max(200),
    line_items: z.array(lineItem).min(1),
  }),
  risk: 'low',
  requiresApproval: false,
  example: {
    customer_id: 'customer-id',
    title: 'Fix fence gate',
    line_items: [{ description: 'Labor, 2 hrs', quantity: 2, unit_price_cents: 9500 }],
  },
  async handler(input, ctx) {
    const estimate = createEstimate(ctx.companyId, input);
    await ctx.events.emit(ctx.companyId, 'estimate.created', {
      estimateId: estimate.id,
      customerId: estimate.customer_id,
      totalCents: estimate.total_cents,
    });
    return estimate;
  },
});

export const sendEstimateAction = defineAction({
  name: 'estimates.send',
  module: 'estimates',
  description: 'Send an estimate to the customer for approval.',
  input: z.object({ estimate_id: z.string().min(1) }),
  risk: 'medium',
  // A person can send directly; an AI agent must get sign-off first.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { estimate_id: 'estimate-id' },
  async handler(input, ctx) {
    if (!getEstimate(ctx.companyId, input.estimate_id)) throw new Error('Estimate not found');
    const estimate = setEstimateStatus(ctx.companyId, input.estimate_id, 'sent');
    await ctx.events.emit(ctx.companyId, 'estimate.sent', { estimateId: estimate.id, customerId: estimate.customer_id });
    return estimate;
  },
});

export const approveEstimateAction = defineAction({
  name: 'estimates.approve',
  module: 'estimates',
  description: 'Record that the customer approved an estimate. Triggers job creation.',
  input: z.object({ estimate_id: z.string().min(1) }),
  risk: 'medium',
  requiresApproval: false,
  example: { estimate_id: 'estimate-id' },
  async handler(input, ctx) {
    if (!getEstimate(ctx.companyId, input.estimate_id)) throw new Error('Estimate not found');
    const estimate = setEstimateStatus(ctx.companyId, input.estimate_id, 'approved');
    await ctx.events.emit(ctx.companyId, 'estimate.approved', { estimateId: estimate.id, customerId: estimate.customer_id });
    return estimate;
  },
});
