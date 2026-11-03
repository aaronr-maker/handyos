import { z } from 'zod';
import { defineAction } from '@/core';
import { saveMonth, saveRateSettings } from './services/rateService';

const category = z.enum(['wages', 'payroll_tax', 'overhead', 'excluded']);

export const saveOverheadMonthAction = defineAction({
  name: 'jobcosting.save_overhead_month',
  module: 'jobcosting',
  description:
    "Save one month of company costs (by account, each marked wages, payroll tax, other running costs or not counted). The month's cost per man-hour is worked out and saved. Replaces what was saved for that month.",
  input: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-10'),
    source: z.enum(['manual', 'quickbooks_csv', 'quickbooks_api']).default('manual'),
    /** Man-hours in minutes to use instead of the time clock total (null = use the time clock). */
    hours_override_minutes: z.number().int().min(0).max(10_000_000).nullable().default(null),
    lines: z.array(z.object({ account_name: z.string().trim().min(1).max(200), group_path: z.string().trim().max(400).default(''), section: z.enum(['cogs', 'expense', 'other_expense', 'manual']).default('expense'), amount_cents: z.number().int(), category })).max(500),
  }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: {
    month: '2026-10',
    source: 'quickbooks_csv' as const,
    hours_override_minutes: null,
    lines: [
      { account_name: 'Wages', group_path: 'Payroll Expenses', amount_cents: 1_200_000, category: 'wages' as const },
      { account_name: 'Insurance', group_path: '', amount_cents: 150_000, category: 'overhead' as const },
    ],
  },
  async handler({ month, source, hours_override_minutes, lines }, ctx) {
    const { rate } = await saveMonth(ctx.companyId, month, source, hours_override_minutes, lines);
    return { month, cost_per_hour_cents: rate.cost_per_hour_cents, price_per_hour_cents: rate.price_per_hour_cents };
  },
});

export const saveRateSettingsAction = defineAction({
  name: 'jobcosting.save_rate_settings',
  module: 'jobcosting',
  description: 'Set the target margin for the hourly price, whether job costing values labor at the company hourly cost, and whether to pull cash or accrual figures from QuickBooks.',
  input: z.object({ target_margin_bps: z.number().int().min(0).max(9500), use_in_job_costing: z.boolean(), accounting_method: z.enum(['cash', 'accrual']).default('cash') }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { target_margin_bps: 3000, use_in_job_costing: true, accounting_method: 'cash' as const },
  async handler(input, ctx) {
    await saveRateSettings(ctx.companyId, input);
    return input;
  },
});
