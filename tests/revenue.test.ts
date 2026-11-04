import { describe, expect, it } from 'vitest';
import { LAUNCH_MONTH, paymentRevenue, revenueTimeline, yearTotals } from '../src/modules/revenue';

const qb = [
  { month: '2026-08', income_cents: 1_000_000 },
  { month: '2026-09', income_cents: 1_600_000 },
  { month: '2026-10', income_cents: 700_000 },
];

describe('revenue over time', () => {
  it('takes the sales tax out of a payment', () => {
    expect(paymentRevenue({ received_on: '2026-10-05', amount_cents: 110_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000 })).toBe(100_000);
    expect(paymentRevenue({ received_on: '2026-10-05', amount_cents: 55_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000 })).toBe(50_000);
    expect(paymentRevenue({ received_on: '2026-10-05', amount_cents: 5_000, invoice_total_cents: 0, invoice_tax_cents: 0 })).toBe(5_000);
  });

  it('uses QuickBooks until the first month with a HandyOS payment, then HandyOS, never both', () => {
    const t = revenueTimeline({
      quickbooks: qb,
      payments: [
        { received_on: '2026-10-20', amount_cents: 110_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000 },
        { received_on: '2026-11-03', amount_cents: 22_000, invoice_total_cents: 22_000, invoice_tax_cents: 2_000 },
      ],
    });
    expect(t.cutover).toBe('2026-10');
    expect(t.months.map((m) => [m.month, m.revenue_cents, m.source, m.cutover])).toEqual([
      ['2026-08', 1_000_000, 'quickbooks', false],
      ['2026-09', 1_600_000, 'quickbooks', false],
      ['2026-10', 100_000, 'handyos', true], // QuickBooks' $7,000 for October is not added on top
      ['2026-11', 20_000, 'handyos', false],
    ]);
    expect(yearTotals(t.months)).toEqual({ '2026': 2_720_000 });
  });

  it('switches at the launch month, ignoring practice payments before it', () => {
    const t = revenueTimeline({
      quickbooks: qb,
      payments: [
        { received_on: '2026-10-20', amount_cents: 99_999, invoice_total_cents: 0, invoice_tax_cents: 0 }, // practice
        { received_on: '2027-01-05', amount_cents: 33_000, invoice_total_cents: 33_000, invoice_tax_cents: 3_000 },
      ],
      cutover: LAUNCH_MONTH,
    });
    expect(t.months.map((m) => [m.month, m.revenue_cents, m.source])).toEqual([
      ['2026-08', 1_000_000, 'quickbooks'],
      ['2026-09', 1_600_000, 'quickbooks'],
      ['2026-10', 700_000, 'quickbooks'], // the practice payment does not replace QuickBooks
      ['2027-01', 30_000, 'handyos'],
    ]);
  });

  it('is all QuickBooks when nothing is paid in HandyOS yet, marks gaps, and honors a chosen switch month', () => {
    const none = revenueTimeline({ quickbooks: [qb[0], qb[2]], payments: [] });
    expect(none.cutover).toBeNull();
    expect(none.months.map((m) => m.source)).toEqual(['quickbooks', 'quickbooks']);
    const chosen = revenueTimeline({ quickbooks: qb, payments: [{ received_on: '2026-09-02', amount_cents: 1_000, invoice_total_cents: 0, invoice_tax_cents: 0 }], cutover: '2026-10' });
    expect(chosen.months.find((m) => m.month === '2026-09')?.source).toBe('quickbooks');
    expect(chosen.months.find((m) => m.month === '2026-10')?.revenue_cents).toBe(0);
  });
});

import { buildEntries, groupRevenue, parseAmount, parseDate, readEntries, readRevenueFile, weekStart } from '../src/modules/revenue';

const SAMPLE = `Sales by Customer Detail
That Handyman Van LLC

Date,Transaction type,Num,Customer,Memo/Description,Amount
03/14/2025,Invoice,1042,Pat Smith,Deck repair,"1,250.00"
03/16/2025,Invoice,1043,Lee Park,Gutter clean,300.00
03/20/2025,Credit Memo,1044,Pat Smith,Refund,(50.00)
Total,,,,,"1,500.00"
`;

describe('loading past invoices', () => {
  it('finds the header row, guesses the columns, and reads dates and amounts in common formats', () => {
    const f = readRevenueFile(SAMPLE)!;
    expect(f.headers).toContain('Customer');
    expect(f.guess).toMatchObject({ date: 0, invoice: 2, customer: 3, job: 4, amount: 5 });
    const { entries, skipped } = readEntries(f.rows, f.guess);
    expect(entries.map((e) => [e.date, e.amount_cents, e.customer, e.job, e.invoice_ref])).toEqual([
      ['2025-03-14', 125_000, 'Pat Smith', 'Deck repair', '1042'],
      ['2025-03-16', 30_000, 'Lee Park', 'Gutter clean', '1043'],
      ['2025-03-20', -5_000, 'Pat Smith', 'Refund', '1044'],
    ]);
    expect(skipped).toBe(1); // the Total row
    expect(readRevenueFile('just,some,words\n1,2,3')).toBeNull();
    expect([parseDate('Oct 5, 2026'), parseDate('2026-10-05'), parseDate('5-Oct-2026'), parseDate('10/5/26'), parseDate('hello')]).toEqual(['2026-10-05', '2026-10-05', '2026-10-05', '2026-10-05', null]);
    expect([parseAmount('$1,234.50'), parseAmount('(120.00)'), parseAmount('-120'), parseAmount('abc')]).toEqual([123_450, -12_000, -12_000, null]);
  });

  it('groups by day, week (Monday to Sunday), month, quarter, year, job and customer', () => {
    const history = [
      { received_on: '2026-10-05', amount_cents: 100_000, customer: 'Pat', job: 'Deck', source: 'old' }, // Monday
      { received_on: '2026-10-11', amount_cents: 50_000, customer: 'Pat', job: 'Gutters', source: 'old' }, // Sunday, same week
      { received_on: '2026-10-12', amount_cents: 20_000, customer: 'Lee', job: 'Deck', source: 'old' }, // next Monday
      { received_on: '2026-12-30', amount_cents: 10_000, customer: 'Lee', job: '', source: 'old' },
    ];
    const built = buildEntries({ history, payments: [], quickbooks: [], launch: '2027-01' });
    const g = (by: Parameters<typeof groupRevenue>[1]) => groupRevenue(built, by).map((r) => [r.key, r.cents]);
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(g('week')).toEqual([['2026-10-12', 20_000], ['2026-10-05', 150_000], ['2026-12-28', 10_000]].sort((a, b) => String(b[0]).localeCompare(String(a[0]))));
    expect(g('day')).toHaveLength(4);
    expect(g('month')).toEqual([['2026-12', 10_000], ['2026-10', 170_000]]);
    expect(g('quarter')).toEqual([['2026-Q4', 180_000]]);
    expect(g('year')).toEqual([['2026', 180_000]]);
    expect(g('customer')).toEqual([['pat', 150_000], ['lee', 30_000]]);
    expect(g('job')[0]).toEqual(['deck', 120_000]);
  });

  it('uses history before launch and HandyOS payments after, falls back to a QuickBooks monthly total only for months without rows', () => {
    const built = buildEntries({
      history: [{ received_on: '2026-09-10', amount_cents: 40_000, customer: 'Pat', job: 'Deck', source: 'old' }, { received_on: '2027-01-02', amount_cents: 999, customer: 'x', job: '', source: 'old' }],
      payments: [
        { received_on: '2026-12-01', amount_cents: 777, invoice_total_cents: 0, invoice_tax_cents: 0, customer: 'p', job: '' }, // practice before launch
        { received_on: '2027-01-05', amount_cents: 110_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, customer: 'Lee', job: '#1001 Fence' },
      ],
      quickbooks: [{ month: '2026-09', income_cents: 1_600_000 }, { month: '2026-08', income_cents: 900_000 }],
      launch: '2027-01',
    });
    expect(built.entries.map((e) => [e.date, e.amount_cents, e.source])).toEqual([['2026-09-10', 40_000, 'old'], ['2027-01-05', 100_000, 'HandyOS']]);
    expect(built.monthlyOnly.map((e) => [e.date, e.amount_cents])).toEqual([['2026-08-01', 900_000]]); // September has rows, so its P&L total is not added
    expect(groupRevenue(built, 'month').map((r) => [r.key, r.cents])).toEqual([['2027-01', 100_000], ['2026-09', 40_000], ['2026-08', 900_000]]);
    expect(groupRevenue(built, 'customer').map((r) => r.key)).not.toContain('');
  });
});
