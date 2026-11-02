import { z } from 'zod';
import { defineAction } from '@/core';
import { saveMessage } from './services/messageService';

export const sendMessageAction = defineAction({
  name: 'messaging.send',
  module: 'messaging',
  description: 'Send a text or email to a customer.',
  input: z.object({
    customer_id: z.string().min(1),
    channel: z.enum(['sms', 'email']),
    body: z.string().min(1).max(1600),
  }),
  risk: 'medium',
  // Customer-facing words from an AI agent are reviewed by a person first.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { customer_id: 'customer-id', channel: 'sms', body: 'Your tech is on the way!' },
  async handler(input, ctx) {
    const message = saveMessage(ctx.companyId, { ...input, direction: 'outbound' });
    await ctx.events.emit(ctx.companyId, 'message.sent', { customerId: input.customer_id, channel: input.channel });
    return message;
  },
});
