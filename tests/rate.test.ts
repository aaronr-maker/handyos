import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/core';
import { buildTree, totalsOf } from '../src/modules/jobcosting/pnlTree';
import { computeJobCost, computeRate, defaultCategory, jobcostingModule, minutesByMonth, monthKey, parseAmount, parsePnl } from '../src/modules/jobcosting';

// Shaped like a QuickBooks Online "Profit and Loss" CSV export (made-up numbers).
const PNL = `Profit and Loss
Example Handyman LLC
"October 1-31, 2026"

,Total
Income
  Services,"52,000.00"
  Materials Resale,"8,000.00"
Total Income,"60,000.00"
Cost of Goods Sold
  Job Materials,"9,500.00"
Total Cost of Goods Sold,"9,500.00"
Gross Profit,"50,500.00"
Expenses
  Advertising,"1,200.00"
  Insurance,"2,400.00"
  Payroll Expenses
    Wages,"18,000.00"
    Payroll Taxes,"1,980.00"
    Gusto Payroll Fees,150.00
  Total Payroll Expenses,"20,130.00"
  Vehicle Fuel,"2,100.00"
  Owner Draw,"3,000.00"
  Refund (credit),(250.00)
Total Expenses,"28,980.00"
Net Operating Income,"21,520.00"
Other Expenses
  Interest Expense,310.00
Total Other Expenses,310.00
Net Income,"21,210.00"
`;

describe('QuickBooks Profit & Loss reader', () => {
  it('finds the month, keeps only cost accounts, skips income, totals and group headers', () => {
    const r = parsePnl(PNL);
    expect(r.month_guess).toBe('2026-10');
    expect(r.warnings).toEqual([]);
    expect(r.lines.map((l) => l.account)).toEqual(['Job Materials', 'Advertising', 'Insurance', 'Wages', 'Payroll Taxes', 'Gusto Payroll Fees', 'Vehicle Fuel', 'Owner Draw', 'Refund (credit)', 'Interest Expense']);
    expect(r.lines.find((l) => l.account === 'Wages')).toEqual({ account: 'Wages', amount_cents: 1_800_000, section: 'expense', group: 'Payroll Expenses' });
    expect(r.lines.find((l) => l.account === 'Refund (credit)')!.amount_cents).toBe(-25000); // parentheses mean negative
    expect(r.lines.find((l) => l.account === 'Job Materials')!.section).toBe('cogs');
  });

  it('warns on an empty or wrong file and on a multi-column report', () => {
    expect(parsePnl('hello,world\nfoo,bar').warnings[0]).toContain('No cost accounts');
    const multi = parsePnl('October 2026\nExpenses\n  Rent,"1,000.00","1,100.00","2,100.00"\nTotal Expenses,"1,000.00","1,100.00","2,100.00"');
    expect(multi.lines[0].amount_cents).toBe(100000);
    expect(multi.warnings.join(' ')).toContain('several columns');
  });

  it('adds repeated account names together', () => {
    const r = parsePnl('Expenses\n  Supplies,"100.00"\n  Supplies,50.00\nTotal Expenses,150.00');
    expect(r.lines).toEqual([{ account: 'Supplies', amount_cents: 15000, section: 'expense', group: '' }]);
  });

  it('parses amounts', () => {
    expect([parseAmount('$1,234.56'), parseAmount('(100.00)'), parseAmount('-5'), parseAmount('12'), parseAmount(''), parseAmount('abc')]).toEqual([123456, -10000, -500, 1200, null, null]);
  });

  it('reads the group each account sits under, and uses it to sort job materials and payroll sub-accounts', () => {
    const r = parsePnl(`Expenses
  Job Expenses
    Job Materials
      Decks and Patios,145.95
      Plants and Soil,105.95
    Total for Job Materials,251.90
  Total for Job Expenses,251.90
  Payroll Expenses
    Salaries,"1,000.00"
    Taxes,120.00
    Service Fees,20.00
  Total for Payroll Expenses,"1,140.00"
  Rent,"2,000.00"
Total Expenses,"3,391.90"`);
    const by = Object.fromEntries(r.lines.map((l) => [l.account, l]));
    expect(by['Decks and Patios'].group).toBe('Job Expenses > Job Materials');
    expect(by['Salaries'].group).toBe('Payroll Expenses');
    expect(by['Rent'].group).toBe(''); // the groups were closed
    const cat = (n: string) => defaultCategory(n, by[n].section, by[n].group);
    expect([cat('Decks and Patios'), cat('Plants and Soil')]).toEqual(['excluded', 'excluded']);
    expect([cat('Salaries'), cat('Taxes'), cat('Service Fees'), cat('Rent')]).toEqual(['wages', 'payroll_tax', 'overhead', 'overhead']);
  });

  it('makes a sensible first guess at categories', () => {
    const c = (name: string, s: 'cogs' | 'expense' | 'other_expense' = 'expense') => defaultCategory(name, s);
    expect(c('Wages')).toBe('wages');
    expect(c('Salaries & Bonuses')).toBe('wages');
    expect(c('Payroll Taxes')).toBe('payroll_tax');
    expect(c('Employer FICA')).toBe('payroll_tax');
    expect(c("Workers' Comp Insurance")).toBe('payroll_tax');
    expect(c('Gusto Payroll Fees')).toBe('overhead');
    expect(c('Insurance')).toBe('overhead');
    expect(c('Owner Draw')).toBe('excluded');
    expect(c('Job Materials', 'cogs')).toBe('excluded');
    expect(c('Interest Expense', 'other_expense')).toBe('excluded');
  });
});

// Shaped like QuickBooks' "Profit and Loss by Month" (cash basis) for a small company: one column per month, a part-month
// column, accounts that are blank in some months, a parent account with its own balance AND a sub-account, and the same
// account name ("Supplies & materials") in two places. Numbers are invented.
const BY_MONTH = `That Handyman Van LLC
Profit and Loss by Month
January 1-November 3, 2026

,Sep 2026,Oct 2026,Nov 1-3 2026,Total
Income
Services,"16,000.00","7,000.00",500.00,"23,500.00"
Total Income,"16,000.00","7,000.00",500.00,"23,500.00"
Cost of Goods Sold
Cost of goods sold,290.00,,,290.00
Supplies & materials,"1,000.00",15.00,,"1,015.00"
Total for Cost of goods sold,"1,290.00",15.00,0.00,"1,305.00"
Housecall Pro Payment Processing Fee,400.00,55.00,,455.00
Total Cost of Goods Sold,"1,690.00",70.00,0.00,"1,760.00"
Gross Profit,"14,310.00","6,930.00",500.00,"21,740.00"
Expenses
Advertising & marketing,,,,
Ask My Accountant,-570.00,,,-570.00
Building & property rent,,,,
Credit card collection fee,120.00,,,120.00
General business expenses,,,,
Memberships & subscriptions,15.00,,,15.00
Total for General business expenses,15.00,0.00,0.00,15.00
Meals,50.00,20.00,,70.00
Office expenses,,,,
Office supplies,,,,
Small tools and equipment,,,,
Total for Office expenses,0.00,0.00,0.00,0.00
Supplies,,,,
Supplies & materials,210.00,155.00,,365.00
Total for Supplies,210.00,155.00,0.00,365.00
Utilities,,,,
Disposal & waste fees,,33.00,,33.00
Total for Utilities,0.00,33.00,0.00,33.00
Total Expenses,-175.00,208.00,0.00,33.00
Net Operating Income,"14,485.00","6,722.00",500.00,"21,707.00"
Other Expenses
Jobber Payment Fees,4.00,,,4.00
Vehicle expenses,,,,
Vehicle gas & fuel,100.00,,,100.00
Total for Vehicle expenses,100.00,0.00,0.00,100.00
Total Other Expenses,104.00,0.00,0.00,104.00
Net Income,"14,381.00","6,722.00",500.00,"21,603.00"
Cash Basis Tuesday, November 03, 2026 05:34`;

describe('a month-by-month Profit and Loss', () => {
  const brief = (r: ReturnType<typeof parsePnl>) => r.lines.map((l) => `${l.section}|${l.group}|${l.account}|${l.amount_cents}`);

  it('finds the months, defaults to the latest full month, and reads the chosen month column', () => {
    const r = parsePnl(BY_MONTH);
    expect(r.available_months).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(r.month_guess).toBe('2026-10'); // the part month (Nov 1-3) is not the default
    expect(r.warnings).toEqual([]);
    expect(brief(r)).toEqual([
      'cogs|Cost of goods sold|Supplies & materials|1500',
      'cogs||Housecall Pro Payment Processing Fee|5500',
      'expense||Meals|2000',
      'expense|Supplies|Supplies & materials|15500',
      'expense|Utilities|Disposal & waste fees|3300',
    ]);
  });

  it('reads another month, keeps the own balance of a parent account, and does not blame blank accounts for the groups after them', () => {
    const r = parsePnl(BY_MONTH, '2026-09');
    expect(r.month_guess).toBe('2026-09');
    expect(brief(r)).toEqual([
      'cogs||Cost of goods sold|29000', // a parent account with its own balance...
      'cogs|Cost of goods sold|Supplies & materials|100000', // ...and its sub-account
      'cogs||Housecall Pro Payment Processing Fee|40000',
      'expense||Ask My Accountant|-57000', // not "in Advertising & marketing" (that row was just blank)
      'expense||Credit card collection fee|12000',
      'expense|General business expenses|Memberships & subscriptions|1500',
      'expense||Meals|5000', // the group was closed
      'expense|Supplies|Supplies & materials|21000', // same name as the cost-of-goods one, kept separate
      'other_expense||Jobber Payment Fees|400',
      'other_expense|Vehicle expenses|Vehicle gas & fuel|10000',
    ]);
  });

  it('captures the totals QuickBooks printed, and what was read adds up to them for every section', () => {
    const r = parsePnl(BY_MONTH, '2026-09');
    expect(r.reported).toEqual({ income: 1_600_000, cogs: 169_000, gross_profit: 1_431_000, expenses: -17_500, net_operating_income: 1_448_500, other_expenses: 10_400, net_income: 1_438_100 });
    const sum = (section: string) => r.lines.filter((l) => l.section === section).reduce((n, l) => n + l.amount_cents, 0);
    expect(sum('cogs')).toBe(r.reported.cogs);
    expect(sum('expense')).toBe(r.reported.expenses);
    expect(sum('other_expense')).toBe(r.reported.other_expenses);
    // October too (accounts that are blank in other months do not disturb it)
    const oct = parsePnl(BY_MONTH, '2026-10');
    expect(oct.lines.filter((l) => l.section === 'expense').reduce((n, l) => n + l.amount_cents, 0)).toBe(oct.reported.expenses);
  });

  it('lays accounts out like QuickBooks: sections, nested groups, a total for each, and what counts versus not', () => {
    const r = parsePnl(BY_MONTH, '2026-09');
    const rows = r.lines.map((l) => ({ account: l.account, group: l.group, section: l.section, cents: l.amount_cents, category: defaultCategory(l.account, l.section, l.group) }));
    const tree = buildTree(rows);
    expect(tree.map((t) => [t.label, t.total])).toEqual([['Cost of Goods Sold', 169_000], ['Expenses', -17_500], ['Other Expenses', 10_400]]);
    const cogs = tree[0].nodes;
    // the parent account's own balance sits inside its group, so "Total for Cost of goods sold" is 290 + 1,000 as in QuickBooks
    expect(cogs.map((n) => `${n.kind}:${n.name}`)).toEqual(['group:Cost of goods sold', 'account:Housecall Pro Payment Processing Fee']);
    const group = cogs[0];
    expect(group.kind === 'group' && group.total).toBe(129_000);
    expect(group.kind === 'group' && group.children.map((c) => c.name)).toEqual(['Cost of goods sold', 'Supplies & materials']);
    const totals = totalsOf(rows);
    expect(totals.all).toBe(169_000 - 17_500 + 10_400);
    expect(totals.excluded).toBe(169_000); // everything inside cost of goods sold
    expect(totals.counted).toBe(-17_500 + 10_400);
    expect(totals.counted + totals.excluded).toBe(totals.all);
  });

  it('sorts these accounts sensibly: cost of goods sold out, vehicle fuel (filed under Other Expenses) in', () => {
    const cat = (r: ReturnType<typeof parsePnl>, name: string, group = '') => {
      const l = r.lines.find((x) => x.account === name && x.group === group)!;
      return defaultCategory(l.account, l.section, l.group);
    };
    const sep = parsePnl(BY_MONTH, '2026-09');
    expect(cat(sep, 'Supplies & materials', 'Cost of goods sold')).toBe('excluded');
    expect(cat(sep, 'Housecall Pro Payment Processing Fee')).toBe('excluded'); // inside cost of goods sold
    expect(cat(sep, 'Vehicle gas & fuel', 'Vehicle expenses')).toBe('overhead'); // a real running cost, even though QuickBooks files it under Other Expenses
    expect(cat(sep, 'Meals')).toBe('overhead');
    expect(cat(sep, 'Supplies & materials', 'Supplies')).toBe('overhead');
    expect(defaultCategory('Interest Expense', 'other_expense')).toBe('excluded');
    expect(defaultCategory('Loan fees', 'other_expense')).toBe('excluded');
  });
});

describe('company hourly rate', () => {
  const lines = [
    { amount_cents: 1_800_000, category: 'wages' as const },
    { amount_cents: 198_000, category: 'payroll_tax' as const },
    { amount_cents: 600_000, category: 'overhead' as const },
    { amount_cents: 950_000, category: 'excluded' as const },
  ];

  it('divides the counted costs by the man-hours, adds the margin for the price, and shows the wages share', () => {
    const r = computeRate({ lines, minutes: 400 * 60, target_margin_bps: 3000 });
    expect(r.counted_cents).toBe(2_598_000);
    expect(r.excluded_cents).toBe(950_000);
    expect(r.hours).toBe(400);
    expect(r.cost_per_hour_cents).toBe(6495); // $64.95 per man-hour
    expect(r.price_per_hour_cents).toBe(Math.round(6495 / 0.7)); // 30% margin on the price
    expect([r.wages_share_bps, r.payroll_tax_share_bps, r.overhead_share_bps]).toEqual([6928, 762, 2309]);
    const parts = r.per_hour!;
    expect(parts.wages_cents + parts.payroll_tax_cents + parts.overhead_cents).toBe(6495); // adds up exactly
  });

  it('has no rate without hours or costs', () => {
    expect(computeRate({ lines, minutes: 0, target_margin_bps: 3000 }).cost_per_hour_cents).toBeNull();
    expect(computeRate({ lines: [], minutes: 600, target_margin_bps: 3000 }).price_per_hour_cents).toBeNull();
  });

  it('counts clocked time by month, including someone still clocked in', () => {
    const t = (d: string) => new Date(d).toISOString();
    const k1 = monthKey(t('2026-10-15T12:00:00'));
    const k2 = monthKey(t('2026-11-03T12:00:00'));
    const m = minutesByMonth(
      [
        { clock_in: t('2026-10-15T12:00:00'), clock_out: t('2026-10-15T17:00:00') },
        { clock_in: t('2026-11-03T12:00:00'), clock_out: null },
      ],
      Date.parse('2026-11-03T14:00:00'),
    );
    expect(m).toEqual({ [k1]: 300, [k2]: 120 });
  });

  it('values labor in job costing at the company rate for the month worked, falling back to the latest rate', () => {
    const base = { invoiced_cents: 50000, collected_cents: 0, costs: [], expected_cost_cents: null, rates: { a: 2000 } };
    const oct = { clock_in: new Date('2026-10-10T09:00:00').toISOString(), clock_out: new Date('2026-10-10T11:00:00').toISOString() };
    const dec = { clock_in: new Date('2026-12-10T09:00:00').toISOString(), clock_out: new Date('2026-12-10T10:00:00').toISOString() };
    const r = computeJobCost({ ...base, entries: [{ user_id: 'a', ...oct }, { user_id: 'a', ...dec }], burdened: { rates: { '2026-10': 6000 }, fallback: 6000 } });
    expect(r.labor_cents).toBe(12000 + 6000); // 2h + 1h, both at $60 (December falls back to the latest rate)
    expect(r.labor_method).toBe('company_rate');
    const none = computeJobCost({ ...base, entries: [{ user_id: 'a', ...oct }], burdened: { rates: {}, fallback: null } });
    expect([none.labor_cents, none.missing_rate_months]).toEqual([0, ['2026-10']]);
    const person = computeJobCost({ ...base, entries: [{ user_id: 'a', ...oct }] });
    expect([person.labor_cents, person.labor_method]).toEqual([4000, 'person']); // without the setting, each person's own rate
  });
});

describe('saving a month and using it in job costing', () => {
  it('only owners/admins save costs; the result is stored; the setting switches job labor to the company rate', async () => {
    const rt = createRuntime();
    jobcostingModule.register({ actions: rt.actions, events: rt.events });
    const co = 'coRate';
    const as = (role: 'owner' | 'admin' | 'office') => ({ companyId: co, actor: { kind: 'user' as const, id: `u-${role}` }, role });
    const month = {
      month: '2026-10',
      source: 'quickbooks_csv',
      hours_override_minutes: 400 * 60,
      lines: [
        { account_name: 'Wages', group_path: 'Payroll Expenses', amount_cents: 1_800_000, category: 'wages' },
        { account_name: 'Insurance', group_path: '', amount_cents: 240_000, category: 'overhead' },
        { account_name: 'Job Materials', group_path: 'Cost of goods sold', amount_cents: 950_000, category: 'excluded' },
      ],
    };
    expect((await rt.actions.executeByName('jobcosting.save_overhead_month', month, as('office'))).status).toBe('denied');
    const saved = await rt.actions.executeByName('jobcosting.save_overhead_month', month, as('owner'));
    expect(saved.status, JSON.stringify(saved)).toBe('ok');
    expect((saved as { output: { cost_per_hour_cents: number } }).output.cost_per_hour_cents).toBe(5100); // $20,400 / 400 h
    // saving the same month again replaces it
    const again = await rt.actions.executeByName('jobcosting.save_overhead_month', { ...month, lines: month.lines.slice(0, 1) }, as('admin'));
    expect((again as { output: { cost_per_hour_cents: number } }).output.cost_per_hour_cents).toBe(4500);
    expect((await rt.actions.executeByName('jobcosting.save_overhead_month', { ...month, month: 'October' }, as('owner'))).status).toBe('invalid');
    void vi;
  });
});
