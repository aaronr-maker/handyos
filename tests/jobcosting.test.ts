import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule } from '../src/modules/customers';
import { estimatesModule } from '../src/modules/estimates';
import { invoicingModule } from '../src/modules/invoicing';
import { jobsModule, listJobs } from '../src/modules/jobs';
import { computeJobCost, costJob, expectedCost, jobcostingModule, loadCostingData } from '../src/modules/jobcosting';
import { paymentsModule } from '../src/modules/payments';

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 11, 1, h, m)).toISOString();

describe('computeJobCost', () => {
  it('costs labor from clocked time and each person\'s rate, adds materials, and works out profit and margin', () => {
    const r = computeJobCost({
      invoiced_cents: 50000,
      collected_cents: 20000,
      entries: [
        { user_id: 'a', clock_in: t(9), clock_out: t(11, 30) }, // 2.5h at $40 = $100
        { user_id: 'b', clock_in: t(9), clock_out: t(10) }, // 1h at $25 = $25
        { user_id: 'c', clock_in: t(9), clock_out: t(10) }, // 1h, no rate set -> $0, reported
      ],
      rates: { a: 4000, b: 2500 },
      costs: [
        { kind: 'material', amount_cents: 4200 },
        { kind: 'other', amount_cents: 1500 },
        { kind: 'labor', amount_cents: 3000 },
      ],
      expected_cost_cents: 12000,
    });
    expect(r.labor_minutes).toBe(270);
    expect(r.labor_cents).toBe(10000 + 2500 + 3000);
    expect(r.material_cents).toBe(4200);
    expect(r.other_cents).toBe(1500);
    expect(r.total_cost_cents).toBe(15500 + 4200 + 1500);
    expect(r.profit_cents).toBe(50000 - 21200);
    expect(r.margin_pct).toBe(57.6);
    expect(r.unrated_user_ids).toEqual(['c']);
    expect(r.expected_cost_cents).toBe(12000);
  });

  it('has no margin before anything is invoiced, counts someone still clocked in, and can lose money', () => {
    const now = Date.parse(t(12));
    const r = computeJobCost({ invoiced_cents: 0, collected_cents: 0, entries: [{ user_id: 'a', clock_in: t(10), clock_out: null }], rates: { a: 6000 }, costs: [], expected_cost_cents: null, now });
    expect(r.labor_cents).toBe(12000);
    expect(r.margin_pct).toBeNull();
    expect(r.profit_cents).toBe(-12000);
  });
});

describe('job costing end to end', () => {
  it('uses the invoice, time clock, pay rates and recorded costs; keeps rates and costs private to the right roles', async () => {
    const rt = createRuntime();
    for (const m of [customersModule, estimatesModule, jobsModule, invoicingModule, paymentsModule, jobcostingModule]) m.register({ actions: rt.actions, events: rt.events });
    const co = 'coCost';
    const as = (role: 'owner' | 'admin' | 'office' | 'tech', id = `u-${role}`) => ({ companyId: co, actor: { kind: 'user' as const, id }, role });
    const run = (name: string, input: unknown, c: ReturnType<typeof as>) => rt.actions.executeByName(name, input, c);
    const out = <T>(r: unknown) => (r as { output: T }).output;

    const cust = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }, as('office')));
    const est = out<{ id: string }>(await run('estimates.create', { customer_id: cust.id, title: 'Fix gate', line_items: [{ description: 'Labor', quantity: 2, unit: 'hour', unit_price_cents: 9500, unit_cost_cents: 3500 }] }, as('office')));
    await run('estimates.send', { estimate_id: est.id }, as('office'));
    await run('estimates.approve', { estimate_id: est.id }, as('office'));
    const job = (await listJobs(co))[0];
    expect(await expectedCost(co, job)).toBe(7000);

    // owner sets a rate; office and techs may not
    expect((await run('jobcosting.set_pay_rate', { user_id: 'u-tech', hourly_cost_cents: 3000 }, as('owner'))).status).toBe('ok');
    expect((await run('jobcosting.set_pay_rate', { user_id: 'u-tech', hourly_cost_cents: 9000 }, as('office'))).status).toBe('denied');

    // the tech works the job for a (fake) hour; the clock uses real time so record the entry then shift it
    await run('jobs.clock_in', { job_id: job.id }, as('tech'));
    await run('jobs.clock_out', { note: null }, as('tech'));
    expect((await run('jobcosting.add_cost', { job_id: job.id, kind: 'material', description: 'Hinges', amount_cents: 4200 }, as('office'))).status).toBe('ok');
    expect((await run('jobcosting.add_cost', { job_id: job.id, kind: 'material', description: 'x', amount_cents: 100 }, as('tech'))).status).toBe('denied');
    expect((await run('jobcosting.add_cost', { job_id: job.id, kind: 'material', description: 'x', amount_cents: 0 }, as('office'))).status).toBe('invalid');

    // invoice it (draft invoices don't count; sent ones do)
    const inv = out<{ id: string }>(await run('invoicing.create_from_job', { job_id: job.id }, as('office')));
    let data = await loadCostingData(co);
    expect(costJob(job, data, 7000).invoiced_cents).toBe(0);
    await run('invoicing.send', { invoice_id: inv.id }, as('office'));
    await run('payments.record', { invoice_id: inv.id, amount_cents: 10000, method: 'check' }, as('office'));
    data = await loadCostingData(co);
    const r = costJob(job, data, 7000);
    expect(r).toMatchObject({ invoiced_cents: 19000, collected_cents: 10000, material_cents: 4200, expected_cost_cents: 7000 });
    expect(r.profit_cents).toBe(19000 - r.total_cost_cents);
    expect(r.unrated_user_ids).toEqual([]);

    // only owner/admin remove a cost
    const cost = data.allCosts[0];
    expect((await run('jobcosting.remove_cost', { cost_id: cost.id }, as('office'))).status).toBe('denied');
    expect((await run('jobcosting.remove_cost', { cost_id: cost.id }, as('admin'))).status).toBe('ok');
  });
});
