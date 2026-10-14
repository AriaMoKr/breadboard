/**
 * Pure models for the "Arithmetic" labs (videos 14-18): signed number
 * encodings, the 74LS283 adder and the 74LS86 XOR inverter, a gate-level
 * full adder, and the miswired ALU from "Troubleshooting the ALU".
 *
 * No DOM access, so everything here is unit-tested in node.
 */
import { Circuit, isKnown, type Component, type Level, type Net } from '../../logic/circuit';

export const mask = (n: number) => (n >= 32 ? 0xffffffff : (1 << n) - 1);
export const bitOf = (v: number, i: number): 0 | 1 => ((v >> i) & 1) as 0 | 1;
export const toBin = (v: number, n: number) => (v & mask(n)).toString(2).padStart(n, '0');
/** Binary with a space between nibbles ("0010 1010"). */
export const toBinSpaced = (v: number, n: number) => toBin(v, n).replace(/(.{4})(?=.)/g, '$1 ');

// ---------------------------------------------------------------------------
// Video 14: signed encodings

export type Encoding = 'unsigned' | 'sign-magnitude' | 'ones' | 'twos';

export const ENCODINGS: { id: Encoding; title: string; short: string }[] = [
  { id: 'unsigned', title: 'Unsigned', short: 'unsigned' },
  { id: 'sign-magnitude', title: 'Sign bit + magnitude', short: 'sign-mag' },
  { id: 'ones', title: "Ones' complement", short: "ones'" },
  { id: 'twos', title: "Two's complement", short: "two's" },
];

export interface Decoded {
  value: number;
  /** True for the "negative zero" patterns of sign-magnitude / ones' complement. */
  negativeZero: boolean;
}

/** Interpret an n-bit pattern in one of the encodings. */
export function decode(bits: number, enc: Encoding, n: number): Decoded {
  const m = mask(n);
  const b = bits & m;
  const msb = 1 << (n - 1);
  const neg = (b & msb) !== 0;
  switch (enc) {
    case 'unsigned':
      return { value: b, negativeZero: false };
    case 'sign-magnitude': {
      const mag = b & (msb - 1);
      return { value: neg ? -mag : mag, negativeZero: neg && mag === 0 };
    }
    case 'ones': {
      const mag = neg ? ~b & m : b;
      return { value: neg ? -mag : mag, negativeZero: neg && mag === 0 };
    }
    case 'twos':
      return { value: neg ? b - (1 << n) : b, negativeZero: false };
  }
}

/** The range an encoding can represent with n bits. */
export function encodingRange(enc: Encoding, n: number): [number, number] {
  const half = 1 << (n - 1);
  switch (enc) {
    case 'unsigned': return [0, (1 << n) - 1];
    case 'sign-magnitude':
    case 'ones': return [-(half - 1), half - 1];
    case 'twos': return [-half, half - 1];
  }
}

/** Encode a number, or null if it doesn't fit. */
export function encode(value: number, enc: Encoding, n: number): number | null {
  const [lo, hi] = encodingRange(enc, n);
  if (!Number.isInteger(value) || value < lo || value > hi) return null;
  const m = mask(n);
  switch (enc) {
    case 'unsigned': return value;
    case 'sign-magnitude': return value < 0 ? (1 << (n - 1)) | -value : value;
    case 'ones': return value < 0 ? ~-value & m : value;
    case 'twos': return value & m;
  }
}

/** Number of bit patterns that mean zero (2 for sign-magnitude and ones' complement). */
export function zeroPatterns(enc: Encoding, n: number): number[] {
  const out: number[] = [];
  for (let b = 0; b <= mask(n); b++) if (decode(b, enc, n).value === 0) out.push(b);
  return out;
}

/** Place values of a two's-complement number, MSB first: [-128, 64, ..., 1]. */
export function twosWeights(n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const bit = n - 1 - i;
    return bit === n - 1 ? -(1 << bit) : 1 << bit;
  });
}

/** Two's-complement negation as Ben does it: invert every bit, then add 1. */
export function negateTwos(bits: number, n: number): { inverted: number; result: number; carryOut: 0 | 1 } {
  const m = mask(n);
  const inverted = ~bits & m;
  const sum = inverted + 1;
  return { inverted, result: sum & m, carryOut: sum > m ? 1 : 0 };
}

export interface AddResult {
  sum: number;
  carryOut: 0 | 1;
  /** Bit i = carry INTO bit i (bit 0 = carry-in). Bit n = carry out. */
  carries: number;
  /** Two's-complement overflow: both operands have the same sign and the result's sign differs. */
  overflow: boolean;
}

/** Plain n-bit binary addition, exactly what the 74LS283s do. */
export function addBinary(a: number, b: number, n: number, cin: 0 | 1 = 0): AddResult {
  const m = mask(n);
  a &= m;
  b &= m;
  let carry: number = cin;
  let carries = cin;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = bitOf(a, i), y = bitOf(b, i);
    sum |= (x ^ y ^ carry) << i;
    carry = (x & y) | (x & carry) | (y & carry);
    carries |= carry << (i + 1);
  }
  const msb = 1 << (n - 1);
  const overflow = (a & msb) === (b & msb) && (sum & msb) !== (a & msb);
  return { sum, carryOut: carry as 0 | 1, carries, overflow };
}

/** Add two signed values in a given encoding with a plain adder (carry out discarded), and judge the result. */
export function signedAddDemo(x: number, y: number, enc: Exclude<Encoding, 'unsigned'>, n: number) {
  const a = encode(x, enc, n);
  const b = encode(y, enc, n);
  if (a === null || b === null) return null;
  const add = addBinary(a, b, n);
  const got = decode(add.sum, enc, n);
  const [lo, hi] = encodingRange(enc, n);
  const exact = x + y;
  const representable = exact >= lo && exact <= hi;
  return { a, b, add, got, exact, representable, correct: representable && got.value === exact };
}

// ---------------------------------------------------------------------------
// 74LS283 4-bit adder and the 8-bit ALU (video 15)

/** 74LS283 pin numbers (eater.net ALU schematic). */
export const LS283_PINS = { A: [5, 3, 14, 12], B: [6, 2, 15, 11], S: [4, 1, 13, 10], C0: 7, C4: 9, GND: 8, VCC: 16 } as const;
/** 74LS86 quad XOR: gate k has inputs (A, B) and output Y. */
export const LS86_PINS = [
  { a: 1, b: 2, y: 3 },
  { a: 4, b: 5, y: 6 },
  { a: 9, b: 10, y: 8 },
  { a: 12, b: 13, y: 11 },
] as const;

/** One 74LS283: 4-bit sum with carry in and carry out. */
export function ls283(a: number, b: number, c0: 0 | 1): { s: number; c4: 0 | 1 } {
  const t = (a & 15) + (b & 15) + c0;
  return { s: t & 15, c4: (t >> 4) as 0 | 1 };
}

export interface Ls283Pins {
  a: Net[]; // A1..A4 (LSB first)
  b: Net[];
  c0: Net;
  s: Net[]; // Σ1..Σ4
  c4: Net;
  name?: string;
}

/** A 74LS283 as a circuit component (internal carry look-ahead: one block delay). */
export function addLs283(c: Circuit, p: Ls283Pins, delay = 2): Component {
  return c.add({
    kind: '74LS283',
    name: p.name,
    inputs: [...p.a, ...p.b, p.c0],
    outputs: [...p.s, p.c4],
    delay,
    evaluate: (ins) => {
      if (!ins.every(isKnown)) return [...p.s.map(() => 'X' as Level), 'X'];
      const num = (xs: Level[]) => xs.reduce<number>((acc, l, i) => acc | ((l as number) << i), 0);
      const r = ls283(num(ins.slice(0, 4)), num(ins.slice(4, 8)), ins[8] as 0 | 1);
      return [bitOf(r.s, 0), bitOf(r.s, 1), bitOf(r.s, 2), bitOf(r.s, 3), r.c4];
    },
  });
}

export interface AluDetail {
  /** B after the 74LS86 XOR gates (= B, or NOT B when SU = 1). */
  bx: number;
  low: { s: number; c4: 0 | 1 };
  high: { s: number; c4: 0 | 1 };
  value: number;
  carry: 0 | 1;
  zero: boolean;
}

/** Ben's ALU: Σ = A + (B XOR SU) + SU, carry chained from the low to the high 74LS283. */
export function aluDetail(a: number, b: number, su: boolean): AluDetail {
  const bx = (b ^ (su ? 0xff : 0)) & 0xff;
  const low = ls283(a & 15, bx & 15, su ? 1 : 0);
  const high = ls283((a >> 4) & 15, bx >> 4, low.c4);
  const value = (high.s << 4) | low.s;
  return { bx, low, high, value, carry: high.c4, zero: value === 0 };
}

export const toSigned = (v: number, n = 8) => (v & (1 << (n - 1)) ? (v & mask(n)) - (1 << n) : v & mask(n));

/**
 * Video 18 "what if": with EO + AI asserted, an edge-triggered A register
 * takes the ALU result once per clock. If A were a transparent latch, it
 * would keep re-loading A ± B for as long as the clock is high, once per
 * propagation delay. Returns the successive values of A.
 */
export function latchRace(a: number, b: number, su: boolean, rounds: number): number[] {
  const out: number[] = [];
  let x = a & 0xff;
  for (let i = 0; i < rounds; i++) {
    x = aluDetail(x, b, su).value;
    out.push(x);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Video 16: a full adder from gates

export function fullAdder(a: 0 | 1, b: 0 | 1, cin: 0 | 1): { s: 0 | 1; cout: 0 | 1; p: 0 | 1; g: 0 | 1 } {
  const p = (a ^ b) as 0 | 1; // XOR 1 ("propagate")
  const g = (a & b) as 0 | 1; // AND 1 ("generate")
  const s = (p ^ cin) as 0 | 1; // XOR 2
  const cout = (g | (p & cin)) as 0 | 1; // AND 2 + OR
  return { s, cout, p, g };
}

/** Rows of the full-adder truth table in Ben's order (A, B, Cin binary count). */
export const FULL_ADDER_ROWS = Array.from({ length: 8 }, (_, i) => {
  const a = ((i >> 2) & 1) as 0 | 1, b = ((i >> 1) & 1) as 0 | 1, cin = (i & 1) as 0 | 1;
  return { a, b, cin, ...fullAdder(a, b, cin) };
});

/**
 * Gate delays until the carry out of an n-bit ripple-carry adder built from
 * the full adder above is valid after an A/B input change (unit gate
 * delays): 1 for the first XOR, then 2 per bit (AND + OR) along the chain.
 */
export function rippleWorstCaseDelays(n: number): number {
  return 1 + 2 * n;
}

// ---------------------------------------------------------------------------
// Video 17: the miswired ALU

export type Side = 'a' | 'b';

/**
 * What a jumper on an adder (A side) or XOR (B side) input is connected to.
 * 'reg' = a register output bit, 'open' = nothing (an LS-TTL input then
 * floats HIGH), 'gnd' = shorted to ground.
 */
export type WireSource = { kind: 'reg'; bit: number } | { kind: 'open' } | { kind: 'gnd' };

export interface AluWiring {
  /** a[i] feeds 74LS283 input A(i). */
  a: WireSource[];
  /** b[i] feeds the 74LS86 XOR that produces adder input B(i). */
  b: WireSource[];
}

export type Fault =
  /** The jumper for input `bit` comes from register bit `source` (off by one row on the breadboard). */
  | { kind: 'misplaced'; side: Side; bit: number; source: number }
  /** Two jumpers swapped. */
  | { kind: 'swap'; side: Side; bits: [number, number] }
  /** Jumper missing: the input floats high. */
  | { kind: 'open'; side: Side; bit: number }
  /** Input shorted to ground (stuck at 0). */
  | { kind: 'stuck0'; side: Side; bit: number };

export const wireId = (side: Side, bit: number) => `${side.toUpperCase()}${bit}`;

export function correctWiring(): AluWiring {
  const w = (): WireSource[] => Array.from({ length: 8 }, (_, bit) => ({ kind: 'reg', bit }));
  return { a: w(), b: w() };
}

export function applyFaults(faults: readonly Fault[], base: AluWiring = correctWiring()): AluWiring {
  const w: AluWiring = { a: [...base.a], b: [...base.b] };
  for (const f of faults) {
    const arr = w[f.side];
    switch (f.kind) {
      case 'misplaced': arr[f.bit] = { kind: 'reg', bit: f.source }; break;
      case 'swap': {
        const [i, j] = f.bits;
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
        break;
      }
      case 'open': arr[f.bit] = { kind: 'open' }; break;
      case 'stuck0': arr[f.bit] = { kind: 'gnd' }; break;
    }
  }
  return w;
}

/**
 * The faults Ben actually found in "Troubleshooting the ALU": the adder's
 * A bit-3 input was jumpered one row off (from A register bit 2), and B
 * bits 3 and 4 (counting from 1, i.e. bits 2 and 3) were swapped. With these,
 * A = 0, B = 8 shows 4, exactly the symptom in the video.
 */
export const BEN_FAULTS: Fault[] = [
  { kind: 'misplaced', side: 'a', bit: 3, source: 2 },
  { kind: 'swap', side: 'b', bits: [2, 3] },
];

const srcLevel = (s: WireSource, reg: number): 0 | 1 => (s.kind === 'reg' ? bitOf(reg, s.bit) : s.kind === 'gnd' ? 0 : 1);

export interface FaultyAluResult {
  /** What actually reaches the adder's A inputs. */
  adderA: number;
  /** What reaches the XOR inputs (before inversion). */
  xorIn: number;
  /** Adder B inputs (after XOR). */
  adderB: number;
  value: number;
  carry: 0 | 1;
  expected: number;
  expectedCarry: 0 | 1;
  ok: boolean;
}

export function evalWiring(w: AluWiring, a: number, b: number, su: boolean): FaultyAluResult {
  let adderA = 0, xorIn = 0;
  for (let i = 0; i < 8; i++) {
    adderA |= srcLevel(w.a[i], a) << i;
    xorIn |= srcLevel(w.b[i], b) << i;
  }
  const adderB = (xorIn ^ (su ? 0xff : 0)) & 0xff;
  const t = adderA + adderB + (su ? 1 : 0);
  const exp = aluDetail(a, b, su);
  return { adderA, xorIn, adderB, value: t & 0xff, carry: (t >> 8) as 0 | 1, expected: exp.value, expectedCarry: exp.carry, ok: (t & 0xff) === exp.value };
}

// ---------------------------------------------------------------------------
// Video 16: building the ALU step by step

export type AluBuildStep = 'power' | 'a' | 'out245' | 'carry' | 'b' | 'su' | 'ctl245' | 'leds';

/** Ben's build order in "Building the ALU". */
export const ALU_BUILD_STEPS: { id: AluBuildStep; title: string; detail: string }[] = [
  { id: 'power', title: 'Place the chips and wire power', detail: '2× 74LS283, 2× 74LS86 and a 74LS245 between the A and B registers; VCC and GND to every chip.' },
  { id: 'a', title: 'A register → adder A inputs', detail: 'A0-A3 to U21 A1-A4 (pins 5, 3, 14, 12), A4-A7 to the same pins of U20.' },
  { id: 'out245', title: 'Adder outputs → 74LS245', detail: 'Σ1-Σ4 (pins 4, 1, 13, 10) of both adders to the A side of the 245.' },
  { id: 'carry', title: 'Low carry out → high carry in', detail: 'U21 C4 (pin 9) to U20 C0 (pin 7).' },
  { id: 'b', title: 'B register → XOR gates → adder B inputs', detail: 'Each B bit into one input of a 74LS86 XOR; each XOR output to B1-B4 (pins 6, 2, 15, 11).' },
  { id: 'su', title: 'SU → the other XOR inputs and U21 carry in', detail: 'One control line to all 8 XOR gates and to U21 C0 (pin 7).' },
  { id: 'ctl245', title: '74LS245 control pins', detail: 'DIR (pin 1) to +5 V, ~OE (pin 19) to ~EO.' },
  { id: 'leds', title: 'LEDs on the sum', detail: '8 LEDs (with resistors) on the adder outputs, so the result is visible.' },
];

export interface AluBuildState {
  powered: boolean;
  /** Levels the adder A pins see (unwired inputs float high). */
  adderA: number;
  /** Levels on the XOR inputs from the B register. */
  xorIn: number;
  /** Level on the XOR control inputs (SU, or floating = 1). */
  xorCtl: 0 | 1;
  /** Levels the adder B pins see. */
  adderB: number;
  /** Carry in of U21 and U20. */
  c0Low: 0 | 1;
  c0High: 0 | 1;
  /** Σ outputs of the two adders and the final carry out. */
  value: number;
  carry: 0 | 1;
  /** The sum LEDs are wired (otherwise only a logic probe sees the result). */
  leds: boolean;
  /** What the 245 drives onto the bus, or null for high-Z. */
  busOut: number | null;
  /** What a correctly built ALU would show. */
  expected: number;
  /** Inputs that are still floating (and so read 1). */
  floating: string[];
}

/**
 * The half-built ALU of video 16 after the steps in `built`. Unconnected
 * LS-TTL inputs float high: unwired A or B inputs read 1111 1111, an
 * unwired SU acts like SU = 1 (invert B, carry in 1), and an unwired U20 C0
 * adds 16. `wiring` lets the build include Ben's two jumper mistakes.
 */
export function aluBuildState(a: number, b: number, su: boolean, eo: boolean, built: ReadonlySet<AluBuildStep>, wiring: AluWiring = correctWiring()): AluBuildState {
  const has = (s: AluBuildStep) => built.has(s);
  const expected = aluDetail(a, b, su).value;
  const floating: string[] = [];
  if (!has('power')) return { powered: false, adderA: 0, xorIn: 0, xorCtl: 0, adderB: 0, c0Low: 0, c0High: 0, value: 0, carry: 0, leds: has('leds'), busOut: null, expected, floating };
  let adderA = 0xff, xorIn = 0xff;
  if (has('a')) {
    adderA = 0;
    for (let i = 0; i < 8; i++) adderA |= srcLevel(wiring.a[i], a) << i;
  } else floating.push('the adder A inputs');
  if (has('b')) {
    xorIn = 0;
    for (let i = 0; i < 8; i++) xorIn |= srcLevel(wiring.b[i], b) << i;
  } else floating.push('the adder B inputs');
  const ctl: 0 | 1 = has('su') ? (su ? 1 : 0) : 1;
  if (!has('su')) floating.push(has('b') ? 'SU (the XOR control inputs and U21 C0)' : 'U21 C0 (SU)');
  const adderB = has('b') ? (xorIn ^ (ctl ? 0xff : 0)) & 0xff : 0xff;
  const low = ls283(adderA & 15, adderB & 15, ctl);
  const c0High: 0 | 1 = has('carry') ? low.c4 : 1;
  if (!has('carry')) floating.push('U20 C0 (the carry between the chips)');
  const high = ls283(adderA >> 4, adderB >> 4, c0High);
  const value = (high.s << 4) | low.s;
  // the 245 drives the bus only once ~OE is wired to ~EO; its A side floats high until the sums are wired to it
  const busOut = has('ctl245') && eo ? (has('out245') ? value : 0xff) : null;
  return { powered: true, adderA, xorIn: has('b') ? xorIn : 0xff, xorCtl: ctl, adderB, c0Low: ctl, c0High, value, carry: high.c4, leds: has('leds'), busOut, expected, floating };
}

export function isCorrect(src: WireSource, bit: number) {
  return src.kind === 'reg' && src.bit === bit;
}

/** Wires (e.g. "A3", "B2") that are not connected the way the schematic says. */
export function wrongWires(w: AluWiring): string[] {
  const out: string[] = [];
  (['a', 'b'] as Side[]).forEach((side) => w[side].forEach((s, i) => !isCorrect(s, i) && out.push(wireId(side, i))));
  return out;
}

/** Re-seat one jumper where the schematic says it should go. */
export function fixWire(w: AluWiring, side: Side, bit: number): AluWiring {
  const next: AluWiring = { a: [...w.a], b: [...w.b] };
  next[side][bit] = { kind: 'reg', bit };
  return next;
}

export function describeSource(s: WireSource): string {
  return s.kind === 'reg' ? `register bit ${s.bit}` : s.kind === 'open' ? 'nothing (the wire is missing, so the input floats high)' : 'ground (a short)';
}

/** Random faults for the practice mode. `rng` returns [0, 1). */
export function randomFaults(rng: () => number, count = 2): Fault[] {
  const faults: Fault[] = [];
  const used = new Set<string>();
  const pickSide = (): Side => (rng() < 0.5 ? 'a' : 'b');
  let guard = 0;
  while (faults.length < count && guard++ < 100) {
    const side = pickSide();
    const kind = Math.floor(rng() * 4);
    const bit = Math.floor(rng() * 8);
    let f: Fault;
    let bits: number[];
    if (kind === 0) {
      const source = bit === 0 ? 1 : bit === 7 ? 6 : bit + (rng() < 0.5 ? -1 : 1);
      f = { kind: 'misplaced', side, bit, source };
      bits = [bit];
    } else if (kind === 1) {
      const j = bit === 7 ? 6 : bit + 1;
      f = { kind: 'swap', side, bits: [Math.min(bit, j), Math.max(bit, j)] };
      bits = [bit, j];
    } else if (kind === 2) {
      f = { kind: 'open', side, bit };
      bits = [bit];
    } else {
      f = { kind: 'stuck0', side, bit };
      bits = [bit];
    }
    if (bits.some((x) => used.has(wireId(side, x)))) continue;
    bits.forEach((x) => used.add(wireId(side, x)));
    faults.push(f);
  }
  return faults;
}

export interface AluTest {
  a: number;
  b: number;
  su: boolean;
  got: number;
  expected: number;
  ok: boolean;
}

/** Classify a test the way Ben's isolation strategy does. */
export function testKind(t: { a: number; b: number; su: boolean }): { kind: 'zero' | 'a-bit' | 'b-bit' | 'other'; bit?: number } {
  const single = (v: number) => (v !== 0 && (v & (v - 1)) === 0 ? Math.log2(v) : -1);
  if (t.a === 0 && t.b === 0) return { kind: 'zero' };
  if (!t.su && t.b === 0 && single(t.a) >= 0) return { kind: 'a-bit', bit: single(t.a) };
  if (!t.su && t.a === 0 && single(t.b) >= 0) return { kind: 'b-bit', bit: single(t.b) };
  return { kind: 'other' };
}

/**
 * Next hint for the isolation strategy, based on the tests done so far:
 * A = B = 0 first (add and subtract), then A alone one bit at a time, then
 * B alone, then inspect the wires of the failing bits.
 */
export function nextHint(tests: readonly AluTest[], fixedAll: boolean): string {
  const zeroAdd = tests.find((t) => t.a === 0 && t.b === 0 && !t.su);
  const zeroSub = tests.find((t) => t.a === 0 && t.b === 0 && t.su);
  if (fixedAll) return 'All the jumpers now match the schematic. Confirm with Ben’s final checks: 2 + 6 = 8 and 6 − 2 = 4.';
  if (!zeroAdd) return 'Start where the answer is obvious: set A = 0 and B = 0 with SU off. The sum must be 0.';
  if (!zeroAdd.ok) return `Even 0 + 0 gives ${zeroAdd.got}. Some input is reading 1 with nothing driving it: a missing wire floats high on LS-TTL. The 1 bits point at the wire.`;
  if (!zeroSub) return 'Now 0 − 0 (SU on): 0 + 11111111 + 1 should be 0 with the carry out set.';
  const aBits = new Map<number, AluTest>();
  const bBits = new Map<number, AluTest>();
  for (const t of tests) {
    const k = testKind(t);
    if (k.kind === 'a-bit') aBits.set(k.bit!, t);
    if (k.kind === 'b-bit') bBits.set(k.bit!, t);
  }
  const missingA = [...Array(8).keys()].filter((i) => !aBits.has(i));
  if (missingA.length) return `Test A on its own: keep B = 0 and SU off, and set one A bit at a time (1, 2, 4, … 128). The sum should equal A. Still to try: A bit${missingA.length > 1 ? 's' : ''} ${missingA.join(', ')}.`;
  const missingB = [...Array(8).keys()].filter((i) => !bBits.has(i));
  if (missingB.length) return `Now B on its own: A = 0, one B bit at a time. Still to try: B bit${missingB.length > 1 ? 's' : ''} ${missingB.join(', ')}.`;
  const badA = [...aBits].filter(([, t]) => !t.ok).map(([i]) => i);
  const badB = [...bBits].filter(([, t]) => !t.ok).map(([i]) => i);
  if (badA.length || badB.length) {
    const parts = [...badA.map((i) => `A${i}`), ...badB.map((i) => `B${i}`)];
    return `The single-bit tests point at ${parts.join(', ')}. Compare what came out with what went in: a bit that shows up in the wrong place means a jumper in the wrong row. Inspect those wires below.`;
  }
  return 'Every single-bit test passes. Try a few mixed values, or inspect the wires you still suspect.';
}

// ---------------------------------------------------------------------------
// Circuits used by the labs (built here so the tests exercise the same nets)

/** Video 16: four gate-level full adders chained ripple-carry style (bit 0 first). */
export function buildRippleAdder4(a: number[] = [1, 1, 0, 0], b: number[] = [1, 0, 1, 0], c: Circuit = new Circuit()) {
  const A = a.map((v, i) => c.input(`A${i}`, (v & 1) as 0 | 1));
  const B = b.map((v, i) => c.input(`B${i}`, (v & 1) as 0 | 1));
  const CIN = c.input('Cin', 0);
  const C: Net[] = [CIN];
  const P: Net[] = [], G: Net[] = [], T: Net[] = [], S: Net[] = [];
  for (let i = 0; i < 4; i++) {
    P.push(c.net(`A${i}⊕B${i}`, 0));
    G.push(c.net(`A${i}·B${i}`, 0));
    S.push(c.net(`S${i}`, 0));
    T.push(c.net(`P${i}·C${i}`, 0));
    C.push(c.net(i === 3 ? 'Cout' : `C${i + 1}`, 0));
    c.xor([A[i], B[i]], P[i]); //  XOR 1
    c.and([A[i], B[i]], G[i]); //  AND 1
    c.xor([P[i], C[i]], S[i]); //  XOR 2 -> sum
    c.and([P[i], C[i]], T[i]); //  AND 2
    c.or([T[i], G[i]], C[i + 1]); // OR -> carry out
  }
  c.settle();
  return { c, A, B, CIN, C, P, G, T, S };
}

/** Video 15: 8 XOR gates (2× 74LS86) on B, two 74LS283 with U21 C4 → U20 C0, C0 of U21 = SU. */
export function buildAlu8(a = 9, b = 5, c: Circuit = new Circuit()) {
  const A = Array.from({ length: 8 }, (_, i) => c.input(`A${i}`, bitOf(a, i)));
  const B = Array.from({ length: 8 }, (_, i) => c.input(`B${i}`, bitOf(b, i)));
  const SU = c.input('SU', 0);
  const BX = Array.from({ length: 8 }, (_, i) => c.net(`B${i}⊕SU`, 0));
  B.forEach((bn, i) => c.xor([bn, SU], BX[i]));
  const S = Array.from({ length: 8 }, (_, i) => c.net(`Σ${i}`, 0));
  const C4L = c.net('U21 C4', 0);
  const COUT = c.net('carry out', 0);
  addLs283(c, { a: A.slice(0, 4), b: BX.slice(0, 4), c0: SU, s: S.slice(0, 4), c4: C4L, name: 'U21' });
  addLs283(c, { a: A.slice(4), b: BX.slice(4), c0: C4L, s: S.slice(4), c4: COUT, name: 'U20' });
  c.settle();
  return { c, A, B, SU, BX, S, C4L, COUT };
}

/** Read nets (LSB first) as a number; anything but 1 reads as 0. */
export const netsValue = (nets: readonly Net[]) => nets.reduce((acc, n, i) => acc | (n.value === 1 ? 1 << i : 0), 0);
