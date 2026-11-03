import { parseCsv, type Cents } from '@/core';
import type { CostCategory } from './rateTypes';

export type PnlSection = 'cogs' | 'expense' | 'other_expense';

export interface PnlLine {
  account: string;
  amount_cents: Cents;
  section: PnlSection;
}

export interface PnlResult {
  lines: PnlLine[];
  /** "2026-10" if the report's title says which month it covers. */
  month_guess: string | null;
  warnings: string[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

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

/**
 * Reads a QuickBooks Online "Profit and Loss" report saved as CSV (one amount column) and returns the cost accounts:
 * everything under Cost of Goods Sold, Expenses and Other Expenses. Totals and income are skipped; repeated account
 * names are added together. Parent accounts that only group sub-accounts are skipped (the sub-accounts carry the money).
 */
export function parsePnl(csvText: string): PnlResult {
  const rows = parseCsv(csvText);
  const warnings: string[] = [];
  const lines = new Map<string, PnlLine>();
  let section: PnlSection | 'skip' | null = null;
  let monthGuess: string | null = null;

  for (const row of rows) {
    const label = (row[0] ?? '').trim();
    const rest = row.slice(1);
    const amounts = rest.map(parseAmount);
    const numeric = amounts.filter((a): a is Cents => a !== null);

    if (monthGuess === null && numeric.length === 0) {
      // title lines: "October 2026", "October 1-31, 2026"
      const m = new RegExp(`\\b(${MONTHS.join('|')})\\b[^0-9]*(?:\\d{1,2}\\s*-\\s*\\d{1,2},?\\s*)?(\\d{4})`, 'i').exec(label);
      if (m) monthGuess = `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`;
    }
    if (numeric.length === 0) {
      const header = SECTION_HEADERS.find(([re]) => re.test(label));
      if (header) section = header[1];
      continue;
    }
    if (section === null || section === 'skip' || SUBTOTAL.test(label)) continue;
    if (numeric.length > 1) {
      if (!warnings.some((w) => w.startsWith('This report has several columns'))) {
        warnings.push('This report has several columns of numbers. Only the first column was used. For best results export a single month.');
      }
    }
    const amount = numeric[0];
    const existing = lines.get(label.toLowerCase());
    if (existing) existing.amount_cents += amount;
    else lines.set(label.toLowerCase(), { account: label, amount_cents: amount, section });
  }
  if (lines.size === 0) warnings.push('No cost accounts were found. Is this the Profit and Loss report saved as CSV?');
  return { lines: [...lines.values()], month_guess: monthGuess, warnings };
}

/** A sensible first guess at how an account counts; the owner can change it and it is remembered. */
export function defaultCategory(account: string, section: PnlSection): CostCategory {
  const a = account.toLowerCase();
  if (section === 'cogs') return 'excluded'; // job materials are charged to each job, so counting them here would double count
  if (/(payroll|employer).*(tax)|\b(fica|futa|suta|medicare|social security|unemployment|workers.? comp)/.test(a)) return 'payroll_tax';
  if (/payroll\s*(fee|service|processing)|gusto/.test(a)) return 'overhead';
  if (/\b(wage|wages|salary|salaries|payroll|bonus|bonuses|commission|commissions)\b/.test(a)) return 'wages';
  if (/(income tax|owner|draw|distribution|dividend)/.test(a)) return 'excluded';
  if (section === 'other_expense') return 'excluded'; // interest, depreciation and other non-operating items
  return 'overhead';
}
