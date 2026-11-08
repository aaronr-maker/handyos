import type { BaseRecord } from '@/core';

export interface EstimateSettingsRow extends BaseRecord {
  timezone: string;
  week: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { start: string; end: string }[]>>;
  slot_minutes: number;
  buffer_minutes: number;
  notice_hours: number;
  horizon_days: number;
}
