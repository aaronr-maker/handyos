import type { Cents, Id } from '@/core';
import { listJobs, listTimeEntries } from '@/modules/jobs';
import { computeP4P } from '../p4pCalc';
import { costJob, loadCostingData } from './jobCostService';
import { getSetup } from './p4pService';
import { costShares } from './rateService';

/**
 * What a whole job is expected to cost and share out, from what is known today (hours clocked so far, costs entered,
 * the company hourly cost, the pay-for-performance settings). Other modules (the cash plan) scale it to each payment.
 */
export interface JobEconomics {
  job_id: Id;
  /** Invoiced for the job, not counting void or draft invoices. */
  invoiced_cents: Cents;
  /** The sales tax inside what was invoiced. */
  tax_cents: Cents;
  /** Materials and other non-labor costs entered for the job. */
  materials_cents: Cents;
  /** Labor, split into wages, payroll tax and other running costs. Without the company hourly cost, all of it is wages. */
  labor: { wages_cents: Cents; payroll_tax_cents: Cents; overhead_cents: Cents };
  /** The pay-for-performance pool and the company reserve it takes first. */
  p4p_pool_cents: Cents;
  p4p_reserve_cents: Cents;
  labor_method: 'person' | 'company_rate';
}

/** Reads everything once and works out the economics of each job (all of them, or just the ones asked for). */
export async function jobEconomics(companyId: Id, jobIds?: Id[]): Promise<Record<Id, JobEconomics>> {
  const [jobs, costing, setup, entries, shares] = await Promise.all([listJobs(companyId), loadCostingData(companyId), getSetup(companyId), listTimeEntries(companyId), costShares(companyId)]);
  const out: Record<Id, JobEconomics> = {};
  for (const job of jobs) {
    if (jobIds && !jobIds.includes(job.id)) continue;
    const cost = costJob(job, costing, null);
    const mine = entries.filter((e) => e.job_id === job.id);
    const minutes: Record<Id, number> = {};
    const now = Date.now();
    for (const e of mine) minutes[e.user_id] = (minutes[e.user_id] ?? 0) + Math.max(0, Math.round(((e.clock_out ? Date.parse(e.clock_out) : now) - Date.parse(e.clock_in)) / 60000));
    const p4p = computeP4P({
      basis: setup.basis,
      company_reserve_bps: setup.company_reserve_bps,
      levels: setup.levels,
      reports_to: Object.fromEntries(setup.structure.map((s) => [s.user_id, s.reports_to])),
      revenue_cents: cost.invoiced_cents,
      non_labor_cost_cents: cost.material_cents + cost.other_cents,
      total_cost_cents: cost.total_cost_cents,
      sold_by: job.sold_by,
      minutes,
    });
    const company = cost.labor_method === 'company_rate' && shares.wages_bps + shares.payroll_tax_bps + shares.overhead_bps > 0;
    const wages = company ? Math.round((cost.labor_cents * shares.wages_bps) / 10000) : cost.labor_cents;
    const tax = company ? Math.round((cost.labor_cents * shares.payroll_tax_bps) / 10000) : 0;
    out[job.id] = {
      job_id: job.id,
      invoiced_cents: cost.invoiced_cents,
      tax_cents: costing.invoices.filter((x) => x.job_id === job.id && x.status !== 'void' && x.status !== 'draft').reduce((n, x) => n + x.tax_cents, 0),
      materials_cents: cost.material_cents + cost.other_cents,
      labor: { wages_cents: wages, payroll_tax_cents: tax, overhead_cents: cost.labor_cents - wages - tax },
      p4p_pool_cents: p4p.pool_cents,
      p4p_reserve_cents: p4p.reserve_cents,
      labor_method: cost.labor_method,
    };
  }
  return out;
}
