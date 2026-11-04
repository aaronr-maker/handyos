import type { Cents, Id } from '../types';

/**
 * The catalog of every domain event. Modules announce things here and react to
 * each other's events here, instead of importing each other's code.
 * Add new events to this map; the bus is typed from it.
 */
export interface EventCatalog {
  'customer.created': { customerId: Id };
  'customer.deleted': { customerId: Id };
  /**
   * Customer `fromId` was merged into `intoId` and no longer exists. Modules that keep their own records about a
   * customer (jobs, estimates, invoices, messages...) must re-point them to `intoId` when they handle this event.
   */
  'customer.merged': { fromId: Id; intoId: Id };
  /** Contact details, additional contacts, or a property's owner/tenant changed. */
  'customer.updated': { customerId: Id; what: 'details' | 'contact' | 'property' };
  'estimate.created': { estimateId: Id; customerId: Id; totalCents: Cents };
  'estimate.sent': { estimateId: Id; customerId: Id };
  'estimate.approved': { estimateId: Id; customerId: Id; title: string; propertyId: Id | null; owedById: Id | null; soldBy: Id | null };
  'job.created': { jobId: Id; customerId: Id };
  'job.rescheduled': { jobId: Id; from: string | null; to: string };
  'job.completed': { jobId: Id; customerId: Id };
  'job.assigned': { jobId: Id; userIds: Id[] };
  /** A tech clocked in/out of a job. Job costing turns these into labor cost. */
  'timeclock.in': { jobId: Id; userId: Id };
  'timeclock.out': { jobId: Id; userId: Id; minutes: number };
  /** The day clock, and the task timer inside a job. */
  'shift.in': { userId: Id };
  'shift.out': { userId: Id; minutes: number };
  'task.started': { jobId: Id; taskId: Id; userId: Id };
  'task.stopped': { jobId: Id; taskId: Id; userId: Id };
  'time.edited': { entity: 'job' | 'task' | 'shift'; entityId: Id; userId: Id; editedBy: Id };
  'invoice.created': { invoiceId: Id; customerId: Id; totalCents: Cents };
  'invoice.sent': { invoiceId: Id; customerId: Id };
  'invoice.overdue': { invoiceId: Id; customerId: Id; amountDueCents: Cents; daysOverdue: number };
  'invoice.voided': { invoiceId: Id; reason: string };
  'payment.received': { invoiceId: Id; amountCents: Cents };
  'payment.refunded': { invoiceId: Id; amountCents: Cents };
  'jobcost.recorded': { jobId: Id; amountCents: Cents; kind: 'labor' | 'material' | 'other' };
  'message.sent': { customerId: Id; channel: 'sms' | 'email' };
}

export type EventType = keyof EventCatalog;

export interface DomainEvent<T extends EventType = EventType> {
  id: string;
  type: T;
  company_id: Id;
  occurred_at: string;
  payload: EventCatalog[T];
}
