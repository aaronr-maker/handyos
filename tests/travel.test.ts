import { describe, expect, it } from 'vitest';
import { addressKey, driveMinutes, MAX_PAIRS, travelSettings, type TravelStore } from '../api/_lib/travel';

const KEY = 'k'.repeat(40);
const settings = travelSettings({ ORS_API_KEY: KEY });

function world() {
  const calls: string[] = [];
  const points = new Map<string, { lat: number; lon: number } | null>();
  const trips = new Map<string, number>();
  const where: Record<string, [number, number]> = { 'a st': [-91.8, 36.7], 'b st': [-91.9, 36.8] };
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u.includes('geocode') ? 'geocode' : 'directions');
    if (u.includes('geocode')) {
      const text = decodeURIComponent(new URL(u).searchParams.get('text') ?? '');
      const c = where[addressKey(text)];
      return new Response(JSON.stringify({ features: c ? [{ geometry: { coordinates: c } }] : [] }), { status: 200 });
    }
    expect((init?.headers as Record<string, string>).Authorization).toBe(KEY);
    return new Response(JSON.stringify({ routes: [{ summary: { duration: 1130 } }] }), { status: 200 }); // 18.8 minutes
  }) as typeof globalThis.fetch;
  const store: TravelStore = {
    getPoint: async (_c, k) => points.get(k),
    savePoint: async (_c, k, p) => void points.set(k, p),
    getMinutes: async (_c, f, t) => trips.get(`${f}>${t}`),
    saveMinutes: async (_c, f, t, m) => void trips.set(`${f}>${t}`, m),
  };
  return { calls, fetch, store, deps: { fetch, now: () => Date.now() } };
}

describe('drive times', () => {
  it('writes the same address the same way', () => {
    expect(addressKey('123 Main St., West Plains, MO 65775')).toBe(addressKey('123  main st west plains mo  65775'));
  });
  it('looks up each address and trip once, rounds up to whole minutes, and remembers them', async () => {
    const w = world();
    const first = await driveMinutes(w.deps, w.store, settings, 'co', [{ from: 'A St', to: 'B St' }]);
    expect(first).toEqual([19]);
    expect(w.calls).toEqual(['geocode', 'geocode', 'directions']);
    const again = await driveMinutes(w.deps, w.store, settings, 'co', [{ from: 'a st', to: 'B ST.' }]);
    expect(again).toEqual([19]);
    expect(w.calls).toHaveLength(3); // nothing new was looked up
  });
  it('says 0 for the same place, null for an address it cannot find, and never guesses', async () => {
    const w = world();
    expect(await driveMinutes(w.deps, w.store, settings, 'co', [{ from: 'A St', to: 'a st' }, { from: 'A St', to: 'Nowhere Rd' }, { from: '', to: 'A St' }])).toEqual([0, null, null]);
  });
  it('refuses too many trips at once, and says what is wrong with the key', async () => {
    const w = world();
    await expect(driveMinutes(w.deps, w.store, settings, 'co', Array.from({ length: MAX_PAIRS + 1 }, () => ({ from: 'A St', to: 'B St' })))).rejects.toThrow(/at most/);
    expect(() => travelSettings({})).toThrow(/ORS_API_KEY/);
    expect(travelSettings({ ORS_API_KEY: KEY, ORS_BASE_URL: 'https://api.heigit.org/openrouteservice/' }).base).toBe('https://api.heigit.org/openrouteservice');
  });
});
