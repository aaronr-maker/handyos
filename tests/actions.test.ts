import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createActionRegistry, createEventBus, createMemoryAuditLog, defineAction } from '../src/core';

function setup() {
  const events = createEventBus();
  const audit = createMemoryAuditLog();
  const actions = createActionRegistry({ events, audit });
  let ran = 0;
  actions.register(
    defineAction({
      name: 'jobs.create',
      module: 'jobs',
      description: 'test',
      input: z.object({ title: z.string().min(1) }),
      risk: 'low',
      requiresApproval: false,
      async handler(input, ctx) {
        ran++;
        await ctx.events.emit(ctx.companyId, 'job.created', { jobId: 'j1', customerId: 'c1' });
        return input.title;
      },
    }),
  );
  actions.register(
    defineAction({
      name: 'invoicing.void',
      module: 'invoicing',
      description: 'test',
      input: z.object({ id: z.string() }),
      risk: 'high',
      requiresApproval: true,
      async handler() {
        ran++;
        return 'voided';
      },
    }),
  );
  return { events, audit, actions, ran: () => ran };
}

const user = { kind: 'user', id: 'u1' } as const;
const agent = { kind: 'agent', id: 'a1' } as const;

describe('action registry', () => {
  it('validates input, runs the handler, emits events and writes an audit entry', async () => {
    const { actions, audit, events } = setup();
    const seen: string[] = [];
    events.on('job.created', (e) => void seen.push(e.company_id));
    const res = await actions.executeByName('jobs.create', { title: 'Fix gate' }, { companyId: 'co1', actor: user });
    expect(res.status).toBe('ok');
    expect(seen).toEqual(['co1']);
    expect(audit.entries()[0]).toMatchObject({ action: 'jobs.create', outcome: 'ok', company_id: 'co1', actor_kind: 'user' });
  });

  it('rejects invalid input without running the handler, and logs it', async () => {
    const { actions, audit, ran } = setup();
    const res = await actions.executeByName('jobs.create', { title: '' }, { companyId: 'co1', actor: agent });
    expect(res.status).toBe('invalid');
    expect(ran()).toBe(0);
    expect(audit.entries()[0].outcome).toBe('invalid');
  });

  it('holds approval-required actions until a human approves', async () => {
    const { actions, ran } = setup();
    const res = await actions.executeByName('invoicing.void', { id: 'i1' }, { companyId: 'co1', actor: agent });
    expect(res.status).toBe('pending_approval');
    expect(ran()).toBe(0);
    const approvalId = (res as { approvalId: string }).approvalId;
    expect((await actions.decide(approvalId, true, agent)).status).toBe('denied'); // agents cannot self-approve
    expect(ran()).toBe(0);
    expect((await actions.decide(approvalId, true, user)).status).toBe('ok');
    expect(ran()).toBe(1);
    expect(actions.pendingApprovals('co1')).toHaveLength(0);
  });

  it('does not show one company another company\'s pending approvals', async () => {
    const { actions } = setup();
    await actions.executeByName('invoicing.void', { id: 'i1' }, { companyId: 'co1', actor: user });
    expect(actions.pendingApprovals('co2')).toHaveLength(0);
  });
});

describe('customer data changes by AI agents', () => {
  it('queues an agent edit for approval but lets a person edit directly', async () => {
    const { createRuntime } = await import('../src/core');
    const { customersModule } = await import('../src/modules/customers');
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const co = { companyId: 'co1' };
    const created = await rt.actions.executeByName('customers.create', { name: 'Pat' }, { ...co, actor: user });
    expect(created.status).toBe('ok');
    const id = (created as { output: { id: string } }).output.id;
    const body = { customer_id: id, name: 'Pat', phone: '555-9999' };
    const byAgent = await rt.actions.executeByName('customers.update', body, { ...co, actor: agent });
    expect(byAgent.status).toBe('pending_approval');
    const byUser = await rt.actions.executeByName('customers.update', body, { ...co, actor: user });
    expect(byUser.status).toBe('ok');
    // Approving the agent's request applies it and the audit log shows the agent as the requester.
    const approved = await rt.actions.decide((byAgent as { approvalId: string }).approvalId, true, user);
    expect(approved.status).toBe('ok');
    expect(rt.audit.entries().some((e) => e.action === 'customers.update' && e.actor_kind === 'agent' && e.outcome === 'ok')).toBe(true);
  });

  it('keeps one company\'s customers out of another company\'s view', async () => {
    const { createRuntime } = await import('../src/core');
    const { customersModule, listCustomers } = await import('../src/modules/customers');
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    await rt.actions.executeByName('customers.create', { name: 'Only A' }, { companyId: 'coA', actor: user });
    expect((await listCustomers('coB')).length).toBe(0);
    expect((await listCustomers('coA')).some((c) => c.name === 'Only A')).toBe(true);
  });
});

describe('property billing rule', () => {
  it('bills rentals to the manager, owed by the owner; manager owes when no owner; owner when unmanaged', async () => {
    const { billingFor } = await import('../src/modules/customers');
    const mgr = { role: 'manager', customer_id: 'M', ended_on: null } as const;
    expect(billingFor({ customer_id: 'O' }, [mgr])).toEqual({ billToId: 'M', owedById: 'O' });
    expect(billingFor({ customer_id: null }, [mgr])).toEqual({ billToId: 'M', owedById: 'M' });
    expect(billingFor({ customer_id: 'O' }, [])).toEqual({ billToId: 'O', owedById: 'O' });
    // a manager whose management ended (property sold / no longer a rental) is ignored
    expect(billingFor({ customer_id: 'O2' }, [{ ...mgr, ended_on: '2026-12-01' }])).toEqual({ billToId: 'O2', owedById: 'O2' });
    expect(billingFor({ customer_id: null }, [])).toBeNull();
  });

  it('walks a property through manager add, sale to a new owner, and billing change', async () => {
    const { createRuntime } = await import('../src/core');
    const { customersModule, getPropertyBilling } = await import('../src/modules/customers');
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const caller = { companyId: 'coBill', actor: user };
    const run = async (name: string, input: unknown) => {
      const r = await rt.actions.executeByName(name, input, caller);
      expect(r.status, JSON.stringify(r)).toBe('ok');
      return (r as { output: { id: string } }).output;
    };
    const mgr = await run('customers.create', { name: 'PM Co', is_property_manager: true });
    const owner1 = await run('customers.create', { name: 'Olivia' });
    const owner2 = await run('customers.create', { name: 'Buyer' });
    // managed rental, owner not listed yet: manager owes
    const prop = await run('customers.add_property', { manager_id: mgr.id, address_line1: '1 Main' });
    expect(await getPropertyBilling('coBill', prop.id)).toEqual({ billToId: mgr.id, owedById: mgr.id });
    // owner identified: still billed to the manager, labeled owed by the owner
    await run('customers.change_owner', { property_id: prop.id, new_owner_id: owner1.id, end_management: false });
    expect(await getPropertyBilling('coBill', prop.id)).toEqual({ billToId: mgr.id, owedById: owner1.id });
    // sold: new owner, management ends, billed directly to the new owner
    await run('customers.change_owner', { property_id: prop.id, new_owner_id: owner2.id });
    expect(await getPropertyBilling('coBill', prop.id)).toEqual({ billToId: owner2.id, owedById: owner2.id });
    // a property with neither owner nor manager is refused
    const bad = await rt.actions.executeByName('customers.add_property', { address_line1: 'Nowhere' }, caller);
    expect(bad.status).toBe('invalid');
  });
});

describe('names and main contact', () => {
  it('builds the full name from first + last, falls back to company, and refuses an empty name', async () => {
    const { createRuntime } = await import('../src/core');
    const { customersModule, getCustomer, customerLabel } = await import('../src/modules/customers');
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const caller = { companyId: 'coNames', actor: user };
    const create = async (input: unknown) => rt.actions.executeByName('customers.create', input, caller);

    const person = (await create({ first_name: 'Pat', last_name: 'Rivera' })) as { output: { id: string; name: string } };
    expect(person.output.name).toBe('Pat Rivera');

    const biz = (await create({ company_name: 'Acme Plumbing' })) as { output: { id: string; name: string } };
    expect(biz.output.name).toBe('Acme Plumbing');
    expect((await create({})).status).toBe('invalid');

    // custom / company display choices
    const both = (await create({ first_name: 'Sam', last_name: 'Lee', company_name: 'Lee Rentals', display_name_source: 'company' })) as { output: { id: string } };
    expect(customerLabel((await getCustomer('coNames', both.output.id))!)).toBe('Lee Rentals');

    // a company with no person: its first additional contact becomes the main contact automatically
    const r = await rt.actions.executeByName('customers.add_contact', { customer_id: biz.output.id, first_name: 'Dana', last_name: 'Cole' }, caller);
    const contactId = (r as { output: { id: string } }).output.id;
    expect((await getCustomer('coNames', biz.output.id))!.display_contact_id).toBe(contactId);
    // a person customer keeps themselves as main contact when a contact is added
    await rt.actions.executeByName('customers.add_contact', { customer_id: person.output.id, first_name: 'Kim' }, caller);
    expect((await getCustomer('coNames', person.output.id))!.display_contact_id).toBeNull();
  });
});
