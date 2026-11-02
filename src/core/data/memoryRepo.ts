import type { BaseRecord, Id } from '../types';

/**
 * Tenant-scoped in-memory repository. Stand-in until modules are wired to Supabase.
 * Every read/write requires a companyId, so cross-tenant access is impossible by construction,
 * mirroring the row-level security rules in the database.
 */
export interface Repo<T extends BaseRecord> {
  insert(companyId: Id, data: Omit<T, keyof BaseRecord>): T;
  get(companyId: Id, id: Id): T | undefined;
  list(companyId: Id): T[];
  update(companyId: Id, id: Id, patch: Partial<Omit<T, keyof BaseRecord>>): T;
}

export function createMemoryRepo<T extends BaseRecord>(): Repo<T> {
  const rows = new Map<Id, T>();
  return {
    insert(companyId, data) {
      const now = new Date().toISOString();
      const row = { ...data, id: crypto.randomUUID(), company_id: companyId, created_at: now, updated_at: now } as T;
      rows.set(row.id, row);
      return row;
    },
    get(companyId, id) {
      const row = rows.get(id);
      return row && row.company_id === companyId ? row : undefined;
    },
    list: (companyId) => [...rows.values()].filter((r) => r.company_id === companyId),
    update(companyId, id, patch) {
      const row = this.get(companyId, id);
      if (!row) throw new Error(`Record ${id} not found`);
      const next = { ...row, ...patch, updated_at: new Date().toISOString() } as T;
      rows.set(id, next);
      return next;
    },
  };
}
