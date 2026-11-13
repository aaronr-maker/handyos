import { describe, expect, it } from 'vitest';
import { createActionRegistry, createEventBus, createMemoryAuditLog } from '../src/core';
import { addCalendarEventAction, removeCalendarEventAction } from '../src/modules/scheduling/actions';
import { listCalendarEvents } from '../src/modules/scheduling/events';

function setup() {
  const registry = createActionRegistry({ events: createEventBus(), audit: createMemoryAuditLog() });
  registry.register(addCalendarEventAction);
  registry.register(removeCalendarEventAction);
  return registry;
}
const input = (user_id: string) => ({ user_id, kind: 'time_off' as const, title: 'Dentist', starts_at: '2027-01-05T15:00:00.000Z', ends_at: '2027-01-05T16:00:00.000Z', all_day: false });

describe('calendar events (time off and personal appointments)', () => {
  it('lets a person put time off on their own calendar and take it off again', async () => {
    const r = setup();
    const added = await r.executeByName('scheduling.add_event', input('u1'), { companyId: 'ce-co-1', actor: { kind: 'user', id: 'u1' }, role: 'tech' });
    expect(added.status).toBe('ok');
    expect((await listCalendarEvents('ce-co-1')).map((e) => e.title)).toEqual(['Dentist']);
    const id = (await listCalendarEvents('ce-co-1'))[0].id;
    expect((await r.executeByName('scheduling.remove_event', { event_id: id }, { companyId: 'ce-co-1', actor: { kind: 'user', id: 'u1' }, role: 'tech' })).status).toBe('ok');
    expect(await listCalendarEvents('ce-co-1')).toEqual([]);
  });
  it('stops a tech from changing someone else\'s calendar, but lets an owner or office do it', async () => {
    const r = setup();
    const byTech = await r.executeByName('scheduling.add_event', input('u2'), { companyId: 'ce-co-2', actor: { kind: 'user', id: 'u1' }, role: 'tech' });
    expect(byTech.status).not.toBe('ok');
    expect(await listCalendarEvents('ce-co-2')).toEqual([]);
    expect((await r.executeByName('scheduling.add_event', input('u2'), { companyId: 'ce-co-2', actor: { kind: 'user', id: 'boss' }, role: 'owner' })).status).toBe('ok');
    const id = (await listCalendarEvents('ce-co-2'))[0].id;
    expect((await r.executeByName('scheduling.remove_event', { event_id: id }, { companyId: 'ce-co-2', actor: { kind: 'user', id: 'u1' }, role: 'tech' })).status).not.toBe('ok');
    expect((await r.executeByName('scheduling.remove_event', { event_id: id }, { companyId: 'ce-co-2', actor: { kind: 'user', id: 'off' }, role: 'office' })).status).toBe('ok');
  });
  it('refuses an end before the start', async () => {
    const r = setup();
    const bad = await r.executeByName('scheduling.add_event', { ...input('u1'), ends_at: '2027-01-05T14:00:00.000Z' }, { companyId: 'ce-co-3', actor: { kind: 'user', id: 'u1' }, role: 'tech' });
    expect(bad.status).not.toBe('ok');
  });
});
