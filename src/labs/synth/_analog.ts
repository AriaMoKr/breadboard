/**
 * Analog models for Moritz Klein's "For Beginners" videos (docs/research/moritz-klein.md), with his
 * parts and values: 9 V batteries, LEDs with 1k, and a TL074 on ±9 V, from the op-amp inverter to
 * the square-wave oscillator of his breadboard guide; then DIY VCO part 1's oscillator core, a
 * 40106 with a diode, 2.2 nF and 100k, and what follows it; then part 2's exponential converter, a
 * BC548C in the 100k's place with a pot and a sequencer at its base; then part 3's BC558C emitter
 * follower in front of that base, and the scale tuned with a trimmer; then part 4's thermistors and
 * fine-tune knob in its mixer, and the sawtooth amplified and shaped into a pulse by another of the
 * 40106's inverters. Time is in seconds, voltages in volts, currents in amps. Plain arithmetic, as
 * src/labs/dclock/_analog.ts does for Ben's clock, so the labs and the tests share it.
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
 * The core's sawtooth on `vdd` after a capacitor in series, with `tau` to ground after it, once
 * settled: its top, just after each jump. From there it falls at the core's rate, S = (VP − VN) ÷
 * `period`, heading for −S `tau`, until the jump puts back what the period took off; its bottom,
 * just before the jump, is the jump below its top.
 */
export function sawTop(period: number, tau: number, vdd = V12): number {
  const { vp, vn } = thresholds(vdd);
  return (vp - vn) / -Math.expm1(-period / tau) - ((vp - vn) / period) * tau;
}

/** The same sawtooth, one period of `n` readings from its top: exact, the jump instant, where `coupled` on `sawWave` spreads it over a reading. */
export function coupledSaw(n: number, period: number, tau: number, vdd = V12): number[] {
  const { vp, vn } = thresholds(vdd), s = (vp - vn) / period, top = sawTop(period, tau, vdd);
  // −S tau + (top + S tau) e^(−t/tau), written so that the first reading is the top itself
  return Array.from({ length: n }, (_, k) => top + (top + s * tau) * Math.expm1((-k / n) * (period / tau)));
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
