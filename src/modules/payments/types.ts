import type { BaseRecord, Cents, Id } from '@/core';

export interface Payment extends BaseRecord {
  invoice_id: Id;
  /** Negative for refunds. */
  amount_cents: Cents;
  method: 'card' | 'cash' | 'check' | 'other';
  /** Stripe payment intent id once Stripe is connected. */
  provider_ref: string | null;
}
