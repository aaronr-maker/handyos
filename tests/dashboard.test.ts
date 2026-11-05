import { describe, expect, it } from 'vitest';
import { computeDashboard, DAY, type DashInput } from '../src/modules/dashboard/kpis';

const NOW = Date.parse('2027-03-15T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(NOW + n * DAY).toISOString();

const base = (): DashInput => ({
  now: NOW,
  estimates: [],
  invoices: [],
  payments: [],
  jobs: [],
  assignments: [],
  shifts: [],
  entries: [],
  jobMargins: [],
  settings: { crew_people: 3, crew_days_per_week: 5, crew_hours_per_day: 8, cost_per_hour_cents: 4000, target_margin_bps: 3000 },
  efficiency: {},
});
const est = (status: 'approved' | 'declined', ago: number, sold_by = 'sam', subtotal = 100_000) => ({ status, sold_by, subtotal_cents: subtotal, sent_at: daysAgo(ago + 3), approved_at: status === 'approved' ? daysAgo(ago) : null, declined_at: status === 'declined' ? daysAgo(ago) : null });
/** A scheduled job of `days` working days of one person each, starting `startIn` days from now. */
const job = (id: string, startIn: number, hours: number, people = 1) => ({ id, status: 'scheduled', scheduled_start: daysAhead(startIn), scheduled_end: new Date(NOW + startIn * DAY + hours * 3_600_000).toISOString(), completed_at: null, people });
const withJobs = (d: DashInput, jobs: ReturnType<typeof job>[]) => ({ ...d, jobs, assignments: jobs.flatMap((j) => Array.from({ length: j.people }, (_, n) => ({ job_id: j.id, user_id: `u${n}` }))) });
const kpi = (d: ReturnType<typeof computeDashboard>, id: string) => d.kpis.find((k) => k.id === id)!;

describe('sales numbers', () => {
  it('works out the close rate, the average job sold and each seller, for the last 30 days against the 30 before', () => {
    const d = base();
    d.estimates = [est('approved', 5, 'sam', 200_000), est('approved', 10, 'sam', 100_000), est('declined', 12, 'sam'), est('approved', 8, 'pat', 150_000), est('declined', 20, 'pat'), est('approved', 45, 'pat'), est('declined', 40, 'pat'), est('declined', 50, 'pat')];
    const r = computeDashboard(d);
    expect(kpi(r, 'close_rate')).toMatchObject({ raw: 3 / 5, value: '60%', status: 'good' });
    expect(kpi(r, 'close_rate').previous).toBeCloseTo(1 / 3, 5);
    expect(kpi(r, 'avg_ticket').raw).toBeCloseTo(150_000, 0);
    expect(r.sellers.map((s) => [s.user_id, s.approved, s.decided])).toEqual([['sam', 2, 3], ['pat', 1, 2]].sort((a, b) => Number(b[1]) - Number(a[1]) || 0));
    expect(r.sellers[0].sold_cents).toBe(300_000);
  });

  it('does not judge a close rate on fewer than three decided estimates', () => {
    const d = base();
    d.estimates = [est('approved', 3), est('declined', 4)];
    expect(kpi(computeDashboard(d), 'close_rate').status).toBe('unknown');
  });
});

describe('production, profit and cash numbers', () => {
  it('measures booked work against the crew, time on jobs against paid time, and revenue per man-hour against cost', () => {
    const d = withJobs(base(), [job('a', 1, 120), job('b', 3, 120, 2)]); // 120 + 240 man-hours; the crew does 3 x 5 x 8 = 120 a week
    d.shifts = [{ user_id: 'u0', clock_in: daysAgo(5), clock_out: new Date(NOW - 5 * DAY + 10 * 3_600_000).toISOString() }];
    d.entries = [{ user_id: 'u0', clock_in: daysAgo(5), clock_out: new Date(NOW - 5 * DAY + 6.5 * 3_600_000).toISOString() }];
    d.payments = [{ received_on: daysAgo(4).slice(0, 10), revenue_cents: 65_000 }];
    d.jobMargins = [{ completed_at: daysAgo(6), invoiced_cents: 100_000, profit_cents: 40_000 }];
    const r = computeDashboard(d);
    expect(r.backlogWeeks).toBe(3);
    expect(kpi(r, 'utilization').raw).toBeCloseTo(0.65, 5);
    expect(kpi(r, 'utilization').status).toBe('good');
    expect(kpi(r, 'revenue_hour').raw).toBeCloseTo(10_000, 0); // $650 over 6.5 hours = $100 an hour
    expect(kpi(r, 'revenue_hour').status).toBe('good'); // above the $40 cost
    expect(kpi(r, 'job_margin')).toMatchObject({ raw: 0.4, status: 'good' });
  });

  it('adds up what is owed and what is overdue, and how long people take to pay', () => {
    const d = base();
    d.invoices = [
      { status: 'sent', total_cents: 100_000, amount_paid_cents: 0, issued_on: daysAgo(30).slice(0, 10), paid_at: null, due_date: daysAgo(10).slice(0, 10) },
      { status: 'sent', total_cents: 100_000, amount_paid_cents: 40_000, issued_on: daysAgo(5).slice(0, 10), paid_at: null, due_date: daysAhead(9).slice(0, 10) },
      { status: 'paid', total_cents: 50_000, amount_paid_cents: 50_000, issued_on: daysAgo(20).slice(0, 10), paid_at: daysAgo(10), due_date: daysAgo(6).slice(0, 10) },
    ];
    const r = computeDashboard(d);
    expect(kpi(r, 'owed').raw).toBe(160_000);
    expect(kpi(r, 'overdue').raw).toBeCloseTo(100_000 / 160_000, 5);
    expect(kpi(r, 'overdue').status).toBe('bad');
    expect(kpi(r, 'days_to_collect').raw).toBeCloseTo(10.5, 1); // the invoice date is a day, the payment a moment in that day
    expect(kpi(r, 'days_to_collect').status).toBe('good');
  });
});

describe('the constraint', () => {
  it('says capacity when far more work is booked than the crew can do', () => {
    const r = computeDashboard(withJobs(base(), [job('a', 1, 8 * 10 * 6), job('b', 2, 8 * 10 * 6)])); // many weeks booked
    expect(r.constraint.id).toBe('capacity');
    expect(r.constraint.tries.length).toBeGreaterThan(2);
  });

  it('says sales when the schedule is nearly empty and few estimates close, and leads when they close fine', () => {
    const sales = base();
    sales.estimates = [est('declined', 2), est('declined', 3), est('declined', 4), est('approved', 5)];
    expect(computeDashboard(sales).constraint.id).toBe('sales');
    const leads = base();
    leads.estimates = [est('approved', 2), est('approved', 3), est('approved', 4), est('declined', 5)];
    expect(computeDashboard(leads).constraint.id).toBe('leads');
  });

  it('says profit when the work is booked but finished jobs keep too little, and cash when money is slow', () => {
    const profit = withJobs(base(), [job('a', 1, 120 * 3)]);
    profit.jobMargins = [{ completed_at: daysAgo(3), invoiced_cents: 100_000, profit_cents: 10_000 }];
    expect(computeDashboard(profit).constraint.id).toBe('profit');
    const cash = withJobs(base(), [job('a', 1, 120 * 3)]);
    cash.jobMargins = [{ completed_at: daysAgo(3), invoiced_cents: 100_000, profit_cents: 45_000 }];
    cash.invoices = [{ status: 'overdue', total_cents: 100_000, amount_paid_cents: 0, issued_on: daysAgo(60).slice(0, 10), paid_at: null, due_date: daysAgo(30).slice(0, 10) }];
    expect(computeDashboard(cash).constraint.id).toBe('cash');
  });

  it('is honest when there is not enough data, and when everything is in balance', () => {
    expect(computeDashboard({ ...base(), settings: { ...base().settings, crew_people: null } }).constraint.id).toBe('unknown');
    const fine = withJobs(base(), [job('a', 1, 120 * 3)]);
    fine.jobMargins = [{ completed_at: daysAgo(3), invoiced_cents: 100_000, profit_cents: 45_000 }];
    expect(computeDashboard(fine).constraint.id).toBe('none');
  });
});
