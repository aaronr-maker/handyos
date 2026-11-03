import { createRepo, type BaseRecord, type Id } from '@/core';
import { listTimeEntries, type Job } from '@/modules/jobs';
import { getEstimate } from '@/modules/estimates';
import { listInvoices } from '@/modules/invoicing';
import { computeJobCost, type JobCostResult } from '../calc';
import { getRateSettings, savedRates } from './rateService';
import type { JobCost, PayRate } from '../types';

const costs = createRepo<JobCost>('job_costs');
const rates = createRepo<PayRate>('team_pay_rates');

export const addCost = (companyId: Id, data: Omit<JobCost, keyof BaseRecord>) => costs.insert(companyId, data);
export const getCost = (companyId: Id, id: Id) => costs.get(companyId, id);
export const removeCost = (companyId: Id, id: Id) => costs.remove(companyId, id);
export const listCosts = (companyId: Id) => costs.list(companyId);
export const listCostsForJob = (companyId: Id, jobId: Id) => costs.list(companyId, { where: { job_id: jobId } });

export const listPayRates = (companyId: Id) => rates.list(companyId);

export async function setPayRate(companyId: Id, userId: Id, hourlyCostCents: number): Promise<PayRate> {
  const existing = (await rates.list(companyId, { where: { user_id: userId } }))[0];
  return existing ? rates.update(companyId, existing.id, { hourly_cost_cents: hourlyCostCents }) : rates.insert(companyId, { user_id: userId, hourly_cost_cents: hourlyCostCents });
}

/** Everything needed to cost a set of jobs, read once. */
export async function loadCostingData(companyId: Id) {
  const [allCosts, payRates, entries, invoices, settings, rates] = await Promise.all([
    listCosts(companyId),
    listPayRates(companyId),
    listTimeEntries(companyId),
    listInvoices(companyId),
    getRateSettings(companyId),
    savedRates(companyId),
  ]);
  const rateByUser = Object.fromEntries(payRates.map((r) => [r.user_id, r.hourly_cost_cents]));
  const latest = Object.keys(rates).sort().pop();
  // the company hourly cost (all company costs / man-hours) is used for labor when the owner has turned it on
  const burdened = settings.use_in_job_costing ? { rates, fallback: latest ? rates[latest] : null } : undefined;
  return { allCosts, rateByUser, entries, invoices, burdened };
}

type Loaded = Awaited<ReturnType<typeof loadCostingData>>;

/** What the estimate expected this job to cost: sum of quantity x unit cost over its lines. */
export async function expectedCost(companyId: Id, job: Pick<Job, 'estimate_id'>): Promise<number | null> {
  if (!job.estimate_id) return null;
  const estimate = await getEstimate(companyId, job.estimate_id);
  return estimate ? estimate.line_items.reduce((n, l) => n + Math.round(l.quantity * l.unit_cost_cents), 0) : null;
}

export function costJob(job: Pick<Job, 'id'>, data: Loaded, expected: number | null): JobCostResult {
  const mine = data.invoices.filter((i) => i.job_id === job.id && i.status !== 'void' && i.status !== 'draft');
  return computeJobCost({
    invoiced_cents: mine.reduce((n, i) => n + i.total_cents, 0),
    collected_cents: mine.reduce((n, i) => n + i.amount_paid_cents, 0),
    entries: data.entries.filter((e) => e.job_id === job.id),
    rates: data.rateByUser,
    burdened: data.burdened,
    costs: data.allCosts.filter((c) => c.job_id === job.id),
    expected_cost_cents: expected,
  });
}
