/**
 * Pure models used by the "Registers & the bus" labs (videos 9-13):
 * chip behaviour (74LS74, 74LS173, 74LS245) as plain functions plus thin
 * wrappers that turn them into `Circuit` components, and the conceptual
 * bus-transfer model of video 9.
 *
 * No DOM access here, so everything can be unit-tested in node.
 */
import { Circuit, isKnown, not, type Bit, type Component, type Level, type Net } from '../../logic/circuit';

/** How an LS-TTL input sees a level: a floating ('Z') input reads high. */
export const ttl = (l: Level): Level => (l === 'Z' ? 1 : l);

// ---------------------------------------------------------------------------
// 74LS74: positive-edge-triggered D flip-flop (one of the two in the package)

/**
 * Next stored value of a 74LS74 half. ~PRE and ~CLR are active low and
 * asynchronous; otherwise Q takes D on a rising CLK edge only.
 */
export function dffNext(q: Level, prevClk: Level, inp: { d: Level; clk: Level; pre?: Level; clr?: Level }): Level {
  const pre = ttl(inp.pre ?? 1), clr = ttl(inp.clr ?? 1);
  if (pre === 0 && clr !== 0) return 1;
  if (clr === 0 && pre !== 0) return 0;
  if (pre === 0 && clr === 0) return 1; // both asserted: Q = Q̅ = 1 (datasheet); we report Q
  const clk = ttl(inp.clk);
  if (ttl(prevClk) === 0 && clk === 1) {
    const d = ttl(inp.d);
    return isKnown(d) ? d : 'X';
  }
  return q;
}

export interface DffPins {
  d: Net;
  clk: Net;
  q: Net;
  qn?: Net;
  pre?: Net;
  clr?: Net;
  name?: string;
}

/** Add a 74LS74 half to a circuit. Its stored bit is in `component.state.q`. */
export function addDff(c: Circuit, p: DffPins, initial: Bit = 0, delay = 2): Component {
  const inputs = [p.d, p.clk, ...(p.pre ? [p.pre] : []), ...(p.clr ? [p.clr] : [])];
  const outputs = p.qn ? [p.q, p.qn] : [p.q];
  return c.add({
    kind: '74LS74',
    name: p.name,
    inputs,
    outputs,
    delay,
    evaluate: (ins, ctx) => {
      const [d, clk] = ins;
      const pre = p.pre ? ins[2] : 1;
      const clr = p.clr ? ins[p.pre ? 3 : 2] : 1;
      const prev = (ctx.state.q as Level | undefined) ?? initial;
      const q = dffNext(prev, ctx.prevInputs[1], { d, clk, pre, clr });
      ctx.state.q = q;
      const qn = pre === 0 && clr === 0 ? 1 : not(q);
      return p.qn ? [q, qn] : [q];
    },
  });
}

// ---------------------------------------------------------------------------
// Video 10: output stages

export interface OutputStage {
  /** Upper transistor conducting (connects the output to +5 V). */
  top: boolean;
  /** Lower transistor conducting (connects the output to ground). */
  bottom: boolean;
  out: Level;
}

/** A TTL "totem-pole" output: 1 = top transistor on, 0 = bottom on, disabled (tri-state) = both off. */
export function outputStage(value: Bit, enabled = true): OutputStage {
  if (!enabled) return { top: false, bottom: false, out: 'Z' };
  return value ? { top: true, bottom: false, out: 1 } : { top: false, bottom: true, out: 0 };
}

/** Two or more output stages joined by one wire: the wire level and whether current shorts +5 V to ground. */
export function joinOutputs(stages: readonly OutputStage[]): { level: Level; short: boolean } {
  const anyTop = stages.some((s) => s.top), anyBottom = stages.some((s) => s.bottom);
  if (anyTop && anyBottom) return { level: 'X', short: true };
  if (anyTop) return { level: 1, short: false };
  if (anyBottom) return { level: 0, short: false };
  return { level: 'Z', short: false };
}

/** Truth table of one tri-state buffer (E = enable, A = data). */
export function triState(e: Level, a: Level): Level {
  const en = ttl(e), d = ttl(a);
  if (en === 0) return 'Z';
  if (en === 1) return isKnown(d) ? d : 'X';
  return 'X';
}

// ---------------------------------------------------------------------------
// 74LS173: 4-bit D register with load enables and tri-state outputs

/**
 * Pin map of the 74LS173 (datasheet / video 11 notes):
 * M=1, N=2 (output control, both low = outputs on), 1Q-4Q = 3-6, CLK = 7,
 * GND = 8, G1 = 9, G2 = 10 (data enable, both low = load), 4D-1D = 11-14,
 * CLR = 15 (active high, asynchronous), VCC = 16.
 */
export const LS173_PINS = { M: 1, N: 2, '1Q': 3, '2Q': 4, '3Q': 5, '4Q': 6, CLK: 7, GND: 8, G1: 9, G2: 10, '4D': 11, '3D': 12, '2D': 13, '1D': 14, CLR: 15, VCC: 16 } as const;

export interface Ls173Inputs {
  /** Output control M and N: both low = outputs enabled, either high = high-Z. */
  m: Level;
  n: Level;
  /** 1D..4D */
  d: Level[];
  /** Data enables G1 and G2 (active low): both low = load on the next rising edge. */
  g1: Level;
  g2: Level;
  clk: Level;
  /** Clear, active HIGH, asynchronous. */
  clr: Level;
}

export interface Ls173Result {
  /** Bits held in the flip-flops (1Q..4Q order). */
  stored: Level[];
  /** Levels on the output pins (stored bits, or 'Z' when M/N disable them). */
  out: Level[];
}

/**
 * One evaluation of a 74LS173 given the previous CLK level. Loading happens
 * only on a rising CLK edge while G1 = G2 = 0; CLR = 1 clears immediately and
 * overrides the clock.
 */
export function ls173(stored: readonly Level[], prevClk: Level, raw: Ls173Inputs): Ls173Result {
  const m = ttl(raw.m), n = ttl(raw.n), g1 = ttl(raw.g1), g2 = ttl(raw.g2), clk = ttl(raw.clk), clr = ttl(raw.clr);
  const d = raw.d.map(ttl);
  let next: Level[] = [...stored];
  if (clr === 1) next = [0, 0, 0, 0];
  else if (clr !== 0) next = next.map((q) => (q === 0 ? 0 : 'X'));
  else if (ttl(prevClk) === 0 && clk === 1) {
    if (g1 === 0 && g2 === 0) next = d.map((v) => (isKnown(v) ? v : 'X'));
    else if (g1 !== 1 && g2 !== 1) next = next.map((q, i) => (q === d[i] ? q : 'X')); // enable unknown
  }
  const out: Level[] = m === 0 && n === 0 ? next : m === 1 || n === 1 ? next.map(() => 'Z' as Level) : next.map(() => 'X' as Level);
  return { stored: next, out };
}

export interface Ls173Pins {
  m: Net;
  n: Net;
  /** 1D..4D */
  d: Net[];
  g1: Net;
  g2: Net;
  clk: Net;
  clr: Net;
  /** 1Q..4Q */
  q: Net[];
  name?: string;
}

/** Add a 74LS173 to a circuit. The stored bits live in `component.state.q`. */
export function addLs173(c: Circuit, p: Ls173Pins, initial: Level[] = [0, 0, 0, 0], delay = 2): Component {
  return c.add({
    kind: '74LS173',
    name: p.name,
    inputs: [p.m, p.n, ...p.d, p.g1, p.g2, p.clk, p.clr],
    outputs: p.q,
    delay,
    evaluate: (ins, ctx) => {
      const [m, n, d1, d2, d3, d4, g1, g2, clk, clr] = ins;
      const prev = (ctx.state.q as Level[] | undefined) ?? initial;
      const r = ls173(prev, ctx.prevInputs[8], { m, n, d: [d1, d2, d3, d4], g1, g2, clk, clr });
      ctx.state.q = r.stored;
      return r.out;
    },
  });
}

/** Read the stored bits of a 74LS173 component as a number (1Q = LSB); X/Z read as 0. */
export function ls173Value(comp: Component): number {
  const q = (comp.state.q as Level[] | undefined) ?? [];
  return q.reduce<number>((acc, l, i) => acc | (l === 1 ? 1 << i : 0), 0);
}

// ---------------------------------------------------------------------------
// 74LS245: octal bus transceiver (8 tri-state buffers each way)

/** Pin map: DIR = 1, A1-A8 = 2-9, GND = 10, B8-B1 = 11-18, ~OE = 19, VCC = 20. */
export const LS245_PINS = {
  DIR: 1,
  A: [2, 3, 4, 5, 6, 7, 8, 9],
  GND: 10,
  B: [18, 17, 16, 15, 14, 13, 12, 11],
  OE: 19,
  VCC: 20,
} as const;

/**
 * Output levels of a 74LS245 for both sides. ~OE high: both sides high-Z.
 * ~OE low: DIR = 1 drives B from A, DIR = 0 drives A from B.
 */
export function ls245(dir: Level, oe: Level, a: readonly Level[], b: readonly Level[]): { a: Level[]; b: Level[] } {
  const d = ttl(dir), e = ttl(oe);
  const Z = (xs: readonly Level[]) => xs.map(() => 'Z' as Level);
  const pass = (xs: readonly Level[]) => xs.map((v) => (isKnown(ttl(v)) ? ttl(v) : 'X'));
  if (e === 1) return { a: Z(a), b: Z(b) };
  if (e !== 0 || !isKnown(d)) return { a: a.map(() => 'X'), b: b.map(() => 'X') };
  return d === 1 ? { a: Z(a), b: pass(a) } : { a: pass(b), b: Z(b) };
}

export interface Ls245Pins {
  dir: Net;
  oe: Net;
  /** A1..A8 */
  a: Net[];
  /** B1..B8 */
  b: Net[];
  name?: string;
}

export function addLs245(c: Circuit, p: Ls245Pins, delay = 1): Component {
  const n = p.a.length;
  return c.add({
    kind: '74LS245',
    name: p.name,
    inputs: [p.dir, p.oe, ...p.a, ...p.b],
    outputs: [...p.a, ...p.b],
    delay,
    evaluate: (ins) => {
      const r = ls245(ins[0], ins[1], ins.slice(2, 2 + n), ins.slice(2 + n));
      return [...r.a, ...r.b];
    },
  });
}

// ---------------------------------------------------------------------------
// Video 9: the bus as a concept (several modules, one LOAD and one ENABLE each)

export type BusRegId = 'sw' | 'a' | 'b' | 'ir' | 'out';
export type BusModuleId = BusRegId | 'sum';

export interface BusModuleDef {
  id: BusModuleId;
  name: string;
  /** Load signal (reads the bus on the clock edge), or null. */
  inSig: string | null;
  /** Enable signal (drives the bus), or null. */
  outSig: string | null;
  note: string;
}

export const BUS_MODULES: BusModuleDef[] = [
  { id: 'sw', name: 'Switches', inSig: null, outSig: 'SW', note: 'DIP switches standing in for a module (Ben uses jumper wires to test).' },
  { id: 'a', name: 'A register', inSig: 'AI', outSig: 'AO', note: 'AI = A in (load), AO = A out (enable).' },
  { id: 'ir', name: 'Instruction reg.', inSig: 'II', outSig: 'IO', note: 'IO only puts the low 4 bits on the bus; the top 4 bits are driven as 0.' },
  { id: 'sum', name: 'ALU (Σ = A + B)', inSig: null, outSig: 'EO', note: 'EO (Σ out): the adder always computes A + B; EO only connects it to the bus.' },
  { id: 'out', name: 'Output', inSig: 'OI', outSig: null, note: 'OI = output in. The display only ever reads from the bus.' },
  { id: 'b', name: 'B register', inSig: 'BI', outSig: 'BO', note: 'In the finished computer B never drives the bus (its BO line is tied off).' },
];

export type BusValues = Record<BusRegId, number>;

/** Value a module puts on the bus when its output is enabled. */
export function busModuleOutput(id: BusModuleId, v: BusValues): number {
  switch (id) {
    case 'sum': return (v.a + v.b) & 0xff;
    case 'ir': return v.ir & 0x0f;
    default: return v[id] & 0xff;
  }
}

export interface BusResolution {
  drivers: BusModuleId[];
  /** Per bit, index 0 = bit 0: 0/1, 'Z' (nobody drives), 'X' (two drivers disagree). */
  levels: Level[];
  /** What a register would latch: floating lines read 1 (LS-TTL), contended lines read the AND (low wins). */
  value: number;
  contention: boolean;
  floating: boolean;
}

export function resolveBus(v: BusValues, outs: readonly BusModuleId[]): BusResolution {
  const drivers = BUS_MODULES.filter((m) => m.outSig && outs.includes(m.id)).map((m) => m.id);
  if (drivers.length === 0) return { drivers, levels: new Array<Level>(8).fill('Z'), value: 0xff, contention: false, floating: true };
  const vals = drivers.map((d) => busModuleOutput(d, v));
  const levels: Level[] = [];
  for (let bit = 0; bit < 8; bit++) {
    const bits = vals.map((x) => (x >> bit) & 1);
    levels.push(bits.every((b) => b === bits[0]) ? (bits[0] as Bit) : 'X');
  }
  const value = vals.reduce((x, y) => x & y, 0xff);
  return { drivers, levels, value, contention: drivers.length > 1, floating: false };
}

export interface BusTransfer {
  from: BusModuleId[];
  to: BusRegId;
  value: number;
}

/** One rising clock edge: every module whose load is enabled takes the bus value. */
export function clockBus(v: BusValues, outs: readonly BusModuleId[], ins: readonly BusModuleId[]): { values: BusValues; transfers: BusTransfer[]; bus: BusResolution } {
  const bus = resolveBus(v, outs);
  const values = { ...v };
  const transfers: BusTransfer[] = [];
  for (const m of BUS_MODULES) {
    if (!m.inSig || !ins.includes(m.id)) continue;
    const id = m.id as BusRegId;
    values[id] = bus.value;
    transfers.push({ from: bus.drivers, to: id, value: bus.value });
  }
  return { values, transfers, bus };
}

/** Microcode bit order (HLT MI RI RO IO II AI AO EO SU BI OI …), plus the lab-only SW and BO. */
const SIGNAL_ORDER = ['SW', 'IO', 'II', 'AI', 'AO', 'EO', 'BI', 'BO', 'OI'];

/** Text for a list of enabled signals, in the order Ben writes control words ("AO BI", "IO AI"). */
export function busControlWord(outs: readonly BusModuleId[], ins: readonly BusModuleId[]): string {
  const sigs: string[] = [];
  for (const m of BUS_MODULES) {
    if (m.outSig && outs.includes(m.id)) sigs.push(m.outSig);
    if (m.inSig && ins.includes(m.id)) sigs.push(m.inSig);
  }
  sigs.sort((x, y) => SIGNAL_ORDER.indexOf(x) - SIGNAL_ORDER.indexOf(y));
  return sigs.length ? sigs.join(' ') : '—';
}

// ---------------------------------------------------------------------------
// Circuits used by the labs (built here so the tests exercise the same nets)

/**
 * Video 11: D = (BUS AND LOAD) OR (Q AND NOT LOAD) into a 74LS74, Q back to
 * the bus through a tri-state buffer enabled by ENABLE. "Another module" can
 * also drive the bus through its own tri-state buffer.
 */
export function buildOneBitRegister(c: Circuit = new Circuit()) {
  const BUSIN = c.input('other module data', 1);
  const BUSDRV = c.input('other module drives', 1);
  const LOAD = c.input('LOAD', 0);
  const EN = c.input('ENABLE', 0);
  const CLK = c.input('CLK', 0);
  const BUS = c.net('BUS', 1);
  const NLOAD = c.net('~LOAD', 1);
  const AND1 = c.net('BUS·LOAD', 0);
  const AND2 = c.net('Q·~LOAD', 0);
  const D = c.net('D', 0);
  const Q = c.net('Q', 0);
  const QN = c.net('Q̅', 1);
  c.tri(BUSIN, BUSDRV, BUS, { name: 'other module' });
  c.not(LOAD, NLOAD);
  c.and([BUS, LOAD], AND1);
  c.and([Q, NLOAD], AND2);
  c.or([AND1, AND2], D);
  const ff = addDff(c, { d: D, clk: CLK, q: Q, qn: QN, name: '74LS74' }, 0);
  c.tri(Q, EN, BUS, { name: 'output buffer' });
  c.settle();
  return { c, BUSIN, BUSDRV, LOAD, EN, CLK, BUS, NLOAD, AND1, AND2, D, Q, QN, ff };
}

/**
 * Video 12: the A register. U9 (bits 3-0) and U8 (bits 7-4) 74LS173 with
 * M = N = GND, G1 = G2 = ~AI; U7 74LS245 with DIR = +5 V and ~OE = ~AO.
 * Eight switches can drive the bus through tri-state buffers (Ben's jumpers).
 */
export function buildARegister(start = 0b00101010, c: Circuit = new Circuit()) {
  const GND = c.input('GND', 0);
  const VCC = c.input('VCC', 1);
  const sw = Array.from({ length: 8 }, (_, i) => c.input(`SW${i}`, ((start >> i) & 1) as Bit));
  const swEn = c.input('switches connected', 1);
  const nAI = c.input('~AI', 1);
  const nAO = c.input('~AO', 1);
  const CLK = c.input('CLK', 0);
  const CLR = c.input('CLR', 0);
  const bus = Array.from({ length: 8 }, (_, i) => c.net(`BUS${i}`, 'Z'));
  const q = Array.from({ length: 8 }, (_, i) => c.net(`A${i}`, 0));
  sw.forEach((s, i) => c.tri(s, swEn, bus[i], { name: `switch ${i}` }));
  const u9 = addLs173(c, { m: GND, n: GND, d: bus.slice(0, 4), g1: nAI, g2: nAI, clk: CLK, clr: CLR, q: q.slice(0, 4), name: 'U9' });
  const u8 = addLs173(c, { m: GND, n: GND, d: bus.slice(4), g1: nAI, g2: nAI, clk: CLK, clr: CLR, q: q.slice(4), name: 'U8' });
  const u7 = addLs245(c, { dir: VCC, oe: nAO, a: q, b: bus, name: 'U7' });
  c.settle();
  const value = () => ls173Value(u9) | (ls173Value(u8) << 4);
  return { c, GND, VCC, sw, swEn, nAI, nAO, CLK, CLR, bus, q, u7, u8, u9, value };
}
