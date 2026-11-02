import { z } from 'zod';
import { defineAction } from '@/core';
import { finalizeJob, markPaid, saveSetup } from './services/p4pService';

const today = () => new Date().toISOString().slice(0, 10);

export const savePayForPerformanceAction = defineAction({
  name: 'jobcosting.save_p4p_setup',
  module: 'jobcosting',
  description:
    "Save the company's pay-for-performance setup: what the pool is taken from, the share the company keeps first, the levels (seller, worker, supervisors; renamable, any number) with their share of the pool, and who is on which level and who reports to whom. Replaces the whole setup.",
  input: z.object({
    basis: z.enum(['revenue', 'gross_profit', 'net_profit']),
    company_reserve_bps: z.number().int().min(0).max(10000),
    levels: z
      .array(z.object({ id: z.string().min(1), name: z.string().trim().min(1, 'Every level needs a name').max(60), kind: z.enum(['seller', 'worker', 'supervisor']), percent_bps: z.number().int().min(0).max(10000) }))
      .max(20),
    people: z.array(z.object({ user_id: z.string().min(1), level_id: z.string().nullable(), reports_to: z.string().nullable() })).max(500),
  }),
  risk: 'high',
  roles: ['owner', 'admin'],
  // This decides how money is shared between people, so an AI agent can only propose a change.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: {
    basis: 'net_profit' as const,
    company_reserve_bps: 2000,
    levels: [
      { id: 'sales', name: 'Sales', kind: 'seller' as const, percent_bps: 1000 },
      { id: 'tech', name: 'Technician', kind: 'worker' as const, percent_bps: 5000 },
      { id: 'gf', name: 'General Foreman', kind: 'supervisor' as const, percent_bps: 1500 },
    ],
    people: [{ user_id: 'user-id', level_id: 'tech', reports_to: null }],
  },
  async handler(input, ctx) {
    const setup = await saveSetup(ctx.companyId, input);
    return { basis: setup.basis, company_reserve_bps: setup.company_reserve_bps, levels: setup.levels.length };
  },
});

export const finalizePayoutAction = defineAction({
  name: 'jobcosting.finalize_payout',
  module: 'jobcosting',
  description: 'Lock in the pay-for-performance payout for a finished, fully paid job as a snapshot. Can only be done once per job.',
  input: z.object({ job_id: z.string().min(1) }),
  risk: 'high',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { job_id: 'job-id' },
  async handler({ job_id }, ctx) {
    const { run, payouts } = await finalizeJob(ctx.companyId, job_id, ctx.actor.kind === 'user' ? ctx.actor.id : null);
    return { run_id: run.id, payouts: payouts.length };
  },
});

export const markPayoutsPaidAction = defineAction({
  name: 'jobcosting.mark_payouts_paid',
  module: 'jobcosting',
  description: 'Mark pay-for-performance payouts as paid out on a date.',
  input: z.object({ payout_ids: z.array(z.string().min(1)).min(1).max(500), paid_on: z.iso.date().default(today) }),
  risk: 'high',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { payout_ids: ['payout-id'], paid_on: '2026-12-15' },
  async handler({ payout_ids, paid_on }, ctx) {
    return { marked: await markPaid(ctx.companyId, payout_ids, paid_on) };
  },
});
