import type { BaseRecord, Id } from '@/core';

export type JobStatus = 'unscheduled' | 'scheduled' | 'in_progress' | 'completed';

export interface Job extends BaseRecord {
  /** 1001, 1002, ... per company. */
  job_number: number;
  /** Who is billed (the property manager for a managed rental, else the owner). */
  customer_id: Id;
  /** Who the work is labeled as owed by (the owner; the manager when no owner is listed). */
  owed_by_customer_id: Id | null;
  property_id: Id | null;
  estimate_id: Id | null;
  title: string;
  notes: string | null;
  status: JobStatus;
  /** ISO timestamps, or null while unscheduled. */
  scheduled_start: string | null;
  scheduled_end: string | null;
  completed_at: string | null;
}

/** A team member assigned to a job. */
export interface JobAssignment extends BaseRecord {
  job_id: Id;
  user_id: Id;
}

/** One stretch of a tech working on a job. `clock_out` null = still working. */
export interface TimeEntry extends BaseRecord {
  job_id: Id;
  user_id: Id;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
}
