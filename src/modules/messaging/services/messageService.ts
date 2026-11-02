import { createMemoryRepo, type BaseRecord, type Id } from '@/core';
import type { Message } from '../types';

const messages = createMemoryRepo<Message>();

export function saveMessage(companyId: Id, data: Omit<Message, keyof BaseRecord>): Message {
  return messages.insert(companyId, data);
}

export function listMessages(companyId: Id, customerId: Id): Message[] {
  return messages.list(companyId).filter((m) => m.customer_id === customerId);
}
