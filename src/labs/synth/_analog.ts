/**
 * Analog models for Moritz Klein's "For Beginners" videos (docs/research/moritz-klein.md), with his
 * parts and values: 9 V batteries, LEDs with 1k, and a TL074 on ±9 V, from the op-amp inverter to
 * the square-wave oscillator of his breadboard guide; then DIY VCO part 1's oscillator core, a
 * 40106 with a diode, 2.2 nF and 100k, and what follows it. Time is in seconds, voltages in volts.
 * Plain arithmetic, as src/labs/dclock/_analog.ts does for Ben's clock, so the labs and the tests
 * share it.
 */

import { rng } from '../dclock/_analog';

/** A 9 V battery. */
export const VBAT = 9;

/**
 * How far a TL074's output gets on ±9 V: about 1.5 V short of either rail. An estimate: its
 * datasheet gives the swing on ±15 V (about ±13.5 V into 10 kΩ), and Moritz doesn't measure his.
 */
export const VSAT = 7.5;

/** A red LED's forward voltage at a few milliamps. */
export const VLED = 2;

/** Parallel resistance. */
export const par = (a: number, b: number) => (a * b) / (a + b);

/** A divider's output: `v` through `top`, with `bottom` to ground. */
export const divide = (v: number, top: number, bottom: number) => (v * bottom) / (top + bottom);

/** Current through an LED and its series resistor from `v` volts: none the wrong way round, or below the forward voltage. */
export const ledCurrent = (v: number, r: number, vf = VLED) => (v > vf ? (v - vf) / r : 0);

/**
 * The guide's "crude" inverter: an op amp with nothing but its inputs, so its output goes as far as
 * it can towards the rail of whichever input is higher.
 */
export const comparator = (plus: number, minus: number, vsat = VSAT) => (plus > minus ? vsat : -vsat);

/**
 * An input left unplugged, as circuit 2's − input is with its jumper out: it isn't at any voltage
 * of its own (a TL074's inputs draw almost no current), so it wanders with whatever is near it.
 * Here that is a slow random drift within ±`range` and `hum` volts of 50 Hz mains: an illustration
 * of a floating input, not a measurement of Moritz's.
 */
export class FloatingInput {
  t = 0;
  drift: number;
  private readonly random: () => number;
  constructor(
    seed = 1,
    readonly range = 1,
    readonly hum = 0.5,
    readonly mains = 50,
  ) {
    this.random = rng(seed);
    this.drift = (this.random() * 2 - 1) * range;
  }
  /** The input's voltage after `dt` more seconds. */
  step(dt: number): number {
    this.t += dt;
    // a random walk (steps grow with √dt, so any dt drifts alike), kept in range by reflecting
    this.drift += (this.random() * 2 - 1) * 1.5 * this.range * Math.sqrt(dt);
    if (this.drift > this.range) this.drift = 2 * this.range - this.drift;
    if (this.drift < -this.range) this.drift = -2 * this.range - this.drift;
    return this.drift + this.hum * Math.sin(2 * Math.PI * this.mains * this.t);
  }
}

/** The period of `Relaxation`: 2 Rf C ln((1 + b) / (1 − b)), with b the + input's share of the output (2 Rf C ln 3 for two equal resistors). */
export function relaxationPeriod(rf: number, c: number, ra = 100e3, rb = 100e3): number {
  const b = ra / (ra + rb);
  return 2 * rf * c * Math.log((1 + b) / (1 - b));
}

/**
 * The guide's square-wave oscillator: an op amp with `ra` from its + input to ground and `rb` from
 * its output to the + input, so the + input sits at a share of the output (half, ±3.75 V, with his
 * two 100k); and `rf` from the output to its − input, with `c` from the − input to ground. The
 * capacitor charges towards the output until it passes the + input; the output flips, and the
 * capacitor heads the other way. With 100k and 1 µF it flashes the LED about 4.6 times a second,
 * with 1k about 455 times: a tone.
 */
export class Relaxation {
  /** The capacitor, which is the − input. */
  vc = 0;
  /** Which rail the output is at. */
  out: 1 | -1 = 1;
  constructor(
    public rf: number,
    public c: number,
    public vsat = VSAT,
    readonly ra = 100e3,
    readonly rb = 100e3,
  ) {}
  get vout(): number {
    return this.out * this.vsat;
  }
  /** The + input. */
  get vplus(): number {
    return divide(this.vout, this.rb, this.ra);
  }
  /** Move on `dt` seconds, flipping wherever the capacitor crosses the + input: exact for any `dt`. Returns the number of flips. */
  step(dt: number): number {
    const tau = this.rf * this.c;
    let left = dt, flips = 0;
    while (left > 0 && flips < 100000) {
      const target = this.vout, th = this.vplus;
      // the capacitor reaches the + input after tau ln((target - vc) / (target - th))
      const k = (target - this.vc) / (target - th);
      const cross = k > 1 ? tau * Math.log(k) : 0;
      if (cross >= left) {
        this.vc = target + (this.vc - target) * Math.exp(-left / tau);
        break;
      }
      this.vc = th;
      this.out = this.out === 1 ? -1 : 1;
      left -= cross;
      flips++;
    }
    return flips;
  }
}

// ---------------------------------------------------------------------------
// DIY VCO part 1: the oscillator core, and what follows it to the jack

/**
 * A CD40106's thresholds on 9 V: its input has to rise past `VP` for the output to go low, and fall
 * under `VN` for it to go high again. Interpolated between TI's typical values at 5 V (2.9 and
 * 1.9 V) and 10 V (5.9 and 3.9 V); a chip's own can be a volt or more either way.
 */
export const VP = 5.3;
export const VN = 3.5;

/** A 1N4148's forward drop at the few milliamps that charge the core's capacitor. */
export const VDIODE = 0.7;

/**
 * The resistance of a 40106's output on 9 V as it charges the capacitor through the diode: an
 * estimate, from the output currents its datasheet gives (a few milliamps for each volt it drops).
 */
export const R_OUT = 300;

/** Headphones, as a load on whatever they're plugged into: about 32 Ω. */
export const PHONES = 32;

/**
 * VCO part 1's oscillator core: one of a 40106's Schmitt-trigger inverters on 9 V, with `c` (2.2 nF)
 * and `r` (100k) from its input to ground and a 1N4148 from its output back to its input. While the
 * input is under the upper threshold, the output is high and charges the capacitor through the
 * diode almost at once. Past it, the output goes low, the diode blocks, and the capacitor drains
 * slowly through the 100k until it falls under the lower threshold, and the output goes high
 * again: a sawtooth that jumps up and falls slowly. `load` is anything else from the capacitor to
 * ground, in ohms, such as headphones on a jack wired straight to it.
 */
export class SchmittCore {
  /** The capacitor, which is the inverter's input. */
  vc = 0;
  /** Whether the output is high (9 V) or low (0 V). */
  high = true;
  load = Infinity;
  constructor(
    readonly r = 100e3,
    readonly c = 2.2e-9,
    readonly vdd = VBAT,
    readonly vp = VP,
    readonly vn = VN,
  ) {}
  get vout(): number {
    return this.high ? this.vdd : 0;
  }
  /** Everything from the capacitor to ground: the 100k, and the load if there is one. */
  get rdrain(): number {
    return Number.isFinite(this.load) ? par(this.r, this.load) : this.r;
  }
  /**
   * Where the capacitor is heading, and its time constant: while the output is high, charging
   * through the output and the diode against the drain; while it's low, draining, the diode
   * blocking.
   */
  heading(): { v: number; tau: number } {
    const rd = this.rdrain;
    if (this.high && this.vc < this.vdd - VDIODE) return { v: ((this.vdd - VDIODE) * rd) / (rd + R_OUT), tau: par(rd, R_OUT) * this.c };
    return { v: 0, tau: rd * this.c };
  }
  /** Move on `dt` seconds, switching wherever the capacitor crosses a threshold: exact for any `dt`. Returns how often the output switched. */
  step(dt: number): number {
    let left = dt, flips = 0;
    while (left > 0 && flips < 1e6) {
      // past a threshold already: the output switches at once
      if (this.high && this.vc >= this.vp) {
        this.high = false;
        flips++;
        continue;
      }
      if (!this.high && this.vc <= this.vn) {
        this.high = true;
        flips++;
        continue;
      }
      const { v, tau } = this.heading();
      const th = this.high ? this.vp : this.vn;
      // the capacitor reaches the threshold after tau ln((vc - v) / (th - v)), if it lies on the way
      const k = (this.vc - v) / (th - v);
      const cross = k > 1 ? tau * Math.log(k) : Infinity;
      if (cross >= left) {
        this.vc = v + (this.vc - v) * Math.exp(-left / tau);
        break;
      }
      this.vc = th;
      left -= cross;
    }
    return flips;
  }
}

/**
 * The core's jump up (through the diode, from the lower threshold to the upper), its fall (through
 * `r`, back down), their sum, the period, and the capacitor's average over it. `r` is everything
 * from the capacitor to ground: the 100k alone, or with a load beside it.
 */
export function coreTimes(r = 100e3, c = 2.2e-9, vdd = VBAT, vp = VP, vn = VN): { rise: number; fall: number; period: number; mean: number } {
  const v = ((vdd - VDIODE) * r) / (r + R_OUT), taur = par(r, R_OUT) * c;
  const rise = taur * Math.log((v - vn) / (v - vp));
  const fall = r * c * Math.log(vp / vn);
  // the area under each part: an exponential from one threshold to the other, towards v or 0
  const area = v * rise - taur * (vp - vn) + r * c * (vp - vn);
  return { rise, fall, period: rise + fall, mean: area / (rise + fall) };
}

/**
 * `n` readings of the core, `dt` apart, moving it on: the capacitor at each reading, and the output
 * as a scope's peak detect shows it, high if it was high at any moment since the last reading. (It
 * is high only for the fraction of a microsecond each jump takes.)
 */
export function sampleCore(core: SchmittCore, dt: number, n: number): { vc: number[]; out: number[] } {
  const vc: number[] = [], out: number[] = [];
  for (let i = 0; i < n; i++) {
    const was = core.high;
    const flips = core.step(dt);
    vc.push(core.vc);
    out.push(was || flips > 0 || core.high ? core.vdd : 0);
  }
  return { vc, out };
}

/** One period of the core's capacitor with nothing on it but the 100k, `n` readings from the start of a jump: the wave to play. */
export function coreWave(n: number, r = 100e3, c = 2.2e-9): number[] {
  const core = new SchmittCore(r, c);
  core.vc = core.vn;
  const dt = coreTimes(r, c).period / n;
  return Array.from({ length: n }, () => {
    core.step(dt);
    return core.vc;
  });
}

/**
 * A capacitor `c` in series, with `r` from its far side to ground: AC coupling. It passes the wave's
 * changes but not its average, so the wave ends up centred on 0 V. It starts empty and lets
 * everything through, average and all, then charges to the average with the time constant r c.
 */
export class Coupling {
  /** The voltage across the capacitor. */
  vcap = 0;
  constructor(
    public r: number,
    readonly c = 1e-6,
  ) {}
  get tau(): number {
    return this.r * this.c;
  }
  /** The far side, for `vin` on the near side. */
  out(vin: number): number {
    return vin - this.vcap;
  }
  /** Move on `dt` seconds with an input averaging `mean` (a wave much faster than r c, whose ripple on the capacitor is left out). */
  step(dt: number, mean: number) {
    this.vcap = mean + (this.vcap - mean) * Math.exp(-dt / this.tau);
  }
}
