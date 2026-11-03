import type { Cents } from '@/core';
import type { CostCategory } from './rateTypes';

export type TreeSection = 'cogs' | 'expense' | 'other_expense' | 'manual';

export interface TreeRow {
  account: string;
  /** "Job Expenses > Job Materials" (empty at the top level) */
  group: string;
  section: TreeSection;
  cents: Cents;
  category: CostCategory;
}

export type TreeNode =
  | { kind: 'account'; name: string; cents: Cents; category: CostCategory }
  | { kind: 'group'; name: string; total: Cents; children: TreeNode[] };

export interface SectionTree {
  section: TreeSection;
  label: string;
  total: Cents;
  nodes: TreeNode[];
}

export const SECTION_LABELS: Record<TreeSection, string> = {
  cogs: 'Cost of Goods Sold',
  expense: 'Expenses',
  other_expense: 'Other Expenses',
  manual: 'Added by hand',
};
const ORDER: TreeSection[] = ['cogs', 'expense', 'other_expense', 'manual'];

/** Lays accounts out the way QuickBooks does: sections, nested groups, and a total for each. Order of appearance is kept. */
export function buildTree(rows: TreeRow[]): SectionTree[] {
  const trees: SectionTree[] = [];
  for (const section of ORDER) {
    const mine = rows.filter((r) => r.section === section);
    if (mine.length === 0) continue;
    const root: TreeNode[] = [];
    for (const r of mine) {
      let level = root;
      for (const name of r.group ? r.group.split(' > ') : []) {
        let group = level.find((n): n is Extract<TreeNode, { kind: 'group' }> => n.kind === 'group' && n.name === name);
        if (!group) {
          group = { kind: 'group', name, total: 0, children: [] };
          level.push(group);
        }
        level = group.children;
      }
      level.push({ kind: 'account', name: r.account, cents: r.cents, category: r.category });
    }
    // A parent account can have its own balance as well as sub-accounts. QuickBooks shows that balance inside the group,
    // so it counts toward "Total for <parent>".
    const tuck = (nodes: TreeNode[]) => {
      for (const node of [...nodes]) {
        if (node.kind === 'group') {
          tuck(node.children);
          const own = nodes.findIndex((n) => n.kind === 'account' && n.name === node.name);
          if (own >= 0) node.children.unshift(...nodes.splice(own, 1));
        }
      }
    };
    tuck(root);
    const total = (nodes: TreeNode[]): Cents =>
      nodes.reduce((n, node) => {
        if (node.kind === 'account') return n + node.cents;
        node.total = total(node.children);
        return n + node.total;
      }, 0);
    trees.push({ section, label: SECTION_LABELS[section], total: total(root), nodes: root });
  }
  return trees;
}

export interface Totals {
  all: Cents;
  counted: Cents;
  excluded: Cents;
}

/** Everything in the list, what counts toward the hourly cost, and what doesn't. */
export function totalsOf(rows: Pick<TreeRow, 'cents' | 'category'>[]): Totals {
  const all = rows.reduce((n, r) => n + r.cents, 0);
  const excluded = rows.filter((r) => r.category === 'excluded').reduce((n, r) => n + r.cents, 0);
  return { all, counted: all - excluded, excluded };
}
