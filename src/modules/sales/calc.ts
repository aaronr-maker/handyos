import type { Id } from '@/core';

const DAY = 86_400_000;

export interface SalesEstimate {
  sold_by: Id | null;
  subtotal_cents: number;
  sent_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
}

export interface SellerRow {
  /** null: estimates nobody was recorded as selling */
  user_id: Id | null;
  sent: number;
  approved: number;
  declined: number;
  /** approved / (approved + declined); null until something has been decided */
  closeRate: number | null;
  /** average size of an approved estimate; null when none were approved */
  avgTicketCents: number | null;
  /** total of the estimates approved in the period */
  soldCents: number;
}

export interface Needs {
  /** What the crew costs for a month, fully loaded; null until the crew is set up. */
  monthlyCostCents: number | null;
  /** Sales needed in a month to cover the crew's cost. */
  breakEvenSalesCents: number | null;
  /** Sales needed in a month to cover cost and the profit target. */
  targetSalesCents: number | null;
  /** Estimates that have to go out each month to reach those sales at the current ticket and close rate. */
  breakEvenEstimates: number | null;
  targetEstimates: number | null;
  /** Estimates actually being sent, scaled to a month. */
  sentPerMonth: number;
  /** sent per month minus what the profit target needs (negative = short); null when it cannot be worked out */
  gap: number | null;
  verdict: 'enough' | 'close' | 'short' | 'unknown';
  /** Plain-language reason when verdict is unknown. */
  missing?: string;
}

export interface Leader {
  user_id: Id;
  /** the number the ranking is based on */
  value: number;
  /** the same number, ready to show */
  shown: string;
}
export interface Board {
  id: 'sold' | 'close' | 'ticket' | 'sent' | 'approved' | 'pace';
  title: string;
  /** one line on how it is judged */
  rule: string;
  leaders: Leader[];
}

export interface SalesReport {
  windowDays: number;
  boards: Board[];
  sellers: SellerRow[];
  total: SellerRow;
  needs: Needs;
}

export interface SalesSettings {
  crew_people: number | null;
  crew_days_per_week: number | null;
  crew_hours_per_day: number;
  cost_per_hour_cents: number | null;
  target_margin_bps: number;
}

const within = (iso: string | null, from: number, to: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return t >= from && t < to;
};

function row(user_id: Id | null, list: SalesEstimate[], from: number, to: number): SellerRow {
  const approved = list.filter((e) => within(e.approved_at, from, to));
  const declined = list.filter((e) => within(e.declined_at, from, to));
  const decided = approved.length + declined.length;
  const sold = approved.reduce((n, e) => n + e.subtotal_cents, 0);
  return {
    user_id,
    sent: list.filter((e) => within(e.sent_at, from, to)).length,
    approved: approved.length,
    declined: declined.length,
    closeRate: decided > 0 ? approved.length / decided : null,
    avgTicketCents: approved.length ? Math.round(sold / approved.length) : null,
    soldCents: sold,
  };
}

/**
 * Who is selling what, and whether enough estimates are going out. "Enough" works backwards from what the crew costs:
 * sales needed = cost (and cost plus the profit target), estimates needed = sales needed / (average ticket x close rate).
 */
const dollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');
export const MIN_DECIDED = 3;

/** One ranking per category, best first. A close rate or average ticket only counts once someone has enough decided estimates. */
export function leaderboards(sellers: SellerRow[], pace: { user_id: Id; rate: number }[] = []): Board[] {
  const people = sellers.filter((s): s is SellerRow & { user_id: Id } => s.user_id !== null);
  const rank = (rows: Leader[]) => rows.sort((a, b) => b.value - a.value).slice(0, 10);
  const decided = (s: SellerRow) => s.approved + s.declined >= MIN_DECIDED;
  return [
    {
      id: 'sold',
      title: 'Most sold',
      rule: 'Total of estimates customers approved',
      leaders: rank(people.filter((s) => s.soldCents > 0).map((s) => ({ user_id: s.user_id, value: s.soldCents, shown: dollars(s.soldCents) }))),
    },
    {
      id: 'close',
      title: 'Best close rate',
      rule: `Approved out of decided (needs ${MIN_DECIDED} decided)`,
      leaders: rank(
        people.filter((s) => decided(s) && s.closeRate !== null).map((s) => ({ user_id: s.user_id, value: s.closeRate as number, shown: `${Math.round((s.closeRate as number) * 100)}%` })),
      ),
    },
    {
      id: 'ticket',
      title: 'Biggest average ticket',
      rule: 'Average approved estimate',
      leaders: rank(people.filter((s) => s.avgTicketCents !== null).map((s) => ({ user_id: s.user_id, value: s.avgTicketCents as number, shown: dollars(s.avgTicketCents as number) }))),
    },
    {
      id: 'sent',
      title: 'Most estimates sent',
      rule: 'Estimates sent out',
      leaders: rank(people.filter((s) => s.sent > 0).map((s) => ({ user_id: s.user_id, value: s.sent, shown: String(s.sent) }))),
    },
    {
      id: 'approved',
      title: 'Most jobs won',
      rule: 'Estimates approved',
      leaders: rank(people.filter((s) => s.approved > 0).map((s) => ({ user_id: s.user_id, value: s.approved, shown: String(s.approved) }))),
    },
    // lower is faster: finishing in 80% of the scheduled time beats finishing in 100%
    {
      id: 'pace',
      title: 'Beats the clock',
      rule: 'Job time compared with scheduled time (lower is faster)',
      leaders: rank(pace.map((p) => ({ user_id: p.user_id, value: -p.rate, shown: `${Math.round(p.rate * 100)}% of scheduled time` }))),
    },
  ];
}

export function computeSales(i: { now: number; windowDays: number; estimates: SalesEstimate[]; settings: SalesSettings; pace?: { user_id: Id; rate: number }[] }): SalesReport {
  const to = i.now;
  const from = to - i.windowDays * DAY;
  const ids = [...new Set(i.estimates.map((e) => e.sold_by))];
  const sellers = ids
    .map((id) =>
      row(
        id,
        i.estimates.filter((e) => e.sold_by === id),
        from,
        to,
      ),
    )
    .filter((r) => r.sent + r.approved + r.declined > 0)
    .sort((a, b) => b.soldCents - a.soldCents || b.sent - a.sent);
  const total = row(null, i.estimates, from, to);

  const s = i.settings;
  const perMonth = 30 / i.windowDays;
  const sentPerMonth = Math.round(total.sent * perMonth * 10) / 10;
  const monthlyCost =
    s.crew_people && s.crew_days_per_week && s.cost_per_hour_cents ? Math.round(s.crew_people * s.crew_days_per_week * s.crew_hours_per_day * (52 / 12) * s.cost_per_hour_cents) : null;
  const margin = Math.min(0.9, Math.max(0, s.target_margin_bps / 10000));
  const target = monthlyCost === null ? null : Math.round(monthlyCost / (1 - margin));
  const perEstimate = total.avgTicketCents !== null && total.closeRate !== null ? total.avgTicketCents * total.closeRate : null;
  const need = (sales: number | null) => (sales === null || perEstimate === null || perEstimate <= 0 ? null : Math.ceil((sales / perEstimate) * 10) / 10);
  const targetEstimates = need(target);
  const gap = targetEstimates === null ? null : Math.round((sentPerMonth - targetEstimates) * 10) / 10;
  let verdict: Needs['verdict'] = 'unknown';
  let missing: string | undefined;
  if (monthlyCost === null) missing = 'Set up your crew and hourly cost on the company hourly rate page so I can tell what you have to sell.';
  else if (perEstimate === null) missing = 'Not enough approved and declined estimates in this period to know your average ticket and close rate yet.';
  else if (targetEstimates !== null) verdict = sentPerMonth >= targetEstimates ? 'enough' : sentPerMonth >= targetEstimates * 0.85 ? 'close' : 'short';

  return {
    windowDays: i.windowDays,
    boards: leaderboards(sellers, i.pace),
    sellers,
    total,
    needs: { monthlyCostCents: monthlyCost, breakEvenSalesCents: monthlyCost, targetSalesCents: target, breakEvenEstimates: need(monthlyCost), targetEstimates, sentPerMonth, gap, verdict, missing },
  };
}
