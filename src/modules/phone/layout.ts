import { portsOf, type Flow } from '../../../api/_lib/callEngine';

const COLUMN = 300;
const GAP = 36;

/** About how tall a block is drawn: a title, a short summary, and a row for each exit. */
const heightOf = (kind: Flow['nodes'][number]['kind'], data: Flow['nodes'][number]['data']) => 64 + (kind === 'start' ? 0 : 34) + portsOf({ kind, data }).length * 26;

/**
 * Lays the call tree out left to right. A block sits in the column after the last block that leads to it (so a call always moves
 * to the right), blocks in a column are ordered to follow where their lines come from (fewer crossings), and each is spaced by
 * its own height. A line that loops back to an earlier block is left out of the ordering so it cannot tangle the layout.
 */
export function tidyLayout(flow: Flow): Record<string, { x: number; y: number }> {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of flow.edges) if (byId.has(e.source) && byId.has(e.target)) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);

  // find lines that loop back (depth-first from the start), and ignore them
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id) ?? []) {
      if (state.get(t) === 1) back.add(`${id}>${t}`);
      else if (!state.has(t)) visit(t);
    }
    state.set(id, 2);
  };
  const start = flow.nodes.find((n) => n.kind === 'start') ?? flow.nodes[0];
  if (start) visit(start.id);
  for (const n of flow.nodes) if (!state.has(n.id)) visit(n.id);

  const forward = flow.edges.filter((e) => byId.has(e.source) && byId.has(e.target) && !back.has(`${e.source}>${e.target}`));
  const parents = new Map<string, string[]>();
  for (const e of forward) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);

  // column = the longest chain of blocks leading here
  const depth = new Map<string, number>();
  const columnOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    depth.set(id, 0);
    const d = Math.max(-1, ...(parents.get(id) ?? []).map(columnOf)) + 1;
    depth.set(id, d);
    return d;
  };
  for (const n of flow.nodes) columnOf(n.id);

  const columns = new Map<number, string[]>();
  for (const n of flow.nodes) columns.set(depth.get(n.id) ?? 0, [...(columns.get(depth.get(n.id) ?? 0) ?? []), n.id]);

  // order each column by where its lines come from, left to right
  const row = new Map<string, number>();
  const result: Record<string, { x: number; y: number }> = {};
  const tallest = { value: 0 };
  const heights = new Map<number, number>();
  for (const c of [...columns.keys()].sort((a, b) => a - b)) {
    const ids = columns.get(c) as string[];
    const score = (id: string) => {
      const ps = (parents.get(id) ?? []).map((p) => row.get(p)).filter((v): v is number => v !== undefined);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER;
    };
    const original = new Map(flow.nodes.map((n, i) => [n.id, i]));
    ids.sort((a, b) => score(a) - score(b) || (original.get(a) ?? 0) - (original.get(b) ?? 0));
    let y = 0;
    ids.forEach((id, i) => {
      const n = byId.get(id) as Flow['nodes'][number];
      row.set(id, y + heightOf(n.kind, n.data) / 2);
      result[id] = { x: c * COLUMN, y };
      y += heightOf(n.kind, n.data) + GAP;
      void i;
    });
    heights.set(c, y - GAP);
    tallest.value = Math.max(tallest.value, y - GAP);
  }
  // centre every column against the tallest one so the tree reads as a tree
  for (const [c, ids] of columns) {
    const shift = (tallest.value - (heights.get(c) ?? 0)) / 2;
    for (const id of ids) result[id] = { x: result[id].x, y: Math.round(result[id].y + shift) };
  }
  return result;
}
