import { createRepo, type BaseRecord, type Id } from '@/core';
import type { Payment } from '../types';

const payments = createRepo<Payment>('payments');

export const savePayment = (companyId: Id, data: Omit<Payment, keyof BaseRecord>) => payments.insert(companyId, data);
export const listPayments = async (companyId: Id) => (await payments.list(companyId)).sort((a, b) => b.received_on.localeCompare(a.received_on) || b.created_at.localeCompare(a.created_at));
export const listPaymentsFor = async (companyId: Id, invoiceId: Id) => payments.list(companyId, { where: { invoice_id: invoiceId } });
