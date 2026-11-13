import { createRepo, type Id } from '@/core';
import type { InvoiceRow, JobRow, PaymentRow, Parsed } from './parse';
import type { HistoryInvoice, HistoryJob, HistoryJobHours, HistoryPayment, HistoryPerson } from './types';

const jobs = createRepo<HistoryJob>('history_jobs');
const invoices = createRepo<HistoryInvoice>('history_invoices');
const payments = createRepo<HistoryPayment>('history_payments');
const hours = createRepo<HistoryJobHours>('history_job_hours');
const people = createRepo<HistoryPerson>('history_people');

export interface JobsData {
  jobs: HistoryJob[];
  invoices: HistoryInvoice[];
  payments: HistoryPayment[];
  hours: HistoryJobHours[];
  people: HistoryPerson[];
}

export async function loadJobsData(companyId: Id): Promise<JobsData> {
  const [j, i, p, h, pe] = await Promise.all([jobs.list(companyId), invoices.list(companyId), payments.list(companyId), hours.list(companyId), people.list(companyId)]);
  return { jobs: j, invoices: i, payments: p, hours: h, people: pe };
}

const CHUNK = 500;
async function replace<T>(
  repo: { removeWhere(c: Id, w: Record<string, string>): Promise<number>; insertMany(c: Id, rows: never[]): Promise<unknown[]> },
  companyId: Id,
  source: string,
  rows: T[],
  extra: Record<string, string> = {},
) {
  // a report is the whole picture, so loading it again replaces what an earlier load of the same report put in
  await repo.removeWhere(companyId, { source, ...extra });
  for (let i = 0; i < rows.length; i += CHUNK) await repo.insertMany(companyId, rows.slice(i, i + CHUNK).map((r) => ({ ...r, source, ...extra })) as never[]);
}

/** Loads one report from `source` (like "jobber"), replacing what an earlier load of the same kind of report from the same place put in. */
export async function importReport(companyId: Id, source: string, parsed: Parsed): Promise<number> {
  switch (parsed.kind) {
    case 'jobs':
      await replace<JobRow>(jobs, companyId, source, parsed.rows);
      return parsed.rows.length;
    case 'invoices':
      await replace<InvoiceRow>(invoices, companyId, source, parsed.rows);
      return parsed.rows.length;
    case 'payments':
      await replace<PaymentRow>(payments, companyId, source, parsed.rows);
      return parsed.rows.length;
    case 'timesheets':
      await replace(hours, companyId, source, parsed.summary.jobs);
      await people.removeWhere(companyId, { source, report: 'timesheet_total' });
      await people.insertMany(companyId, [{ source, report: 'timesheet_total' as const, person: '', data: { hours: parsed.summary.reported_total_hours } }]);
      return parsed.summary.jobs.length;
    case 'salespeople':
    case 'productivity':
      await people.removeWhere(companyId, { source, report: parsed.kind });
      await people.insertMany(
        companyId,
        parsed.rows.map((r) => ({ source, report: parsed.kind, person: r.person, data: Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'person')) as Record<string, number> })),
      );
      return parsed.rows.length;
  }
}

export async function clearSource(companyId: Id, source: string): Promise<void> {
  for (const repo of [jobs, invoices, payments, hours, people]) await repo.removeWhere(companyId, { source });
}
