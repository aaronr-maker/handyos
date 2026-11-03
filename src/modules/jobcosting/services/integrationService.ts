import { apiCall, createRepo, isSupabaseConfigured, type Id } from '@/core';
import type { PnlLine, PnlReported } from '../qbPnl';

export interface IntegrationLink {
  id: Id;
  company_id: Id;
  created_at: string;
  updated_at: string;
  provider: 'quickbooks';
  status: 'connected' | 'disconnected' | 'error';
  external_id: string | null;
  label: string | null;
  connected_at: string;
  last_sync_at: string | null;
  last_error: string | null;
}

const links = createRepo<IntegrationLink>('integration_links');

/** The company's QuickBooks connection, if any (owners/admins can read it; tokens are never readable). */
export async function quickbooksLink(companyId: Id): Promise<IntegrationLink | null> {
  if (!isSupabaseConfigured) return null;
  return (await links.list(companyId, { where: { provider: 'quickbooks' } }))[0] ?? null;
}

/** Starts linking QuickBooks: returns the QuickBooks sign-in address to send the person to. */
export const startQuickbooksConnect = () => apiCall<{ url: string }>('/api/qb/connect');

export const disconnectQuickbooks = () => apiCall<{ ok: true }>('/api/qb/disconnect');

/** One month's cost accounts from QuickBooks, for review before saving. */
export const pullQuickbooksMonth = (month: string, method: 'Accrual' | 'Cash') =>
  apiCall<{ month: string; lines: PnlLine[]; reported: PnlReported }>('/api/qb/sync', { month, method });
