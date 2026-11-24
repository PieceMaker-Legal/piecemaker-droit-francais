import { describe, expect, it } from 'vitest';
import { stepForces } from '../okf-graph.js';

const node = (id: string, x: number, y: number) => ({ id, label: id, kind: 'document', w: 100, h: 36, x, y, vx: 0, vy: 0, fixed: false, icon: null });

describe('simulation du graphe', () => {
  it('écarte deux nœuds superposés et se refroidit', () => {
    const a = node('a', 0, 0); const b = node('b', 5, 0);
    let alpha = 1;
    for (let i = 0; i < 200; i += 1) if (stepForces([a, b], [], alpha)) alpha *= 0.985;
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(50);
    expect(stepForces([a, b], [], 0.001)).toBe(false);
  });

  it('un nœud fixé ne bouge pas', () => {
    const a = { ...node('a', 0, 0), fixed: true }; const b = node('b', 10, 0);
    stepForces([a, b], [{ source: a, target: b, label: '' }], 1);
    expect([a.x, a.y]).toEqual([0, 0]);
  });
});
