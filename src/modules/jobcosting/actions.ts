import { z } from 'zod';
import { defineAction } from '@/core';
import { addCost } from './services/jobCostService';

export const addJobCostAction = defineAction({
  name: 'jobcosting.add_cost',
  module: 'jobcosting',
  description: 'Record labor, material or other cost against a job.',
  input: z.object({
    job_id: z.string().min(1),
    kind: z.enum(['labor', 'material', 'other']),
    amount_cents: z.number().int().positive(),
    note: z.string().max(500).nullable().default(null),
  }),
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id', kind: 'material', amount_cents: 4200, note: 'Hinges and screws' },
  async handler(input, ctx) {
    const cost = addCost(ctx.companyId, input);
    await ctx.events.emit(ctx.companyId, 'jobcost.recorded', {
      jobId: input.job_id,
      amountCents: input.amount_cents,
      kind: input.kind,
    });
    return cost;
  },
});
