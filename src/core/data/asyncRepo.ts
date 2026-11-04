import { getSupabase } from '../supabase';
import type { BaseRecord, Id } from '../types';
import { createMemoryRepo } from './memoryRepo';

export interface ListOptions {
  orderBy?: string;
  /** Equality filters, e.g. { customer_id: '...' }. */
  where?: Record<string, string | number | boolean>;
}

/**
 * Async, tenant-scoped repository. Uses Supabase when the database is connected (row-level security
 * double-checks the company), and falls back to in-memory data in demo mode.
 */
export interface AsyncRepo<T extends BaseRecord> {
  insert(companyId: Id, data: Omit<T, keyof BaseRecord>): Promise<T>;
  /** Inserts many rows at once (returned in the same order). */
  insertMany(companyId: Id, data: Omit<T, keyof BaseRecord>[]): Promise<T[]>;
  get(companyId: Id, id: Id): Promise<T | undefined>;
  list(companyId: Id, options?: ListOptions): Promise<T[]>;
  update(companyId: Id, id: Id, patch: Partial<Omit<T, keyof BaseRecord>>): Promise<T>;
  remove(companyId: Id, id: Id): Promise<void>;
  /** Deletes every row matching the equality filters (all of the company's rows when none are given). Returns how many. */
  removeWhere(companyId: Id, where: Record<string, string | number | boolean>): Promise<number>;
}

export function createRepo<T extends BaseRecord>(table: string): AsyncRepo<T> {
  const memory = createMemoryRepo<T>();

  return {
    async insert(companyId, data) {
      const db = getSupabase();
      if (!db) return memory.insert(companyId, data);
      const { data: row, error } = await db.from(table).insert({ ...data, company_id: companyId }).select().single();
      if (error) throw new Error(error.message);
      return row as T;
    },
    async insertMany(companyId, data) {
      const db = getSupabase();
      if (!db) return data.map((d) => memory.insert(companyId, d));
      const out: T[] = [];
      for (let i = 0; i < data.length; i += 200) {
        const chunk = data.slice(i, i + 200).map((d) => ({ ...d, company_id: companyId }));
        const { data: rows, error } = await db.from(table).insert(chunk).select();
        if (error) throw new Error(error.message);
        out.push(...((rows ?? []) as T[]));
      }
      return out;
    },
    async get(companyId, id) {
      const db = getSupabase();
      if (!db) return memory.get(companyId, id);
      const { data: row, error } = await db.from(table).select().eq('company_id', companyId).eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return (row as T | null) ?? undefined;
    },
    async list(companyId, options = {}) {
      const db = getSupabase();
      if (!db) {
        let rows: T[] = memory.list(companyId);
        for (const [k, v] of Object.entries(options.where ?? {})) rows = rows.filter((r) => (r as Record<string, unknown>)[k] === v);
        const key = options.orderBy;
        if (key) rows = [...rows].sort((a, b) => String((a as Record<string, unknown>)[key]).localeCompare(String((b as Record<string, unknown>)[key])));
        return rows;
      }
      // the database answers at most 1,000 rows at a time, so read it page by page
      const all: T[] = [];
      for (let from = 0; ; from += 1000) {
        let q = db.from(table).select().eq('company_id', companyId);
        for (const [k, v] of Object.entries(options.where ?? {})) q = q.eq(k, v);
        q = q.order(options.orderBy ?? 'id').range(from, from + 999);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        all.push(...((rows ?? []) as T[]));
        if ((rows ?? []).length < 1000) break;
      }
      return all;
    },
    async update(companyId, id, patch) {
      const db = getSupabase();
      if (!db) return memory.update(companyId, id, patch);
      const { data: row, error } = await db.from(table).update(patch as Record<string, unknown>).eq('company_id', companyId).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return row as T;
    },
    async remove(companyId, id) {
      const db = getSupabase();
      if (!db) return memory.remove(companyId, id);
      const { error } = await db.from(table).delete().eq('company_id', companyId).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async removeWhere(companyId, where) {
      const db = getSupabase();
      if (!db) {
        const rows = memory.list(companyId).filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        for (const r of rows) memory.remove(companyId, r.id);
        return rows.length;
      }
      let q = db.from(table).delete({ count: 'exact' }).eq('company_id', companyId);
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      const { error, count } = await q;
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}
