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
  /** Where the row sits in the editable list (so the screen can change or remove it). */
  index?: number;
  /** Costs typed in by hand can be removed; costs read from QuickBooks are changed with their category instead. */
  removable?: boolean;
}

export type TreeNode =
  | { kind: 'account'; name: string; cents: Cents; category: CostCategory; index?: number; removable?: boolean }
  | { kind: 'group'; name: string; total: Cents; children: TreeNode[]; /** the rows under this group, for ticking the whole group at once */ indexes: number[] };

export interface SectionTree {
  section: TreeSection;
  label: string;
  total: Cents;
  nodes: TreeNode[];
  /** the rows in this section, for ticking the whole section at once */
  indexes: number[];
}

/** The row positions of every account under some nodes. */
export function indexesOf(nodes: TreeNode[]): number[] {
  return nodes.flatMap((n) => (n.kind === 'account' ? (n.index === undefined ? [] : [n.index]) : n.indexes));
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
          group = { kind: 'group', name, total: 0, children: [], indexes: [] };
          level.push(group);
        }
        level = group.children;
      }
      level.push({ kind: 'account', name: r.account, cents: r.cents, category: r.category, index: r.index, removable: r.removable });
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
    const fill = (list: TreeNode[]) => {
      for (const n of list) if (n.kind === 'group') {
        fill(n.children);
        n.indexes = indexesOf(n.children);
      }
    };
    fill(root);
    trees.push({ section, label: SECTION_LABELS[section], total: total(root), nodes: root, indexes: indexesOf(root) });
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
