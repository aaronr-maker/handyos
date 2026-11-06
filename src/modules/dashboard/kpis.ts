import type { Id } from '@/core';

/**
 * The business dashboard's numbers and its answer to "what is my constraint right now?". Pure functions over plain records so
 * every number can be checked. Windows are the last 30 days, compared with the 30 before.
 */
export const DAY = 86_400_000;
export const WINDOW_DAYS = 30;

export interface DashInput {
  now: number;
  estimates: { status: string; sold_by: Id | null; subtotal_cents: number; sent_at: string | null; approved_at: string | null; declined_at: string | null }[];
  invoices: { status: string; total_cents: number; amount_paid_cents: number; issued_on: string | null; paid_at: string | null; due_date: string }[];
  /** Payments with the sales tax already taken out. */
  payments: { received_on: string; revenue_cents: number }[];
  jobs: { id: Id; status: string; scheduled_start: string | null; scheduled_end: string | null; completed_at: string | null }[];
  assignments: { job_id: Id; user_id: Id }[];
  shifts: { user_id: Id; clock_in: string; clock_out: string | null }[];
  entries: { user_id: Id; clock_in: string; clock_out: string | null }[];
  /** Finished jobs with what was invoiced and what was left after costs. */
  jobMargins: { completed_at: string; invoiced_cents: number; profit_cents: number }[];
  settings: { crew_people: number | null; crew_days_per_week: number | null; crew_hours_per_day: number; cost_per_hour_cents: number | null; target_margin_bps: number };
  /** Efficiency rate per person (actual over scheduled time). */
  efficiency: Record<Id, number>;
}

export type Status = 'good' | 'watch' | 'bad' | 'unknown';

export interface Kpi {
  id: string;
  area: 'Sales' | 'Production' | 'Profit' | 'Cash';
  label: string;
  /** The value to show, already formatted; null when there is not enough data. */
  value: string | null;
  raw: number | null;
  /** The same figure for the 30 days before, to show a trend. */
  previous: number | null;
  target: string;
  status: Status;
  note?: string;
}

export const TARGETS = { closeRate: 0.4, utilization: 0.65, backlogMinWeeks: 1.5, backlogMaxWeeks: 6, daysToCollect: 14, overdueShare: 0.1 };

const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const inWindow = (iso: string | null, from: number, to: number) => {
  const v = t(iso);
  return v >= from && v < to;
};
const minutes = (s: { clock_in: string; clock_out: string | null }, from: number, to: number, now: number) => {
  const a = Math.max(Date.parse(s.clock_in), from);
  const b = Math.min(s.clock_out ? Date.parse(s.clock_out) : now, to);
  return Math.max(0, (b - a) / 60000);
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');
const mean = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);

interface Window {
  closeRate: number | null;
  decided: number;
  sent: number;
  avgTicket: number | null;
  utilization: number | null;
  jobMinutes: number;
  revenue: number;
  revenuePerHour: number | null;
  margin: number | null;
  daysToCollect: number | null;
}

function measure(d: DashInput, from: number, to: number): Window {
  const approved = d.estimates.filter((e) => inWindow(e.approved_at, from, to));
  const declined = d.estimates.filter((e) => inWindow(e.declined_at, from, to));
  const decided = approved.length + declined.length;
  const shiftMin = d.shifts.reduce((n, s) => n + minutes(s, from, to, d.now), 0);
  const jobMin = d.entries.reduce((n, e) => n + minutes(e, from, to, d.now), 0);
  const revenue = d.payments.filter((p) => inWindow(p.received_on, from, to)).reduce((n, p) => n + p.revenue_cents, 0);
  const done = d.jobMargins.filter((j) => inWindow(j.completed_at, from, to));
  const invoiced = done.reduce((n, j) => n + j.invoiced_cents, 0);
  const paid = d.invoices.filter((i) => inWindow(i.paid_at, from, to) && i.issued_on).map((i) => (t(i.paid_at) - t(i.issued_on)) / DAY);
  return {
    closeRate: decided > 0 ? approved.length / decided : null,
    decided,
    sent: d.estimates.filter((e) => inWindow(e.sent_at, from, to)).length,
    avgTicket: mean(approved.map((e) => e.subtotal_cents)),
    utilization: shiftMin > 0 ? Math.min(1, jobMin / shiftMin) : null,
    jobMinutes: jobMin,
    revenue,
    revenuePerHour: jobMin >= 60 ? revenue / (jobMin / 60) : null,
    margin: invoiced > 0 ? done.reduce((n, j) => n + j.profit_cents, 0) / invoiced : null,
    daysToCollect: mean(paid),
  };
}

export interface Dashboard {
  kpis: Kpi[];
  /** Whole weeks of booked work ahead, in crew-weeks; null without a crew set up. */
  backlogWeeks: number | null;
  sellers: { user_id: Id; approved: number; decided: number; rate: number | null; sold_cents: number }[];
  techs: { user_id: Id; hours: number; efficiency: number | null }[];
  constraint: Constraint;
}

export interface Constraint {
  id: 'capacity' | 'sales' | 'leads' | 'profit' | 'cash' | 'none' | 'unknown';
  label: string;
  why: string[];
  tries: string[];
}

export function computeDashboard(d: DashInput): Dashboard {
  const to = d.now;
  const from = to - WINDOW_DAYS * DAY;
  const cur = measure(d, from, to);
  const prev = measure(d, from - WINDOW_DAYS * DAY, from);
  const s = d.settings;

  // booked work ahead, in man-time, against the crew's weekly capacity
  const weekly = s.crew_people && s.crew_days_per_week ? s.crew_people * s.crew_days_per_week * s.crew_hours_per_day * 60 : null;
  const aheadMin = d.jobs
    .filter((j) => j.status !== 'completed' && j.scheduled_start && j.scheduled_end && Date.parse(j.scheduled_end) > d.now)
    .reduce((n, j) => {
      const people = Math.max(1, d.assignments.filter((a) => a.job_id === j.id).length);
      const a = Math.max(Date.parse(j.scheduled_start!), d.now);
      return n + ((Date.parse(j.scheduled_end!) - a) / 60000) * people;
    }, 0);
  const backlogWeeks = weekly ? Math.round((aheadMin / weekly) * 10) / 10 : null;

  const open = d.invoices.filter((i) => i.status === 'sent' || i.status === 'overdue');
  const owed = open.reduce((n, i) => n + Math.max(0, i.total_cents - i.amount_paid_cents), 0);
  const overdue = open.filter((i) => Date.parse(`${i.due_date}T23:59:59`) < d.now).reduce((n, i) => n + Math.max(0, i.total_cents - i.amount_paid_cents), 0);
  const overdueShare = owed > 0 ? overdue / owed : null;
  const targetMargin = s.target_margin_bps / 10000;

  const rate = (v: number | null, good: number, watch: number, higherIsBetter = true): Status => (v === null ? 'unknown' : higherIsBetter ? (v >= good ? 'good' : v >= watch ? 'watch' : 'bad') : v <= good ? 'good' : v <= watch ? 'watch' : 'bad');
  const costPerHour = s.cost_per_hour_cents;
  const perHourMargin = cur.revenuePerHour !== null && costPerHour !== null ? cur.revenuePerHour - costPerHour : null;

  const kpis: Kpi[] = [
    { id: 'close_rate', area: 'Sales', label: 'Close rate', value: cur.closeRate === null ? null : pct(cur.closeRate), raw: cur.closeRate, previous: prev.closeRate, target: `${pct(TARGETS.closeRate)} or more`, status: cur.decided < 3 ? 'unknown' : rate(cur.closeRate, TARGETS.closeRate, TARGETS.closeRate * 0.75), note: `${cur.decided} estimates decided` },
    { id: 'estimates_sent', area: 'Sales', label: 'Estimates sent', value: String(cur.sent), raw: cur.sent, previous: prev.sent, target: 'steady or growing', status: prev.sent > 0 ? (cur.sent >= prev.sent ? 'good' : cur.sent >= prev.sent * 0.8 ? 'watch' : 'bad') : 'unknown' },
    { id: 'avg_ticket', area: 'Sales', label: 'Average job sold', value: cur.avgTicket === null ? null : money(cur.avgTicket), raw: cur.avgTicket, previous: prev.avgTicket, target: 'trending up', status: cur.avgTicket !== null && prev.avgTicket !== null ? (cur.avgTicket >= prev.avgTicket ? 'good' : 'watch') : 'unknown' },
    { id: 'backlog', area: 'Production', label: 'Booked work ahead', value: backlogWeeks === null ? null : `${backlogWeeks} weeks`, raw: backlogWeeks, previous: null, target: `${TARGETS.backlogMinWeeks} to ${TARGETS.backlogMaxWeeks} weeks`, status: backlogWeeks === null ? 'unknown' : backlogWeeks < TARGETS.backlogMinWeeks ? 'bad' : backlogWeeks > TARGETS.backlogMaxWeeks ? 'watch' : 'good', note: weekly ? undefined : 'Set up the crew on the company hourly rate page' },
    { id: 'utilization', area: 'Production', label: 'Time on jobs vs paid time', value: cur.utilization === null ? null : pct(cur.utilization), raw: cur.utilization, previous: prev.utilization, target: `${pct(TARGETS.utilization)} or more`, status: rate(cur.utilization, TARGETS.utilization, TARGETS.utilization * 0.8), note: 'Needs the day clock in use' },
    { id: 'revenue_hour', area: 'Production', label: 'Revenue per man-hour', value: cur.revenuePerHour === null ? null : money(cur.revenuePerHour), raw: cur.revenuePerHour, previous: prev.revenuePerHour, target: costPerHour === null ? 'above your cost per hour' : `above ${money(costPerHour)} cost`, status: perHourMargin === null ? 'unknown' : perHourMargin > 0 ? 'good' : 'bad', note: perHourMargin === null ? undefined : `${perHourMargin >= 0 ? 'Leaves' : 'Loses'} ${money(Math.abs(perHourMargin))} per hour` },
    { id: 'job_margin', area: 'Profit', label: 'Profit on finished jobs', value: cur.margin === null ? null : pct(cur.margin), raw: cur.margin, previous: prev.margin, target: `${pct(targetMargin)} or more`, status: rate(cur.margin, targetMargin, targetMargin * 0.75) },
    { id: 'owed', area: 'Cash', label: 'Owed to you', value: money(owed), raw: owed, previous: null, target: 'low', status: 'unknown' },
    { id: 'overdue', area: 'Cash', label: 'Overdue', value: overdueShare === null ? null : `${money(overdue)} (${pct(overdueShare)})`, raw: overdueShare, previous: null, target: `under ${pct(TARGETS.overdueShare)} of what is owed`, status: rate(overdueShare, TARGETS.overdueShare, TARGETS.overdueShare * 2, false) },
    { id: 'days_to_collect', area: 'Cash', label: 'Days to get paid', value: cur.daysToCollect === null ? null : `${Math.round(cur.daysToCollect)} days`, raw: cur.daysToCollect, previous: prev.daysToCollect, target: `${TARGETS.daysToCollect} days or fewer`, status: rate(cur.daysToCollect, TARGETS.daysToCollect, TARGETS.daysToCollect * 1.5, false) },
  ];

  // ---- leaderboards ----
  const sellerIds = [...new Set(d.estimates.map((e) => e.sold_by).filter((x): x is Id => !!x))];
  const sellers = sellerIds
    .map((id) => {
      const mine = d.estimates.filter((e) => e.sold_by === id);
      const approved = mine.filter((e) => inWindow(e.approved_at, from, to));
      const decided = approved.length + mine.filter((e) => inWindow(e.declined_at, from, to)).length;
      return { user_id: id, approved: approved.length, decided, rate: decided > 0 ? approved.length / decided : null, sold_cents: approved.reduce((n, e) => n + e.subtotal_cents, 0) };
    })
    .filter((x) => x.decided > 0)
    .sort((a, b) => b.sold_cents - a.sold_cents);
  const techIds = [...new Set(d.entries.map((e) => e.user_id))];
  const techs = techIds
    .map((id) => ({ user_id: id, hours: Math.round(d.entries.filter((e) => e.user_id === id).reduce((n, e) => n + minutes(e, from, to, d.now), 0) / 6) / 10, efficiency: d.efficiency[id] ?? null }))
    .filter((x) => x.hours > 0)
    .sort((a, b) => b.hours - a.hours);

  return { kpis, backlogWeeks, sellers, techs, constraint: findConstraint({ cur, prev, backlogWeeks, overdueShare, targetMargin, perHourMargin }) };
}

/**
 * The constraint is the first stage, working from the work coming in to the money coming back, that is holding the business
 * back: a full schedule means capacity; an empty one means sales or leads; healthy volume with thin profit means pricing and
 * efficiency; slow money means collection. It names one, with the numbers behind it and things to try.
 */
function findConstraint(i: { cur: Window; prev: Window; backlogWeeks: number | null; overdueShare: number | null; targetMargin: number; perHourMargin: number | null }): Constraint {
  const { cur, backlogWeeks } = i;
  const enough = cur.decided >= 3 || backlogWeeks !== null || cur.margin !== null;
  if (!enough) return { id: 'unknown', label: 'Not enough data yet', why: ['The dashboard needs a few weeks of estimates, scheduled jobs, hours and payments in the app to see where the business is held back.'], tries: ['Keep using the app for estimates, scheduling, the clocks and payments.'] };

  if (backlogWeeks !== null && backlogWeeks > TARGETS.backlogMaxWeeks) {
    return {
      id: 'capacity',
      label: 'Capacity: you have more work booked than the crew can do',
      why: [`${backlogWeeks} weeks of work are booked, over the ${TARGETS.backlogMaxWeeks}-week comfort level.`, ...(cur.utilization !== null ? [`Techs spend ${pct(cur.utilization)} of paid time on jobs.`] : [])],
      tries: ['Raise prices a little: a long backlog means demand is higher than you can serve.', 'Cut drive and set-up time (the gap between paid time and time on jobs).', 'Check standard times for slow services and fix how they are done.', 'Add a tech or a subcontractor for the overflow.'],
    };
  }
  if (backlogWeeks !== null && backlogWeeks < TARGETS.backlogMinWeeks) {
    if (cur.closeRate !== null && cur.decided >= 3 && cur.closeRate < TARGETS.closeRate) {
      return {
        id: 'sales',
        label: 'Sales: estimates are not turning into jobs',
        why: [`Only ${pct(cur.closeRate)} of decided estimates were approved (target ${pct(TARGETS.closeRate)}).`, `Booked work is down to ${backlogWeeks} weeks.`],
        tries: ['Follow up on every open estimate within two days.', 'Compare close rates by seller below and learn from the best.', 'Offer good, better and best options on each estimate.', 'Check whether declined estimates were too high or too slow to arrive.'],
      };
    }
    return {
      id: 'leads',
      label: 'Leads: not enough estimates are coming in',
      why: [`Booked work is down to ${backlogWeeks} weeks and the close rate is ${cur.closeRate === null ? 'not yet known' : pct(cur.closeRate)}.`, `${cur.sent} estimates were sent in the last 30 days.`],
      tries: ['Ask recent happy customers for reviews and referrals.', 'Put more into the marketing that is already bringing calls.', 'Call past customers who have not booked in a year.'],
    };
  }
  if ((cur.margin !== null && cur.margin < i.targetMargin * 0.75) || (i.perHourMargin !== null && i.perHourMargin <= 0)) {
    return {
      id: 'profit',
      label: 'Profit: the work is not paying enough',
      why: [...(cur.margin !== null ? [`Finished jobs kept ${pct(cur.margin)} (target ${pct(i.targetMargin)}).`] : []), ...(i.perHourMargin !== null ? [`Revenue per man-hour is ${i.perHourMargin >= 0 ? 'only ' + money(i.perHourMargin) + ' above' : money(-i.perHourMargin) + ' below'} your cost per hour.`] : [])],
      tries: ['Raise the price on the services with the worst margin.', 'Look at jobs that took far longer than the standard times.', 'Check materials: are they marked up enough and billed in full?'],
    };
  }
  if (i.overdueShare !== null && i.overdueShare > TARGETS.overdueShare * 2) {
    return {
      id: 'cash',
      label: 'Cash: money is coming in too slowly',
      why: [`${pct(i.overdueShare)} of what customers owe is overdue.`, ...(cur.daysToCollect !== null ? [`It takes ${Math.round(cur.daysToCollect)} days on average to get paid.`] : [])],
      tries: ['Send overdue reminders the day after the due date.', 'Collect payment on completion, by card, before the tech leaves.', 'Ask for a deposit on larger jobs.'],
    };
  }
  return { id: 'none', label: 'No clear constraint: things are in balance', why: ['Work booked, close rate, profit and collections are all inside their targets.'], tries: ['Pick the number you most want to improve, and push it one step.'] };
}
