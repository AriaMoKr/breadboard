import { Circuit, type Level, type Net } from '../../logic/circuit';
import type { Schematic } from '../../ui/schematic';
import { MetastabilityGuard, type NorLatch, countToggles, edgePulse, norLatch } from '../latches/_shared';

/**
 * Models for the counter chapter (videos 24-27): the JK characteristic
 * equation, the edge-triggered JK of videos 24/25 (NOR latch + 74LS11
 * 3-input ANDs + RC edge detector), the master-slave JK of video 26, a
 * behavioural 74LS76 and the ripple-counter sequence of video 27.
 */

export type Bit = 0 | 1;

/** JK characteristic equation: Q⁺ = J·Q̅ + K̅·Q. */
export function jkNext(q: Bit, j: Bit, k: Bit): Bit {
  return ((j & (q ^ 1)) | ((k ^ 1) & q)) as Bit;
}

/** Truth-table row for J, K: 0 hold, 1 reset, 2 set, 3 toggle. */
export function jkRow(j: Level, k: Level): number {
  return (j === 1 ? 2 : 0) + (k === 1 ? 1 : 0);
}

export const JK_ROWS: string[][] = [
  ['0', '0', 'Q', 'hold'],
  ['0', '1', '0', 'reset'],
  ['1', '0', '1', 'set'],
  ['1', '1', 'Q̅', 'toggle'],
];

// ---------------------------------------------------------------------------
// Edge-triggered JK (videos 24 and 25)

export interface EdgeJK {
  S: Net;
  R: Net;
  latch: NorLatch;
}

/**
 * NOR SR latch (74LS02) with 3-input AND gating (74LS11):
 * S = J·P·Q̅ and R = K·P·Q, where P is the edge-detected clock. When the
 * optional `feedback` net is low the third inputs read as 1 (wires
 * removed), which turns it back into a plain SR flip-flop.
 */
export function edgeJK(c: Circuit, J: Net, K: Net, P: Net, feedback?: Net): EdgeJK {
  const S = c.net('S', 0);
  const R = c.net('R', 0);
  const latch = norLatch(c, S, R);
  const and3 = (a: Net, fb: Net, out: Net, name: string) =>
    c.add({
      kind: 'AND3',
      name,
      inputs: feedback ? [a, P, fb, feedback] : [a, P, fb],
      outputs: [out],
      delay: 1,
      evaluate: ([x, p, q, f]) => {
        const qq = feedback && f !== 1 ? 1 : q;
        return [x === 1 && p === 1 && qq === 1 ? 1 : x === 0 || p === 0 || qq === 0 ? 0 : 'X'];
      },
    });
  and3(J, latch.Qn, S, 'U2A');
  and3(K, latch.Q, R, 'U2B');
  return { S, R, latch };
}

export interface RaceResult {
  toggles: number;
  final: Bit;
  /** The latch had to be resolved (pulse ended mid-transition). */
  metastable: boolean;
  /** Q sampled every gate delay from the rising clock edge. */
  q: Level[];
}

/**
 * Video 25: fire one clock edge into the edge-triggered JK with J = K = 1
 * and an RC pulse `width` gate delays long, and count how often Q toggles
 * while the pulse is high.
 */
export function raceTrial(width: number, opts: { j?: Bit; k?: Bit; q0?: Bit; rng?: () => number; tail?: number } = {}): RaceResult {
  const c = new Circuit();
  const J = c.input('J', opts.j ?? 1), K = c.input('K', opts.k ?? 1), CLK = c.input('CLK', 0);
  const P = c.net('P', 0);
  edgePulse(c, CLK, P, () => width);
  const jk = edgeJK(c, J, K, P);
  if (opts.q0 === 1) {
    c.set(jk.latch.force1, 1);
    c.settle();
    c.set(jk.latch.force1, 0);
  }
  c.settle();
  const guard = new MetastabilityGuard(c, jk.latch, jk.S, jk.R, opts.rng ?? Math.random);
  c.set(CLK, 1);
  const q: Level[] = [jk.latch.Q.value];
  const steps = width + (opts.tail ?? 40);
  for (let i = 0; i < steps; i++) {
    c.step();
    guard.check();
    q.push(jk.latch.Q.value);
  }
  const last = q[q.length - 1];
  return { toggles: countToggles(q), final: last === 1 ? 1 : 0, metastable: guard.resolved > 0, q };
}

// ---------------------------------------------------------------------------
// Master-slave JK (video 26)

export interface MasterSlaveJK {
  CLKn: Net;
  Sm: Net;
  Rm: Net;
  master: NorLatch;
  Ss: Net;
  Rs: Net;
  slave: NorLatch;
}

/**
 * Master: Sm = J·CLK·Q̅, Rm = K·CLK·Q (74LS11) into a NOR latch (74LS02).
 * Slave: Ss = Qm·~CLK, Rs = Q̅m·~CLK (74LS08, ~CLK from a 74LS04) into a
 * second NOR latch. The feedback comes from the slave, which is frozen
 * while the master listens, so there is nothing to race.
 */
export function masterSlaveJK(c: Circuit, J: Net, K: Net, CLK: Net): MasterSlaveJK {
  const CLKn = c.net('~CLK', CLK.value === 1 ? 0 : 1);
  c.not(CLK, CLKn);
  const Sm = c.net('Sm', 0), Rm = c.net('Rm', 0);
  const master = norLatch(c, Sm, Rm, 'm');
  const Ss = c.net('Ss', 0), Rs = c.net('Rs', CLKn.value);
  const slave = norLatch(c, Ss, Rs, '');
  const and3 = (a: Net, b: Net, d: Net, out: Net, name: string) => c.add({ kind: 'AND3', name, inputs: [a, b, d], outputs: [out], delay: 1, evaluate: (l) => [l.every((x) => x === 1) ? 1 : l.some((x) => x === 0) ? 0 : 'X'] });
  and3(J, CLK, slave.Qn, Sm, 'U1A');
  and3(K, CLK, slave.Q, Rm, 'U1B');
  c.and([master.Q, CLKn], Ss);
  c.and([master.Qn, CLKn], Rs);
  return { CLKn, Sm, Rm, master, Ss, Rs, slave };
}

// ---------------------------------------------------------------------------
// 74LS76 and the ripple counter (video 27)

export interface Ls76Pins {
  J: Net;
  K: Net;
  CLK: Net;
  PRE: Net;
  CLR: Net;
  Q: Net;
  Qn: Net;
  /** Optional third output: Q or Q̅ (chosen by `sel`) for the next stage's clock. */
  next?: Net;
  sel?: Net;
}

/**
 * Behavioural half of a 74LS76: JK flip-flop triggered on the falling
 * clock edge, with asynchronous active-low preset and clear. `delay` is
 * the clock-to-output propagation delay in gate delays.
 */
export function ls76(c: Circuit, p: Ls76Pins, delay: () => number, name = '74LS76') {
  const ins = [p.J, p.K, p.CLK, p.PRE, p.CLR];
  if (p.sel) ins.push(p.sel);
  const outs = [p.Q, p.Qn];
  if (p.next) outs.push(p.next);
  return c.add({
    kind: '74LS76',
    name,
    inputs: ins,
    outputs: outs,
    delay: 1,
    evaluate: ([j, k, clk, pre, clr, sel], ctx) => {
      let q = (ctx.state.q as Bit | undefined) ?? (p.Q.value === 1 ? 1 : 0);
      const fell = ctx.prevInputs[2] === 1 && clk === 0;
      let a: Level, b: Level;
      if (pre === 0 && clr === 0) {
        a = 1;
        b = 1; // both outputs high: not allowed in normal use
      } else {
        if (clr === 0) q = 0;
        else if (pre === 0) q = 1;
        else if (fell) q = jkNext(q, j === 1 ? 1 : 0, k === 1 ? 1 : 0);
        a = q;
        b = q ? 0 : 1;
      }
      ctx.state.q = q;
      const dl = Math.max(1, Math.round(delay()));
      ctx.schedule(0, a, dl);
      ctx.schedule(1, b, dl);
      if (p.next) ctx.schedule(2, sel === 1 ? b : a, dl);
    },
  });
}

/** 74LS76 pinout (eater.net output.png): pin number → name. */
export const LS76_PINS: Record<number, string> = {
  1: '1CLK', 2: '1PRE̅', 3: '1CLR̅', 4: '1J', 5: 'VCC', 6: '2CLK', 7: '2PRE̅', 8: '2CLR̅',
  9: '2J', 10: '2Q̅', 11: '2Q', 12: '2K', 13: 'GND', 14: '1Q̅', 15: '1Q', 16: '1K',
};

/** 74LS76 function table (one flip-flop), in the order of LS76_ROWS. */
export const LS76_ROWS: string[][] = [
  ['0', '1', 'x', 'x', 'x', '1', 'preset (no clock needed)'],
  ['1', '0', 'x', 'x', 'x', '0', 'clear (no clock needed)'],
  ['0', '0', 'x', 'x', 'x', '1*', 'not allowed: Q = Q̅ = 1'],
  ['1', '1', '↓', '0', '0', 'Q', 'hold'],
  ['1', '1', '↓', '0', '1', '0', 'reset'],
  ['1', '1', '↓', '1', '0', '1', 'set'],
  ['1', '1', '↓', '1', '1', 'Q̅', 'toggle'],
];

/** Row of LS76_ROWS that applies to the current pin levels (PRE̅ and CLR̅ are active low). */
export function ls76Row(pre: Level, clr: Level, j: Level, k: Level): number {
  if (pre === 0 && clr === 0) return 2;
  if (pre === 0) return 0;
  if (clr === 0) return 1;
  return 3 + jkRow(j, k);
}

/**
 * The states a 4-bit ripple counter passes through after one falling clock
 * edge. Stage 0 toggles; each stage clocks the next on the falling edge of
 * Q (`from = 'q'`, counts up) or of Q̅ (`from = 'qn'`, counts down).
 * Returns every intermediate count, the last one being the settled count.
 */
export function rippleSequence(count: number, bits = 4, from: 'q' | 'qn' = 'q'): number[] {
  const out: number[] = [];
  let v = count & ((1 << bits) - 1);
  for (let i = 0; i < bits; i++) {
    const was = (v >> i) & 1;
    v ^= 1 << i;
    out.push(v);
    const fellQ = was === 1; // Q went 1 -> 0
    const clocksNext = from === 'q' ? fellQ : !fellQ;
    if (!clocksNext) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing: the edge-triggered JK (videos 24 and 25)

export interface JKDrawingNets {
  J: Net;
  K: Net;
  CLK: Net;
  P: Net;
  S: Net;
  R: Net;
  Q: Net;
  Qn: Net;
}

/**
 * K row on top (R resets Q, the top NOR gives Q), J row at the bottom, like
 * the SR latch lab. Feedback: Q loops over the top into K's AND, Q̅ loops
 * under the bottom into J's AND. Returns the feedback wires.
 */
export function drawEdgeJK(sch: Schematic, n: JKDrawingNets, opts: { rcLabel?: string } = {}) {
  const aK = sch.gate('AND', [230, 70], { inputs: 3, label: '74LS11', output: n.R });
  const aJ = sch.gate('AND', [230, 200], { inputs: 3, label: '74LS11', output: n.S });
  const gQ = sch.gate('NOR', [360, 80], { label: '74LS02', output: n.Q });
  const gQn = sch.gate('NOR', [360, 190], { label: '74LS02', output: n.Qn });
  sch.wire(n.K, [60, 70], aK.inputs[1]);
  sch.wire(n.J, [60, 200], aJ.inputs[1]);
  sch.chip([100, 117], { label: 'RC', sublabel: opts.rcLabel ?? 'edge det.', width: 70, height: 36, left: [{ name: '', net: n.CLK }], right: [{ name: '', net: n.P }] });
  sch.wire(n.CLK, [60, 135], [88, 135]);
  sch.wire(n.P, [182, 135], [200, 135]);
  sch.wire(n.P, [200, aK.inputs[2].y], [200, aJ.inputs[0].y]);
  sch.wire(n.P, [200, aK.inputs[2].y], aK.inputs[2]);
  sch.wire(n.P, [200, aJ.inputs[0].y], aJ.inputs[0]);
  sch.dot(n.P, [200, 135]);
  sch.text('P', [190, 124], { size: 11, class: 'gate-label' });
  sch.wire(n.R, aK.output, [315, 70], [315, 72.5], gQ.inputs[0]);
  sch.wire(n.S, aJ.output, [315, 200], [315, 197.5], gQn.inputs[1]);
  sch.text('R = K·P·Q', [286, 56], { anchor: 'start', size: 11, class: 'gate-label' });
  sch.text('S = J·P·Q̅', [286, 216], { anchor: 'start', size: 11, class: 'gate-label' });
  // latch
  sch.wire(n.Q, gQ.output, [520, 80]);
  sch.wire(n.Qn, gQn.output, [520, 190]);
  sch.wire(n.Q, [425, 80], [425, 108], [332, 152], [332, gQn.inputs[0].y], gQn.inputs[0]);
  sch.wire(n.Qn, [440, 190], [440, 162], [342, 118], [342, gQ.inputs[1].y], gQ.inputs[1]);
  sch.dot(n.Q, [425, 80]);
  sch.dot(n.Qn, [440, 190]);
  // JK feedback
  const fbQ = sch.wire(n.Q, [480, 80], [480, 24], [206, 24], [206, aK.inputs[0].y], aK.inputs[0]);
  const fbQn = sch.wire(n.Qn, [495, 190], [495, 248], [206, 248], [206, aJ.inputs[2].y], aJ.inputs[2]);
  const d1 = sch.dot(n.Q, [480, 80]);
  const d2 = sch.dot(n.Qn, [495, 190]);
  sch.probe(n.Q, [530, 80], { label: 'Q', color: 'red' });
  sch.probe(n.Qn, [530, 190], { label: 'Q̅', color: 'red' });
  return { feedback: [fbQ, fbQn, d1, d2] as SVGElement[] };
}
