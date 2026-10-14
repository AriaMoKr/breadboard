/**
 * Pure models for the RAM chapter (videos 19-23). Unit-tested in
 * tests/labs-memory-output.test.ts.
 */

export type Tri = 0 | 1 | 'Z';

// ---------------------------------------------------------------------------
// 74LS189 (16 x 4 SRAM)

/** Pin numbers of the 74LS189 (ram.png / 74F189 datasheet). */
export const LS189_PINS = {
  A0: 1, CSn: 2, WEn: 3, D1: 4, O1n: 5, D2: 6, O2n: 7, GND: 8, O3n: 9, D3: 10, O4n: 11, D4: 12, A3: 13, A2: 14, A1: 15, VCC: 16,
} as const;

export type Ls189Mode = 'write' | 'read' | 'disabled';

export function ls189Mode(csN: 0 | 1, weN: 0 | 1): Ls189Mode {
  if (csN === 1) return 'disabled';
  return weN === 0 ? 'write' : 'read';
}

/**
 * Output pins O̅1..O̅4 (index 0 = O̅1 = data bit 0). While reading they show the
 * COMPLEMENT of the stored nibble; during a write or with C̅S̅ high they float.
 */
export function ls189Outputs(stored: number, csN: 0 | 1, weN: 0 | 1): Tri[] {
  if (ls189Mode(csN, weN) !== 'read') return ['Z', 'Z', 'Z', 'Z'];
  return [0, 1, 2, 3].map((i) => (((stored >> i) & 1) ^ 1) as 0 | 1);
}

/** A 74LS189: 16 words of 4 bits. Writes are level-sensitive (whenever C̅S̅ = W̅E̅ = 0). */
export class Ls189 {
  readonly cells = new Uint8Array(16);
  constructor(init?: ArrayLike<number>) {
    if (init) for (let i = 0; i < 16; i++) this.cells[i] = (init[i] ?? 0) & 15;
  }
  /** Power-up junk: SRAM cells come up in random states. */
  randomize(rand: () => number = Math.random) {
    for (let i = 0; i < 16; i++) this.cells[i] = Math.floor(rand() * 16) & 15;
  }
  /** Apply the pin levels (writes if selected and W̅E̅ low) and return the output pins. */
  apply(addr: number, data: number, csN: 0 | 1, weN: 0 | 1): Tri[] {
    const a = addr & 15;
    if (ls189Mode(csN, weN) === 'write') this.cells[a] = data & 15;
    return ls189Outputs(this.cells[a], csN, weN);
  }
}

/** What a 74LS04 makes of an output pin: floating TTL inputs read high, so a floating pin gives 0. */
export const ls04 = (l: Tri): 0 | 1 => (l === 0 ? 1 : 0);

/** Value after the 74LS04 inverters (bit i from tri-state pin i). */
export function reinvert(pins: Tri[]): number {
  return pins.reduce<number>((v, p, i) => v | (ls04(p) << i), 0);
}

// ---------------------------------------------------------------------------
// The RAM module (videos 20-22): MAR + 74LS157 muxes + 2x 74189 + 74LS04 + 74LS245

/** Floating LS-TTL inputs read as 1: an undriven bus looks like 0xFF to the MAR and RAM. */
export const busRead = (bus: number | null): number => (bus === null ? 0xff : bus & 0xff);

/** 74LS157 quad 2-to-1 mux: select low -> A (I0), high -> B (I1). Strobe tied to GND. */
export const mux157 = (select: 0 | 1, a: number, b: number) => (select ? b : a);

export interface RamModuleInputs {
  /** Program mode (PROG line pulled low by the switch, red LED). */
  prog: boolean;
  dipAddr: number;
  dipData: number;
  /** Write push button held down (pulls the 157's I0c low). */
  writeBtn: boolean;
  /** Value other modules / test switches drive onto the bus, or null if nothing drives it. */
  bus: number | null;
  mi: boolean;
  ri: boolean;
  ro: boolean;
  /** CLK (or the RC edge-detector output, depending on the build stage) that feeds the NAND gate. */
  clkToNand: 0 | 1;
}

export interface RamModuleSignals {
  /** 157 select line: 0 = program (DIP switches, button), 1 = run (MAR, bus, NAND). */
  select: 0 | 1;
  addr: number;
  /** NAND(RI, clock) from the 74LS00. */
  nand: 0 | 1;
  weN: 0 | 1;
  /** True while the 189s are writing (their outputs float). */
  writing: boolean;
  /** Raw 189 outputs for the 8 bits (index = bit), complemented or floating. */
  raw: Tri[];
  /** What the red LEDs after the 74LS04s show. */
  leds: number;
  /** Value the module's 74LS245 drives onto the bus (null when RO is off). */
  busOut: number | null;
  /** The bus as seen by the RAM's data mux / the MAR (after resolving all drivers). */
  busLevel: number | null;
  contention: boolean;
  dataIn: number;
}

export class RamModule {
  mar = 0;
  /** True (non-inverted) byte stored at each address (high nibble in U24, low nibble in U25). */
  readonly ram = new Uint8Array(16);

  randomize(rand: () => number = Math.random) {
    for (let i = 0; i < 16; i++) this.ram[i] = Math.floor(rand() * 256) & 0xff;
    this.mar = Math.floor(rand() * 16) & 15;
  }

  /** Combinational state of the module for the given inputs. */
  signals(i: RamModuleInputs): RamModuleSignals {
    const select: 0 | 1 = i.prog ? 0 : 1;
    const addr = mux157(select, i.dipAddr & 15, this.mar & 15);
    const nand: 0 | 1 = i.ri && i.clkToNand === 1 ? 0 : 1;
    const button: 0 | 1 = i.writeBtn ? 0 : 1;
    const weN = mux157(select, button, nand) as 0 | 1;
    const writing = weN === 0;
    const stored = this.ram[addr];
    const raw: Tri[] = Array.from({ length: 8 }, (_, b) => (writing ? 'Z' : ((((stored >> b) & 1) ^ 1) as 0 | 1)));
    const leds = reinvert(raw);
    const busOut = i.ro ? leds : null;
    const drivers = [busOut, i.bus].filter((x): x is number => x !== null);
    // With contention, TTL outputs driving low win (same rule as src/sim/computer.ts).
    const busLevel = drivers.length ? drivers.reduce((x, y) => x & y, 0xff) : null;
    const dataIn = mux157(select, i.dipData & 0xff, busRead(busLevel));
    return { select, addr, nand, weN, writing, raw, leds, busOut, busLevel, contention: drivers.length > 1, dataIn };
  }

  /** Let the level-sensitive 189s do their thing: write while W̅E̅ is low. Returns true if a write happened. */
  settle(i: RamModuleInputs): boolean {
    const sg = this.signals(i);
    if (!sg.writing) return false;
    this.ram[sg.addr] = sg.dataIn;
    return true;
  }

  /** Rising clock edge: the 74LS173 MAR loads bus bits 0-3 when MI is asserted. */
  clockEdge(i: RamModuleInputs): boolean {
    if (!i.mi) return false;
    const sg = this.signals(i);
    this.mar = busRead(sg.busLevel) & 15;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Write timing (video 23): NAND(RI, CLK) versus NAND(RI, RC edge pulse)

export const VCC = 5;
/** Where an LS-TTL input switches (between V_IL 0.8 V and V_IH 2.0 V). */
export const TTL_THRESHOLD = 1.4;
/** Input clamp diode: an LS-TTL input will not go much below about -0.7 V. */
export const CLAMP = -0.7;

export const rcTau = (r: number, c: number) => r * c;

/** How long the RC node stays above the TTL threshold after a 0->5 V clock edge. */
export function rcPulseWidth(r: number, c: number, vth = TTL_THRESHOLD, vcc = VCC): number {
  return r * c * Math.log(vcc / vth);
}

/**
 * Voltage at the junction of C7 (series) and R58 (to GND) when CLK rises at
 * t = 0 and falls at t = tHigh (a differentiator).
 */
export function rcNode(t: number, tHigh: number, tau: number, vcc = VCC): number {
  if (t < 0) return 0;
  if (t < tHigh) return vcc * Math.exp(-t / tau);
  const atFall = Math.max(CLAMP, vcc * Math.exp(-tHigh / tau) - vcc);
  return Math.max(CLAMP, atFall * Math.exp(-(t - tHigh) / tau));
}

export interface WriteScenario {
  /** How long CLK stays high (s). */
  tHigh: number;
  /** When the bus changes, measured from the rising edge (s). */
  tChange: number;
  /** Byte on the bus at the rising edge (the one we mean to store). */
  before: number;
  /** Byte on the bus after the change. */
  after: number;
  r: number;
  c: number;
}

export interface WriteResult {
  /** [start, end] of the time W̅E̅ is low (s). */
  window: [number, number];
  stored: number;
  correct: boolean;
}

/**
 * The 74189 writes for as long as W̅E̅ is low, so the cell ends up holding the
 * last bus value seen inside the write window.
 */
export function simulateWrite(sc: WriteScenario, mode: 'level' | 'edge'): WriteResult {
  const end = mode === 'level' ? sc.tHigh : Math.min(sc.tHigh, rcPulseWidth(sc.r, sc.c));
  const stored = sc.tChange < end ? sc.after : sc.before;
  return { window: [0, end], stored, correct: stored === sc.before };
}

/** Byte on the bus at time t (s after the rising edge). */
export const busAt = (sc: WriteScenario, t: number) => (t < sc.tChange ? sc.before : sc.after);

/** What the RAM cell holds at time t (it started out holding `initial`). */
export function cellAt(sc: WriteScenario, mode: 'level' | 'edge', t: number, initial: number): number {
  const { window } = simulateWrite(sc, mode);
  if (t < window[0]) return initial;
  if (t < window[1]) return busAt(sc, t);
  return simulateWrite(sc, mode).stored;
}

export interface WriteWaveforms {
  t: number[];
  clk: number[];
  rc: number[];
  weLevel: (0 | 1)[];
  weEdge: (0 | 1)[];
  /** 0 while the bus holds `before`, 1 after it changed. */
  bus: (0 | 1)[];
}

/** Sampled traces for the scope, from t0 to t1 (s), RI held high. */
export function writeWaveforms(sc: WriteScenario, n: number, t0: number, t1: number): WriteWaveforms {
  const tau = rcTau(sc.r, sc.c);
  const out: WriteWaveforms = { t: [], clk: [], rc: [], weLevel: [], weEdge: [], bus: [] };
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    const clkHigh = t >= 0 && t < sc.tHigh;
    const v = rcNode(t, sc.tHigh, tau);
    out.t.push(t);
    out.clk.push(clkHigh ? VCC : 0);
    out.rc.push(v);
    out.weLevel.push(clkHigh ? 0 : 1);
    out.weEdge.push(v > TTL_THRESHOLD ? 0 : 1);
    out.bus.push(t >= sc.tChange ? 1 : 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Troubleshooting (video 23): data wires shifted by one hole

/**
 * `from` = the first data wire that was plugged one hole too far: wires
 * from..6 land on bits from+1..7, wire 7 lands on a pin that is not a data
 * input, and the empty hole at bit `from` floats high (reads 1).
 */
export interface WiringFault {
  from: number;
}

export function faultyStore(data: number, fault: WiringFault | null): number {
  if (!fault) return data & 0xff;
  const k = fault.from;
  let v = 0;
  for (let j = 0; j < 8; j++) {
    const bit = j < k ? (data >> j) & 1 : j === k ? 1 : (data >> (j - 1)) & 1;
    v |= bit << j;
  }
  return v;
}

/** Where wire `i` (from the 74LS157 output for bit i) ends up: the 189 data input bit, or null. */
export function wireDestination(i: number, fault: WiringFault | null): number | null {
  if (!fault || i < fault.from) return i;
  return i + 1 <= 7 ? i + 1 : null;
}

/** "Walk a 1 through": write 1<<i to address i and read it back. */
export function walkingOnes(fault: WiringFault | null): { wrote: number; read: number }[] {
  return Array.from({ length: 8 }, (_, i) => ({ wrote: 1 << i, read: faultyStore(1 << i, fault) }));
}
