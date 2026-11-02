import { describe, expect, it } from 'vitest';
import { centsToInput, createRuntime, formatMoney, parseMoney } from '../src/core';
import { estimatesModule, listPriceItems } from '../src/modules/estimates';

describe('money helpers', () => {
  it('formats, parses and round-trips amounts', () => {
    expect(formatMoney(12345)).toBe('$123.45');
    expect(parseMoney('$1,234.5')).toBe(123450);
    expect(parseMoney('95')).toBe(9500);
    expect(parseMoney('9.999')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(centsToInput(9550)).toBe('95.50');
  });
});

describe('price book', () => {
  it('adds, edits and hides items; AI price changes need approval; companies are isolated', async () => {
    const rt = createRuntime();
    estimatesModule.register({ actions: rt.actions, events: rt.events });
    const user = { companyId: 'coPB', actor: { kind: 'user', id: 'u' } as const };
    const agent = { companyId: 'coPB', actor: { kind: 'agent', id: 'a' } as const };

    const added = await rt.actions.executeByName('estimates.add_price_item', { name: 'Gate repair', unit: 'hour', unit_price_cents: 9500, unit_cost_cents: 3500 }, user);
    expect(added.status, JSON.stringify(added)).toBe('ok');
    const id = (added as { output: { id: string } }).output.id;

    const bad = await rt.actions.executeByName('estimates.add_price_item', { name: '', unit_price_cents: -5 }, user);
    expect(bad.status).toBe('invalid');

    const byAgent = await rt.actions.executeByName('estimates.update_price_item', { item_id: id, name: 'Gate repair', unit_price_cents: 100 }, agent);
    expect(byAgent.status).toBe('pending_approval');
    expect((await listPriceItems('coPB'))[0].unit_price_cents).toBe(9500);

    expect((await rt.actions.executeByName('estimates.update_price_item', { item_id: id, name: 'Gate repair', unit_price_cents: 10500 }, user)).status).toBe('ok');
    expect((await listPriceItems('coPB'))[0].unit_price_cents).toBe(10500);

    await rt.actions.executeByName('estimates.set_price_item_active', { item_id: id, active: false }, user);
    expect((await listPriceItems('coPB'))[0].active).toBe(false);
    expect(await listPriceItems('coOther')).toEqual([]);
  });
});
