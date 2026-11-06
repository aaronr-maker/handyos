import type { Id } from '@/core';
import { listEstimates } from '@/modules/estimates';
import { getRateSettings } from '@/modules/jobcosting';
import { efficiencyFor, loadTimeFacts } from '@/modules/timesheets';
import { computeSales, type SalesReport } from './calc';

/** Reads the estimates and the crew settings (through their modules) and works out the sales picture for the last `windowDays`. */
export async function loadSales(companyId: Id, windowDays: number, now = Date.now()): Promise<SalesReport> {
  const [estimates, settings, facts] = await Promise.all([listEstimates(companyId), getRateSettings(companyId), loadTimeFacts(companyId)]);
  // only people with enough finished jobs to measure compete on pace
  const pace = [...new Set(facts.entries.map((e) => e.user_id))].flatMap((id) => {
    const e = efficiencyFor(facts, id, now);
    return e.defaulted ? [] : [{ user_id: id, rate: e.rate }];
  });
  return computeSales({
    now,
    windowDays,
    pace,
    estimates: estimates.map((e) => ({ sold_by: e.sold_by, subtotal_cents: e.subtotal_cents, sent_at: e.sent_at, approved_at: e.approved_at, declined_at: e.declined_at })),
    settings: { crew_people: settings.crew_people, crew_days_per_week: settings.crew_days_per_week, crew_hours_per_day: settings.crew_hours_per_day, cost_per_hour_cents: settings.cost_per_hour_cents, target_margin_bps: settings.target_margin_bps },
  });
}
