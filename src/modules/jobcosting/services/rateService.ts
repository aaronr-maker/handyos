import { createRepo, type Id } from '@/core';
import { listTimeEntries } from '@/modules/jobs';
import { computeRate, computeWindowRate, minutesByMonth, type Crew, type RateResult } from '../rateCalc';
import { accountKey, type AccountMap, type CostCategory, type CostSource, type OverheadLine, type OverheadMonth, type RateSettings } from '../rateTypes';

const monthsRepo = createRepo<OverheadMonth>('overhead_months');
const linesRepo = createRepo<OverheadLine>('overhead_lines');
const mapRepo = createRepo<AccountMap>('cost_account_map');
const settingsRepo = createRepo<RateSettings>('company_rate_settings');

/** "2026-10" -> "2026-10-01" (how a month is stored). */
export const monthDate = (key: string) => `${key}-01`;

export interface RateSettingsValues {
  target_margin_bps: number;
  use_in_job_costing: boolean;
  accounting_method: 'cash' | 'accrual';
  rate_months: string[];
  hours_mode: 'clock' | 'capacity';
  crew_people: number | null;
  crew_days_per_week: number | null;
  crew_hours_per_day: number;
  working_weeks: number;
  cost_per_hour_cents: number | null;
}

const DEFAULTS: RateSettingsValues = {
  target_margin_bps: 3000,
  use_in_job_costing: false,
  accounting_method: 'cash',
  rate_months: [],
  hours_mode: 'clock',
  crew_people: null,
  crew_days_per_week: null,
  crew_hours_per_day: 8,
  working_weeks: 50,
  cost_per_hour_cents: null,
};

export async function getRateSettings(companyId: Id): Promise<RateSettingsValues> {
  const row = (await settingsRepo.list(companyId))[0];
  if (!row) return DEFAULTS;
  return {
    target_margin_bps: row.target_margin_bps,
    use_in_job_costing: row.use_in_job_costing,
    accounting_method: row.accounting_method ?? 'cash',
    rate_months: row.rate_months ?? [],
    hours_mode: row.hours_mode ?? 'clock',
    crew_people: row.crew_people ?? null,
    crew_days_per_week: row.crew_days_per_week === null || row.crew_days_per_week === undefined ? null : Number(row.crew_days_per_week),
    crew_hours_per_day: Number(row.crew_hours_per_day ?? 8),
    working_weeks: row.working_weeks ?? 50,
    cost_per_hour_cents: row.cost_per_hour_cents === null || row.cost_per_hour_cents === undefined ? null : Number(row.cost_per_hour_cents),
  };
}

/** The crew schedule from the settings, if it is complete. */
export const crewOf = (s: RateSettingsValues): Crew | null =>
  s.hours_mode === 'capacity' && s.crew_people !== null && s.crew_days_per_week !== null
    ? { people: s.crew_people, days_per_week: s.crew_days_per_week, hours_per_day: s.crew_hours_per_day, working_weeks: s.working_weeks }
    : null;

export async function saveRateSettings(companyId: Id, data: Omit<RateSettingsValues, 'cost_per_hour_cents'>) {
  const row = (await settingsRepo.list(companyId))[0];
  return row ? settingsRepo.update(companyId, row.id, data) : settingsRepo.insert(companyId, { ...data, cost_per_hour_cents: null });
}

/**
 * Works out the company hourly rate over the chosen months from what is saved (their costs, and their hours from the
 * time clock, typed-in hours, or the crew schedule), and saves it so job costing can use it.
 */
export async function recomputeRate(companyId: Id): Promise<RateResult & { minutes: number; months: number }> {
  const settings = await getRateSettings(companyId);
  const months = [];
  for (const key of settings.rate_months) {
    const saved = await getMonth(companyId, key);
    months.push({
      lines: (saved?.lines ?? []).map((l) => ({ amount_cents: l.amount_cents, category: l.category })),
      minutes: await minutesFor(companyId, key, saved?.month.hours_minutes ?? null),
    });
  }
  const result = computeWindowRate(months, settings.target_margin_bps, crewOf(settings));
  const row = (await settingsRepo.list(companyId))[0];
  if (row) await settingsRepo.update(companyId, row.id, { cost_per_hour_cents: result.cost_per_hour_cents });
  return { ...result, months: months.length };
}

/** How the company categorized each account before (keyed by name and group), so a new month's import sorts itself. */
export async function getAccountMap(companyId: Id): Promise<Record<string, CostCategory>> {
  return Object.fromEntries((await mapRepo.list(companyId)).map((m) => [m.account_name.toLowerCase(), m.category]));
}

export interface MonthLine {
  account_name: string;
  group_path: string;
  section: 'cogs' | 'expense' | 'other_expense' | 'manual';
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

/** Man-hours clocked in every month ("2026-10" -> minutes). */
export async function clockedByMonth(companyId: Id): Promise<Record<string, number>> {
  return minutesByMonth(await listTimeEntries(companyId));
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
  if (lines.length) await linesRepo.insertMany(companyId, lines.map((l) => ({ month_id: month.id, account_name: l.account_name, group_path: l.group_path, section: l.section, amount_cents: l.amount_cents, category: l.category })));

  const known = await mapRepo.list(companyId);
  for (const l of lines) {
    const key = accountKey(l.account_name, l.group_path);
    const row = known.find((m) => m.account_name.toLowerCase() === key);
    if (!row) known.push(await mapRepo.insert(companyId, { account_name: key, category: l.category }));
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
