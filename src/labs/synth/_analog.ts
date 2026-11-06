/**
 * Analog models for Moritz Klein's "For Beginners" videos (docs/research/moritz-klein.md), with his
 * parts and values: 9 V batteries, LEDs with 1k, and a TL074 on ±9 V, from the op-amp inverter to
 * the square-wave oscillator of his breadboard guide; then DIY VCO part 1's oscillator core, a
 * 40106 with a diode, 2.2 nF and 100k, and what follows it; then part 2's exponential converter, a
 * BC548C in the 100k's place with a pot and a sequencer at its base; then part 3's BC558C emitter
 * follower in front of that base, and the scale tuned with a trimmer; then part 4's thermistors and
 * fine-tune knob in its mixer, and the sawtooth amplified and shaped into a pulse by another of the
 * 40106's inverters; then, from his "DIY VCO Series" after part 4, the quick tip's
 * sawtooth-to-triangle converter, an inverting buffer and two 1N4148s; and the PWM video's
 * comparator, its threshold a passive mixer of a pot and a CV, with a buffered output. Time is in
 * seconds, voltages in volts, currents in amps. Plain arithmetic, as src/labs/dclock/_analog.ts
 * does for Ben's clock, so the labs and the tests share it.
 */

import { rng } from '../dclock/_analog';
import { triangle } from './_sound';

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

/** What `sampleCore` needs of a core: part 1's, or part 2's with a transistor draining it. */
export interface Core {
  vc: number;
  high: boolean;
  readonly vdd: number;
  step(dt: number): number;
}

/**
 * `n` readings of the core, `dt` apart, moving it on: the capacitor at each reading, and the output
 * as a scope's peak detect shows it, high if it was high at any moment since the last reading. (It
 * is high only for the fraction of a microsecond each jump takes.)
 */
export function sampleCore(core: Core, dt: number, n: number): { vc: number[]; out: number[] } {
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

// ---------------------------------------------------------------------------
// DIY VCO part 2: a transistor drains the core, its base set by a pot and a sequencer

/** Part 2's supply: the 12 V rail of a bench supply (part 1 ran on 9 V batteries). */
export const V12 = 12;

/** TI's typical CD40106B thresholds at 25 °C, at 5, 10 and 15 V (its datasheet, SCHS097F). */
const TYPICAL = [
  { vdd: 5, vp: 2.9, vn: 1.9 },
  { vdd: 10, vp: 5.9, vn: 3.9 },
  { vdd: 15, vp: 8.8, vn: 5.8 },
];

/**
 * A CD40106's thresholds at `vdd`, interpolated between TI's typical values: 5.3 and 3.5 V on 9 V
 * (`VP` and `VN`), about 7.06 and 4.66 V on 12 V. Both move with the supply, nearly in proportion,
 * so the part 1 core's pitch hardly changes with it.
 */
export function thresholds(vdd: number): { vp: number; vn: number } {
  const a = TYPICAL[vdd <= 10 ? 0 : 1], b = TYPICAL[vdd <= 10 ? 1 : 2];
  const t = (vdd - a.vdd) / (b.vdd - a.vdd);
  return { vp: a.vp + t * (b.vp - a.vp), vn: a.vn + t * (b.vn - a.vn) };
}

/** Room temperature here, and the datasheets': 25 °C. */
export const ROOM = 25;

/** Boltzmann's constant over the electron's charge, in volts per kelvin. */
const K_Q = 8.617333e-5;

/** The thermal voltage kT/q at `celsius`: about 25.7 mV at 25 °C. */
export const thermalVoltage = (celsius: number) => K_Q * (celsius + 273.15);

/**
 * The BC548C of the exponential converter. Its datasheets give a typical base-emitter voltage of
 * 660 mV at 2 mA (25 °C), between 580 and 700 mV, and a current gain (β) of 420 to 800 for the C
 * grade, taken as 520.
 */
export const BC548C = { vbe: 0.66, at: 2e-3, beta: 520 };

/** How much a junction's I_S grows from 25 °C to `celsius`, as SPICE's model has it: with T³ and silicon's band gap (1.11 eV). */
function growth(celsius: number): number {
  const t = celsius + 273.15, t0 = ROOM + 273.15;
  return (t / t0) ** 3 * Math.exp((1.11 / K_Q) * (1 / t0 - 1 / t));
}

/**
 * The transistor's saturation current I_S at `celsius`, the scale of its exponential: from the
 * datasheet's typical base voltage at 25 °C, growing with temperature by `growth`.
 */
export function saturationCurrent(celsius = ROOM): number {
  return (BC548C.at / Math.exp(BC548C.vbe / thermalVoltage(ROOM))) * growth(celsius);
}

/**
 * The collector current with `vbe` on the base: I_S (e^(V_BE / V_T) − 1), ten times as much for every
 * 59 mV at 25 °C, from picoamps to milliamps. The video splits this into a "linear region" above
 * 0.7 V and a "not really on, not really off" state under it; its description's update says that's
 * wrong, and it is: the current depends exponentially on the base voltage throughout. Left out: the
 * Early effect (the collector's own small say in it), and what happens at tens of milliamps.
 */
export const collectorCurrent = (vbe: number, celsius = ROOM) => saturationCurrent(celsius) * Math.expm1(vbe / thermalVoltage(celsius));

/** A voltage `v` behind `r` ohms, feeding the base's node: the pot's wiper or the CV jack, each through its 100k. */
export interface Feed {
  v: number;
  r: number;
}

/** A pot's wiper as a source: `turn` of the way up a `pot` across `vtop`, behind its two parts in parallel. */
export const wiper = (turn: number, vtop = V12, pot = 100e3): Feed => ({ v: turn * vtop, r: turn * (1 - turn) * pot });

/**
 * The base's voltage: where what flows in from the `feeds` balances what flows out, through `shunt`
 * (the 4k) to ground and into the base itself (the collector current over β). Found by bisection,
 * since each moves one way with it.
 */
export function baseVoltage(feeds: readonly Feed[], shunt = Infinity, celsius = ROOM): number {
  if (!feeds.length) return 0;
  const net = (vb: number) => feeds.reduce((sum, f) => sum + (f.v - vb) / f.r, 0) - vb / shunt - collectorCurrent(vb, celsius) / BC548C.beta;
  let lo = Math.min(0, ...feeds.map((f) => f.v)), hi = Math.max(0, ...feeds.map((f) => f.v));
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (net(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** How far down a saturated transistor pulls its collector. */
export const VCE_SAT = 0.1;

/**
 * VCO part 2's core: the 40106 inverter, the diode and 2.2 nF as before, with a transistor in the
 * 100k's place, its collector on the capacitor and its emitter to ground. It drains a steady current
 * `i`, whatever the capacitor's voltage, so the capacitor falls in a straight line rather than the
 * 100k's curve: C (VP − VN) / i from one threshold to the other, the pitch following the current.
 * While the output is high it fills the capacitor through the diode against that current. If the
 * transistor drains more than the output can give, the capacitor never reaches the upper
 * threshold: the core stops, its output high.
 */
export class SinkCore implements Core {
  vc: number;
  high = false;
  /** The current the transistor drains. */
  i = 0;
  readonly vp: number;
  readonly vn: number;
  constructor(
    readonly c = 2.2e-9,
    readonly vdd = V12,
  ) {
    ({ vp: this.vp, vn: this.vn } = thresholds(vdd));
    this.vc = this.vp;
  }
  /** Where the output, through the diode, would hold the capacitor against the transistor. */
  get held(): number {
    return Math.max(VCE_SAT, this.vdd - VDIODE - Math.max(0, this.i) * R_OUT);
  }
  /** Whether the core has stopped: the output can't get the capacitor up to the upper threshold. */
  get stalled(): boolean {
    return this.held <= this.vp;
  }
  /** Move on `dt` seconds, switching wherever the capacitor crosses a threshold: exact for any `dt`. Returns how often the output switched. */
  step(dt: number): number {
    const i = Math.max(0, this.i);
    let left = dt, flips = 0;
    while (left > 0 && flips < 1e6) {
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
      if (this.high) {
        // towards `held`, with the time constant of the output's resistance and C
        const v = this.held, tau = R_OUT * this.c;
        const k = (v - this.vc) / (v - this.vp);
        const cross = v > this.vp && k > 1 ? tau * Math.log(k) : Infinity;
        if (cross >= left) {
          this.vc = v + (this.vc - v) * Math.exp(-left / tau);
          break;
        }
        this.vc = this.vp;
        left -= cross;
      } else {
        // down in a straight line, i / C volts a second
        const cross = i > 0 ? ((this.vc - this.vn) * this.c) / i : Infinity;
        if (cross >= left) {
          this.vc -= (i * left) / this.c;
          break;
        }
        this.vc = this.vn;
        left -= cross;
      }
    }
    return flips;
  }
}

/**
 * `SinkCore`'s jump (through the diode, against the transistor), its fall (a straight line), the
 * period and the pitch, with the transistor draining `i`; once the core has stopped, or with no
 * current at all, the period is Infinity and the pitch 0.
 */
export function sinkTimes(i: number, c = 2.2e-9, vdd = V12): { rise: number; fall: number; period: number; hz: number; stalled: boolean } {
  const { vp, vn } = thresholds(vdd);
  const held = Math.max(VCE_SAT, vdd - VDIODE - Math.max(0, i) * R_OUT);
  if (held <= vp) return { rise: Infinity, fall: 0, period: Infinity, hz: 0, stalled: true };
  const rise = R_OUT * c * Math.log((held - vn) / (held - vp));
  if (!(i > 0)) return { rise, fall: Infinity, period: Infinity, hz: 0, stalled: false };
  const fall = (c * (vp - vn)) / i;
  return { rise, fall, period: rise + fall, hz: 1 / (rise + fall), stalled: false };
}

/** C0, the lowest C, as the video gives it: 16.35 Hz. Each octave up doubles it. */
export const C0 = 16.3516;

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** The nearest note to `hz` (equal temperament, A4 at 440 Hz), and how many cents off it is. */
export function noteOf(hz: number): { name: string; cents: number } {
  const n = 12 * Math.log2(hz / C0), k = Math.round(n);
  // cents from whole numbers, so a note dead on is 0 cents, not −0
  return { name: `${NOTE_NAMES[((k % 12) + 12) % 12]}${Math.floor(k / 12)}`, cents: Math.round(100 * n) - 100 * k };
}

/** A note's frequency from its name in `noteOf`'s form: "C2", "G♯3". */
export function noteHz(name: string): number {
  const m = /^([A-G]♯?)(-?\d+)$/.exec(name);
  if (!m) return NaN;
  return C0 * 2 ** (Number(m[2]) + NOTE_NAMES.indexOf(m[1]) / 12);
}

// ---------------------------------------------------------------------------
// DIY VCO part 3: a PNP emitter follower at the base against the drift, and the scale tuned

/** The 1M from +12 V to the emitter of part 3's follower. */
export const R_FOLLOW = 1e6;

/**
 * The BC558C of part 3's emitter follower, the BC548C's PNP twin, with the same law for
 * temperature. Its emitter sits above its base by what its junction needs for the current the 1M
 * lets through, about 11.5 µA: Moritz's multimeter read 480 mV. (onsemi's typical 620 mV at 2 mA
 * would make it about 487 mV, Fairchild's 660 mV about 527 mV.) Its current gain is onsemi's
 * typical for the C grade at 10 µA, 270.
 */
export const BC558C = { veb: 0.48, beta: 270 };

/** The BC558C's I_S at `celsius`: 480 mV for the 1M's current at 25 °C, with nothing else on its emitter. */
export function pnpSaturationCurrent(celsius = ROOM): number {
  const ie = (V12 - BC558C.veb) / R_FOLLOW, ic = (ie * BC558C.beta) / (BC558C.beta + 1);
  return (ic / Math.exp(BC558C.veb / thermalVoltage(ROOM))) * growth(celsius);
}

/**
 * Part 3's emitter follower: the BC558C with `vin` on its base, its emitter up through the 1M to
 * `vpos` and its collector on −12 V, far enough down that it never saturates here. With `npn` set,
 * the BC548C's base hangs on the emitter, at that temperature. The emitter settles where the 1M's
 * current balances what the transistors take (found by bisection): about 480 mV above the base,
 * wherever the base is, and lower as the BC558C warms. Returns the emitter's voltage, the BC558C's
 * collector current, and its base current, which comes out of its base.
 */
export function follower(vin: number, pnp = ROOM, npn: number | null = ROOM, vpos = V12): { ve: number; ic: number; ib: number } {
  const is = pnpSaturationCurrent(pnp), vt = thermalVoltage(pnp), k = 1 + 1 / BC558C.beta;
  const net = (ve: number) => (vpos - ve) / R_FOLLOW - is * k * Math.expm1((ve - vin) / vt) - (npn === null ? 0 : collectorCurrent(ve, npn) / BC548C.beta);
  let lo = Math.min(vin, 0) - 1, hi = vpos;
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2;
    if (net(mid) > 0) lo = mid;
    else hi = mid;
  }
  const ve = (lo + hi) / 2, ic = is * Math.expm1((ve - vin) / vt);
  return { ve, ic, ib: ic / BC558C.beta };
}

/**
 * Part 3's passive mixer, now at the BC558C's base: the `feeds` (the offset pot's wiper and the CV,
 * each through 100k) against `shunt` to ground (the 4k, then 1.5k and the trimmer), with the
 * follower's base current coming out into it. A linear node but for that small current, so a few
 * rounds settle it. Returns the mixer's voltage, and the follower's with the BC548C on its emitter.
 */
export function mixer(feeds: readonly Feed[], shunt: number, pnp = ROOM, npn = ROOM, vpos = V12): { vm: number; ve: number; ic: number; ib: number } {
  const g = feeds.reduce((sum, f) => sum + 1 / f.r, 0) + 1 / shunt;
  const i = feeds.reduce((sum, f) => sum + f.v / f.r, 0);
  let vm = i / g, f = follower(vm, pnp, npn, vpos);
  for (let k = 0; k < 3; k++) {
    vm = (i + f.ib) / g;
    f = follower(vm, pnp, npn, vpos);
  }
  return { vm, ...f };
}

/** Part 3's values around the mixer: the offset pot from ground to −12 V, 100k from its wiper and from the CV jack, and 1.5k with a 1k ten-turn trimmer to ground. (Part 4's additions, `Extras`, follow below.) */
export const TUNING = { pot: 100e3, r: 100e3, fixed: 1.5e3, trimmer: 1e3 };

/** The two transistors' temperatures, in °C. */
export interface Temps {
  pnp: number;
  npn: number;
}

/**
 * Part 3's converter with `cv` on the jack, the offset pot `turn` of the way from ground to −12 V and
 * `shunt` from the mixer to ground, both rails at ±`supply`: the pot's wiper, the mixer, the follower's
 * emitter (the BC548C's base), the BC548C's current and the core's times. `extras` adds part 4's
 * thermistors and fine-tune knob to the mixer.
 */
export function converter(cv: number, turn: number, shunt: number, temps: Temps = { pnp: ROOM, npn: ROOM }, supply = V12, extras: Extras = PART3) {
  const rt = extras.ntc === null ? 0 : thermistor(extras.ntc);
  const w = wiper(turn, -supply, TUNING.pot);
  const feeds: Feed[] = [{ v: w.v, r: TUNING.r + rt + w.r }, { v: cv, r: TUNING.r + rt }];
  if (extras.fine !== null) {
    const f = wiper(extras.fine, -supply, FINE.pot);
    feeds.push({ v: f.v, r: FINE.r + rt + f.r });
  }
  const m = mixer(feeds, shunt, temps.pnp, temps.npn, supply);
  const i = collectorCurrent(m.ve, temps.npn);
  return { ...m, w, i, t: sinkTimes(i, 2.2e-9, supply) };
}

/** The offset pot's turn that makes 0 V on the jack play `low`, with `shunt` to ground: by bisection, since the pitch falls as the pot turns towards −12 V. */
export function offsetFor(shunt: number, low = noteHz('C2'), temps: Temps = { pnp: ROOM, npn: ROOM }, extras: Extras = PART3): number {
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (converter(0, mid, shunt, temps, V12, extras).t.hz > low) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Where the offset pot and the trimmer go for 1 V per octave, with 0 V on the jack playing `low`, both
 * transistors (and any thermistors) at `celsius`: what Moritz finds by ear, but exact. For each
 * trimmer setting, the pot that puts 0 V on the note (`offsetFor`); then the trimmer that makes 1 V
 * play the octave above, by bisection, since the octave widens as the trimmer grows.
 */
export function tune(low = noteHz('C2'), celsius = ROOM, extras: Extras = PART3): { turn: number; trim: number } {
  const temps = { pnp: celsius, npn: celsius };
  const ex = extras.ntc === null ? extras : { ...extras, ntc: celsius };
  let lo = 0, hi = TUNING.trimmer;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2, shunt = TUNING.fixed + mid;
    if (converter(1, offsetFor(shunt, low, temps, ex), shunt, temps, V12, ex).t.hz < 2 * low) lo = mid;
    else hi = mid;
  }
  const trim = (lo + hi) / 2;
  return { turn: offsetFor(TUNING.fixed + trim, low, temps, ex), trim };
}

// ---------------------------------------------------------------------------
// DIY VCO part 4: thermistors and a fine-tune knob in the mixer, then a pulse from the sawtooth

/**
 * Part 4's NTC thermistors, one in series with each of the mixer's inputs: 10k at 25 °C, as René
 * Schmitz's VCO has them with its 100k, which Moritz follows. Their B value isn't given: 3950 K, a
 * common one for 10k beads, makes them about 4.3% less for each degree warmer.
 */
export const NTC = { r25: 10e3, b: 3950 };

/** A thermistor's resistance at `celsius`: R25 e^(B (1/T − 1/T25)). */
export const thermistor = (celsius: number) => NTC.r25 * Math.exp(NTC.b * (1 / (celsius + 273.15) - 1 / (ROOM + 273.15)));

/** Part 4's fine-tune knob: a second 100k pot from ground to −12 V, its wiper through 1M (and a thermistor) into the mixer. */
export const FINE = { pot: 100e3, r: 1e6 };

/** What part 4 adds to part 3's mixer: the thermistors at a temperature, and the fine-tune pot's turn; null for none. */
export interface Extras {
  ntc: number | null;
  fine: number | null;
}

/** Part 3's mixer, with neither. */
export const PART3: Extras = { ntc: null, fine: null };

/** How far a TL074's output gets on ±12 V: about 1.5 V short of either rail, as on ±9 V (`VSAT`). */
export const VSAT12 = V12 - 1.5;

/** A non-inverting amplifier's gain, with `rf` from the output to the − input and `rg` from there to ground: Infinity with `rg` at 0. */
export const gainOf = (rf: number, rg: number) => 1 + rf / rg;

/** An op amp's output for `v` on its + input at gain `g`, clipped where it can go no further. */
export const amplify = (v: number, g: number, vsat = VSAT12) => Math.max(-vsat, Math.min(vsat, v === 0 ? 0 : g * v));

/** One period of the core's sawtooth on `vdd`, `n` readings from just after its jump: a straight fall from the upper threshold to the lower. (The jump takes about a microsecond.) */
export function sawWave(n: number, vdd = V12): number[] {
  const { vp, vn } = thresholds(vdd);
  return Array.from({ length: n }, (_, k) => vp - ((vp - vn) * k) / n);
}

/**
 * A wave through a capacitor in series, with `tau` (R C) to ground after it, once settled: part 1's
 * AC coupling as a filter rather than `Coupling`'s average. `wave` is one period, `period` seconds
 * long, evenly sampled; each reading follows from the last exactly for a wave that changes in a
 * straight line between them, and the settled wave is the one that comes back round to where it
 * started. Its average is 0 V. With `tau` not much longer than the period, its straight lines droop.
 */
export function coupled(wave: readonly number[], period: number, tau: number): number[] {
  const n = wave.length, dt = period / n, a = Math.exp(-dt / tau), g = ((1 - a) * tau) / dt;
  const step = (k: number) => (wave[k] - wave[(k + n - 1) % n]) * g;
  let sum = 0;
  for (let k = 0; k < n; k++) sum = a * sum + step(k);
  // the reading before the first, where one period brings it back to
  let y = sum / (1 - a ** n);
  return Array.from({ length: n }, (_, k) => (y = a * y + step(k)));
}

/**
 * A sawtooth that jumps up by `jump` and falls as far in a straight line over `period`, after a
 * capacitor in series with `tau` to ground after it, once settled: its top, just after each jump.
 * From there it falls at the same rate, S = `jump` ÷ `period`, heading for −S `tau`, until the jump
 * puts back what the period took off; its bottom, just before the jump, is the jump below its top.
 */
export function rampTop(period: number, tau: number, jump: number): number {
  return jump / -Math.expm1(-period / tau) - (jump / period) * tau;
}

/** The same sawtooth, one period of `n` readings from its top: exact, the jump instant, where `coupled` spreads it over a reading. */
export function coupledRamp(n: number, period: number, tau: number, jump: number): number[] {
  const s = jump / period, top = rampTop(period, tau, jump);
  // −S tau + (top + S tau) e^(−t/tau), written so that the first reading is the top itself
  return Array.from({ length: n }, (_, k) => top + (top + s * tau) * Math.expm1((-k / n) * (period / tau)));
}

/** The core's sawtooth on `vdd` after a capacitor in series, with `tau` to ground after it, once settled: its top (`rampTop`). */
export function sawTop(period: number, tau: number, vdd = V12): number {
  const { vp, vn } = thresholds(vdd);
  return rampTop(period, tau, vp - vn);
}

/** The same, one period of `n` readings from its top (`coupledRamp`): exact, where `coupled` on `sawWave` spreads the jump over a reading. */
export function coupledSaw(n: number, period: number, tau: number, vdd = V12): number[] {
  const { vp, vn } = thresholds(vdd);
  return coupledRamp(n, period, tau, vp - vn);
}

/** Where part 4 picks up the sawtooth: after part 1's 1 µF, into its 100k, with part 2's two 10k to the jack beside it until Moritz takes them out. */
export const pickupTau = (divider: boolean) => 1e-6 * (divider ? par(100e3, 20e3) : 100e3);

/** The 1N4148's drop with the 100k pull-down after it: about 0.5 V at the tenth of a milliamp it carries. */
export const VD_PULL = 0.5;

/** How far below ground the 40106's input protection diode lets its input go: about a diode's drop. TI allows −0.5 V. */
export const CLAMP_IN = 0.7;

/** How the op amp's output gets to the 40106's input: a wire, the 1N4148 alone, or the 1N4148 and a 100k pull-down. */
export type Shaper = 'wire' | 'diode' | 'pulldown';

/**
 * The 40106's input for `op` on the op amp's output, connected as `how` says. A wire passes the
 * negative half too, until the input's protection diode clamps it, about 0.7 V below ground, with
 * as much current as the op amp gives. The 1N4148 passes only what is a diode's drop above the
 * input: with the 100k it pulls the input to ground the rest of the time; alone, it leaves the
 * input to `floating`, wherever that is.
 */
export function shaperIn(op: number, how: Shaper, floating = 0): number {
  if (how === 'wire') return Math.max(-CLAMP_IN, op);
  if (how === 'diode') return Math.max(op - VD_PULL, floating);
  return Math.max(0, op - VD_PULL);
}

/**
 * A 40106 inverter's output, high or low, over `input` (one period of a wave that repeats): it
 * goes low once the input passes `vp` and high again once it falls under `vn`. Where it starts
 * depends on the period before, which a first pass finds.
 */
export function schmittOut(input: readonly number[], vp: number, vn: number): boolean[] {
  let high = true;
  const next = (v: number) => (high = high ? v < vp : v <= vn);
  input.forEach(next);
  return input.map(next);
}

/** How much of the time an output is high. */
export const pulseWidth = (out: readonly boolean[]) => out.filter(Boolean).length / out.length;

/**
 * Part 4's pulse at `hz`: the core's sawtooth after the 1 µF (`tau`), amplified by an op amp with
 * `rf` from its output to its − input and the pot at `rpot` from there to ground, then through the
 * 1N4148 with the 100k pull-down into another of the 40106's inverters. Each stage over one period
 * of `n` readings, the gain, and the pulse width: how much of the time the inverter's output is high.
 */
export function pulse(hz: number, rf: number, rpot: number, tau: number, n = 512) {
  const saw = coupledSaw(n, 1 / hz, tau), g = gainOf(rf, rpot);
  const op = saw.map((v) => amplify(v, g));
  const input = op.map((v) => shaperIn(v, 'pulldown'));
  const { vp, vn } = thresholds(V12);
  const out = schmittOut(input, vp, vn);
  return { saw, g, op, input, out, width: pulseWidth(out) };
}

/**
 * The most the pot can be for there to be a pulse at all: the amplified sawtooth's top, `peak` times
 * the gain, has to get a diode's drop past the upper threshold `vp`. Infinity if any gain will do.
 */
export function potForPulse(rf: number, peak: number, vp = thresholds(V12).vp): number {
  const g = (vp + VD_PULL) / peak;
  return g <= 1 ? Infinity : rf / (g - 1);
}

/** The square out's divider after its 1 µF and 100k: 20k down to 100k, a sixth off. */
export const SQUARE_DIV = { top: 20e3, bottom: 100e3 };

/**
 * Part 4's square out, from the inverter's output `out` (one period, high at 12 V) at `hz`: through
 * 1 µF into 100k, which centres it on 0 V (±6 V at 50%), then 20k with 100k to ground, about ±5 V.
 */
export function squareOut(out: readonly boolean[], hz: number): number[] {
  const tau = 1e-6 * par(100e3, SQUARE_DIV.top + SQUARE_DIV.bottom), k = SQUARE_DIV.bottom / (SQUARE_DIV.top + SQUARE_DIV.bottom);
  return coupled(out.map((v) => (v ? V12 : 0)), 1 / hz, tau).map((v) => v * k);
}

/** The saw out's amplifier, another of the TL074's op amps: 100k from its output to its − input and 33k from there to ground, a gain of about 4. */
export const SAW_AMP = { rf: 100e3, rg: 33e3 };

/** Part 4's saw out, from the sawtooth after the 1 µF: amplified about four times, about ±4.8 V. */
export const sawOut = (saw: readonly number[]) => saw.map((v) => amplify(v, gainOf(SAW_AMP.rf, SAW_AMP.rg)));

// ---------------------------------------------------------------------------
// His quick tip after the VCO series: a sawtooth-to-triangle converter

/**
 * A 1N4148 by the Shockley law, I = I_S (e^(V ÷ n V_T) − 1), with the common SPICE model's I_S and
 * n (its half an ohm in series left out): about 0.58 V at a milliamp, 0.48 V at a tenth of one,
 * and about a third of a volt at the few microamps a scope's input takes.
 */
export const D1N4148 = { is: 2.52e-9, n: 1.752 };
const NVT = D1N4148.n * thermalVoltage(ROOM);

/** The converter's parts, from his bill of materials: two 10k, matched; 1 µF and 200k at the input, and again at the output; and 20k from the diodes' point. */
export const TRI = { r: 10e3, c: 1e-6, rc: 200e3, pull: 20e3 };

/** The sawtooth his simulation feeds it: ±5 V at 200 Hz. Here it falls, as in his drawings and from his VCO. */
export const TRI_SAW = { amp: 5, hz: 200 };

/** A scope's input, 1M: the only load on the diodes' point until the output stage (an estimate: his probe's setting isn't shown). */
export const SCOPE_IN = 1e6;

/** Where the 20k from the diodes' point goes: nowhere (no 20k), to ground, or to −12 V. */
export type Pull = 'none' | 'ground' | 'negative';

/** A resistor's conductance `g`, to the voltage `v` at its far end. */
export interface Load {
  g: number;
  v: number;
}

/**
 * The diodes' point: the voltage at which what the two 1N4148s let through from the op amps'
 * outputs `a` and `b` (null for a diode left out) leaves through `loads`. The diodes let less
 * through as it rises and the loads take more, so there is one answer: Newton's method, kept
 * inside a bracket that narrows as it goes, from `guess` if it is given.
 */
export function diodePoint(a: number | null, b: number | null, loads: readonly Load[], guess?: number): number {
  const is = D1N4148.is;
  let g = 0, gv = 0, lo = Infinity, hi = -Infinity;
  for (const l of loads) {
    g += l.g;
    gv += l.g * l.v;
    lo = Math.min(lo, l.v);
    hi = Math.max(hi, l.v);
  }
  for (const v of [a, b]) {
    if (v === null) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  lo -= 2;
  hi += 2;
  const f = (x: number) => (a === null ? 0 : is * Math.expm1((a - x) / NVT)) + (b === null ? 0 : is * Math.expm1((b - x) / NVT)) - (g * x - gv);
  const df = (x: number) => -(a === null ? 0 : (is / NVT) * Math.exp((a - x) / NVT)) - (b === null ? 0 : (is / NVT) * Math.exp((b - x) / NVT)) - g;
  // without a guess, start where the higher diode carries what the loads would take 0.6 V under it
  const top = Math.max(a ?? -Infinity, b ?? -Infinity);
  const i0 = g * (top - 0.6) - gv;
  let x = guess !== undefined && guess > lo && guess < hi ? guess : top === -Infinity ? gv / g : i0 > 0 ? top - NVT * Math.log1p(i0 / is) : top;
  for (let k = 0; k < 200; k++) {
    const fx = f(x);
    if (fx === 0) return x;
    if (fx > 0) lo = x;
    else hi = x;
    let next = x - fx / df(x);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - x) < 1e-10) return next;
    x = next;
  }
  return x;
}

/** The converter's setup: what is in it, step by step in the video. */
export interface TriSetup {
  /** The sawtooth's offset: 0 V when it is centred. */
  offset: number;
  /** The input's 1 µF and 200k, and the buffer after them. */
  inCap: boolean;
  /** The inverter's resistor from its input, and the one from its output back. */
  rIn: number;
  rFb: number;
  /** The 1N4148 from the sawtooth (or the buffer), and the one from the inverter. */
  d1: boolean;
  d2: boolean;
  /** The output's 1 µF and 200k. Without them, the scope on the diodes' point is its only load. */
  outCap: boolean;
  /** Where the 20k from the diodes' point goes. */
  pull: Pull;
}

/** As built at the end of the video. */
export const TRI_BUILT: TriSetup = { offset: 0, inCap: true, rIn: TRI.r, rFb: TRI.r, d1: true, d2: true, outCap: true, pull: 'negative' };

/** His first, basic converter: the sawtooth straight into the inverter and a diode, the scope on the diodes' point. */
export const TRI_BASIC: TriSetup = { ...TRI_BUILT, inCap: false, outCap: false, pull: 'none' };

/**
 * The converter at `hz` over one period of `n` readings from the sawtooth's jump: the sawtooth;
 * `a`, what the inverter gets (the sawtooth itself, or after the input's 1 µF, 200k and buffer);
 * `b`, the inverter's output (both op amps clip about 1.5 V short of the ±12 V rails); the diodes'
 * point; and `out`, what the scope sees at the end. The output's 1 µF is taken to hold its charge
 * over a period (its 200 ms against 5 ms at 200 Hz), at `vc`, where no current flows through it on
 * average. `ends` is the diodes' point just after the jump and just before it, exactly, and
 * `cross` where in the period `a` falls through 0 V, if it does.
 */
export function sawToTriangle(t: TriSetup, hz = TRI_SAW.hz, n = 512) {
  const period = 1 / hz, { amp } = TRI_SAW, gain = t.rFb / t.rIn, tau = TRI.c * TRI.rc;
  const clip = (v: number) => Math.max(-VSAT12, Math.min(VSAT12, v));
  const saw = Array.from({ length: n }, (_, k) => t.offset + amp - (2 * amp * k) / n);
  // the sawtooth itself (a generator's output), or buffered after the 1 µF, which takes out the offset
  const a = t.inCap ? coupledRamp(n, period, tau, 2 * amp).map(clip) : saw;
  const b = a.map((v) => clip(-gain * v));
  const top = t.inCap ? clip(rampTop(period, tau, 2 * amp)) : t.offset + amp, bottom = t.inCap ? clip(top - 2 * amp) : t.offset - amp;
  const pull: Load[] = t.pull === 'none' ? [] : [{ g: 1 / TRI.pull, v: t.pull === 'ground' ? 0 : -V12 }];
  const point = (av: number, bv: number, loads: Load[], guess?: number) => diodePoint(t.d1 ? av : null, t.d2 ? bv : null, loads, guess);
  const points = (loads: Load[]) => {
    let x: number | undefined;
    return a.map((av, k) => (x = point(av, b[k], loads, x)));
  };
  let vc = 0, loads: Load[];
  if (t.outCap) {
    // the 1 µF's charge: the point's average less it falls as it rises, through 0 where it belongs
    const via = (v: number): Load[] => [...pull, { g: 1 / TRI.rc, v }];
    let lo = Math.min(-V12, ...a, ...b) - 1, hi = Math.max(0, ...a, ...b) + 1;
    for (let k = 0; k < 40 && hi - lo > 1e-7; k++) {
      const mid = (lo + hi) / 2;
      if (points(via(mid)).reduce((sum, v) => sum + v, 0) / n > mid) lo = mid;
      else hi = mid;
    }
    vc = (lo + hi) / 2;
    loads = via(vc);
  } else loads = [...pull, { g: 1 / SCOPE_IN, v: 0 }];
  const node = points(loads);
  const out = t.outCap ? node.map((v) => v - vc) : node;
  const after = point(top, clip(-gain * top), loads), before = point(bottom, clip(-gain * bottom), loads);
  // where `a` falls through 0 V: in a straight line, or along the 1 µF's curve
  const s = (2 * amp) / period;
  const at = t.inCap ? (-tau * Math.log1p(-top / (top + s * tau))) / period : top / (2 * amp);
  return { saw, a, b, node, out, vc, gain, ends: { after, before }, cross: top > 0 && bottom < 0 ? at : null };
}

// ---------------------------------------------------------------------------
// The PWM video: a comparator for the pulse, its threshold voltage controlled, and a buffered output

/**
 * A wave through a capacitor in series, with `tau` (R C) to ground after it, from the moment it is
 * connected with the capacitor empty: `input` is steady over each reading, `dt` long, and what
 * comes out is the input less what the capacitor holds, which heads for the input as e^(−t/τ) does.
 * Exact for an input that changes only between readings. (`coupled` gives the settled wave, but
 * spreads each jump over a reading.)
 */
export function coupledFromRest(input: readonly number[], dt: number, tau: number): number[] {
  const a = Math.exp(-dt / tau);
  let vc = 0;
  return input.map((x) => {
    const y = x - vc;
    vc = x + (vc - x) * a;
    return y;
  });
}

/**
 * The PWM video's parts, from his bill of materials and the video: the threshold's passive mixer,
 * the 100k offset pot across ±12 V through 100k, the CV through the 250k intensity pot and 68k,
 * and 14k to ground; and his LFOs' swing, ±7 V.
 */
export const PWM = { pot: 100e3, offset: 100e3, ground: 14e3, cv: 68e3, intensity: 250e3, lfo: 7 };

/** Where the comparator picks up the sawtooth: part 4's, after part 1's 1 µF, into its 100k (part 2's two 10k long gone). */
export const PWM_TAU = pickupTau(false);

/**
 * The voltage where `feeds` meet with nothing else taking current, as at an op amp's input: each
 * pulls it towards its own voltage as hard as its resistance lets it (Millman's theorem). A feed
 * with no resistance sets it outright; one with infinite resistance adds nothing.
 */
export function meet(feeds: readonly Feed[]): number {
  const stiff = feeds.find((f) => f.r === 0);
  if (stiff) return stiff.v;
  let g = 0, gv = 0;
  for (const f of feeds) {
    if (!Number.isFinite(f.r)) continue;
    g += 1 / f.r;
    gv += f.v / f.r;
  }
  return g ? gv / g : 0;
}

/** What feeds the comparator's − input, as the video builds it up. */
export interface Threshold {
  /** The offset pot's turn: 0 at its −12 V end, 1 at its +12 V end. */
  turn: number;
  /** Between its wiper and the − input: 0 (a jumper) at first, then 100k. */
  rOffset: number;
  /** From the − input to ground: Infinity (nothing) at first, then 14k. */
  rGround: number;
  /** The CV path, its 68k and the intensity pot together, or null before there is one. */
  rCv: number | null;
}

/** The offset pot's wiper, as a feed into the − input: −12 to +12 V, behind its two parts in parallel and the resistor after them. */
export function offsetFeed(t: Threshold): Feed {
  const w = wiper(t.turn, 2 * V12, PWM.pot);
  return { v: w.v - V12, r: w.r + t.rOffset };
}

/** The threshold with `cv` on the CV path (0 V: something in the jack, at 0 V). */
export function thresholdOf(t: Threshold, cv = 0): number {
  const feeds: Feed[] = [offsetFeed(t), { v: 0, r: t.rGround }];
  if (t.rCv !== null) feeds.push({ v: cv, r: t.rCv });
  return meet(feeds);
}

/** How far the threshold moves for each volt on the CV path: the CV's share of the mixer (0 without a path). */
export const cvShare = (t: Threshold) => (t.rCv === null ? 0 : thresholdOf(t, 1) - thresholdOf(t, 0));

/** As built at the end of the video, the intensity pot at `intensity` ohms. */
export const pwmBuilt = (turn: number, intensity = 0): Threshold => ({ turn, rOffset: PWM.offset, rGround: PWM.ground, rCv: PWM.cv + intensity });

/**
 * How much of the time a comparator's output is high, with the core's sawtooth on its + input at
 * `hz` after part 4's 1 µF (`tau`) and `vth` on its − input: from the jump until the sawtooth's
 * fall (`coupledRamp`'s curve) gets down to it. 0 with the threshold at or above the top, 1 at or
 * below the bottom: no pulse either way.
 */
export function comparatorWidth(vth: number, hz: number, tau = PWM_TAU, vdd = V12): number {
  const { vp, vn } = thresholds(vdd);
  const jump = vp - vn, period = 1 / hz, s = jump / period, top = rampTop(period, tau, jump);
  if (vth >= top) return 0;
  if (vth <= top - jump) return 1;
  return Math.min(1, (-tau * Math.log((vth + s * tau) / (top + s * tau))) / period);
}

/**
 * Whether a threshold moving at no more than `slope` volts a second crosses the sawtooth at `hz` at
 * most once a period, as it falls: while the sawtooth falls faster still at the end of each period,
 * where it falls most slowly. Then each period has at most one pulse, from the jump to that
 * crossing, and `heldStill`'s figures are exact for a moving threshold too.
 */
export function crossesOnce(slope: number, hz: number, tau = PWM_TAU, vdd = V12): boolean {
  const { vp, vn } = thresholds(vdd);
  const jump = vp - vn, period = 1 / hz, s = jump / period, top = rampTop(period, tau, jump);
  return slope <= ((top + s * tau) / tau) * Math.exp(-period / tau);
}

/**
 * What the comparator's output does over the cycles of an LFO on its threshold: `lo` and `hi`, the
 * narrowest and widest a period's pulse gets (how much of the period it is high); `low` and `high`,
 * how much of the time (the share of the periods) it has no pulse, stuck low or stuck high; `more`,
 * how much of the time a period holds more than one pulse.
 */
export type Periods = { lo: number; hi: number; low: number; high: number; more: number };

/**
 * The same with the threshold, `base` plus `swing` volts of a triangle LFO, held still at each point
 * of the LFO's cycle, as it all but is while the LFO is slow: `comparatorWidth` at its ends, and how
 * long it spends past the sawtooth's top and bottom. Exact, and not only for a slow LFO, while
 * `crossesOnce` holds.
 */
export function heldStill(base: number, swing: number, hz: number, tau = PWM_TAU, vdd = V12): Periods {
  const { vp, vn } = thresholds(vdd);
  const top = rampTop(1 / hz, tau, vp - vn), bottom = top - (vp - vn);
  // a triangle spends as long at each level between its ends as at any other
  const past = (by: number) => (swing > 0 ? Math.max(0, Math.min(1, by / (2 * swing))) : by > 0 ? 1 : 0);
  return { lo: comparatorWidth(base + swing, hz, tau, vdd), hi: comparatorWidth(base - swing, hz, tau, vdd), low: past(base + swing - top), high: past(bottom - base + swing), more: 0 };
}

/**
 * One period of the comparator's output, the sawtooth at `hz` against `base` plus `swing` volts of a
 * triangle LFO at `rate` hertz, the LFO at `phase` of its cycle (`triangle`'s) at the period's jump:
 * `width`, how much of the period the output is high; `rises`, how many pulses start in it (at the
 * jump or later); `most` and `least`, the most and least the sawtooth gets above the threshold
 * (the output stuck low for the period if `most` is 0 or less, stuck high if `least` is above 0).
 */
export type Period = { width: number; rises: number; most: number; least: number };

/**
 * `Period` exactly, for an LFO at `phase` (0 to 1): the period cut where the triangle turns and,
 * where the threshold falls, where it starts to fall faster than the sawtooth, so that between the
 * cuts the sawtooth less the threshold only rises or only falls, and crosses 0 at most once, found
 * by regula falsi (Illinois).
 */
export function periodAt(base: number, swing: number, hz: number, rate: number, tau = PWM_TAU, vdd = V12): (phase: number) => Period {
  const { vp, vn } = thresholds(vdd);
  const jump = vp - vn, period = 1 / hz, s = jump / period, top = rampTop(period, tau, jump), bottom = top - jump, c = top + s * tau;
  const steep = 4 * swing * rate, tol = period * 1e-10;
  // where a threshold falling as steeply as the LFO's starts to fall faster than the sawtooth
  const turn = steep > 0 ? -tau * Math.log((steep * tau) / c) : NaN;
  /** The sawtooth, at the period's end its bottom, just before the next jump. */
  const saw = (u: number) => (u >= period ? bottom : c * Math.exp(-u / tau) - s * tau);
  return (phase) => {
    let width = 0, rises = 0, most = -Infinity, least = Infinity;
    /** From `a` to `b`, the threshold `tha` at `a` and moving `m` volts a second. */
    const piece = (a: number, b: number, tha: number, m: number) => {
      const f = (u: number) => saw(u) - tha - m * (u - a);
      const fa = f(a), fb = f(b);
      most = Math.max(most, fa, fb);
      least = Math.min(least, fa, fb);
      if (fa > 0 && fb > 0) width += b - a;
      else if (fa > 0 || fb > 0) {
        let lo = a, hi = b, flo = fa, fhi = fb, side = 0;
        for (let k = 0; k < 60 && hi - lo > tol; k++) {
          let x = (lo * fhi - hi * flo) / (fhi - flo);
          if (!(x > lo && x < hi)) x = (lo + hi) / 2;
          const fx = f(x);
          if (fx > 0 === fa > 0) {
            [lo, flo] = [x, fx];
            if (side === 1) fhi /= 2;
            side = 1;
          } else {
            [hi, fhi] = [x, fx];
            if (side === -1) flo /= 2;
            side = -1;
          }
        }
        const x = (lo + hi) / 2;
        if (fa > 0) width += x - a;
        else {
          width += b - x;
          rises++;
        }
      }
    };
    const cuts = [0];
    if (steep > 0) {
      for (let k = Math.floor(2 * (phase - 0.25)) + 1; ; k++) {
        const u = (0.25 + k / 2 - phase) / rate;
        if (u >= period) break;
        if (u > 0) cuts.push(u);
      }
    }
    cuts.push(period);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1], tha = base + swing * triangle(phase + rate * a);
      // rising or falling: which half of the triangle the middle of the piece is in
      const falling = steep > 0 && (((phase + rate * ((a + b) / 2) + 0.25) % 1) + 1) % 1 > 0.5;
      const m = falling ? -steep : steep;
      if (falling && turn > a && turn < b) {
        piece(a, turn, tha, m);
        piece(turn, b, tha + m * (turn - a), m);
      } else piece(a, b, tha, m);
    }
    // the jump, if the output was low before it and is high after
    const th0 = base + swing * triangle(phase);
    if (bottom <= th0 && th0 < top) rises++;
    return { width: width / period, rises, most, least };
  };
}

/** Golden-section search for the least of `g` between `a` and `b`: where, and what. */
function leastOf(g: (x: number) => number, a: number, b: number, steps = 30) {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a), d = a + r * (b - a), gc = g(c), gd = g(d);
  for (let k = 0; k < steps; k++) {
    if (gc < gd) {
      b = d;
      d = c;
      gd = gc;
      c = b - r * (b - a);
      gc = g(c);
    } else {
      a = c;
      c = d;
      gc = gd;
      d = a + r * (b - a);
      gd = g(d);
    }
  }
  return gc < gd ? { x: c, y: gc } : { x: d, y: gd };
}

/**
 * `Periods` with the LFO moving the threshold within each period (`periodAt`), the periods starting
 * at every point of its cycle in turn, as they do unless the LFO and the note are locked together:
 * from periods starting at `places` points of the cycle, the narrowest and widest sought out around
 * the narrowest and widest of them, and each share's edges found by halving, between two that
 * differ, and between two that don't where a margin dips towards 0 (`most` for stuck low, `least`
 * for stuck high), for the stretch it may dip past 0 between them.
 */
export function comparatorPeriods(base: number, swing: number, hz: number, rate: number, places = 256, tau = PWM_TAU, vdd = V12): Periods {
  const one = periodAt(base, swing, hz, rate, tau, vdd);
  const at = (x: number) => one(x - Math.floor(x));
  const res = Array.from({ length: places }, (_, k) => one(k / places));
  const wrap = (k: number) => ((k % places) + places) % places;
  const extreme = (sign: 1 | -1) => {
    let k = 0;
    for (let j = 1; j < places; j++) if (sign * res[j].width < sign * res[k].width) k = j;
    return sign * Math.min(sign * res[k].width, leastOf((x) => sign * at(x).width, (k - 1) / places, (k + 1) / places).y);
  };
  /** How much of the cycle `inside` holds for; with a `margin`, below 0 (or at it) inside, also the narrow stretches between places. */
  const share = (inside: (p: Period) => boolean, margin?: (p: Period) => number) => {
    const g = margin ? res.map(margin) : [];
    // a place where the margin is lowest, close enough to 0 that it may dip past it before the next
    const dip = (k: number) => {
      const i = wrap(k), p = g[wrap(i - 1)], n = g[wrap(i + 1)];
      return g[i] <= p && g[i] <= n && g[i] < Math.max(p, n) - g[i];
    };
    /** Where `inside` changes between `a`, where it is `inA`, and `b`, where it isn't. */
    const edge = (a: number, b: number, inA: boolean) => {
      for (let k = 0; k < 24; k++) {
        const m = (a + b) / 2;
        if (inside(at(m)) === inA) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    let sum = 0;
    for (let k = 0; k < places; k++) {
      const a = k / places, b = (k + 1) / places, ia = inside(res[k]), ib = inside(res[wrap(k + 1)]);
      if (ia && ib) sum += b - a;
      else if (ia) sum += edge(a, b, true) - a;
      else if (ib) sum += b - edge(a, b, false);
      else if (margin && (dip(k) || dip(k + 1))) {
        const m = leastOf((x) => margin(at(x)), a, b);
        if (inside(at(m.x))) sum += edge(m.x, b, true) - edge(a, m.x, false);
      }
    }
    return sum;
  };
  return {
    lo: extreme(1),
    hi: extreme(-1),
    low: share((p) => p.most <= 0, (p) => p.most),
    high: share((p) => p.least > 0, (p) => -p.least),
    more: share((p) => p.rises > 1),
  };
}

/** What follows the comparator to the jack: 100k with 68k to ground alone (his divider without his buffer), a divider a hundred times lower (the lab's own), or his, the 100k and 68k into a buffer and 1k after it. */
export type OutStage = 'divider' | 'low' | 'buffered';
export const OUT_STAGES: Record<OutStage, { top: number; bottom: number; buffer: boolean; r: number }> = {
  divider: { top: 100e3, bottom: 68e3, buffer: false, r: 0 },
  low: { top: 1e3, bottom: 680, buffer: false, r: 0 },
  buffered: { top: 100e3, bottom: 68e3, buffer: true, r: 1e3 },
};

/**
 * The jack for `v` out of the comparator, into `load` to ground: `open`, with nothing on it (the
 * divider's middle, which the buffer copies); `z`, the output impedance (the divider's two halves in
 * parallel, or the buffer's 1k); `out`, into the load; `rIn`, the resistance the comparator drives,
 * the divider and, without the buffer, the load beside its lower half; `current`, what it gives
 * through that; and `toGround`, what goes through the lower half.
 */
export function outStage(v: number, stage: OutStage, load = Infinity) {
  const o = OUT_STAGES[stage];
  const open = divide(v, o.top, o.bottom);
  const z = o.buffer ? o.r : par(o.top, o.bottom);
  const out = Number.isFinite(load) ? (open * load) / (load + z) : open;
  const rIn = o.top + (o.buffer || !Number.isFinite(load) ? o.bottom : par(o.bottom, load));
  return { open, z, out, rIn, current: v / rIn, toGround: (o.buffer ? open : out) / o.bottom };
}

/**
 * TI's typical curve of a TL07x's swing against its load (SLOS080W, figure 5-43, on ±15 V): 13.5 V
 * into 10k and about 12 V into 2k, as if it were a little short of the rail (`short`, 1.06 V) behind
 * a resistance (`r`, 323 Ω). A fit to those two points: close to the curve from about 1.5k up, as
 * every load here is (the heaviest, the low-value divider into 10k, 1.64k), and short of it below.
 */
export const TL074_LOADED = (() => {
  const r = (10e3 * 2e3 * (12 - 13.5)) / (13.5 * 2e3 - 12 * 10e3);
  return { r, short: 15 - (13.5 * (10e3 + r)) / 10e3 };
})();

/**
 * A TL074's output at a rail on ±12 V into `r` to ground: VSAT12, 1.5 V short of the rail, into a
 * light load, as everywhere here, and less into a heavy one, as TI's curve has it (`TL074_LOADED`):
 * VSAT12 from about 8k up.
 */
export const swingInto = (r: number) => Math.min(VSAT12, (V12 - TL074_LOADED.short) / (1 + TL074_LOADED.r / r));

/**
 * The jack's output impedance after `stage`, the comparator at a rail behind it: `outStage`'s `z`,
 * and where the stage is a load heavy enough to pull the comparator's swing in (`swingInto`), the
 * comparator's own resistance (`TL074_LOADED`'s) behind the divider's top as well.
 */
export function outZ(stage: OutStage): number {
  const o = OUT_STAGES[stage], open = outStage(VSAT12, stage);
  return o.buffer || swingInto(open.rIn) >= VSAT12 ? open.z : par(o.top + TL074_LOADED.r, o.bottom);
}

/** Part 4's square out's output impedance: its 20k with the 100k beside it (the 1 µF a short at audio pitches, the 40106 behind it). */
export const SQUARE_Z = par(SQUARE_DIV.top, SQUARE_DIV.bottom);
