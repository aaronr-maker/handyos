import type { DomainEvent, EventCatalog, EventType } from './catalog';
import type { Id } from '../types';

export type EventHandler<T extends EventType> = (event: DomainEvent<T>) => void | Promise<void>;
export type AnyEventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventBus {
  emit<T extends EventType>(companyId: Id, type: T, payload: EventCatalog[T]): Promise<DomainEvent<T>>;
  on<T extends EventType>(type: T, handler: EventHandler<T>): () => void;
  /** Subscribe to everything (audit, debugging, future AI agents). */
  onAny(handler: AnyEventHandler): () => void;
}

/**
 * In-process typed event bus. A failing handler never breaks the emitter or other
 * handlers; the error is reported via `onError` (later: the error-triage agent).
 */
export function createEventBus(onError: (err: unknown, event: DomainEvent) => void = console.error): EventBus {
  const handlers = new Map<EventType, Set<AnyEventHandler>>();
  const anyHandlers = new Set<AnyEventHandler>();

  return {
    async emit(companyId, type, payload) {
      const event = {
        id: crypto.randomUUID(),
        type,
        company_id: companyId,
        occurred_at: new Date().toISOString(),
        payload,
      } as DomainEvent<typeof type>;
      const targets = [...(handlers.get(type) ?? []), ...anyHandlers];
      await Promise.all(
        targets.map(async (h) => {
          try {
            await h(event);
          } catch (err) {
            onError(err, event);
          }
        }),
      );
      return event;
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as AnyEventHandler);
      handlers.set(type, set);
      return () => set.delete(handler as AnyEventHandler);
    },
    onAny(handler) {
      anyHandlers.add(handler);
      return () => anyHandlers.delete(handler);
    },
  };
}
