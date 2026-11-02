import type { BaseRecord, Cents, Id } from '@/core';

export type CostKind = 'labor' | 'material' | 'other';

export interface JobCost extends BaseRecord {
  job_id: Id;
  kind: CostKind;
  amount_cents: Cents;
  note: string | null;
}
