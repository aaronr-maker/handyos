import { createRepo, type Id } from '@/core';
import type { RevenueHistory } from './types';

const repo = createRepo<RevenueHistory>('revenue_history');

export const listHistory = (companyId: Id) => repo.list(companyId);

/** Adds imported rows. With `replace`, everything saved earlier under the same import name goes first (so re-loading a file never doubles it). */
export async function saveHistory(companyId: Id, source: string, rows: Omit<RevenueHistory, 'id' | 'company_id' | 'created_at' | 'updated_at' | 'source'>[], replace: boolean) {
  if (replace) await repo.removeWhere(companyId, { source });
  if (rows.length) await repo.insertMany(companyId, rows.map((r) => ({ ...r, source })));
  return rows.length;
}

export const removeImport = (companyId: Id, source: string) => repo.removeWhere(companyId, { source });
