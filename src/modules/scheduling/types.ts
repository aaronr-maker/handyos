import type { BaseRecord, Id } from '@/core';

export interface ScheduleSlot {
  jobId: Id;
  start: string;
}

/** Something on a person's calendar that is not a job: time off or a personal appointment. It blocks scheduling that person. */
export interface CalendarEvent extends BaseRecord {
  user_id: Id;
  kind: 'time_off' | 'appointment' | 'other';
  title: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  created_by: Id | null;
}
