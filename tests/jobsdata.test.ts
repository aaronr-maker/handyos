import { describe, expect, it } from 'vitest';
import { computeJobsData, type JobLike, type PersonLike } from '../src/modules/jobsdata/kpis';
import { detectReport, parseClock, parseDay, parseMoney, parseTimesheets, readReport } from '../src/modules/jobsdata/parse';

const job = (n: number, closed: string, rev: number, profit: number, lead: string, who: string, hours: number, client = 'Pat'): JobLike => ({
  job_number: n,
  client_name: client,
  lead_source: lead,
  created_on: closed,
  closed_on: closed,
  salesperson: who,
  crew: who,
  revenue_cents: rev * 100,
  cost_cents: (rev - profit) * 100,
  profit_cents: profit * 100,
  hours_tracked: hours,
});

describe("reading the old system's reports", () => {
  it('reads dates, money and clock times', () => {
    expect(parseDay('Aug 03, 2026')).toBe('2026-08-03');
    expect(parseDay('-')).toBeNull();
    expect(parseDay('')).toBeNull();
    expect(parseMoney('1,716.38')).toBe(171638);
    expect(parseMoney('-121.46')).toBe(-12146);
    expect(parseMoney('')).toBe(0);
    expect(parseClock('1405:25')).toBe(1405.42);
  });
  it('tells the kinds of report apart by their columns', () => {
    expect(detectReport([['Job #', 'Job revenue ($)', 'Client name']])).toBe('jobs');
    expect(detectReport([['Invoice #', 'Marked paid date']])).toBe('invoices');
    expect(detectReport([['Client name', 'Paid with', 'Payout #']])).toBe('payments');
    expect(detectReport([['Totals'], []])).toBe('timesheets');
    expect(detectReport([['Salesperson', 'Sent quotes', 'Converted quotes']])).toBe('salespeople');
    expect(detectReport([['Name', 'Visits', 'Job productivity']])).toBe('productivity');
    expect(detectReport([['Something', 'else']])).toBeNull();
  });
  it('reads a jobs report, keeps the address and money, and leaves emails and phone numbers out', () => {
    const csv =
      'Job #,Client name,Lead source,Client email,Client phone,Service street,Service city,Service province,Service ZIP,Title,Created date,Scheduled start date,Closed date,Salesperson,Visits assigned to,Time tracked,Total costs ($),Job revenue ($),Profit ($),BH\n591,Pat Rivera,Google,pat@example.com,(417) 555-0100,1506 Knight St,West Plains,Missouri,65775,Fix gate,"Jul 29, 2026","Jul 30, 2026","Jul 30, 2026",Aaron Ross,Aaron Ross,1.5,"10.00","1,040.00","1,030.00",2.0 HRS\n';
    const r = readReport(csv);
    expect(r?.kind).toBe('jobs');
    if (r?.kind !== 'jobs') return;
    expect(r.rows[0]).toMatchObject({
      job_number: 591,
      client_name: 'Pat Rivera',
      lead_source: 'Google',
      service_address: '1506 Knight St, West Plains, Missouri 65775',
      created_on: '2026-07-29',
      closed_on: '2026-07-30',
      revenue_cents: 104000,
      profit_cents: 103000,
      hours_tracked: 1.5,
      budget_hours: 2,
    });
    expect(JSON.stringify(r.rows[0])).not.toMatch(/pat@example|555-0100/);
  });
  it("reads timesheets by job and uses the report's own total, not the overlapping general lines", () => {
    const rows = [
      ['Totals'],
      [],
      ['Total Hours', '10'],
      ['Aaron Ross', '6'],
      [],
      ['Hours', 'Working on', 'Note'],
      ['1.5', 'Job #4 - Mason', ''],
      ['2', 'Job #4 - Mason', ''],
      ['3', 'General', ''],
      ['0.5', 'Job #9 - Pat', ''],
    ];
    expect(parseTimesheets(rows)).toEqual({
      jobs: [
        { job_number: 4, hours: 3.5 },
        { job_number: 9, hours: 0.5 },
      ],
      reported_total_hours: 10,
    });
  });
  it("reads payments as money in, and keeps invoices' days to pay", () => {
    const p = readReport(
      'Client name,Date,Time,Type,Paid with,Paid through,Total $,Tip $,Fee $,Note,Card ending #,Card type,Invoice #,Quote #,Payout #\nRemax,"Sep 09, 2026",2:00PM,Payment,Credit card,Client Hub,-121.46,,3.82,x,6002,Amex,1613,,po_1\n',
    );
    expect(p).toMatchObject({ kind: 'payments', rows: [{ total_cents: 12146, fee_cents: 382, paid_on: '2026-09-09', invoice_number: '1613' }] });
    const i = readReport(
      'Invoice #,Client name,Marked paid date,Invoice payment time (days),Status,Total ($),Balance ($),Issued date\n1613,Remax,"Sep 09, 2026",37,Paid,121.46,0.0,"Aug 03, 2026"\n1614,Remax,-,-,Bad Debt,50.00,50.00,"Aug 04, 2026"\n',
    );
    expect(i).toMatchObject({
      kind: 'invoices',
      rows: [
        { invoice_number: 1613, days_to_pay: 37, paid_on: '2026-09-09' },
        { invoice_number: 1614, days_to_pay: null, paid_on: null, balance_cents: 5000 },
      ],
    });
  });
});

describe('the Jobs data numbers', () => {
  const jobs = [
    job(1, '2026-01-10', 1000, 400, 'Google', 'Aaron Ross', 10, 'A'),
    job(2, '2026-01-20', 500, 100, 'Google', 'Briar Collins', 5, 'B'),
    job(3, '2026-02-05', 700, 350, 'Van', 'Aaron Ross', 7, 'A'),
  ];
  const people: PersonLike[] = [
    { report: 'productivity', person: 'Aaron Ross', data: { visits: 100, job_revenue_cents: 1_000_000, job_hours: 100, general_hours: 50, total_hours: 150 } },
    { report: 'salespeople', person: 'Aaron Ross', data: { sent_quotes: 10, converted_quotes: 5, sent_cents: 500_000, converted_cents: 250_000 } },
  ];
  const r = computeJobsData({ jobs, invoices: [], payments: [], people });

  it('totals revenue, profit, margin, ticket and revenue per hour', () => {
    expect(r.totals).toMatchObject({ jobs: 3, revenueCents: 220000, profitCents: 85000, avgTicketCents: 73333, hours: 22 });
    expect(r.totals.margin).toBeCloseTo(85 / 220);
    expect(r.totals.revenuePerHourCents).toBe(10000); // $2,200 over 22 hours = $100 an hour
  });
  it('groups by month, lead source, salesperson and client, biggest first', () => {
    expect(r.byMonth.map((m) => [m.month, m.jobs, m.revenueCents])).toEqual([
      ['2026-01', 2, 150000],
      ['2026-02', 1, 70000],
    ]);
    expect(r.byLead.map((g) => [g.name, g.jobs, g.revenueCents])).toEqual([
      ['Google', 2, 150000],
      ['Van', 1, 70000],
    ]);
    expect(r.bySalesperson[0]).toMatchObject({ name: 'Aaron Ross', jobs: 2, revenueCents: 170000 });
    expect(r.topClients[0].name).toBe('A');
  });
  it('works out per-person productivity and quote conversion, and can look at one period', () => {
    expect(r.people[0]).toMatchObject({ person: 'Aaron Ross', jobPerHourCents: 10000, overallPerHourCents: 6667 });
    expect(r.people[0].onJobShare).toBeCloseTo(100 / 150);
    expect(r.salespeople[0]).toMatchObject({ conversion: 0.5, avgConvertedCents: 50000 });
    const feb = computeJobsData({ jobs, invoices: [], payments: [], people, from: '2026-02-01', to: '2026-02-28' });
    expect(feb.totals.jobs).toBe(1);
    expect(feb.totals.revenueCents).toBe(70000);
  });
  it('summarizes invoices and payments', () => {
    const x = computeJobsData({
      jobs,
      people,
      invoices: [
        { status: 'Paid', days_to_pay: 10, paid_on: '2026-01-20', issued_on: '2026-01-10', total_cents: 100, balance_cents: 0 },
        { status: 'Paid', days_to_pay: 20, paid_on: '2026-02-01', issued_on: '2026-01-12', total_cents: 100, balance_cents: 0 },
        { status: 'Bad Debt', days_to_pay: null, paid_on: null, issued_on: '2026-01-15', total_cents: 50, balance_cents: 50 },
      ],
      payments: [{ paid_on: '2026-01-20', total_cents: 10000, fee_cents: 300 }],
    });
    expect(x.invoices).toMatchObject({ invoices: 3, paid: 2, badDebt: 1, avgDaysToPay: 15, outstandingCents: 50 });
    expect(x.payments).toMatchObject({ count: 1, totalCents: 10000, feeCents: 300 });
    expect(x.payments.feeShare).toBeCloseTo(0.03);
  });
});
