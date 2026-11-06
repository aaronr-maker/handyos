import { describe, expect, it } from 'vitest';
import { getFlow, getSettings, listTeamPhones, saveFlow, saveSettings, setTeamPhone } from '../src/modules/phone/service';
import { validateFlow } from '../api/_lib/callEngine';

describe('phone settings and call tree', () => {
  it('starts with the usual hours and a starter tree whose only gaps are who to ring', async () => {
    const s = await getSettings('p-co-1');
    expect(s.hours.week.mon).toEqual([{ open: '08:00', close: '17:00' }]);
    const f = await getFlow('p-co-1');
    expect(f.saved).toBe(false);
    expect(validateFlow(f.graph).filter((p) => p.level === 'error' && !p.text.includes('nobody to ring'))).toEqual([]);
  });

  it('saves the number, hours and tree, and keeps companies apart', async () => {
    const week = { ...(await getSettings('p-co-2')).hours.week, sat: [{ open: '09:00', close: '12:00' }] };
    await saveSettings('p-co-2', { number: ' +15125550000 ', hours: { timezone: 'America/Chicago', week }, voice: 'Polly.Matthew' });
    const s = await getSettings('p-co-2');
    expect(s.number).toBe('+15125550000');
    expect(s.hours.week.sat).toEqual([{ open: '09:00', close: '12:00' }]);
    expect((await getSettings('p-co-3')).number).toBe('');
    const graph = { nodes: [{ id: 'start', kind: 'start' as const, x: 0, y: 0, data: {} }], edges: [] };
    await saveFlow('p-co-2', graph);
    await saveFlow('p-co-2', graph);
    expect((await getFlow('p-co-2')).saved).toBe(true);
  });

  it('sets and clears a team phone', async () => {
    await setTeamPhone('p-co-4', 'u1', '+15125550001');
    expect(await listTeamPhones('p-co-4')).toEqual({ u1: '+15125550001' });
    await setTeamPhone('p-co-4', 'u1', '+15125550002');
    expect((await listTeamPhones('p-co-4')).u1).toBe('+15125550002');
    await setTeamPhone('p-co-4', 'u1', '');
    expect(await listTeamPhones('p-co-4')).toEqual({});
  });
});
