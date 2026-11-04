import ELK from 'elkjs/lib/elk.bundled.js';
import highsLoader from 'highs';
import { describe, expect, it } from 'vitest';

import { checkLzString, checkYalps } from '../../src/selftest/checks';

describe('library spikes (Node)', () => {
  it('YALPS solves the reference LP', () => {
    expect(checkYalps()).toMatchObject({ ok: true });
  });

  it('lz-string round-trips a plan payload without "+"', () => {
    expect(checkLzString()).toMatchObject({ ok: true });
  });

  it('HiGHS (test oracle) loads and agrees with YALPS on the reference LP', async () => {
    const highs = await highsLoader();
    const solution = highs.solve('Minimize\n cost: 2 a + 3 b\nSubject To\n total: a + b >= 10\n capA: a <= 6\nEnd\n');
    expect(solution.Status).toBe('Optimal');
    expect(solution.ObjectiveValue).toBeCloseTo(24, 9);
  });

  it('ELK (bundled build) lays out identical input to identical positions', async () => {
    const graph = () => ({
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
      children: ['a', 'b', 'c'].map((id) => ({ id, width: 120, height: 40 })),
      edges: [
        { id: 'ab', sources: ['a'], targets: ['b'] },
        { id: 'ac', sources: ['a'], targets: ['c'] },
      ],
    });
    const elk = new ELK();
    const first = await elk.layout(graph());
    const second = await elk.layout(graph());
    const positions = (g: typeof first) => (g.children ?? []).map((n) => [n.id, n.x, n.y]);
    expect(positions(first)).toEqual(positions(second));
    expect(positions(first).every(([, x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
