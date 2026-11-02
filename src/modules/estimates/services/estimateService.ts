import { createRepo, nextCompanyNumber, type Id } from '@/core';
import { computeTotals } from '../totals';
import type { Estimate, EstimateLineItem, EstimateStatus } from '../types';

const estimates = createRepo<Estimate>('estimates');

export interface EstimateDraft {
  customer_id: Id;
  owed_by_customer_id: Id | null;
  property_id: Id | null;
  sold_by: Id | null;
  title: string;
  line_items: EstimateLineItem[];
  tax_rate_bps: number;
  valid_until: string | null;
  notes: string | null;
}

export async function createEstimate(companyId: Id, draft: EstimateDraft): Promise<Estimate> {
  const totals = computeTotals(draft.line_items, draft.tax_rate_bps);
  return estimates.insert(companyId, {
    ...draft,
    ...totals,
    estimate_number: await nextCompanyNumber(companyId, 'estimate'),
    status: 'draft',
    sent_at: null,
    approved_at: null,
    declined_at: null,
  });
}

/** Only drafts can be edited; once sent, an estimate is what the customer saw. */
export async function updateDraft(companyId: Id, id: Id, draft: EstimateDraft): Promise<Estimate> {
  const existing = await estimates.get(companyId, id);
  if (!existing) throw new Error('Estimate not found');
  if (existing.status !== 'draft') throw new Error('Only a draft can be edited. Sent estimates can no longer be changed.');
  return estimates.update(companyId, id, { ...draft, ...computeTotals(draft.line_items, draft.tax_rate_bps) });
}

const stamp: Record<Exclude<EstimateStatus, 'draft'>, 'sent_at' | 'approved_at' | 'declined_at'> = {
  sent: 'sent_at',
  approved: 'approved_at',
  declined: 'declined_at',
};

const ALLOWED: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['sent'],
  sent: ['approved', 'declined'],
  approved: [],
  declined: ['sent'],
};

/** Moves an estimate along draft -> sent -> approved / declined (a declined estimate can be sent again). */
export async function setEstimateStatus(companyId: Id, id: Id, status: Exclude<EstimateStatus, 'draft'>): Promise<Estimate> {
  const existing = await estimates.get(companyId, id);
  if (!existing) throw new Error('Estimate not found');
  if (!ALLOWED[existing.status].includes(status)) throw new Error(`A ${existing.status} estimate can't be marked ${status}`);
  return estimates.update(companyId, id, { status, [stamp[status]]: new Date().toISOString() } as Partial<Estimate>);
}

export const getEstimate = (companyId: Id, id: Id) => estimates.get(companyId, id);
export const listEstimates = async (companyId: Id) =>
  (await estimates.list(companyId)).sort((a, b) => b.estimate_number - a.estimate_number);
