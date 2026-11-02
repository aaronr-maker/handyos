import type { BaseRecord, Cents, Id } from '@/core';

export type PaymentMethod = 'card' | 'cash' | 'check' | 'bank_transfer' | 'other';

export interface Payment extends BaseRecord {
  invoice_id: Id;
  /** Negative for refunds. */
  amount_cents: Cents;
  method: PaymentMethod;
  /** Stripe payment intent id once Stripe is connected. */
  provider_ref: string | null;
  /** ISO date. */
  received_on: string;
  note: string | null;
  /** The signed-in person who recorded it. */
  recorded_by: Id | null;
}
