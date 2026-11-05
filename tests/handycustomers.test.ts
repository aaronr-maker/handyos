import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule, listAllContacts, listAllProperties, getCustomer } from '../src/modules/customers';
import type { Refs } from '../src/modules/handy/chat';
import { describeAction, runActionTool, runReadTool, type ToolContext } from '../src/modules/handy/tools';

let n = 0;
const none: Refs = () => null;

async function setup() {
  const co = `coCust${++n}`;
  const rt = createRuntime();
  customersModule.register({ actions: rt.actions, events: rt.events });
  const owner = { companyId: co, actor: { kind: 'user' as const, id: 'boss' }, role: 'owner' as const };
  const call = async <T,>(name: string, input: unknown) => ((await rt.actions.executeByName(name, input, owner)) as { output: T }).output;
  const pat = await call<{ id: string }>('customers.create', { first_name: 'Pat', last_name: 'Miller', phone: '5125550147', email: 'pat@example.com' });
  const prop = await call<{ id: string }>('customers.add_property', { owner_id: pat.id, address_line1: '123 Oak Street', city: 'Austin', state: 'TX', postal_code: '78701' });
  const contact = await call<{ id: string }>('customers.add_contact', { customer_id: pat.id, first_name: 'Dana', last_name: 'Miller', phone: '5125550199', email: null });
  const ctx: ToolContext = { companyId: co, team: [] };
  const asPerson = async (action: string, input: unknown) => {
    const r = await rt.actions.executeByName(action, input, owner);
    return { status: r.status, message: r.status === 'error' ? r.message : r.status === 'denied' ? r.reason : r.status === 'invalid' ? r.issues.join('; ') : undefined };
  };
  const refs = (key: string, kind: 'customer' | 'contact' | 'property', id: string): Refs => (k) => (k === key ? { kind, id } : null);
  const run = (name: string, args: Record<string, unknown>, r: Refs = none) => runActionTool(ctx, async () => ({ status: 'ok' }), name, args, { refs: r, asPerson });
  return { co, rt, ctx, pat, prop, contact, run, refs };
}

describe('Handy as the office assistant for customer records', () => {
  it('shows the old and new value of each change on the card, and saves them as the person', async () => {
    const w = await setup();
    const args = { customer: 'Pat Miller', last_name: 'Miller-Jones', email: 'pat.new@example.com', notes: 'Prefers texts' };
    const card = await describeAction(w.ctx, 'update_customer', args, w.refs('customer', 'customer', w.pat.id));
    expect(card.text).toContain('last name: Miller → Miller-Jones');
    expect(card.text).toContain('email: pat@example.com → pat.new@example.com');
    expect(card.text).toContain('notes: (none) → Prefers texts');
    expect(await w.run('update_customer', args, w.refs('customer', 'customer', w.pat.id))).toMatch(/3 changes saved/);
    expect(await getCustomer(w.co, w.pat.id)).toMatchObject({ last_name: 'Miller-Jones', email: 'pat.new@example.com', notes: 'Prefers texts', phone: '5125550147', first_name: 'Pat' }); // the rest is untouched
  });

  it('can clear a field, and refuses a bad email, a short phone, or nothing to change', async () => {
    const w = await setup();
    const r = w.refs('customer', 'customer', w.pat.id);
    await w.run('update_customer', { customer: 'x', phone: '' }, r);
    expect((await getCustomer(w.co, w.pat.id))?.phone).toBeNull();
    await expect(w.run('update_customer', { customer: 'x', email: 'not-an-email' }, r)).rejects.toThrow(/does not look like an email/);
    await expect(w.run('update_customer', { customer: 'x', phone: '12345' }, r)).rejects.toThrow(/full phone number/);
    await expect(describeAction(w.ctx, 'update_customer', { customer: 'x' }, r)).rejects.toThrow(/Nothing to change/);
  });

  it('creates a customer, adds and changes contacts, and corrects an address', async () => {
    const w = await setup();
    expect(await w.run('create_customer', { first_name: 'Sue', last_name: 'Lopez', email: 'sue@example.com' })).toMatch(/Added Sue Lopez/);
    expect((await runReadTool(w.ctx, 'find_customer', { query: 'lopez' }, none)) as unknown[]).toHaveLength(1);
    await expect(w.run('create_customer', { email: 'x@y.com' })).rejects.toThrow(/needs a name/);

    const r = w.refs('customer', 'customer', w.pat.id);
    expect(await w.run('add_customer_contact', { customer: 'x', first_name: 'Sam', last_name: 'Miller', phone: '512-555-0123' }, r)).toMatch(/Added a contact/);
    expect((await listAllContacts(w.co)).filter((k) => k.customer_id === w.pat.id).map((k) => k.name).sort()).toEqual(['Dana Miller', 'Sam Miller']);
    await w.run('update_contact', { customer: 'x', contact: 'Dana Miller', email: 'dana@example.com' }, r);
    expect((await listAllContacts(w.co)).find((k) => k.id === w.contact.id)).toMatchObject({ email: 'dana@example.com', phone: '5125550199', first_name: 'Dana' });
    await expect(w.run('update_contact', { customer: 'x', contact: 'Nobody' }, r)).rejects.toThrow(/no contact like that/);

    const card = await describeAction(w.ctx, 'update_address', { property: 'x', address_line1: '125 Oak Street' }, w.refs('property', 'property', w.prop.id));
    expect(card.text).toContain('street: 123 Oak Street → 125 Oak Street');
    await w.run('update_address', { property: 'x', address_line1: '125 Oak Street', postal_code: '78702' }, w.refs('property', 'property', w.prop.id));
    expect((await listAllProperties(w.co))[0]).toMatchObject({ address_line1: '125 Oak Street', postal_code: '78702', city: 'Austin' });
  });

  it('looks up details and properties without ever returning a phone number, email or full contact', async () => {
    const w = await setup();
    const details = JSON.stringify(await runReadTool(w.ctx, 'customer_details', { customer: 'x' }, w.refs('customer', 'customer', w.pat.id)));
    expect(details).toContain('Dana Miller');
    expect(details).toContain('123 Oak Street');
    expect(details).not.toMatch(/5125550|@example/);
    const found = (await runReadTool(w.ctx, 'find_property', { query: 'oak' }, none)) as { property: string; owner: string }[];
    expect(found).toEqual([{ property: '123 Oak Street', city: 'Austin', owner: 'Pat Miller' }]);
    await expect(runReadTool(w.ctx, 'find_property', { query: 'oa' }, none)).rejects.toThrow(/street address/);
  });

  it('is saved by the person: as an AI agent the same change would wait for approval', async () => {
    const w = await setup();
    const agent = await w.rt.actions.executeByName('customers.update', { customer_id: w.pat.id, first_name: 'Pat', last_name: 'Changed', display_name_source: 'person', is_property_manager: false }, { companyId: w.co, actor: { kind: 'agent', id: 'handy' }, onBehalfOf: { userId: 'boss', role: 'owner' } });
    expect(agent.status).toBe('pending_approval');
    expect((await getCustomer(w.co, w.pat.id))?.last_name).toBe('Miller');
  });
});
