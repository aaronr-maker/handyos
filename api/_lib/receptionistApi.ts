import { createClient } from '@supabase/supabase-js';
import { openSlots, offerSentence, pickOffers, type Busy, type EstimateBlocks, type Offer, type Seller } from './availability.js';
import { driveMinutes, supabaseTravelStore, travelSettings } from './travel.js';

/**
 * What the AI receptionist can do during a call, as plain functions the voice server asks for: find open in-home estimate times for
 * an address, book one, or ask the office to call the person back. Everything is decided here (not by the AI): the AI only reads
 * out what comes back and passes along what the caller said.
 */
export interface ReceptionistData {
  companyName: string;
  blocks: EstimateBlocks;
  sellers: (Seller & { home?: string })[];
  busy: Busy[];
  /** Languages the team speaks besides English (everyone on the team). */
  teamLanguages: string[];
}

export interface NewRequest {
  kind: 'estimate' | 'callback';
  callSid?: string;
  name?: string;
  phone?: string;
  address?: string;
  language?: string;
  notes?: string;
  sellerId?: string;
  startsAt?: number;
  endsAt?: number;
}

export interface ReceptionistStore {
  load(companyId: string, now: number): Promise<ReceptionistData | null>;
  save(companyId: string, r: NewRequest): Promise<string>;
}

export type DriveLookup = (pairs: { from: string; to: string }[]) => Promise<(number | null)[]>;

export interface OfferView {
  seller: string;
  sellerName: string;
  start: number;
  say: string;
}

const view = (o: Offer): OfferView => ({ seller: o.seller, sellerName: o.sellerName, start: o.start, say: o.say });

async function compute(store: ReceptionistStore, drives: DriveLookup, companyId: string, address: string, now: number) {
  const data = await store.load(companyId, now);
  if (!data) return { problem: 'The estimate times are not set up yet.' };
  if (data.sellers.length === 0) return { problem: 'Nobody is signed off to do in-home estimates yet.' };
  const homes = Object.fromEntries(data.sellers.filter((s) => s.home).map((s) => [s.id, s.home as string]));
  const places = [...new Set([...Object.values(homes), ...data.busy.map((b) => b.place).filter((p): p is string => !!p)])];
  const pairs = places.flatMap((p) => [
    { from: p, to: address },
    { from: address, to: p },
  ]);
  const minutes = pairs.length ? await drives(pairs).catch(() => pairs.map(() => null)) : [];
  const table = new Map(pairs.map((p, i) => [`${p.from}>${p.to}`, minutes[i]]));
  const slots = openSlots({ now, blocks: data.blocks, sellers: data.sellers, busy: data.busy, travel: { target: address, homes, drive: (a, b) => table.get(`${a}>${b}`) ?? null } });
  return { data, slots };
}

/** The best two open times for this address, with the sentence to say, and what the team speaks. */
export async function findOffers(store: ReceptionistStore, drives: DriveLookup, companyId: string, address: string, now: number) {
  const c = await compute(store, drives, companyId, address, now);
  if ('problem' in c) return { ok: false as const, reason: c.problem };
  const offers = pickOffers(c.slots, c.data.blocks.timezone);
  return { ok: true as const, offers: offers.map(view), sentence: offerSentence(offers), teamLanguages: c.data.teamLanguages, companyName: c.data.companyName, allOpen: c.slots.length };
}

/** Books the time the caller chose, but only if it is still open for this address. */
export async function bookEstimate(
  store: ReceptionistStore,
  drives: DriveLookup,
  companyId: string,
  i: { address: string; name: string; phone: string; sellerId: string; start: number; language?: string; notes?: string; callSid?: string },
  now: number,
) {
  const c = await compute(store, drives, companyId, i.address, now);
  if ('problem' in c) return { ok: false as const, reason: c.problem };
  const slot = c.slots.find((o) => o.seller === i.sellerId && o.start === i.start);
  if (!slot) {
    const offers = pickOffers(c.slots, c.data.blocks.timezone);
    return { ok: false as const, reason: 'That time is no longer open.', sentence: offerSentence(offers) };
  }
  const id = await store.save(companyId, {
    kind: 'estimate',
    callSid: i.callSid,
    name: i.name,
    phone: i.phone,
    address: i.address,
    language: i.language,
    notes: i.notes,
    sellerId: i.sellerId,
    startsAt: slot.start,
    endsAt: slot.end,
  });
  return { ok: true as const, id, confirmation: `${slot.say} with ${slot.sellerName}` };
}

/** Records that the office must call the person back (for a time outside the estimate times, or anything the assistant cannot do). */
export async function requestCallback(store: ReceptionistStore, companyId: string, i: { name?: string; phone?: string; address?: string; language?: string; notes: string; callSid?: string }) {
  const id = await store.save(companyId, { kind: 'callback', callSid: i.callSid, name: i.name, phone: i.phone, address: i.address, language: i.language, notes: i.notes });
  return { ok: true as const, id };
}

// ---- the real database side (server key) ----
export function supabaseReceptionistStore(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): ReceptionistStore {
  const db = createClient(String(env.SUPABASE_URL), String(env.SUPABASE_SERVICE_ROLE_KEY), { auth: { persistSession: false } });
  const oneLine = (p: { address_line1?: string | null; city?: string | null; state?: string | null; postal_code?: string | null }) =>
    [p.address_line1, p.city, [p.state, p.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    async load(companyId, now) {
      const [{ data: settings }, { data: users }, { data: avail }, { data: company }] = await Promise.all([
        db.from('estimate_settings').select('timezone, week, buffer_minutes, notice_hours, horizon_days').eq('company_id', companyId).maybeSingle(),
        db.from('users').select('id, full_name, email, is_seller, languages, home_address').eq('company_id', companyId),
        db.from('team_availability').select('user_id, week').eq('company_id', companyId),
        db.from('companies').select('name').eq('id', companyId).maybeSingle(),
      ]);
      if (!settings) return null;
      const hours = new Map((avail ?? []).map((a) => [a.user_id as string, a.week as Seller['hours']]));
      const sellers = (users ?? [])
        .filter((u) => u.is_seller)
        .map((u) => ({
          id: u.id as string,
          name: ((u.full_name as string) || (u.email as string) || 'a team member') as string,
          home: (u.home_address as string | null) ?? undefined,
          ...(hours.has(u.id as string) ? { hours: hours.get(u.id as string) } : {}),
        }));
      const sellerIds = sellers.map((s) => s.id);
      const busy: Busy[] = [];
      if (sellerIds.length) {
        const { data: assigned } = await db.from('job_assignments').select('job_id, user_id').eq('company_id', companyId).in('user_id', sellerIds);
        const jobIds = [...new Set((assigned ?? []).map((a) => a.job_id as string))];
        if (jobIds.length) {
          const { data: jobs } = await db
            .from('jobs')
            .select('id, property_id, scheduled_start, scheduled_end, status')
            .eq('company_id', companyId)
            .in('id', jobIds)
            .neq('status', 'completed')
            .not('scheduled_start', 'is', null)
            .not('scheduled_end', 'is', null);
          const propIds = [...new Set((jobs ?? []).map((j) => j.property_id as string | null).filter((x): x is string => !!x))];
          const { data: props } = propIds.length ? await db.from('properties').select('id, address_line1, city, state, postal_code').in('id', propIds) : { data: [] };
          const place = new Map((props ?? []).map((p) => [p.id as string, oneLine(p)]));
          for (const j of jobs ?? []) {
            const end = Date.parse(j.scheduled_end as string);
            if (end < now) continue;
            for (const a of (assigned ?? []).filter((x) => x.job_id === j.id))
              busy.push({ seller: a.user_id as string, start: Date.parse(j.scheduled_start as string), end, place: place.get(j.property_id as string) });
          }
        }
        // time off and personal appointments on anyone's calendar block them too
        const { data: away } = await db.from('calendar_events').select('user_id, starts_at, ends_at').eq('company_id', companyId).in('user_id', sellerIds).gt('ends_at', new Date(now).toISOString());
        for (const e of away ?? []) busy.push({ seller: e.user_id as string, start: Date.parse(e.starts_at as string), end: Date.parse(e.ends_at as string) });
        // estimates the assistant already booked, so the same time is never offered twice
        const { data: booked } = await db
          .from('ai_requests')
          .select('seller_id, address, starts_at, ends_at')
          .eq('company_id', companyId)
          .eq('kind', 'estimate')
          .eq('status', 'new')
          .in('seller_id', sellerIds);
        for (const b of booked ?? [])
          busy.push({ seller: b.seller_id as string, start: Date.parse(b.starts_at as string), end: Date.parse(b.ends_at as string), place: (b.address as string | null) ?? undefined });
      }
      const langs = [...new Set((users ?? []).flatMap((u) => (u.languages as string[] | null) ?? []))];
      return {
        companyName: (company?.name as string) || 'the company',
        blocks: {
          timezone: settings.timezone as string,
          week: (settings.week as EstimateBlocks['week']) ?? {},
          slotMinutes: 60,
          bufferMinutes: settings.buffer_minutes as number,
          noticeHours: settings.notice_hours as number,
          horizonDays: settings.horizon_days as number,
        },
        sellers,
        busy,
        teamLanguages: langs,
      };
    },
    async save(companyId, r) {
      const { data, error } = await db
        .from('ai_requests')
        .insert({
          company_id: companyId,
          kind: r.kind,
          call_sid: r.callSid ?? null,
          caller_name: r.name ?? null,
          caller_phone: r.phone ?? null,
          address: r.address ?? null,
          language: r.language ?? null,
          notes: r.notes ?? null,
          seller_id: r.sellerId ?? null,
          starts_at: r.startsAt ? new Date(r.startsAt).toISOString() : null,
          ends_at: r.endsAt ? new Date(r.endsAt).toISOString() : null,
        })
        .select('id')
        .single();
      if (error) throw new Error(`Saving the request failed: ${error.message}`);
      return data.id as string;
    },
  };
}

/** Drive minutes through the saved map lookups; null results (no map key, unknown address) just mean the backup travel time is used. */
export function driveLookup(
  deps: { fetch: typeof fetch; now: () => number },
  env: { ORS_API_KEY?: string; ORS_BASE_URL?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string },
  companyId: string,
): DriveLookup {
  return async (pairs) => {
    try {
      return await driveMinutes(deps, supabaseTravelStore(env), travelSettings(env), companyId, pairs.slice(0, 40));
    } catch {
      return pairs.map(() => null);
    }
  };
}
