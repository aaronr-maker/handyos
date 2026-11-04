import type { BaseRecord, Id } from '@/core';

export type AlertKind = 'overtime_risk' | 'forgotten_clock';

export interface DeskAlert extends BaseRecord {
  kind: AlertKind;
  subject_user_id: Id;
  /** The Monday of the week (YYYY-MM-DD). */
  week_start: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolved_by: Id | null;
  resolved_at: string | null;
  resolution: string | null;
}
