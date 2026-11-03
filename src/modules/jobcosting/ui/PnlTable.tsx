import { formatMoney, useSession } from '@/core';
import { SECTION_LABELS, buildTree, type TreeNode, type TreeRow } from '../pnlTree';
import type { PnlReported } from '../qbPnl';
import { CATEGORY_LABELS, type CostCategory } from '../rateTypes';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as CostCategory[];

interface Props {
  rows: TreeRow[];
  reported: PnlReported | null;
  monthLabel: string;
  method: 'cash' | 'accrual';
  onCategory(index: number, category: CostCategory): void;
  onRemove(index: number): void;
}

function Row({ label, amount, className = '', depth = 0, children }: { label: string; amount?: number | null; className?: string; depth?: number; children?: React.ReactNode }) {
  return (
    <div className={`qb-row ${className}`}>
      <div className="qb-name" style={{ paddingLeft: depth * 20 }}>
        {label}
        {children}
      </div>
      <div className="qb-amount">{amount === null || amount === undefined ? '' : formatMoney(amount)}</div>
    </div>
  );
}

/**
 * The month's costs laid out like QuickBooks' Profit and Loss: company and report heading, indented accounts with the
 * amounts lined up on the right, "Total for" lines, and Income, Gross Profit and Net Income when QuickBooks provided them.
 * Each account row also says how it counts toward the hourly cost.
 */
export function PnlTable({ rows, reported, monthLabel, method, onCategory, onRemove }: Props) {
  const { companyName } = useSession();
  const tree = buildTree(rows);
  const section = (s: TreeRow['section']) => tree.find((t) => t.section === s)?.total ?? 0;

  // QuickBooks' own figures when it gave them, otherwise worked out from the ones we have
  const income = reported?.income ?? null;
  const cogs = reported?.cogs ?? section('cogs');
  const grossProfit = reported?.gross_profit ?? (income !== null ? income - cogs : null);
  const expenses = reported?.expenses ?? section('expense');
  const operating = reported?.net_operating_income ?? (grossProfit !== null ? grossProfit - expenses : null);
  const otherExpenses = reported?.other_expenses ?? section('other_expense');
  const netIncome = reported?.net_income ?? (operating !== null ? operating - otherExpenses : null);

  const nodes = (list: TreeNode[], depth: number): React.ReactNode =>
    list.map((n, i) =>
      n.kind === 'account' ? (
        <div key={i} className="qb-row account">
          <div className="qb-name" style={{ paddingLeft: depth * 20 }}>
            <span>{n.name}</span>
            {n.index !== undefined && (
              <span className="qb-controls">
                <select
                  aria-label={`How ${n.name} counts`}
                  className={n.category === 'excluded' ? 'off' : 'on'}
                  value={n.category}
                  onChange={(e) => onCategory(n.index as number, e.target.value as CostCategory)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                {n.removable && (
                  <button type="button" className="link" aria-label={`Remove ${n.name}`} onClick={() => onRemove(n.index as number)}>
                    ✕
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="qb-amount">{formatMoney(n.cents)}</div>
        </div>
      ) : (
        <div key={i}>
          <Row label={n.name} className="group" depth={depth} />
          {nodes(n.children, depth + 1)}
          <Row label={`Total for ${n.name}`} amount={n.total} className="subtotal" depth={depth} />
        </div>
      ),
    );

  const part = (s: TreeRow['section'], total: number) => {
    const t = tree.find((x) => x.section === s);
    if (!t) return null;
    return (
      <div className="qb-section">
        <Row label={SECTION_LABELS[s]} className="section-head" />
        {nodes(t.nodes, 1)}
        <Row label={`Total ${SECTION_LABELS[s]}`} amount={total} className="section-total" />
      </div>
    );
  };

  return (
    <div className="qb-pl">
      <div className="qb-title">
        <strong>{companyName}</strong>
        <div className="qb-report">Profit and Loss</div>
        <div className="muted">
          {monthLabel} · {method === 'cash' ? 'Cash basis' : 'Accrual basis'}
        </div>
      </div>
      <div className="qb-head">
        <span />
        <span>TOTAL</span>
      </div>

      {income !== null && (
        <div className="qb-section">
          <Row label="Income" className="section-head" />
          <Row label="Total Income" amount={income} className="section-total" />
        </div>
      )}
      {part('cogs', cogs)}
      {grossProfit !== null && <Row label="Gross Profit" amount={grossProfit} className="key-total" />}
      {part('expense', expenses)}
      {operating !== null && tree.some((t) => t.section === 'expense') && <Row label="Net Operating Income" amount={operating} className="key-total" />}
      {part('other_expense', otherExpenses)}
      {netIncome !== null && <Row label="Net Income" amount={netIncome} className="key-total grand" />}
      {part('manual', section('manual'))}
    </div>
  );
}
