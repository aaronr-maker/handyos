import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule } from '../src/modules/customers';
import { computeTotals, estimatesModule, getEstimate } from '../src/modules/estimates';
import { jobsModule, listJobs } from '../src/modules/jobs';

describe('estimate totals', () => {
  it('rounds line totals, taxes only taxable lines, and uses basis points', () => {
    const t = computeTotals(
      [
        { quantity: 2, unit_price_cents: 9500, taxable: false }, // labor 190.00, not taxable
        { quantity: 3, unit_price_cents: 1999, taxable: true }, // 59.97 taxable
        { quantity: 0.5, unit_price_cents: 333, taxable: true }, // 1.665 -> 167 cents (rounded), taxable
      ],
      825,
    );
    expect(t.subtotal_cents).toBe(19000 + 5997 + 167);
    expect(t.tax_cents).toBe(Math.round(((5997 + 167) * 825) / 10000));
    expect(t.total_cents).toBe(t.subtotal_cents + t.tax_cents);
    expect(computeTotals([], 825)).toEqual({ subtotal_cents: 0, tax_cents: 0, total_cents: 0 });
  });
});

describe('estimates', () => {
  const setup = () => {
    const rt = createRuntime();
    for (const m of [customersModule, estimatesModule, jobsModule]) m.register({ actions: rt.actions, events: rt.events });
    const caller = { companyId: 'coEst', actor: { kind: 'user', id: 'u' } as const };
    const run = async (name: string, input: unknown, c: { companyId: string; actor: { kind: 'user' | 'agent' | 'system'; id: string } } = caller) =>
      rt.actions.executeByName(name, input, c);
    const out = <T>(r: unknown) => (r as { output: T }).output;
    return { rt, run, out, caller };
  };
  const line = { description: 'Labor', quantity: 2, unit: 'hour', unit_price_cents: 9500, unit_cost_cents: 3500, taxable: false };

  it('bills a managed rental to the manager (owed by the owner), numbers estimates, and creates a job on approval', async () => {
    const { run, out } = setup();
    const mgr = out<{ id: string }>(await run('customers.create', { company_name: 'Acme PM', is_property_manager: true }));
    const owner = out<{ id: string }>(await run('customers.create', { first_name: 'Olivia', last_name: 'Owner' }));
    const prop = out<{ id: string }>(await run('customers.add_property', { owner_id: owner.id, manager_id: mgr.id, address_line1: '12 Oak St' }));

    const created = await run('estimates.create', { property_id: prop.id, title: 'Fix gate', line_items: [line] });
    expect(created.status, JSON.stringify(created)).toBe('ok');
    const est = out<{ id: string; estimate_number: number; customer_id: string; owed_by_customer_id: string; total_cents: number; status: string }>(created);
    expect(est).toMatchObject({ customer_id: mgr.id, owed_by_customer_id: owner.id, total_cents: 19000, status: 'draft', estimate_number: 1001 });
    const second = out<{ estimate_number: number }>(await run('estimates.create', { property_id: prop.id, title: 'Second', line_items: [line] }));
    expect(second.estimate_number).toBe(1002);

    // draft -> sent -> approved; approval creates a job at the same property
    expect((await run('estimates.approve', { estimate_id: est.id })).status).toBe('error'); // not sent yet
    expect((await run('estimates.send', { estimate_id: est.id })).status).toBe('ok');
    expect((await run('estimates.update', { estimate_id: est.id, property_id: prop.id, title: 'Changed', line_items: [line] })).status).toBe('error'); // sent: locked
    expect((await run('estimates.approve', { estimate_id: est.id })).status).toBe('ok');
    const jobs = await listJobs('coEst');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: 'Fix gate', property_id: prop.id, customer_id: mgr.id, estimate_id: est.id });
    expect((await getEstimate('coEst', est.id))!.approved_at).not.toBeNull();
  });

  it('with no owner listed the manager owes it; with no manager the owner is billed; plain customers work', async () => {
    const { run, out } = setup();
    const mgr = out<{ id: string }>(await run('customers.create', { company_name: 'Acme PM', is_property_manager: true }));
    const owner = out<{ id: string }>(await run('customers.create', { first_name: 'Sole', last_name: 'Owner' }));
    const noOwner = out<{ id: string }>(await run('customers.add_property', { manager_id: mgr.id, address_line1: '1 Rental Rd' }));
    const own = out<{ id: string }>(await run('customers.add_property', { owner_id: owner.id, address_line1: '2 Home St' }));

    const a = out<{ customer_id: string; owed_by_customer_id: string }>(await run('estimates.create', { property_id: noOwner.id, title: 'A', line_items: [line] }));
    expect(a).toMatchObject({ customer_id: mgr.id, owed_by_customer_id: mgr.id });
    const b = out<{ customer_id: string; owed_by_customer_id: string }>(await run('estimates.create', { property_id: own.id, title: 'B', line_items: [line] }));
    expect(b).toMatchObject({ customer_id: owner.id, owed_by_customer_id: owner.id });
    const c = out<{ customer_id: string; property_id: string | null }>(await run('estimates.create', { customer_id: owner.id, title: 'C', line_items: [line] }));
    expect(c).toMatchObject({ customer_id: owner.id, property_id: null });

    expect((await run('estimates.create', { title: 'No one', line_items: [line] })).status).toBe('invalid');
    expect((await run('estimates.create', { customer_id: owner.id, title: 'No lines', line_items: [] })).status).toBe('invalid');
  });

  it('setting the first owner of a managed rental keeps the manager; replacing an owner (a sale) ends management', async () => {
    const { run, out } = setup();
    const mgr = out<{ id: string }>(await run('customers.create', { company_name: 'Acme PM', is_property_manager: true }));
    const o1 = out<{ id: string }>(await run('customers.create', { first_name: 'First', last_name: 'Owner' }));
    const o2 = out<{ id: string }>(await run('customers.create', { first_name: 'Buyer', last_name: 'Two' }));
    const prop = out<{ id: string }>(await run('customers.add_property', { manager_id: mgr.id, address_line1: '1 Rental Rd' }));
    const { getPropertyBilling } = await import('../src/modules/customers');
    await run('customers.change_owner', { property_id: prop.id, new_owner_id: o1.id });
    expect(await getPropertyBilling('coEst', prop.id)).toEqual({ billToId: mgr.id, owedById: o1.id });
    await run('customers.change_owner', { property_id: prop.id, new_owner_id: o2.id });
    expect(await getPropertyBilling('coEst', prop.id)).toEqual({ billToId: o2.id, owedById: o2.id });
  });

  it('keeps estimate numbers separate per company and requires approval for AI sending', async () => {
    const { run, out, rt } = setup();
    const a = out<{ id: string }>(await run('customers.create', { first_name: 'A' }));
    const e1 = out<{ id: string; estimate_number: number }>(await run('estimates.create', { customer_id: a.id, title: 'T', line_items: [line] }));
    const other = { companyId: 'coEst2', actor: { kind: 'user', id: 'u' } as const };
    const b = out<{ id: string }>(await run('customers.create', { first_name: 'B' }, other));
    const e2 = out<{ estimate_number: number }>(await run('estimates.create', { customer_id: b.id, title: 'T', line_items: [line] }, other));
    expect(e2.estimate_number).toBe(1001); // its own sequence, not 1002
    const byAgent = await rt.actions.executeByName('estimates.send', { estimate_id: e1.id }, { companyId: 'coEst', actor: { kind: 'agent', id: 'a' } });
    expect(byAgent.status).toBe('pending_approval');
  });
});
