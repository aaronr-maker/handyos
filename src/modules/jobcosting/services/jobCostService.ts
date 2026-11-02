import { createMemoryRepo, type BaseRecord, type Id } from '@/core';
import type { JobCost } from '../types';

const costs = createMemoryRepo<JobCost>();

export function addCost(companyId: Id, data: Omit<JobCost, keyof BaseRecord>): JobCost {
  return costs.insert(companyId, data);
}

export function totalCostForJob(companyId: Id, jobId: Id): number {
  return costs
    .list(companyId)
    .filter((c) => c.job_id === jobId)
    .reduce((sum, c) => sum + c.amount_cents, 0);
}
