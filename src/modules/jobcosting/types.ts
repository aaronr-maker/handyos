import type { BaseRecord, Cents, Id } from '@/core';

export type CostKind = 'labor' | 'material' | 'other';

/** A cost recorded against a job by hand (materials, subcontractors, dump fees...). Labor from the time clock is worked out separately. */
export interface JobCost extends BaseRecord {
  job_id: Id;
  kind: CostKind;
  description: string;
  amount_cents: Cents;
  /** ISO date. */
  incurred_on: string;
  recorded_by: Id | null;
}

/** What one team member costs the company per hour (wages plus the load you choose). Private to owners/admins. */
export interface PayRate extends BaseRecord {
  user_id: Id;
  hourly_cost_cents: Cents;
}
