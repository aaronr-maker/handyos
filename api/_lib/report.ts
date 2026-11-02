/**
 * Turns a QuickBooks Online "ProfitAndLoss" report (the API's JSON) into the same list of cost accounts the CSV
 * import produces: everything under Cost of Goods Sold, Expenses and Other Expenses. Income and totals are skipped,
 * sub-accounts are flattened, and repeated names are added together.
 */
export type PnlSection = 'cogs' | 'expense' | 'other_expense';

export interface ReportLine {
  account: string;
  amount_cents: number;
  section: PnlSection;
}

interface ColData {
  value?: string;
}
interface Row {
  type?: string;
  group?: string;
  ColData?: ColData[];
  Header?: { ColData?: ColData[] };
  Rows?: { Row?: Row[] };
}

const GROUPS: Record<string, PnlSection> = { COGS: 'cogs', Expenses: 'expense', OtherExpenses: 'other_expense' };

function cents(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function reportToLines(report: unknown): ReportLine[] {
  const rows = (report as { Rows?: { Row?: Row[] } })?.Rows?.Row ?? [];
  const found = new Map<string, ReportLine>();

  const walk = (list: Row[], section: PnlSection) => {
    for (const row of list) {
      if (row.type === 'Data' && row.ColData) {
        const name = row.ColData[0]?.value?.trim();
        const amount = cents(row.ColData[1]?.value);
        if (!name || amount === null) continue;
        const k = name.toLowerCase();
        const existing = found.get(k);
        if (existing) existing.amount_cents += amount;
        else found.set(k, { account: name, amount_cents: amount, section });
      } else if (row.Rows?.Row) {
        walk(row.Rows.Row, section);
      }
    }
  };
  for (const top of rows) {
    const section = top.group ? GROUPS[top.group] : undefined;
    if (section && top.Rows?.Row) walk(top.Rows.Row, section);
  }
  return [...found.values()];
}

/** First and last day of a "2026-10" month, as the report wants them. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
