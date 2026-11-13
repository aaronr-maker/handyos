import { parseCsv } from '@/core';

/**
 * Reads the reports exported from the old system (Jobber): jobs, invoices, payments, timesheets, and the per-person sales and
 * productivity summaries. It works out which kind of report a file is from its column names, and turns each row into plain numbers
 * and dates. Client emails and phone numbers are never read: the dashboards do not need them.
 */
export type ReportKind = 'jobs' | 'invoices' | 'payments' | 'timesheets' | 'salespeople' | 'productivity';

export const REPORT_LABEL: Record<ReportKind, string> = {
  jobs: 'Jobs',
  invoices: 'Invoices',
  payments: 'Payments',
  timesheets: 'Timesheets',
  salespeople: 'Salesperson performance',
  productivity: 'Team productivity',
};

export interface JobRow {
  job_number: number;
  client_name: string;
  lead_source: string;
  service_address: string;
  title: string;
  created_on: string | null;
  scheduled_on: string | null;
  closed_on: string | null;
  salesperson: string;
  crew: string;
  line_items: string;
  invoice_numbers: string;
  quote_number: string;
  revenue_cents: number;
  cost_cents: number;
  labour_cost_cents: number;
  profit_cents: number;
  hours_tracked: number;
  budget_hours: number;
}
export interface InvoiceRow {
  invoice_number: number;
  client_name: string;
  lead_source: string;
  subject: string;
  created_on: string | null;
  issued_on: string | null;
  due_on: string | null;
  paid_on: string | null;
  days_to_pay: number | null;
  salesperson: string;
  status: string;
  job_numbers: string;
  subtotal_cents: number;
  total_cents: number;
  balance_cents: number;
  tax_cents: number;
}
export interface PaymentRow {
  external_key: string;
  client_name: string;
  paid_on: string | null;
  kind: string;
  method: string;
  total_cents: number;
  fee_cents: number;
  invoice_number: string;
}
export interface TimesheetSummary {
  /** hours worked per job number, all people together */
  jobs: { job_number: number; hours: number }[];
  /** the report's own "Total Hours" figure (all time tracked, on jobs and off) */
  reported_total_hours: number;
}
export interface SalespersonRow {
  person: string;
  sent_quotes: number;
  sent_cents: number;
  converted_quotes: number;
  converted_cents: number;
  issued_invoices: number;
  issued_cents: number;
}
export interface ProductivityRow {
  person: string;
  visits: number;
  job_revenue_cents: number;
  job_hours: number;
  general_hours: number;
  total_hours: number;
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** "Aug 03, 2026" gives "2026-08-03". Anything else (a dash, blank) gives null. */
export function parseDay(text: string | undefined): string | null {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec((text ?? '').trim());
  const month = m ? MONTHS[m[1].toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${m[2].padStart(2, '0')}` : null;
}

/** "1,716.38" or "-121.46" or "$40" gives whole cents (the sign is kept). */
export function parseMoney(text: string | undefined): number {
  const n = Number(String(text ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const parseNumber = (text: string | undefined): number => {
  const n = Number(String(text ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** "1405:25" gives 1405.42 hours. */
export function parseClock(text: string | undefined): number {
  const m = /^(\d+):(\d{2})$/.exec((text ?? '').trim());
  return m ? Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100 : parseNumber(text);
}

/** Works out which kind of report these rows are, or null when it is not one we know. */
export function detectReport(rows: string[][]): ReportKind | null {
  const head = (rows[0] ?? []).map((h) => h.trim());
  const has = (...names: string[]) => names.every((n) => head.includes(n));
  if (head[0] === 'Totals') return 'timesheets';
  if (has('Job #', 'Job revenue ($)')) return 'jobs';
  if (has('Invoice #', 'Marked paid date')) return 'invoices';
  if (has('Client name', 'Paid with', 'Payout #')) return 'payments';
  if (has('Salesperson', 'Sent quotes', 'Converted quotes')) return 'salespeople';
  if (has('Name', 'Visits', 'Job productivity')) return 'productivity';
  return null;
}

function table(rows: string[][]) {
  const head = (rows[0] ?? []).map((h) => h.trim());
  const at = new Map(head.map((h, i) => [h, i]));
  return {
    body: rows.slice(1).filter((r) => r.some((c) => c.trim() !== '')),
    get: (r: string[], name: string) => (at.has(name) ? (r[at.get(name) as number] ?? '').trim() : ''),
  };
}

export function parseJobs(rows: string[][]): JobRow[] {
  const t = table(rows);
  return t.body
    .map((r) => {
      const street = [t.get(r, 'Service street'), t.get(r, 'Service city'), [t.get(r, 'Service province'), t.get(r, 'Service ZIP')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      return {
        job_number: Math.round(parseNumber(t.get(r, 'Job #'))),
        client_name: t.get(r, 'Client name'),
        lead_source: t.get(r, 'Lead source'),
        service_address: street,
        title: t.get(r, 'Title'),
        created_on: parseDay(t.get(r, 'Created date')),
        scheduled_on: parseDay(t.get(r, 'Scheduled start date')),
        closed_on: parseDay(t.get(r, 'Closed date')),
        salesperson: t.get(r, 'Salesperson'),
        crew: t.get(r, 'Visits assigned to'),
        line_items: t.get(r, 'Line items').slice(0, 500),
        invoice_numbers: t.get(r, 'Invoice #s'),
        quote_number: t.get(r, 'Quote #'),
        revenue_cents: parseMoney(t.get(r, 'Job revenue ($)')),
        cost_cents: parseMoney(t.get(r, 'Total costs ($)')),
        labour_cost_cents: parseMoney(t.get(r, 'Labour cost total ($)')),
        profit_cents: parseMoney(t.get(r, 'Profit ($)')),
        hours_tracked: parseNumber(t.get(r, 'Time tracked')),
        budget_hours: parseNumber(t.get(r, 'BH')),
      };
    })
    .filter((j) => j.job_number > 0);
}

export function parseInvoices(rows: string[][]): InvoiceRow[] {
  const t = table(rows);
  return t.body
    .map((r) => {
      const days = t.get(r, 'Invoice payment time (days)');
      return {
        invoice_number: Math.round(parseNumber(t.get(r, 'Invoice #'))),
        client_name: t.get(r, 'Client name'),
        lead_source: t.get(r, 'Lead source'),
        subject: t.get(r, 'Subject'),
        created_on: parseDay(t.get(r, 'Created date')),
        issued_on: parseDay(t.get(r, 'Issued date')),
        due_on: parseDay(t.get(r, 'Due date')),
        paid_on: parseDay(t.get(r, 'Marked paid date')),
        days_to_pay: days === '' || days === '-' ? null : Math.round(parseNumber(days)),
        salesperson: t.get(r, 'Salesperson'),
        status: t.get(r, 'Status'),
        job_numbers: t.get(r, 'Job #s'),
        subtotal_cents: parseMoney(t.get(r, 'Pre-tax total ($)')),
        total_cents: parseMoney(t.get(r, 'Total ($)')),
        balance_cents: parseMoney(t.get(r, 'Balance ($)')),
        tax_cents: parseMoney(t.get(r, 'Tax amount ($)')),
      };
    })
    .filter((i) => i.invoice_number > 0);
}

export function parsePayments(rows: string[][]): PaymentRow[] {
  const t = table(rows);
  return t.body
    .filter((r) => t.get(r, 'Client name') !== '' && t.get(r, 'Type') !== '')
    .map((r) => {
      const paid = parseDay(t.get(r, 'Date'));
      // the report lists payments as negative amounts; a payment is money in
      const total = Math.abs(parseMoney(t.get(r, 'Total $')));
      const payout = t.get(r, 'Payout #');
      return {
        external_key: [paid, t.get(r, 'Time'), t.get(r, 'Client name'), total, t.get(r, 'Invoice #'), payout].join('|'),
        client_name: t.get(r, 'Client name'),
        paid_on: paid,
        kind: t.get(r, 'Type'),
        method: t.get(r, 'Paid with'),
        total_cents: total,
        fee_cents: Math.abs(parseMoney(t.get(r, 'Fee $'))),
        invoice_number: t.get(r, 'Invoice #'),
      };
    });
}

/**
 * The timesheet report lists hours with what was worked on ("Job #4 - Client", "General", "Unknown Job"). Only the hours on a
 * numbered job are used: the "General" lines overlap each other (adding them up gives more than the report's own total), so the
 * report's "Total Hours" line is kept as the overall figure instead.
 */
export function parseTimesheets(rows: string[][]): TimesheetSummary {
  const perJob = new Map<number, number>();
  let reported = 0;
  for (const r of rows) {
    if ((r[0] ?? '').trim() === 'Total Hours') reported = Number(r[1]) || 0;
    if (!/^\d+(\.\d+)?$/.test((r[0] ?? '').trim()) || r.length < 2) continue;
    const job = /^Job #(\d+)/.exec((r[1] ?? '').trim());
    if (job) perJob.set(Number(job[1]), (perJob.get(Number(job[1])) ?? 0) + Number(r[0]));
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { jobs: [...perJob.entries()].map(([job_number, h]) => ({ job_number, hours: round(h) })), reported_total_hours: reported };
}

export function parseSalespeople(rows: string[][]): SalespersonRow[] {
  const t = table(rows);
  return t.body.map((r) => ({
    person: t.get(r, 'Salesperson'),
    sent_quotes: Math.round(parseNumber(t.get(r, 'Sent quotes'))),
    sent_cents: parseMoney(t.get(r, 'Sent quotes ($)')),
    converted_quotes: Math.round(parseNumber(t.get(r, 'Converted quotes'))),
    converted_cents: parseMoney(t.get(r, 'Converted quotes ($)')),
    issued_invoices: Math.round(parseNumber(t.get(r, 'Issued invoices'))),
    issued_cents: parseMoney(t.get(r, 'Issued invoices ($)')),
  }));
}

export function parseProductivity(rows: string[][]): ProductivityRow[] {
  const t = table(rows);
  return t.body.map((r) => ({
    person: t.get(r, 'Name'),
    visits: Math.round(parseNumber(t.get(r, 'Visits'))),
    job_revenue_cents: parseMoney(t.get(r, 'Job revenue')),
    job_hours: parseClock(t.get(r, 'Time tracked on jobs')),
    general_hours: parseClock(t.get(r, 'General time tracked')),
    total_hours: parseClock(t.get(r, 'Total time tracked')),
  }));
}

export type Parsed =
  | { kind: 'jobs'; rows: JobRow[] }
  | { kind: 'invoices'; rows: InvoiceRow[] }
  | { kind: 'payments'; rows: PaymentRow[] }
  | { kind: 'timesheets'; summary: TimesheetSummary }
  | { kind: 'salespeople'; rows: SalespersonRow[] }
  | { kind: 'productivity'; rows: ProductivityRow[] };

/** Reads a file's text and says what it is and what is in it. */
export function readReport(text: string): Parsed | null {
  const rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  switch (detectReport(rows)) {
    case 'jobs':
      return { kind: 'jobs', rows: parseJobs(rows) };
    case 'invoices':
      return { kind: 'invoices', rows: parseInvoices(rows) };
    case 'payments':
      return { kind: 'payments', rows: parsePayments(rows) };
    case 'timesheets':
      return { kind: 'timesheets', summary: parseTimesheets(rows) };
    case 'salespeople':
      return { kind: 'salespeople', rows: parseSalespeople(rows) };
    case 'productivity':
      return { kind: 'productivity', rows: parseProductivity(rows) };
    default:
      return null;
  }
}
