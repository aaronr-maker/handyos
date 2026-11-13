import type { BaseRecord } from '@/core';
import type { InvoiceRow, JobRow, PaymentRow } from './parse';

type History<T> = BaseRecord & T & { source: string };
export type HistoryJob = History<JobRow>;
export type HistoryInvoice = History<InvoiceRow>;
export type HistoryPayment = History<PaymentRow>;
export type HistoryJobHours = History<{ job_number: number; hours: number }>;
export type HistoryPerson = BaseRecord & { source: string; report: 'salespeople' | 'productivity' | 'timesheet_total'; person: string; data: Record<string, number> };
