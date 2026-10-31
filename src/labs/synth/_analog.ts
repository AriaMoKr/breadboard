/**
 * Analog models for Moritz Klein's "For Beginners" videos (docs/research/moritz-klein.md), with his
 * parts and values: 9 V batteries, LEDs with 1k, and a TL074 on ±9 V, from the op-amp inverter to
 * the square-wave oscillator of his breadboard guide. Time is in seconds, voltages in volts. Plain
 * arithmetic, as src/labs/dclock/_analog.ts does for Ben's clock, so the labs and the tests share
 * it.
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
