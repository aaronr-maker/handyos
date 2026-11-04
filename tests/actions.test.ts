import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createActionRegistry, createEventBus, createMemoryAuditLog, createRuntime, defineAction } from '../src/core';

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

describe('deleting a customer', () => {
  it('only deletes customers with no addresses, removes their contacts, and needs approval for AI agents', async () => {
    const { createRuntime } = await import('../src/core');
    const { customersModule, getCustomer } = await import('../src/modules/customers');
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const caller = { companyId: 'coDel', actor: user };
    const run = async (name: string, input: unknown, c: { companyId: string; actor: { kind: 'user' | 'agent' | 'system'; id: string } } = caller) =>
      rt.actions.executeByName(name, input, c);
    const out = (r: unknown) => (r as { output: { id: string } }).output;

    const plain = out(await run('customers.create', { first_name: 'No', last_name: 'Address' }));
    await run('customers.add_contact', { customer_id: plain.id, first_name: 'Extra' });
    const withAddr = out(await run('customers.create', { first_name: 'Has', last_name: 'Address' }));
    await run('customers.add_property', { owner_id: withAddr.id, address_line1: '1 Main' });

    // blocked while they have an address
    const blocked = await run('customers.delete', { customer_id: withAddr.id });
    expect(blocked.status).toBe('error');
    expect((blocked as { message: string }).message).toContain('still has addresses');
    expect(await getCustomer('coDel', withAddr.id)).toBeDefined();

    // an AI agent's delete waits for approval; nothing is deleted yet
    const byAgent = await run('customers.delete', { customer_id: plain.id }, { companyId: 'coDel', actor: agent });
    expect(byAgent.status).toBe('pending_approval');
    expect(await getCustomer('coDel', plain.id)).toBeDefined();

    // a person can delete a customer with no addresses
    expect((await run('customers.delete', { customer_id: plain.id })).status).toBe('ok');
    expect(await getCustomer('coDel', plain.id)).toBeUndefined();

    // an owner whose address moved away is still blocked, because the history needs them
    const buyer = out(await run('customers.create', { first_name: 'Buyer' }));
    const prop = out(await run('customers.add_property', { owner_id: withAddr.id, address_line1: '2 Main' }));
    await run('customers.change_owner', { property_id: prop.id, new_owner_id: buyer.id });
    const lone = out(await run('customers.create', { first_name: 'Past', last_name: 'Owner' }));
    const prop2 = out(await run('customers.add_property', { owner_id: lone.id, address_line1: '3 Main' }));
    await run('customers.change_owner', { property_id: prop2.id, new_owner_id: buyer.id });
    const past = await run('customers.delete', { customer_id: lone.id });
    expect((past as { message: string }).message).toContain('linked to an address before');
  });
});

describe('merging duplicate customers', () => {
  it('moves contacts and addresses, fills blanks, keeps the other phone, remembers its old id, and tells other modules', async () => {
    const { createRuntime } = await import('../src/core');
    const { customersModule, getCustomer, listCustomers } = await import('../src/modules/customers');
    const { findDuplicateGroups } = await import('../src/modules/customers/duplicates');
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const caller = { companyId: 'coMerge', actor: user };
    const run = async (name: string, input: unknown) => rt.actions.executeByName(name, input, caller);
    const merged: unknown[] = [];
    rt.events.on('customer.merged', (e) => void merged.push(e.payload));

    await run('customers.import', {
      rows: [
        { external_ref: 'hcp:1', first_name: 'Pat', last_name: 'Rivera', phone: '5550100' },
        { external_ref: 'hcp:2', first_name: 'Pat', last_name: 'Rivera', email: 'pat@example.com', phone: '5550199', notes: 'Likes mornings', addresses: [{ address_line1: '12 Oak St' }] },
      ],
    });
    const all = await listCustomers('coMerge');
    const keep = all.find((c) => c.external_ref === 'hcp:1')!;
    const dup = all.find((c) => c.external_ref === 'hcp:2')!;
    await run('customers.add_contact', { customer_id: dup.id, first_name: 'Sam' });

    // the duplicate finder suggests them (same name)
    const groups = findDuplicateGroups(all);
    expect(groups.some((g) => g.customers.length === 2 && g.reasons.includes('same name'))).toBe(true);

    const res = await run('customers.merge', { keep_id: keep.id, merge_id: dup.id });
    expect(res.status, JSON.stringify(res)).toBe('ok');
    expect(await getCustomer('coMerge', dup.id)).toBeUndefined();
    const k = (await getCustomer('coMerge', keep.id))!;
    expect(k.email).toBe('pat@example.com'); // blank filled from the duplicate
    expect(k.phone).toBe('5550100'); // kept customer's own phone wins
    expect(k.notes).toContain('Likes mornings');
    expect(k.merged_external_refs).toEqual(['hcp:2']);
    expect(merged).toEqual([{ fromId: dup.id, intoId: keep.id }]);

    // the duplicate's different phone is kept as an additional contact, its own contact moved over, address moved
    const { listAllContacts, listProperties } = await import('../src/modules/customers/services/customerService');
    const contacts = (await listAllContacts('coMerge')).filter((c) => c.customer_id === keep.id);
    expect(contacts.map((c) => c.phone ?? c.name).sort()).toEqual(['5550199', 'Sam']);
    expect((await listProperties('coMerge', keep.id)).map((p) => p.address_line1)).toEqual(['12 Oak St']);

    // re-importing the old file does not bring the merged customer back
    const again = await run('customers.import', { rows: [{ external_ref: 'hcp:2', first_name: 'Pat', last_name: 'Rivera' }] });
    expect((again as { output: { created: number } }).output.created).toBe(0);

    // can't merge a customer into itself; AI agents need approval
    expect((await run('customers.merge', { keep_id: keep.id, merge_id: keep.id })).status).toBe('error');
    const byAgent = await rt.actions.executeByName('customers.merge', { keep_id: keep.id, merge_id: keep.id }, { companyId: 'coMerge', actor: agent });
    expect(byAgent.status).toBe('pending_approval');
  });
});

describe('Handy acting for a person', () => {
  const co = 'coHandy';
  const noop = (name: string, extra: Record<string, unknown>) =>
    defineAction({ name, module: 'jobs', description: name, input: z.object({}), risk: 'low', requiresApproval: false, handler: async (_i, ctx) => ({ role: ctx.role ?? null }), ...extra });
  const setup = () => {
    const rt = createRuntime();
    rt.actions.register(noop('t.owner_only', { roles: ['owner'], handy: 'auto' }));
    rt.actions.register(noop('t.auto', { handy: 'auto' }));
    rt.actions.register(noop('t.default', {}));
    rt.actions.register(noop('t.never', { handy: 'never' }));
    return rt;
  };
  const handyFor = (role: 'owner' | 'office') => ({ companyId: co, actor: { kind: 'agent' as const, id: 'handy' }, onBehalfOf: { userId: `u-${role}`, role } });

  it('is held to the role of the person he works for', async () => {
    const rt = setup();
    expect((await rt.actions.executeByName('t.owner_only', {}, handyFor('office'))).status).toBe('denied');
    const asOwner = await rt.actions.executeByName('t.owner_only', {}, handyFor('owner'));
    expect(asOwner).toMatchObject({ status: 'ok', output: { role: 'owner' } });
  });

  it('does what is marked auto, asks first by default, and never does what is marked never', async () => {
    const rt = setup();
    expect((await rt.actions.executeByName('t.auto', {}, handyFor('office'))).status).toBe('ok');
    const asked = await rt.actions.executeByName('t.default', {}, handyFor('owner'));
    expect(asked.status).toBe('pending_approval');
    expect((await rt.actions.executeByName('t.never', {}, handyFor('owner'))).status).toBe('denied');
    // a person is not held back by Handy's levels
    expect((await rt.actions.executeByName('t.never', {}, { companyId: co, actor: { kind: 'user', id: 'u1' }, role: 'owner' })).status).toBe('ok');
    // an owner approves, and it then runs for the person Handy was working for
    const id = (asked as { approvalId: string }).approvalId;
    expect((await rt.actions.decide(id, true, { kind: 'user', id: 'boss' }, 'owner')).status).toBe('ok');
  });

  it('names both Handy and the person in the audit trail', async () => {
    const rt = setup();
    await rt.actions.executeByName('t.auto', {}, handyFor('owner'));
    expect(rt.audit.entries().some((e) => e.action === 't.auto' && e.actor_kind === 'agent' && e.actor_id === 'handy/for:u-owner' && e.outcome === 'ok')).toBe(true);
  });
});
