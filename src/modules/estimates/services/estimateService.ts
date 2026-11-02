import { createMemoryRepo, type Id } from '@/core';
import type { Estimate, EstimateLineItem, EstimateStatus } from '../types';

const estimates = createMemoryRepo<Estimate>();

export function totalOf(items: EstimateLineItem[]): number {
  return items.reduce((sum, i) => sum + Math.round(i.quantity * i.unit_price_cents), 0);
}

export function createEstimate(
  companyId: Id,
  data: { customer_id: Id; title: string; line_items: EstimateLineItem[] },
): Estimate {
  return estimates.insert(companyId, { ...data, status: 'draft', total_cents: totalOf(data.line_items) });
}

export function setEstimateStatus(companyId: Id, id: Id, status: EstimateStatus): Estimate {
  return estimates.update(companyId, id, { status });
}

export function getEstimate(companyId: Id, id: Id): Estimate | undefined {
  return estimates.get(companyId, id);
}

export function listEstimates(companyId: Id): Estimate[] {
  return estimates.list(companyId);
}
