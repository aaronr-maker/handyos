import { z } from 'zod';
import { defineAction } from '@/core';
import { getCustomer, getProperty, getPropertyBilling } from '@/modules/customers';
import { createEstimate, getEstimate, setEstimateStatus, updateDraft, type EstimateDraft } from './services/estimateService';

const lineItem = z.object({
  description: z.string().trim().min(1, 'Each line needs a description').max(500),
  quantity: z.number().positive('Quantity must be more than zero'),
  unit: z.string().trim().min(1).max(30).default('each'),
  unit_price_cents: z.number().int().min(0),
  unit_cost_cents: z.number().int().min(0).default(0),
  taxable: z.boolean().default(true),
  price_book_item_id: z.string().nullable().default(null),
});

const body = {
  title: z.string().trim().min(1, 'Give the estimate a title').max(200),
  line_items: z.array(lineItem).min(1, 'Add at least one line').max(200),
  tax_rate_bps: z.number().int().min(0).max(10000).default(0),
  valid_until: z.iso.date().nullable().default(null),
  notes: z.string().trim().max(4000).nullable().default(null),
};

/**
 * Who the estimate is billed to and labeled as owed by. For a property: the customers module's billing rule
 * (rentals bill the manager, labeled as owed by the owner; the manager owes it when no owner is listed).
 * Without a property: the chosen customer.
 */
async function resolveBilling(companyId: string, customerId: string | null, propertyId: string | null) {
  if (propertyId) {
    if (!(await getProperty(companyId, propertyId))) throw new Error('Property not found');
    const billing = await getPropertyBilling(companyId, propertyId);
    if (!billing) throw new Error('This property has no owner or property manager to bill');
    return { customer_id: billing.billToId, owed_by_customer_id: billing.owedById, property_id: propertyId };
  }
  if (!customerId) throw new Error('Choose a customer or a property');
  if (!(await getCustomer(companyId, customerId))) throw new Error('Customer not found');
  return { customer_id: customerId, owed_by_customer_id: customerId, property_id: null };
}

const whoFor = z
  .object({ customer_id: z.string().min(1).nullable().default(null), property_id: z.string().min(1).nullable().default(null) })
  .refine((v) => v.customer_id || v.property_id, { message: 'Choose a customer or a property' });

const example = {
  customer_id: null,
  property_id: 'property-id',
  title: 'Fix fence gate',
  line_items: [{ description: 'Labor, 2 hrs', quantity: 2, unit: 'hour', unit_price_cents: 9500, unit_cost_cents: 3500, taxable: false, price_book_item_id: null }],
  tax_rate_bps: 0,
  valid_until: null,
  notes: null,
};

export const createEstimateAction = defineAction({
  name: 'estimates.create',
  module: 'estimates',
  description: 'Create a draft estimate for a property (billing is worked out from its owner/manager) or for a customer.',
  input: z.intersection(whoFor, z.object(body)),
  risk: 'low',
  requiresApproval: false,
  example,
  async handler({ customer_id, property_id, ...rest }, ctx) {
    const billing = await resolveBilling(ctx.companyId, customer_id, property_id);
    const estimate = await createEstimate(ctx.companyId, { ...billing, ...rest } as EstimateDraft);
    await ctx.events.emit(ctx.companyId, 'estimate.created', { estimateId: estimate.id, customerId: estimate.customer_id, totalCents: estimate.total_cents });
    return estimate;
  },
});

export const updateEstimateAction = defineAction({
  name: 'estimates.update',
  module: 'estimates',
  description: 'Edit a draft estimate. Sent estimates can no longer be changed.',
  input: z.intersection(z.object({ estimate_id: z.string().min(1) }), z.intersection(whoFor, z.object(body))),
  risk: 'low',
  requiresApproval: false,
  example: { estimate_id: 'estimate-id', ...example },
  async handler({ estimate_id, customer_id, property_id, ...rest }, ctx) {
    const billing = await resolveBilling(ctx.companyId, customer_id, property_id);
    return updateDraft(ctx.companyId, estimate_id, { ...billing, ...rest } as EstimateDraft);
  },
});

export const sendEstimateAction = defineAction({
  name: 'estimates.send',
  module: 'estimates',
  description: 'Mark an estimate as sent to the customer for approval.',
  input: z.object({ estimate_id: z.string().min(1) }),
  risk: 'medium',
  // A person can send directly; an AI agent must get sign-off first.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { estimate_id: 'estimate-id' },
  async handler({ estimate_id }, ctx) {
    const estimate = await setEstimateStatus(ctx.companyId, estimate_id, 'sent');
    await ctx.events.emit(ctx.companyId, 'estimate.sent', { estimateId: estimate.id, customerId: estimate.customer_id });
    return estimate;
  },
});

export const approveEstimateAction = defineAction({
  name: 'estimates.approve',
  module: 'estimates',
  description: 'Record that the customer approved an estimate. A job is created for the same property.',
  input: z.object({ estimate_id: z.string().min(1) }),
  risk: 'medium',
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { estimate_id: 'estimate-id' },
  async handler({ estimate_id }, ctx) {
    const estimate = await setEstimateStatus(ctx.companyId, estimate_id, 'approved');
    await ctx.events.emit(ctx.companyId, 'estimate.approved', {
      estimateId: estimate.id,
      customerId: estimate.customer_id,
      title: estimate.title,
      propertyId: estimate.property_id,
    });
    return estimate;
  },
});

export const declineEstimateAction = defineAction({
  name: 'estimates.decline',
  module: 'estimates',
  description: 'Record that the customer declined an estimate.',
  input: z.object({ estimate_id: z.string().min(1) }),
  risk: 'low',
  requiresApproval: false,
  example: { estimate_id: 'estimate-id' },
  async handler({ estimate_id }, ctx) {
    if (!(await getEstimate(ctx.companyId, estimate_id))) throw new Error('Estimate not found');
    return setEstimateStatus(ctx.companyId, estimate_id, 'declined');
  },
});
