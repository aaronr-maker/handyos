import { createRepo, type Id } from '@/core';
import type { EstimateBlocks } from './availability';
import type { EstimateSettingsRow } from './types';

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
