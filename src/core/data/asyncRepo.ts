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
  get(companyId: Id, id: Id): Promise<T | undefined>;
  list(companyId: Id, options?: ListOptions): Promise<T[]>;
  update(companyId: Id, id: Id, patch: Partial<Omit<T, keyof BaseRecord>>): Promise<T>;
  remove(companyId: Id, id: Id): Promise<void>;
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
      let q = db.from(table).select().eq('company_id', companyId);
      for (const [k, v] of Object.entries(options.where ?? {})) q = q.eq(k, v);
      if (options.orderBy) q = q.order(options.orderBy);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return (rows ?? []) as T[];
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
  };
}
