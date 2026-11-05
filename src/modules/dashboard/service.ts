import type { Id } from '@/core';
import { listEstimates } from '@/modules/estimates';
import { listInvoices } from '@/modules/invoicing';
import { costJob, getRateSettings, loadCostingData } from '@/modules/jobcosting';
import { listPayments } from '@/modules/payments';
import { paymentRevenue } from '@/modules/revenue';
import { efficiencyFor, loadTimeFacts } from '@/modules/timesheets';
import { computeDashboard, DAY, type Dashboard, type DashInput } from './kpis';

/** Reads everything the dashboard needs from the other modules (through their public interfaces) and works the numbers out. */
export async function loadDashboard(companyId: Id, now = Date.now()): Promise<Dashboard> {
  const [estimates, invoices, payments, facts, settings, costing] = await Promise.all([listEstimates(companyId), listInvoices(companyId), listPayments(companyId), loadTimeFacts(companyId), getRateSettings(companyId), loadCostingData(companyId)]);

  const since = now - 70 * DAY;
  const jobMargins = facts.jobs
    .filter((j) => j.status === 'completed' && j.completed_at && Date.parse(j.completed_at) >= since)
    .map((j) => {
      const c = costJob(j, costing, null);
      return { completed_at: j.completed_at as string, invoiced_cents: c.invoiced_cents, profit_cents: c.profit_cents };
    });

  const techs = [...new Set(facts.entries.map((e) => e.user_id))];
  const input: DashInput = {
    now,
    estimates: estimates.map((e) => ({ status: e.status, sold_by: e.sold_by, subtotal_cents: e.subtotal_cents, sent_at: e.sent_at, approved_at: e.approved_at, declined_at: e.declined_at })),
    invoices: invoices.filter((i) => i.status !== 'draft' && i.status !== 'void').map((i) => ({ status: i.status, total_cents: i.total_cents, amount_paid_cents: i.amount_paid_cents, issued_on: i.issued_on, paid_at: i.paid_at, due_date: i.due_date })),
    payments: payments.map((p) => {
      const inv = invoices.find((i) => i.id === p.invoice_id);
      return { received_on: p.received_on, revenue_cents: paymentRevenue({ received_on: p.received_on, amount_cents: p.amount_cents, invoice_total_cents: inv?.total_cents ?? 0, invoice_tax_cents: inv?.tax_cents ?? 0 }) };
    }),
    jobs: facts.jobs.map((j) => ({ id: j.id, status: j.status, scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end, completed_at: j.completed_at })),
    assignments: facts.assignments.map((a) => ({ job_id: a.job_id, user_id: a.user_id })),
    shifts: facts.shifts.map((s) => ({ user_id: s.user_id, clock_in: s.clock_in, clock_out: s.clock_out })),
    entries: facts.entries.map((e) => ({ user_id: e.user_id, clock_in: e.clock_in, clock_out: e.clock_out })),
    jobMargins,
    settings: { crew_people: settings.crew_people, crew_days_per_week: settings.crew_days_per_week, crew_hours_per_day: settings.crew_hours_per_day, cost_per_hour_cents: settings.cost_per_hour_cents, target_margin_bps: settings.target_margin_bps },
    efficiency: Object.fromEntries(techs.map((id) => [id, efficiencyFor(facts, id, now).rate])),
  };
  return computeDashboard(input);
}
