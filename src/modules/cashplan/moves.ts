import { createRepo, type BaseRecord, type Cents, type Id } from '@/core';
import type { BucketId } from './calc';

/** A transfer the owner has ticked off for one week. */
export interface CashMove extends BaseRecord {
  /** The Monday of the week (YYYY-MM-DD). */
  week_start: string;
  bucket: BucketId;
  /** What the plan said when it was ticked. */
  amount_cents: Cents;
  moved_on: string;
}

const repo = createRepo<CashMove>('cash_plan_moves');

export const listMoves = (companyId: Id) => repo.list(companyId);

/** Ticks a transfer off (remembering the amount), or unticks it. Ticking again replaces the earlier tick. */
export async function setMoved(companyId: Id, week: string, bucket: BucketId, amount: Cents, moved: boolean, today: string): Promise<void> {
  const existing = (await repo.list(companyId, { where: { week_start: week, bucket } }))[0];
  if (!moved) {
    if (existing) await repo.remove(companyId, existing.id);
    return;
  }
  if (existing) await repo.update(companyId, existing.id, { amount_cents: amount, moved_on: today });
  else await repo.insert(companyId, { week_start: week, bucket, amount_cents: amount, moved_on: today });
}

export type MoveStatus = { state: 'not_moved' } | { state: 'moved'; moved_on: string } | { state: 'changed'; moved_on: string; moved_cents: Cents };

/** Whether a transfer was made, and whether the plan changed since (a late payment, a refund). */
export function moveStatus(planned: Cents, move: Pick<CashMove, 'amount_cents' | 'moved_on'> | undefined): MoveStatus {
  if (!move) return { state: 'not_moved' };
  return move.amount_cents === planned ? { state: 'moved', moved_on: move.moved_on } : { state: 'changed', moved_on: move.moved_on, moved_cents: move.amount_cents };
}
