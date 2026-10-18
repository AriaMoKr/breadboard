import { describe, expect, it } from 'vitest';
import { BouncyButton, Debounce, InputStage, Noise, SquareChain, Supply, acSide, duty, risingEdges, thresholds } from '../src/labs/dclock/_analog';
import { SquareSource, clockCircuit, decoder, segByte, sixty, timebase, value } from '../src/labs/dclock/_circuits';
import { LS92_SEQUENCE } from '../src/labs/dclock/divide-by-60.lab';
import { CD4511_TABLE } from '../src/labs/dclock/minutes-seconds.lab';

/** Comparator 1 (and Ben's three-comparator chain) fed `secs` of 60 Hz: their outputs after the first 0.1 s. */
function run60(o: { rms?: number; rTop?: number; hyst?: boolean; noise?: number; secs?: number } = {}) {
  const stage = new InputStage(thresholds(o.rTop ?? 47e3, 47e3, o.hyst === false ? null : 100e3));
  const chain = new SquareChain();
  const noise = new Noise(o.noise ?? 0, 50e-6, 3);
  const dt = 5e-6, peak = (o.rms ?? 12) * Math.SQRT2;
  const c1: number[] = [], c3: number[] = [];
  for (let t = 0; t < (o.secs ?? 1.1); t += dt) {
    const a = stage.step(acSide(peak * Math.sin(2 * Math.PI * 60 * t)), dt, noise.next(dt));
    const b = chain.step(a, dt);
    if (t >= 0.1) {
      c1.push(a);
      c3.push(b);
    }
  }
  return { c1, c3 };
}

describe('digital clock: analog models', () => {
  it("comparator references: Ben's 47k / 47k divider is 2.5 V; the 100 kΩ hysteresis splits it", () => {
    const plain = thresholds(47e3, 47e3, null);
    expect(plain.whenLow).toBeCloseTo(2.5, 6);
    expect(plain.whenHigh).toBeCloseTo(2.5, 6);
    const h = thresholds();
    expect(h.whenLow).toBeCloseTo(2.02, 2);
    expect(h.whenHigh).toBeCloseTo(2.96, 2);
  });

  it('the supply: a bridge, 10,000 µF and a 1 kΩ load keep the 7805 at 5 V; no capacitor drops out; half-wave ripples more', () => {
    const run = (bridge: boolean, cap: number | null, load: number | null) => {
      const s = new Supply({ peak: 17, hz: 60, bridge, cap, load });
      const vin: number[] = [], vout: number[] = [];
      for (let t = 0; t < 0.3; t += 20e-6) {
        const x = s.step(20e-6);
        if (t > 0.2) {
          vin.push(x.vin);
          vout.push(x.vout);
        }
      }
      return { ripple: Math.max(...vin) - Math.min(...vin), lowOut: Math.min(...vout), peak: Math.max(...vin) };
    };
    const ben = run(true, 10000e-6, 1000);
    expect(ben.peak).toBeCloseTo(17 - 1.4, 1); // two diode drops in the bridge
    expect(ben.ripple).toBeLessThan(0.05);
    expect(ben.lowOut).toBe(5);
    expect(run(true, null, 1000).lowOut).toBe(0); // the raw humps go to 0 V
    expect(run(false, 1000e-6, 100).ripple).toBeGreaterThan(run(true, 1000e-6, 100).ripple);
    expect(run(true, 10000e-6, null).ripple).toBe(0); // no load: perfectly smooth
    expect(run(true, 100e-6, 10).lowOut).toBeLessThan(5); // a heavy load sags below the 7805's 7 V
  });

  it('noise at the comparator: extra pulses without hysteresis, none with it', () => {
    const noHyst = run60({ hyst: false, noise: 0.1, secs: 2.1 });
    const hyst = run60({ hyst: true, noise: 0.1, secs: 2.1 });
    expect(risingEdges(noHyst.c1)).toBeGreaterThan(120);
    expect(risingEdges(hyst.c1)).toBe(120);
  });

  it("comparator 1's duty cycle follows the input voltage and the divider; the final output stays put", () => {
    const at = (rms: number, rTop = 47e3) => run60({ rms, rTop });
    const d9 = at(9), d12 = at(12), d20 = at(20);
    expect(duty(d9.c1)).toBeGreaterThan(duty(d12.c1));
    expect(duty(d12.c1)).toBeGreaterThan(duty(d20.c1));
    expect(duty(at(12, 200e3).c1)).toBeLessThan(duty(d12.c1)); // a bigger top resistor lowers the reference
    expect(duty(at(12, 20e3).c1)).toBeGreaterThan(duty(d12.c1));
    for (const r of [d9, d12, d20]) {
      expect(duty(r.c3)).toBeGreaterThan(0.5);
      expect(duty(r.c3)).toBeLessThan(0.58);
      expect(risingEdges(r.c3)).toBe(60);
    }
    expect(Math.abs(duty(d9.c3) - duty(d20.c3))).toBeLessThan(0.005);
  });

  it('the ramp swallows the extra pulses that get past the hysteresis', () => {
    const r = run60({ noise: 0.8, secs: 2.1 });
    expect(risingEdges(r.c1)).toBeGreaterThan(130);
    expect(risingEdges(r.c3)).toBe(120);
  });

  it('a bouncy button flips its contacts a few times and settles; a new one switches once', () => {
    const flips = (b: BouncyButton, pressed: boolean) => {
      b.set(pressed);
      let n = 0, last = b.closed;
      for (let t = 0; t < 0.05; t += 50e-6) {
        const c = b.step(50e-6);
        if (c !== last) n++;
        last = c;
      }
      return { n, closed: b.closed };
    };
    const old = new BouncyButton(6, 10);
    expect(flips(old, true)).toEqual({ n: 7, closed: true });
    expect(flips(old, false)).toEqual({ n: 7, closed: false });
    expect(flips(new BouncyButton(0, 1), true)).toEqual({ n: 1, closed: true });
  });

  it('the debounce turns a bouncing press into one transition, a few milliseconds late, and inverts', () => {
    const b = new BouncyButton(6, 10), deb = new Debounce();
    const outs: number[] = [];
    const run = (secs: number) => {
      for (let t = 0; t < secs; t += 50e-6) outs.push(deb.step(b.step(50e-6), 0, 50e-6));
    };
    run(0.02);
    expect(outs.at(-1)).toBe(0); // button up: the far side is pulled high, the output low
    b.set(true);
    const from = outs.length;
    run(0.05);
    b.set(false);
    run(0.05);
    const after = outs.slice(from);
    expect(risingEdges(after)).toBe(1);
    expect(risingEdges(after.map((v) => 1 - v))).toBe(1); // and one fall
    const delayMs = (after.indexOf(1) * 50e-6) * 1000;
    expect(delayMs).toBeGreaterThan(2);
    expect(delayMs).toBeLessThan(15);
  });
});

describe('digital clock: counter circuits', () => {
  const edgesOf = (src: SquareSource, net: { value: unknown }, secs: number) => {
    let falls = 0, last = net.value;
    src.advance(secs, () => {
      if (last === 1 && net.value === 0) falls++;
      last = net.value;
    }, 0.0005);
    return falls;
  };
  it('the 60 Hz and 50 Hz dividers make one pulse a second', () => {
    for (const mains of [60, 50] as const) {
      const { c, gnd } = clockCircuit();
      const hz = c.input('HZ', 1);
      const tb = timebase(c, mains, hz, gnd, gnd);
      const src = new SquareSource(c, hz, mains);
      expect(edgesOf(src, tb.out, 4.01), `${mains} Hz`).toBe(4);
    }
  });
  it("the 74LS92 steps through its datasheet's sequence", () => {
    const { c, gnd } = clockCircuit();
    const clk = c.input('CLK', 1);
    const s = sixty(c, 'X', clk, gnd, gnd);
    const seen: number[] = [];
    // clock the tens directly through the units: 10 units pulses per tens step
    for (let k = 0; k < 12 * 10; k++) {
      c.set(clk, 0);
      c.settle();
      c.set(clk, 1);
      c.settle();
      if (value(s.units) === 0) seen.push(value(s.tens));
    }
    expect(seen).toEqual(LS92_SEQUENCE.slice(1).concat(0));
  });
  it('seconds count 00-59, carry into the minutes, and the CD4511 shows each digit', () => {
    const { c, gnd, vcc } = clockCircuit();
    const clk = c.input('CLK', 1);
    const sec = sixty(c, 'S', clk, gnd, gnd);
    const min = sixty(c, 'M', sec.carry, gnd, gnd);
    const units = decoder(c, 'D', sec.units, gnd, vcc);
    c.settle();
    const toByte = (a2g: string) => parseInt(a2g, 2);
    for (let k = 1; k <= 125; k++) {
      c.set(clk, 0);
      c.settle();
      c.set(clk, 1);
      c.settle();
      const ss = 10 * value(sec.tens.slice(0, 3)) + value(sec.units);
      expect(ss).toBe(k % 60);
      expect(segByte(units)).toBe(toByte(CD4511_TABLE[k % 10]));
    }
    expect(value(min.units)).toBe(2);
  });
});
