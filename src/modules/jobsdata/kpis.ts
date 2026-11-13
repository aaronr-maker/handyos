/**
 * The numbers behind the Jobs data screen, worked out from the imported history. Plain functions over plain rows so every figure can
 * be checked. A job belongs to the month it closed in (or, if it never closed, the month it was created).
 */
export interface JobLike {
  job_number: number;
  client_name: string | null;
  lead_source: string | null;
  created_on: string | null;
  closed_on: string | null;
  salesperson: string | null;
  crew: string | null;
  revenue_cents: number;
  cost_cents: number;
  profit_cents: number;
  hours_tracked: number;
}
export interface InvoiceLike {
  status: string | null;
  days_to_pay: number | null;
  paid_on: string | null;
  issued_on: string | null;
  total_cents: number;
  balance_cents: number;
}
export interface PaymentLike {
  paid_on: string | null;
  total_cents: number;
  fee_cents: number;
}
export interface PersonLike {
  report: string;
  person: string;
  data: Record<string, number>;
}

export interface Totals {
  jobs: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  /** profit as a share of revenue; null with no revenue */
  margin: number | null;
  avgTicketCents: number | null;
  hours: number;
  /** revenue per hour tracked on jobs */
  revenuePerHourCents: number | null;
  profitPerHourCents: number | null;
}
export interface MonthRow {
  month: string;
  jobs: number;
  revenueCents: number;
  profitCents: number;
  margin: number | null;
}
export interface GroupRow {
  name: string;
  jobs: number;
  revenueCents: number;
  profitCents: number;
  margin: number | null;
  avgTicketCents: number | null;
}
export interface PersonRow {
  person: string;
  visits: number;
  jobRevenueCents: number;
  jobHours: number;
  generalHours: number;
  totalHours: number;
  /** job revenue per hour on jobs */
  jobPerHourCents: number | null;
  /** job revenue per hour of all time tracked */
  overallPerHourCents: number | null;
  /** share of tracked time that was on jobs */
  onJobShare: number | null;
}
export interface SalespersonRow {
  person: string;
  sentQuotes: number;
  convertedQuotes: number;
  conversion: number | null;
  sentCents: number;
  convertedCents: number;
  avgConvertedCents: number | null;
}
export interface InvoiceSummary {
  invoices: number;
  paid: number;
  badDebt: number;
  avgDaysToPay: number | null;
  outstandingCents: number;
}
export interface PaymentSummary {
  count: number;
  totalCents: number;
  feeCents: number;
  feeShare: number | null;
}
export interface JobsDataReport {
  totals: Totals;
  byMonth: MonthRow[];
  byLead: GroupRow[];
  bySalesperson: GroupRow[];
  topClients: GroupRow[];
  people: PersonRow[];
  salespeople: SalespersonRow[];
  invoices: InvoiceSummary;
  payments: PaymentSummary;
  /** the report's overall tracked-hours figure, when loaded */
  reportedHours: number | null;
}

const share = (a: number, b: number) => (b > 0 ? a / b : null);
const monthOf = (j: JobLike) => (j.closed_on ?? j.created_on ?? '').slice(0, 7);
const dayOf = (j: JobLike) => j.closed_on ?? j.created_on ?? '';

function group(jobs: JobLike[], key: (j: JobLike) => string): GroupRow[] {
  const map = new Map<string, JobLike[]>();
  for (const j of jobs) {
    const k = key(j).trim() || 'Not recorded';
    map.set(k, [...(map.get(k) ?? []), j]);
  }
  return [...map.entries()]
    .map(([name, list]) => {
      const revenueCents = list.reduce((n, j) => n + j.revenue_cents, 0);
      const profitCents = list.reduce((n, j) => n + j.profit_cents, 0);
      return { name, jobs: list.length, revenueCents, profitCents, margin: share(profitCents, revenueCents), avgTicketCents: list.length ? Math.round(revenueCents / list.length) : null };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export function computeJobsData(i: { jobs: JobLike[]; invoices: InvoiceLike[]; payments: PaymentLike[]; people: PersonLike[]; from?: string; to?: string }): JobsDataReport {
  const inRange = (day: string) => !!day && (!i.from || day >= i.from) && (!i.to || day <= i.to);
  const jobs = i.jobs.filter((j) => inRange(dayOf(j)));
  const revenueCents = jobs.reduce((n, j) => n + j.revenue_cents, 0);
  const costCents = jobs.reduce((n, j) => n + j.cost_cents, 0);
  const profitCents = jobs.reduce((n, j) => n + j.profit_cents, 0);
  const hours = Math.round(jobs.reduce((n, j) => n + j.hours_tracked, 0) * 10) / 10;
  const totals: Totals = {
    jobs: jobs.length,
    revenueCents,
    costCents,
    profitCents,
    margin: share(profitCents, revenueCents),
    avgTicketCents: jobs.length ? Math.round(revenueCents / jobs.length) : null,
    hours,
    revenuePerHourCents: hours > 0 ? Math.round(revenueCents / hours) : null,
    profitPerHourCents: hours > 0 ? Math.round(profitCents / hours) : null,
  };

  const months = new Map<string, JobLike[]>();
  for (const j of jobs) months.set(monthOf(j), [...(months.get(monthOf(j)) ?? []), j]);
  const byMonth: MonthRow[] = [...months.entries()]
    .filter(([m]) => m)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const r = list.reduce((n, j) => n + j.revenue_cents, 0);
      const p = list.reduce((n, j) => n + j.profit_cents, 0);
      return { month, jobs: list.length, revenueCents: r, profitCents: p, margin: share(p, r) };
    });

  const personRows: PersonRow[] = i.people
    .filter((p) => p.report === 'productivity')
    .map((p) => {
      const jobRevenueCents = p.data.job_revenue_cents ?? 0;
      const jobHours = p.data.job_hours ?? 0;
      const totalHours = p.data.total_hours ?? 0;
      return {
        person: p.person,
        visits: p.data.visits ?? 0,
        jobRevenueCents,
        jobHours,
        generalHours: p.data.general_hours ?? 0,
        totalHours,
        jobPerHourCents: jobHours > 0 ? Math.round(jobRevenueCents / jobHours) : null,
        overallPerHourCents: totalHours > 0 ? Math.round(jobRevenueCents / totalHours) : null,
        onJobShare: share(jobHours, totalHours),
      };
    })
    .sort((a, b) => b.jobRevenueCents - a.jobRevenueCents);

  const salespeople: SalespersonRow[] = i.people
    .filter((p) => p.report === 'salespeople')
    .map((p) => ({
      person: p.person,
      sentQuotes: p.data.sent_quotes ?? 0,
      convertedQuotes: p.data.converted_quotes ?? 0,
      conversion: share(p.data.converted_quotes ?? 0, p.data.sent_quotes ?? 0),
      sentCents: p.data.sent_cents ?? 0,
      convertedCents: p.data.converted_cents ?? 0,
      avgConvertedCents: (p.data.converted_quotes ?? 0) > 0 ? Math.round((p.data.converted_cents ?? 0) / (p.data.converted_quotes ?? 1)) : null,
    }))
    .sort((a, b) => b.convertedCents - a.convertedCents);

  const invs = i.invoices.filter((v) => inRange(v.issued_on ?? ''));
  const days = invs.map((v) => v.days_to_pay).filter((d): d is number => d !== null && d >= 0);
  const pays = i.payments.filter((p) => inRange(p.paid_on ?? ''));
  const payTotal = pays.reduce((n, p) => n + p.total_cents, 0);
  const payFees = pays.reduce((n, p) => n + p.fee_cents, 0);

  return {
    totals,
    byMonth,
    byLead: group(jobs, (j) => j.lead_source ?? ''),
    bySalesperson: group(jobs, (j) => j.salesperson ?? ''),
    topClients: group(jobs, (j) => j.client_name ?? '').slice(0, 10),
    people: personRows,
    salespeople,
    invoices: {
      invoices: invs.length,
      paid: invs.filter((v) => v.status === 'Paid').length,
      badDebt: invs.filter((v) => v.status === 'Bad Debt').length,
      avgDaysToPay: days.length ? Math.round((days.reduce((n, d) => n + d, 0) / days.length) * 10) / 10 : null,
      outstandingCents: invs.reduce((n, v) => n + Math.max(0, v.balance_cents), 0),
    },
    payments: { count: pays.length, totalCents: payTotal, feeCents: payFees, feeShare: share(payFees, payTotal) },
    reportedHours: i.people.find((p) => p.report === 'timesheet_total')?.data.hours ?? null,
  };
}
