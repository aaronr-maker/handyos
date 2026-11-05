import type { BaseRecord, Id } from '@/core';

export type MessageStatus = 'queued' | 'sent' | 'failed';

export interface Message extends BaseRecord {
  customer_id: Id;
  channel: 'sms' | 'email';
  body: string;
  direction: 'outbound' | 'inbound';
  /** 'queued' until a sending service delivers it. Nothing is shown as sent that was not. */
  status: MessageStatus;
  provider_ref: string | null;
  error: string | null;
  created_by: Id | null;
}
