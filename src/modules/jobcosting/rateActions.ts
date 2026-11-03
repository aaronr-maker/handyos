import { z } from 'zod';
import { defineAction } from '@/core';
import { recomputeRate, saveMonth, saveRateSettings } from './services/rateService';

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
    /** The income accounts for the month (optional: leave out to keep any income already saved). */
    income: z
      .array(z.object({ account_name: z.string().trim().min(1).max(200), group_path: z.string().trim().max(400).default(''), kind: z.enum(['income', 'other_income']).default('income'), amount_cents: z.number().int() }))
      .max(500)
      .optional(),
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
  async handler({ month, source, hours_override_minutes, lines, income }, ctx) {
    const { rate } = await saveMonth(ctx.companyId, month, source, hours_override_minutes, lines, income);
    return { month, cost_per_hour_cents: rate.cost_per_hour_cents, price_per_hour_cents: rate.price_per_hour_cents };
  },
});

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-10');

export const saveRateSettingsAction = defineAction({
  name: 'jobcosting.save_rate_settings',
  module: 'jobcosting',
  description:
    "Set up the company hourly rate: which months are averaged (usually three, saved with save_overhead_month first), where the hours come from (the time clock / hours typed per month, or the crew's schedule: people x days a week x hours a day x working weeks), the target margin, whether job costing uses the rate, and cash or accrual for QuickBooks pulls. Works out and saves the resulting cost per man-hour.",
  input: z.object({
    target_margin_bps: z.number().int().min(0).max(9500),
    use_in_job_costing: z.boolean(),
    accounting_method: z.enum(['cash', 'accrual']).default('cash'),
    rate_months: z.array(monthKey).max(12).default([]),
    hours_mode: z.enum(['clock', 'capacity']).default('clock'),
    crew_people: z.number().int().min(0).max(1000).nullable().default(null),
    crew_days_per_week: z.number().min(0).max(7).nullable().default(null),
    crew_hours_per_day: z.number().min(0).max(24).default(8),
    /** A year has 52 weeks, but the crew does not work all of them. */
    working_weeks: z.number().int().min(1).max(52).default(50),
  }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: {
    target_margin_bps: 3000,
    use_in_job_costing: true,
    accounting_method: 'cash' as const,
    rate_months: ['2026-08', '2026-09', '2026-10'],
    hours_mode: 'capacity' as const,
    crew_people: 3,
    crew_days_per_week: 5,
    crew_hours_per_day: 8,
    working_weeks: 50,
  },
  async handler(input, ctx) {
    await saveRateSettings(ctx.companyId, input);
    const r = await recomputeRate(ctx.companyId);
    return { cost_per_hour_cents: r.cost_per_hour_cents, price_per_hour_cents: r.price_per_hour_cents, hours: r.hours, months: r.months };
  },
});
