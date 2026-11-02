import type { AuditEntry, AuditSink } from './types';

/** In-memory audit log with subscription so the UI can show activity live. Swap for a Supabase sink later. */
export interface MemoryAuditLog extends AuditSink {
  entries(): readonly AuditEntry[];
  subscribe(listener: () => void): () => void;
}

export function createMemoryAuditLog(limit = 500): MemoryAuditLog {
  let list: AuditEntry[] = [];
  const listeners = new Set<() => void>();
  return {
    write(entry) {
      list = [entry, ...list].slice(0, limit);
      listeners.forEach((l) => l());
    },
    entries: () => list,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
