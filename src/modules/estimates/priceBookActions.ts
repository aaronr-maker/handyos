import { z } from 'zod';
import { defineAction } from '@/core';
import { addPriceItem, getPriceItem, setPriceItemActive, updatePriceItem } from './services/priceBookService';

const fields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(1000).nullable().default(null),
  kind: z.enum(['service', 'material', 'fee']).default('service'),
  unit: z.string().trim().min(1).max(30).default('each'),
  unit_price_cents: z.number().int().min(0),
  unit_cost_cents: z.number().int().min(0).default(0),
  taxable: z.boolean().default(true),
};

const example = { name: 'Fence gate repair', description: null, kind: 'service' as const, unit: 'hour', unit_price_cents: 9500, unit_cost_cents: 3500, taxable: false };

export const addPriceItemAction = defineAction({
  name: 'estimates.add_price_item',
  module: 'estimates',
  description: 'Add a service, material or fee to the price book.',
  input: z.object(fields),
  risk: 'low',
  requiresApproval: false,
  example,
  handler: (input, ctx) => addPriceItem(ctx.companyId, input),
});

export const updatePriceItemAction = defineAction({
  name: 'estimates.update_price_item',
  module: 'estimates',
  description: 'Change a price book item (name, price, cost, unit, taxable). Existing estimates keep the price they were quoted at.',
  input: z.object({ item_id: z.string().min(1), ...fields }),
  risk: 'medium',
  // Prices drive everything customers are quoted, so AI-proposed price changes wait for a person.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { item_id: 'item-id', ...example },
  async handler({ item_id, ...rest }, ctx) {
    if (!(await getPriceItem(ctx.companyId, item_id))) throw new Error('Price book item not found');
    return updatePriceItem(ctx.companyId, item_id, rest);
  },
});

export const setPriceItemActiveAction = defineAction({
  name: 'estimates.set_price_item_active',
  module: 'estimates',
  description: 'Hide a price book item (active false) or bring it back (active true). Hidden items stay on old estimates.',
  input: z.object({ item_id: z.string().min(1), active: z.boolean() }),
  risk: 'low',
  requiresApproval: false,
  example: { item_id: 'item-id', active: false },
  async handler({ item_id, active }, ctx) {
    if (!(await getPriceItem(ctx.companyId, item_id))) throw new Error('Price book item not found');
    return setPriceItemActive(ctx.companyId, item_id, active);
  },
});
