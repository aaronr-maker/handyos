import { describe, expect, it } from 'vitest';
import { zonedTime } from '../api/_lib/availability';
import { DEFAULT_HOURS, toTwiml, walk } from '../api/_lib/callEngine';
import { bookEstimate, findOffers, requestCallback, type NewRequest, type ReceptionistData, type ReceptionistStore } from '../api/_lib/receptionistApi';

const TZ = 'America/Chicago';
const NOW = zonedTime('2027-01-04', '09:00', TZ); // Monday 9 AM
const data = (over: Partial<ReceptionistData> = {}): ReceptionistData => ({
  companyName: 'That Handyman Van',
  blocks: { timezone: TZ, week: { tue: [{ start: '16:00', end: '18:00' }], wed: [{ start: '08:00', end: '10:00' }] }, slotMinutes: 60, bufferMinutes: 30, noticeHours: 12, horizonDays: 14 },
  sellers: [
    { id: 'ross', name: 'Aaron Ross' },
    { id: 'cham', name: 'Aaron Chamernick' },
  ],
  busy: [],
  teamLanguages: ['Spanish'],
  ...over,
});
function world(d: ReceptionistData | null) {
  const saved: NewRequest[] = [];
  const store: ReceptionistStore = {
    load: async () =>
      d
        ? {
            ...d,
            busy: [...d.busy, ...saved.filter((r) => r.kind === 'estimate').map((r) => ({ seller: r.sellerId as string, start: r.startsAt as number, end: r.endsAt as number, place: r.address }))],
          }
        : null,
    save: async (_c, r) => {
      saved.push(r);
      return `req-${saved.length}`;
    },
  };
  return { store, saved };
}
const noDrives = async (pairs: unknown[]) => pairs.map(() => null);

describe('the receptionist: finding and booking in-home estimates', () => {
  it('offers the best two open times in a sentence, and says what the team speaks', async () => {
    const w = world(data());
    const r = await findOffers(w.store, noDrives, 'co', '123 Main St, West Plains, MO', NOW);
    expect(r.ok && r.offers).toHaveLength(2);
    expect(r.ok && r.sentence).toMatch(/^We have tomorrow .+ Would one of those work for you\?$/);
    expect(r.ok && r.teamLanguages).toEqual(['Spanish']);
  });
  it('books a time that is open, saves who, where and when, and then never offers it again', async () => {
    const w = world(data());
    const first = await findOffers(w.store, noDrives, 'co', '123 Main St', NOW);
    if (!first.ok) throw new Error('expected offers');
    const pick = first.offers[0];
    const booked = await bookEstimate(
      w.store,
      noDrives,
      'co',
      { address: '123 Main St', name: 'Pat Rivera', phone: '+14175550100', sellerId: pick.seller, start: pick.start, language: 'Spanish', callSid: 'CA1' },
      NOW,
    );
    expect(booked.ok && booked.confirmation).toContain(pick.sellerName);
    expect(w.saved[0]).toMatchObject({
      kind: 'estimate',
      name: 'Pat Rivera',
      phone: '+14175550100',
      address: '123 Main St',
      sellerId: pick.seller,
      startsAt: pick.start,
      endsAt: pick.start + 3_600_000,
      language: 'Spanish',
      callSid: 'CA1',
    });
    const again = await bookEstimate(w.store, noDrives, 'co', { address: '123 Main St', name: 'Sam', phone: '+14175550101', sellerId: pick.seller, start: pick.start }, NOW);
    expect(again.ok).toBe(false); // already taken
    expect(again.ok === false && again.reason).toMatch(/no longer open/);
    expect(w.saved).toHaveLength(1);
  });
  it('refuses a time that was never open, and says plainly when nothing is set up', async () => {
    const w = world(data());
    const r = await bookEstimate(w.store, noDrives, 'co', { address: 'x', name: 'A', phone: '1', sellerId: 'ross', start: zonedTime('2027-01-05', '03:00', TZ) }, NOW);
    expect(r.ok).toBe(false);
    expect(w.saved).toHaveLength(0);
    expect(await findOffers(world(null).store, noDrives, 'co', 'x', NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('not set up') });
    expect(await findOffers(world(data({ sellers: [] })).store, noDrives, 'co', 'x', NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('signed off') });
  });
  it('uses real drive times when it has them', async () => {
    const d = data({ sellers: [{ id: 'ross', name: 'Aaron Ross', home: 'home st' }], blocks: { ...data().blocks, week: { wed: [{ start: '07:00', end: '12:00' }] } } });
    const far = async (pairs: { from: string; to: string }[]) => pairs.map(() => 90); // 90 minutes from home
    const r = await findOffers(world(d).store, far, 'co', 'far st', NOW);
    // people set out at 7:00, 90 minutes away: nothing before 8:30, so the first Wednesday slot is 9 AM
    expect(r.ok && r.offers[0].say).toBe('Wednesday at 9 AM');
  });
  it('records a callback for the office', async () => {
    const w = world(data());
    expect(await requestCallback(w.store, 'co', { name: 'Pat', phone: '+14175550100', notes: 'Wants an estimate Saturday', language: 'English', callSid: 'CA1' })).toMatchObject({ ok: true });
    expect(w.saved[0]).toMatchObject({ kind: 'callback', notes: 'Wants an estimate Saturday' });
  });
});

describe('the AI receptionist block in the call tree', () => {
  const flow = {
    nodes: [
      { id: 'start', kind: 'start' as const, x: 0, y: 0, data: {} },
      { id: 'ai', kind: 'ai' as const, x: 0, y: 0, data: {} },
    ],
    edges: [{ id: 'e', source: 'start', handle: 'next', target: 'ai' }],
  };
  const base = { now: NOW, hours: DEFAULT_HOURS };
  const xml = (aiReady: boolean, assistant?: { url: string; params: Record<string, string> }) =>
    toTwiml(walk(flow, 'start', { ...base, aiReady }), { stepUrl: 'https://x/step', voice: 'v', recordingUrl: 'https://x/rec', assistant });

  it('connects the call to the assistant when it is set up, and says so plainly when it is not', () => {
    const on = xml(true, { url: 'wss://voice.example.com/ai', params: { callSid: 'CA1', companyId: 'co1', token: 'abc', from: '+14175550100' } });
    expect(on).toContain('<Connect><Stream url="wss://voice.example.com/ai">');
    expect(on).toContain('<Parameter name="from" value="+14175550100"/>');
    expect(xml(true)).not.toContain('<Connect>');
    expect(xml(false)).not.toContain('<Connect>'); // the block's "not available" line is used instead
  });
});
