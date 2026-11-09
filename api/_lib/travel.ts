import { createClient } from '@supabase/supabase-js';
import { ApiError, type Deps } from './qb.js';

/**
 * Real drive times between addresses (OpenRouteService). The map key stays on the server. Every address and every trip is saved, so
 * the same lookup is never paid for twice; saved trips older than 30 days are looked up again (roads and traffic patterns change).
 */
export interface TravelStore {
  getPoint(companyId: string, key: string): Promise<{ lat: number; lon: number } | null | undefined>;
  savePoint(companyId: string, key: string, point: { lat: number; lon: number } | null): Promise<void>;
  getMinutes(companyId: string, from: string, to: string, notOlderThan: number): Promise<number | undefined>;
  saveMinutes(companyId: string, from: string, to: string, minutes: number): Promise<void>;
}

export interface TravelSettings {
  key: string;
  base: string;
}

/** The same address written two ways should be one lookup: lower case, no extra spaces or punctuation. */
export const addressKey = (a: string): string => a.toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();

export function travelSettings(env: { ORS_API_KEY?: string; ORS_BASE_URL?: string }): TravelSettings {
  const key = (env.ORS_API_KEY ?? '').trim();
  if (key.length < 20 || /\s/.test(key)) throw new ApiError(503, 'ORS_API_KEY is missing or looks wrong in Vercel (copy the whole key from the OpenRouteService dashboard).');
  return { key, base: (env.ORS_BASE_URL ?? 'https://api.openrouteservice.org').trim().replace(/\/+$/, '') };
}

async function geocode(deps: Pick<Deps, 'fetch'>, s: TravelSettings, address: string): Promise<{ lat: number; lon: number } | null> {
  const url = `${s.base}/geocode/search?api_key=${encodeURIComponent(s.key)}&text=${encodeURIComponent(address)}&boundary.country=US&size=1`;
  const res = await deps.fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number] } }[] };
  const c = json.features?.[0]?.geometry?.coordinates;
  return c ? { lon: c[0], lat: c[1] } : null;
}

async function drive(deps: Pick<Deps, 'fetch'>, s: TravelSettings, a: { lat: number; lon: number }, b: { lat: number; lon: number }): Promise<number | null> {
  const res = await deps.fetch(`${s.base}/v2/directions/driving-car`, {
    method: 'POST',
    headers: { Authorization: s.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { routes?: { summary?: { duration?: number } }[] };
  const seconds = json.routes?.[0]?.summary?.duration;
  return typeof seconds === 'number' ? Math.max(1, Math.ceil(seconds / 60)) : null;
}

/** Address suggestions for what is typed so far (up to five, US addresses). */
export async function suggestAddresses(deps: Pick<Deps, 'fetch'>, s: TravelSettings, text: string): Promise<string[]> {
  if (text.trim().length < 4) return [];
  const res = await deps.fetch(`${s.base}/geocode/autocomplete?api_key=${encodeURIComponent(s.key)}&text=${encodeURIComponent(text.trim())}&boundary.country=US&size=5&layers=address,street`);
  if (!res.ok) return [];
  const json = (await res.json()) as { features?: { properties?: { label?: string } }[] };
  return [...new Set((json.features ?? []).map((f) => f.properties?.label).filter((l): l is string => !!l))];
}

export const MAX_PAIRS = 40;
const THIRTY_DAYS = 30 * 86_400_000;

/** Drive minutes for each pair of addresses (null when an address cannot be found or the trip cannot be worked out). */
export async function driveMinutes(deps: Pick<Deps, 'fetch' | 'now'>, store: TravelStore, settings: TravelSettings, companyId: string, pairs: { from: string; to: string }[]): Promise<(number | null)[]> {
  if (pairs.length > MAX_PAIRS) throw new ApiError(400, `Ask for at most ${MAX_PAIRS} trips at a time.`);
  const points = new Map<string, { lat: number; lon: number } | null>();
  const point = async (address: string) => {
    const key = addressKey(address);
    if (points.has(key)) return points.get(key) ?? null;
    let p = await store.getPoint(companyId, key);
    if (p === undefined) {
      p = await geocode(deps, settings, address);
      await store.savePoint(companyId, key, p);
    }
    points.set(key, p);
    return p;
  };
  const out: (number | null)[] = [];
  for (const { from, to } of pairs) {
    const fk = addressKey(from);
    const tk = addressKey(to);
    if (!fk || !tk) {
      out.push(null);
      continue;
    }
    if (fk === tk) {
      out.push(0);
      continue;
    }
    const saved = await store.getMinutes(companyId, fk, tk, deps.now() - THIRTY_DAYS);
    if (saved !== undefined) {
      out.push(saved);
      continue;
    }
    const [a, b] = [await point(from), await point(to)];
    const m = a && b ? await drive(deps, settings, a, b) : null;
    if (m !== null) await store.saveMinutes(companyId, fk, tk, m);
    out.push(m);
  }
  return out;
}

export function supabaseTravelStore(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): TravelStore {
  const db = createClient(String(env.SUPABASE_URL), String(env.SUPABASE_SERVICE_ROLE_KEY), { auth: { persistSession: false } });
  return {
    async getPoint(companyId, key) {
      const { data } = await db.from('geocodes').select('lat, lon').eq('company_id', companyId).eq('address_key', key).maybeSingle();
      if (!data) return undefined;
      return data.lat === null || data.lon === null ? null : { lat: data.lat as number, lon: data.lon as number };
    },
    async savePoint(companyId, key, p) {
      await db.from('geocodes').upsert({ company_id: companyId, address_key: key, lat: p?.lat ?? null, lon: p?.lon ?? null }, { onConflict: 'company_id,address_key' });
    },
    async getMinutes(companyId, from, to, notOlderThan) {
      const { data } = await db.from('drive_times').select('minutes').eq('company_id', companyId).eq('from_key', from).eq('to_key', to).gte('created_at', new Date(notOlderThan).toISOString()).maybeSingle();
      return data ? (data.minutes as number) : undefined;
    },
    async saveMinutes(companyId, from, to, minutes) {
      await db.from('drive_times').upsert({ company_id: companyId, from_key: from, to_key: to, minutes, created_at: new Date().toISOString() }, { onConflict: 'company_id,from_key,to_key' });
    },
  };
}
