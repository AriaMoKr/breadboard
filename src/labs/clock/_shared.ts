/**
 * Pure models for the clock labs (videos 2-5): 555 timing formulas, a
 * numerical capacitor simulation, the 555 flip-flop function table and
 * switch-bounce generators. No DOM access; unit-tested in
 * tests/labs-clock-seq.test.ts.
 */

import type { Circuit, Net } from '../../logic/circuit';

export type Bit = 0 | 1;

export const VCC = 5;
/** Trigger comparator reference: the bottom of the 5k-5k-5k divider (1/3 Vcc). */
export const V_LOW_REF = VCC / 3;
/** Threshold comparator reference: pin 5 CV (2/3 Vcc). */
export const V_HIGH_REF = (2 * VCC) / 3;
/** RESET (pin 4) counts as low below about 0.7 V (datasheet: 0.4 to 1 V). */
export const V_RESET = 0.7;
/** The discharge transistor dumps the timing capacitor in a few microseconds. */
export const DISCHARGE_TAU = 5e-6;

// ---------------------------------------------------------------------------
// Formulas (LM555 datasheet)

export interface AstableTiming {
  /** Output high time: C charges through RA + RB. */
  tHigh: number;
  /** Output low time: C discharges through RB into pin 7. */
  tLow: number;
  period: number;
  freq: number;
  /** Fraction of the period the output is high. */
  duty: number;
}

export function astableTiming(ra: number, rb: number, c: number): AstableTiming {
  const tHigh = 0.693 * (ra + rb) * c;
  const tLow = 0.693 * rb * c;
  return { tHigh, tLow, period: tHigh + tLow, freq: 1.44 / ((ra + 2 * rb) * c), duty: (ra + rb) / (ra + 2 * rb) };
}

/** Monostable pulse width t = 1.1·R·C (C charges from 0 to 2/3 Vcc: RC·ln 3). */
export function monostableWidth(r: number, c: number): number {
  return 1.1 * r * c;
}

// ---------------------------------------------------------------------------
// The 555 flip-flop

export interface ComparatorState {
  /** Trigger comparator: pin 2 below 1/3 Vcc, sets the flip-flop. */
  trig: boolean;
  /** Threshold comparator: pin 6 above 2/3 Vcc, resets the flip-flop. */
  thr: boolean;
}

export function comparators(trigV: number, thrV: number, loRef = V_LOW_REF, hiRef = V_HIGH_REF): ComparatorState {
  return { trig: trigV < loRef, thr: thrV > hiRef };
}

/**
 * Next flip-flop state (= output pin 3) from the LM555 function table:
 * RESET low forces the output low; otherwise TRIG below 1/3 Vcc sets it
 * (even if THR is above 2/3 Vcc); otherwise THR above 2/3 Vcc resets it;
 * otherwise it holds.
 */
export function latch555(q: Bit, trigV: number, thrV: number, resetV: number = VCC, loRef = V_LOW_REF, hiRef = V_HIGH_REF): Bit {
  if (resetV < V_RESET) return 0;
  if (trigV < loRef) return 1;
  if (thrV > hiRef) return 0;
  return q;
}

// ---------------------------------------------------------------------------
// Astable simulation

export interface AstableEdge {
  t: number;
  /** New output level. */
  q: Bit;
  /** Which comparator flipped the latch. */
  by: 'thr' | 'trig';
}

/**
 * Numerical astable 555: the capacitor charges towards Vcc through RA + RB
 * while the output is high and discharges towards 0 V through RB (into the
 * discharge transistor on pin 7) while it is low. Each sub-step applies the
 * exponential RC response; a threshold crossing inside a sub-step is found
 * by interpolation and flips the latch.
 */
export class Astable555 {
  t = 0;
  vc = 0;
  /** At power-up C is empty, so the trigger comparator sets the latch. */
  q: Bit = 1;
  hiRef = V_HIGH_REF;
  loRef = V_LOW_REF;
  /** Random comparator-reference jitter in volts (no 0.01 µF on CV). */
  noise = 0;
  rng: () => number = Math.random;
  readonly edges: AstableEdge[] = [];

  constructor(
    public ra: number,
    public rb: number,
    public c: number,
  ) {}

  tauCharge(): number {
    return (this.ra + this.rb) * this.c;
  }
  /** RB = 0 would short C straight into the transistor; ~1 Ω models its on-resistance. */
  tauDischarge(): number {
    return Math.max(this.rb, 1) * this.c;
  }

  advance(dt: number, onEdge?: (e: AstableEdge) => void): void {
    let left = dt;
    let guard = 0;
    while (left > 1e-15 && guard++ < 2_000_000) {
      const charging = this.q === 1;
      const tau = charging ? this.tauCharge() : this.tauDischarge();
      const target = charging ? VCC : 0;
      const h = Math.min(left, tau / 64);
      const v1 = target + (this.vc - target) * Math.exp(-h / tau);
      const ref = charging ? this.hiRef : this.loRef;
      const crossed = charging ? v1 >= ref : v1 <= ref;
      if (!crossed) {
        this.vc = v1;
        this.t += h;
        left -= h;
        continue;
      }
      const f = v1 === this.vc ? 1 : Math.min(1, Math.max(0, (ref - this.vc) / (v1 - this.vc)));
      const hc = h * f;
      this.t += hc;
      left -= hc;
      this.vc = ref;
      this.q = charging ? 0 : 1;
      const e: AstableEdge = { t: this.t, q: this.q, by: charging ? 'thr' : 'trig' };
      this.edges.push(e);
      if (this.edges.length > 32) this.edges.shift();
      if (this.noise > 0) {
        const n = Math.min(this.noise, 0.4);
        this.hiRef = V_HIGH_REF + (this.rng() * 2 - 1) * n;
        this.loRef = V_LOW_REF + (this.rng() * 2 - 1) * n;
      } else {
        this.hiRef = V_HIGH_REF;
        this.loRef = V_LOW_REF;
      }
      onEdge?.(e);
    }
  }

  /** Time between the last two rising output edges, or null. */
  measuredPeriod(): number | null {
    const rises = this.edges.filter((e) => e.q === 1);
    if (rises.length < 2) return null;
    return rises[rises.length - 1].t - rises[rises.length - 2].t;
  }

  /** Last measured high time (rise to fall), or null. */
  measuredHigh(): number | null {
    for (let i = this.edges.length - 1; i > 0; i--) {
      if (this.edges[i].q === 0 && this.edges[i - 1].q === 1) return this.edges[i].t - this.edges[i - 1].t;
    }
    return null;
  }
}

/** Run the numerical model for `cycles` periods and return the mean simulated period. */
export function simulateAstablePeriod(ra: number, rb: number, c: number, cycles = 6): number {
  const m = new Astable555(ra, rb, c);
  const T = astableTiming(ra, rb, c).period;
  m.advance(T * 2); // skip the longer first cycle (C starts at 0 V)
  const rises: number[] = [];
  m.advance(T * (cycles + 0.5), (e) => e.q === 1 && rises.push(e.t));
  if (rises.length < 2) return NaN;
  return (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
}

// ---------------------------------------------------------------------------
// Monostable simulation

/**
 * Monostable 555: pin 2 is pulled up (1 kΩ) and grounded by the button,
 * pins 6 and 7 go to R (1 MΩ) and C. While the output is high the
 * discharge transistor is off and C charges through R; at 2/3 Vcc the
 * threshold comparator resets the latch and C is dumped.
 */
export class Monostable555 {
  t = 0;
  vc = 0;
  q: Bit = 0;
  constructor(
    public r: number,
    public c: number,
  ) {}

  /** Advance `h` seconds with pin 2 at `trigV` volts. */
  step(h: number, trigV: number): void {
    this.q = latch555(this.q, trigV, this.vc);
    if (this.q) this.vc = VCC + (this.vc - VCC) * Math.exp(-h / (this.r * this.c));
    else this.vc *= Math.exp(-h / DISCHARGE_TAU);
    this.t += h;
    this.q = latch555(this.q, trigV, this.vc);
  }
}

// ---------------------------------------------------------------------------
// Switch bounce

/** A contact transition: t in seconds after the event, v = 1 closed, 0 open. */
export interface Edge {
  t: number;
  v: Bit;
}

/** Small deterministic PRNG (for tests and repeatable demos). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n sorted random times in (0, span] at least `gap` apart. */
function bounceTimes(rng: () => number, n: number, span: number, gap: number): number[] {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) ts.push(rng() * span);
  ts.sort((a, b) => a - b);
  for (let i = 0; i < ts.length; i++) ts[i] = Math.max(ts[i], (i ? ts[i - 1] : 0) + gap);
  return ts;
}

/**
 * A push-button press: the contact closes at t = 0, then bounces open and
 * closed 1-5 times over a few milliseconds and ends closed.
 */
export function pressBounce(rng: () => number, opts: { min?: number; max?: number; spanMs?: number } = {}): Edge[] {
  const min = opts.min ?? 1, max = opts.max ?? 5;
  const bounces = min + Math.floor(rng() * (max - min + 1));
  const span = ((opts.spanMs ?? 3) * (0.6 + 0.8 * rng())) / 1000;
  const edges: Edge[] = [{ t: 0, v: 1 }];
  const ts = bounceTimes(rng, bounces * 2, span, 50e-6);
  ts.forEach((t, i) => edges.push({ t, v: i % 2 === 0 ? 0 : 1 }));
  return edges;
}

/** A release: the contact opens at t = 0 and touches again 0-2 times. */
export function releaseBounce(rng: () => number, opts: { max?: number; spanMs?: number } = {}): Edge[] {
  const n = Math.floor(rng() * ((opts.max ?? 2) + 1));
  const span = ((opts.spanMs ?? 1.5) * (0.6 + 0.8 * rng())) / 1000;
  const edges: Edge[] = [{ t: 0, v: 0 }];
  bounceTimes(rng, n * 2, span, 50e-6).forEach((t, i) => edges.push({ t, v: i % 2 === 0 ? 1 : 0 }));
  return edges;
}

/** Contact level at time t, given its edges (sorted) and the level before them. */
export function levelAt(edges: readonly Edge[], t: number, before: Bit): Bit {
  let v = before;
  for (const e of edges) {
    if (e.t > t) break;
    v = e.v;
  }
  return v;
}

/** Number of open-to-closed transitions (the edges a counter on a plain switch would count). */
export function countClosures(edges: readonly Edge[], before: Bit = 0): number {
  let v = before, n = 0;
  for (const e of edges) {
    if (e.v === 1 && v === 0) n++;
    v = e.v;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Bistable 555 with an SPDT switch

export type SpdtSide = 'a' | 'c';

export interface SpdtFlip {
  /** Contact edges of throw A (to pin 2 TRIG) and throw C (to pin 4 RESET). */
  a: Edge[];
  c: Edge[];
  /** Level of each contact before the flip. */
  a0: Bit;
  c0: Bit;
  to: SpdtSide;
}

/**
 * The lever of the mode switch moves to throw `to`. It leaves the old
 * contact (maybe with a little chatter), travels for ~1.5 ms with both
 * contacts open, then lands on the new contact and bounces on it.
 * `severity` (0..1) scales how many bounces and how long they last.
 */
export function spdtFlip(rng: () => number, to: SpdtSide, severity: number): SpdtFlip {
  const sev = Math.max(0, Math.min(1, severity));
  const leave: Edge[] = [{ t: 0, v: 0 }];
  if (sev > 0.3 && rng() < sev) {
    const t1 = 60e-6 + rng() * 150e-6;
    leave.push({ t: t1, v: 1 }, { t: t1 + 40e-6 + rng() * 60e-6, v: 0 });
  }
  const travel = 1.2e-3 + rng() * 0.8e-3;
  const n = Math.round(sev * 7 * (0.6 + 0.8 * rng()));
  const span = (0.3 + 4 * sev) * 1e-3;
  const land: Edge[] = [{ t: travel, v: 1 }];
  bounceTimes(rng, n * 2, span, 40e-6).forEach((t, i) => land.push({ t: travel + t, v: i % 2 === 0 ? 0 : 1 }));
  return to === 'a' ? { a: land, c: leave, a0: 0, c0: 1, to } : { a: leave, c: land, a0: 1, c0: 0, to };
}

export interface BistableCapture {
  /** Sample times in seconds (relative to the flip). */
  t: number[];
  /** Pin levels: 1 = pulled up to 5 V, 0 = grounded by the switch. */
  pin2: Bit[];
  pin4: Bit[];
  /** Trigger comparator output (pin 2 below 1/3 Vcc). */
  trig: Bit[];
  /** Reset input active (pin 4 low). */
  reset: Bit[];
  out: Bit[];
  outEdges: number;
  /** Separate times the trigger comparator fired (or reset was asserted). */
  trigFires: number;
  resetFires: number;
  /**
   * Edges on the pin the lever lands on: what a select line taken straight
   * from the switch (with its pull-up) would see.
   */
  bareEdges: number;
}

/**
 * Simulate the bistable 555 (pins 2 and 4 pulled up with 1 kΩ, THR on
 * GND, DIS unconnected) through one flip of the SPDT switch.
 */
export function simulateBistable(q0: Bit, flip: SpdtFlip, opts: { dt?: number; window?: number; pre?: number } = {}): BistableCapture {
  const dt = opts.dt ?? 10e-6, win = opts.window ?? 12e-3, pre = opts.pre ?? 1e-3;
  const cap: BistableCapture = { t: [], pin2: [], pin4: [], trig: [], reset: [], out: [], outEdges: 0, trigFires: 0, resetFires: 0, bareEdges: 0 };
  let q = q0;
  let prevTrig: Bit = 0, prevReset: Bit = 0, prevQ = q0;
  let prevLand: Bit = flip.to === 'a' ? flip.a0 : flip.c0;
  const n = Math.round(win / dt);
  for (let i = 0; i <= n; i++) {
    const t = -pre + i * dt;
    const a = t < 0 ? flip.a0 : levelAt(flip.a, t, flip.a0);
    const c = t < 0 ? flip.c0 : levelAt(flip.c, t, flip.c0);
    const v2 = a ? 0 : VCC;
    const v4 = c ? 0 : VCC;
    q = latch555(q, v2, 0, v4);
    const trig: Bit = v2 < V_LOW_REF ? 1 : 0;
    const reset: Bit = v4 < V_RESET ? 1 : 0;
    if (i > 0) {
      if (trig && !prevTrig) cap.trigFires++;
      if (reset && !prevReset) cap.resetFires++;
      if ((flip.to === 'a' ? a : c) !== prevLand) cap.bareEdges++;
      if (q !== prevQ) cap.outEdges++;
    }
    prevTrig = trig; prevReset = reset; prevQ = q;
    prevLand = flip.to === 'a' ? a : c;
    cap.t.push(t);
    cap.pin2.push(a ? 0 : 1);
    cap.pin4.push(c ? 0 : 1);
    cap.trig.push(trig);
    cap.reset.push(reset);
    cap.out.push(q);
  }
  return cap;
}

// ---------------------------------------------------------------------------
// Formatting

const PREFIX: [number, string][] = [
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Engineering notation: fmtSI(100e3, 'Ω') = "100 kΩ", fmtSI(0.139, 's') = "139 ms". */
export function fmtSI(v: number, unit: string, digits = 3): string {
  if (!isFinite(v)) return `∞ ${unit}`;
  if (v === 0) return `0 ${unit}`;
  const a = Math.abs(v);
  const [mult, p] = PREFIX.find(([m]) => a >= m * 0.9995) ?? PREFIX[PREFIX.length - 1];
  return `${+(v / mult).toPrecision(digits)} ${p}${unit}`;
}

/** Capacitance the way Ben writes it: "0.1 µF", "2 µF", "0.01 µF"; below 10 nF in nF. */
export function fmtF(v: number): string {
  if (v >= 1e-8) return `${+(v * 1e6).toPrecision(3)} µF`;
  return `${+(v * 1e9).toPrecision(3)} nF`;
}

// ---------------------------------------------------------------------------
// Clock logic (video 5)

/** CLK = ((astable AND SEL) OR (manual AND NOT SEL)) AND NOT HLT. */
export function clockEquation(astable: Bit, manual: Bit, sel: Bit, hlt: Bit): Bit {
  return (((astable & sel) | (manual & (sel ^ 1))) & (hlt ^ 1)) as Bit;
}

export interface ClockLogic {
  AST: Net;
  MONO: Net;
  SEL: Net;
  HLT: Net;
  u5a: Net;
  u4a: Net;
  u5b: Net;
  u6a: Net;
  u4d: Net;
  CLK: Net;
  CLKn: Net;
}

/**
 * Gate-level clock logic exactly as on Ben's schematic: U5A = astable AND
 * SEL, U4A = NOT SEL, U5B = manual AND U4A, U6A = U5A OR U5B, U4D = NOT
 * HLT, U5C = CLK = U6A AND U4D, U4F = ~CLK = NOT CLK
 * (74LS08 U5, 74LS04 U4, 74LS32 U6).
 */
export function buildClockLogic(c: Circuit): ClockLogic {
  const AST = c.input('astable', 0);
  const MONO = c.input('manual', 0);
  const SEL = c.input('SEL', 1);
  const HLT = c.input('HLT', 0);
  const u5a = c.net('U5A', 0);
  const u4a = c.net('U4A', 0);
  const u5b = c.net('U5B', 0);
  const u6a = c.net('U6A', 0);
  const u4d = c.net('U4D', 1);
  const CLK = c.net('CLK', 0);
  const CLKn = c.net('~CLK', 1);
  c.and([AST, SEL], u5a);
  c.not(SEL, u4a);
  c.and([MONO, u4a], u5b);
  c.or([u5a, u5b], u6a);
  c.not(HLT, u4d);
  c.and([u6a, u4d], CLK);
  c.not(CLK, CLKn);
  c.settle();
  return { AST, MONO, SEL, HLT, u5a, u4a, u5b, u6a, u4d, CLK, CLKn };
}
