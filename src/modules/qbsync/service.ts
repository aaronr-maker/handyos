import { apiCall, createRepo, isSupabaseConfigured, type Id } from '@/core';
import { DEFAULT_START, type SyncRecord, type SyncSettings } from './types';

const settingsRepo = createRepo<SyncSettings>('qb_sync_settings');
const recordsRepo = createRepo<SyncRecord>('qb_sync_records');

export const NO_SETTINGS: Omit<SyncSettings, 'id' | 'company_id' | 'created_at' | 'updated_at'> = {
  enabled: false,
  income_account_id: null,
  income_account_name: null,
  deposit_account_id: null,
  deposit_account_name: null,
  tax_code_id: null,
  tax_code_name: null,
  start_date: DEFAULT_START,
};

export async function getSettings(companyId: Id): Promise<SyncSettings | null> {
  return (await settingsRepo.list(companyId))[0] ?? null;
}

export async function saveSettings(companyId: Id, data: typeof NO_SETTINGS): Promise<SyncSettings> {
  const row = await getSettings(companyId);
  return row ? settingsRepo.update(companyId, row.id, data) : settingsRepo.insert(companyId, data);
}

/** Which invoices and payments were sent, and which failed (the server writes these). */
export const listRecords = async (companyId: Id): Promise<SyncRecord[]> => (isSupabaseConfigured ? recordsRepo.list(companyId) : []);

export interface SetupLists {
  income: { id: string; name: string }[];
  deposit: { id: string; name: string }[];
  taxCodes: { id: string; name: string }[];
}
export const loadSetup = () => apiCall<SetupLists>('/api/qb/setup');

export interface InvoicePayload {
  local_id: string;
  number: number;
  title: string;
  date: string;
  due_date: string;
  customer: { name: string; email: string | null };
  lines: { description: string; quantity: number; unit_cents: number; taxable: boolean }[];
  tax_cents: number;
  notes: string | null;
}
export interface PaymentPayload {
  local_id: string;
  invoice_local_id: string;
  date: string;
  amount_cents: number;
  method: string;
  reference: string | null;
}

export const sendInvoice = (invoice: InvoicePayload) => apiCall<{ qb_invoice_id: string; already: boolean }>('/api/qb/push', { kind: 'invoice', invoice });
export const sendPayment = (payment: PaymentPayload) => apiCall<{ qb_payment_id: string; already: boolean }>('/api/qb/push', { kind: 'payment', payment });
