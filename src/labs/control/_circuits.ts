/**
 * Gate/chip-level circuits for the control chapter, built on the event-driven
 * `Circuit` simulator. DOM-free so they can be unit-tested.
 */
import { Circuit, isKnown, type Level, type Net } from '../../logic/circuit';

const bitOf = (n: number, i: number): Level => ((n >> i) & 1) as 0 | 1;

/** Read a little-endian group of nets as a number (null if any bit is unknown). */
export function readNets(nets: readonly Net[]): number | null {
  let v = 0;
  for (let i = nets.length - 1; i >= 0; i--) {
    const l = nets[i].value;
    if (!isKnown(l)) return null;
    v = (v << 1) | l;
  }
  return v;
}

/** 74LS161 counter: rising edge on CP counts (CEP = CET = PE̅ = VCC), M̅R̅ low clears asynchronously. */
export function add161(c: Circuit, cp: Net, mrn: Net, q: Net[], opts: { delay?: number; name?: string } = {}) {
  return c.add({
    kind: '74LS161',
    name: opts.name ?? '74LS161',
    inputs: [cp, mrn],
    outputs: q,
    delay: opts.delay ?? 2,
    evaluate: ([clk, mr], ctx) => {
      let n = (ctx.state.count as number | undefined) ?? 0;
      if (mr === 0) n = 0;
      else if (ctx.prevInputs[0] === 0 && clk === 1) n = (n + 1) & 15;
      ctx.state.count = n;
      return q.map((_, i) => bitOf(n, i));
    },
  });
}

/** 74LS138 3-to-8 decoder with the enables wired on (E1̅ = E2̅ = GND, E3 = VCC). Outputs are active low. */
export function add138(c: Circuit, a: Net[], o: Net[], opts: { delay?: number } = {}) {
  return c.add({
    kind: '74LS138',
    name: '74LS138',
    inputs: a,
    outputs: o,
    delay: opts.delay ?? 2,
    evaluate: (ins) => {
      if (!ins.every(isKnown)) return o.map(() => 'X' as Level);
      const sel = (ins as number[]).reduce((acc, l, i) => acc | (l << i), 0);
      return o.map((_, i) => (i === sel ? 0 : 1) as Level);
    },
  });
}

/** 2-input multiplexer: out = sel ? a : b. */
export function addMux(c: Circuit, sel: Net, a: Net, b: Net, out: Net, delay = 1) {
  return c.add({ kind: 'MUX', inputs: [sel, a, b], outputs: [out], delay, evaluate: ([s, x, y]) => [s === 1 ? x : s === 0 ? y : 'X'] });
}

export interface StepCounterCircuit {
  c: Circuit;
  /** Master clock (driven by the lab). */
  clk: Net;
  /** Inverted clock from the 74LS04. */
  clkn: Net;
  /** What actually reaches the counter's CP pin. */
  cp: Net;
  /** 1 = counter on CLK̅ (Ben's design), 0 = counter on CLK (the race). */
  useInverted: Net;
  /** 1 = reset on O6̅ (Ben's first 6-step version), 0 = on O5̅. */
  resetAt6: Net;
  /** CLR̅ from the reset circuit (video 39). */
  clrn: Net;
  q: Net[];
  /** 74LS138 outputs O0̅..O7̅ (active low). */
  o: Net[];
  /** LED nets: Tk lit (1) when Ok̅ is low. */
  t: Net[];
  /** O5̅ or O6̅, whichever resets the counter. */
  osel: Net;
  /** U51B output. */
  nand1: Net;
  /** Counter M̅R̅ (U51A output). */
  mrn: Net;
  /** Control lines from the microcode, one per entry of `lineBits`. */
  lines: Net[];
  lineBits: number[];
  /** Replace the microcode words (index = step). */
  setWords(words: number[]): void;
  count(): number;
}

/**
 * The control-logic step counter from "Control logic part 2": a 74LS161
 * clocked by CLK̅ (74LS04), a 74LS138 decoding Q0-Q2 into T0..T7, and the
 * 74LS00 NANDs that clear the counter when O5̅ (or O6̅) goes low, plus a
 * slow "EEPROM" that turns the step into a few control lines.
 */
export function buildStepCounter(lineBits: number[], words: number[], opts: { romDelay?: number } = {}): StepCounterCircuit {
  const c = new Circuit();
  const clk = c.input('CLK', 0);
  const useInverted = c.input('use CLK̅', 1);
  const resetAt6 = c.input('reset at 6', 0);
  const clrn = c.input('CLR̅', 1);
  const romRev = c.input('rom rev', 0);
  const clkn = c.net('CLK̅', 1);
  const cp = c.net('CP', 1);
  const q = [0, 1, 2, 3].map((i) => c.net(`Q${i}`, 0));
  const o = Array.from({ length: 8 }, (_, i) => c.net(`O${i}̅`, i === 0 ? 0 : 1));
  const t = Array.from({ length: 8 }, (_, i) => c.net(`T${i}`, i === 0 ? 1 : 0));
  const osel = c.net('O5̅', 1);
  const nand1 = c.net('U51B', 0);
  const mrn = c.net('M̅R̅', 1);
  const lines = lineBits.map((_, i) => c.net(`line${i}`, 0));

  c.not(clk, clkn);
  addMux(c, useInverted, clkn, clk, cp);
  add161(c, cp, mrn, q, { name: 'step counter' });
  add138(c, q.slice(0, 3), o);
  o.forEach((n, i) => c.not(n, t[i]));
  addMux(c, resetAt6, o[6], o[5], osel);
  c.nand([osel, clrn], nand1);
  c.nand([nand1, nand1], mrn);

  let table = words.slice();
  c.add({
    kind: '28C16',
    name: 'microcode EEPROM',
    inputs: [q[0], q[1], q[2], romRev],
    outputs: lines,
    delay: opts.romDelay ?? 4,
    evaluate: (ins) => {
      if (!ins.slice(0, 3).every(isKnown)) return lines.map(() => 'X' as Level);
      const step = (ins[0] as number) | ((ins[1] as number) << 1) | ((ins[2] as number) << 2);
      const w = table[step] ?? 0;
      return lineBits.map((b) => ((w & b) !== 0 ? 1 : 0) as Level);
    },
  });
  c.settle();

  return {
    c, clk, clkn, cp, useInverted, resetAt6, clrn, q, o, t, osel, nand1, mrn, lines, lineBits,
    setWords(w: number[]) {
      table = w.slice();
      c.toggle(romRev);
    },
    count: () => readNets(q.slice(0, 3)) ?? -1,
  };
}

export interface ResetLogicCircuit {
  c: Circuit;
  /** Node between the push button (to VCC) and the 1 kΩ pull-down. */
  button: Net;
  /** O5̅ from the step decoder. */
  o5n: Net;
  clrn: Net;
  clr: Net;
  nand1: Net;
  /** Step counter M̅R̅. */
  stepMrn: Net;
}

/**
 * The reset circuit (video 39): SW8 to VCC with R75 = 1 kΩ to GND, a 74LS00
 * making CLR̅ (U51C) and CLR (U51D), and the step-counter reset
 * M̅R̅ = AND(O5̅, CLR̅) built from U51B + U51A.
 */
export function buildResetLogic(): ResetLogicCircuit {
  const c = new Circuit();
  const button = c.input('SW8', 0);
  const o5n = c.input('O5̅', 1);
  const clrn = c.net('CLR̅', 1);
  const clr = c.net('CLR', 0);
  const nand1 = c.net('U51B', 0);
  const stepMrn = c.net('step M̅R̅', 1);
  c.nand([button, button], clrn); // U51C, inputs 9 and 10 tied
  c.nand([clrn, clrn], clr); //      U51D, inputs 12 and 13 tied
  c.nand([o5n, clrn], nand1); //     U51B
  c.nand([nand1, nand1], stepMrn); // U51A as an inverter
  c.settle();
  return { c, button, o5n, clrn, clr, nand1, stepMrn };
}

export interface ClockGateCircuit {
  c: Circuit;
  clk: Net;
  oi: Net;
  cp: Net;
  /** Latched value (8 bits) and the number of times the 273 has latched. */
  latched(): { value: number; count: number };
  setBus(v: number): void;
}

/** 74LS273 output register with CP = CLK AND OI (74LS08), D = the bus value. */
export function buildClockGate(): ClockGateCircuit {
  const c = new Circuit();
  const clk = c.input('CLK', 0);
  const oi = c.input('OI', 0);
  const cp = c.net('CP', 0);
  const q0 = c.net('Q0', 0);
  let bus = 0;
  const state = { value: 0, count: 0 };
  c.and([clk, oi], cp);
  c.add({
    kind: '74LS273',
    inputs: [cp],
    outputs: [q0],
    delay: 1,
    evaluate: ([p], ctx) => {
      if (ctx.prevInputs[0] === 0 && p === 1) {
        state.value = bus & 0xff;
        state.count++;
      }
      return [bitOf(state.value, 0)];
    },
  });
  c.settle();
  return { c, clk, oi, cp, latched: () => ({ ...state }), setBus: (v) => (bus = v & 0xff) };
}
