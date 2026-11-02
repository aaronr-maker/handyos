import { createActionRegistry, createMemoryAuditLog, type ActionRegistry, type MemoryAuditLog } from './actions';
import { createEventBus, type EventBus } from './events';

export interface Runtime {
  events: EventBus;
  actions: ActionRegistry;
  audit: MemoryAuditLog;
}

/** Wires the event bus, audit log and action registry together. Created once by the app shell. */
export function createRuntime(): Runtime {
  const events = createEventBus();
  const audit = createMemoryAuditLog();
  const actions = createActionRegistry({ events, audit });
  return { events, actions, audit };
}
