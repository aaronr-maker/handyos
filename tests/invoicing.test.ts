import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule } from '../src/modules/customers';
import { estimatesModule } from '../src/modules/estimates';
import { getInvoice, invoicingModule, listInvoices } from '../src/modules/invoicing';
import { jobsModule } from '../src/modules/jobs';
import { listPaymentsFor, paymentsModule } from '../src/modules/payments';

type Caller = { companyId: string; actor: { kind: 'user' | 'agent' | 'system'; id: string } };

const setup = (co: string) => {
  const rt = createRuntime();
  for (const m of [customersModule, estimatesModule, jobsModule, invoicingModule, paymentsModule]) m.register({ actions: rt.actions, events: rt.events });
  const user: Caller = { companyId: co, actor: { kind: 'user', id: 'u1' } };
  const agent: Caller = { companyId: co, actor: { kind: 'agent', id: 'bot' } };
  const run = (name: string, input: unknown, c: Caller = user) => rt.actions.executeByName(name, input, c);
  const out = <T>(r: unknown) => (r as { output: T }).output;
  const line = { description: 'Labor', quantity: 2, unit: 'hour', unit_price_cents: 9500, unit_cost_cents: 3500, taxable: false };
  return { rt, run, out, user, agent, line };
};

const future = (days = 10) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

afterEach(() => vi.useRealTimers());

describe('invoices', () => {
  it('bills a managed rental to the manager (owed by the owner), numbers invoices, and locks them once sent', async () => {
    const { run, out, line } = setup('coInv1');
    const mgr = out<{ id: string }>(await run('customers.create', { company_name: 'Acme PM', is_property_manager: true }));
    const owner = out<{ id: string }>(await run('customers.create', { first_name: 'Olivia', last_name: 'Owner' }));
    const prop = out<{ id: string }>(await run('customers.add_property', { owner_id: owner.id, manager_id: mgr.id, address_line1: '12 Oak St' }));

    const r = await run('invoicing.create', { property_id: prop.id, title: 'Fix gate', line_items: [line], due_date: future() });
    expect(r.status, JSON.stringify(r)).toBe('ok');
    const inv = out<{ id: string; invoice_number: number; customer_id: string; owed_by_customer_id: string; total_cents: number; status: string }>(r);
    expect(inv).toMatchObject({ invoice_number: 1001, customer_id: mgr.id, owed_by_customer_id: owner.id, total_cents: 19000, status: 'draft' });
    expect((await run('invoicing.create', { customer_id: owner.id, title: 'x', line_items: [line] })).status).toBe('ok');
    expect((await listInvoices('coInv1')).map((i) => i.invoice_number)).toEqual([1002, 1001]);

    expect((await run('invoicing.send', { invoice_id: inv.id })).status).toBe('ok');
    expect((await run('invoicing.update', { invoice_id: inv.id, property_id: prop.id, title: 'Changed', line_items: [line] })).status).toBe('error');
    expect((await run('invoicing.create', { title: 'Nobody', line_items: [line] })).status).toBe('invalid');
  });

  it('creates an invoice from a job, copying the estimate lines, tax and billing', async () => {
    const { run, out, line } = setup('coInv2');
    const c = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }));
    const est = out<{ id: string }>(await run('estimates.create', { customer_id: c.id, title: 'Paint room', line_items: [{ ...line, taxable: true }], tax_rate_bps: 825 }));
    await run('estimates.send', { estimate_id: est.id });
    await run('estimates.approve', { estimate_id: est.id });
    const { listJobs } = await import('../src/modules/jobs');
    const job = (await listJobs('coInv2'))[0];
    const inv = out<{ title: string; total_cents: number; tax_rate_bps: number; job_id: string }>(await run('invoicing.create_from_job', { job_id: job.id }));
    expect(inv).toMatchObject({ title: 'Paint room', tax_rate_bps: 825, job_id: job.id, total_cents: 19000 + Math.round((19000 * 825) / 10000) });

    const manual = out<{ id: string }>(await run('jobs.create', { customer_id: c.id, title: 'No estimate' }));
    const noEst = await run('invoicing.create_from_job', { job_id: manual.id });
    expect((noEst as { message: string }).message).toContain('no estimate');
  });

  it('records payments, tracks the balance and status, rejects overpayment, and keeps a payment trail', async () => {
    const { run, out, line, agent } = setup('coInv3');
    const c = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }));
    const inv = out<{ id: string }>(await run('invoicing.create', { customer_id: c.id, title: 'Job', line_items: [line], due_date: future() }));

    // can't take money before it's sent
    expect((await run('payments.record', { invoice_id: inv.id, amount_cents: 1000, method: 'cash' })).status).toBe('error');
    await run('invoicing.send', { invoice_id: inv.id });
    expect((await run('payments.record', { invoice_id: inv.id, amount_cents: 20000, method: 'cash' })).status).toBe('error'); // more than owed
    expect((await run('payments.record', { invoice_id: inv.id, amount_cents: 0, method: 'cash' })).status).toBe('invalid');
    expect((await listPaymentsFor('coInv3', inv.id)).length).toBe(0); // bad payments were never saved

    // an AI agent can propose a payment but a person has to confirm it
    const proposed = await run('payments.record', { invoice_id: inv.id, amount_cents: 5000, method: 'check' }, agent);
    expect(proposed.status).toBe('pending_approval');
    expect((await getInvoice('coInv3', inv.id))!.amount_paid_cents).toBe(0);

    expect((await run('payments.record', { invoice_id: inv.id, amount_cents: 5000, method: 'check', note: 'Check #1' })).status).toBe('ok');
    let now = (await getInvoice('coInv3', inv.id))!;
    expect([now.amount_paid_cents, now.status]).toEqual([5000, 'sent']);
    expect((await run('payments.record', { invoice_id: inv.id, amount_cents: 14000, method: 'cash' })).status).toBe('ok');
    now = (await getInvoice('coInv3', inv.id))!;
    expect([now.amount_paid_cents, now.status]).toEqual([19000, 'paid']);
    expect(now.paid_at).not.toBeNull();

    // refunds: an owner can refund (the invoice reopens); an AI agent can only propose one
    const proposal = await run('payments.refund', { invoice_id: inv.id, amount_cents: 4000, reason: 'Goodwill' }, agent);
    expect(proposal.status).toBe('pending_approval');
    expect((await getInvoice('coInv3', inv.id))!.status).toBe('paid');
    const refund = await run('payments.refund', { invoice_id: inv.id, amount_cents: 4000, reason: 'Goodwill' });
    expect(refund.status, JSON.stringify(refund)).toBe('ok');
    now = (await getInvoice('coInv3', inv.id))!;
    expect([now.amount_paid_cents, now.status]).toEqual([15000, 'sent']);
    expect(now.paid_at).toBeNull();
    expect((await listPaymentsFor('coInv3', inv.id)).map((p) => p.amount_cents).sort((a, b) => a - b)).toEqual([-4000, 5000, 14000]);
  });

  it('flags overdue invoices, announces them, and will not void an invoice that has payments', async () => {
    const { rt, run, out, line, user } = setup('coInv4');
    const c = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }));
    const overdue: unknown[] = [];
    rt.events.on('invoice.overdue', (e) => void overdue.push(e.payload));

    const late = out<{ id: string }>(await run('invoicing.create', { customer_id: c.id, title: 'Late', line_items: [line], due_date: future(5) }));
    const onTime = out<{ id: string }>(await run('invoicing.create', { customer_id: c.id, title: 'Fine', line_items: [line], due_date: future(30) }));
    await run('invoicing.create', { customer_id: c.id, title: 'Draft', line_items: [line], due_date: future(5) });
    await run('invoicing.send', { invoice_id: late.id });
    await run('invoicing.send', { invoice_id: onTime.id });
    expect((await run('invoicing.check_overdue', {})).status).toBe('ok');
    expect(overdue).toHaveLength(0); // nothing is late yet

    // ten days pass: only the one due in 5 days is late (drafts are never flagged)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 10 * 86_400_000));
    expect((await run('invoicing.flag_overdue', { invoice_id: onTime.id })).status).toBe('error'); // not due yet
    const sweep = await run('invoicing.check_overdue', {});
    expect(out<{ flagged: number }>(sweep).flagged).toBe(1);
    expect((await getInvoice('coInv4', late.id))!.status).toBe('overdue');
    expect((await getInvoice('coInv4', onTime.id))!.status).toBe('sent');
    expect(overdue).toHaveLength(1);
    expect(out<{ flagged: number }>(await run('invoicing.check_overdue', {})).flagged).toBe(0); // already flagged

    // paying an overdue invoice in full marks it paid; a paid invoice can't be voided
    await run('payments.record', { invoice_id: late.id, amount_cents: 19000, method: 'check' });
    expect((await getInvoice('coInv4', late.id))!.status).toBe('paid');
    expect((await run('invoicing.void', { invoice_id: late.id, reason: 'oops' })).status).toBe('error');
    // voiding an unpaid invoice works, and an agent's void waits for approval
    expect((await run('invoicing.void', { invoice_id: onTime.id, reason: 'Duplicate' }, { ...user, actor: { kind: 'agent', id: 'bot' } })).status).toBe('pending_approval');
    expect((await run('invoicing.void', { invoice_id: onTime.id, reason: 'Duplicate' })).status).toBe('ok');
    expect((await getInvoice('coInv4', onTime.id))!.status).toBe('void');
  });
});

describe('roles', () => {
  it('keeps techs out of billing, limits refunds and price changes to owners/admins, and only owners/admins approve', async () => {
    const { rt, run, out, line } = setup('coRoles');
    const as = (role: 'owner' | 'admin' | 'office' | 'tech'): Caller & { role: typeof role } => ({ companyId: 'coRoles', actor: { kind: 'user', id: `u-${role}` }, role });
    const c = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }, as('office')));

    // techs can't create invoices or estimates, or take payments
    const denied = await run('invoicing.create', { customer_id: c.id, title: 'x', line_items: [line] }, as('tech'));
    expect(denied.status).toBe('denied');
    expect((denied as { reason: string }).reason).toContain('tech');
    expect((await run('estimates.create', { customer_id: c.id, title: 'x', line_items: [line] }, as('tech'))).status).toBe('denied');
    // ...but can do their own work: jobs and the time clock
    const job = out<{ id: string }>(await run('jobs.create', { customer_id: c.id, title: 'Work' }, as('tech')));
    expect((await run('jobs.clock_in', { job_id: job.id }, as('tech'))).status).toBe('ok');

    // office can invoice and take payments, but only owner/admin can refund or change prices
    const inv = out<{ id: string }>(await run('invoicing.create', { customer_id: c.id, title: 'x', line_items: [line], due_date: future() }, as('office')));
    await run('invoicing.send', { invoice_id: inv.id }, as('office'));
    expect((await run('payments.record', { invoice_id: inv.id, amount_cents: 5000, method: 'cash' }, as('office'))).status).toBe('ok');
    expect((await run('payments.refund', { invoice_id: inv.id, amount_cents: 1000, reason: 'r' }, as('office'))).status).toBe('denied');
    expect((await run('payments.refund', { invoice_id: inv.id, amount_cents: 1000, reason: 'r' }, as('admin'))).status).toBe('ok');
    const item = out<{ id: string }>(await run('estimates.add_price_item', { name: 'Gate', unit_price_cents: 9500 }, as('office')));
    expect((await run('estimates.update_price_item', { item_id: item.id, name: 'Gate', unit_price_cents: 100 }, as('office'))).status).toBe('denied');
    expect((await run('estimates.update_price_item', { item_id: item.id, name: 'Gate', unit_price_cents: 10000 }, as('owner'))).status).toBe('ok');

    // a tech can't approve an AI agent's request; an admin can
    const agent: Caller = { companyId: 'coRoles', actor: { kind: 'agent', id: 'bot' } };
    const pending = await run('customers.delete', { customer_id: c.id }, agent);
    expect(pending.status).toBe('pending_approval');
    const id = (pending as { approvalId: string }).approvalId;
    expect((await rt.actions.decide(id, true, { kind: 'user', id: 'u-tech' }, 'tech')).status).toBe('denied');
    expect((await rt.actions.decide(id, true, { kind: 'user', id: 'u-admin' }, 'admin')).status).toBe('ok');
  });
});
