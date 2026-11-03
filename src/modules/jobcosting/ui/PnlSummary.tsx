import { formatMoney } from '@/core';
import { SECTION_LABELS, buildTree, totalsOf, type TreeNode, type TreeRow } from '../pnlTree';
import type { PnlReported } from '../qbPnl';
import { CATEGORY_LABELS } from '../rateTypes';

function Nodes({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.kind === 'account' ? (
          <div key={i} className="pnl-row" style={{ paddingLeft: 8 + depth * 18 }}>
            <span>
              {n.name}
              <span className={`pnl-tag ${n.category === 'excluded' ? 'off' : 'on'}`}>{n.category === 'excluded' ? 'not counted' : CATEGORY_LABELS[n.category].toLowerCase()}</span>
            </span>
            <span>{formatMoney(n.cents)}</span>
          </div>
        ) : (
          <div key={i}>
            <div className="pnl-row group" style={{ paddingLeft: 8 + depth * 18 }}>
              <span>{n.name}</span>
            </div>
            <Nodes nodes={n.children} depth={depth + 1} />
            <div className="pnl-row subtotal" style={{ paddingLeft: 8 + depth * 18 }}>
              <span>Total for {n.name}</span>
              <span>{formatMoney(n.total)}</span>
            </div>
          </div>
        ),
      )}
    </>
  );
}

const CHECKS: { key: keyof PnlReported; section: TreeRow['section'] }[] = [
  { key: 'cogs', section: 'cogs' },
  { key: 'expenses', section: 'expense' },
  { key: 'other_expenses', section: 'other_expense' },
];

/** The month's costs laid out like QuickBooks' Profit and Loss, with totals, and a check against QuickBooks' own totals. */
export function PnlSummary({ rows, reported, monthLabel }: { rows: TreeRow[]; reported: PnlReported | null; monthLabel: string }) {
  const tree = buildTree(rows);
  const totals = totalsOf(rows);
  const sumOf = (section: TreeRow['section']) => rows.filter((r) => r.section === section).reduce((n, r) => n + r.cents, 0);
  const checks = reported ? CHECKS.filter((c) => reported[c.key] !== null) : [];

  return (
    <div className="pnl">
      <h3>{monthLabel}: costs as in your Profit and Loss</h3>
      {tree.map((s) => (
        <div key={s.section} className="pnl-section">
          <div className="pnl-row section-head">
            <span>{SECTION_LABELS[s.section]}</span>
          </div>
          <Nodes nodes={s.nodes} depth={1} />
          <div className="pnl-row section-total">
            <span>Total {SECTION_LABELS[s.section]}</span>
            <span>{formatMoney(s.total)}</span>
          </div>
        </div>
      ))}

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

      {reported && (checks.length > 0 || reported.income !== null || reported.net_income !== null) && (
        <div className="pnl-check">
          <strong>Check against QuickBooks</strong>
          {checks.map((c) => {
            const theirs = reported[c.key] as number;
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
          {(reported.income !== null || reported.net_income !== null) && (
            <p className="muted small-note">
              From QuickBooks: {reported.income !== null && `income ${formatMoney(reported.income)}`}
              {reported.income !== null && reported.net_income !== null && ' · '}
              {reported.net_income !== null && `net income ${formatMoney(reported.net_income)}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
