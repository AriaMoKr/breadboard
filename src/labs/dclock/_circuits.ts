import { CHIP_MODELS, instantiateChip } from '../../breadboard/sim/chips';
import { Circuit, type Level, type Net } from '../../logic/circuit';

/**
 * The digital clock's counters (breadboard clock parts 3-5) as chip-level circuits, built from
 * the same chip models as the breadboard sandbox (src/breadboard/sim/chips.ts) and wired as Ben
 * wires them: 74LS90 decade counters and 74LS92 divide-by-12 counters with Q0 round to ~CP1, and
 * CD4511 decoders with ~LT and ~BI high and LE low.
 */

export type Mains = 60 | 50;

/** A Circuit with a strong 0 and 1 to tie pins to. */
export function clockCircuit() {
  const c = new Circuit();
  return { c, gnd: c.input('GND', 0), vcc: c.input('VCC', 1) };
}

const nets = (c: Circuit, prefix: string, n: number) => Array.from({ length: n }, (_, k) => c.net(`${prefix}${k}`, 'Z'));

/** A 74LS90 with Q0 round to ~CP1 (BCD 0-9), clocked on `clk`. MS1/MS2 grounded. */
export function decade(c: Circuit, name: string, clk: Net, reset: Net, gnd: Net): Net[] {
  const q = nets(c, `${name}.Q`, 4);
  instantiateChip(c, CHIP_MODELS['74LS90'], { '~CP0': clk, '~CP1': q[0], Q0: q[0], Q1: q[1], Q2: q[2], Q3: q[3], MR1: reset, MR2: reset, MS1: gnd, MS2: gnd }, {}, name);
  return q;
}

/** A 74LS92 with Q0 round to ~CP1: Q0-Q2 count 0..5 (Ben's tens), Q3 divides by 12. */
export function sixes(c: Circuit, name: string, clk: Net, reset: Net): Net[] {
  const q = nets(c, `${name}.Q`, 4);
  instantiateChip(c, CHIP_MODELS['74LS92'], { '~CP0': clk, '~CP1': q[0], Q0: q[0], Q1: q[1], Q2: q[2], Q3: q[3], MR1: reset, MR2: reset }, {}, name);
  return q;
}

/** A 74LS90 using only its ÷5 section (the second chip of the 50 Hz divider): in on ~CP1, out on Q3. */
export function fives(c: Circuit, name: string, clk: Net, reset: Net, gnd: Net): Net[] {
  const q = nets(c, `${name}.Q`, 4);
  instantiateChip(c, CHIP_MODELS['74LS90'], { '~CP0': gnd, '~CP1': clk, Q0: q[0], Q1: q[1], Q2: q[2], Q3: q[3], MR1: reset, MR2: reset, MS1: gnd, MS2: gnd }, {}, name);
  return q;
}

/** A CD4511 decoding `bcd` (A first; a missing D is grounded): the segments a..g. */
export function decoder(c: Circuit, name: string, bcd: Net[], gnd: Net, vcc: Net, opts: { lt?: Net; bi?: Net; le?: Net } = {}): Net[] {
  const seg = nets(c, `${name}.`, 7);
  const [a, b, cc, d, e, f, g] = seg;
  instantiateChip(c, CHIP_MODELS.CD4511, { A: bcd[0], B: bcd[1], C: bcd[2], D: bcd[3] ?? gnd, '~LT': opts.lt ?? vcc, '~BI': opts.bi ?? vcc, LE: opts.le ?? gnd, a, b, c: cc, d, e, f, g }, {}, name);
  return seg;
}

/** The segment byte for SevenSegment (dp a b c d e f g) from a CD4511's a..g nets. */
export const segByte = (seg: Net[]) => seg.reduce((byte, n, i) => byte | ((n.value === 1 ? 1 : 0) << (6 - i)), 0);

/** A little-endian number from nets, or -1 if one isn't 0/1. */
export function value(qs: Net[]): number {
  let v = 0;
  for (let k = 0; k < qs.length; k++) {
    const l = qs[k].value;
    if (l !== 0 && l !== 1) return -1;
    v |= l << k;
  }
  return v;
}

export interface Timebase {
  /** Each stage from the mains frequency down to 1 Hz: [label, net]. */
  taps: [string, Net][];
  /** The once-a-second output. */
  out: Net;
  /** The 3 Hz tap (60 Hz mains) or 5 Hz (50 Hz) Ben sets the time with. */
  fast: Net;
}

/**
 * Part 3's divider. 60 Hz: a 74LS90 (÷2, ÷5) then a 74LS92 (÷2, ÷3): 30, 6, 3 and 1 Hz, the last
 * on the 92's Q2 (pin 9). 50 Hz: a 74LS90 (÷2, ÷5) then only the ÷5 section of a second 74LS90.
 */
export function timebase(c: Circuit, mains: Mains, hz: Net, reset: Net, gnd: Net): Timebase {
  const u1 = decade(c, 'TB1', hz, reset, gnd);
  if (mains === 60) {
    const u2 = sixes(c, 'TB2', u1[3], reset);
    return { taps: [['60 Hz', hz], ['30 Hz', u1[0]], ['6 Hz', u1[3]], ['3 Hz', u2[0]], ['1 Hz', u2[2]]], out: u2[2], fast: u2[0] };
  }
  const u2 = fives(c, 'TB2', u1[3], reset, gnd);
  return { taps: [['50 Hz', hz], ['25 Hz', u1[0]], ['5 Hz', u1[3]], ['1 Hz', u2[3]]], out: u2[3], fast: u1[3] };
}

export interface Sixty {
  units: Net[];
  tens: Net[];
  /** The tens' Q2: falls as 59 goes to 00, once per cycle (the next counter's clock). */
  carry: Net;
}

/**
 * Part 4's 00-59 counter: a 74LS90 for the units and a 74LS92 for the tens, clocked by the
 * units' Q3 (falling as 9 goes to 0), or through `between` (an inverter in the lab's "what if it
 * counted on rising edges" experiment).
 */
export function sixty(c: Circuit, name: string, clk: Net, reset: Net, gnd: Net, between?: (q3: Net) => Net): Sixty {
  const units = decade(c, `${name}.U`, clk, reset, gnd);
  const tens = sixes(c, `${name}.T`, between ? between(units[3]) : units[3], reset);
  return { units, tens, carry: tens[2] };
}

/**
 * Drives a clock input at `hz` in simulated real time: `advance(seconds)` toggles it at every
 * half period that falls in that time and settles the circuit after each toggle, calling
 * `sample` every `sampleEvery` seconds in between. Returns how many toggles it made.
 */
export class SquareSource {
  t = 0;
  private nextToggle = 0;
  private nextSample = 0;
  level: 0 | 1 = 1;
  constructor(
    readonly c: Circuit,
    readonly net: Net,
    public hz: number,
  ) {
    c.set(net, 1);
    c.settle(10000);
  }
  advance(seconds: number, sample?: () => void, sampleEvery = 0.002): number {
    const end = this.t + seconds;
    let toggles = 0;
    for (;;) {
      const tToggle = this.nextToggle;
      const tSample = sample ? this.nextSample : Infinity;
      const next = Math.min(tToggle, tSample);
      if (next > end) break;
      this.t = next;
      if (next === tSample) {
        sample!();
        this.nextSample += sampleEvery;
      } else {
        this.level = this.level ? 0 : 1;
        this.c.set(this.net, this.level as Level);
        this.c.settle(10000);
        this.nextToggle += 1 / (2 * this.hz);
        toggles++;
      }
    }
    this.t = end;
    return toggles;
  }
}
