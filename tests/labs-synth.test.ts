import { describe, expect, it } from 'vitest';
import { ANALOG_CHIPS, CHIPS, CHIP_IDS, chipDef } from '../src/breadboard/catalog';
import { validateLayout } from '../src/breadboard/layout';
import {
  BC548C, Coupling, FloatingInput, PHONES, R_FOLLOW, R_OUT, Relaxation, SchmittCore, SinkCore, TUNING, V12, VDIODE, VN, VP, VSAT, baseVoltage, collectorCurrent, comparator, converter,
  coreTimes, coreWave, divide, follower, ledCurrent, mixer, noteHz, noteOf, offsetFor, par, pnpSaturationCurrent, relaxationPeriod, sampleCore, saturationCurrent, sinkTimes,
  thermalVoltage, thresholds, tune, wiper,
} from '../src/labs/synth/_analog';
import { guideLayout, guideNets, type Setup } from '../src/labs/synth/_board';
import { periodicWave } from '../src/labs/synth/_sound';

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
