import { describe, expect, it } from 'vitest';
import { ANALOG_CHIPS, CHIPS, CHIP_IDS, chipDef } from '../src/breadboard/catalog';
import { validateLayout } from '../src/breadboard/layout';
import { FloatingInput, Relaxation, VSAT, comparator, divide, ledCurrent, relaxationPeriod } from '../src/labs/synth/_analog';
import { guideLayout, guideNets, type Setup } from '../src/labs/synth/_board';

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
