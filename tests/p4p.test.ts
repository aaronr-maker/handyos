import { describe, expect, it } from 'vitest';
import { basisAmount, computeP4P, splitCents, validateSetup, type CalcInputs, type CalcLevel } from '../src/modules/jobcosting/p4pCalc';

const levels: CalcLevel[] = [
  { id: 'seller', name: 'Sales', kind: 'seller', percent_bps: 1000, sort_order: 1 }, // 10% of the pool
  { id: 'tech', name: 'Technician', kind: 'worker', percent_bps: 5000, sort_order: 2 }, // 50%
  { id: 'gf', name: 'General Foreman', kind: 'supervisor', percent_bps: 1500, sort_order: 3 }, // 15%
  { id: 'rm', name: 'Regional', kind: 'supervisor', percent_bps: 500, sort_order: 4 }, // 5%
];

const base = (over: Partial<CalcInputs> = {}): CalcInputs => ({
  basis: 'net_profit',
  company_reserve_bps: 2000, // company keeps 20% first
  levels,
  reports_to: { t1: 'gf1', t2: 'gf1', gf1: 'rm1' },
  revenue_cents: 100000, // $1,000.00
  non_labor_cost_cents: 20000, // materials $200
  total_cost_cents: 40000, // all costs $400 (so labor was $200)
  sold_by: 'seller1',
  minutes: { t1: 300, t2: 300 },
  ...over,
});

const amount = (r: ReturnType<typeof computeP4P>, id: string) => r.levels.find((l) => l.level_id === id)!;

describe('P4P pool', () => {
  it('takes the pool from revenue, gross profit or net profit, never below zero', () => {
    const i = base();
    expect(basisAmount({ ...i, basis: 'revenue' })).toBe(100000);
    expect(basisAmount({ ...i, basis: 'gross_profit' })).toBe(80000);
    expect(basisAmount({ ...i, basis: 'net_profit' })).toBe(60000);
    expect(basisAmount({ ...i, basis: 'net_profit', total_cost_cents: 150000 })).toBe(0); // a losing job earns nothing
  });

  it('the company keeps its reserve first; the rest is the pool', () => {
    const r = computeP4P(base());
    expect(r.basis_cents).toBe(60000);
    expect(r.reserve_cents).toBe(12000);
    expect(r.pool_cents).toBe(48000);
  });

  it('two techs with equal hours split the worker level 50/50; one tech gets all of it', () => {
    const two = amount(computeP4P(base()), 'tech');
    expect(two.amount_cents).toBe(24000); // 50% of the $480 pool
    expect(two.allocations.map((a) => [a.user_id, a.amount_cents, a.share])).toEqual([['t1', 12000, 0.5], ['t2', 12000, 0.5]]);

    const one = amount(computeP4P(base({ minutes: { t1: 480 } })), 'tech');
    expect(one.allocations).toEqual([{ user_id: 't1', amount_cents: 24000, share: 1 }]);

    // unequal hours: 7h and 3h share 70/30
    const uneven = amount(computeP4P(base({ minutes: { t1: 420, t2: 180 } })), 'tech');
    expect(uneven.allocations.map((a) => a.amount_cents)).toEqual([16800, 7200]);
  });

  it('pays the seller their percent, and keeps it with the company when nobody sold the job', () => {
    const r = computeP4P(base());
    expect(amount(r, 'seller').allocations).toEqual([{ user_id: 'seller1', amount_cents: 4800, share: 1 }]);
    const none = computeP4P(base({ sold_by: null }));
    expect(amount(none, 'seller')).toMatchObject({ amount_cents: 4800, unallocated_cents: 4800, allocations: [] });
    expect(amount(none, 'seller').note).toContain('No seller');
  });

  it('supervisor levels pay the bosses of the level below, weighted by the hours that flow up through them', () => {
    const r = computeP4P(base());
    expect(amount(r, 'gf').allocations).toEqual([{ user_id: 'gf1', amount_cents: 7200, share: 1 }]); // 15% of 48000
    expect(amount(r, 'rm').allocations).toEqual([{ user_id: 'rm1', amount_cents: 2400, share: 1 }]); // 5%

    // two techs with different foremen: the foreman level splits by the hours each foreman's tech worked
    const split = computeP4P(base({ reports_to: { t1: 'gfA', t2: 'gfB', gfA: 'rm1', gfB: 'rm1' }, minutes: { t1: 300, t2: 100 } }));
    expect(amount(split, 'gf').allocations.map((a) => [a.user_id, a.amount_cents])).toEqual([['gfA', 5400], ['gfB', 1800]]);
    expect(amount(split, 'rm').allocations).toEqual([{ user_id: 'rm1', amount_cents: 2400, share: 1 }]);
  });

  it('keeps with the company the part nobody can receive: a tech with no foreman, a foreman with no regional', () => {
    const r = computeP4P(base({ reports_to: { t1: 'gf1', t2: null, gf1: null }, minutes: { t1: 300, t2: 300 } }));
    expect(amount(r, 'gf')).toMatchObject({ amount_cents: 7200, unallocated_cents: 3600 }); // t2's half has no boss
    expect(amount(r, 'gf').allocations).toEqual([{ user_id: 'gf1', amount_cents: 3600, share: 0.5 }]);
    expect(amount(r, 'rm')).toMatchObject({ amount_cents: 2400 });
    // gf1 has no regional, and half of the weight was already nobody's
    expect(amount(r, 'rm').allocations).toEqual([]);
    expect(amount(r, 'rm').unallocated_cents).toBe(2400);
  });

  it('pays out nothing from a job with no profit, and money always adds up exactly', () => {
    const lost = computeP4P(base({ total_cost_cents: 120000 }));
    expect(lost.pool_cents).toBe(0);
    expect(Object.values(lost.by_user).every((x) => x === 0)).toBe(true);

    const odd = computeP4P(base({ revenue_cents: 99999, minutes: { t1: 70, t2: 70, t3: 70 }, reports_to: { t1: 'g', t2: 'g', t3: 'g', g: 'r' } }));
    const paid = Object.values(odd.by_user).reduce((n, x) => n + x, 0);
    expect(paid + odd.company_total_cents).toBe(odd.basis_cents);
    const tech = amount(odd, 'tech');
    expect(tech.allocations.reduce((n, a) => n + a.amount_cents, 0) + tech.unallocated_cents).toBe(tech.amount_cents);
  });

  it('levels can be renamed, reordered and added without changing the math', () => {
    const extra: CalcLevel[] = [...levels.map((l) => ({ ...l, name: l.name + '!' })), { id: 'dir', name: 'Director', kind: 'supervisor', percent_bps: 500, sort_order: 5 }];
    const r = computeP4P(base({ levels: extra, reports_to: { t1: 'gf1', t2: 'gf1', gf1: 'rm1', rm1: 'dir1' } }));
    expect(amount(r, 'dir').allocations).toEqual([{ user_id: 'dir1', amount_cents: 2400, share: 1 }]);
    expect(r.levels.map((l) => l.name)).toEqual(['Sales!', 'Technician!', 'General Foreman!', 'Regional!', 'Director']);
  });
});

describe('splitCents', () => {
  it('splits exactly, with the extra cents going to the biggest remainders', () => {
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitCents(100, [1, 1, 1]).reduce((n, x) => n + x, 0)).toBe(100);
    expect(splitCents(0, [1, 2])).toEqual([0, 0]);
    expect(splitCents(50, [0, 0])).toEqual([0, 0]);
  });
});

describe('validateSetup', () => {
  const ok = [{ name: 'A', kind: 'worker' as const, percent_bps: 6000 }];
  it('accepts a sensible setup and explains the problems in plain words', () => {
    expect(validateSetup(1000, ok)).toBeNull();
    expect(validateSetup(1000, [...ok, { name: 'B', kind: 'supervisor', percent_bps: 5000 }])).toContain('110%');
    expect(validateSetup(1000, [{ name: ' ', kind: 'worker', percent_bps: 100 }])).toContain('name');
    expect(validateSetup(12000, ok)).toContain('company share');
    expect(validateSetup(0, [...ok, { name: 'W2', kind: 'worker', percent_bps: 100 }])).toContain('one level');
  });
});

describe('P4P end to end', () => {
  it('saves a setup, works out a job from the real time clock, invoice and costs, finalizes once, and tracks payouts', async () => {
    const { afterEach, vi } = await import('vitest');
    void afterEach;
    const { createRuntime } = await import('../src/core');
    const { customersModule } = await import('../src/modules/customers');
    const { estimatesModule } = await import('../src/modules/estimates');
    const { invoicingModule } = await import('../src/modules/invoicing');
    const { jobsModule, listJobs } = await import('../src/modules/jobs');
    const { paymentsModule } = await import('../src/modules/payments');
    const { jobcostingModule, jobP4P, listPayouts } = await import('../src/modules/jobcosting');

    const rt = createRuntime();
    for (const m of [customersModule, estimatesModule, jobsModule, invoicingModule, paymentsModule, jobcostingModule]) m.register({ actions: rt.actions, events: rt.events });
    const co = 'coP4P';
    type Role = 'owner' | 'admin' | 'office' | 'tech';
    const as = (role: Role, id = `u-${role}`) => ({ companyId: co, actor: { kind: 'user' as const, id }, role });
    const run = (name: string, input: unknown, c: ReturnType<typeof as>) => rt.actions.executeByName(name, input, c);
    const out = <T>(r: unknown) => (r as { output: T }).output;

    // setup: company keeps 20%; Sales 10%, Technician 50%, General Foreman 15%, Regional 5% of the pool
    const setup = {
      basis: 'net_profit',
      company_reserve_bps: 2000,
      levels: [
        { id: 'new-1', name: 'Sales', kind: 'seller', percent_bps: 1000 },
        { id: 'new-2', name: 'Field operative', kind: 'worker', percent_bps: 5000 },
        { id: 'new-3', name: 'Manager', kind: 'supervisor', percent_bps: 1500 },
        { id: 'new-4', name: 'Regional', kind: 'supervisor', percent_bps: 500 },
      ],
      people: [
        { user_id: 't1', level_id: 'new-2', reports_to: 'gf1' },
        { user_id: 't2', level_id: 'new-2', reports_to: 'gf1' },
        { user_id: 'gf1', level_id: 'new-3', reports_to: 'rm1' },
        { user_id: 'rm1', level_id: 'new-4', reports_to: null },
      ],
    };
    expect((await run('jobcosting.save_p4p_setup', setup, as('office'))).status).toBe('denied');
    const bad = await run('jobcosting.save_p4p_setup', { ...setup, levels: [...setup.levels, { id: 'new-5', name: 'Too much', kind: 'supervisor', percent_bps: 5000 }] }, as('owner'));
    expect((bad as { message: string }).message).toContain('more than 100%');
    expect((await run('jobcosting.save_p4p_setup', setup, as('owner'))).status).toBe('ok');
    expect((await run('jobcosting.save_p4p_setup', setup, as('owner'))).status).toBe('ok'); // saving again keeps the same levels (renames are kept too)

    for (const u of ['t1', 't2']) await run('jobcosting.set_pay_rate', { user_id: u, hourly_cost_cents: 2000 }, as('owner'));
    const cust = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }, as('office')));
    const job = out<{ id: string; sold_by: string }>(await run('jobs.create', { customer_id: cust.id, title: 'Fix gate' }, as('office', 'seller1')));
    expect(job.sold_by).toBe('seller1');

    // two techs work 5 hours each
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const u of ['t1', 't2']) {
        await run('jobs.clock_in', { job_id: job.id }, as('tech', u));
        vi.setSystemTime(new Date(Date.now() + 5 * 3600_000));
        await run('jobs.clock_out', { note: null }, as('tech', u));
      }
    } finally {
      vi.useRealTimers();
    }
    await run('jobcosting.add_cost', { job_id: job.id, kind: 'material', description: 'Hinges', amount_cents: 20000 }, as('office'));

    // before the job is finished and paid, the numbers are a projection and can't be finalized
    let p = await jobP4P(co, job.id);
    expect(p.status).toBe('not_ready');
    expect(p.reason).toContain('not completed');
    expect((await run('jobcosting.finalize_payout', { job_id: job.id }, as('owner'))).status).toBe('error');

    await run('jobs.complete', { job_id: job.id }, as('office'));
    const inv = out<{ id: string }>(await run('invoicing.create', { customer_id: cust.id, job_id: job.id, title: 'Fix gate', line_items: [{ description: 'Work', quantity: 1, unit_price_cents: 100000 }] }, as('office')));
    await run('invoicing.send', { invoice_id: inv.id }, as('office'));
    p = await jobP4P(co, job.id);
    expect(p.reason).toContain('not fully paid');
    await run('payments.record', { invoice_id: inv.id, amount_cents: 100000, method: 'check' }, as('office'));

    p = await jobP4P(co, job.id);
    expect(p.status).toBe('ready');
    expect(p.result).toMatchObject({ basis_cents: 60000, reserve_cents: 12000, pool_cents: 48000, total_minutes: 600 });
    expect(p.result.by_user).toEqual({ seller1: 4800, t1: 12000, t2: 12000, gf1: 7200, rm1: 2400 });
    expect(p.result.levels.map((l) => l.name)).toEqual(['Sales', 'Field operative', 'Manager', 'Regional']); // the company's own names
    expect(p.result.company_total_cents).toBe(60000 - (4800 + 24000 + 7200 + 2400)); // reserve + the unallocated 10%

    // only owners/admins finalize, only once
    expect((await run('jobcosting.finalize_payout', { job_id: job.id }, as('office'))).status).toBe('denied');
    expect((await run('jobcosting.finalize_payout', { job_id: job.id }, as('owner'))).status).toBe('ok');
    expect((await run('jobcosting.finalize_payout', { job_id: job.id }, as('owner'))).status).toBe('error');
    expect((await jobP4P(co, job.id)).status).toBe('finalized');

    const payouts = await listPayouts(co);
    expect(payouts.map((x) => [x.user_id, x.amount_cents]).sort()).toEqual([['gf1', 7200], ['rm1', 2400], ['seller1', 4800], ['t1', 12000], ['t2', 12000]]);
    expect(payouts.find((x) => x.user_id === 't1')).toMatchObject({ level_name: 'Field operative', minutes: 300 });

    // changing the settings later does not rewrite what was already earned
    await run('jobcosting.save_p4p_setup', { ...setup, company_reserve_bps: 5000 }, as('owner'));
    expect((await jobP4P(co, job.id)).payouts.map((x) => x.amount_cents).sort((a, b) => a - b)).toEqual([2400, 4800, 7200, 12000, 12000]);

    // marking paid
    const ids = payouts.map((x) => x.id);
    expect(out<{ marked: number }>(await run('jobcosting.mark_payouts_paid', { payout_ids: ids, paid_on: '2026-12-15' }, as('admin'))).marked).toBe(5);
    expect(out<{ marked: number }>(await run('jobcosting.mark_payouts_paid', { payout_ids: ids }, as('admin'))).marked).toBe(0); // already paid
    void listJobs;
  });
});
