import { describe, expect, it } from 'vitest';
import { addPlans, planPayment } from '../src/modules/cashplan';
import type { JobEconomics } from '../src/modules/jobcosting';

// A $1,000 job plus 10% sales tax = $1,100 invoiced. $200 of materials, labor $300 (wages 200, payroll tax 40, running costs 60),
// a $50 pay-for-performance pool and a $30 company reserve.
const job: JobEconomics = {
  job_id: 'j1',
  invoiced_cents: 110_000,
  tax_cents: 10_000,
  materials_cents: 20_000,
  labor: { wages_cents: 20_000, payroll_tax_cents: 4_000, overhead_cents: 6_000 },
  p4p_pool_cents: 5_000,
  p4p_reserve_cents: 3_000,
  labor_method: 'company_rate',
};
const sum = (b: Record<string, number>) => Object.values(b).reduce((n, v) => n + v, 0);

describe('cash plan', () => {
  it('splits a full payment into tax, costs, pool, reserve and profit that add up to the payment', () => {
    const { buckets } = planPayment({ amount_cents: 110_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, job });
    expect(buckets).toEqual({ sales_tax: 10_000, materials: 20_000, wages: 20_000, payroll_tax: 4_000, overhead: 6_000, p4p: 5_000, reserve: 3_000, profit: 42_000 });
    expect(sum(buckets)).toBe(110_000);
  });

  it('takes each cost in proportion when only part is paid, and always adds up exactly', () => {
    for (const amount of [11_000, 33_333, 55_001, 99_999]) {
      const { buckets } = planPayment({ amount_cents: amount, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, job });
      expect(sum(buckets)).toBe(amount);
    }
    const half = planPayment({ amount_cents: 55_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, job }).buckets;
    expect(half.sales_tax).toBe(5_000);
    expect(half.materials).toBe(10_000);
    expect(half.wages).toBe(10_000);
  });

  it('never sets aside a reserve the payment cannot cover, and says when it does not cover the costs', () => {
    const costly = { ...job, materials_cents: 95_000 };
    const plan = planPayment({ amount_cents: 110_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, job: costly });
    expect(plan.buckets.reserve).toBe(0);
    expect(plan.buckets.profit).toBeLessThan(0);
    expect(plan.notes.join(' ')).toMatch(/does not cover/);
    expect(sum(plan.buckets)).toBe(110_000);
  });

  it('puts all labor into wages when the company hourly cost is not used, and mentions it', () => {
    const plan = planPayment({ amount_cents: 110_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, job: { ...job, labor_method: 'person', labor: { wages_cents: 30_000, payroll_tax_cents: 0, overhead_cents: 0 } } });
    expect(plan.buckets.wages).toBe(30_000);
    expect(plan.notes.join(' ')).toMatch(/company hourly cost/);
  });

  it('sets aside only sales tax when there is no job, and reverses a refund', () => {
    const none = planPayment({ amount_cents: 11_000, invoice_total_cents: 11_000, invoice_tax_cents: 1_000, job: null });
    expect(none.buckets.sales_tax).toBe(1_000);
    expect(none.buckets.profit).toBe(10_000);
    const refund = planPayment({ amount_cents: -55_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, job });
    expect(sum(refund.buckets)).toBe(-55_000);
    expect(refund.buckets.sales_tax).toBe(-5_000);
  });

  it('adds payments together', () => {
    const a = planPayment({ amount_cents: 55_000, invoice_total_cents: 110_000, invoice_tax_cents: 10_000, job });
    const total = addPlans([a, a]);
    expect(sum(total)).toBe(110_000);
    expect(total.sales_tax).toBe(10_000);
  });
});

import { createRuntime } from '../src/core';
import { cashplanModule, listMoves, moveStatus } from '../src/modules/cashplan';

describe('ticking off the week\'s transfers', () => {
  it('remembers a tick with its amount, replaces it when ticked again, removes it when unticked, and only owners and admins tick', async () => {
    const rt = createRuntime();
    cashplanModule.register({ actions: rt.actions, events: rt.events });
    const as = (role: 'owner' | 'office') => ({ companyId: 'coMoves', actor: { kind: 'user' as const, id: `u-${role}` }, role });
    const tick = { week_start: '2027-01-04', bucket: 'wages', amount_cents: 120_000, moved: true };
    expect((await rt.actions.executeByName('cashplan.set_moved', tick, as('office'))).status).toBe('denied');
    expect((await rt.actions.executeByName('cashplan.set_moved', tick, as('owner'))).status).toBe('ok');
    expect(await listMoves('coMoves')).toMatchObject([{ week_start: '2027-01-04', bucket: 'wages', amount_cents: 120_000 }]);
    await rt.actions.executeByName('cashplan.set_moved', { ...tick, amount_cents: 150_000 }, as('owner'));
    expect(await listMoves('coMoves')).toHaveLength(1); // replaced, not doubled
    expect((await listMoves('coMoves'))[0].amount_cents).toBe(150_000);
    await rt.actions.executeByName('cashplan.set_moved', { ...tick, moved: false }, as('owner'));
    expect(await listMoves('coMoves')).toHaveLength(0);
  });

  it('says whether a transfer was made and whether the plan changed afterward', () => {
    expect(moveStatus(100, undefined)).toEqual({ state: 'not_moved' });
    expect(moveStatus(100, { amount_cents: 100, moved_on: '2027-01-10' })).toEqual({ state: 'moved', moved_on: '2027-01-10' });
    expect(moveStatus(130, { amount_cents: 100, moved_on: '2027-01-10' })).toEqual({ state: 'changed', moved_on: '2027-01-10', moved_cents: 100 });
  });
});
