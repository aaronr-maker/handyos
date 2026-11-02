import { z } from 'zod';
import { defineAction } from '@/core';
import { getJob } from '@/modules/jobs';
import { addCost, getCost, removeCost, setPayRate } from './services/jobCostService';

const today = () => new Date().toISOString().slice(0, 10);

export const addJobCostAction = defineAction({
  name: 'jobcosting.add_cost',
  module: 'jobcosting',
  description: 'Record a cost against a job: materials, a subcontractor, a dump fee, or other labor.',
  input: z.object({
    job_id: z.string().min(1),
    kind: z.enum(['labor', 'material', 'other']),
    description: z.string().trim().min(1, 'Say what it was for').max(300),
    amount_cents: z.number().int().positive('Enter an amount greater than zero'),
    incurred_on: z.iso.date().default(today),
  }),
  risk: 'low',
  roles: ['owner', 'admin', 'office'],
  requiresApproval: false,
  example: { job_id: 'job-id', kind: 'material', description: 'Hinges and screws', amount_cents: 4200, incurred_on: '2026-12-01' },
  async handler(input, ctx) {
    if (!(await getJob(ctx.companyId, input.job_id))) throw new Error('Job not found');
    const cost = await addCost(ctx.companyId, { ...input, recorded_by: ctx.actor.kind === 'user' ? ctx.actor.id : null });
    await ctx.events.emit(ctx.companyId, 'jobcost.recorded', { jobId: input.job_id, amountCents: input.amount_cents, kind: input.kind });
    return cost;
  },
});

export const removeJobCostAction = defineAction({
  name: 'jobcosting.remove_cost',
  module: 'jobcosting',
  description: 'Delete a cost that was recorded by mistake.',
  input: z.object({ cost_id: z.string().min(1) }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { cost_id: 'cost-id' },
  async handler({ cost_id }, ctx) {
    if (!(await getCost(ctx.companyId, cost_id))) throw new Error('Cost not found');
    await removeCost(ctx.companyId, cost_id);
    return { removed: cost_id };
  },
});

export const setPayRateAction = defineAction({
  name: 'jobcosting.set_pay_rate',
  module: 'jobcosting',
  description: 'Set what a team member costs the company per hour (used to cost labor on jobs). Private to owners and admins.',
  input: z.object({ user_id: z.string().min(1), hourly_cost_cents: z.number().int().min(0).max(100_000) }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { user_id: 'user-id', hourly_cost_cents: 3500 },
  handler: ({ user_id, hourly_cost_cents }, ctx) => setPayRate(ctx.companyId, user_id, hourly_cost_cents),
});
