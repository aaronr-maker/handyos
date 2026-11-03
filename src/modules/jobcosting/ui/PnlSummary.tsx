import { formatMoney } from '@/core';
import { SECTION_LABELS, totalsOf, type TreeRow } from '../pnlTree';
import type { PnlReported } from '../qbPnl';

const CHECKS: { key: keyof PnlReported; section: TreeRow['section'] }[] = [
  { key: 'cogs', section: 'cogs' },
  { key: 'expenses', section: 'expense' },
  { key: 'other_expenses', section: 'other_expense' },
];

/** What counts toward the hourly cost, and a check of what was read against QuickBooks' own totals. */
export function PnlSummary({ rows, reported }: { rows: TreeRow[]; reported: PnlReported | null }) {
  const totals = totalsOf(rows);
  const sumOf = (section: TreeRow['section']) => rows.filter((r) => r.section === section).reduce((n, r) => n + r.cents, 0);
  const checks = reported ? CHECKS.filter((c) => reported[c.key] !== null) : [];

  return (
    <div className="pnl">
      <div className="pnl-grand">
        <div className="pnl-row">
          <span>Total costs listed</span>
          <span>{formatMoney(totals.all)}</span>
        </div>
        <div className="pnl-row">
          <span>Not counted in the hourly cost</span>
          <span>{formatMoney(totals.excluded)}</span>
        </div>
        <div className="pnl-row strong">
          <span>Counted in the hourly cost</span>
          <span>{formatMoney(totals.counted)}</span>
        </div>
      </div>

      {checks.length > 0 && (
        <div className="pnl-check">
          <strong>Check against QuickBooks</strong>
          {checks.map((c) => {
            const theirs = reported![c.key] as number;
            const ours = sumOf(c.section);
            const ok = theirs === ours;
            return (
              <div key={c.key} className="pnl-row">
                <span>
                  Total {SECTION_LABELS[c.section]}: QuickBooks {formatMoney(theirs)}
                </span>
                <span className={ok ? 'ok-text' : 'err'}>{ok ? '✓ matches' : `✗ we read ${formatMoney(ours)}`}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
