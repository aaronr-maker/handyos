import { getSupabase } from '../supabase';
import type { AuditEntry, AuditSink } from './types';

/** Writes every audit entry to the audit_log table. Failures are logged, never thrown (an audit hiccup must not block work). */
export function createSupabaseAuditSink(): AuditSink {
  return {
    async write(entry: AuditEntry) {
      const db = getSupabase();
      if (!db) return;
      const { error } = await db.from('audit_log').insert({
        id: entry.id,
        company_id: entry.company_id,
        actor_kind: entry.actor_kind,
        actor_id: entry.actor_id,
        action: entry.action,
        outcome: entry.outcome,
        input: entry.input ?? null,
        output: entry.output ?? null,
        error: entry.error ?? null,
        approval_id: entry.approval_id ?? null,
        created_at: entry.created_at,
      });
      if (error) console.error('Audit log write failed:', error.message);
    },
  };
}
