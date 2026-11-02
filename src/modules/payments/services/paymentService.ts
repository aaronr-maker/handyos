import { createMemoryRepo, type BaseRecord, type Id } from '@/core';
import type { Payment } from '../types';

const payments = createMemoryRepo<Payment>();

export function recordPayment(companyId: Id, data: Omit<Payment, keyof BaseRecord>): Payment {
  return payments.insert(companyId, data);
}

export function listPayments(companyId: Id): Payment[] {
  return payments.list(companyId);
}
