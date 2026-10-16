import { beforeAll, describe, expect, it } from 'vitest';
import { Circuit, type Level } from '../src/logic/circuit';
import {
  Astable555,
  Monostable555,
  V_HIGH_REF,
  V_LOW_REF,
  VCC,
  astableTiming,
  buildClockLogic,
  clockEquation,
  countClosures,
  fmtF,
  fmtSI,
  latch555,
  levelAt,
  monostableWidth,
  mulberry32,
  pressBounce,
  simulateAstablePeriod,
  simulateBistable,
  spdtFlip,
} from '../src/labs/clock/_shared';
import type { Lab } from '../src/labs/types';
import { LAB_IDS as CHAPTER_LAB_IDS } from '../src/app/chapters';
import { MetastabilityGuard, V_IH, countToggles, dLatch, dLatchRow, edgePulse, gateDelayEdgeDetectors, rcEdgeVoltage } from '../src/labs/latches/_shared';
import { LS76_PINS, LS76_ROWS, edgeJK, jkNext, jkRow, ls76, ls76Row, masterSlaveJK, raceTrial, rippleSequence } from '../src/labs/counter/_shared';

// ===========================================================================
// 555 models (videos 2-4)

describe('555 astable model', () => {
  it('formulas match the datasheet and Ben’s numbers', () => {
    const t = astableTiming(1e3, 100e3, 1e-6);
    expect(t.period).toBeCloseTo(0.1393, 3); // 0.693 × 201k × 1 µF = 139 ms
    expect(t.tHigh).toBeCloseTo(0.0700, 3);
    expect(t.tLow).toBeCloseTo(0.0693, 3);
    expect(t.freq).toBeCloseTo(7.164, 2);
    expect(t.duty).toBeCloseTo(101 / 201, 4);
    // Ben's capacitor really was ~2 µF: 278 ms predicted vs 263 ms measured
    expect(astableTiming(1e3, 100e3, 2e-6).period).toBeCloseTo(0.2786, 3);
    // final clock: pot at 0 -> ~480 Hz, pot at 1 MΩ -> ~0.72 Hz
    expect(astableTiming(1e3, 1e3, 1e-6).freq).toBeCloseTo(480, -1);
    expect(astableTiming(1e3, 1e3 + 1e6, 1e-6).freq).toBeCloseTo(0.72, 2);
  });

  it.each([
    [1e3, 100e3, 1e-6],
    [1e3, 100e3, 2e-6],
    [1e3, 1e3, 1e-6],
    [1e3, 1.001e6, 1e-6],
    [47e3, 10e3, 0.1e-6],
    [1e3, 251e3, 0.01e-6],
  ])('simulated period matches 0.693(RA+2RB)C within 2%% (RA=%d RB=%d C=%d)', (ra, rb, c) => {
    const sim = simulateAstablePeriod(ra, rb, c);
    const formula = astableTiming(ra, rb, c).period;
    expect(Math.abs(sim - formula) / formula).toBeLessThan(0.02);
  });

  it('capacitor swings between 1/3 and 2/3 Vcc; first cycle starts from 0 V', () => {
    const m = new Astable555(1e3, 100e3, 1e-6);
    const edges: { t: number; q: number }[] = [];
    m.advance(1, (e) => edges.push(e));
    // first high time charges from 0 V: (RA+RB)·C·ln 3
    expect(edges[0].t).toBeCloseTo(101e3 * 1e-6 * Math.log(3), 3);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 2000; i++) {
      m.advance(0.0005);
      lo = Math.min(lo, m.vc);
      hi = Math.max(hi, m.vc);
    }
    expect(lo).toBeGreaterThan(V_LOW_REF - 0.02);
    expect(hi).toBeLessThan(V_HIGH_REF + 0.02);
    expect(m.measuredPeriod()).toBeCloseTo(0.1393, 2);
    expect(m.measuredHigh()).toBeCloseTo(0.0700, 2);
  });

  it('RB = 0 does not hang (transistor on-resistance)', () => {
    const m = new Astable555(1e3, 0, 1e-6);
    m.advance(0.05);
    expect(m.edges.length).toBeGreaterThan(10);
  });
});

describe('555 flip-flop function table', () => {
  it('reset wins, then trigger, then threshold, else hold', () => {
    expect(latch555(1, 0, 0, 0)).toBe(0); // RESET low
    expect(latch555(0, 1, 4, VCC)).toBe(1); // trigger wins over threshold
    expect(latch555(1, 4, 4, VCC)).toBe(0); // threshold resets
    expect(latch555(1, 4, 2, VCC)).toBe(1); // hold
    expect(latch555(0, 4, 2, VCC)).toBe(0); // hold
  });
});

describe('555 monostable model', () => {
  const pulse = (r: number, c: number, press: { t: number; v: 0 | 1 }[], holdS = 0.001, total = 4) => {
    const m = new Monostable555(r, c);
    const h = 20e-6;
    const edges = press.map((e) => ({ ...e }));
    const releaseAt = Math.max(...edges.map((e) => e.t)) + holdS;
    edges.push({ t: releaseAt, v: 0 });
    let rises = 0, rise = -1, width = -1;
    for (let t = 0; t < total; t += h) {
      const closed = levelAt(edges, t, 0);
      const prev = m.q;
      m.step(h, closed ? 0 : VCC);
      if (m.q && !prev) { rises++; rise = m.t; }
      if (!m.q && prev && width < 0) width = m.t - rise;
    }
    return { rises, width };
  };

  it('pulse width is 1.1·R·C (110 ms with 1 MΩ and 0.1 µF, 2.2 s with 2 µF)', () => {
    expect(monostableWidth(1e6, 0.1e-6)).toBeCloseTo(0.11, 6);
    const a = pulse(1e6, 0.1e-6, [{ t: 0.01, v: 1 }]);
    expect(a.rises).toBe(1);
    expect(Math.abs(a.width - 0.11) / 0.11).toBeLessThan(0.01);
    const b = pulse(1e6, 2e-6, [{ t: 0.01, v: 1 }]);
    expect(Math.abs(b.width - 2.2) / 2.2).toBeLessThan(0.01);
  });

  it('swallows contact bounce: one output pulse per press', () => {
    const rng = mulberry32(7);
    for (let k = 0; k < 20; k++) {
      const press = pressBounce(rng).map((e) => ({ t: 0.01 + e.t, v: e.v }));
      const r = pulse(1e6, 0.1e-6, press, 0.02, 0.4);
      expect(r.rises).toBe(1);
      expect(countClosures(press)).toBeGreaterThan(1);
    }
  });

  it('holding the trigger past the pulse keeps the output high until release (level triggered)', () => {
    const r = pulse(1e6, 0.1e-6, [{ t: 0.01, v: 1 }], 0.3, 1);
    expect(r.rises).toBe(1);
    expect(r.width).toBeGreaterThan(0.29);
  });
});

describe('switch bounce models', () => {
  it('press: 1-5 bounces over a few ms, ending closed', () => {
    const rng = mulberry32(42);
    for (let k = 0; k < 50; k++) {
      const e = pressBounce(rng);
      const closures = countClosures(e);
      expect(closures).toBeGreaterThanOrEqual(2);
      expect(closures).toBeLessThanOrEqual(6);
      expect(e[e.length - 1].v).toBe(1);
      expect(e[e.length - 1].t).toBeLessThan(0.006);
      for (let i = 1; i < e.length; i++) expect(e[i].t).toBeGreaterThan(e[i - 1].t);
    }
  });

  it('bistable 555: one clean output transition however much the contact bounces', () => {
    const rng = mulberry32(3);
    let q: 0 | 1 = 1;
    for (let k = 0; k < 20; k++) {
      const to = k % 2 === 0 ? 'c' : 'a';
      const flip = spdtFlip(rng, to, 1);
      const cap = simulateBistable(q, flip);
      expect(cap.outEdges).toBe(1);
      expect(cap.bareEdges).toBeGreaterThan(2);
      if (to === 'a') expect(cap.trigFires).toBeGreaterThan(1);
      else expect(cap.resetFires).toBeGreaterThan(1);
      q = cap.out[cap.out.length - 1];
      expect(q).toBe(to === 'a' ? 1 : 0);
    }
    // no bounce at all
    const clean = simulateBistable(0, spdtFlip(rng, 'a', 0));
    expect(clean.trigFires).toBe(1);
    expect(clean.outEdges).toBe(1);
  });
});

describe('formatting', () => {
  it('engineering units', () => {
    expect(fmtSI(100e3, 'Ω')).toBe('100 kΩ');
    expect(fmtSI(0.1393, 's')).toBe('139 ms');
    expect(fmtSI(1e6, 'Ω')).toBe('1 MΩ');
    expect(fmtF(0.1e-6)).toBe('0.1 µF');
    expect(fmtF(2e-6)).toBe('2 µF');
    expect(fmtF(1e-9)).toBe('1 nF');
  });
});

// ===========================================================================
// Gate-level models (videos 5, 7, 8, 24-27)

describe('clock logic (video 5)', () => {
  it('gate circuit matches CLK = ((A·SEL) + (M·SEL̅))·HLT̅ for all inputs', () => {
    const c = new Circuit();
    const n = buildClockLogic(c);
    for (let i = 0; i < 16; i++) {
      const a = (i & 1) as 0 | 1, m = ((i >> 1) & 1) as 0 | 1, sel = ((i >> 2) & 1) as 0 | 1, hlt = ((i >> 3) & 1) as 0 | 1;
      c.set(n.AST, a); c.set(n.MONO, m); c.set(n.SEL, sel); c.set(n.HLT, hlt);
      expect(c.settle().stable).toBe(true);
      expect(n.CLK.value).toBe(clockEquation(a, m, sel, hlt));
      expect(n.CLKn.value).toBe(clockEquation(a, m, sel, hlt) ? 0 : 1);
    }
  });
  it('HLT forces CLK low in both modes', () => {
    for (const sel of [0, 1] as const) for (const a of [0, 1] as const) expect(clockEquation(a, 1, sel, 1)).toBe(0);
  });
});

describe('D latch (video 7)', () => {
  const setup = () => {
    const c = new Circuit();
    const D = c.input('D', 0), E = c.input('E', 0);
    const dl = dLatch(c, D, E);
    c.settle();
    return { c, D, E, dl, Q: dl.latch.Q, Qn: dl.latch.Qn };
  };
  it('is transparent while E = 1 and holds while E = 0', () => {
    const { c, D, E, Q, Qn } = setup();
    c.set(E, 1);
    for (const v of [1, 0, 1, 1, 0, 1] as const) {
      c.set(D, v); c.settle();
      expect(Q.value).toBe(v);
      expect(Qn.value).toBe(v ? 0 : 1);
    }
    c.set(E, 0); c.settle();
    for (const v of [0, 1, 0, 0] as const) {
      c.set(D, v); c.settle();
      expect(Q.value).toBe(1);
    }
  });
  it('S and R overlap for at most one gate delay (the inverter prevents the invalid state)', () => {
    const { c, D, E, dl } = setup();
    c.set(E, 1);
    let run = 0, maxRun = 0;
    for (let i = 0; i < 40; i++) {
      if (i % 5 === 0) c.toggle(D);
      c.step();
      run = dl.S.value === 1 && dl.R.value === 1 ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThanOrEqual(1);
    expect(dLatchRow(0, 0)).toBe(0);
    expect(dLatchRow(1, 0)).toBe(0);
    expect(dLatchRow(0, 1)).toBe(1);
    expect(dLatchRow(1, 1)).toBe(2);
  });
});

describe('D flip-flop (video 8)', () => {
  const build = (width: number) => {
    const c = new Circuit();
    const D = c.input('D', 0), CLK = c.input('CLK', 0);
    const P = c.net('P', 0);
    edgePulse(c, CLK, P, () => width);
    const ff = dLatch(c, D, P, 'ff');
    const lat = dLatch(c, D, CLK, 'lat');
    c.settle();
    const guard = new MetastabilityGuard(c, ff.latch, ff.S, ff.R, () => 0.3);
    const run = (n: number) => { for (let i = 0; i < n; i++) { c.step(); guard.check(); } };
    return { c, D, CLK, ffQ: ff.latch.Q, latQ: lat.latch.Q, run, guard };
  };
  it('captures D only on the rising clock edge (short pulse)', () => {
    const { c, D, CLK, ffQ, latQ, run } = build(3);
    c.set(D, 1); run(10);
    expect(ffQ.value).toBe(0); // no edge yet
    c.set(CLK, 1); run(15);
    expect(ffQ.value).toBe(1);
    c.set(D, 0); run(15); // CLK still high: the latch follows, the flip-flop does not
    expect(latQ.value).toBe(0);
    expect(ffQ.value).toBe(1);
    c.set(CLK, 0); run(10);
    c.set(D, 1); run(10); c.set(D, 0); run(10);
    expect(ffQ.value).toBe(1); // falling edge and later wiggles ignored
    c.set(CLK, 1); run(15);
    expect(ffQ.value).toBe(0);
  });
  it('with a too-long pulse it behaves like a latch again', () => {
    const { c, D, CLK, ffQ, run } = build(40);
    c.set(CLK, 1); run(5);
    c.set(D, 1); run(10);
    expect(ffQ.value).toBe(1); // D changed during the long pulse and Q followed
  });
  it('a 1-gate-delay pulse is too short for the latch: it goes metastable', () => {
    const { c, D, CLK, run, guard } = build(1);
    c.set(D, 1); run(5);
    c.set(CLK, 1); run(40);
    expect(guard.resolved).toBeGreaterThan(0);
  });
  it('RC differentiator: above 2 V for `width` steps after a rising edge, negative after a falling edge', () => {
    for (const w of [2, 5, 20]) {
      let v = rcEdgeVoltage(0, 1, w);
      let above = 0;
      while (v > V_IH) { above++; v = rcEdgeVoltage(v, 0, w); }
      expect(above).toBe(w);
    }
    expect(rcEdgeVoltage(0, -1, 5)).toBeCloseTo(-5, 6);
  });
});

describe('JK flip-flop (videos 24-26)', () => {
  it('characteristic equation: 00 hold, 01 reset, 10 set, 11 toggle', () => {
    for (const q of [0, 1] as const) {
      expect(jkNext(q, 0, 0)).toBe(q);
      expect(jkNext(q, 0, 1)).toBe(0);
      expect(jkNext(q, 1, 0)).toBe(1);
      expect(jkNext(q, 1, 1)).toBe(q ? 0 : 1);
    }
    expect([jkRow(0, 0), jkRow(0, 1), jkRow(1, 0), jkRow(1, 1)]).toEqual([0, 1, 2, 3]);
  });

  it('edge-triggered JK with a 2-delay pulse toggles once per edge (divide by two)', () => {
    const c = new Circuit();
    const J = c.input('J', 1), K = c.input('K', 1), CLK = c.input('CLK', 0);
    const P = c.net('P', 0);
    edgePulse(c, CLK, P, () => 2);
    const jk = edgeJK(c, J, K, P);
    c.settle();
    const qs: Level[] = [];
    for (let cyc = 0; cyc < 8; cyc++) {
      c.set(CLK, 1); c.run(20); qs.push(jk.latch.Q.value);
      c.set(CLK, 0); c.run(20);
    }
    expect(qs).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('J sets, K resets, both low hold', () => {
    const c = new Circuit();
    const J = c.input('J', 0), K = c.input('K', 0), CLK = c.input('CLK', 0);
    const P = c.net('P', 0);
    edgePulse(c, CLK, P, () => 2);
    const jk = edgeJK(c, J, K, P);
    c.settle();
    const pulse = () => { c.set(CLK, 1); c.run(10); c.set(CLK, 0); c.run(10); };
    c.set(J, 1); pulse(); expect(jk.latch.Q.value).toBe(1);
    pulse(); expect(jk.latch.Q.value).toBe(1);
    c.set(J, 0); pulse(); expect(jk.latch.Q.value).toBe(1);
    c.set(K, 1); pulse(); expect(jk.latch.Q.value).toBe(0);
  });

  it('without the feedback wires J = K = 1 is the invalid S = R = 1 state', () => {
    const c = new Circuit();
    const J = c.input('J', 1), K = c.input('K', 1), CLK = c.input('CLK', 0), FB = c.input('FB', 0);
    const P = c.net('P', 0);
    edgePulse(c, CLK, P, () => 2);
    const jk = edgeJK(c, J, K, P, FB);
    c.settle();
    c.set(CLK, 1);
    let both = false;
    for (let i = 0; i < 6; i++) { c.step(); if (jk.S.value === 1 && jk.R.value === 1) both = true; }
    expect(both).toBe(true);
  });

  it('racing: one toggle with a short pulse, many with a long one (video 25)', () => {
    expect(raceTrial(2).toggles).toBe(1);
    expect(raceTrial(3).toggles).toBe(1);
    const ten = raceTrial(10, { rng: () => 0.2 });
    expect(ten.toggles).toBeGreaterThanOrEqual(3);
    const ben = raceTrial(100, { rng: () => 0.7 });
    expect(ben.toggles).toBeGreaterThan(25); // Ben's 1 µs pulse ≈ 100 gate delays
    // the number of toggles decides the final state
    for (const w of [5, 8, 12, 20, 30, 50]) {
      const r = raceTrial(w);
      expect(r.metastable).toBe(false);
      expect(r.final).toBe(r.toggles % 2);
    }
  });

  it('master-slave JK toggles exactly once per clock, on the falling edge, however long CLK is high', () => {
    const c = new Circuit();
    const J = c.input('J', 1), K = c.input('K', 1), CLK = c.input('CLK', 0);
    const ms = masterSlaveJK(c, J, K, CLK);
    expect(c.settle().stable).toBe(true);
    const Q = ms.slave.Q, Qm = ms.master.Q;
    let q = Q.value;
    for (let cyc = 0; cyc < 6; cyc++) {
      c.set(CLK, 1);
      let changes = 0, prev = Q.value;
      for (let i = 0; i < 300; i++) { c.step(); if (Q.value !== prev) changes++; prev = Q.value; }
      expect(changes).toBe(0); // output frozen while CLK is high
      expect(Qm.value).toBe(q ? 0 : 1); // the master flipped once
      expect(c.idle).toBe(true); // nothing racing
      c.set(CLK, 0);
      c.run(20);
      expect(Q.value).toBe(q ? 0 : 1);
      q = Q.value;
    }
  });
});

describe('74LS76 ripple counter (video 27)', () => {
  const build = (delay: number, sel: 0 | 1 = 0) => {
    const c = new Circuit();
    const HI = c.input('1', 1), CLK = c.input('CLK', 0), CLR = c.input('CLR', 1), SEL = c.input('SEL', sel);
    const Q = [0, 1, 2, 3].map((i) => c.net(`Q${i}`, 0));
    const Qn = [0, 1, 2, 3].map((i) => c.net(`Qn${i}`, 1));
    const N = [0, 1, 2, 3].map((i) => c.net(`N${i}`, sel ? 1 : 0));
    for (let i = 0; i < 4; i++) ls76(c, { J: HI, K: HI, CLK: i ? N[i - 1] : CLK, PRE: HI, CLR, Q: Q[i], Qn: Qn[i], next: N[i], sel: SEL }, () => delay);
    c.settle();
    const count = () => Q.reduce((v, n, i) => v | ((n.value === 1 ? 1 : 0) << i), 0);
    return { c, CLK, CLR, count };
  };
  it('counts 0..15 and wraps, one step per falling edge', () => {
    const { c, CLK, count } = build(1);
    const seen: number[] = [];
    for (let i = 0; i < 17; i++) {
      c.set(CLK, 1); c.run(10);
      expect(count()).toBe(i % 16); // the rising edge does nothing
      c.set(CLK, 0); c.run(10);
      seen.push(count());
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1]);
  });
  it('ripples through invalid intermediate counts (7 → 6 → 4 → 0 → 8)', () => {
    const { c, CLK, count } = build(2);
    for (let i = 0; i < 7; i++) { c.set(CLK, 1); c.run(5); c.set(CLK, 0); c.run(20); }
    expect(count()).toBe(7);
    c.set(CLK, 1); c.run(5); c.set(CLK, 0);
    const states = [count()];
    for (let i = 0; i < 20; i++) { c.step(); if (count() !== states[states.length - 1]) states.push(count()); }
    expect(states).toEqual([7, ...rippleSequence(7)]);
    expect(rippleSequence(7)).toEqual([6, 4, 0, 8]);
    expect(rippleSequence(15)).toEqual([14, 12, 8, 0]);
    expect(rippleSequence(8, 4, 'qn')).toEqual([9, 11, 15, 7]);
  });
  it('Q̅ wiring counts down; CLR̅ clears asynchronously', () => {
    const { c, CLK, CLR, count } = build(1, 1);
    c.set(CLK, 1); c.run(5); c.set(CLK, 0); c.run(20);
    expect(count()).toBe(15);
    c.set(CLK, 1); c.run(5); c.set(CLK, 0); c.run(20);
    expect(count()).toBe(14);
    c.set(CLR, 0); c.run(3);
    expect(count()).toBe(0);
  });
  it('countToggles ignores one-delay metastable glitches', () => {
    expect(countToggles([0, 0, 1, 1, 0, 0, 1, 1])).toBe(3);
    expect(countToggles([0, 0, 1, 0, 1, 0, 1, 1, 1])).toBe(1);
  });
});

describe('review additions', () => {
  it('gate-delay edge detector: pulse width = number of inverters, rising edges only (video 8)', () => {
    const c = new Circuit();
    const CLK = c.input('CLK', 0);
    const gd = gateDelayEdgeDetectors(c, CLK, [1, 3, 5]);
    c.settle();
    expect(gd.pulses.map((p) => p.value)).toEqual([0, 0, 0]);
    const run = () => {
      const highs = gd.pulses.map(() => 0);
      for (let i = 0; i < 20; i++) {
        c.step();
        gd.pulses.forEach((p, k) => (highs[k] += p.value === 1 ? 1 : 0));
      }
      return highs;
    };
    c.set(CLK, 1);
    expect(run()).toEqual([1, 3, 5]);
    c.set(CLK, 0);
    expect(run()).toEqual([0, 0, 0]);
  });

  it('74LS76 pinout and function table (video 26)', () => {
    expect([1, 2, 3, 4, 5, 13, 14, 15, 16].map((p) => LS76_PINS[p])).toEqual(['1CLK', '1PRE̅', '1CLR̅', '1J', 'VCC', 'GND', '1Q̅', '1Q', '1K']);
    expect(Object.keys(LS76_PINS)).toHaveLength(16);
    expect(ls76Row(0, 1, 0, 0)).toBe(0);
    expect(ls76Row(1, 0, 1, 1)).toBe(1);
    expect(ls76Row(0, 0, 1, 1)).toBe(2);
    expect(LS76_ROWS[ls76Row(1, 1, 0, 0)][6]).toBe('hold');
    expect(LS76_ROWS[ls76Row(1, 1, 0, 1)][6]).toBe('reset');
    expect(LS76_ROWS[ls76Row(1, 1, 1, 0)][6]).toBe('set');
    expect(LS76_ROWS[ls76Row(1, 1, 1, 1)][6]).toBe('toggle');
    // the behavioural 74LS76 agrees with its table
    const c = new Circuit();
    const J = c.input('J', 1), K = c.input('K', 0), CLK = c.input('CLK', 0), PRE = c.input('PRE', 1), CLR = c.input('CLR', 1);
    const Q = c.net('Q', 0), Qn = c.net('Qn', 1);
    ls76(c, { J, K, CLK, PRE, CLR, Q, Qn }, () => 1);
    c.settle();
    c.set(CLK, 1);
    c.settle();
    expect(Q.value).toBe(0); // nothing on the rising edge
    c.set(CLK, 0);
    c.settle();
    expect(Q.value).toBe(1); // set on the falling edge
    c.set(CLR, 0);
    c.settle();
    expect(Q.value).toBe(0); // asynchronous clear
    c.set(PRE, 0);
    c.settle();
    expect([Q.value, Qn.value]).toEqual([1, 1]); // both low: both outputs high
  });
});

// ===========================================================================
// Smoke test: mount every lab of this group in a minimal fake DOM, drive
// frames, press every control and check that cleanup stops all loops.

type Listener = (e: any) => void;

class FakeNode {
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  listeners = new Map<string, Set<Listener>>();
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  appendChild<T extends FakeNode>(n: T): T {
    n.remove();
    n.parentNode = this as unknown as FakeElement;
    this.childNodes.push(n);
    return n;
  }
  insertBefore<T extends FakeNode>(n: T, ref: FakeNode | null): T {
    if (!ref) return this.appendChild(n);
    n.remove();
    const i = this.childNodes.indexOf(ref);
    n.parentNode = this as unknown as FakeElement;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
    return n;
  }
  removeChild<T extends FakeNode>(n: T): T {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  remove() { this.parentNode?.removeChild(this); }
  append(...ns: (FakeNode | string)[]) { for (const n of ns) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  replaceChildren(...ns: (FakeNode | string)[]) { for (const c of [...this.childNodes]) this.removeChild(c); this.append(...ns); }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { for (const c of [...this.childNodes]) this.removeChild(c); if (v !== '') this.appendChild(new FakeText(String(v))); }
  addEventListener(type: string, fn: Listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(ev: any) {
    ev.target ??= this;
    for (const fn of [...(this.listeners.get(ev.type) ?? [])]) fn(ev);
    if (ev.bubbles && this.parentNode) this.parentNode.dispatchEvent(ev);
    return true;
  }
  listenerCount() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n; }
}
class FakeText extends FakeNode {
  constructor(public data: string) { super(); }
  override get textContent() { return this.data; }
  override set textContent(v: string) { this.data = v; }
}
class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  style: Record<string, any> = {};
  dataset: Record<string, string> = {};
  value = '';
  checked = false;
  disabled = false;
  classList = {
    el: this as FakeElement,
    get list() { return (this.el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean); },
    add(...c: string[]) { const l = this.list; for (const x of c) if (!l.includes(x)) l.push(x); this.el.setAttribute('class', l.join(' ')); },
    remove(...c: string[]) { this.el.setAttribute('class', this.list.filter((x) => !c.includes(x)).join(' ')); },
    contains(c: string) { return this.list.includes(c); },
    toggle(c: string, force?: boolean) { const on = force ?? !this.contains(c); if (on) this.add(c); else this.remove(c); return on; },
  };
  constructor(public tagName: string) { super(); }
  setAttribute(k: string, v: unknown) { this.attributes.set(k, String(v)); }
  getAttribute(k: string) { return this.attributes.get(k) ?? null; }
  removeAttribute(k: string) { this.attributes.delete(k); }
  get children() { return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement); }
  get firstElementChild() { return this.children[0] ?? null; }
  all(pred: (e: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (n: FakeElement) => { for (const c of n.children) { if (pred(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel: string) { const cls = sel.replace(/^\./, ''); return this.all((e) => (sel.startsWith('.') ? e.classList.contains(cls) : e.tagName.toLowerCase() === sel)); }
  closest() { return null; }
  getContext() { return null; }
  focus() {}
}
class FakeSVGElement extends FakeElement {}

let now = 0;
const rafs = new Map<number, (t: number) => void>();
const win = new FakeNode();
const tick = (frames: number, ms = 16) => {
  for (let f = 0; f < frames; f++) {
    now += ms;
    const cbs = [...rafs.values()];
    rafs.clear();
    for (const cb of cbs) cb(now);
  }
};
const fire = (el: FakeElement, type: string, extra: Record<string, unknown> = {}) => el.dispatchEvent({ type, bubbles: true, preventDefault() {}, stopPropagation() {}, ...extra });

beforeAll(() => {
  const g = globalThis as any;
  let id = 1;
  g.Node = FakeNode;
  g.HTMLElement = FakeElement;
  g.SVGElement = FakeSVGElement;
  g.document = {
    createElement: (t: string) => new FakeElement(t.toUpperCase()),
    createElementNS: (_ns: string, t: string) => new FakeSVGElement(t),
    createTextNode: (t: string) => new FakeText(t),
  };
  g.addEventListener = (t: string, f: Listener) => win.addEventListener(t, f);
  g.removeEventListener = (t: string, f: Listener) => win.removeEventListener(t, f);
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  g.requestAnimationFrame = (cb: (t: number) => void) => { const i = id++; rafs.set(i, cb); return i; };
  g.cancelAnimationFrame = (i: number) => rafs.delete(i);
  Object.defineProperty(g, 'performance', { value: { now: () => now }, configurable: true, writable: true });
});

const labModules = import.meta.glob<{ default: Lab }>(['../src/labs/clock/*.lab.ts', '../src/labs/latches/*.lab.ts', '../src/labs/counter/*.lab.ts'], { eager: true });
const LAB_IDS = ['555-astable', '555-monostable', '555-bistable', 'clock-logic', 'sr-latch', 'd-latch', 'd-flip-flop', 'jk-flip-flop', 'jk-racing', 'master-slave-jk', 'binary-counter'];

describe('labs mount, run and clean up', () => {
  const labs = Object.values(labModules).map((m) => m.default);

  it('every lab id of this group exists', () => {
    const ids = labs.map((l) => l.id).sort();
    expect(ids).toEqual([...LAB_IDS].sort());
    for (const id of LAB_IDS) expect(CHAPTER_LAB_IDS, `${id} is in chapters.ts`).toContain(id);
  });

  for (const id of LAB_IDS) {
    it(`${id}: interactive smoke test`, () => {
      const lab = labs.find((l) => l.id === id);
      expect(lab, id).toBeTruthy();
      const root = new FakeElement('DIV');
      const dispose = lab!.mount(root as unknown as HTMLElement);
      tick(20);
      const buttons = root.all((e) => e.tagName === 'BUTTON');
      for (const b of buttons) {
        fire(b, 'pointerdown');
        tick(3);
        fire(b, 'pointerup');
        fire(b, 'click');
        tick(5);
      }
      for (const inp of root.all((e) => e.tagName === 'INPUT')) {
        if (inp.getAttribute('type') === 'checkbox') {
          inp.checked = !inp.checked;
          fire(inp, 'change');
        } else {
          inp.value = '900';
          fire(inp, 'input');
        }
        tick(4);
      }
      for (const sel of root.all((e) => e.tagName === 'SELECT')) {
        const opts = sel.all((e) => e.tagName === 'OPTION');
        for (const o of opts) {
          sel.value = o.value || (o.getAttribute('value') ?? '');
          fire(sel, 'change');
          tick(4);
        }
      }
      // clickable SVG parts (schematic switches, push buttons)
      for (const g of root.all((e) => e.getAttribute('role') === 'button' && e instanceof FakeSVGElement)) {
        fire(g, 'pointerdown');
        fire(g, 'click');
        tick(3);
        fire(g, 'pointerup');
      }
      tick(200);
      const text = root.all((e) => e.classList.contains('callout')).map((e) => e.textContent).join(' ');
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/undefined|NaN/);
      expect(typeof dispose).toBe('function');
      (dispose as () => void)();
      tick(2); // flush one-shot frames (Schematic.autoUpdate) queued before cleanup
      expect(rafs.size).toBe(0);
      expect(win.listenerCount()).toBe(0);
    });
  }
});
