import type { BaseRecord, Id } from '@/core';

/** The day clock: from the first clock-in of the day to the last clock-out. */
export interface Shift extends BaseRecord {
  user_id: Id;
  clock_in: string;
  clock_out: string | null;
}

/** One thing to be done on a job (usually one service line of the estimate), measured on its own. */
export interface JobTask extends BaseRecord {
  job_id: Id;
  name: string;
  /** The price book item it is, so the same service can be compared across jobs. */
  price_book_item_id: string | null;
  quantity: number;
  unit: string;
  sort_order: number;
}

/** A tech working on one task. Only one is open per person: starting another closes it. */
export interface TaskTimer extends BaseRecord {
  job_id: Id;
  task_id: Id;
  user_id: Id;
  started_at: string;
  ended_at: string | null;
}

export type TimeEntity = 'job' | 'task' | 'shift';

/** One changed time stamp: what it was, what it is, who changed it and why. Never edited or removed. */
export interface TimeEdit extends BaseRecord {
  entity: TimeEntity;
  entity_id: Id;
  /** Whose time it is. */
  user_id: Id;
  edited_by: Id;
  field: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
}

export interface GeofenceConsent extends BaseRecord {
  user_id: Id;
  consented_at: string | null;
  revoked_at: string | null;
}

export interface JobSite extends BaseRecord {
  job_id: Id;
  lat: number;
  lng: number;
  radius_m: number;
}
