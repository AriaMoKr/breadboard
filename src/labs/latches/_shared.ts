import type { Circuit, Level, Net } from '../../logic/circuit';
import { animate, h, setClass } from '../../ui/dom';
import type { Schematic } from '../../ui/schematic';

/**
 * Helpers shared by the gate-level labs (latches, flip-flops, counters):
 * a NOR SR latch that can recover from metastability, the D latch of
 * video 7, a variable-width RC edge detector, a sample recorder for the
 * Scope, a step loop with slow motion and a truth table widget.
 */

// ---------------------------------------------------------------------------
// DOM helpers

/** Add a <style> element inside `root`; returns a function that removes it. */
export function injectStyle(root: HTMLElement, css: string): () => void {
  const el = h('style', null, css);
  root.appendChild(el);
  return () => el.remove();
}

export function callout(text = ''): HTMLDivElement {
  return h('div', { class: 'callout', role: 'status' }, text);
}

export interface TruthTable {
  el: HTMLElement;
  rows: HTMLTableRowElement[];
  /** Highlight row i (-1 = none). */
  set(i: number): void;
}

export function truthTable(head: string[], rows: string[][]): TruthTable {
  const trs = rows.map((r) => h('tr', null, r.map((x) => h('td', null, x))));
  const table = h('table', { class: 'truth-table' }, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))), h('tbody', null, trs));
  let cur = -2;
  return {
    el: h('div', { style: 'overflow-x:auto;max-width:100%' }, table),
    rows: trs,
    set(i) {
      if (i === cur) return;
      cur = i;
      trs.forEach((tr, j) => setClass(tr, 'current', j === i));
    },
  };
}

// ---------------------------------------------------------------------------
// Recording samples for a Scope

/** Records one value per probe per call to `sample()` (ring buffer). */
export class Recorder {
  readonly samples: (Level | number)[][];
  constructor(
    private probes: (() => Level | number)[],
    readonly max: number,
  ) {
    this.samples = probes.map(() => []);
  }
  sample() {
    this.probes.forEach((p, i) => {
      const arr = this.samples[i];
      arr.push(p());
      if (arr.length > this.max) arr.shift();
    });
  }
  clear() {
    for (const s of this.samples) s.length = 0;
  }
  get length() {
    return this.samples[0]?.length ?? 0;
  }
}

/** A Recorder that samples nets. */
export const netRecorder = (nets: Net[], max: number) => new Recorder(nets.map((n) => () => n.value), max);

// ---------------------------------------------------------------------------
// Time

export interface StepLoopOptions {
  /** Gate delays per second at normal speed. */
  rate: () => number;
  /** Slow motion: one step every `slowMs` milliseconds. */
  slow?: () => boolean;
  slowMs?: number;
  maxPerFrame?: number;
  /** Return false to freeze time (e.g. after a single-shot capture). */
  running?: () => boolean;
  step: () => void;
  frame: () => void;
}

/** requestAnimationFrame loop that advances a circuit at a fixed rate. Returns stop(). */
export function stepLoop(o: StepLoopOptions): () => void {
  let acc = 0;
  const max = o.maxPerFrame ?? 12;
  return animate((dt) => {
    if (o.running && !o.running()) {
      acc = 0;
      o.frame();
      return;
    }
    acc += Math.min(dt, 100);
    const stepMs = o.slow?.() ? (o.slowMs ?? 350) : 1000 / Math.max(1, o.rate());
    let n = 0;
    while (acc >= stepMs && n < max) {
      acc -= stepMs;
      o.step();
      n++;
      if (o.running && !o.running()) break;
    }
    if (acc > stepMs * max) acc = 0;
    o.frame();
  });
}

/** Runs callbacks at future circuit times (scripted demos such as "wiggle D"). */
export class Timeline {
  private events: { at: number; fn: () => void }[] = [];
  /** Schedule `fn` at absolute circuit time `at`. */
  at(at: number, fn: () => void) {
    this.events.push({ at, fn });
    this.events.sort((a, b) => a.at - b.at);
  }
  /** Run everything due at or before `time`. */
  run(time: number) {
    while (this.events.length && this.events[0].at <= time) this.events.shift()!.fn();
  }
  clear() {
    this.events.length = 0;
  }
  get busy() {
    return this.events.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Circuits

export interface NorLatch {
  Q: Net;
  Qn: Net;
  /** Hidden inputs that force Q low / high (used only to resolve metastability). */
  force0: Net;
  force1: Net;
}

/**
 * Cross-coupled NOR SR latch (74LS02): Q = NOR(R, Q̅), Q̅ = NOR(S, Q).
 * Each gate has a hidden third input so a MetastabilityGuard can settle
 * the latch the way real (slightly unequal) gates would.
 */
export function norLatch(c: Circuit, S: Net, R: Net, name = '', q0: 0 | 1 = 0): NorLatch {
  const Q = c.net(`Q${name}`, q0);
  const Qn = c.net(`Q̅${name}`, q0 ? 0 : 1);
  const force0 = c.input(`force0${name}`, 0);
  const force1 = c.input(`force1${name}`, 0);
  c.nor([R, Qn, force0], Q);
  c.nor([S, Q, force1], Qn);
  return { Q, Qn, force0, force1 };
}

/**
 * The event-driven simulator uses transport delays, so a NOR latch that
 * receives a too-short pulse (or has S and R released at the same instant)
 * oscillates forever. Real gates are never exactly matched and one side
 * wins after a moment: this guard detects the oscillation while S = R = 0
 * and gives one random side a brief push.
 */
export class MetastabilityGuard {
  private hist: Level[] = [];
  private forcing: Net | null = null;
  private left = 0;
  /** Number of times the guard had to resolve the latch. */
  resolved = 0;
  /** True while it is still pushing the latch. */
  get busy() {
    return this.forcing !== null;
  }
  constructor(
    private c: Circuit,
    private latch: NorLatch,
    private S: Net,
    private R: Net,
    private rng: () => number = Math.random,
  ) {}

  /** Call after every circuit step. Returns true when it just resolved. */
  check(): boolean {
    if (this.forcing) {
      if (--this.left <= 0) {
        this.c.set(this.forcing, 0);
        this.forcing = null;
        this.hist.length = 0;
      }
      return false;
    }
    this.hist.push(this.latch.Q.value);
    if (this.hist.length > 10) this.hist.shift();
    if (this.hist.length < 10 || this.S.value !== 0 || this.R.value !== 0) return false;
    let toggles = 0;
    for (let i = 1; i < this.hist.length; i++) if (this.hist[i] !== this.hist[i - 1]) toggles++;
    if (toggles < 6) return false;
    this.forcing = this.rng() < 0.5 ? this.latch.force0 : this.latch.force1;
    this.c.set(this.forcing, 1);
    this.left = 3;
    this.resolved++;
    return true;
  }
}

export interface DLatch {
  /** D inverted by a NOR gate with both inputs tied together. */
  Dn: Net;
  S: Net;
  R: Net;
  latch: NorLatch;
}

/** Video 7: S = D·E and R = D̅·E (74LS08) into a NOR SR latch (74LS02). */
export function dLatch(c: Circuit, D: Net, E: Net, name = ''): DLatch {
  const Dn = c.net(`D̅${name}`, D.value === 1 ? 0 : 1);
  c.nor([D, D], Dn);
  const S = c.net(`S${name}`, 0);
  const R = c.net(`R${name}`, 0);
  c.and([D, E], S);
  c.and([Dn, E], R);
  const latch = norLatch(c, S, R, name);
  return { Dn, S, R, latch };
}

/**
 * RC edge detector (video 8): after each rising edge of `clk` the output
 * is high for `width()` gate delays. The width can change at run time.
 */
export function edgePulse(c: Circuit, clk: Net, out: Net, width: () => number, name = 'EDGE') {
  return c.add({
    kind: 'EDGE',
    name,
    inputs: [clk],
    outputs: [out],
    delay: 1,
    evaluate: ([v], ctx) => {
      if (ctx.prevInputs[0] === 0 && v === 1) {
        ctx.schedule(0, 1, 1);
        ctx.schedule(0, 0, 1 + Math.max(1, Math.round(width())));
      }
    },
  });
}

/**
 * Video 8's other edge detector: CLK AND (CLK through an odd number of
 * inverters). The inverted copy lags CLK by one gate delay per inverter,
 * so right after a rising edge both AND inputs are high for that long.
 * One inverter chain is tapped after each count in `taps` (odd numbers),
 * with one AND gate per tap. Falling edges give no pulse.
 */
export function gateDelayEdgeDetectors(c: Circuit, clk: Net, taps: number[], name = 'gd'): { chain: Net[]; pulses: Net[] } {
  const longest = Math.max(1, ...taps);
  const chain: Net[] = [];
  let prev = clk;
  const clk0 = clk.value === 1 ? 1 : 0;
  for (let i = 0; i < longest; i++) {
    const n = c.net(`${name}${i + 1}`, (clk0 ^ ((i + 1) & 1)) as 0 | 1);
    c.not(prev, n);
    chain.push(n);
    prev = n;
  }
  const pulses = taps.map((t) => {
    const p = c.net(`${name}P${t}`, 0);
    c.and([clk, chain[t - 1]], p);
    return p;
  });
  return { chain, pulses };
}

/** D latch truth-table row: 0 = hold (E low), 1 = E high and D low, 2 = E high and D high. */
export function dLatchRow(d: Level, e: Level): number {
  return e !== 1 ? 0 : d === 1 ? 2 : 1;
}

/**
 * Count the real toggles in a sampled lane (one sample per gate delay):
 * runs shorter than `minRun` samples (metastable ring oscillation, which
 * flips every gate delay) are ignored, except the final settled value.
 */
export function countToggles(samples: readonly (Level | number)[], minRun = 2): number {
  const runs: { v: Level | number; n: number }[] = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last.v === s) last.n++;
    else runs.push({ v: s, n: 1 });
  }
  const kept = runs.filter((r, i) => r.n >= minRun || i === 0 || i === runs.length - 1);
  let n = 0;
  for (let i = 1; i < kept.length; i++) if (kept[i].v !== kept[i - 1].v) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Drawing

export interface DLatchNets {
  D: Net;
  E: Net;
  Dn: Net;
  S: Net;
  R: Net;
  Q: Net;
  Qn: Net;
}

/**
 * Draw the gate-level D latch (video 7) like the SR latch lab: R on top
 * (Q gate), S at the bottom (Q̅ gate). D enters at (dx, 212.5) at the
 * bottom left and also feeds the NOR-as-inverter at the top; the enable
 * line enters at (eFromX, 140). Output probes are at x = 540.
 */
export function drawDLatch(sch: Schematic, n: DLatchNets, opts: { dx?: number; eFromX: number; eLabel?: string }) {
  const inv = sch.gate('NOR', [140, 60], { label: 'NOR as NOT', output: n.Dn });
  const a1 = sch.gate('AND', [260, 67.5], { label: '74LS08', output: n.R });
  const a2 = sch.gate('AND', [260, 205], { label: '74LS08', output: n.S });
  const g1 = sch.gate('NOR', [400, 80], { label: '74LS02', output: n.Q });
  const g2 = sch.gate('NOR', [400, 195], { label: '74LS02', output: n.Qn });
  const dx = opts.dx ?? 60;
  // D and its inverter
  sch.wire(n.D, [dx, 212.5], a2.inputs[1]);
  sch.wire(n.D, [100, 212.5], [100, 52.5], inv.inputs[0]);
  sch.wire(n.D, [100, 67.5], inv.inputs[1]);
  sch.dot(n.D, [100, 212.5]);
  sch.dot(n.D, [100, 67.5]);
  sch.wire(n.Dn, inv.output, a1.inputs[0]);
  // enable
  sch.wire(n.E, [opts.eFromX, 140], [225, 140]);
  sch.wire(n.E, [225, 75], [225, 197.5]);
  sch.wire(n.E, [225, 75], a1.inputs[1]);
  sch.wire(n.E, [225, 197.5], a2.inputs[0]);
  sch.dot(n.E, [225, 140]);
  // S/R into the NOR latch
  sch.wire(n.R, a1.output, [350, 67.5], [350, 72.5], g1.inputs[0]);
  sch.wire(n.S, a2.output, [350, 205], [350, 202.5], g2.inputs[1]);
  sch.text(`R = D̅·${opts.eLabel ?? 'E'}`, [318, 52], { anchor: 'start', size: 11, class: 'gate-label' });
  sch.text(`S = D·${opts.eLabel ?? 'E'}`, [318, 222], { anchor: 'start', size: 11, class: 'gate-label' });
  // cross-coupled feedback
  sch.wire(n.Q, g1.output, [530, 80]);
  sch.wire(n.Qn, g2.output, [530, 195]);
  sch.wire(n.Q, [465, 80], [465, 110], [372, 160], [372, g2.inputs[0].y], g2.inputs[0]);
  sch.wire(n.Qn, [480, 195], [480, 165], [382, 115], [382, g1.inputs[1].y], g1.inputs[1]);
  sch.dot(n.Q, [465, 80]);
  sch.dot(n.Qn, [480, 195]);
  sch.probe(n.Q, [540, 80], { label: 'Q', color: 'red' });
  sch.probe(n.Qn, [540, 195], { label: 'Q̅', color: 'red' });
}

/** TTL input-high threshold (74LS: 2.0 V). */
export const V_IH = 2;

/**
 * One gate-delay step of the RC differentiator voltage (video 8): the
 * output jumps by 5 V times the clock change (+5 V on a rising edge, -5 V
 * on a falling edge) and decays exponentially. τ is chosen so the voltage
 * stays above V_IH for `width` steps, matching the digital edge pulse.
 */
export function rcEdgeVoltage(v: number, dClk: number, width: number): number {
  const tau = Math.max(0.5, width) / Math.log(5 / V_IH);
  return v * Math.exp(-1 / tau) + 5 * dClk;
}
