import { z } from 'zod';
import { defineAction } from '@/core';
import { resolveBilling } from '@/modules/customers';
import { clockIn, clockOut, completeJob, createJob, getJob, setAssignees, setSeller, updateJob } from './services/jobService';

const whoFor = z
  .object({ customer_id: z.string().min(1).nullable().default(null), property_id: z.string().min(1).nullable().default(null) })
  .refine((v) => v.customer_id || v.property_id, { message: 'Choose a customer or a property' });

export const createJobAction = defineAction({
  name: 'jobs.create',
  module: 'jobs',
  description:
    'Create a job for a property (billing is worked out from its owner/manager) or for a customer. Optionally schedule it and assign people.',
  input: z.intersection(
    whoFor,
    z.object({
      title: z.string().trim().min(1, 'Give the job a title').max(200),
      notes: z.string().trim().max(4000).nullable().default(null),
      scheduled_start: z.iso.datetime().nullable().default(null),
      scheduled_end: z.iso.datetime().nullable().default(null),
      assignee_ids: z.array(z.string()).max(50).default([]),
      estimate_id: z.string().nullable().default(null),
      /** Team member who sold the job. Defaults to the person creating it. */
      sold_by: z.string().min(1).nullable().optional(),
    }),
  ),
  risk: 'low',
  requiresApproval: false,
  example: { customer_id: null, property_id: 'property-id', title: 'Fix fence gate', notes: null, scheduled_start: null, scheduled_end: null, assignee_ids: [], estimate_id: null },
  async handler({ customer_id, property_id, title, notes, scheduled_start, scheduled_end, assignee_ids, estimate_id, sold_by }, ctx) {
    const billing = await resolveBilling(ctx.companyId, { customerId: customer_id, propertyId: property_id });
    const job = await createJob(ctx.companyId, { ...billing, estimate_id, sold_by: sold_by !== undefined ? sold_by : ctx.actor.kind === 'user' ? ctx.actor.id : null, title, notes }, scheduled_start ? { start: scheduled_start, end: scheduled_end } : undefined);
    if (assignee_ids.length) await setAssignees(ctx.companyId, job.id, assignee_ids);
    await ctx.events.emit(ctx.companyId, 'job.created', { jobId: job.id, customerId: job.customer_id });
    if (assignee_ids.length) await ctx.events.emit(ctx.companyId, 'job.assigned', { jobId: job.id, userIds: assignee_ids });
    return job;
  },
});

export const updateJobAction = defineAction({
  name: 'jobs.update',
  module: 'jobs',
  description: "Change a job's title or notes.",
  input: z.object({ job_id: z.string().min(1), title: z.string().trim().min(1).max(200), notes: z.string().trim().max(4000).nullable().default(null) }),
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id', title: 'Fix fence gate', notes: 'Gate code 1234' },
  handler: ({ job_id, ...data }, ctx) => updateJob(ctx.companyId, job_id, data),
});

export const setSellerAction = defineAction({
  name: 'jobs.set_seller',
  module: 'jobs',
  description: 'Set who sold a job (they earn the seller share of pay-for-performance). Use null for nobody.',
  input: z.object({ job_id: z.string().min(1), sold_by: z.string().min(1).nullable() }),
  risk: 'medium',
  roles: ['owner', 'admin', 'office'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { job_id: 'job-id', sold_by: 'user-id' },
  async handler({ job_id, sold_by }, ctx) {
    return setSeller(ctx.companyId, job_id, sold_by);
  },
});

export const assignJobAction = defineAction({
  name: 'jobs.assign',
  module: 'jobs',
  description: 'Set who is assigned to a job (replaces the current list).',
  input: z.object({ job_id: z.string().min(1), user_ids: z.array(z.string().min(1)).max(50) }),
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id', user_ids: ['user-id'] },
  async handler({ job_id, user_ids }, ctx) {
    const assigned = await setAssignees(ctx.companyId, job_id, user_ids);
    await ctx.events.emit(ctx.companyId, 'job.assigned', { jobId: job_id, userIds: assigned });
    return { job_id, user_ids: assigned };
  },
});

export const completeJobAction = defineAction({
  name: 'jobs.complete',
  module: 'jobs',
  description: 'Mark a job completed (anyone still clocked in is clocked out). Invoicing and job costing react to the event.',
  input: z.object({ job_id: z.string().min(1) }),
  risk: 'medium',
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { job_id: 'job-id' },
  async handler({ job_id }, ctx) {
    if (!(await getJob(ctx.companyId, job_id))) throw new Error('Job not found');
    const job = await completeJob(ctx.companyId, job_id);
    await ctx.events.emit(ctx.companyId, 'job.completed', { jobId: job.id, customerId: job.customer_id });
    return job;
  },
});

/** Clocking is always about the signed-in person: an AI agent or automation can't clock someone in or out. */
function requirePerson(actor: { kind: string; id: string }): string {
  if (actor.kind !== 'user') throw new Error('Only a person can clock in or out');
  return actor.id;
}

export const clockInAction = defineAction({
  name: 'jobs.clock_in',
  module: 'jobs',
  description: 'Clock the signed-in person in to a job.',
  input: z.object({ job_id: z.string().min(1) }),
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id' },
  async handler({ job_id }, ctx) {
    const userId = requirePerson(ctx.actor);
    const entry = await clockIn(ctx.companyId, userId, job_id);
    await ctx.events.emit(ctx.companyId, 'timeclock.in', { jobId: job_id, userId });
    return entry;
  },
});

export const clockOutAction = defineAction({
  name: 'jobs.clock_out',
  module: 'jobs',
  description: 'Clock the signed-in person out of whatever job they are on, with an optional note.',
  input: z.object({ note: z.string().trim().max(1000).nullable().default(null) }),
  risk: 'low',
  requiresApproval: false,
  example: { note: null },
  async handler({ note }, ctx) {
    const userId = requirePerson(ctx.actor);
    const { entry, minutes } = await clockOut(ctx.companyId, userId, note);
    await ctx.events.emit(ctx.companyId, 'timeclock.out', { jobId: entry.job_id, userId, minutes });
    return entry;
  },
});
