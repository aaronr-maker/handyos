import { parseCsv, type Cents } from '@/core';
import type { CostCategory } from './rateTypes';

export type PnlSection = 'cogs' | 'expense' | 'other_expense';

export interface PnlLine {
  account: string;
  amount_cents: Cents;
  section: PnlSection;
  /** The groups the account sits under, like "Job Expenses > Job Materials" (empty when it is at the top level). */
  group: string;
}

/** The totals QuickBooks itself printed on the report (in cents), so the pull can be checked against them. */
export interface PnlReported {
  income: Cents | null;
  cogs: Cents | null;
  gross_profit: Cents | null;
  expenses: Cents | null;
  net_operating_income: Cents | null;
  other_expenses: Cents | null;
  net_income: Cents | null;
}

export const emptyReported = (): PnlReported => ({ income: null, cogs: null, gross_profit: null, expenses: null, net_operating_income: null, other_expenses: null, net_income: null });

const REPORTED_ROWS: [RegExp, keyof PnlReported][] = [
  [/^total income$/i, 'income'],
  [/^total cost of goods sold$/i, 'cogs'],
  [/^total cost of sales$/i, 'cogs'],
  [/^gross profit$/i, 'gross_profit'],
  [/^total expenses$/i, 'expenses'],
  [/^net operating income$/i, 'net_operating_income'],
  [/^total other expenses$/i, 'other_expenses'],
  [/^net income$/i, 'net_income'],
];

export interface PnlResult {
  lines: PnlLine[];
  reported: PnlReported;
  /** "2026-10": the month the lines are for (from the report's month columns, or its title). */
  month_guess: string | null;
  /** For a month-by-month report: every month it has a column for. */
  available_months: string[];
  warnings: string[];
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthNumber = (word: string) => MONTH_NAMES.findIndex((m) => m.startsWith(word.toLowerCase().slice(0, 3))) + 1;

/** "$1,234.56", "(100.00)" and "-100" -> cents. Anything that isn't an amount -> null. */
export function parseAmount(text: string | undefined): Cents | null {
  if (text === undefined) return null;
  let t = text.trim().replace(/[$,\s]/g, '').replace(/−/g, '-');
  if (t === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(t) && !/^\d+\.?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return negative ? -cents : cents;
}

const SECTION_HEADERS: [RegExp, PnlSection | 'skip'][] = [
  [/^income$/i, 'skip'],
  [/^other income$/i, 'skip'],
  [/^cost of goods sold$/i, 'cogs'],
  [/^cost of sales$/i, 'cogs'],
  [/^expenses$/i, 'expense'],
  [/^other expenses$/i, 'other_expense'],
];

const SUBTOTAL = /^(total\b|net\b|gross profit|profit|net operating income|net income)/i;
const TOTAL_OF = /^total\s+(?:for\s+)?(.+)$/i;

/** A month column heading: "Oct 2026", "Nov 1-3 2026" (a part month), "October 2026". */
const MONTH_CELL = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:(\d{1,2})(?:\s*-\s*(\d{1,2}))?,?\s+)?(\d{4})$/i;

interface MonthColumn {
  key: string;
  index: number;
  partial: boolean;
}

function monthColumns(rows: string[][]): { headerRow: number; columns: MonthColumn[] } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols: MonthColumn[] = [];
    rows[r].forEach((cell, index) => {
      const m = MONTH_CELL.exec(cell.trim());
      if (m && index > 0) cols.push({ key: `${m[4]}-${String(monthNumber(m[1])).padStart(2, '0')}`, index, partial: Boolean(m[2]) });
    });
    if (cols.length >= 2) return { headerRow: r, columns: cols };
  }
  return null;
}

/**
 * Reads a QuickBooks Online "Profit and Loss" report saved as CSV and returns the cost accounts: everything under Cost of
 * Goods Sold, Expenses and Other Expenses. Works for a one-month report and for "Profit and Loss by Month" (pass `month`,
 * like "2026-10", to choose the column). Income, totals and blank rows are skipped. Each account keeps the groups it sits
 * under, so two accounts with the same name in different places stay separate.
 */
export function parsePnl(csvText: string, month?: string): PnlResult {
  const rows = parseCsv(csvText);
  const warnings: string[] = [];
  const header = monthColumns(rows);
  const available = header ? [...new Set(header.columns.map((c) => c.key))] : [];

  let col = 1;
  let monthGuess: string | null = null;
  if (header) {
    const wanted = month && available.includes(month) ? month : [...available].reverse().find((k) => header.columns.some((c) => c.key === k && !c.partial)) ?? available[available.length - 1];
    const chosen = header.columns.find((c) => c.key === wanted && !c.partial) ?? header.columns.find((c) => c.key === wanted)!;
    col = chosen.index;
    monthGuess = wanted;
  }

  // Which labels open a group: the ones with a later "Total for <label>" row.
  const groupNames = new Set<string>();
  for (const row of rows) {
    const m = TOTAL_OF.exec((row[0] ?? '').trim());
    if (m) groupNames.add(m[1].trim().toLowerCase());
  }

  const lines = new Map<string, PnlLine>();
  const reported = emptyReported();
  let section: PnlSection | 'skip' | null = null;
  const groups: string[] = [];

  rows.forEach((row, rowIndex) => {
    if (header && rowIndex <= header.headerRow) return;
    const label = (row[0] ?? '').trim();
    const rest = row.slice(1);
    const anyNumbers = rest.map(parseAmount).some((a) => a !== null);

    if (!header && monthGuess === null && !anyNumbers) {
      // title lines of a one-month report: "October 2026", "October 1-31, 2026"
      const m = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b[^0-9]*(?:\\d{1,2}\\s*-\\s*\\d{1,2},?\\s*)?(\\d{4})`, 'i').exec(label);
      if (m) monthGuess = `${m[2]}-${String(MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`;
    }
    if (!label) return;

    if (!anyNumbers) {
      const sectionHeader = SECTION_HEADERS.find(([re]) => re.test(label));
      if (sectionHeader) {
        section = sectionHeader[1];
        groups.length = 0;
      } else if (section !== null && section !== 'skip' && groupNames.has(label.toLowerCase())) {
        groups.push(label); // a parent account that only groups its sub-accounts
      }
      return; // a blank row for an account with nothing in any month
    }

    const reportedRow = REPORTED_ROWS.find(([re]) => re.test(label));
    if (reportedRow) {
      const v = header ? parseAmount(row[col]) : (rest.map(parseAmount).find((a) => a !== null) ?? null);
      if (v !== null) reported[reportedRow[1]] = v;
    }
    const total = TOTAL_OF.exec(label);
    if (total && groupNames.has(total[1].trim().toLowerCase())) {
      const at = groups.map((g) => g.toLowerCase()).lastIndexOf(total[1].trim().toLowerCase());
      if (at >= 0) groups.length = at; // the end of that group
      return;
    }
    if (section === null || section === 'skip' || SUBTOTAL.test(label)) return;

    // the amount in the chosen column (a one-month report has just one number)
    let amount: Cents | null;
    if (header) amount = parseAmount(row[col]);
    else {
      const numeric = rest.map(parseAmount).filter((a): a is Cents => a !== null);
      amount = numeric[0] ?? null;
      if (numeric.length > 1 && !warnings.some((w) => w.startsWith('This report has several columns'))) {
        warnings.push('This report has several columns of numbers. Only the first column was used. Export a single month, or the "by Month" report.');
      }
    }
    const opensGroup = groupNames.has(label.toLowerCase());
    if (amount !== null && amount !== 0) {
      const path = groups.join(' > ');
      const key = `${section}|${path}|${label}`.toLowerCase();
      const existing = lines.get(key);
      if (existing) existing.amount_cents += amount;
      else lines.set(key, { account: label, amount_cents: amount, section, group: path });
    }
    // a parent account can have its own balance as well as sub-accounts: its children sit under it
    if (opensGroup) groups.push(label);
  });

  if (lines.size === 0) warnings.push('No cost accounts were found. Is this the Profit and Loss report saved as CSV?');
  return { lines: [...lines.values()], reported, month_guess: monthGuess, available_months: available, warnings };
}

/** Non-operating items that are not running costs of the business. */
const NOT_RUNNING_COSTS = /\b(interest|depreciation|amortization|income tax|loan|penalt\w*|gain|loss|owner|draw|distribution|dividend|transfer)\b/;

/**
 * A sensible first guess at how an account counts; the owner can change it and it is remembered.
 * `group` is where the account sits (for example "Job Expenses > Job Materials"), which says more than its own name.
 */
export function defaultCategory(account: string, section: PnlSection, group = ''): CostCategory {
  const a = account.toLowerCase();
  const g = group.toLowerCase();
  // job materials and subcontractors are charged to each job, so counting them here would double count
  if (section === 'cogs') return 'excluded';
  if (/\b(job|jobs|project|projects)\b.*\b(material|materials|supplies|expense|expenses|cost|costs|subcontract|subcontractors)\b|\b(materials?|subcontract\w*|cost of (goods|sales))\b/.test(g)) return 'excluded';
  if (/\b(job|project)\s+(material|materials|supplies|costs?)\b|subcontract/.test(a)) return 'excluded';
  if (/(payroll|employer).*(tax)|\b(fica|futa|suta|medicare|social security|unemployment|workers.? comp)/.test(a)) return 'payroll_tax';
  if (/payroll\s*(fee|service|processing)|gusto/.test(a)) return 'overhead';
  if (/\b(wage|wages|salary|salaries|payroll|bonus|bonuses|commission|commissions)\b/.test(a)) return 'wages';
  if (/payroll|salar|wage/.test(g)) return /\btax(es)?\b/.test(a) ? 'payroll_tax' : /\b(fee|fees|service|processing)\b/.test(a) ? 'overhead' : 'wages';
  if (/(income tax|owner|draw|distribution|dividend)/.test(a)) return 'excluded';
  // QuickBooks files some real costs (vehicle fuel, for one) under "Other Expenses", so only clearly non-operating items are left out
  if (section === 'other_expense' && NOT_RUNNING_COSTS.test(`${g} ${a}`)) return 'excluded';
  return 'overhead';
}
