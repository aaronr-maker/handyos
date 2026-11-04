import type { Cents } from '@/core';
import { parseCsv } from '@/core';

export type Field = 'date' | 'amount' | 'customer' | 'job' | 'invoice';
export const FIELD_LABELS: Record<Field, string> = { date: 'Date', amount: 'Amount', customer: 'Customer', job: 'Job or description', invoice: 'Invoice number' };

export interface ParsedFile {
  headers: string[];
  rows: string[][];
  /** The column that looks like each field (-1 when none does). */
  guess: Record<Field, number>;
}

const PATTERNS: Record<Field, RegExp[]> = {
  // a payment date is preferred over an invoice date: revenue counts when the money came in
  date: [/(paid|payment|received).*date|date.*(paid|payment|received)/i, /^date$|transaction date|invoice date|date/i],
  amount: [/^(amount paid|payment amount|paid)$/i, /^(total|amount|revenue|sales|invoice total|total amount|subtotal)$/i, /amount|total/i],
  customer: [/^(customer|client)( name)?$/i, /customer|client|name/i],
  job: [/^(job|job name|job title|description|service|memo)$/i, /job|description|service|memo|title/i],
  invoice: [/^(invoice|invoice #|invoice no\.?|invoice number|num|no\.?|number)$/i, /invoice|num/i],
};

/** Finds the header row (the first with three or more filled cells that names a date and an amount) and guesses the columns. */
export function readRevenueFile(text: string): ParsedFile | null {
  const all = parseCsv(text).map((r) => r.map((c) => c.trim()));
  const looksLikeHeader = (r: string[]) => r.filter(Boolean).length >= 3 && r.some((c) => PATTERNS.date[1].test(c)) && r.some((c) => PATTERNS.amount[2].test(c));
  const at = all.findIndex(looksLikeHeader);
  if (at < 0) return null;
  const headers = all[at];
  const find = (f: Field) => {
    for (const re of PATTERNS[f]) {
      const i = headers.findIndex((h) => h && re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const guess = { date: find('date'), amount: find('amount'), customer: find('customer'), job: find('job'), invoice: find('invoice') };
  return { headers, rows: all.slice(at + 1), guess };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "10/5/2026", "2026-10-05", "Oct 5, 2026", "05-Oct-2026" -> "2026-10-05"; null when it is not a date. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let hit: RegExpMatchArray | null;
  if ((hit = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+hit[1], +hit[2], +hit[3]];
  else if ((hit = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) [m, d, y] = [+hit[1], +hit[2], +hit[3] < 100 ? 2000 + +hit[3] : +hit[3]];
  else if ((hit = t.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/))) [m, d, y] = [MONTHS.indexOf(hit[1].toLowerCase()) + 1, +hit[2], +hit[3]];
  else if ((hit = t.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})/))) [d, m, y] = [+hit[1], MONTHS.indexOf(hit[2].toLowerCase()) + 1, +hit[3]];
  else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "$1,234.50", "(120.00)", "-120" -> cents; null when it is not an amount. */
export function parseAmount(text: string): Cents | null {
  let t = text.trim().replace(/[$,\s]/g, '');
  const negative = /^\(.*\)$/.test(t) || t.startsWith('-');
  t = t.replace(/[()-]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return negative ? -cents : cents;
}

export interface ReadEntry {
  date: string;
  amount_cents: Cents;
  customer: string;
  job: string;
  invoice_ref: string;
}

/** Turns the file's rows into entries using the chosen columns. Rows without a date and an amount (totals, blank lines) are skipped and counted. */
export function readEntries(rows: string[][], cols: Record<Field, number>): { entries: ReadEntry[]; skipped: number } {
  const entries: ReadEntry[] = [];
  let skipped = 0;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  for (const r of rows) {
    if (r.every((c) => !c.trim())) continue;
    const date = parseDate(cell(r, cols.date));
    const amount = parseAmount(cell(r, cols.amount));
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    entries.push({ date, amount_cents: amount, customer: cell(r, cols.customer), job: cell(r, cols.job), invoice_ref: cell(r, cols.invoice) });
  }
  return { entries, skipped };
}
