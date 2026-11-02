import type { BaseRecord, Id } from '@/core';

export interface Message extends BaseRecord {
  customer_id: Id;
  channel: 'sms' | 'email';
  body: string;
  direction: 'outbound' | 'inbound';
}
