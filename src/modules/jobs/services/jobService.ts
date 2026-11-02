import { createMemoryRepo, type Id } from '@/core';
import type { Job } from '../types';

const jobs = createMemoryRepo<Job>();

export function createJob(
  companyId: Id,
  data: { customer_id: Id; title: string; estimate_id?: Id | null },
): Job {
  return jobs.insert(companyId, {
    customer_id: data.customer_id,
    title: data.title,
    estimate_id: data.estimate_id ?? null,
    status: 'unscheduled',
    scheduled_start: null,
  });
}

export function getJob(companyId: Id, id: Id): Job | undefined {
  return jobs.get(companyId, id);
}

export function listJobs(companyId: Id): Job[] {
  return jobs.list(companyId);
}

export function completeJob(companyId: Id, id: Id): Job {
  return jobs.update(companyId, id, { status: 'completed' });
}

/** Used by the scheduling module (through the jobs public index) to move a job. */
export function setJobSchedule(companyId: Id, id: Id, start: string): { job: Job; previousStart: string | null } {
  const existing = jobs.get(companyId, id);
  if (!existing) throw new Error('Job not found');
  if (existing.status === 'completed') throw new Error('Completed jobs cannot be rescheduled');
  const job = jobs.update(companyId, id, { scheduled_start: start, status: 'scheduled' });
  return { job, previousStart: existing.scheduled_start };
}
