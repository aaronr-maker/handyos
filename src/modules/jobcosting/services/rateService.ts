import { createRepo, type Id } from '@/core';
import { listTimeEntries } from '@/modules/jobs';
import { computeRate, minutesByMonth, type RateResult } from '../rateCalc';
import type { AccountMap, CostCategory, CostSource, OverheadLine, OverheadMonth, RateSettings } from '../rateTypes';

const monthsRepo = createRepo<OverheadMonth>('overhead_months');
const linesRepo = createRepo<OverheadLine>('overhead_lines');
const mapRepo = createRepo<AccountMap>('cost_account_map');
const settingsRepo = createRepo<RateSettings>('company_rate_settings');

/** "2026-10" -> "2026-10-01" (how a month is stored). */
export const monthDate = (key: string) => `${key}-01`;

export async function getRateSettings(companyId: Id): Promise<{ target_margin_bps: number; use_in_job_costing: boolean }> {
  const row = (await settingsRepo.list(companyId))[0];
  return { target_margin_bps: row?.target_margin_bps ?? 3000, use_in_job_costing: row?.use_in_job_costing ?? false };
}

export async function saveRateSettings(companyId: Id, data: { target_margin_bps: number; use_in_job_costing: boolean }) {
  const row = (await settingsRepo.list(companyId))[0];
  return row ? settingsRepo.update(companyId, row.id, data) : settingsRepo.insert(companyId, data);
}

/** How the company categorized each account before, so a new month's import sorts itself. */
export async function getAccountMap(companyId: Id): Promise<Record<string, CostCategory>> {
  return Object.fromEntries((await mapRepo.list(companyId)).map((m) => [m.account_name.toLowerCase(), m.category]));
}

export interface MonthLine {
  account_name: string;
  amount_cents: number;
  category: CostCategory;
}

export async function getMonth(companyId: Id, key: string): Promise<{ month: OverheadMonth; lines: OverheadLine[] } | null> {
  const month = (await monthsRepo.list(companyId, { where: { month: monthDate(key) } }))[0];
  if (!month) return null;
  return { month, lines: await linesRepo.list(companyId, { where: { month_id: month.id } }) };
}

/** Man-hours clocked on the time clock in a month, in minutes. */
export async function clockedMinutes(companyId: Id, key: string): Promise<number> {
  return minutesByMonth(await listTimeEntries(companyId))[key] ?? 0;
}

/** The man-hours to divide by: the hand-entered total if there is one, else the time clock. */
export async function minutesFor(companyId: Id, key: string, override: number | null): Promise<number> {
  return override ?? (await clockedMinutes(companyId, key));
}

export async function summarize(companyId: Id, lines: { amount_cents: number; category: CostCategory }[], minutes: number): Promise<RateResult> {
  const { target_margin_bps } = await getRateSettings(companyId);
  return computeRate({ lines, minutes, target_margin_bps });
}

/**
 * Saves one month of costs (replacing what was there), works out and stores its hourly cost for job costing,
 * and remembers how each account was categorized.
 */
export async function saveMonth(
  companyId: Id,
  key: string,
  source: CostSource,
  hoursOverrideMinutes: number | null,
  lines: MonthLine[],
): Promise<{ month: OverheadMonth; rate: RateResult }> {
  const minutes = await minutesFor(companyId, key, hoursOverrideMinutes);
  const rate = await summarize(companyId, lines, minutes);
  const existing = await getMonth(companyId, key);
  const fields = { source, hours_minutes: hoursOverrideMinutes, hours_from_clock: hoursOverrideMinutes === null, cost_per_hour_cents: rate.cost_per_hour_cents, imported_at: new Date().toISOString() };
  const month = existing ? await monthsRepo.update(companyId, existing.month.id, fields) : await monthsRepo.insert(companyId, { month: monthDate(key), ...fields });
  if (existing) for (const l of existing.lines) await linesRepo.remove(companyId, l.id);
  if (lines.length) await linesRepo.insertMany(companyId, lines.map((l) => ({ month_id: month.id, account_name: l.account_name, amount_cents: l.amount_cents, category: l.category })));

  const known = await mapRepo.list(companyId);
  for (const l of lines) {
    const row = known.find((m) => m.account_name.toLowerCase() === l.account_name.toLowerCase());
    if (!row) known.push(await mapRepo.insert(companyId, { account_name: l.account_name, category: l.category }));
    else if (row.category !== l.category) await mapRepo.update(companyId, row.id, { category: l.category });
  }
  return { month, rate };
}

/** Saved hourly cost per month ("2026-10" -> cents), for job costing. Months without hours have none. */
export async function savedRates(companyId: Id): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const m of await monthsRepo.list(companyId)) if (m.cost_per_hour_cents !== null) out[m.month.slice(0, 7)] = m.cost_per_hour_cents;
  return out;
}

export const listMonths = async (companyId: Id) => (await monthsRepo.list(companyId)).sort((a, b) => b.month.localeCompare(a.month));
