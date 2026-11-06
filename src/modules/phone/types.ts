import type { BaseRecord, Id } from '@/core';
import type { Flow, Hours } from '../../../api/_lib/callEngine';

export interface CallSettings extends BaseRecord {
  number: string | null;
  timezone: string;
  hours: Partial<Hours['week']>;
  voice: string;
  notice: string;
  script: string;
}
export interface TeamPhone extends BaseRecord {
  user_id: Id;
  phone: string;
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
  speaker: 'caller' | 'team';
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
