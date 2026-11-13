import { z } from 'zod';
import { defineAction } from '@/core';
import { clearSource, importReport } from './service';

const text = z.string().max(600).default('');
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const cents = z.number().int();
const job = z.object({
  job_number: z.number().int(),
  client_name: text,
  lead_source: text,
  service_address: text,
  title: text,
  created_on: day,
  scheduled_on: day,
  closed_on: day,
  salesperson: text,
  crew: text,
  line_items: text,
  invoice_numbers: text,
  quote_number: text,
  revenue_cents: cents,
  cost_cents: cents,
  labour_cost_cents: cents,
  profit_cents: cents,
  hours_tracked: z.number(),
  budget_hours: z.number(),
});
const invoice = z.object({
  invoice_number: z.number().int(),
  client_name: text,
  lead_source: text,
  subject: text,
  created_on: day,
  issued_on: day,
  due_on: day,
  paid_on: day,
  days_to_pay: z.number().int().nullable(),
  salesperson: text,
  status: text,
  job_numbers: text,
  subtotal_cents: cents,
  total_cents: cents,
  balance_cents: cents,
  tax_cents: cents,
});
const payment = z.object({ external_key: z.string().max(300), client_name: text, paid_on: day, kind: text, method: text, total_cents: cents, fee_cents: cents, invoice_number: text });
const salesperson = z.object({
  person: z.string().max(120),
  sent_quotes: z.number(),
  sent_cents: cents,
  converted_quotes: z.number(),
  converted_cents: cents,
  issued_invoices: z.number(),
  issued_cents: cents,
});
const productivity = z.object({ person: z.string().max(120), visits: z.number(), job_revenue_cents: cents, job_hours: z.number(), general_hours: z.number(), total_hours: z.number() });

const source = z.string().trim().min(2).max(40);

export const importReportAction = defineAction({
  name: 'jobsdata.import_report',
  module: 'jobsdata',
  description:
    'Load one report from the old system (jobs, invoices, payments, timesheets, or a per-person summary) into the Jobs data history. Loading the same kind of report again replaces the earlier load.',
  input: z.discriminatedUnion('kind', [
    z.object({ source, kind: z.literal('jobs'), rows: z.array(job).max(20000) }),
    z.object({ source, kind: z.literal('invoices'), rows: z.array(invoice).max(20000) }),
    z.object({ source, kind: z.literal('payments'), rows: z.array(payment).max(20000) }),
    z.object({
      source,
      kind: z.literal('timesheets'),
      summary: z.object({ jobs: z.array(z.object({ job_number: z.number().int(), hours: z.number() })).max(20000), reported_total_hours: z.number() }),
    }),
    z.object({ source, kind: z.literal('salespeople'), rows: z.array(salesperson).max(200) }),
    z.object({ source, kind: z.literal('productivity'), rows: z.array(productivity).max(200) }),
  ]),
  risk: 'medium',
  roles: ['owner', 'admin'],
  // a report replaces earlier numbers, so an AI agent can only propose it
  requiresApproval: (_i, ctx) => ctx.actor.kind === 'agent',
  example: { source: 'jobber', kind: 'salespeople' as const, rows: [] },
  async handler(input, ctx) {
    const rows = await importReport(ctx.companyId, input.source, input as never);
    return { loaded: rows };
  },
});

export const clearHistorySourceAction = defineAction({
  name: 'jobsdata.clear_source',
  module: 'jobsdata',
  description: 'Remove everything that was loaded from one old system into Jobs data.',
  input: z.object({ source }),
  risk: 'high',
  roles: ['owner', 'admin'],
  requiresApproval: (_i, ctx) => ctx.actor.kind === 'agent',
  example: { source: 'jobber' },
  async handler({ source: s }, ctx) {
    await clearSource(ctx.companyId, s);
    return { cleared: s };
  },
});
