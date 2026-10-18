/**
 * Ben's logic gates from transistors (Making logic gates from transistors, 2015): each NPN
 * transistor is a current-controlled switch, on while its input button drives current into its
 * base. The LED (with its resistor from +5 V) lights when there is a path to ground through it.
 */

export type GateId = 'buffer' | 'inverter' | 'and' | 'or' | 'xor';

export interface GateState {
  /** Which transistors conduct (collector to emitter), by name. */
  on: Record<string, boolean>;
  led: boolean;
}

export const GATES: { id: GateId; title: string; inputs: 1 | 2; transistors: number }[] = [
  { id: 'buffer', title: 'Buffer', inputs: 1, transistors: 1 },
  { id: 'inverter', title: 'Inverter (NOT)', inputs: 1, transistors: 1 },
  { id: 'and', title: 'AND', inputs: 2, transistors: 2 },
  { id: 'or', title: 'OR', inputs: 2, transistors: 2 },
  { id: 'xor', title: 'XOR (five transistors)', inputs: 2, transistors: 5 },
];

/**
 * - buffer: the LED in series with T1: lit while A is on.
 * - inverter: the LED from the node under the resistor to ground, T1 across it: T1 on pulls the
 *   node to ground and the LED goes out.
 * - and: T1 and T2 in series under the LED.
 * - or: T1 and T2 in parallel under the LED.
 * - xor: the OR pair (T1, T2) reaches ground only through T3, whose base is pulled up through a
 *   resistor, so it is normally on; T4 and T5 in series (inputs A and B) ground T3's base when both
 *   are on, which switches T3 off.
 */
export function gate(id: GateId, a: boolean, b: boolean): GateState {
  switch (id) {
    case 'buffer':
      return { on: { T1: a }, led: a };
    case 'inverter':
      return { on: { T1: a }, led: !a };
    case 'and':
      return { on: { T1: a, T2: b }, led: a && b };
    case 'or':
      return { on: { T1: a, T2: b }, led: a || b };
    case 'xor': {
      const t3 = !(a && b);
      return { on: { T1: a, T2: b, T3: t3, T4: a, T5: b }, led: (a || b) && t3 };
    }
  }
}

/** The truth table rows [inputs..., output] of a gate. */
export function truthRows(id: GateId): number[][] {
  const g = GATES.find((x) => x.id === id)!;
  const rows: number[][] = [];
  for (let v = 0; v < (g.inputs === 1 ? 2 : 4); v++) {
    const a = g.inputs === 1 ? v === 1 : (v & 2) !== 0;
    const b = (v & 1) !== 0;
    const ins = g.inputs === 1 ? [Number(a)] : [Number(a), Number(b)];
    rows.push([...ins, Number(gate(id, a, b).led)]);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The PN junction and the transistor, as pictures

/**
 * Half-width of a PN junction's depletion region, relative to its width with no battery, for a
 * battery of `v` volts across it (+ on the P side is forward). It narrows as the forward voltage
 * nears about 0.65 V, where it is gone and current flows, and widens in reverse. (The square
 * root of the textbook formula; the numbers are for the picture.)
 */
export const depletion = (v: number, built = 0.65) => Math.sqrt(Math.max(0, (built - v) / built));

/** Whether a junction conducts at `v` volts forward (Ben: "greater than about 0.6 volts"). */
export const conducts = (v: number) => v >= 0.6;
