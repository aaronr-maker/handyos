import { z } from 'zod';
import { defineAction } from '@/core';
import { createCustomer } from './services/customerService';

export const createCustomerAction = defineAction({
  name: 'customers.create',
  module: 'customers',
  description: 'Create a new customer record.',
  input: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().nullable().default(null),
    phone: z.string().max(40).nullable().default(null),
    notes: z.string().max(2000).nullable().default(null),
  }),
  risk: 'low',
  requiresApproval: false,
  example: { name: 'Pat Rivera', email: 'pat@example.com', phone: '555-0100', notes: null },
  async handler(input, ctx) {
    const customer = createCustomer(ctx.companyId, input);
    await ctx.events.emit(ctx.companyId, 'customer.created', { customerId: customer.id });
    return customer;
  },
});
