import type { BaseRecord } from '@/core';
import type { Flow, Hours } from '../../../api/_lib/callEngine';

export interface CallSettings extends BaseRecord {
  number: string | null;
  timezone: string;
  hours: Partial<Hours['week']>;
  voice: string;
  notice: string;
  script: string;
}
export interface CallFlow extends BaseRecord {
  name: string;
  active: boolean;
  graph: Flow;
}
export interface CallLogRow extends BaseRecord {
  call_sid: string;
  from_number: string | null;
  to_number: string | null;
  trail: string[];
  outcome: string;
  summary: string | null;
}
export interface TranscriptLine extends BaseRecord {
  call_sid: string;
  speaker: 'caller' | 'team' | 'assistant';
  body: string;
}
export interface Voicemail extends BaseRecord {
  call_sid: string;
  from_number: string | null;
  recording_url: string;
  duration_seconds: number;
  transcript: string | null;
  status: 'new' | 'heard';
}

/** Something the AI receptionist booked or promised: an in-home estimate it scheduled, or a callback for the office. */
export interface AiRequest extends BaseRecord {
  kind: 'estimate' | 'callback';
  status: 'new' | 'done' | 'cancelled';
  call_sid: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  address: string | null;
  language: string | null;
  notes: string | null;
  seller_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
}
