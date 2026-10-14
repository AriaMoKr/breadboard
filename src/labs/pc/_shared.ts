/**
 * 74LS161 synchronous 4-bit counter (videos 28-29), as used for the program
 * counter: CEP = CET = CE, P̅E̅ = J̅, M̅R̅ = C̅L̅R̅, CP = CLK. Unit-tested in
 * tests/labs-memory-output.test.ts.
 */

export interface Ls161Inputs {
  /** Master reset, active low and asynchronous. */
  mrN: 0 | 1;
  /** Parallel enable (load), active low, synchronous. */
  peN: 0 | 1;
  cep: 0 | 1;
  cet: 0 | 1;
  /** Parallel inputs P0-P3. */
  p: number;
}

export type Ls161Mode = 'clear' | 'load' | 'count' | 'hold';

/** Which row of the 74LS161 mode table applies (clear beats load beats count). */
export function ls161Mode(i: Ls161Inputs): Ls161Mode {
  if (i.mrN === 0) return 'clear';
  if (i.peN === 0) return 'load';
  if (i.cep === 1 && i.cet === 1) return 'count';
  return 'hold';
}

/** Asynchronous part: M̅R̅ low clears the outputs immediately, no clock needed. */
export function ls161Async(q: number, i: Ls161Inputs): number {
  return i.mrN === 0 ? 0 : q & 15;
}

/** State after a rising edge on CP. */
export function ls161Rise(q: number, i: Ls161Inputs): number {
  switch (ls161Mode(i)) {
    case 'clear': return 0;
    case 'load': return i.p & 15;
    case 'count': return (q + 1) & 15;
    case 'hold': return q & 15;
  }
}

/** Terminal count (pin 15): CET AND Q0..Q3 (unused in Ben's computer). */
export function ls161Tc(q: number, cet: 0 | 1): 0 | 1 {
  return cet === 1 && (q & 15) === 15 ? 1 : 0;
}

export type BusLevel = 0 | 1 | 'Z' | 'X';

/**
 * Levels on bus bits 0-3 (index = bit) with the PC's 74LS245 (CO) and the
 * test switches as possible drivers. Nobody driving = floating ('Z'); two
 * drivers that disagree = contention ('X').
 */
export function pcBusLevels(q: number, co: boolean, busDrive: boolean, busSw: number): BusLevel[] {
  return [0, 1, 2, 3].map((b) => {
    const drv: (0 | 1)[] = [];
    if (co) drv.push(((q >> b) & 1) as 0 | 1);
    if (busDrive) drv.push(((busSw >> b) & 1) as 0 | 1);
    if (!drv.length) return 'Z';
    return drv.every((x) => x === drv[0]) ? drv[0] : 'X';
  });
}

/**
 * What the 161's P inputs read from those lines: a floating LS-TTL input
 * reads 1, and where two outputs fight the one pulling low wins (0).
 */
export function ttlReadNibble(levels: readonly BusLevel[]): number {
  return levels.reduce<number>((v, l, b) => v | ((l === 1 || l === 'Z' ? 1 : 0) << b), 0);
}

/** 74LS161 pin numbers (pc.png / datasheet). */
export const LS161_PINS = { MRn: 1, CP: 2, P0: 3, P1: 4, P2: 5, P3: 6, CEP: 7, GND: 8, PEn: 9, CET: 10, Q3: 11, Q2: 12, Q1: 13, Q0: 14, TC: 15, VCC: 16 } as const;

/**
 * The states a 4-bit RIPPLE counter passes through on one count: each stage
 * toggles only after the one before it has fallen (video 27). E.g. 0111 ->
 * 0110 -> 0100 -> 0000 -> 1000. The last entry is the final count.
 */
export function rippleStates(q: number): number[] {
  const out: number[] = [];
  let v = q & 15;
  for (let bit = 0; bit < 4; bit++) {
    const was = (v >> bit) & 1;
    v ^= 1 << bit;
    out.push(v);
    if (was === 0) break; // this stage rose: the next stage sees no falling edge
  }
  return out;
}
