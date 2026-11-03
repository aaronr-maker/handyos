import { createRepo, type Id } from '@/core';
import { listTimeEntries } from '@/modules/jobs';
import { computeRate, computeWindowRate, minutesByMonth, type Crew, type RateResult } from '../rateCalc';
import { accountKey, type IncomeLine, type AccountMap, type CostCategory, type CostSource, type OverheadLine, type OverheadMonth, type RateSettings } from '../rateTypes';

const monthsRepo = createRepo<OverheadMonth>('overhead_months');
const linesRepo = createRepo<OverheadLine>('overhead_lines');
const mapRepo = createRepo<AccountMap>('cost_account_map');
const incomeRepo = createRepo<IncomeLine>('income_lines');
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

export interface MonthIncome {
  account_name: string;
  group_path: string;
  kind: 'income' | 'other_income';
  amount_cents: number;
}

export interface MonthLine {
  account_name: string;
  group_path: string;
  section: 'cogs' | 'expense' | 'other_expense' | 'manual';
  amount_cents: number;
  category: CostCategory;
}

export async function getMonth(companyId: Id, key: string): Promise<{ month: OverheadMonth; lines: OverheadLine[]; income: IncomeLine[] } | null> {
  const month = (await monthsRepo.list(companyId, { where: { month: monthDate(key) } }))[0];
  if (!month) return null;
  const [lines, income] = await Promise.all([linesRepo.list(companyId, { where: { month_id: month.id } }), incomeRepo.list(companyId, { where: { month_id: month.id } })]);
  return { month, lines, income };
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
  income?: MonthIncome[],
): Promise<{ month: OverheadMonth; rate: RateResult }> {
  const minutes = await minutesFor(companyId, key, hoursOverrideMinutes);
  const rate = await summarize(companyId, lines, minutes);
  const existing = await getMonth(companyId, key);
  const fields = { source, hours_minutes: hoursOverrideMinutes, hours_from_clock: hoursOverrideMinutes === null, cost_per_hour_cents: rate.cost_per_hour_cents, imported_at: new Date().toISOString() };
  const month = existing ? await monthsRepo.update(companyId, existing.month.id, fields) : await monthsRepo.insert(companyId, { month: monthDate(key), ...fields });
  if (existing) for (const l of existing.lines) await linesRepo.remove(companyId, l.id);
  // income is replaced only when it was given (a month saved by hand leaves any income already stored alone)
  if (income && existing) for (const l of existing.income) await incomeRepo.remove(companyId, l.id);
  if (income?.length) await incomeRepo.insertMany(companyId, income.map((l) => ({ month_id: month.id, account_name: l.account_name, group_path: l.group_path, kind: l.kind, amount_cents: l.amount_cents })));
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

export interface MonthlyIncome {
  /** "2026-10" */
  month: string;
  /** Operating income (sales, services, minus discounts) in cents. */
  income_cents: number;
  other_income_cents: number;
  lines: { account: string; group: string; kind: 'income' | 'other_income'; amount_cents: number }[];
}

/**
 * Income per month, from the Profit and Loss that was imported or pulled. This is the figure other parts of the app use
 * for revenue per man-hour, margins and comparing what was brought in with what it cost. Newest month first.
 */
export async function monthlyIncome(companyId: Id): Promise<MonthlyIncome[]> {
  const [months, lines] = await Promise.all([monthsRepo.list(companyId), incomeRepo.list(companyId)]);
  return months
    .map((m) => {
      const mine = lines.filter((l) => l.month_id === m.id);
      const sum = (kind: IncomeLine['kind']) => mine.filter((l) => l.kind === kind).reduce((n, l) => n + l.amount_cents, 0);
      return { month: m.month.slice(0, 7), income_cents: sum('income'), other_income_cents: sum('other_income'), lines: mine.map((l) => ({ account: l.account_name, group: l.group_path, kind: l.kind, amount_cents: l.amount_cents })) };
    })
    .filter((m) => m.lines.length > 0)
    .sort((a, b) => b.month.localeCompare(a.month));
}
