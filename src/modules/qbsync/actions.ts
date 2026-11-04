import { z } from 'zod';
import { defineAction } from '@/core';
import { saveSettings } from './service';

const nullableId = z.string().trim().max(100).nullable();

export const saveSyncSettingsAction = defineAction({
  name: 'qbsync.save_settings',
  module: 'qbsync',
  description: 'Choose where invoices and payments sent to QuickBooks post (income account, deposit account, sales tax code), the first date to send from, and whether sending is on.',
  input: z.object({
    enabled: z.boolean(),
    income_account_id: nullableId,
    income_account_name: z.string().trim().max(200).nullable(),
    deposit_account_id: nullableId,
    deposit_account_name: z.string().trim().max(200).nullable(),
    tax_code_id: nullableId,
    tax_code_name: z.string().trim().max(200).nullable(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-01-01'),
  }),
  risk: 'high',
  roles: ['owner', 'admin'],
  // turning this on makes HandyOS write to the company's books, so an AI agent can only propose it
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { enabled: false, income_account_id: '79', income_account_name: 'Services', deposit_account_id: null, deposit_account_name: null, tax_code_id: null, tax_code_name: null, start_date: '2027-01-01' },
  async handler(input, ctx) {
    await saveSettings(ctx.companyId, input);
    return { enabled: input.enabled };
  },
});
