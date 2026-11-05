import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule } from '../src/modules/customers';
import { listMessages, messagingModule } from '../src/modules/messaging';
import { executeToolCall, type TurnDeps } from '../src/modules/handy/chat';
import { createMasker } from '../src/modules/handy/mask';
import { describeAction, runActionTool, type ToolContext } from '../src/modules/handy/tools';

const co = 'coMsg';

async function setup() {
  const rt = createRuntime();
  for (const m of [customersModule, messagingModule]) m.register({ actions: rt.actions, events: rt.events });
  const owner = { companyId: co, actor: { kind: 'user' as const, id: 'boss' }, role: 'owner' as const };
  const make = async (input: Record<string, unknown>) => ((await rt.actions.executeByName('customers.create', input, owner)) as { output: { id: string; name: string } }).output;
  const pat = await make({ first_name: 'Pat', last_name: 'Miller', phone: '5125550147', email: 'pat@example.com' });
  const noPhone = await make({ first_name: 'Lee', last_name: 'Park', email: 'lee@example.com' });
  const ctx: ToolContext = { companyId: co, team: [] };
  const masker = createMasker([
    { kind: 'customer', id: pat.id, label: 'Pat Miller', aliases: ['Pat Miller'] },
    { kind: 'customer', id: noPhone.id, label: 'Lee Park', aliases: ['Lee Park'] },
  ]);
  const asPerson = async (action: string, input: unknown) => {
    const r = await rt.actions.executeByName(action, input, owner);
    return { status: r.status, message: r.status === 'error' ? r.message : r.status === 'denied' ? r.reason : undefined };
  };
  const asAgent = (action: string, input: unknown) => rt.actions.executeByName(action, input, { companyId: co, actor: { kind: 'agent', id: 'handy' }, onBehalfOf: { userId: 'boss', role: 'owner' } });
  return { rt, pat, noPhone, ctx, masker, asPerson, asAgent };
}

describe('Handy drafting a customer message', () => {
  it('resolves the customer from the ID Handy used, fills in the first name, and shows the words to be edited before anything is saved', async () => {
    const w = await setup();
    const args = { customer: 'Pat Miller', channel: 'sms', body: 'Hi {first_name}, we are running 30 minutes late.' };
    const d = await describeAction(w.ctx, 'send_message', args, () => w.masker.resolve(w.masker.mask('Pat Miller')));
    expect(d.text).toContain('Pat Miller');
    expect(d.text).toContain('5125550147'); // the person sees where it goes; Handy never did
    expect(d.edit).toEqual({ key: 'body', label: 'Message', value: 'Hi Pat, we are running 30 minutes late.' });
    expect(await listMessages(co, w.pat.id)).toHaveLength(0); // nothing is saved by drafting
  });

  it('saves it with the person as the sender, queued and honestly not delivered, using the words they approved', async () => {
    const w = await setup();
    const out = await runActionTool(w.ctx, async (a, i) => ({ status: (await w.asAgent(a, i)).status }), 'send_message', { customer: 'Pat Miller', channel: 'sms', body: 'Hi Pat, running late (edited).' }, { refs: () => ({ kind: 'customer', id: w.pat.id }), asPerson: w.asPerson });
    expect(out).toMatch(/NOT been delivered/);
    const saved = await listMessages(co, w.pat.id);
    expect(saved).toMatchObject([{ body: 'Hi Pat, running late (edited).', channel: 'sms', direction: 'outbound', status: 'queued', created_by: 'boss' }]);
  });

  it('refuses when the customer has no phone or email for that channel, or cannot be told apart', async () => {
    const w = await setup();
    await expect(describeAction(w.ctx, 'send_message', { customer: 'Lee Park', channel: 'sms', body: 'Hi' }, () => ({ kind: 'customer', id: w.noPhone.id }))).rejects.toThrow(/no phone number/);
    await expect(describeAction(w.ctx, 'send_message', { customer: 'Nobody Known', channel: 'sms', body: 'Hi' }, () => null)).rejects.toThrow(/could not tell/);
  });

  it('goes through the whole conversation step: the person can rewrite the words, and Handy only ever sees IDs', async () => {
    const w = await setup();
    const seen: string[] = [];
    const deps: TurnDeps = {
      masker: w.masker,
      system: '',
      tools: [],
      callModel: async () => ({ role: 'assistant', content: null }),
      runRead: async () => ({}),
      isAction: (n) => n === 'send_message',
      confirm: async (name, args, refs) => {
        const d = await describeAction(w.ctx, name, args, refs);
        return { overrides: { body: `${d.edit!.value} Thank you!` } }; // the person adds a line
      },
      runAction: (name, args, refs) => runActionTool(w.ctx, async (a, i) => ({ status: (await w.asAgent(a, i)).status }), name, args, { refs, asPerson: w.asPerson }),
    };
    const id = 'C-' + w.pat.id.replace(/-/g, '').slice(0, 8).toUpperCase();
    const r = await executeToolCall('send_message', JSON.stringify({ customer: id, channel: 'sms', body: 'Hi {first_name}, we are on our way.' }), deps);
    seen.push(r.result);
    expect(r.action).toMatch(/Saved the text to Pat Miller/);
    expect((await listMessages(co, w.pat.id))[0].body).toBe('Hi Pat, we are on our way. Thank you!');
    expect(seen.join(' ')).not.toContain('Pat Miller'); // what goes back to Handy is masked
    expect(seen.join(' ')).toContain(id);
  });

  it('is never run by Handy himself: as an agent it waits for approval, and a person is not blocked', async () => {
    const w = await setup();
    const asked = await w.asAgent('messaging.send', { customer_id: w.pat.id, channel: 'sms', body: 'Hi' });
    expect(asked.status).toBe('pending_approval');
    expect(await listMessages(co, w.pat.id)).toHaveLength(0);
  });
});
