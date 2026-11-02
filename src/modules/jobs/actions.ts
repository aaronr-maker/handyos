import { z } from 'zod';
import { defineAction } from '@/core';
import { completeJob, createJob, getJob } from './services/jobService';

export const createJobAction = defineAction({
  name: 'jobs.create',
  module: 'jobs',
  description: 'Create a job for a customer.',
  input: z.object({
    customer_id: z.string().min(1),
    title: z.string().min(1).max(200),
    estimate_id: z.string().nullable().default(null),
    property_id: z.string().nullable().default(null),
  }),
  risk: 'low',
  requiresApproval: false,
  example: { customer_id: 'customer-id', title: 'Fix fence gate', estimate_id: null, property_id: null },
  async handler(input, ctx) {
    const job = createJob(ctx.companyId, input);
    await ctx.events.emit(ctx.companyId, 'job.created', { jobId: job.id, customerId: job.customer_id });
    return job;
  },
});

export const completeJobAction = defineAction({
  name: 'jobs.complete',
  module: 'jobs',
  description: 'Mark a job completed. Downstream modules (invoicing, job costing) react to the event.',
  input: z.object({ job_id: z.string().min(1) }),
  risk: 'medium',
  requiresApproval: false,
  example: { job_id: 'job-id' },
  async handler(input, ctx) {
    if (!getJob(ctx.companyId, input.job_id)) throw new Error('Job not found');
    const job = completeJob(ctx.companyId, input.job_id);
    await ctx.events.emit(ctx.companyId, 'job.completed', { jobId: job.id, customerId: job.customer_id });
    return job;
  },
});
