import { useEffect, useRef } from 'react';
import { formatMoney, useSession } from '@/core';
import { SECTION_LABELS, buildTree, indexesOf, type TreeNode, type TreeRow } from '../pnlTree';
import type { PnlReported } from '../qbPnl';
import { CATEGORY_LABELS } from '../rateTypes';

interface Props {
  rows: TreeRow[];
  reported: PnlReported | null;
  monthLabel: string;
  method: 'cash' | 'accrual';
  /** Tick or untick some accounts (one account, a whole group, or a whole section). */
  onInclude(indexes: number[], include: boolean): void;
  /** Change what kind of cost an included account is (wages, payroll tax, other running costs). */
  onKind(index: number): void;
  onRemove(index: number): void;
}

/** A checkbox that can show "some of these are ticked". */
function Check({ state, onChange, label }: { state: 'all' | 'some' | 'none'; onChange(next: boolean): void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" className="qb-check" aria-label={label} checked={state === 'all'} onChange={() => onChange(state !== 'all')} />;
}

function Row({ label, amount, className = '', depth = 0, check }: { label: string; amount?: number | null; className?: string; depth?: number; check?: React.ReactNode }) {
  return (
    <div className={`qb-row ${className}`}>
      <div className="qb-name" style={{ paddingLeft: depth * 20 }}>
        {check}
        <span className="qb-label">{label}</span>
      </div>
      <div className="qb-amount">{amount === null || amount === undefined ? '' : formatMoney(amount)}</div>
    </div>
  );
}

/**
 * The month's costs laid out like QuickBooks' Profit and Loss: company and report heading, indented accounts with the
 * amounts lined up on the right, "Total for" lines, and Income, Gross Profit and Net Income when QuickBooks provided them.
 * Tick what to include in the hourly cost: each account, a whole group, or a whole section at once.
 */
export function PnlTable({ rows, reported, monthLabel, method, onInclude, onKind, onRemove }: Props) {
  const { companyName } = useSession();
  const tree = buildTree(rows);
  const section = (s: TreeRow['section']) => tree.find((t) => t.section === s)?.total ?? 0;
  const included = new Map(rows.map((r) => [r.index, r.category !== 'excluded']));
  const stateOf = (indexes: number[]): 'all' | 'some' | 'none' => {
    const on = indexes.filter((i) => included.get(i)).length;
    return on === 0 ? 'none' : on === indexes.length ? 'all' : 'some';
  };
  const tick = (indexes: number[], label: string) => <Check state={stateOf(indexes)} label={label} onChange={(next) => onInclude(indexes, next)} />;

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
        <div key={i} className={`qb-row account ${n.category === 'excluded' ? 'is-off' : ''}`}>
          <div className="qb-name" style={{ paddingLeft: depth * 20 }}>
            {n.index !== undefined && tick([n.index], `Include ${n.name}`)}
            <span className="qb-label">{n.name}</span>
            {n.index !== undefined && n.category !== 'excluded' && (
              <button type="button" className="qb-kind" title="What kind of cost is this? Click to change." onClick={() => onKind(n.index as number)}>
                {CATEGORY_LABELS[n.category].toLowerCase()}
              </button>
            )}
            {n.removable && n.index !== undefined && (
              <button type="button" className="link qb-x" aria-label={`Remove ${n.name}`} onClick={() => onRemove(n.index as number)}>
                ✕
              </button>
            )}
          </div>
          <div className="qb-amount">{formatMoney(n.cents)}</div>
        </div>
      ) : (
        <div key={i}>
          <Row label={n.name} className="group" depth={depth} check={tick(n.indexes, `Include everything under ${n.name}`)} />
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
        <Row label={SECTION_LABELS[s]} className="section-head" check={tick(indexesOf(t.nodes), `Include everything under ${SECTION_LABELS[s]}`)} />
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
      <p className="muted small-note qb-hint">Tick what counts toward your hourly cost. Ticking a heading ticks everything under it.</p>
      <div className="qb-head">
        <span>INCLUDE IN THE HOURLY COST</span>
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
