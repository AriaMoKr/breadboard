/**
 * Analog models for the digital clock labs (breadboard clock parts 1, 2 and 5), with Ben's
 * values: a 12 V AC adapter (about 17 V peak), a bridge rectifier, 10,000 µF and a 7805 for the
 * supply; LM339 comparators with 47 kΩ dividers, 4.7 kΩ pull-ups on their open-collector outputs
 * and 100 kΩ hysteresis resistors; 0.1 µF filters; the edge detector (0.01 µF, 4.7 kΩ, a diode)
 * and the 100 kΩ × 0.1 µF ramp of part 2; and switch bounce with the 47 kΩ × 0.1 µF debounce of
 * part 5. Time is in seconds, voltages in volts. Everything is plain arithmetic stepped with a
 * fixed dt, so the labs and the tests share it.
 */

export const VCC = 5;
/** A silicon diode's forward drop. */
export const DIODE = 0.7;
const TAU = 2 * Math.PI;

/** Parallel resistance. */
export const par = (a: number, b: number) => (a * b) / (a + b);

// ---------------------------------------------------------------------------
// Random noise (seeded, so tests repeat)

/** A small seeded PRNG (mulberry32), uniform in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Band-limited noise: a new random value in [-amp, amp] every `every` seconds, joined by
 * straight lines (like the noise source of Ben's circuit simulator, which the RC filters then
 * smooth out only partly).
 */
export class Noise {
  amp = 0;
  private from = 0;
  private to = 0;
  private t = 0;
  private readonly random: () => number;
  constructor(
    amp: number,
    readonly every = 100e-6,
    seed = 1,
  ) {
    this.amp = amp;
    this.random = rng(seed);
    this.to = this.pick();
  }
  private pick() {
    return (this.random() * 2 - 1) * this.amp;
  }
  next(dt: number): number {
    this.t += dt;
    while (this.t >= this.every) {
      this.t -= this.every;
      this.from = this.to;
      this.to = this.pick();
    }
    return this.from + (this.to - this.from) * (this.t / this.every);
  }
}

// ---------------------------------------------------------------------------
// The mains, the supply

/** One side of the adapter's AC output measured from the bridge's ground: the positive half, and a diode drop below ground the rest of the time. */
export const acSide = (ac: number) => Math.max(ac - DIODE, -DIODE);

export interface SupplyOptions {
  /** Peak of the adapter's AC output (a "12 V AC" adapter: about 17 V). */
  peak: number;
  hz: number;
  bridge: boolean;
  /** Filter capacitor in farads, or null for none. */
  cap: number | null;
  /** Load on the rectified side in ohms, or null for none. */
  load: number | null;
}

export interface SupplySample {
  ac: number;
  /** The rectifier's output before the capacitor. */
  rect: number;
  /** The 7805's input (the capacitor, if fitted). */
  vin: number;
  /** The 7805's output. */
  vout: number;
}

/** A 7805: 5 V out while the input is 7 V or more, otherwise it drops out (about 2 V below the input). */
export const regulator = (vin: number) => (vin >= 7 ? VCC : Math.max(0, vin - 2));

/** Half-wave or bridge rectifier, an optional filter capacitor and load, and a 7805. Ideal diodes with a 0.7 V drop each. */
export class Supply {
  t = 0;
  vc = 0;
  constructor(public o: SupplyOptions) {}
  step(dt: number): SupplySample {
    this.t += dt;
    const ac = this.o.peak * Math.sin(TAU * this.o.hz * this.t);
    const rect = this.o.bridge ? Math.max(Math.abs(ac) - 2 * DIODE, 0) : Math.max(ac - DIODE, 0);
    let vin: number;
    if (this.o.cap) {
      if (rect > this.vc) this.vc = rect; // the diodes charge it at once
      else if (this.o.load) this.vc *= Math.exp(-dt / (this.o.load * this.o.cap));
      vin = this.vc;
    } else {
      this.vc = rect;
      vin = rect;
    }
    return { ac, rect, vin, vout: regulator(vin) };
  }
}

// ---------------------------------------------------------------------------
// LM339 comparator stages

export interface Thresholds {
  /** The reference while the output is low (pulled down to 0 V). */
  whenLow: number;
  /** The reference while the output is released (pulled up to 5 V). */
  whenHigh: number;
}

/**
 * The reference of a comparator from a divider (rTop to 5 V, rBottom to ground) with a
 * hysteresis resistor from its open-collector output, which has a pull-up `rPull`. Without the
 * feedback resistor (null) both are the divider's voltage. Ben's 47k / 47k / 100k / 4.7k gives
 * about 2.02 V and 2.96 V around the 2.5 V midpoint.
 */
export function thresholds(rTop = 47e3, rBottom = 47e3, rFeedback: number | null = 100e3, rPull = 4.7e3): Thresholds {
  if (rFeedback === null) {
    const v = (VCC * rBottom) / (rTop + rBottom);
    return { whenLow: v, whenHigh: v };
  }
  const low = (VCC * par(rBottom, rFeedback)) / (rTop + par(rBottom, rFeedback));
  const high = (VCC * rBottom) / (rBottom + par(rTop, rFeedback + rPull));
  return { whenLow: low, whenHigh: high };
}

/**
 * An LM339 comparator with its reference (the divider and any hysteresis resistor) on the +
 * input and the signal on the − input, as Ben wires all of his: the open-collector output is
 * released (high, through its pull-up) while the signal is below the reference, and pulled low
 * while it is above.
 */
export class Comparator {
  out: 0 | 1 = 1;
  constructor(public th: Thresholds) {}
  /** The + input now (it moves with the output when there is hysteresis). */
  get ref(): number {
    return this.out ? this.th.whenHigh : this.th.whenLow;
  }
  step(signal: number): 0 | 1 {
    this.out = signal < this.ref ? 1 : 0;
    return this.out;
  }
}

/**
 * Part 1's input stage: one side of the AC through a 47k / 47k divider with 0.1 µF across the
 * bottom resistor (a 2.35 ms time constant), into comparator 1's − input.
 */
export class InputStage {
  v = 0;
  readonly comp: Comparator;
  constructor(
    th: Thresholds = thresholds(),
    readonly r = 47e3,
    readonly c = 0.1e-6,
  ) {
    this.comp = new Comparator(th);
  }
  /** `noise`: what reaches the comparator's input on top of the filtered signal (Ben saw tens of millivolts on his scope). */
  step(side: number, dt: number, noise = 0): 0 | 1 {
    // node: (side - v) / r = v / r + C dv/dt  ->  tends to side / 2 with tau = r C / 2
    const target = side / 2;
    this.v = target + (this.v - target) * Math.exp(-dt / ((this.r * this.c) / 2));
    return this.comp.step(this.v + noise);
  }
}

/**
 * Part 2's squaring chain after comparator 1: an edge detector (0.01 µF from comparator 1's
 * output, 4.7 kΩ pull-up, a diode to 5 V that clamps the positive spike) into comparator 2,
 * whose output charges a 0.1 µF capacitor through its 100 kΩ pull-up (the ramp) and dumps it at
 * every falling edge of comparator 1; comparator 3 turns the ramp into the final square wave.
 */
export class SquareChain {
  /** Voltage across the coupling capacitor, comparator-1 side minus edge-detector side. */
  vcap = 0;
  /** The edge detector's node (comparator 2's + input). */
  edge = VCC;
  /** Comparator 2's output, which is also the ramp capacitor. */
  ramp = 0;
  comp2: 0 | 1 = 1;
  readonly comp3 = new Comparator(thresholds());
  constructor(
    readonly cCouple = 0.01e-6,
    readonly rEdge = 4.7e3,
    readonly rRamp = 100e3,
    readonly cRamp = 0.1e-6,
  ) {}
  step(comp1: 0 | 1, dt: number): 0 | 1 {
    const a = comp1 ? VCC : 0;
    let b = a - this.vcap;
    if (b > VCC + DIODE) b = VCC + DIODE; // the diode dumps the positive spike
    b = VCC + (b - VCC) * Math.exp(-dt / (this.rEdge * this.cCouple)); // the pull-up recharges it
    this.vcap = a - b;
    this.edge = b;
    this.comp2 = b > VCC / 2 ? 1 : 0; // + input the pulse, - input the 2.5 V divider
    if (this.comp2) this.ramp = VCC + (this.ramp - VCC) * Math.exp(-dt / (this.rRamp * this.cRamp));
    else this.ramp *= Math.exp(-dt / 5e-6); // pulled hard to ground
    return this.comp3.step(this.ramp);
  }
}

/** Fraction of `samples` that are 1. */
export const duty = (samples: readonly number[]) => (samples.length ? samples.reduce((s, v) => s + v, 0) / samples.length : 0);

/** Rising edges in `samples`. */
export function risingEdges(samples: readonly number[]): number {
  let n = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i] && !samples[i - 1]) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Switch bounce and its debounce (part 5)

/**
 * A push button whose contacts bounce: after each press or release the contacts switch, then
 * break (or make) contact again for a moment a few times over the next few milliseconds, the
 * way Ben simulates it by tapping the button. `bounces` extra flips (glitches of 0.05 to 0.6 ms)
 * within `ms` milliseconds; 0 is a new button that switches cleanly.
 */
export class BouncyButton {
  /** What the finger does. */
  pressed = false;
  /** Whether the contacts touch. */
  closed = false;
  private flips: number[] = [];
  private t = 0;
  private readonly random: () => number;
  constructor(
    public bounces = 5,
    public ms = 10,
    seed = 7,
  ) {
    this.random = rng(seed);
  }
  set(pressed: boolean) {
    if (pressed === this.pressed) return;
    this.pressed = pressed;
    // the switch, then glitches back to the old state: an even number of extra flips, so it
    // settles where the finger put it
    const flips = [this.t];
    for (let k = 0; k < Math.round(this.bounces / 2); k++) {
      const at = this.t + (0.3 + this.random() * Math.max(0, this.ms - 0.9)) / 1000;
      flips.push(at, at + (0.05 + this.random() * 0.55) / 1000);
    }
    this.flips = flips.sort((x, y) => x - y);
  }
  step(dt: number): boolean {
    this.t += dt;
    while (this.flips.length && this.flips[0] <= this.t) {
      this.flips.shift();
      this.closed = !this.closed;
    }
    if (!this.flips.length) this.closed = this.pressed;
    return this.closed;
  }
}

/**
 * Ben's debounce: the button's far side pulled up to 5 V through 47 kΩ (the button connects it to
 * the 3 Hz signal), then 47 kΩ into comparator 4's − input with 0.1 µF to ground (4.7 ms), a
 * 47k / 47k reference with 100 kΩ hysteresis, and a 4.7 kΩ pull-up. Its output is the inverse
 * of the button side, a few milliseconds late, without the bounce.
 */
export class Debounce {
  /** The button's far side. */
  node = VCC;
  /** The RC node at the comparator's − input. */
  rc = VCC;
  readonly comp = new Comparator(thresholds());
  constructor(
    readonly r = 47e3,
    readonly c = 0.1e-6,
  ) {
    this.comp.out = 0;
  }
  /** `closed`: the contacts touch; `source`: the 3 Hz level the button connects. */
  step(closed: boolean, source: 0 | 1, dt: number): 0 | 1 {
    this.node = closed ? (source ? VCC : 0) : VCC;
    this.rc = this.node + (this.rc - this.node) * Math.exp(-dt / (this.r * this.c));
    return this.comp.step(this.rc);
  }
}
