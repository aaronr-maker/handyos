import type { Cents } from '@/core';
import type { JobEconomics } from '@/modules/jobcosting';

export type BucketId = 'sales_tax' | 'materials' | 'wages' | 'payroll_tax' | 'overhead' | 'p4p' | 'reserve' | 'profit';

/** The order the money is set aside in, and what each part is called. */
export const BUCKETS: { id: BucketId; label: string; hint: string }[] = [
  { id: 'sales_tax', label: 'Sales tax', hint: 'Collected for the state; not yours to spend.' },
  { id: 'materials', label: 'Materials and job costs', hint: 'Paying back what was bought for the job.' },
  { id: 'wages', label: 'Wages', hint: 'The wages account, for payroll.' },
  { id: 'payroll_tax', label: 'Payroll taxes', hint: "The employer's share of payroll taxes." },
  { id: 'overhead', label: 'Running costs', hint: 'Insurance, software, rent, the truck: the rest of the hourly cost.' },
  { id: 'p4p', label: 'Pay-for-performance pool', hint: 'What the team earns on this job.' },
  { id: 'reserve', label: 'Company reserve', hint: 'The cushion the company keeps first.' },
  { id: 'profit', label: 'Left over (profit)', hint: 'What remains after everything above.' },
];

export interface PaymentPlan {
  buckets: Record<BucketId, Cents>;
  /** Plain-language things to know about this plan. */
  notes: string[];
}

export interface PlanInputs {
  amount_cents: Cents;
  /** The invoice the payment is on. */
  invoice_total_cents: Cents;
  invoice_tax_cents: Cents;
  /** The job's economics; null for an invoice that is not tied to a job. */
  job: JobEconomics | null;
}

const empty = (): Record<BucketId, Cents> => ({ sales_tax: 0, materials: 0, wages: 0, payroll_tax: 0, overhead: 0, p4p: 0, reserve: 0, profit: 0 });

/**
 * Suggests where one payment goes. Each cost of the job is taken in proportion to the share of the job's invoices this
 * payment covers (paying half of the job's invoices covers half of its costs), after the sales tax on the invoice.
 * The reserve is only set aside from what is left after the costs, and what remains is profit. The parts always add up
 * to exactly the payment. A refund (negative payment) reverses the same way.
 */
export function planPayment(i: PlanInputs): PaymentPlan {
  const b = empty();
  const notes: string[] = [];
  const share = i.invoice_total_cents > 0 ? i.amount_cents / i.invoice_total_cents : 0;
  b.sales_tax = Math.round(share * i.invoice_tax_cents);
  const afterTax = i.amount_cents - b.sales_tax;

  if (!i.job) {
    b.profit = afterTax;
    notes.push('This invoice is not tied to a job, so nothing is set aside for costs.');
    return { buckets: b, notes };
  }
  const j = i.job;
  const jobSales = j.invoiced_cents - j.tax_cents; // the job's invoices without their sales tax
  const part = jobSales > 0 ? afterTax / jobSales : 0;
  const take = (cents: Cents) => Math.round(part * cents);
  b.materials = take(j.materials_cents);
  b.wages = take(j.labor.wages_cents);
  b.payroll_tax = take(j.labor.payroll_tax_cents);
  b.overhead = take(j.labor.overhead_cents);
  b.p4p = take(j.p4p_pool_cents);
  const spent = b.sales_tax + b.materials + b.wages + b.payroll_tax + b.overhead + b.p4p;
  const left = i.amount_cents - spent;
  b.reserve = i.amount_cents >= 0 ? Math.max(0, Math.min(take(j.p4p_reserve_cents), left)) : Math.min(0, Math.max(take(j.p4p_reserve_cents), left));
  b.profit = left - b.reserve;

  if (j.labor.wages_cents + j.labor.payroll_tax_cents + j.labor.overhead_cents === 0) notes.push('No hours are clocked on this job yet, so nothing is set aside for labor.');
  if (j.labor_method === 'person') notes.push("Labor uses each person's own pay rate, so all of it goes to wages. Turn on the company hourly cost to also set aside payroll taxes and running costs.");
  if (b.profit < 0 && i.amount_cents > 0) notes.push('This payment does not cover the job’s costs, so the left-over is negative.');
  return { buckets: b, notes };
}

/** Adds plans together (for a week or a month of payments). */
export function addPlans(plans: PaymentPlan[]): Record<BucketId, Cents> {
  const out = empty();
  for (const p of plans) for (const k of Object.keys(out) as BucketId[]) out[k] += p.buckets[k];
  return out;
}
