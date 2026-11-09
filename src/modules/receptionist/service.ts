import { createRepo, type Id } from '@/core';
import type { EstimateBlocks, Seller } from './availability';
import type { EstimateSettingsRow, TeamAvailabilityRow } from './types';

/** An in-home estimate is always a one-hour slot. */
export const ESTIMATE_MINUTES = 60;

const repo = createRepo<EstimateSettingsRow>('estimate_settings');

export const DEFAULT_BLOCKS: EstimateBlocks = { timezone: 'America/Chicago', week: {}, slotMinutes: 60, bufferMinutes: 30, noticeHours: 12, horizonDays: 14 };

/** The time set aside for in-home estimates (nothing until Aaron sets some). */
export async function getEstimateBlocks(companyId: Id): Promise<EstimateBlocks> {
  const r = (await repo.list(companyId))[0];
  return r ? { timezone: r.timezone, week: r.week ?? {}, slotMinutes: ESTIMATE_MINUTES, bufferMinutes: r.buffer_minutes, noticeHours: r.notice_hours, horizonDays: r.horizon_days } : DEFAULT_BLOCKS;
}

export async function saveEstimateBlocks(companyId: Id, b: EstimateBlocks): Promise<void> {
  const data = { timezone: b.timezone, week: b.week, slot_minutes: ESTIMATE_MINUTES, buffer_minutes: b.bufferMinutes, notice_hours: b.noticeHours, horizon_days: b.horizonDays };
  const r = (await repo.list(companyId))[0];
  if (r) await repo.update(companyId, r.id, data);
  else await repo.insert(companyId, data);
}

const availabilityRepo = createRepo<TeamAvailabilityRow>('team_availability');

/** When each person works, by person id. People with no schedule saved are not in the list (no limit on them). */
export async function getAvailability(companyId: Id): Promise<Record<Id, NonNullable<Seller['hours']>>> {
  return Object.fromEntries((await availabilityRepo.list(companyId)).map((r) => [r.user_id, r.week ?? {}]));
}

export async function saveAvailability(companyId: Id, userId: Id, week: NonNullable<Seller['hours']>): Promise<void> {
  const row = (await availabilityRepo.list(companyId, { where: { user_id: userId } }))[0];
  if (row) await availabilityRepo.update(companyId, row.id, { week });
  else await availabilityRepo.insert(companyId, { user_id: userId, week });
}
