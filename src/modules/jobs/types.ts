import type { BaseRecord, Id } from '@/core';

export type JobStatus = 'unscheduled' | 'scheduled' | 'in_progress' | 'completed';

export interface Job extends BaseRecord {
  customer_id: Id;
  estimate_id: Id | null;
  property_id: Id | null;
  title: string;
  status: JobStatus;
  /** ISO timestamp, or null while unscheduled. */
  scheduled_start: string | null;
}
