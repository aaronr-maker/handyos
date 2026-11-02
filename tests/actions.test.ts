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
