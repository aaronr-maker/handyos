import { z } from 'zod';
import { defineAction } from '@/core';
import { setJobSchedule } from '@/modules/jobs';

export const rescheduleJobAction = defineAction({
  name: 'scheduling.reschedule_job',
  module: 'scheduling',
  description: 'Move a job to a new start time.',
  input: z.object({ job_id: z.string().min(1), start: z.iso.datetime() }),
  risk: 'medium',
  // Customers get notified of schedule changes, so AI-initiated moves need a human OK.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { job_id: 'job-id', start: '2026-12-01T15:00:00Z' },
  async handler(input, ctx) {
    const { job, previousStart } = setJobSchedule(ctx.companyId, input.job_id, input.start);
    await ctx.events.emit(ctx.companyId, 'job.rescheduled', { jobId: job.id, from: previousStart, to: input.start });
    return job;
  },
});
