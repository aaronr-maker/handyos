import { z } from 'zod';
import { defineAction } from '@/core';
import { removeImport, saveHistory } from './service';

export const importRevenueHistoryAction = defineAction({
  name: 'revenue.import_history',
  module: 'revenue',
  description: 'Load past revenue (one row per invoice or payment) from another system, under an import name. With replace, an earlier import with the same name is replaced.',
  input: z.object({
    source: z.string().trim().min(1).max(100),
    replace: z.boolean().default(false),
    rows: z
      .array(
        z.object({
          received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          amount_cents: z.number().int(),
          customer: z.string().trim().max(200).default(''),
          job: z.string().trim().max(300).default(''),
          invoice_ref: z.string().trim().max(100).default(''),
        }),
      )
      .max(2000),
  }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { source: 'QuickBooks 2025', replace: true, rows: [{ received_on: '2025-03-14', amount_cents: 125_000, customer: 'Pat Smith', job: 'Deck repair', invoice_ref: '1042' }] },
  async handler({ source, replace, rows }, ctx) {
    return { saved: await saveHistory(ctx.companyId, source, rows, replace) };
  },
});

export const removeRevenueImportAction = defineAction({
  name: 'revenue.remove_import',
  module: 'revenue',
  description: 'Delete everything loaded under one import name.',
  input: z.object({ source: z.string().trim().min(1).max(100) }),
  risk: 'high',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { source: 'QuickBooks 2025' },
  async handler({ source }, ctx) {
    return { removed: await removeImport(ctx.companyId, source) };
  },
});
