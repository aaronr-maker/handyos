import type { Cents, Id } from '../types';

/**
 * The catalog of every domain event. Modules announce things here and react to
 * each other's events here, instead of importing each other's code.
 * Add new events to this map; the bus is typed from it.
 */
export interface EventCatalog {
  'customer.created': { customerId: Id };
  'customer.deleted': { customerId: Id };
  /** Contact details, additional contacts, or a property's owner/tenant changed. */
  'customer.updated': { customerId: Id; what: 'details' | 'contact' | 'property' };
  'estimate.created': { estimateId: Id; customerId: Id; totalCents: Cents };
  'estimate.sent': { estimateId: Id; customerId: Id };
  'estimate.approved': { estimateId: Id; customerId: Id };
  'job.created': { jobId: Id; customerId: Id };
  'job.rescheduled': { jobId: Id; from: string | null; to: string };
  'job.completed': { jobId: Id; customerId: Id };
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
