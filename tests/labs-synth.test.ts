import { describe, expect, it } from 'vitest';
import { ANALOG_CHIPS, CHIPS, CHIP_IDS, chipDef } from '../src/breadboard/catalog';
import { validateLayout } from '../src/breadboard/layout';
import {
  BC548C, CLAMP_IN, Coupling, D1N4148, FloatingInput, PHONES, R_FOLLOW, R_OUT, Relaxation, SAW_AMP, SCOPE_IN, SQUARE_DIV, SchmittCore, SinkCore, TRI, TRI_BASIC, TRI_BUILT, TRI_SAW, TUNING,
  V12, VDIODE, VD_PULL, VN, VP, VSAT, VSAT12, amplify, baseVoltage, collectorCurrent, comparator, converter, coreTimes, coreWave, coupled, coupledRamp, coupledSaw, diodePoint, divide,
  follower, gainOf, ledCurrent, mixer, noteHz, noteOf, offsetFor, par, pickupTau, pnpSaturationCurrent, potForPulse, pulse, pulseWidth, rampTop, relaxationPeriod, sampleCore,
  saturationCurrent, sawOut, sawToTriangle, sawTop, sawWave, schmittOut, shaperIn, sinkTimes, squareOut, thermalVoltage, thermistor, thresholds, tune, wiper,
} from '../src/labs/synth/_analog';
import { guideLayout, guideNets, type Setup } from '../src/labs/synth/_board';
import { harmonics, periodicWave } from '../src/labs/synth/_sound';

/** Rising edges of `Relaxation`'s output over `secs`, stepped `dt` at a time, after the first one. */
function periods(rf: number, c: number, dt: number, secs: number): number[] {
  const m = new Relaxation(rf, c);
  const edges: number[] = [];
  let t = 0, was = m.out;
  while (t < secs) {
    m.step(dt);
    t += dt;
    if (m.out === 1 && was === -1) edges.push(t);
    was = m.out;
  }
  return edges.slice(1).map((e, i) => e - edges[i]);
}

describe('synth: the breadboard guide’s models', () => {
  it('an LED and 1k: 7 mA from 9 V, 5.5 mA from the op amp’s +7.5 V, none the wrong way round', () => {
    expect(ledCurrent(9, 1e3)).toBeCloseTo(7e-3, 9);
    expect(ledCurrent(VSAT, 1e3)).toBeCloseTo(5.5e-3, 9);
    expect(ledCurrent(-VSAT, 1e3)).toBe(0);
    expect(ledCurrent(1.5, 1e3)).toBe(0);
  });

  it('the crude inverter: the output swings to the rail of the higher input', () => {
    expect(comparator(0, 9)).toBe(-VSAT);
    expect(comparator(0, -9)).toBe(VSAT);
  });

  it('the relaxation oscillator: 2 Rf C ln 3, about 4.6 Hz with 100k and 455 Hz with 1k, at any step', () => {
    expect(relaxationPeriod(100e3, 1e-6)).toBeCloseTo(0.2197, 4);
    expect(relaxationPeriod(1e3, 1e-6)).toBeCloseTo(2.197e-3, 6);
    expect(1 / relaxationPeriod(1e3, 1e-6)).toBeCloseTo(455.1, 1);
    // an exact model: the period comes out the same whatever the step
    for (const dt of [3e-3, 1e-4, 7.7e-3]) {
      const ps = periods(100e3, 1e-6, dt, 3);
      expect(ps.length).toBeGreaterThan(10);
      for (const p of ps) expect(p).toBeCloseTo(relaxationPeriod(100e3, 1e-6), 1);
      const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
      expect(Math.abs(mean - relaxationPeriod(100e3, 1e-6))).toBeLessThan(dt / ps.length + 1e-9);
    }
    const fast = periods(1e3, 1e-6, 1e-5, 0.05);
    for (const p of fast) expect(p).toBeCloseTo(relaxationPeriod(1e3, 1e-6), 4);
  });

  it('the + input is half the output, and the capacitor swings between ±3.75 V', () => {
    const m = new Relaxation(100e3, 1e-6);
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 2; t += 1e-3) {
      m.step(1e-3);
      expect(Math.abs(m.vplus)).toBeCloseTo(VSAT / 2, 9);
      if (t > 0.5) {
        lo = Math.min(lo, m.vc);
        hi = Math.max(hi, m.vc);
      }
    }
    expect(hi).toBeLessThanOrEqual(VSAT / 2 + 1e-9);
    expect(lo).toBeGreaterThanOrEqual(-VSAT / 2 - 1e-9);
    expect(hi).toBeGreaterThan(3.7);
    expect(lo).toBeLessThan(-3.7);
  });

  it('the 10k/1k divider brings ±7.5 V down to about ±0.68 V', () => {
    expect(divide(VSAT, 10e3, 1e3)).toBeCloseTo(0.682, 3);
  });

  it('a floating input: the same with the same seed, within its drift and hum, crossing 0 V now and then', () => {
    const run = (seed: number) => {
      const f = new FloatingInput(seed);
      return Array.from({ length: 5000 }, () => f.step(2e-3));
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    const v = run(7);
    expect(Math.max(...v.map(Math.abs))).toBeLessThanOrEqual(1.5);
    let crossings = 0;
    for (let i = 1; i < v.length; i++) if (v[i] > 0 !== v[i - 1] > 0) crossings++;
    expect(crossings).toBeGreaterThan(10);
  });
});

describe('synth: the breadboard guide’s board', () => {
  const setups: Setup[] = [
    { step: 1 }, { step: 1, reversed: true },
    { step: 2, jumper: 'plus' }, { step: 2, jumper: 'minus' }, { step: 2, jumper: 'loose' },
    { step: 3 }, { step: 4 },
  ];

  it('the TL074 is in the catalog for drawing and wiring, not in the sandbox', () => {
    const tl = chipDef('TL074')!;
    expect(tl).toBe(ANALOG_CHIPS.TL074);
    expect([tl.pins.length, tl.vcc, tl.gnd, tl.pins[0], tl.pins[3], tl.pins[10]]).toEqual([14, 4, 11, '1OUT', 'VCC+', 'VCC−']);
    expect(CHIP_IDS).not.toContain('TL074');
    expect(CHIPS.TL074).toBeUndefined();
    expect(chipDef('74LS00')).toBe(CHIPS['74LS00']);
  });

  it('every step plugs in without two legs in one hole', () => {
    for (const su of setups) expect(validateLayout(guideLayout(su)), JSON.stringify(su)).toEqual([]);
  });

  it('circuit 1: +9 V, the 1k, the LED and the jumper to ground in a loop; turned round, the LED faces the other way', () => {
    for (const reversed of [false, true]) {
      const n = guideNets({ step: 1, reversed });
      expect(n.pin('r1k', 'a')).toBe('+9V');
      const mid = n.pin('r1k', 'b');
      expect(mid).not.toMatch(/9V|GND/);
      expect(n.pin('led', reversed ? 'cathode' : 'anode')).toBe(mid);
      expect(n.pin('led', reversed ? 'anode' : 'cathode')).toBe(n.pin('gnd', 'a'));
      expect(n.pin('gnd', 'b')).toBe('GND');
      expect(n.at('tn3')).not.toBe('-9V'); // one battery only
    }
  });

  it('circuits 2-4: the TL074 on ±9 V, with the second battery’s + on ground', () => {
    for (const su of setups.filter((x) => x.step > 1)) {
      const n = guideNets(su);
      expect([n.pin('TL074', 4), n.pin('TL074', 11)]).toEqual(['+9V', '-9V']);
      expect(n.at('bn5')).toBe('GND');
      expect(n.at('tn3')).toBe('-9V');
    }
  });

  it('circuit 2: + input on ground, output through 1k to the LED, the long jumper on the − input', () => {
    const want = { plus: '+9V', minus: '-9V' } as const;
    for (const jumper of ['plus', 'minus', 'loose'] as const) {
      const n = guideNets({ step: 2, jumper });
      expect(n.pin('TL074', 3)).toBe('GND');
      expect(n.pin('r1k', 'a')).toBe(n.pin('TL074', 1));
      expect(n.pin('led', 'anode')).toBe(n.pin('r1k', 'b'));
      expect(n.pin('led', 'cathode')).toBe('GND');
      if (jumper === 'loose') expect(n.pin('TL074', 2)).not.toMatch(/9V|GND/);
      else expect(n.pin('TL074', 2)).toBe(want[jumper]);
    }
  });

  it('circuits 3 and 4: 100k and 100k on the + input, 1 µF and Rf on the − input', () => {
    for (const step of [3, 4] as const) {
      const n = guideNets({ step });
      const out = n.pin('TL074', 1), minus = n.pin('TL074', 2), plus = n.pin('TL074', 3);
      expect(new Set([out, minus, plus]).size).toBe(3);
      expect([n.pin('r-plus-gnd', 'a'), n.pin('r-plus-gnd', 'b')]).toEqual([plus, 'GND']);
      expect([n.pin('r-plus-out', 'a'), n.pin('r-plus-out', 'b')]).toEqual([plus, out]);
      expect([n.pin('rf', 'a'), n.pin('rf', 'b')]).toEqual([minus, out]);
      expect([n.pin('c1u', 'a'), n.pin('c1u', 'b')]).toEqual([minus, 'GND']);
      const rf = n.layout.parts.find((p) => p.id === 'rf');
      expect(rf?.kind === 'resistor' && rf.ohms).toBe(step === 3 ? 100e3 : 1e3);
    }
  });

  it('circuit 4: the output through 10k to the jack’s tip, 1k from there to ground, the sleeve on ground', () => {
    const n = guideNets({ step: 4 });
    expect(n.pin('r10k', 'a')).toBe(n.pin('TL074', 1));
    expect(n.pin('r10k', 'b')).toBe('TIP');
    expect([n.pin('r1k', 'a'), n.pin('r1k', 'b')]).toEqual(['TIP', 'GND']);
    expect(n.layout.parts.some((p) => p.kind === 'led')).toBe(false);
    const sleeve = n.layout.parts.filter((p) => p.kind === 'port' && p.name === 'GND').map((p) => (p.kind === 'port' ? p.hole : ''));
    expect(sleeve).toContain('bn13');
  });
});

describe('synth: DIY VCO part 1’s oscillator core', () => {
  it('jumps up through the diode in a fraction of a microsecond and falls through 100k in about 91 µs: about 10.9 kHz', () => {
    const t = coreTimes();
    expect(t.fall).toBeCloseTo(100e3 * 2.2e-9 * Math.log(VP / VN), 12);
    expect(t.fall * 1e6).toBeCloseTo(91.3, 1);
    expect(t.rise * 1e6).toBeGreaterThan(0.2);
    expect(t.rise * 1e6).toBeLessThan(0.5);
    expect(1 / t.period / 1e3).toBeCloseTo(10.9, 1);
  });

  it('is exact at any step: 50 cycles and a half come out the same in steps of 0.1 µs or in one', () => {
    const t = coreTimes();
    const total = 50 * t.period + t.rise + t.fall / 2;
    for (const dt of [1e-7, 3.3e-6, 1e-4, total]) {
      const core = new SchmittCore();
      core.vc = VN;
      let flips = 0, left = total;
      while (left > 1e-15) {
        const d = Math.min(dt, left);
        flips += core.step(d);
        left -= d;
      }
      // 51 times low at the top, 50 times high at the bottom; halfway down the 51st fall
      expect(flips, `dt ${dt}`).toBe(101);
      expect(core.high).toBe(false);
      expect(core.vc).toBeCloseTo(Math.sqrt(VP * VN), 6);
    }
  });

  it('swings between its thresholds and averages about 4.34 V', () => {
    const { mean } = coreTimes();
    const w = coreWave(20000);
    expect(w.reduce((a, b) => a + b, 0) / w.length).toBeCloseTo(mean, 2);
    expect(mean).toBeCloseTo(4.34, 2);
    expect(Math.max(...w)).toBeLessThanOrEqual(VP + 1e-9);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(VN - 1e-9);
  });

  it('its output is high only for the jumps: readings 0.8 µs apart catch each one', () => {
    const core = new SchmittCore();
    core.vc = VN;
    core.step(1e-3);
    const { vc, out } = sampleCore(core, 0.8e-6, 1000); // 0.8 ms: 8.7 cycles
    const pulses = out.filter((v, i) => v > 0 && !(out[i - 1] > 0)).length;
    expect(pulses).toBeGreaterThanOrEqual(8);
    expect(pulses).toBeLessThanOrEqual(9);
    expect(out.filter((v) => v > 0).length).toBeLessThanOrEqual(2 * pulses);
    expect(Math.min(...vc)).toBeGreaterThanOrEqual(VN - 1e-9);
    expect(Math.max(...vc)).toBeLessThanOrEqual(VP + 1e-9);
  });

  it('headphones straight on the capacitor hold it under a volt, and it stops; unplugged, it starts again', () => {
    const core = new SchmittCore();
    core.vc = VN;
    core.step(1e-3);
    core.load = PHONES;
    core.step(1e-6);
    expect(core.step(10e-3)).toBe(0);
    expect(core.high).toBe(true);
    expect(core.vc).toBeCloseTo(0.8, 1);
    core.load = Infinity;
    expect(core.step(5e-3)).toBeGreaterThan(100);
  });

  it('a line input (10k) instead wouldn’t stop it, but drain it ten times faster: above 100 kHz', () => {
    expect(1 / coreTimes(par(100e3, 10e3)).period).toBeGreaterThan(100e3);
  });

  it('AC coupling: everything passes at first, then the wave centres on 0 V within five time constants, whatever the frames', () => {
    const { mean } = coreTimes();
    const ac = new Coupling(100e3, 1e-6);
    expect(ac.tau).toBeCloseTo(0.1, 9);
    expect(ac.out(VP)).toBe(VP);
    for (let i = 0; i < 30; i++) ac.step(1 / 60, mean);
    expect(ac.vcap).toBeCloseTo(mean, 1);
    expect(ac.out(VP)).toBeCloseTo(VP - mean, 1);
    const a = new Coupling(100e3), b = new Coupling(100e3);
    a.step(0.3, mean);
    for (let i = 0; i < 300; i++) b.step(1e-3, mean);
    expect(a.vcap).toBeCloseTo(b.vcap, 9);
  });

  it('the sound’s harmonics: a square wave’s odd ones at 4/(πn), a cosine’s first alone, and no offset', () => {
    const m = 1024;
    const sq = periodicWave(Array.from({ length: m }, (_, i) => (i < m / 2 ? 1 : -1)), 8);
    for (let k = 1; k <= 8; k++) expect(sq.imag[k], `harmonic ${k}`).toBeCloseTo(k % 2 ? 4 / (Math.PI * k) : 0, 2);
    const cw = periodicWave(Array.from({ length: m }, (_, i) => 3 + Math.cos((2 * Math.PI * i) / m)), 4);
    expect(cw.real[1]).toBeCloseTo(1, 6);
    expect([cw.real[0], cw.imag[0]]).toEqual([0, 0]);
    for (const x of [cw.real[2], cw.real[3], cw.imag[1], cw.imag[2]]) expect(Math.abs(x)).toBeLessThan(1e-6);
  });
});

describe('synth: DIY VCO part 2’s exponential converter', () => {
  const { vp: VP12, vn: VN12 } = thresholds(V12);
  /** The pitch with `v` on the pot's wiper, through 100k into the base, as in the second step. */
  const fromPot = (v: number) => {
    const w = wiper(v / V12);
    return sinkTimes(collectorCurrent(baseVoltage([{ v: w.v, r: 100e3 + w.r }])));
  };

  it('the 40106 on 12 V switches at about 7.06 and 4.66 V: nearly the same ratio as on 9 V, so part 1’s core plays the same', () => {
    expect(thresholds(9).vp).toBeCloseTo(VP, 9);
    expect(thresholds(9).vn).toBeCloseTo(VN, 9);
    expect(VP12).toBeCloseTo(7.06, 9);
    expect(VN12).toBeCloseTo(4.66, 9);
    expect(thresholds(5)).toEqual({ vp: 2.9, vn: 1.9 });
    expect(thresholds(15).vp).toBeCloseTo(8.8, 9);
    const on12 = 1 / coreTimes(100e3, 2.2e-9, V12, VP12, VN12).period;
    expect(Math.abs(on12 / (1 / coreTimes().period) - 1)).toBeLessThan(0.01);
  });

  it('a bigger part lowers the core: ten times the resistance ten times, a capacitor 450 times as big about 450 times', () => {
    const hz = (r: number, c: number) => 1 / coreTimes(r, c, V12, VP12, VN12).period;
    expect(hz(100e3, 2.2e-9) / hz(1e6, 2.2e-9)).toBeCloseTo(10, 1);
    expect(hz(100e3, 2.2e-9) / hz(100e3, 1e-6)).toBeGreaterThan(440);
    expect(hz(100e3, 2.2e-9) / hz(100e3, 1e-6)).toBeLessThan(460);
    expect(hz(100e3, 1e-6)).toBeCloseTo(24, 0);
  });

  it('the BC548C: 660 mV for 2 mA, ten times the current for every 59 mV, exponential all the way down', () => {
    expect(thermalVoltage(25)).toBeCloseTo(0.02569, 5);
    expect(collectorCurrent(0.66)).toBeCloseTo(2e-3, 6);
    const decade = thermalVoltage(25) * Math.LN10;
    expect(decade * 1e3).toBeCloseTo(59.2, 1);
    for (const v of [0.3, 0.45, 0.6]) expect(collectorCurrent(v + decade) / collectorCurrent(v)).toBeCloseTo(10, 3);
    expect(collectorCurrent(0)).toBe(0);
    expect(collectorCurrent(0.35) * 1e9).toBeCloseTo(11.5, 0);
    expect(collectorCurrent(0.55) * 1e6).toBeCloseTo(27.7, 0);
  });

  it('warmer, more current for the same base: the base falls about 2.4 mV a degree for the same current, and the pitch climbs over 1.5 semitones', () => {
    expect(saturationCurrent(25)).toBeCloseTo(BC548C.at / Math.exp(BC548C.vbe / thermalVoltage(25)), 25);
    expect(saturationCurrent(32) / saturationCurrent(25)).toBeGreaterThan(2.5);
    const vbe = (i: number, celsius: number) => thermalVoltage(celsius) * Math.log(i / saturationCurrent(celsius) + 1);
    const perK = (vbe(1e-6, 26) - vbe(1e-6, 25)) * 1e3;
    expect(perK).toBeLessThan(-2.2);
    expect(perK).toBeGreaterThan(-2.6);
    const semitones = 12 * Math.log2(sinkTimes(collectorCurrent(0.45, 32)).hz / sinkTimes(collectorCurrent(0.45, 25)).hz);
    expect(semitones / 7).toBeGreaterThan(1.5);
    expect(semitones / 7).toBeLessThan(1.8);
  });

  it('the pot: its wiper behind its two halves in parallel', () => {
    expect(wiper(0)).toEqual({ v: 0, r: 0 });
    expect(wiper(0.5)).toEqual({ v: 6, r: 25e3 });
    expect(wiper(1).r).toBe(0);
  });

  it('the base: a little under the wiper, by the base current through the 100k; the mixer gives each input about 1/27', () => {
    expect(baseVoltage([])).toBe(0);
    const vb = baseVoltage([{ v: 0.5, r: 100e3 }]);
    expect(vb).toBeLessThan(0.5);
    expect(vb).toBeGreaterThan(0.498);
    expect((0.5 - vb) / 100e3).toBeCloseTo(collectorCurrent(vb) / BC548C.beta, 15);
    // at a few hundred millivolts and less the base takes next to nothing: plain dividers
    expect(baseVoltage([{ v: 1, r: 100e3 }, { v: 2, r: 100e3 }], 4e3)).toBeCloseTo(3 / 27, 4);
    expect(baseVoltage([{ v: 4, r: 100e3 }], 4e3)).toBeCloseTo(4 / 26, 4);
  });

  it('a transistor for the 100k: from a couple of clicks a second at 350 mV to 5 kHz at 550 mV, as Moritz finds', () => {
    for (const [v, lo, hi] of [[0.35, 1, 5], [0.45, 50, 200], [0.55, 4e3, 7e3]]) {
      const { hz } = sinkTimes(collectorCurrent(v));
      expect(hz, `${v} V`).toBeGreaterThan(lo);
      expect(hz, `${v} V`).toBeLessThan(hi);
    }
    // through 100k from the pot: the base a little under the wiper; dead past about 4 V
    expect(fromPot(0.5).hz).toBeGreaterThan(600);
    expect(fromPot(0.5).hz).toBeLessThan(900);
    expect(fromPot(3.5).stalled).toBe(false);
    expect(fromPot(4.5).stalled).toBe(true);
    expect(fromPot(12).stalled).toBe(true);
    expect(fromPot(0)).toMatchObject({ hz: 0, stalled: false });
  });

  it('its fall is a straight line, C (VP − VN) / i, exact at any step', () => {
    const i = 5e-6, t = sinkTimes(i);
    expect(t.fall).toBeCloseTo((2.2e-9 * (VP12 - VN12)) / i, 15);
    expect(t.rise * 1e6).toBeGreaterThan(0.2);
    expect(t.rise * 1e6).toBeLessThan(0.4);
    expect(t.hz).toBeCloseTo(946.7, 0);
    const total = 20 * t.period + t.rise + t.fall / 2;
    for (const dt of [1e-7, 3.3e-6, 1e-4, total]) {
      const core = new SinkCore();
      core.i = i;
      core.vc = VN12;
      core.high = true;
      let flips = 0, left = total;
      while (left > 1e-15) {
        const d = Math.min(dt, left);
        flips += core.step(d);
        left -= d;
      }
      // 21 times low at the top, 20 times high at the bottom; halfway down the 21st fall
      expect(flips, `dt ${dt}`).toBe(41);
      expect(core.high).toBe(false);
      expect(core.vc).toBeCloseTo((VP12 + VN12) / 2, 6);
    }
    // readings: never outside the thresholds, a jump each period
    const core = new SinkCore();
    core.i = i;
    const { vc, out } = sampleCore(core, t.period / 50, 500);
    expect(Math.min(...vc)).toBeGreaterThanOrEqual(VN12 - 1e-9);
    expect(Math.max(...vc)).toBeLessThanOrEqual(VP12 + 1e-9);
    expect(out.filter((v, k) => v > 0 && !(out[k - 1] > 0)).length).toBe(10);
  });

  it('drains more than the 40106 can put back, and the core stops, its output high', () => {
    const stop = (V12 - VDIODE - VP12) / R_OUT;
    expect(stop * 1e3).toBeCloseTo(14.13, 2);
    expect(sinkTimes(stop * 0.99).stalled).toBe(false);
    expect(sinkTimes(stop * 1.01)).toEqual({ rise: Infinity, fall: 0, period: Infinity, hz: 0, stalled: true });
    expect(sinkTimes(0)).toMatchObject({ fall: Infinity, period: Infinity, hz: 0, stalled: false });
    const core = new SinkCore();
    core.i = stop * 1.5;
    core.step(1e-3);
    expect(core.stalled).toBe(true);
    expect(core.step(1e-3)).toBe(0);
    expect(core.high).toBe(true);
    expect(core.vc).toBeCloseTo(core.held, 6);
    expect(core.held).toBeLessThan(VP12);
  });

  it('the mixer: about 37 mV at the base for each volt of CV, two octaves a volt where 1 V per octave wants one', () => {
    const w = wiper(11.6 / V12);
    const base = (cv: number) => baseVoltage([{ v: w.v, r: 100e3 + w.r }, { v: cv, r: 100e3 }], 4e3);
    expect((base(2) - base(1)) * 1e3).toBeCloseTo(37, 0);
    const octaves = Math.log2(sinkTimes(collectorCurrent(base(2))).hz / sinkTimes(collectorCurrent(base(1))).hz);
    expect(octaves).toBeGreaterThan(1.9);
    expect(octaves).toBeLessThan(2.2);
    expect(thermalVoltage(25) * Math.LN2 * 1e3).toBeCloseTo(17.8, 1);
    // scaled down alone, the sequence's 0 to 4 V never gets the core going
    expect(sinkTimes(collectorCurrent(baseVoltage([{ v: 4, r: 100e3 }], 4e3))).hz).toBeLessThan(0.01);
  });

  it('notes: C0 is 16.35 Hz and A4 440 Hz, an octave doubles, and cents count from the nearest note', () => {
    expect(noteHz('C0')).toBeCloseTo(16.35, 2);
    expect(noteHz('A4')).toBeCloseTo(440, 1);
    expect(noteHz('C3') / noteHz('C2')).toBeCloseTo(2, 12);
    expect(noteOf(440)).toEqual({ name: 'A4', cents: 0 });
    expect(noteOf(noteHz('G♯3'))).toEqual({ name: 'G♯3', cents: 0 });
    expect(noteOf(440 * 2 ** (30 / 1200))).toEqual({ name: 'A4', cents: 30 });
    expect(noteOf(440 * 2 ** (-60 / 1200))).toEqual({ name: 'G♯4', cents: 40 });
    expect(noteOf(noteHz('C2') * 0.999).name).toBe('C2');
    expect(noteOf(noteHz('B1') * 1.001).name).toBe('B1');
    expect(noteHz('H2')).toBeNaN();
  });
});

describe('synth: DIY VCO part 3’s follower and tuning', () => {
  const C2 = noteHz('C2');
  const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);
  /** The second step: the follower on the BC548C's base, its own base on ground, the two at these temperatures. */
  const onBase = (pnp = 25, npn = 25) => sinkTimes(collectorCurrent(follower(0, pnp, npn).ve, npn)).hz;
  const semitones = (pnp: number, npn: number) => 12 * Math.log2(onBase(pnp, npn) / onBase());
  const tuned = tune();
  const shunt = TUNING.fixed + tuned.trim;

  it('the follower: its emitter 480 mV above its base, wherever the base is, and the BC548C on it hardly changes that', () => {
    const alone = follower(0, 25, null);
    expect(alone.ve).toBeCloseTo(0.48, 6);
    expect(alone.ic * 1e6).toBeCloseTo(11.5, 1);
    expect((V12 - alone.ve) / R_FOLLOW).toBeCloseTo(alone.ic + alone.ib, 12);
    for (const v of [-1, -0.5, 0.5, 1]) {
      expect(follower(v, 25, null).ve - v, `${v} V`).toBeGreaterThan(0.475);
      expect(follower(v, 25, null).ve - v, `${v} V`).toBeLessThan(0.485);
    }
    expect(Math.abs(follower(0).ve - alone.ve) * 1e3).toBeLessThan(0.1);
  });

  it('warmer, the BC558C lets its emitter down about 2.4 mV a degree, by the BC548C’s law', () => {
    const perK = (follower(0, 26, null).ve - follower(0, 25, null).ve) * 1e3;
    expect(perK).toBeLessThan(-2.25);
    expect(perK).toBeGreaterThan(-2.5);
    expect(pnpSaturationCurrent(32) / pnpSaturationCurrent(25)).toBeCloseTo(saturationCurrent(32) / saturationCurrent(25), 9);
  });

  it('on the BC548C’s base, its own base on ground: about 343 Hz, an F4, too high a baseline', () => {
    expect(onBase()).toBeGreaterThan(340);
    expect(onBase()).toBeLessThan(347);
    expect(noteOf(onBase()).name).toBe('F4');
  });

  it('a finger on either sends the pitch the other way, by over ten semitones; on both, they cancel', () => {
    expect(semitones(32, 25)).toBeLessThan(-10);
    expect(semitones(25, 32)).toBeGreaterThan(10);
    expect(Math.abs(semitones(32, 32))).toBeLessThan(0.1);
    // the warmer one wins
    expect(semitones(28, 30)).toBeGreaterThan(0);
    expect(semitones(30, 28)).toBeLessThan(0);
  });

  it('the 1M holds the BC548C under 6.5 mA, so the core can no longer stop', () => {
    const top = follower(V12);
    expect(top.ve).toBeLessThan(0.7);
    const most = collectorCurrent(top.ve);
    expect(most * 1e3).toBeGreaterThan(5);
    expect(most * 1e3).toBeLessThan(6.5);
    expect(sinkTimes(most).stalled).toBe(false);
    expect(converter(5, 0, 1e6).t.stalled).toBe(false);
  });

  it('the mixer: the follower’s base current, out of its base, lifts it a little', () => {
    const g = 2 / 100e3 + 1 / 4e3, plain = (-1.26 + 2) / 100e3 / g;
    const m = mixer([{ v: -1.26, r: 100e3 }, { v: 2, r: 100e3 }], 4e3);
    expect(m.vm).toBeGreaterThan(plain);
    expect((m.vm - plain) * 1e3).toBeLessThan(0.2);
    expect(m.vm - plain).toBeCloseTo(m.ib / g, 12);
  });

  it('subtracting: the pot towards −12 V puts 0 V on C2, but with the 4k at about two octaves a volt', () => {
    const turn = offsetFor(4e3);
    const at = (cv: number) => converter(cv, turn, 4e3);
    expect(Math.abs(cents(at(0).t.hz, C2))).toBeLessThan(1);
    expect(at(0).vm).toBeLessThan(0);
    expect(at(0).w.v).toBeCloseTo(-12 * turn, 9);
    const perVolt = Math.log2(at(1).t.hz / at(0).t.hz);
    expect(perVolt).toBeGreaterThan(2);
    expect(perVolt).toBeLessThan(2.15);
  });

  it('tuned: 1.5k and about 346 Ω of the trimmer, for 17.8 mV a volt at the BC548C; 0 to 5 V then within 4 cents', () => {
    expect(tuned.trim).toBeGreaterThan(300);
    expect(tuned.trim).toBeLessThan(400);
    const at = (cv: number) => converter(cv, tuned.turn, shunt);
    expect((at(1).ve - at(0).ve) * 1e3).toBeCloseTo(thermalVoltage(25) * Math.LN2 * 1e3, 1);
    for (const cv of [0, 1, 2, 3, 4, 5]) expect(Math.abs(cents(at(cv).t.hz, C2 * 2 ** cv)), `${cv} V`).toBeLessThan(4);
    expect(Math.abs(cents(at(1).t.hz, 2 * C2))).toBeLessThan(0.01);
  });

  it('a warmer room: cents off, sharp below the note of the first steps and flat above, where part 2’s would be semitones off; retuning puts it right', () => {
    const warm = { pnp: 30, npn: 30 };
    const off = (cv: number) => cents(converter(cv, tuned.turn, shunt, warm).t.hz, converter(cv, tuned.turn, shunt).t.hz);
    expect(off(0)).toBeGreaterThan(30);
    expect(off(0)).toBeLessThan(60);
    expect(off(5)).toBeLessThan(-30);
    expect(off(5)).toBeGreaterThan(-60);
    expect(Math.abs(off(Math.log2(onBase() / C2)))).toBeLessThan(3);
    // part 2's converter, its base held where it was at 25 °C
    const part2 = cents(sinkTimes(collectorCurrent(converter(0, tuned.turn, shunt).ve, 30)).hz, C2);
    expect(part2 / 100).toBeGreaterThan(7);
    const re = tune(C2, 30);
    for (const cv of [0, 1, 2, 3, 4, 5]) expect(Math.abs(cents(converter(cv, re.turn, TUNING.fixed + re.trim, warm).t.hz, C2 * 2 ** cv)), `${cv} V`).toBeLessThan(4);
    // warmer, the octaves narrow, and a bigger shunt widens them again
    expect(re.trim).toBeGreaterThan(tuned.trim);
  });

  it('a sagging supply moves every note alike: about 23 cents for both rails 0.1 V low, an offset rather than the scale', () => {
    const sag = (cv: number) => cents(converter(cv, tuned.turn, shunt, { pnp: 25, npn: 25 }, 11.9).t.hz, converter(cv, tuned.turn, shunt).t.hz);
    expect(sag(0)).toBeGreaterThan(20);
    expect(sag(0)).toBeLessThan(27);
    for (const cv of [1, 2, 5]) expect(Math.abs(sag(cv) - sag(0)), `${cv} V`).toBeLessThan(1);
  });
});

describe('synth: DIY VCO part 4’s thermistors, fine tuning and pulse', () => {
  const C2 = noteHz('C2'), C3 = noteHz('C3');
  const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);
  const room = { pnp: 25, npn: 25 };
  /** The thermistors at `celsius`, and the fine knob's turn (null without one). */
  const ntc = (celsius: number, fine: number | null = null) => ({ ntc: celsius, fine });
  const part3 = tune();
  const retuned = tune(C2, 25, ntc(25));
  const SEQ = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'G4'];
  const cvOf = (name: string) => Math.log2(noteHz(name) / C2);
  /** The sawtooth after the 1 µF at `hz`, with part 2's two 10k still on it or not. */
  const sawAt = (hz: number, divider = true) => coupledSaw(512, 1 / hz, pickupTau(divider));

  it('the thermistors: 10k at 25 °C, about 4.3% less for each degree warmer', () => {
    expect(thermistor(25)).toBeCloseTo(10e3, 6);
    const perK = thermistor(26) / thermistor(25) - 1;
    expect(perK).toBeLessThan(-0.041);
    expect(perK).toBeGreaterThan(-0.045);
    expect(thermistor(30)).toBeLessThan(thermistor(25));
    expect(thermistor(20)).toBeGreaterThan(thermistor(25));
  });

  it('added to part 3’s tuning, they put it out: 0 V about two semitones sharp, and the octaves about 9% narrow', () => {
    const at = (cv: number) => converter(cv, part3.turn, TUNING.fixed + part3.trim, room, V12, ntc(25));
    expect(cents(at(0).t.hz, C2)).toBeGreaterThan(190);
    expect(cents(at(0).t.hz, C2)).toBeLessThan(240);
    const perVolt = Math.log2(at(1).t.hz / at(0).t.hz);
    expect(perVolt).toBeGreaterThan(0.89);
    expect(perVolt).toBeLessThan(0.93);
    // without them, part 3's circuit as it was
    expect(Math.abs(cents(converter(0, part3.turn, TUNING.fixed + part3.trim).t.hz, C2))).toBeLessThan(1);
  });

  it('retuned with them: about 531 Ω of the trimmer, and 0 to 5 V within 4 cents', () => {
    expect(retuned.trim).toBeGreaterThan(510);
    expect(retuned.trim).toBeLessThan(550);
    const at = (cv: number) => converter(cv, retuned.turn, TUNING.fixed + retuned.trim, room, V12, ntc(25));
    for (const cv of [0, 1, 2, 3, 4, 5]) expect(Math.abs(cents(at(cv).t.hz, C2 * 2 ** cv)), `${cv} V`).toBeLessThan(4);
  });

  it('a room 5 °C warmer: with them, the sequence goes about 8 cents sharp throughout, nearly an offset; part 3’s spreads over 40 cents', () => {
    const warm = { pnp: 30, npn: 30 };
    const offs = SEQ.map((n) => cents(converter(cvOf(n), retuned.turn, TUNING.fixed + retuned.trim, warm, V12, ntc(30)).t.hz, noteHz(n)));
    const was = SEQ.map((n) => cents(converter(cvOf(n), part3.turn, TUNING.fixed + part3.trim, warm).t.hz, noteHz(n)));
    for (const c of offs) {
      expect(c).toBeGreaterThan(5);
      expect(c).toBeLessThan(10);
    }
    expect(Math.max(...offs) - Math.min(...offs)).toBeLessThan(2);
    expect(Math.max(...was) - Math.min(...was)).toBeGreaterThan(35);
  });

  it('a room 5 °C cooler: with them, about 2 to 15 cents flat, not quite an offset (an NTC goes with 1/T, V_T with T)', () => {
    const cool = { pnp: 20, npn: 20 };
    const offs = SEQ.map((n) => cents(converter(cvOf(n), retuned.turn, TUNING.fixed + retuned.trim, cool, V12, ntc(20)).t.hz, noteHz(n)));
    expect(Math.max(...offs)).toBeLessThan(-1.5);
    expect(Math.max(...offs)).toBeGreaterThan(-3);
    expect(Math.min(...offs)).toBeLessThan(-14);
    expect(Math.min(...offs)).toBeGreaterThan(-16);
  });

  it('warmer thermistors take the BC558C’s base down for the notes below about C♯4, and lift it a little from there to F4', () => {
    const base = (n: string, celsius: number) => converter(cvOf(n), retuned.turn, TUNING.fixed + retuned.trim, room, V12, ntc(celsius)).vm;
    for (const n of ['C3', 'G3', 'C4']) expect(base(n, 26), n).toBeLessThan(base(n, 25));
    for (const n of ['D4', 'E4']) expect(base(n, 26), n).toBeGreaterThan(base(n, 25));
  });

  it('fingers on both transistors, the thermistors at the room: just as part 3’s circuit, since they don’t feel it', () => {
    const warm = { pnp: 32, npn: 32 };
    for (const n of SEQ) {
      const withNtc = converter(cvOf(n), retuned.turn, TUNING.fixed + retuned.trim, warm, V12, ntc(25)).t.hz;
      const without = converter(cvOf(n), part3.turn, TUNING.fixed + part3.trim, warm).t.hz;
      expect(Math.abs(cents(withNtc, without)), n).toBeLessThan(0.5);
    }
    // the low notes go sharp and the high ones flat, about the note with the base at 0 V
    expect(cents(converter(cvOf('C3'), retuned.turn, TUNING.fixed + retuned.trim, warm, V12, ntc(25)).t.hz, noteHz('C3'))).toBeGreaterThan(30);
    expect(cents(converter(cvOf('C5'), retuned.turn, TUNING.fixed + retuned.trim, warm, V12, ntc(25)).t.hz, noteHz('C5'))).toBeLessThan(-10);
  });

  it('the fine knob through 1M: a whole turn about 1.3 octaves, a tenth of the coarse knob’s, and halfway is in tune', () => {
    const t = tune(C2, 25, ntc(25, 0.5));
    const hz = (turn: number, fine: number) => converter(0, turn, TUNING.fixed + t.trim, room, V12, ntc(25, fine)).t.hz;
    expect(Math.abs(cents(hz(t.turn, 0.5), C2))).toBeLessThan(1);
    const fineOct = Math.log2(hz(t.turn, 0) / hz(t.turn, 1));
    const coarseOct = Math.log2(hz(0, 0.5) / hz(1, 0.5));
    expect(fineOct).toBeGreaterThan(1.2);
    expect(fineOct).toBeLessThan(1.4);
    expect(coarseOct).toBeGreaterThan(11);
    expect(coarseOct).toBeLessThan(13);
    // towards −12 V, lower
    expect(hz(t.turn, 0.6)).toBeLessThan(hz(t.turn, 0.5));
  });

  it('the non-inverting amplifier: 1 + Rf ÷ the pot, clipped 1.5 V short of the rails', () => {
    expect(gainOf(100e3, 100e3)).toBe(2);
    expect(gainOf(200e3, 50e3)).toBe(5);
    expect(gainOf(100e3, 0)).toBe(Infinity);
    expect(amplify(1, 2)).toBe(2);
    expect(amplify(2, 10)).toBe(VSAT12);
    expect(amplify(-2, 10)).toBe(-VSAT12);
    expect(VSAT12).toBe(V12 - 1.5);
    // at 0 Ω, a comparator: anything but 0 V ends at a rail
    expect(amplify(1e-3, Infinity)).toBe(VSAT12);
    expect(amplify(0, Infinity)).toBe(0);
  });

  it('after the 1 µF: the sawtooth about ±1.2 V around 0 V, its top higher at low notes while part 2’s two 10k are on it', () => {
    const c3 = sawAt(C3), tau = pickupTau(true), { vp, vn } = thresholds(V12);
    // its average is 0 V; its readings', each just after the last's fall, half a reading's fall above that
    expect(Math.abs(c3.reduce((a, b) => a + b) / c3.length - (vp - vn) / (2 * 512))).toBeLessThan(1e-5);
    expect(c3[0]).toBe(Math.max(...c3));
    expect(c3[0]).toBeCloseTo(1.2914, 4);
    expect(sawTop(1 / C3, tau)).toBe(c3[0]);
    // settled: a reading's fall after the last, and the jump, come back round to the top
    const dt = 1 / C3 / 512, s = (vp - vn) * C3;
    expect(-s * tau + (c3[511] + s * tau) * Math.exp(-dt / tau) + (vp - vn)).toBeCloseTo(c3[0], 12);
    // the same as the wave through the filter a step at a time, finely enough that the jump is nearly instant
    expect(c3[0]).toBeCloseTo(Math.max(...coupled(sawWave(65536), 1 / C3, tau)), 4);
    expect(Math.max(...sawAt(noteHz('C1')))).toBeGreaterThan(1.5);
    const plain = sawAt(C3, false);
    expect(Math.max(...plain)).toBeGreaterThan(1.19);
    expect(Math.max(...plain)).toBeLessThan(1.23);
    expect(Math.min(...plain)).toBeLessThan(-1.16);
  });

  it('the 40106’s output: low once its input reaches the upper threshold, high again at the lower one', () => {
    const { vp, vn } = thresholds(V12);
    const out = schmittOut([0, vp - 0.1, vp, vp - 0.1, vn + 0.1, vn, 0], vp, vn);
    expect(out).toEqual([true, true, false, false, false, true, true]);
    expect(pulseWidth(out)).toBeCloseTo(4 / 7, 12);
  });

  it('into it: a wire takes its input below 0 V, as far as its protection diode; the 1N4148 with the pull-down keeps it at 0 V and above', () => {
    const op = sawAt(C3).map((v) => amplify(v, gainOf(100e3, 10e3)));
    expect(Math.min(...op)).toBe(-VSAT12);
    expect(Math.min(...op.map((v) => shaperIn(v, 'wire')))).toBe(-CLAMP_IN);
    expect(-CLAMP_IN).toBeLessThan(-0.5);
    expect(Math.min(...op.map((v) => shaperIn(v, 'pulldown')))).toBe(0);
    expect(Math.max(...op.map((v) => shaperIn(v, 'pulldown')))).toBeCloseTo(VSAT12 - VD_PULL, 9);
    // the diode alone: while it blocks, wherever the input floats
    expect(shaperIn(-5, 'diode', 6.2)).toBe(6.2);
    expect(shaperIn(VSAT12, 'diode', 6.2)).toBeCloseTo(VSAT12 - VD_PULL, 9);
  });

  it('a pulse: about 52% at the most gain, wider as the pot turns up, gone past about 20.6k (with the 200k, about 41k)', () => {
    const width = (rf: number, r: number, divider = true) => pulse(C3, rf, r, pickupTau(divider)).width;
    expect(width(100e3, 0)).toBeGreaterThan(0.5);
    expect(width(100e3, 0)).toBeLessThan(0.54);
    expect(width(100e3, 0, false)).toBeCloseTo(0.5, 1);
    expect(width(100e3, 10e3)).toBeGreaterThan(width(100e3, 5e3));
    const peak = Math.max(...sawAt(C3));
    const r100 = potForPulse(100e3, peak), r200 = potForPulse(200e3, peak);
    expect(r100 / 1e3).toBeGreaterThan(19.5);
    expect(r100 / 1e3).toBeLessThan(21.5);
    expect(r200 / r100).toBeCloseTo(2, 9);
    expect(width(100e3, 0.98 * r100)).toBeLessThan(1);
    expect(width(100e3, 1.02 * r100)).toBe(1);
    expect(width(200e3, 0.98 * r200)).toBeLessThan(1);
    expect(width(200e3, 1.02 * r200)).toBe(1);
    // the sawtooth's top is exact, so where the pulse ends doesn't depend on the readings
    for (const n of [256, 512, 2048]) {
      expect(pulse(C3, 100e3, 0.999 * r100, pickupTau(true), n).width, `${n}`).toBeLessThan(1);
      expect(pulse(C3, 100e3, 1.001 * r100, pickupTau(true), n).width, `${n}`).toBe(1);
    }
    // not the whole turn
    expect(width(200e3, 100e3)).toBe(1);
    // TI's lowest upper threshold on 12 V (4.6 V at 10 V, 6.8 V at 15 V): about 27.5k; at C1, its top
    // higher, his third, then two thirds; the whole turn would need a threshold lower still
    const lowest = 4.6 + (2 / 5) * (6.8 - 4.6), c1 = Math.max(...sawAt(noteHz('C1')));
    expect(potForPulse(100e3, peak, lowest) / 1e3).toBeCloseTo(27.5, 0);
    expect(potForPulse(100e3, c1, lowest) / 100e3).toBeGreaterThan(1 / 3);
    expect(potForPulse(200e3, c1, lowest) / 100e3).toBeGreaterThan(2 / 3);
    expect(3 * peak - VD_PULL).toBeLessThan(lowest);
    // a sawtooth so big that no gain is too little
    expect(potForPulse(100e3, 10)).toBe(Infinity);
  });

  it('10 V peak to peak: the square through 1 µF, 20k and 100k about ±5 V at 50%; the saw times 4.03 about ±4.8 V', () => {
    expect(SQUARE_DIV.bottom / (SQUARE_DIV.top + SQUARE_DIV.bottom)).toBeCloseTo(5 / 6, 12);
    const p = pulse(C3, 200e3, 0, pickupTau(false));
    expect(p.width).toBeCloseTo(0.5, 1);
    const sq = squareOut(p.out, C3);
    expect(Math.max(...sq)).toBeGreaterThan(4.9);
    expect(Math.max(...sq)).toBeLessThan(5.4);
    expect(Math.min(...sq)).toBeLessThan(-4.9);
    expect(Math.min(...sq)).toBeGreaterThan(-5.4);
    expect(gainOf(SAW_AMP.rf, SAW_AMP.rg)).toBeCloseTo(4.03, 2);
    const saw = sawOut(p.saw);
    expect(Math.max(...saw)).toBeGreaterThan(4.7);
    expect(Math.max(...saw)).toBeLessThan(5);
    expect(Math.min(...saw)).toBeLessThan(-4.6);
    expect(Math.min(...saw)).toBeGreaterThan(-4.9);
  });
});

describe('synth: the sawtooth-to-triangle converter', () => {
  const nvt = D1N4148.n * thermalVoltage(25);
  /** Each harmonic in dB under the first. */
  const levels = (wave: readonly number[], n = 9) => {
    const h = harmonics(wave, n);
    return h.map((x) => 20 * Math.log10(x / h[0]));
  };
  const range = (r: ReturnType<typeof sawToTriangle>) => [Math.max(...r.out), Math.min(...r.out)];

  it('rampTop and coupledRamp are part 4’s sawtooth with any jump', () => {
    const { vp, vn } = thresholds(V12);
    expect(rampTop(1 / 130, 0.1, vp - vn)).toBe(sawTop(1 / 130, 0.1));
    expect(coupledRamp(64, 1 / 130, 0.1, vp - vn)).toEqual(coupledSaw(64, 1 / 130, 0.1));
    // settled: the ramp after the 1 µF averages 0 V, and its bottom is the jump below its top
    const r = coupledRamp(4096, 1 / 200, 0.2, 10);
    expect(r.reduce((a, b) => a + b, 0) / r.length).toBeCloseTo(10 / 2 / 4096, 6);
    expect(rampTop(1 / 200, 0.2, 10)).toBeCloseTo(5.0208, 4);
  });

  it('a 1N4148 by the Shockley law: about 0.58 V at a milliamp, 0.48 V at a tenth of one', () => {
    expect(nvt * Math.log(1e-3 / D1N4148.is)).toBeCloseTo(0.58, 2);
    expect(nvt * Math.log(1e-4 / D1N4148.is)).toBeCloseTo(0.48, 2);
  });

  it('the diodes’ point: the higher output less a drop that grows with the current, both sharing it where they meet', () => {
    const scope = [{ g: 1 / SCOPE_IN, v: 0 }];
    // 5 V into the scope's 1M: a few microamps, a third of a volt
    const x = diodePoint(5, -5, scope);
    expect(5 - x).toBeCloseTo(0.34, 2);
    expect(D1N4148.is * Math.expm1((5 - x) / nvt) + D1N4148.is * Math.expm1((-5 - x) / nvt)).toBeCloseTo(x / SCOPE_IN, 12);
    // either way round, and with 20k to −12 V a little over half a milliamp: about 0.57 V
    expect(diodePoint(-5, 5, scope)).toBeCloseTo(x, 12);
    const pulled = diodePoint(5, -5, [{ g: 1 / TRI.pull, v: -V12 }]);
    expect(5 - pulled).toBeGreaterThan(0.56);
    expect(5 - pulled).toBeLessThan(0.6);
    // where they meet at 0 V both conduct, each about half: n V_T ln 2 higher than one alone would be
    const one = diodePoint(0, null, [{ g: 1 / TRI.pull, v: -V12 }]), both = diodePoint(0, 0, [{ g: 1 / TRI.pull, v: -V12 }]);
    expect(both - one).toBeCloseTo(nvt * Math.LN2, 3);
    // no diodes: the loads alone; a load above the diodes: the point above them, the diodes off
    expect(diodePoint(null, null, [{ g: 1e-3, v: 2 }, { g: 1e-3, v: 4 }])).toBeCloseTo(3, 12);
    expect(diodePoint(1, 0, [{ g: 1e-3, v: 6 }])).toBeGreaterThan(5.99);
  });

  it('the basic converter: a triangle from about 4.66 V to 0 V halfway, nearly odd harmonics only', () => {
    const r = sawToTriangle(TRI_BASIC);
    expect(r.ends.after).toBeCloseTo(4.661, 3);
    expect(r.ends.before).toBeCloseTo(r.ends.after, 12);
    expect(r.cross).toBe(0.5);
    // its two halves mirror each other about the valley
    for (const k of [1, 50, 128, 200, 255]) expect(r.node[256 + k]).toBeCloseTo(r.node[256 - k], 9);
    expect(Math.min(...r.node)).toBeGreaterThan(-0.01);
    expect(Math.min(...r.node)).toBeLessThan(0.01);
    const db = levels(r.out);
    expect(db[2]).toBeCloseTo(-19.5, 0);
    expect(db[4]).toBeCloseTo(-29, 0);
    // the scope's 1M lets the drop shrink near 0 V, which rounds the valleys a little: even harmonics, but low
    expect(db[1]).toBeLessThan(-35);
  });

  it('each diode alone lets its own upper half through, and the scope holds the point near 0 V the rest of the time', () => {
    const one = sawToTriangle({ ...TRI_BASIC, d2: false }), two = sawToTriangle({ ...TRI_BASIC, d1: false });
    expect(one.node[0]).toBeCloseTo(4.661, 3);
    expect(Math.max(...one.node.slice(300))).toBeLessThan(0.05);
    expect(two.node[511]).toBeCloseTo(4.661, 1);
    expect(Math.max(...two.node.slice(0, 200))).toBeLessThan(0.05);
    expect(sawToTriangle({ ...TRI_BASIC, d1: false, d2: false }).node.every((v) => v === 0)).toBe(true);
  });

  it('a mismatched pair: the inverter’s gain is their ratio, and the step at the peak about 4.7 V times the mismatch', () => {
    const big = sawToTriangle({ ...TRI_BASIC, rIn: 9.9e3, rFb: 10.1e3 }), small = sawToTriangle({ ...TRI_BASIC, rIn: 10.1e3, rFb: 9.9e3 });
    expect(big.gain).toBeCloseTo(10.1 / 9.9, 12);
    expect(big.b[100]).toBeCloseTo(-big.gain * big.a[100], 12);
    // the inverted half taller: down at the jump; shorter: up
    expect(big.ends.after - big.ends.before).toBeCloseTo(-0.1, 2);
    expect(small.ends.after - small.ends.before).toBeCloseTo(0.098, 2);
    // a matched pair, whatever their value, none
    const matched = sawToTriangle({ ...TRI_BASIC, rIn: 10.07e3, rFb: 10.07e3 });
    expect(matched.ends.after - matched.ends.before).toBeCloseTo(0, 12);
  });

  it('an offset: the crossing off the middle and a step of about twice it; the input’s 1 µF and buffer take it out', () => {
    const up = sawToTriangle({ ...TRI_BASIC, offset: 1 });
    expect(up.cross).toBeCloseTo(0.6, 12);
    expect(up.ends.after - up.ends.before).toBeCloseTo(1.98, 2);
    // a sawtooth all above 0 V: no crossing, and the inverted copy never gets through
    const above = sawToTriangle({ ...TRI_BASIC, offset: 5 });
    expect(above.cross).toBeNull();
    expect(above.ends.before).toBeCloseTo(0, 2);
    const coupledIn = sawToTriangle({ ...TRI_BASIC, offset: 1, inCap: true }), centred = sawToTriangle({ ...TRI_BASIC, inCap: true });
    expect(coupledIn.a).toEqual(centred.a);
    expect(coupledIn.cross).toBeCloseTo(0.499, 3);
  });

  it('the input’s 1 µF bends the ramp: a step at the peak of its own, more at lower notes, that a mismatch adds to or takes from', () => {
    const at = (hz: number, pair = {}) => {
      const r = sawToTriangle({ ...TRI_BUILT, ...pair }, hz);
      return r.ends.after - r.ends.before;
    };
    const bend = (hz: number) => 2 * rampTop(1 / hz, TRI.c * TRI.rc, 2 * TRI_SAW.amp) - 2 * TRI_SAW.amp;
    expect(bend(200)).toBeCloseTo(0.042, 3);
    expect(at(200)).toBeCloseTo(bend(200), 2);
    expect(at(noteHz('C3'))).toBeCloseTo(0.064, 2);
    expect(at(noteHz('C2'))).toBeCloseTo(0.127, 2);
    expect(at(noteHz('C2'))).toBeGreaterThan(at(noteHz('C3')));
    // the feedback 10k 2% smaller: the mismatch's step and the bend's together; bigger, the one less the other
    expect(at(200, { rIn: 10.1e3, rFb: 9.9e3 })).toBeCloseTo(0.14, 2);
    expect(at(200, { rIn: 9.9e3, rFb: 10.1e3 })).toBeCloseTo(-0.059, 2);
  });

  it('the output: with no 20k next to nothing, to ground flat valleys, to −12 V the whole triangle at about ±2.5 V', () => {
    const none = sawToTriangle({ ...TRI_BUILT, pull: 'none' });
    // the 1 µF charged to about the peak, less the diodes' drop: blips at the peaks only
    expect(none.vc).toBeGreaterThan(4.6);
    expect(Math.max(...none.out)).toBeLessThan(0.1);
    expect(Math.min(...none.out)).toBeGreaterThan(-0.01);
    const ground = sawToTriangle({ ...TRI_BUILT, pull: 'ground' });
    const off = ground.node.filter((v, k) => Math.max(ground.a[k], ground.b[k]) - v < 0.25).length / ground.node.length;
    expect(off).toBeGreaterThan(0.08);
    expect(off).toBeLessThan(0.13);
    expect(Math.min(...ground.node)).toBeCloseTo(0.19, 2);
    // while the diodes are off the point sits on the divider of the 20k and the 200k: a tenth of what the 1 µF holds, and a little more
    expect(Math.min(...ground.node)).toBeCloseTo((ground.vc * TRI.pull) / (TRI.pull + TRI.rc), 2);
    const [gHi, gLo] = range(ground);
    expect(gHi - gLo).toBeLessThan(4.4);
    const built = sawToTriangle(TRI_BUILT), [hi, lo] = range(built);
    expect(Math.min(...built.node)).toBeCloseTo(-0.52, 2);
    expect(hi).toBeCloseTo(2.5, 1);
    expect(lo).toBeCloseTo(-2.46, 1);
    // no current through the 1 µF on average
    expect(built.out.reduce((a, b) => a + b, 0) / built.out.length).toBeCloseTo(0, 5);
    // flat valleys bring in even harmonics; the whole triangle has next to none
    expect(levels(ground.out)[1]).toBeGreaterThan(-30);
    expect(levels(built.out)[1]).toBeLessThan(-45);
  });

  it('harmonics: the finished converter’s odd ones fall as 1/n², the sawtooth’s all as 1/n; 2% apart lifts the second', () => {
    const tri = levels(sawToTriangle(TRI_BUILT).out), saw = levels(Array.from({ length: 512 }, (_, k) => 5 - (10 * k) / 512));
    for (const n of [3, 5, 7, 9]) expect(tri[n - 1]).toBeCloseTo(-40 * Math.log10(n), 0);
    for (const n of [2, 3, 4, 5]) expect(saw[n - 1]).toBeCloseTo(-20 * Math.log10(n), 1);
    // the lab's 2% apart, the feedback 10k smaller, at 200 Hz and at each of the sequence's notes
    const apart = levels(sawToTriangle({ ...TRI_BUILT, rIn: 10.1e3, rFb: 9.9e3 }).out);
    expect(apart[1]).toBeGreaterThan(tri[1] + 6);
    expect(apart[1]).toBeGreaterThan(-40);
    for (const n of ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5']) {
      const matched = levels(sawToTriangle(TRI_BUILT, noteHz(n)).out, 2), off = levels(sawToTriangle({ ...TRI_BUILT, rIn: 10.1e3, rFb: 9.9e3 }, noteHz(n)).out, 2);
      expect(off[1], n).toBeGreaterThan(matched[1] + 5);
    }
  });

  it('the op amps clip about 1.5 V short of the rails', () => {
    // twice the gain on a sawtooth from 0 to 10 V: it would reach −20 V
    const r = sawToTriangle({ ...TRI_BASIC, offset: 5, rFb: 2 * TRI.r });
    expect(VSAT12).toBeCloseTo(10.5, 12);
    expect(Math.min(...r.b)).toBe(-VSAT12);
    expect(r.b[400]).toBeCloseTo(-2 * r.a[400], 12);
  });
});
