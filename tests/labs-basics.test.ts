import { describe, expect, it } from 'vitest';
import { GATES, conducts, depletion, gate, truthRows } from '../src/labs/basics/_gates';

describe('logic gates from transistors', () => {
  it("each of Ben's transistor circuits has its gate's truth table", () => {
    const table = Object.fromEntries(GATES.map((g) => [g.id, truthRows(g.id)]));
    expect(table.buffer).toEqual([[0, 0], [1, 1]]);
    expect(table.inverter).toEqual([[0, 1], [1, 0]]);
    expect(table.and).toEqual([[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]]);
    expect(table.or).toEqual([[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]]);
    expect(table.xor).toEqual([[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]);
  });

  it('the XOR: T3 is normally on, and T4 + T5 switch it off when both inputs are on', () => {
    expect(gate('xor', false, false).on).toEqual({ T1: false, T2: false, T3: true, T4: false, T5: false });
    expect(gate('xor', true, false).on.T3).toBe(true);
    expect(gate('xor', true, true).on).toEqual({ T1: true, T2: true, T3: false, T4: true, T5: true });
    expect(GATES.find((g) => g.id === 'xor')!.transistors).toBe(5);
  });

  it('a PN junction: the depletion region narrows forward, is gone by about 0.65 V, widens in reverse', () => {
    expect(depletion(0)).toBe(1);
    expect(depletion(0.3)).toBeLessThan(1);
    expect(depletion(0.65)).toBe(0);
    expect(depletion(-2)).toBeGreaterThan(1);
    expect(conducts(0.5)).toBe(false);
    expect(conducts(0.7)).toBe(true);
  });
});
