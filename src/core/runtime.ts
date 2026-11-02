import { createActionRegistry, createMemoryAuditLog, createSupabaseAuditSink, type ActionRegistry, type MemoryAuditLog } from './actions';
import { createEventBus, type EventBus } from './events';
import { isSupabaseConfigured } from './supabase';

export interface Runtime {
  events: EventBus;
  actions: ActionRegistry;
  audit: MemoryAuditLog;
}

/**
 * Wires the event bus, audit log and action registry together. Created once by the app shell.
 * Audit entries always show live in the in-memory log, and are also saved to the database when it is connected.
 */
export function createRuntime(): Runtime {
  const events = createEventBus();
  const memory = createMemoryAuditLog();
  const remote = isSupabaseConfigured ? createSupabaseAuditSink() : null;
  const audit: MemoryAuditLog = {
    ...memory,
    write(entry) {
      memory.write(entry);
      if (remote) void remote.write(entry);
    },
  };
  const actions = createActionRegistry({ events, audit });
  return { events, actions, audit };
}
