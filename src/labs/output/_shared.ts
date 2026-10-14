import { HEX_DIGITS, SEG, displayEepromImage } from '../../sim/display';

/**
 * Pure models for the output chapter (videos 30-33): the hex decoder's
 * boolean algebra, the 28C16 EEPROM, the 74HC595 shift registers of the
 * Arduino programmer, and the multiplexed decimal display. Unit-tested in
 * tests/labs-memory-output.test.ts.
 */

// ===========================================================================
// 7-segment hex decoder (video 30)

export const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
export type Seg = (typeof SEGS)[number];

/** Common cathode: a 1 lights the segment. Common anode (Ben's display in video 30): a 0 lights it. */
export type Polarity = 'cc' | 'ca';

/** Variable names, MSB first: A = 8s bit ... D = 1s bit. */
export const VARS = ['A', 'B', 'C', 'D'] as const;

/** Is segment `seg` lit for hex digit x? (Ben's patterns, HEX_DIGITS in src/sim/display.ts.) */
export const segLit = (x: number, seg: Seg): 0 | 1 => ((HEX_DIGITS[x & 15] & SEG[seg]) !== 0 ? 1 : 0);

/** Output pin level the decoder must produce for input x. */
export const segOutput = (x: number, seg: Seg, pol: Polarity): 0 | 1 => (pol === 'cc' ? segLit(x, seg) : ((segLit(x, seg) ^ 1) as 0 | 1));

/** Inputs (0-15) for which the output is 1. */
export const minterms = (seg: Seg, pol: Polarity) => Array.from({ length: 16 }, (_, x) => x).filter((x) => segOutput(x, seg, pol) === 1);

/** A product term. Bits set in `mask` are "don't care" (the variable is absent). */
export interface Implicant {
  value: number;
  mask: number;
}

export const covers = (imp: Implicant, x: number) => (x & ~imp.mask & 15) === (imp.value & ~imp.mask & 15);
export const literalCount = (imp: Implicant) => 4 - popcount(imp.mask & 15);
const popcount = (v: number) => { let n = 0; for (; v; v &= v - 1) n++; return n; };

/** All prime implicants of a 4-variable function (Quine-McCluskey). */
export function primeImplicants(ms: number[]): Implicant[] {
  let current: Implicant[] = ms.map((m) => ({ value: m & 15, mask: 0 }));
  const primes: Implicant[] = [];
  const key = (i: Implicant) => `${i.value & ~i.mask & 15}/${i.mask}`;
  while (current.length) {
    const used = new Set<string>();
    const next = new Map<string, Implicant>();
    for (let i = 0; i < current.length; i++)
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i], b = current[j];
        if (a.mask !== b.mask) continue;
        const diff = (a.value ^ b.value) & ~a.mask & 15;
        if (popcount(diff) !== 1) continue;
        const merged = { value: a.value & ~diff & 15, mask: a.mask | diff };
        next.set(key(merged), merged);
        used.add(key(a));
        used.add(key(b));
      }
    for (const imp of current) if (!used.has(key(imp)) && !primes.some((p) => key(p) === key(imp))) primes.push({ value: imp.value & ~imp.mask & 15, mask: imp.mask });
    current = [...next.values()];
  }
  return primes;
}

/** A minimum sum of products: fewest terms, then fewest literals (exact search; tiny for 4 variables). */
export function minimise(ms: number[]): Implicant[] {
  if (ms.length === 0) return [];
  if (ms.length === 16) return [{ value: 0, mask: 15 }];
  const pis = primeImplicants(ms);
  const found: { terms: Implicant[] | null; lits: number } = { terms: null, lits: Infinity };
  const n = pis.length;
  for (let size = 1; size <= n && !found.terms; size++) {
    const pick: number[] = [];
    const rec = (start: number) => {
      if (pick.length === size) {
        const chosen = pick.map((k) => pis[k]);
        if (ms.every((m) => chosen.some((imp) => covers(imp, m)))) {
          const lits = chosen.reduce((s, imp) => s + literalCount(imp), 0);
          if (lits < found.lits) {
            found.lits = lits;
            found.terms = chosen;
          }
        }
        return;
      }
      for (let k = start; k < n; k++) {
        pick.push(k);
        rec(k + 1);
        pick.pop();
      }
    };
    rec(0);
  }
  return (found.terms ?? []).slice().sort((a, b) => literalCount(a) - literalCount(b) || a.value - b.value);
}

/** Canonical sum of products: one 4-literal term per minterm. */
export const canonical = (ms: number[]): Implicant[] => ms.map((m) => ({ value: m, mask: 0 }));

export const evalSop = (terms: Implicant[], x: number): 0 | 1 => (terms.some((t) => covers(t, x)) ? 1 : 0);

/** Literals of a term, MSB first: var index 0 = A (bit 3) ... 3 = D (bit 0). */
export function literals(imp: Implicant): { v: number; neg: boolean }[] {
  const out: { v: number; neg: boolean }[] = [];
  for (let v = 0; v < 4; v++) {
    const bit = 3 - v;
    if ((imp.mask >> bit) & 1) continue;
    out.push({ v, neg: ((imp.value >> bit) & 1) === 0 });
  }
  return out;
}

const OVER = '̅';
export const formatTerm = (imp: Implicant) => {
  const l = literals(imp);
  return l.length ? l.map((x) => VARS[x.v] + (x.neg ? OVER : '')).join('') : '1';
};
export const formatSop = (terms: Implicant[]) => (terms.length ? terms.map(formatTerm).join(' + ') : '0');

/** 2-input gate count for one SOP: an n-literal term needs n-1 ANDs; k terms need k-1 ORs. */
export function gateCount(terms: Implicant[]): { and2: number; or2: number } {
  const and2 = terms.reduce((s, t) => s + Math.max(0, literalCount(t) - 1), 0);
  return { and2, or2: Math.max(0, terms.length - 1) };
}

export interface DecoderCost {
  and2: number;
  or2: number;
  /** Inverters for complemented inputs (at most 4: one 74LS04). */
  not: number;
  /** Quad 2-input chips (74LS08 / 74LS32) plus hex inverter (74LS04). */
  chips: { ls08: number; ls32: number; ls04: number; total: number };
}

/** Cost of the whole 7-segment decoder; with `share`, identical product terms are built only once. */
export function decoderCost(kind: 'canonical' | 'minimal', pol: Polarity, share = false): DecoderCost {
  const perSeg = SEGS.map((s) => (kind === 'canonical' ? canonical(minterms(s, pol)) : minimise(minterms(s, pol))));
  let and2 = 0;
  let or2 = 0;
  const seen = new Set<string>();
  const negVars = new Set<number>();
  for (const terms of perSeg) {
    or2 += Math.max(0, terms.length - 1);
    for (const t of terms) {
      literals(t).forEach((l) => l.neg && negVars.add(l.v));
      const k = `${t.value}/${t.mask}`;
      if (share && seen.has(k)) continue;
      seen.add(k);
      and2 += Math.max(0, literalCount(t) - 1);
    }
  }
  const ls08 = Math.ceil(and2 / 4), ls32 = Math.ceil(or2 / 4), ls04 = negVars.size ? 1 : 0;
  return { and2, or2, not: negVars.size, chips: { ls08, ls32, ls04, total: ls08 + ls32 + ls04 } };
}

/**
 * Cost of the minimised decoder when 2-input partial products are shared
 * too: every product of two A/B literals (A̅B̅, A̅B, AB̅, AB) and of two C/D
 * literals is built once, and each longer term is one more AND of an A/B part
 * with a C/D part. This is how a hand-wired decoder fits in far fewer chips.
 */
export function decoderCostPairs(pol: Polarity): DecoderCost {
  const terms = new Map<string, Implicant>();
  const ors = SEGS.reduce((n, s) => {
    const t = minimise(minterms(s, pol));
    t.forEach((x) => terms.set(`${x.value}/${x.mask}`, x));
    return n + Math.max(0, t.length - 1);
  }, 0);
  const pairs = new Set<string>();
  const negVars = new Set<number>();
  let joins = 0;
  for (const t of terms.values()) {
    const lits = literals(t);
    lits.forEach((l) => l.neg && negVars.add(l.v));
    const ab = lits.filter((l) => l.v < 2);
    const cd = lits.filter((l) => l.v >= 2);
    for (const g of [ab, cd]) if (g.length === 2) pairs.add(g.map((l) => `${l.v}${l.neg ? '-' : '+'}`).join(''));
    if (ab.length && cd.length) joins++;
  }
  const and2 = pairs.size + joins;
  const ls08 = Math.ceil(and2 / 4), ls32 = Math.ceil(ors / 4), ls04 = negVars.size ? 1 : 0;
  return { and2, or2: ors, not: negVars.size, chips: { ls08, ls32, ls04, total: ls08 + ls32 + ls04 } };
}

/** Ben's common-anode hex table from eeprom-programmer.ino (bitwise NOT of the common-cathode one). */
export const HEX_CA = HEX_DIGITS.map((x) => ~x & 0xff);

// ===========================================================================
// 28C16 EEPROM (video 31)

export const T_WP_MIN_NS = 100;
export const T_WP_MAX_NS = 1000;
/** Self-timed byte write cycle, worst case. */
export const T_WC_MS = 1;

export type PulseCheck = 'too-short' | 'ok' | 'too-long';
export function checkWritePulse(ns: number): PulseCheck {
  if (ns < T_WP_MIN_NS) return 'too-short';
  if (ns > T_WP_MAX_NS) return 'too-long';
  return 'ok';
}

export interface EepromWriteResult {
  stored: boolean;
  check: PulseCheck | 'inhibited';
  reason: string;
}

/** A 28C16 2K × 8 parallel EEPROM. Erased bytes read 0xFF. */
export class Eeprom28C16 {
  readonly mem = new Uint8Array(2048).fill(0xff);

  /** Byte driven on I/O0-7, or null when the outputs are off (C̅E̅, O̅E̅ low and W̅E̅ high to read). */
  output(addr: number, ceN: 0 | 1, oeN: 0 | 1, weN: 0 | 1): number | null {
    return ceN === 0 && oeN === 0 && weN === 1 ? this.mem[addr & 0x7ff] : null;
  }

  /**
   * A W̅E̅ low pulse of `pulseNs`. Address is latched on the falling edge, data
   * on the rising edge. Writes are inhibited with O̅E̅ low or C̅E̅ high.
   */
  write(addr: number, data: number, opts: { ceN: 0 | 1; oeN: 0 | 1; pulseNs: number }): EepromWriteResult {
    if (opts.ceN === 1) return { stored: false, check: 'inhibited', reason: 'C̅E̅ is high: the chip is not enabled, so the write is ignored.' };
    if (opts.oeN === 0) return { stored: false, check: 'inhibited', reason: 'O̅E̅ is low: the datasheet inhibits writes while the outputs are enabled.' };
    const check = checkWritePulse(opts.pulseNs);
    if (check === 'too-short') return { stored: false, check, reason: `A ${opts.pulseNs} ns pulse is shorter than t_WP(min) = ${T_WP_MIN_NS} ns: the chip may not register it.` };
    this.mem[addr & 0x7ff] = data & 0xff;
    return {
      stored: true,
      check,
      reason: check === 'ok' ? 'Within the datasheet’s 100-1000 ns write pulse.' : `Longer than t_WP(max) = ${T_WP_MAX_NS} ns: out of spec. Many chips still write, but the datasheet does not promise it.`,
    };
  }

  erase() {
    this.mem.fill(0xff);
  }
}

/** Pulse width of an RC one-shot (time above the TTL threshold). */
export const rcPulseNs = (rOhm: number, cFarad: number, vth = 1.4, vcc = 5) => rOhm * cFarad * Math.log(vcc / vth) * 1e9;

// ===========================================================================
// Arduino EEPROM programmer (video 32): 2 cascaded 74HC595

/** One 74HC595: an 8-bit shift register (QA = bit 0) and an 8-bit storage register. */
export class Sr595 {
  shift = 0;
  latch = 0;
  /** QH' (serial out) = last stage of the shift register. */
  get qhPrime(): 0 | 1 {
    return ((this.shift >> 7) & 1) as 0 | 1;
  }
  /** Rising edge on SRCLK: QA <- SER, QB <- QA, ..., QH <- QG. */
  clock(ser: 0 | 1) {
    this.shift = ((this.shift << 1) | ser) & 0xff;
  }
  /** Rising edge on RCLK: copy the shift register to the outputs. */
  rclk() {
    this.latch = this.shift;
  }
}

/** Two 595s chained (QH' of #1 into SER of #2) sharing SRCLK and RCLK, wired as in Ben's programmer. */
export class Cascade595 {
  readonly u1 = new Sr595();
  readonly u2 = new Sr595();
  clock(ser: 0 | 1) {
    const carry = this.u1.qhPrime;
    this.u1.clock(ser);
    this.u2.clock(carry);
  }
  rclk() {
    this.u1.rclk();
    this.u2.rclk();
  }
  /** EEPROM address lines: #1 QA-QH = A0-A7, #2 QA-QC = A8-A10. */
  get address(): number {
    return this.u1.latch | ((this.u2.latch & 7) << 8);
  }
  /** #2 QH drives the EEPROM's O̅E̅. */
  get oeN(): 0 | 1 {
    return ((this.u2.latch >> 7) & 1) as 0 | 1;
  }
}

/** The two bytes setAddress() shifts out, in order: (address >> 8) | OE bit, then the low byte. */
export function setAddressBytes(address: number, outputEnable: boolean): [number, number] {
  return [((address >> 8) & 0xff) | (outputEnable ? 0x00 : 0x80), address & 0xff];
}

/** shiftOut(): the bits in the order they go out on SHIFT_DATA. */
export function shiftOutBits(byte: number, msbFirst = true): (0 | 1)[] {
  return Array.from({ length: 8 }, (_, i) => ((byte >> (msbFirst ? 7 - i : i)) & 1) as 0 | 1);
}

const h2 = (v: number) => v.toString(16).padStart(2, '0');
/** One line of printContents(): sprintf("%03x:  %02x %02x ... %02x   %02x ... %02x"). */
export function formatContentsLine(base: number, data: ArrayLike<number>): string {
  const b = Array.from({ length: 16 }, (_, i) => h2(data[i] ?? 0));
  return `${base.toString(16).padStart(3, '0')}:  ${b.slice(0, 8).join(' ')}   ${b.slice(8).join(' ')}`;
}

// ===========================================================================
// Multiplexed decimal display (video 33)

export interface Astable {
  tHigh: number;
  tLow: number;
  period: number;
  freq: number;
}

/** 555 astable: t_high = 0.693 (R1 + R2) C, t_low = 0.693 R2 C. */
export function astable555(r1: number, r2: number, c: number): Astable {
  const tHigh = 0.693 * (r1 + r2) * c;
  const tLow = 0.693 * r2 * c;
  return { tHigh, tLow, period: tHigh + tLow, freq: 1 / (tHigh + tLow) };
}

/** The display clock: R65 = 1 kΩ, R66 = 100 kΩ, C8 = 10 nF (about 716 Hz). */
export const DISPLAY_555 = { r1: 1000, r2: 100_000, c: 10e-9 };
/** Ben's slow demo capacitor. */
export const SLOW_DEMO_C = 2e-6;

/** Capacitor that gives frequency f with the display's R1/R2. */
export const capForFreq = (f: number, r1 = DISPLAY_555.r1, r2 = DISPLAY_555.r2) => 1 / (0.693 * (r1 + 2 * r2) * f);

/**
 * 74LS76 wired as a 2-bit counter: both JKs have J = K = 1 (toggle) and are
 * negative-edge triggered. FF A is clocked by the 555, FF B by FF A's Q̅.
 * Digit select = (Q̅B, Q̅A) = (A9, A8).
 */
export class Ls76Counter {
  qa: 0 | 1 = 0;
  qb: 0 | 1 = 0;
  /** Falling edge of the 555 output. */
  clockFall() {
    const nqaBefore = this.qa ^ 1;
    this.qa = (this.qa ^ 1) as 0 | 1;
    const nqaAfter = this.qa ^ 1;
    if (nqaBefore === 1 && nqaAfter === 0) this.qb = (this.qb ^ 1) as 0 | 1;
  }
  get a8(): 0 | 1 {
    return (this.qa ^ 1) as 0 | 1;
  }
  get a9(): 0 | 1 {
    return (this.qb ^ 1) as 0 | 1;
  }
  get select(): number {
    return (this.a9 << 1) | this.a8;
  }
}

/** One half of a 74LS139 2-to-4 decoder: active-low outputs Y̅0-Y̅3. */
export function ls139(sel: number, enN: 0 | 1 = 0): [0 | 1, 0 | 1, 0 | 1, 0 | 1] {
  return [0, 1, 2, 3].map((i) => (enN === 0 && (sel & 3) === i ? 0 : 1)) as [0 | 1, 0 | 1, 0 | 1, 0 | 1];
}

/** Digit select: 0 = ones (rightmost), 1 = tens, 2 = hundreds, 3 = sign (leftmost). */
export const DIGIT_NAMES = ['ones', 'tens', 'hundreds', 'sign'] as const;

/** Display EEPROM address: A10 = signed mode, A9 A8 = digit, A7-A0 = value. */
export const digitAddress = (value: number, digit: number, signed: boolean) => (signed ? 1024 : 0) | ((digit & 3) << 8) | (value & 0xff);

export const DISPLAY_IMAGE = displayEepromImage();

/**
 * Persistence of vision: perceived brightness follows the fraction of time a
 * segment was lit with a first-order lag (time constant tauMs).
 */
export function persist(prev: number, litFraction: number, dtMs: number, tauMs: number): number {
  const k = Math.exp(-dtMs / tauMs);
  return prev * k + (1 - k) * litFraction;
}

export interface MuxState {
  /** 555 output level and time until it next toggles (s). */
  out: 0 | 1;
  untilToggle: number;
  counter: Ls76Counter;
  /** Perceived brightness per digit (index = digit select), 0..1 of full duty. */
  glow: [number, number, number, number];
}

export function newMuxState(): MuxState {
  return { out: 1, untilToggle: 0, counter: new Ls76Counter(), glow: [0, 0, 0, 0] };
}

/**
 * Advance the multiplexer by dtMs at the given 555 timing. Returns the
 * fraction of the interval each digit was enabled. Above `maxEdges` edges per
 * call it assumes an even 1/4 duty (the eye cannot tell the difference).
 */
export function advanceMux(st: MuxState, dtMs: number, timing: Pick<Astable, 'tHigh' | 'tLow'>, tauMs = 30, maxEdges = 4000): number[] {
  const lit = [0, 0, 0, 0];
  let t = dtMs / 1000;
  const total = t;
  let edges = 0;
  const half = st.out ? timing.tHigh : timing.tLow;
  // If the timing capacitor was just made smaller (a faster clock), the 555
  // reaches its threshold within one new half-period, not after the old one.
  if (st.untilToggle <= 0 || st.untilToggle > half) st.untilToggle = half;
  while (t > 0) {
    if (edges > maxEdges) {
      for (let i = 0; i < 4; i++) lit[i] += t / 4;
      break;
    }
    const step = Math.min(t, st.untilToggle);
    lit[st.counter.select] += step;
    t -= step;
    st.untilToggle -= step;
    if (st.untilToggle <= 1e-12) {
      edges++;
      if (st.out === 1) {
        st.out = 0;
        st.counter.clockFall();
        st.untilToggle = timing.tLow;
      } else {
        st.out = 1;
        st.untilToggle = timing.tHigh;
      }
    }
  }
  const frac = lit.map((x) => (total > 0 ? x / total : 0));
  for (let i = 0; i < 4; i++) st.glow[i] = persist(st.glow[i], frac[i], dtMs, tauMs);
  return frac;
}
