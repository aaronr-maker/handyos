import { describe, expect, it } from 'vitest';
import { starterFlow, type Flow } from '../api/_lib/callEngine';
import { tidyLayout } from '../src/modules/phone/layout';

describe('call tree tidy up', () => {
  it('puts every block to the right of the blocks that lead to it, and never on top of another', () => {
    const f = starterFlow();
    const at = tidyLayout(f);
    for (const e of f.edges) expect(at[e.target].x).toBeGreaterThan(at[e.source].x);
    const boxes = Object.values(at);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(boxes[i].x === boxes[j].x && Math.abs(boxes[i].y - boxes[j].y) < 60).toBe(false);
  });
  it('copes with a line that loops back, and with blocks nothing leads to', () => {
    const f: Flow = {
      nodes: [
        { id: 'start', kind: 'start', x: 0, y: 0, data: {} },
        { id: 'menu', kind: 'menu', x: 0, y: 0, data: { options: [{ digit: '1', label: 'a' }] } },
        { id: 'loose', kind: 'say', x: 0, y: 0, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', handle: 'next', target: 'menu' },
        { id: 'e2', source: 'menu', handle: '1', target: 'menu' }, // back to itself
      ],
    };
    const at = tidyLayout(f);
    expect(at.start.x).toBe(0);
    expect(at.menu.x).toBe(300);
    expect(Object.keys(at)).toHaveLength(3);
  });
});
