import { beforeAll, describe, expect, it } from 'vitest';
import type { Lab } from '../src/labs/types';
import { LAB_IDS as CHAPTER_LAB_IDS } from '../src/app/chapters';
import { ALU_BUILD_STEPS, aluBuildState, type AluBuildStep } from '../src/labs/alu/_model';
import { Circuit, type Level } from '../src/logic/circuit';
import { Computer, computeAlu } from '../src/sim/computer';
import { AI, IO } from '../src/sim/signals';
import {
  BUS_MODULES,
  addDff,
  addLs173,
  addLs245,
  buildARegister,
  buildOneBitRegister,
  busControlWord,
  busModuleOutput,
  clockBus,
  dffNext,
  joinOutputs,
  ls173,
  ls173Value,
  ls245,
  outputStage,
  resolveBus,
  triState,
  type BusValues,
} from '../src/labs/registers/_model';
import {
  BEN_FAULTS,
  FULL_ADDER_ROWS,
  addBinary,
  addLs283,
  aluDetail,
  applyFaults,
  buildAlu8,
  buildRippleAdder4,
  correctWiring,
  decode,
  encode,
  encodingRange,
  evalWiring,
  fixWire,
  fullAdder,
  latchRace,
  ls283,
  negateTwos,
  netsValue,
  nextHint,
  randomFaults,
  rippleWorstCaseDelays,
  signedAddDemo,
  testKind,
  toSigned,
  twosWeights,
  wrongWires,
  zeroPatterns,
  type AluTest,
  type AluWiring,
  type Encoding,
} from '../src/labs/alu/_model';

const L = (...xs: Level[]) => xs;

// ===========================================================================
// Registers & bus
// ===========================================================================

describe('74LS74 D flip-flop', () => {
  it('takes D only on a rising clock edge', () => {
    expect(dffNext(0, 0, { d: 1, clk: 1 })).toBe(1); // rising edge
    expect(dffNext(0, 1, { d: 1, clk: 1 })).toBe(0); // clock high, no edge
    expect(dffNext(1, 1, { d: 0, clk: 0 })).toBe(1); // falling edge
    expect(dffNext(1, 0, { d: 0, clk: 0 })).toBe(1); // clock low
  });
  it('~PRE and ~CLR are asynchronous and active low', () => {
    expect(dffNext(0, 0, { d: 0, clk: 0, pre: 0 })).toBe(1);
    expect(dffNext(1, 1, { d: 1, clk: 1, clr: 0 })).toBe(0);
  });
  it('works as a circuit component', () => {
    const c = new Circuit();
    const D = c.input('D', 1), CLK = c.input('CLK', 0);
    const Q = c.net('Q', 0), QN = c.net('QN', 1);
    addDff(c, { d: D, clk: CLK, q: Q, qn: QN });
    c.settle();
    expect(Q.value).toBe(0);
    c.set(CLK, 1); c.settle();
    expect([Q.value, QN.value]).toEqual([1, 0]);
    c.set(D, 0); c.settle();
    expect(Q.value).toBe(1); // D changes while CLK is high: ignored
    c.set(CLK, 0); c.settle();
    expect(Q.value).toBe(1);
  });
});

describe('74LS173', () => {
  const base = { m: 0 as Level, n: 0 as Level, d: L(1, 0, 1, 1), g1: 0 as Level, g2: 0 as Level, clk: 1 as Level, clr: 0 as Level };
  it('loads on the rising edge only when both data enables are low', () => {
    expect(ls173([0, 0, 0, 0], 0, base).stored).toEqual([1, 0, 1, 1]);
    expect(ls173([0, 0, 0, 0], 0, { ...base, g1: 1 }).stored).toEqual([0, 0, 0, 0]);
    expect(ls173([0, 0, 0, 0], 0, { ...base, g2: 1 }).stored).toEqual([0, 0, 0, 0]);
    // no edge: clock already high, or falling, or low
    expect(ls173([0, 0, 0, 0], 1, base).stored).toEqual([0, 0, 0, 0]);
    expect(ls173([0, 0, 0, 0], 1, { ...base, clk: 0 }).stored).toEqual([0, 0, 0, 0]);
    expect(ls173([0, 0, 0, 0], 0, { ...base, clk: 0 }).stored).toEqual([0, 0, 0, 0]);
  });
  it('CLR is asynchronous (no clock needed) and overrides a load', () => {
    expect(ls173([1, 1, 1, 1], 0, { ...base, clk: 0, clr: 1 }).stored).toEqual([0, 0, 0, 0]);
    expect(ls173([1, 1, 1, 1], 0, { ...base, clr: 1 }).stored).toEqual([0, 0, 0, 0]);
  });
  it('M or N high puts the outputs in high-Z but keeps the data', () => {
    const r = ls173([1, 0, 1, 0], 1, { ...base, m: 1 });
    expect(r.out).toEqual(['Z', 'Z', 'Z', 'Z']);
    expect(r.stored).toEqual([1, 0, 1, 0]);
    expect(ls173([1, 0, 1, 0], 1, { ...base, n: 1 }).out).toEqual(['Z', 'Z', 'Z', 'Z']);
    expect(ls173([1, 0, 1, 0], 1, base).out).toEqual([1, 0, 1, 0]);
  });
  it('floating D inputs load as 1 (LS-TTL)', () => {
    expect(ls173([0, 0, 0, 0], 0, { ...base, d: L('Z', 'Z', 0, 'Z') }).stored).toEqual([1, 1, 0, 1]);
  });
  it('as a circuit component: edge-triggered load, async clear', () => {
    const c = new Circuit();
    const GND = c.input('GND', 0);
    const d = [1, 1, 0, 1].map((v, i) => c.input(`D${i}`, v as 0 | 1));
    const G = c.input('G', 1), CLK = c.input('CLK', 0), CLR = c.input('CLR', 0);
    const q = [0, 1, 2, 3].map((i) => c.net(`Q${i}`, 0));
    const u = addLs173(c, { m: GND, n: GND, d, g1: G, g2: G, clk: CLK, clr: CLR, q });
    c.settle();
    c.set(CLK, 1); c.settle(); c.set(CLK, 0); c.settle();
    expect(ls173Value(u)).toBe(0); // G high: ignored
    c.set(G, 0); c.settle();
    expect(ls173Value(u)).toBe(0); // enable alone does nothing
    c.set(CLK, 1); c.settle();
    expect(ls173Value(u)).toBe(0b1011);
    expect(q.map((n) => n.value)).toEqual([1, 1, 0, 1]);
    c.set(CLR, 1); c.settle();
    expect(ls173Value(u)).toBe(0);
    expect(q.map((n) => n.value)).toEqual([0, 0, 0, 0]);
  });
});

describe('74LS245', () => {
  it('drives B from A with DIR = 1, A from B with DIR = 0, neither with ~OE high', () => {
    expect(ls245(1, 0, L(1, 0), L('Z', 'Z'))).toEqual({ a: ['Z', 'Z'], b: [1, 0] });
    expect(ls245(0, 0, L(0, 0), L(1, 0))).toEqual({ a: [1, 0], b: ['Z', 'Z'] });
    expect(ls245(1, 1, L(1, 0), L(0, 1))).toEqual({ a: ['Z', 'Z'], b: ['Z', 'Z'] });
  });
  it('fights another driver when both are enabled (contention)', () => {
    const c = new Circuit();
    const a = [c.input('a0', 1)], b = [c.net('b0', 'Z')];
    const dir = c.input('DIR', 1), oe = c.input('OE', 0);
    const other = c.input('o', 0), en = c.input('en', 0);
    c.tri(other, en, b[0]);
    addLs245(c, { dir, oe, a, b });
    c.settle();
    expect(b[0].value).toBe(1);
    c.set(en, 1); c.settle();
    expect(b[0].value).toBe('X');
    c.set(oe, 1); c.settle();
    expect(b[0].value).toBe(0);
  });
});

describe('tri-state lab models', () => {
  it('totem-pole outputs short when they disagree', () => {
    expect(joinOutputs([outputStage(1), outputStage(0)])).toEqual({ level: 'X', short: true });
    expect(joinOutputs([outputStage(1), outputStage(1)])).toEqual({ level: 1, short: false });
    expect(joinOutputs([outputStage(1), outputStage(0, false)])).toEqual({ level: 1, short: false });
    expect(joinOutputs([outputStage(1, false), outputStage(0, false)])).toEqual({ level: 'Z', short: false });
    expect(outputStage(0, false)).toEqual({ top: false, bottom: false, out: 'Z' });
  });
  it('tri-state buffer truth table', () => {
    expect([triState(0, 0), triState(0, 1), triState(1, 0), triState(1, 1)]).toEqual(['Z', 'Z', 0, 1]);
  });
});

describe('1-bit register (video 11 circuit)', () => {
  const pulse = (r: ReturnType<typeof buildOneBitRegister>) => {
    r.c.set(r.CLK, 1); r.c.settle();
    r.c.set(r.CLK, 0); r.c.settle();
  };
  it('loads the bus only with LOAD high and holds across clocks otherwise', () => {
    const r = buildOneBitRegister();
    expect(r.Q.value).toBe(0);
    pulse(r); // LOAD low, bus = 1
    expect(r.Q.value).toBe(0);
    r.c.set(r.LOAD, 1); r.c.settle();
    expect(r.D.value).toBe(1);
    expect(r.Q.value).toBe(0); // not until the edge
    pulse(r);
    expect(r.Q.value).toBe(1);
    r.c.set(r.LOAD, 0); r.c.set(r.BUSIN, 0); r.c.settle();
    for (let i = 0; i < 5; i++) pulse(r);
    expect(r.Q.value).toBe(1); // held through 5 clocks
  });
  it('ENABLE drives Q onto the bus through the tri-state buffer', () => {
    const r = buildOneBitRegister();
    r.c.set(r.LOAD, 1); r.c.settle(); pulse(r); // Q = 1
    r.c.set(r.LOAD, 0);
    r.c.set(r.BUSDRV, 0); r.c.settle();
    expect(r.BUS.value).toBe('Z');
    r.c.set(r.EN, 1); r.c.settle();
    expect(r.BUS.value).toBe(1);
    r.c.set(r.BUSDRV, 1); r.c.set(r.BUSIN, 0); r.c.settle();
    expect(r.BUS.value).toBe('X'); // contention
  });
});

describe('8-bit A register (video 12 circuit)', () => {
  const pulse = (r: ReturnType<typeof buildARegister>) => {
    r.c.set(r.CLK, 1); r.c.settle();
    r.c.set(r.CLK, 0); r.c.settle();
  };
  it('loads the switches when ~AI is low and the clock rises', () => {
    const r = buildARegister(42);
    pulse(r);
    expect(r.value()).toBe(0); // ~AI high
    r.c.set(r.nAI, 0); r.c.settle();
    expect(r.value()).toBe(0);
    pulse(r);
    expect(r.value()).toBe(42);
    expect(r.q.map((n) => n.value)).toEqual([0, 1, 0, 1, 0, 1, 0, 0]);
  });
  it('an undriven bus loads 1111 1111 (floating TTL inputs)', () => {
    const r = buildARegister(42);
    r.c.set(r.swEn, 0); r.c.set(r.nAI, 0); r.c.settle();
    expect(r.bus.every((n) => n.value === 'Z')).toBe(true);
    pulse(r);
    expect(r.value()).toBe(255);
  });
  it('~AO puts the register on the bus through the 245; with the switches too it is contention', () => {
    const r = buildARegister(0b00001111);
    r.c.set(r.nAI, 0); r.c.settle(); pulse(r);
    r.c.set(r.nAI, 1); r.c.set(r.swEn, 0); r.c.set(r.nAO, 0); r.c.settle();
    expect(r.bus.map((n) => n.value)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    r.sw.forEach((s) => r.c.set(s, 0));
    r.c.set(r.swEn, 1); r.c.settle();
    expect(r.bus.slice(0, 4).every((n) => n.value === 'X')).toBe(true);
    expect(r.bus.slice(4).every((n) => n.value === 0)).toBe(true);
  });
  it('CLR clears without a clock', () => {
    const r = buildARegister(99);
    r.c.set(r.nAI, 0); r.c.settle(); pulse(r);
    expect(r.value()).toBe(99);
    r.c.set(r.CLR, 1); r.c.settle();
    expect(r.value()).toBe(0);
  });
});

describe('bus transfer model (video 9)', () => {
  const v: BusValues = { sw: 42, a: 7, b: 3, ir: 0x2f, out: 0 };
  it('one driver puts its value on the bus; IR only drives the low nibble; Σ = A + B', () => {
    expect(resolveBus(v, ['a'])).toMatchObject({ value: 7, contention: false, floating: false, drivers: ['a'] });
    expect(resolveBus(v, ['ir']).value).toBe(0x0f);
    expect(busModuleOutput('sum', v)).toBe(10);
    expect(busModuleOutput('sum', { ...v, a: 200, b: 100 })).toBe(44);
  });
  it('no driver floats (reads 1111 1111); two drivers contend on differing bits', () => {
    const f = resolveBus(v, []);
    expect(f.floating).toBe(true);
    expect(f.value).toBe(0xff);
    expect(f.levels.every((l) => l === 'Z')).toBe(true);
    const x = resolveBus(v, ['a', 'b']); // 0000 0111 vs 0000 0011
    expect(x.contention).toBe(true);
    expect(x.levels[2]).toBe('X');
    expect(x.levels[0]).toBe(1);
    expect(x.levels[7]).toBe(0);
    expect(x.value).toBe(3); // low wins
  });
  it('a clock pulse copies the bus into every module with its load enabled', () => {
    const r = clockBus(v, ['a'], ['b', 'out']);
    expect(r.values).toMatchObject({ a: 7, b: 7, out: 7 });
    expect(r.transfers.map((t) => t.to).sort()).toEqual(['b', 'out']);
    const acc = clockBus(v, ['sum'], ['a']);
    expect(acc.values.a).toBe(10);
    // modules without a load signal are ignored
    expect(clockBus(v, ['a'], ['sum', 'sw']).transfers).toEqual([]);
  });
  it('names the control word the way Ben does', () => {
    expect(busControlWord(['a'], ['b'])).toBe('AO BI');
    expect(busControlWord(['ir'], ['a'])).toBe('IO AI');
    expect(busControlWord(['sum'], ['a', 'out'])).toBe('AI EO OI');
    expect(busControlWord([], [])).toBe('—');
    expect(BUS_MODULES.find((m) => m.id === 'b')!.outSig).toBe('BO');
  });
});

// ===========================================================================
// Two's complement
// ===========================================================================

describe("two's complement and friends (video 14)", () => {
  it("Ben's −5 in 4 bits", () => {
    expect(encode(-5, 'sign-magnitude', 4)).toBe(0b1101);
    expect(encode(-5, 'ones', 4)).toBe(0b1010);
    expect(encode(-5, 'twos', 4)).toBe(0b1011);
    expect(decode(0b1011, 'twos', 4).value).toBe(-5);
    expect(decode(0b1000, 'twos', 4).value).toBe(-8);
    expect(decode(0b1111, 'twos', 4).value).toBe(-1);
    expect(decode(0b1100, 'twos', 4).value).toBe(-4);
    expect(twosWeights(4)).toEqual([-8, 4, 2, 1]);
    expect(twosWeights(8)).toEqual([-128, 64, 32, 16, 8, 4, 2, 1]);
  });
  it('encode/decode round-trip over each whole range', () => {
    for (const n of [4, 8])
      for (const enc of ['unsigned', 'sign-magnitude', 'ones', 'twos'] as Encoding[]) {
        const [lo, hi] = encodingRange(enc, n);
        for (let x = lo; x <= hi; x++) expect(decode(encode(x, enc, n)!, enc, n).value).toBe(x);
        expect(encode(hi + 1, enc, n)).toBeNull();
        expect(encode(lo - 1, enc, n)).toBeNull();
      }
  });
  it('the place-value sum equals the decoded value', () => {
    for (let b = 0; b < 256; b++) {
      const sum = twosWeights(8).reduce((acc, w, i) => acc + ((b >> (7 - i)) & 1) * w, 0);
      expect(sum).toBe(decode(b, 'twos', 8).value);
      expect(toSigned(b)).toBe(sum);
    }
  });
  it('only two’s complement has a single zero', () => {
    expect(zeroPatterns('twos', 8)).toEqual([0]);
    expect(zeroPatterns('sign-magnitude', 4)).toEqual([0b0000, 0b1000]);
    expect(zeroPatterns('ones', 4)).toEqual([0b0000, 0b1111]);
    expect(decode(0b1000, 'sign-magnitude', 4).negativeZero).toBe(true);
    expect(decode(0b1111, 'ones', 4).negativeZero).toBe(true);
  });
  it('negate = invert and add 1', () => {
    expect(negateTwos(0b0101, 4)).toEqual({ inverted: 0b1010, result: 0b1011, carryOut: 0 });
    expect(negateTwos(5, 8).result).toBe(251);
    expect(negateTwos(0, 8)).toEqual({ inverted: 255, result: 0, carryOut: 1 });
    expect(negateTwos(0x80, 8).result).toBe(0x80); // −128 has no positive partner
    for (let x = -127; x <= 127; x++) expect(decode(negateTwos(encode(x, 'twos', 8)!, 8).result, 'twos', 8).value).toBe(0 - x || 0);
  });
  it('a plain adder: carries, carry out and overflow', () => {
    const r = addBinary(5, encode(-3, 'twos', 8)!, 8);
    expect(r.sum).toBe(2);
    expect(r.carryOut).toBe(1);
    expect(r.overflow).toBe(false);
    const o = addBinary(127, 1, 8);
    expect(decode(o.sum, 'twos', 8).value).toBe(-128);
    expect(o.overflow).toBe(true);
    expect(o.carryOut).toBe(0);
    const o2 = addBinary(0x80, 0xff, 8); // −128 + −1
    expect(o2.overflow).toBe(true);
    expect(decode(o2.sum, 'twos', 8).value).toBe(127);
    expect(addBinary(0b0111, 0b0001, 4).carries).toBe(0b01110); // carries into bits 1, 2, 3
  });
  it('what Ben shows: sign bit and ones’ complement fail, two’s complement works', () => {
    const sm = signedAddDemo(5, -5, 'sign-magnitude', 4)!;
    expect(sm.add.sum).toBe(0b0010);
    expect(sm.correct).toBe(false);
    const oc = signedAddDemo(5, -5, 'ones', 4)!;
    expect(oc.add.sum).toBe(0b1111);
    expect(oc.got.negativeZero).toBe(true);
    const oc2 = signedAddDemo(6, -2, 'ones', 4)!;
    expect(oc2.got.value).toBe(3); // off by one
    expect(signedAddDemo(6, -2, 'twos', 4)!.add.sum).toBe(0b0100);
    expect(signedAddDemo(5, -5, 'twos', 4)!.correct).toBe(true);
    for (let x = -8; x <= 7; x++)
      for (let y = -8; y <= 7; y++) {
        const r = signedAddDemo(x, y, 'twos', 4)!;
        expect(r.correct).toBe(r.representable);
        expect(r.add.overflow).toBe(!r.representable);
      }
  });
});

// ===========================================================================
// ALU
// ===========================================================================

describe('74LS283 and the 8-bit ALU (video 15)', () => {
  it('ls283 adds two nibbles with carry in/out', () => {
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++)
        for (const c0 of [0, 1] as const) {
          const r = ls283(a, b, c0);
          expect(r.s + 16 * r.c4).toBe(a + b + c0);
        }
  });
  it('aluDetail matches the computer’s ALU for every A, B and SU', () => {
    for (let a = 0; a < 256; a++)
      for (let b = 0; b < 256; b++)
        for (const su of [false, true]) {
          const x = aluDetail(a, b, su), y = computeAlu(a, b, su);
          if (x.value !== y.value || x.carry !== y.carry) throw new Error(`${a} ${su ? '-' : '+'} ${b}`);
        }
    expect(aluDetail(6, 2, true)).toMatchObject({ value: 4, carry: 1, bx: 0b11111101 });
    expect(aluDetail(0, 1, true)).toMatchObject({ value: 255, carry: 0 });
  });
  it('the gate/chip-level ALU circuit agrees (XORs + chained 283s)', () => {
    const alu = buildAlu8(0, 0);
    const set = (a: number, b: number, su: boolean) => {
      alu.A.forEach((n, i) => alu.c.set(n, ((a >> i) & 1) as 0 | 1));
      alu.B.forEach((n, i) => alu.c.set(n, ((b >> i) & 1) as 0 | 1));
      alu.c.set(alu.SU, su ? 1 : 0);
      alu.c.settle();
    };
    for (const [a, b, su] of [[9, 5, false], [200, 100, false], [6, 2, true], [0, 1, true], [128, 128, false], [77, 200, true]] as const) {
      set(a, b, su);
      const exp = computeAlu(a, b, su);
      expect(netsValue(alu.S)).toBe(exp.value);
      expect(alu.COUT.value).toBe(exp.carry);
      expect(netsValue(alu.BX)).toBe(su ? ~b & 0xff : b);
    }
  });
  it('addLs283 as a component', () => {
    const c = new Circuit();
    const a = [1, 1, 1, 1].map((v, i) => c.input(`a${i}`, v as 0 | 1));
    const b = [1, 0, 0, 0].map((v, i) => c.input(`b${i}`, v as 0 | 1));
    const c0 = c.input('c0', 0);
    const s = [0, 1, 2, 3].map((i) => c.net(`s${i}`, 0));
    const c4 = c.net('c4', 0);
    addLs283(c, { a, b, c0, s, c4 });
    c.settle();
    expect(netsValue(s)).toBe(0);
    expect(c4.value).toBe(1);
  });
});

describe('full adder and ripple carry (video 16)', () => {
  it('truth table', () => {
    expect(FULL_ADDER_ROWS.map((r) => `${r.s}${r.cout}`)).toEqual(['00', '10', '10', '01', '10', '01', '01', '11']);
    for (const r of FULL_ADDER_ROWS) expect(r.s + 2 * r.cout).toBe(r.a + r.b + r.cin);
    expect(fullAdder(1, 1, 1)).toMatchObject({ s: 1, cout: 1 });
  });
  it('the 4-bit gate-level ripple adder adds correctly for all inputs', () => {
    const r = buildRippleAdder4([0, 0, 0, 0], [0, 0, 0, 0]);
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++)
        for (const cin of [0, 1] as const) {
          r.A.forEach((n, i) => r.c.set(n, ((a >> i) & 1) as 0 | 1));
          r.B.forEach((n, i) => r.c.set(n, ((b >> i) & 1) as 0 | 1));
          r.c.set(r.CIN, cin);
          const st = r.c.settle();
          expect(st.stable).toBe(true);
          expect(st.steps).toBeLessThanOrEqual(rippleWorstCaseDelays(4));
          expect(netsValue(r.S) + (r.C[4].value === 1 ? 16 : 0)).toBe(a + b + cin);
        }
  });
  it('a carry ripples through, two gate delays per bit', () => {
    const r = buildRippleAdder4([1, 1, 1, 1], [0, 0, 0, 0]);
    expect(netsValue(r.S)).toBe(15);
    r.c.set(r.CIN, 1);
    const seen: number[] = [];
    for (let t = 1; t <= 10; t++) {
      r.c.step();
      seen.push([1, 2, 3, 4].filter((k) => r.C[k].value === 1).length);
    }
    // C1 after 2 delays (AND + OR), C2 after 4, C3 after 6, Cout after 8
    expect(seen.slice(0, 8)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(netsValue(r.S)).toBe(0);
    expect(r.C[4].value).toBe(1);
  });
});

describe('miswired ALU (video 17)', () => {
  const w = applyFaults(BEN_FAULTS);
  it('reproduces Ben’s symptom: A = 0, B = 8 shows 4', () => {
    expect(evalWiring(w, 0, 8, false).value).toBe(4);
    expect(evalWiring(w, 0, 0, false).value).toBe(0); // 0 + 0 looks fine
    expect(evalWiring(w, 0, 0, true)).toMatchObject({ value: 0, carry: 1 });
  });
  it('Ben’s final checks fail before the fix and pass after it', () => {
    expect(evalWiring(w, 2, 6, false).ok).toBe(false);
    expect(evalWiring(w, 6, 2, true).ok).toBe(false);
    expect(wrongWires(w)).toEqual(['A3', 'B2', 'B3']);
    let fixed: AluWiring = w;
    for (const id of wrongWires(w)) fixed = fixWire(fixed, id[0].toLowerCase() as 'a' | 'b', Number(id.slice(1)));
    expect(wrongWires(fixed)).toEqual([]);
    expect(evalWiring(fixed, 2, 6, false).value).toBe(8);
    expect(evalWiring(fixed, 6, 2, true)).toMatchObject({ value: 4, carry: 1, ok: true });
  });
  it('fixing only the B swap leaves 6 − 2 wrong (the A fault hides when A bit 2 is 0)', () => {
    const half = fixWire(fixWire(w, 'b', 2), 'b', 3);
    expect(evalWiring(half, 2, 6, false).ok).toBe(true);
    expect(evalWiring(half, 6, 2, true).value).toBe(12);
  });
  it('single-bit tests locate every fault', () => {
    const bad = (x: AluWiring) => {
      const out: string[] = [];
      for (let i = 0; i < 8; i++) {
        if (!evalWiring(x, 1 << i, 0, false).ok) out.push(`A${i}`);
        if (!evalWiring(x, 0, 1 << i, false).ok) out.push(`B${i}`);
      }
      return out;
    };
    expect(bad(w).sort()).toEqual(['A2', 'A3', 'B2', 'B3']); // A=4 lights adder bits 2 and 3; A=8 never arrives
    expect(bad(correctWiring())).toEqual([]);
  });
  it('an open input floats high; a short to ground is stuck at 0', () => {
    const open = applyFaults([{ kind: 'open', side: 'b', bit: 5 }]);
    expect(evalWiring(open, 0, 0, false).value).toBe(32);
    const stuck = applyFaults([{ kind: 'stuck0', side: 'a', bit: 1 }]);
    expect(evalWiring(stuck, 2, 0, false).value).toBe(0);
    expect(evalWiring(stuck, 0, 0, false).ok).toBe(true);
  });
  it('random faults use distinct wires and always show up somewhere in the isolation tests', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    for (let k = 0; k < 200; k++) {
      const faults = randomFaults(rng, 2);
      expect(faults.length).toBe(2);
      const wiring = applyFaults(faults);
      const wrong = wrongWires(wiring);
      expect(wrong.length).toBeGreaterThan(0);
      const vectors: [number, number][] = [[0, 0], ...Array.from({ length: 8 }, (_, i): [number, number] => [1 << i, 0]), ...Array.from({ length: 8 }, (_, i): [number, number] => [0, 1 << i])];
      expect(vectors.some(([a, b]) => !evalWiring(wiring, a, b, false).ok)).toBe(true);
    }
  });
  it('hints follow Ben’s isolation strategy', () => {
    const run = (wiring: AluWiring, xs: [number, number, boolean][]): AluTest[] =>
      xs.map(([a, b, su]) => {
        const r = evalWiring(wiring, a, b, su);
        return { a, b, su, got: r.value, expected: r.expected, ok: r.ok };
      });
    expect(nextHint([], false)).toMatch(/A = 0 and B = 0/);
    expect(nextHint(run(w, [[0, 0, false]]), false)).toMatch(/0 − 0/);
    expect(nextHint(run(w, [[0, 0, false], [0, 0, true]]), false)).toMatch(/A on its own/);
    const singles: [number, number, boolean][] = [[0, 0, false], [0, 0, true], ...Array.from({ length: 8 }, (_, i): [number, number, boolean] => [1 << i, 0, false]), ...Array.from({ length: 8 }, (_, i): [number, number, boolean] => [0, 1 << i, false])];
    expect(nextHint(run(w, singles), false)).toMatch(/A2, A3, B2, B3/);
    const open = applyFaults([{ kind: 'open', side: 'a', bit: 0 }]);
    expect(nextHint(run(open, [[0, 0, false]]), false)).toMatch(/floats high/);
    expect(testKind({ a: 8, b: 0, su: false })).toEqual({ kind: 'a-bit', bit: 3 });
    expect(testKind({ a: 0, b: 0, su: true })).toEqual({ kind: 'zero' });
    expect(testKind({ a: 3, b: 0, su: false }).kind).toBe('other');
  });
});

describe('accumulating with EO + AI (video 18)', () => {
  it('a latch would race through values while the clock is high', () => {
    expect(latchRace(0, 2, false, 4)).toEqual([2, 4, 6, 8]);
    expect(latchRace(1, 2, true, 2)).toEqual([255, 253]);
    expect(latchRace(254, 1, false, 3)).toEqual([255, 0, 1]);
  });
});

describe('floating bus before the pull-downs (videos 13 and 18)', () => {
  it('loading from an undriven bus gives 1111 1111; with pull-downs 0000 0000', () => {
    const c = new Computer({ pullDowns: false });
    c.setManualControl(AI);
    c.tick();
    expect(c.a).toBe(0xff);
    c.pullDowns = true;
    c.tick();
    expect(c.a).toBe(0);
  });
  it('the IR still drives the top 4 bus lines low (its 245 inputs A0-A3 are grounded)', () => {
    const c = new Computer({ pullDowns: false });
    c.ir = 0x2a;
    c.setManualControl(IO | AI);
    c.tick();
    expect(c.a).toBe(0x0a);
  });
});

describe('building the ALU step by step (video 16)', () => {
  const upTo = (id: AluBuildStep) => new Set(ALU_BUILD_STEPS.slice(0, ALU_BUILD_STEPS.findIndex((x) => x.id === id) + 1).map((x) => x.id));
  const all = new Set(ALU_BUILD_STEPS.map((x) => x.id));
  it('follows Ben’s build order', () => {
    expect(ALU_BUILD_STEPS.map((x) => x.id)).toEqual(['power', 'a', 'out245', 'carry', 'b', 'su', 'ctl245', 'leds']);
  });
  it('without power nothing works', () => {
    const st = aluBuildState(3, 4, false, true, new Set(), correctWiring());
    expect(st.powered).toBe(false);
    expect(st.busOut).toBeNull();
  });
  it('unwired LS-TTL inputs float high', () => {
    // only power: A and B inputs read 255, both carry ins float high
    let st = aluBuildState(0, 0, false, false, upTo('power'));
    expect(st.adderA).toBe(0xff);
    expect(st.adderB).toBe(0xff);
    expect(st.c0Low).toBe(1);
    expect(st.c0High).toBe(1);
    // A wired, carry wired, B and SU still floating: A + 255 + 1 = A (mod 256)
    st = aluBuildState(5, 9, false, false, upTo('carry'));
    expect(st.adderA).toBe(5);
    expect(st.value).toBe(5);
    expect(st.floating.length).toBe(2);
    // B wired but SU floating: the XORs invert B and C0 = 1, so it subtracts
    st = aluBuildState(5, 3, false, false, upTo('b'));
    expect(st.xorCtl).toBe(1);
    expect(st.value).toBe(2);
  });
  it('a floating carry between the chips adds 16', () => {
    const built = new Set(all);
    built.delete('carry');
    expect(aluBuildState(0, 0, false, false, built).value).toBe(16);
    expect(aluBuildState(1, 1, false, false, built).value).toBe(18);
    expect(aluBuildState(8, 8, false, false, built).value).toBe(16); // the real carry is lost, the floating one stands in
  });
  it('fully wired, the ALU matches the computer for every input', () => {
    for (let a = 0; a < 256; a += 7)
      for (let b = 0; b < 256; b += 11)
        for (const su of [false, true]) {
          const st = aluBuildState(a, b, su, false, all);
          expect(st.floating).toEqual([]);
          expect(st.value).toBe(computeAlu(a, b, su).value);
          expect(st.carry).toBe(computeAlu(a, b, su).carry);
        }
  });
  it('the 245 only drives the bus once ~OE is wired and EO is on', () => {
    const before = upTo('su');
    expect(aluBuildState(2, 3, false, true, before).busOut).toBeNull();
    expect(aluBuildState(2, 3, false, false, all).busOut).toBeNull();
    expect(aluBuildState(2, 3, false, true, all).busOut).toBe(5);
  });
  it('with Ben’s two jumper mistakes the finished ALU shows 4 for 0 + 8', () => {
    const w = applyFaults(BEN_FAULTS);
    expect(aluBuildState(0, 8, false, false, all, w).value).toBe(4);
    expect(aluBuildState(0, 8, false, false, all, correctWiring()).value).toBe(8);
  });
});

// ===========================================================================
// Smoke test: mount every lab of this group in a minimal fake DOM, drive
// frames, press every control and check that cleanup stops all loops.
// ===========================================================================

type Listener = (e: any) => void;

class FakeNode {
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  listeners = new Map<string, Set<Listener>>();
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  appendChild<T extends FakeNode>(n: T): T {
    n.remove();
    n.parentNode = this as unknown as FakeElement;
    this.childNodes.push(n);
    return n;
  }
  insertBefore<T extends FakeNode>(n: T, ref: FakeNode | null): T {
    if (!ref) return this.appendChild(n);
    n.remove();
    const i = this.childNodes.indexOf(ref);
    n.parentNode = this as unknown as FakeElement;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
    return n;
  }
  removeChild<T extends FakeNode>(n: T): T {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  remove() { this.parentNode?.removeChild(this); }
  before(...ns: FakeNode[]) { for (const n of ns) this.parentNode?.insertBefore(n, this); }
  append(...ns: (FakeNode | string)[]) { for (const n of ns) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  replaceChildren(...ns: (FakeNode | string)[]) { for (const c of [...this.childNodes]) this.removeChild(c); this.append(...ns); }
  contains(n: FakeNode | null): boolean { for (let x: FakeNode | null = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { for (const c of [...this.childNodes]) this.removeChild(c); if (v !== '') this.appendChild(new FakeText(String(v))); }
  addEventListener(type: string, fn: Listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(ev: any) {
    ev.target ??= this;
    for (const fn of [...(this.listeners.get(ev.type) ?? [])]) fn(ev);
    if (ev.bubbles && this.parentNode) this.parentNode.dispatchEvent(ev);
    return true;
  }
  listenerCount() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n; }
}
class FakeText extends FakeNode {
  constructor(public data: string) { super(); }
  override get textContent() { return this.data; }
  override set textContent(v: string) { this.data = v; }
}
class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  style: Record<string, any> = {};
  dataset: Record<string, string> = {};
  value = '';
  checked = false;
  disabled = false;
  title = '';
  classList = {
    el: this as FakeElement,
    get list() { return (this.el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean); },
    add(...c: string[]) { const l = this.list; for (const x of c) if (!l.includes(x)) l.push(x); this.el.setAttribute('class', l.join(' ')); },
    remove(...c: string[]) { this.el.setAttribute('class', this.list.filter((x) => !c.includes(x)).join(' ')); },
    contains(c: string) { return this.list.includes(c); },
    toggle(c: string, force?: boolean) { const on = force ?? !this.contains(c); if (on) this.add(c); else this.remove(c); return on; },
  };
  constructor(public tagName: string) { super(); }
  setAttribute(k: string, v: unknown) { this.attributes.set(k, String(v)); }
  getAttribute(k: string) { return this.attributes.get(k) ?? null; }
  removeAttribute(k: string) { this.attributes.delete(k); }
  get children() { return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement); }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  all(pred: (e: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (n: FakeElement) => { for (const c of n.children) { if (pred(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  private match(sel: string) { return (e: FakeElement) => (sel.startsWith('.') ? e.classList.contains(sel.slice(1)) : e.tagName.toLowerCase() === sel.toLowerCase()); }
  querySelectorAll(sel: string) { return this.all(this.match(sel)); }
  querySelector(sel: string) { return this.all(this.match(sel))[0] ?? null; }
  closest() { return null; }
  getContext() { return null; }
  focus() {}
}
class FakeSVGElement extends FakeElement {}

let now = 0;
const rafs = new Map<number, (t: number) => void>();
const win = new FakeNode();
const tick = (frames: number, ms = 16) => {
  for (let f = 0; f < frames; f++) {
    now += ms;
    const cbs = [...rafs.values()];
    rafs.clear();
    for (const cb of cbs) cb(now);
  }
};
const fire = (el: FakeElement, type: string, extra: Record<string, unknown> = {}) => el.dispatchEvent({ type, bubbles: true, key: ' ', preventDefault() {}, stopPropagation() {}, ...extra });

const labModules = import.meta.glob<{ default: Lab }>(['../src/labs/registers/*.lab.ts', '../src/labs/alu/*.lab.ts'], { eager: true });
const LAB_IDS = ['bus-transfers', 'tri-state', 'one-bit-register', 'eight-bit-register', 'register-test', 'twos-complement', 'alu-design', 'alu-build', 'alu-troubleshooting', 'alu-test'];

describe('datapath labs mount, run and clean up', () => {
  beforeAll(() => {
    const g = globalThis as any;
    let id = 1;
    g.Node = FakeNode;
    g.HTMLElement = FakeElement;
    g.SVGElement = FakeSVGElement;
    g.document = {
      activeElement: null,
      createElement: (t: string) => new FakeElement(t.toUpperCase()),
      createElementNS: (_ns: string, t: string) => new FakeSVGElement(t),
      createTextNode: (t: string) => new FakeText(t),
    };
    g.addEventListener = (t: string, f: Listener) => win.addEventListener(t, f);
    g.removeEventListener = (t: string, f: Listener) => win.removeEventListener(t, f);
    g.getComputedStyle = () => ({ getPropertyValue: () => '' });
    g.requestAnimationFrame = (cb: (t: number) => void) => { const i = id++; rafs.set(i, cb); return i; };
    g.cancelAnimationFrame = (i: number) => rafs.delete(i);
    Object.defineProperty(g, 'performance', { value: { now: () => now }, configurable: true, writable: true });
  });

  const labs = Object.values(labModules).map((m) => m.default);

  it('every lab id of this group exists', () => {
    expect(labs.map((l) => l.id).sort()).toEqual([...LAB_IDS].sort());
    for (const id of LAB_IDS) expect(CHAPTER_LAB_IDS, `${id} is in chapters.ts`).toContain(id);
  });

  for (const id of LAB_IDS) {
    it(`${id}: interactive smoke test`, () => {
      const lab = labs.find((l) => l.id === id)!;
      expect(lab, id).toBeTruthy();
      const root = new FakeElement('DIV');
      const dispose = lab.mount(root as unknown as HTMLElement);
      tick(20);
      const callouts = () => root.all((e) => e.classList.contains('callout')).map((e) => e.textContent).join(' ');
      const check = () => expect(callouts()).not.toMatch(/undefined|NaN|\[object/);
      for (const b of root.all((e) => e.tagName === 'BUTTON')) {
        fire(b, 'pointerdown');
        tick(3);
        fire(b, 'pointerup');
        fire(b, 'click');
        tick(5);
      }
      check();
      for (const inp of root.all((e) => e.tagName === 'INPUT')) {
        if (inp.getAttribute('type') === 'checkbox') {
          inp.checked = !inp.checked;
          fire(inp, 'change');
        } else {
          inp.value = inp.getAttribute('type') === 'number' ? '-3' : '900';
          fire(inp, 'input');
          fire(inp, 'change');
        }
        tick(4);
      }
      check();
      for (const sel of root.all((e) => e.tagName === 'SELECT')) {
        for (const o of sel.all((e) => e.tagName === 'OPTION')) {
          sel.value = o.value || (o.getAttribute('value') ?? '');
          fire(sel, 'change');
          tick(4);
        }
      }
      check();
      for (const g of root.all((e) => e.getAttribute('role') === 'button' && e instanceof FakeSVGElement)) {
        fire(g, 'pointerdown');
        fire(g, 'click');
        tick(3);
        fire(g, 'pointerup');
        fire(g, 'keydown');
        fire(g, 'keyup');
      }
      tick(120);
      const text = callouts();
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/undefined|NaN|\[object/);
      expect(typeof dispose).toBe('function');
      (dispose as () => void)();
      tick(2); // flush one-shot frames queued before cleanup
      expect(rafs.size).toBe(0);
      expect(win.listenerCount()).toBe(0);
    });
  }
});
