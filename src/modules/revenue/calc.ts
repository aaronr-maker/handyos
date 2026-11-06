import type { Cents } from '@/core';
import type { RevenueEntry, RevenueHistory } from './types';

/** HandyOS goes live January 1, 2027: QuickBooks is the record before it, HandyOS from then on. */
export const LAUNCH_MONTH = '2027-01';

export type RevenueSource = 'quickbooks' | 'handyos' | 'none';

export interface RevenueMonth {
  /** "2026-10" */
  month: string;
  revenue_cents: Cents;
  source: RevenueSource;
  /** The month HandyOS took over: only part of it was worked in HandyOS, and QuickBooks' figure for the rest is not added. */
  cutover: boolean;
}

export interface RevenueInputs {
  /** Income per month from the uploaded QuickBooks Profit and Loss (sales, minus discounts). */
  quickbooks: { month: string; income_cents: Cents }[];
  /** Payments received in HandyOS; the amount is what was paid, and the invoice's total and sales tax are used to take the tax out. */
  payments: { received_on: string; amount_cents: Cents; invoice_total_cents: number; invoice_tax_cents: number }[];
  /** The month HandyOS takes over; by default the month of the first payment received in it (the screen passes the launch month). */
  cutover?: string;
}

/** A payment without the sales tax collected on it: sales tax is not revenue (and QuickBooks' income leaves it out too). */
export function paymentRevenue(p: RevenueInputs['payments'][number]): Cents {
  return p.invoice_total_cents > 0 ? Math.round((p.amount_cents * (p.invoice_total_cents - p.invoice_tax_cents)) / p.invoice_total_cents) : p.amount_cents;
}

/**
 * Revenue over time: QuickBooks months before HandyOS started, HandyOS payments from then on. The switch happens
 * at the first month with a payment in HandyOS (or the month given), so nothing is counted twice.
 */
export function revenueTimeline(i: RevenueInputs): { months: RevenueMonth[]; cutover: string | null } {
  const hs: Record<string, Cents> = {};
  for (const p of i.payments) hs[p.received_on.slice(0, 7)] = (hs[p.received_on.slice(0, 7)] ?? 0) + paymentRevenue(p);
  const first = Object.keys(hs).sort()[0] ?? null;
  const cutover = i.cutover ?? first;
  const qb = Object.fromEntries(i.quickbooks.map((q) => [q.month, q.income_cents]));
  // payments recorded in HandyOS before the switch (practice runs) are not revenue history
  const all = [...new Set([...Object.keys(qb), ...Object.keys(hs).filter((m) => !cutover || m >= cutover)])].sort();
  const months: RevenueMonth[] = all.map((month) => {
    if (cutover && month >= cutover) return { month, revenue_cents: hs[month] ?? 0, source: 'handyos', cutover: month === cutover };
    return month in qb ? { month, revenue_cents: qb[month], source: 'quickbooks', cutover: false } : { month, revenue_cents: 0, source: 'none', cutover: false };
  });
  return { months, cutover };
}

/** Year totals of a timeline ("2026" -> cents). */
export function yearTotals(months: RevenueMonth[]): Record<string, Cents> {
  const out: Record<string, Cents> = {};
  for (const m of months) out[m.month.slice(0, 4)] = (out[m.month.slice(0, 4)] ?? 0) + m.revenue_cents;
  return out;
}

export type GroupBy = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'job' | 'customer';
export const GROUP_LABELS: Record<GroupBy, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year', job: 'Job', customer: 'Customer' };

export interface EntryInputs {
  /** Imported history (invoices or payments from older systems). */
  history: Pick<RevenueHistory, 'received_on' | 'amount_cents' | 'customer' | 'job' | 'source'>[];
  /** Payments received in HandyOS, with the customer and job already named. */
  payments: (RevenueInputs['payments'][number] & { customer: string; job: string })[];
  /** Monthly income from the uploaded QuickBooks Profit and Loss files. */
  quickbooks: RevenueInputs['quickbooks'];
  /** The month HandyOS takes over (history and the P&L count before it, HandyOS payments from it). */
  launch: string;
}

/**
 * Everything that counts as revenue, one entry per payment or invoice: imported history before the launch month, HandyOS
 * payments from it on. Months with no imported rows but a QuickBooks P&L total come back separately as monthly totals
 * (they have no day, job or customer, so only the month, quarter and year views can use them).
 */
export function buildEntries(i: EntryInputs): { entries: RevenueEntry[]; monthlyOnly: RevenueEntry[] } {
  const launchDay = `${i.launch}-01`;
  const entries: RevenueEntry[] = [
    ...i.history.filter((h) => h.received_on < launchDay).map((h) => ({ date: h.received_on, amount_cents: h.amount_cents, customer: h.customer, job: h.job, source: h.source })),
    ...i.payments.filter((p) => p.received_on >= launchDay).map((p) => ({ date: p.received_on, amount_cents: paymentRevenue(p), customer: p.customer, job: p.job, source: 'App' })),
  ];
  const have = new Set(entries.map((e) => e.date.slice(0, 7)));
  const monthlyOnly = i.quickbooks
    .filter((q) => q.month < i.launch && !have.has(q.month) && q.income_cents !== 0)
    .map((q) => ({ date: `${q.month}-01`, amount_cents: q.income_cents, customer: '', job: '', source: 'QuickBooks monthly total' }));
  return { entries, monthlyOnly };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The Monday of the week a "2026-10-07" falls in. */
export const weekStart = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
};
const pretty = (date: string, opts: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', opts);

export interface RevenueGroup {
  key: string;
  label: string;
  cents: Cents;
  count: number;
}

/** Revenue totals by day, week (Monday to Sunday), month, quarter or year (newest first), or by job or customer (biggest first). */
export function groupRevenue(data: { entries: RevenueEntry[]; monthlyOnly: RevenueEntry[] }, by: GroupBy): RevenueGroup[] {
  const timeCoarse = by === 'month' || by === 'quarter' || by === 'year';
  const list = timeCoarse ? [...data.entries, ...data.monthlyOnly] : data.entries;
  const keyOf = (e: RevenueEntry): [string, string] => {
    switch (by) {
      case 'day':
        return [e.date, pretty(e.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })];
      case 'week': {
        const m = weekStart(e.date);
        const end = new Date(`${m}T12:00:00`);
        end.setDate(end.getDate() + 6);
        return [m, `${pretty(m, { month: 'short', day: 'numeric' })} to ${pretty(iso(end), { month: 'short', day: 'numeric', year: 'numeric' })}`];
      }
      case 'month':
        return [e.date.slice(0, 7), pretty(e.date, { month: 'long', year: 'numeric' })];
      case 'quarter': {
        const q = Math.floor((Number(e.date.slice(5, 7)) - 1) / 3) + 1;
        return [`${e.date.slice(0, 4)}-Q${q}`, `Q${q} ${e.date.slice(0, 4)}`];
      }
      case 'year':
        return [e.date.slice(0, 4), e.date.slice(0, 4)];
      case 'job':
        return [e.job.toLowerCase(), e.job || '(no job named)'];
      case 'customer':
        return [e.customer.toLowerCase(), e.customer || '(no customer named)'];
    }
  };
  const map = new Map<string, RevenueGroup>();
  for (const e of list) {
    const [key, label] = keyOf(e);
    const g = map.get(key) ?? { key, label, cents: 0, count: 0 };
    g.cents += e.amount_cents;
    g.count += 1;
    map.set(key, g);
  }
  const out = [...map.values()];
  return by === 'job' || by === 'customer' ? out.sort((a, b) => b.cents - a.cents) : out.sort((a, b) => b.key.localeCompare(a.key));
}
