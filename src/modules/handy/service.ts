import { createRepo, type BaseRecord, type Id } from '@/core';
import { customerLabel, listAllContacts, listAllProperties, listCustomers } from '@/modules/customers';
import type { KnownEntity, MaskMap } from './mask';

export interface HandyThread extends BaseRecord {
  user_id: Id;
  title: string;
  context: Record<string, unknown>;
  mask_map: MaskMap;
}
export interface HandyMessage extends BaseRecord {
  thread_id: Id;
  user_id: Id;
  role: 'user' | 'assistant' | 'action';
  content: string;
  data: Record<string, unknown>;
}

const threads = createRepo<HandyThread>('handy_threads');
const messages = createRepo<HandyMessage>('handy_messages');

export const listThreads = async (companyId: Id) => (await threads.list(companyId)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
export const createThread = (companyId: Id, userId: Id, title: string, context: Record<string, unknown> = {}) => threads.insert(companyId, { user_id: userId, title: title.slice(0, 80) || 'New chat', context, mask_map: {} });
export const saveMaskMap = (companyId: Id, threadId: Id, map: MaskMap) => threads.update(companyId, threadId, { mask_map: map });
export const deleteThread = async (companyId: Id, threadId: Id) => {
  await messages.removeWhere(companyId, { thread_id: threadId });
  await threads.remove(companyId, threadId);
};
export const listMessages = async (companyId: Id, threadId: Id) => (await messages.list(companyId, { where: { thread_id: threadId } })).sort((a, b) => a.created_at.localeCompare(b.created_at));
export const addMessage = (companyId: Id, threadId: Id, userId: Id, role: HandyMessage['role'], content: string, data: Record<string, unknown> = {}) => messages.insert(companyId, { thread_id: threadId, user_id: userId, role, content, data });

/** The company's customers, contacts and properties, so their names and addresses can be sent as IDs. */
export async function knownEntities(companyId: Id): Promise<KnownEntity[]> {
  const [customers, contacts, properties] = await Promise.all([listCustomers(companyId), listAllContacts(companyId), listAllProperties(companyId)]);
  const clean = (list: (string | null | undefined)[]) => [...new Set(list.map((v) => (v ?? '').trim()).filter(Boolean))];
  return [
    ...customers.map((c) => ({ kind: 'customer' as const, id: c.id, label: customerLabel(c), aliases: clean([c.name, c.display_name, c.company_name, [c.first_name, c.last_name].filter(Boolean).join(' ')]) })),
    ...contacts.map((c) => ({ kind: 'contact' as const, id: c.id, label: c.name, aliases: clean([c.name, [c.first_name, c.last_name].filter(Boolean).join(' ')]) })),
    ...properties.map((p) => ({ kind: 'property' as const, id: p.id, label: p.address_line1, aliases: clean([p.address_line1]) })),
  ];
}
