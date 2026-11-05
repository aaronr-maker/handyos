import { createRepo, type BaseRecord, type Id } from '@/core';
import type { Message } from '../types';

const messages = createRepo<Message>('messages');

export const saveMessage = (companyId: Id, data: Omit<Message, keyof BaseRecord>) => messages.insert(companyId, data);

export const listMessages = async (companyId: Id, customerId: Id) => (await messages.list(companyId, { where: { customer_id: customerId } })).sort((a, b) => a.created_at.localeCompare(b.created_at));
export const listAllMessages = async (companyId: Id) => (await messages.list(companyId)).sort((a, b) => b.created_at.localeCompare(a.created_at));
