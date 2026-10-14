/**
 * Pure models for the "Control logic" chapter labs (videos 34-39).
 * No DOM access here: everything is unit-tested in tests/labs-control.test.ts.
 */
import type { Level } from '../../logic/circuit';
import { disassemble } from '../../sim/assembler';
import { Computer, computeAlu } from '../../sim/computer';
import { buildMicrocodeVersion, INSTRUCTION_BY_OPCODE, type MicrocodeVersionId } from '../../sim/microcode';
import { AI, AO, BI, CE, CO, EO, FI, HLT, II, IO, J, MI, OI, RI, RO, SU, formatControlWord, type ModuleId, type Signal } from '../../sim/signals';

// ---------------------------------------------------------------------------
// Bus drivers and loaders

export interface BusPart {
  sig: Signal;
  bit: number;
  module: ModuleId;
  /** Short name for transfer descriptions ("PC → MAR"). */
  short: string;
  /** Long name for sentences. */
  long: string;
}

/** Modules with a 74LS245 onto the bus, and the signal that enables it. */
export const DRIVERS: BusPart[] = [
  { sig: 'RO', bit: RO, module: 'ram', short: 'RAM', long: 'RAM' },
  { sig: 'IO', bit: IO, module: 'ir', short: 'IR operand', long: 'instruction register (its low 4 bits)' },
  { sig: 'AO', bit: AO, module: 'a', short: 'A', long: 'A register' },
  { sig: 'EO', bit: EO, module: 'alu', short: 'Σ', long: 'ALU (Σ)' },
  { sig: 'CO', bit: CO, module: 'pc', short: 'PC', long: 'program counter' },
];

/** Modules that latch the bus on the rising clock edge. */
export const LOADERS: BusPart[] = [
  { sig: 'MI', bit: MI, module: 'mar', short: 'MAR', long: 'memory address register' },
  { sig: 'RI', bit: RI, module: 'ram', short: 'RAM', long: 'RAM' },
  { sig: 'II', bit: II, module: 'ir', short: 'IR', long: 'instruction register' },
  { sig: 'AI', bit: AI, module: 'a', short: 'A', long: 'A register' },
  { sig: 'BI', bit: BI, module: 'b', short: 'B', long: 'B register' },
  { sig: 'OI', bit: OI, module: 'out', short: 'OUT', long: 'output register' },
  { sig: 'J', bit: J, module: 'pc', short: 'PC', long: 'program counter (jump)' },
];

export const driversOf = (word: number) => DRIVERS.filter((d) => word & d.bit);
export const loadersOf = (word: number) => LOADERS.filter((d) => word & d.bit);

/**
 * One-line description of what a control word does, e.g.
 * MI|CO -> "PC → MAR", RO|II|CE -> "RAM → IR · PC + 1".
 */
export function describeTransfer(word: number): string {
  if (!word) return 'nothing (an empty step)';
  const parts: string[] = [];
  const dr = driversOf(word);
  const ld = loadersOf(word);
  let src: string | null = null;
  if (dr.length > 1) src = `${dr.map((d) => d.short).join(' + ')} (contention!)`;
  else if (dr.length === 1) src = dr[0].sig === 'EO' ? (word & SU ? 'Σ (A − B)' : 'Σ (A + B)') : dr[0].short;
  if (ld.length) parts.push(`${src ?? 'bus = 0 (pull-downs)'} → ${ld.map((l) => l.short).join(', ')}`);
  else if (src) parts.push(`${src} drives the bus`);
  if (word & CE) parts.push(word & J ? 'CE ignored (the jump load wins)' : 'PC + 1');
  if (word & FI) parts.push('flags ← carry, zero');
  if (word & SU && !(word & EO)) parts.push('ALU set to subtract');
  if (word & HLT) parts.push('halt the clock');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// "Be the control unit": checking a hand-set control word

const MISSING: Partial<Record<Signal, string>> = {
  MI: 'MI is off, so the memory address register keeps its old address.',
  RI: 'RI is off, so nothing is written into RAM.',
  II: 'II is off, so the instruction never reaches the instruction register.',
  AI: 'AI is off, so the A register is not loaded.',
  BI: 'BI is off, so the B register is not loaded and the ALU adds the old B.',
  OI: 'OI is off, so the output register does not latch A and the display does not change.',
  J: 'J is off, so the program counter is not loaded and the jump does not happen.',
  CE: 'You forgot CE: the program counter is not incremented, so the next fetch reads the same instruction again.',
  FI: 'FI is off, so the flags register is not updated.',
  SU: 'SU is off, so the ALU adds instead of subtracting.',
  HLT: 'This step should stop the clock with HLT.',
};

const EXTRA: Partial<Record<Signal, string>> = {
  MI: 'MI is on, so the memory address register loads the bus and RAM now points somewhere else.',
  RI: 'RI is on, so the bus value overwrites a byte of RAM. That can destroy the program!',
  II: 'II is on, so the instruction register is overwritten with the bus value.',
  AI: 'AI is on, so the A register is overwritten with the bus value.',
  BI: 'BI is on, so the B register is overwritten with the bus value.',
  OI: 'OI is on, so the output register latches the bus and the display changes.',
  J: 'J is on, so the program counter loads the bus: an unplanned jump.',
  CE: 'CE is on, so the program counter counts one extra time and an instruction will be skipped.',
  FI: 'FI is on, so the flags register latches carry and zero from the ALU.',
  SU: 'SU is on, so the ALU subtracts. It only matters when the ALU result is used (EO).',
  HLT: 'HLT stops the clock! Switch it off to carry on.',
};

export interface MistakeReport {
  ok: boolean;
  messages: string[];
}

/** Compare a hand-set control word with the reference microcode and explain the difference. */
export function explainMicrostepMistake(used: number, expected: number): MistakeReport {
  if (used === expected) return { ok: true, messages: [] };
  const messages: string[] = [];
  const dUsed = driversOf(used);
  const dExp = driversOf(expected);
  if (dUsed.length > 1) {
    messages.push(
      `Two modules drive the bus at the same time (${dUsed.map((d) => `${d.long} via ${d.sig}`).join(' and ')}). That is bus contention: the outputs fight each other and the bus value is garbage. On the real computer the low outputs usually win.`,
    );
  } else if (dExp.length === 1 && dUsed.length === 0) {
    messages.push(`Nothing drives the bus, so the 10 kΩ pull-downs make it read 0. The ${dExp[0].long} should put its value on the bus (${dExp[0].sig}).`);
  } else if (dExp.length === 1 && dUsed.length === 1 && dExp[0].sig !== dUsed[0].sig) {
    messages.push(`The ${dUsed[0].long} drives the bus (${dUsed[0].sig}), but this step needs the ${dExp[0].long} (${dExp[0].sig}).`);
  } else if (dExp.length === 0 && dUsed.length === 1 && loadersOf(expected).length === 0) {
    messages.push(`The ${dUsed[0].long} drives the bus (${dUsed[0].sig}), but nothing needs to move in this step.`);
  }
  const busSigs = new Set<Signal>(DRIVERS.map((d) => d.sig));
  for (const [sig, text] of Object.entries(MISSING) as [Signal, string][]) {
    const bit = bitOf(sig);
    if (expected & bit && !(used & bit)) messages.push(text);
  }
  for (const [sig, text] of Object.entries(EXTRA) as [Signal, string][]) {
    const bit = bitOf(sig);
    if (used & bit && !(expected & bit) && !busSigs.has(sig)) messages.push(text);
  }
  if (!messages.length) messages.push(`Expected ${formatControlWord(expected)}, but the switches were set to ${formatControlWord(used)}.`);
  return { ok: false, messages };
}

const BITS: Record<Signal, number> = { HLT, MI, RI, RO, IO, II, AI, AO, EO, SU, BI, OI, CE, CO, J, FI };
const bitOf = (s: Signal) => BITS[s];

export interface LiveState {
  /** Address the current instruction was fetched from. */
  fetchAddr: number;
  /** Low nibble of the instruction register. */
  operand: number;
  ram: ArrayLike<number>;
  a: number;
  b: number;
}

/**
 * What a microstep has to achieve, phrased without naming the control
 * signals (so the learner can work them out).
 */
export function microstepGoal(opcode: number, step: number, word: number, s: LiveState): string {
  const mn = INSTRUCTION_BY_OPCODE.get(opcode)?.mnemonic ?? `opcode ${opcode.toString(2).padStart(4, '0')}`;
  const instr = s.ram[s.fetchAddr & 15] ?? 0;
  const at = s.ram[s.operand & 15] ?? 0;
  if (step === 0) return `Fetch, step 1 of 2: copy the program counter (address ${s.fetchAddr}) into the memory address register.`;
  if (step === 1)
    return `Fetch, step 2 of 2: RAM now shows the instruction at address ${s.fetchAddr} (${instr.toString(2).padStart(8, '0')} = ${disassemble(instr)}). Copy it into the instruction register and make the program counter count up.`;
  if (word === 0) return `Nothing to do in T${step} of ${mn}: switch everything off and pulse the clock. The step counter always runs T0 to T4.`;
  const alu = computeAlu(s.a, s.b, (word & SU) !== 0);
  switch (word & ~FI) {
    case IO | MI:
      return `${mn} works on the byte at address ${s.operand}: put the instruction's operand (its low 4 bits) into the memory address register.`;
    case RO | AI:
      return `RAM now shows the byte at address ${s.operand} (${at}). Load it into the A register.`;
    case RO | BI:
      return `RAM now shows the byte at address ${s.operand} (${at}). Load it into the B register, so the ALU can work with it.`;
    case EO | AI:
    case EO | AI | SU:
      return `The ALU already shows A ${word & SU ? '−' : '+'} B = ${alu.value}. Put the result on the bus and load it into A${word & FI ? ', latching the flags too' : ''}.`;
    case AO | OI:
      return `Copy the A register (${s.a}) into the output register so the display shows it.`;
    case AO | RI:
      return `Store the A register (${s.a}) into RAM at address ${s.operand}.`;
    case IO | AI:
      return `Load the operand (${s.operand}) straight into the A register.`;
    case IO | J:
      return `Jump: load the operand (${s.operand}) into the program counter.`;
    case HLT:
      return 'The program is finished: stop the clock.';
    default:
      return `Do this: ${describeTransfer(word)}.`;
  }
}

/** One microstep of a program run, as recorded from the reference microcode. */
export interface MicrostepRecord {
  /** Rising clock edge number (1-based). */
  edge: number;
  fetchAddr: number;
  step: number;
  opcode: number;
  word: number;
}

/**
 * The reference sequence of control words for a program, from reset until
 * HLT (or `maxEdges`). Steps T0/T1 are listed under the instruction being
 * fetched.
 */
export function referenceSequence(bytes: ArrayLike<number>, version: MicrocodeVersionId = 'control-logic', maxEdges = 200): MicrostepRecord[] {
  const c = new Computer({ microcode: buildMicrocodeVersion(version), ram: bytes });
  const out: MicrostepRecord[] = [];
  let fetchAddr = 0;
  for (let edge = 1; edge <= maxEdges; edge++) {
    if (c.step === 0) fetchAddr = c.pc;
    const opcode = c.step < 2 ? (c.ram[fetchAddr] >> 4) & 15 : c.opcode;
    out.push({ edge, fetchAddr, step: c.step, opcode, word: c.microcodeWord });
    if (c.halted || !c.tick()) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bus pull-downs (video 34)

export type BusSource = 'none' | 'pc' | 'ir' | 'ram' | 'a';

/** Which bus lines each source actively drives. */
export const DRIVEN_MASK: Record<BusSource, number> = {
  none: 0x00,
  pc: 0x0f, // the PC's 74LS245 only connects to BUS 0-3
  ir: 0xff, // the IR's 245 drives the operand on 0-3 and actively drives 4-7 low (inputs tied to GND)
  ram: 0xff,
  a: 0xff,
};

/** Levels on the 8 bus lines, MSB first. Undriven lines float (Z) unless pulled down. */
export function busLevels(source: BusSource, value: number, pulldowns: boolean): Level[] {
  const mask = DRIVEN_MASK[source];
  const v = source === 'ir' ? value & 0x0f : value;
  const out: Level[] = [];
  for (let bit = 7; bit >= 0; bit--) {
    if (mask & (1 << bit)) out.push(((v >> bit) & 1) as 0 | 1);
    else out.push(pulldowns ? 0 : 'Z');
  }
  return out;
}

/** What a 74LS173/273 latches from those lines: floating TTL inputs read as 1. */
export function ttlRead(levels: readonly Level[]): number {
  return levels.reduce<number>((acc, l) => (acc << 1) | (l === 0 ? 0 : 1), 0);
}

// ---------------------------------------------------------------------------
// Reset (video 39)

export type ResetKey = 'a' | 'b' | 'ir' | 'mar' | 'flags' | 'pc' | 'out' | 'step' | 'ram';

export interface ResetTarget {
  key: ResetKey;
  module: ModuleId;
  label: string;
  line: 'CLR' | 'CLR̅' | '—';
  chip: string;
}

export const RESET_TARGETS: ResetTarget[] = [
  { key: 'a', module: 'a', label: 'A register', line: 'CLR', chip: '74LS173 ×2, CLR pin' },
  { key: 'b', module: 'b', label: 'B register', line: 'CLR', chip: '74LS173 ×2, CLR pin' },
  { key: 'ir', module: 'ir', label: 'Instruction register', line: 'CLR', chip: '74LS173 ×2, CLR pin' },
  { key: 'mar', module: 'mar', label: 'Memory address register', line: 'CLR', chip: '74LS173, CLR pin' },
  { key: 'flags', module: 'flags', label: 'Flags (added in video 43)', line: 'CLR', chip: '74LS173, CLR pin' },
  { key: 'pc', module: 'pc', label: 'Program counter', line: 'CLR̅', chip: '74LS161, M̅R̅ pin' },
  { key: 'out', module: 'out', label: 'Output register', line: 'CLR̅', chip: '74LS273, M̅R̅ pin' },
  { key: 'step', module: 'control', label: 'Step counter', line: 'CLR̅', chip: '74LS161 M̅R̅, via NAND with O5̅' },
  { key: 'ram', module: 'ram', label: 'RAM contents', line: '—', chip: '74LS189 ×2: no reset pin' },
];

export interface ResettableState {
  a: number;
  b: number;
  ir: number;
  mar: number;
  pc: number;
  out: number;
  step: number;
  flagC: number;
  flagZ: number;
  ram: ArrayLike<number>;
}

export interface ResetRow extends ResetTarget {
  before: string;
  after: string;
  changed: boolean;
}

const fmtState = (s: ResettableState, key: ResetKey): string => {
  switch (key) {
    case 'a': return String(s.a);
    case 'b': return String(s.b);
    case 'ir': return disassemble(s.ir);
    case 'mar': return String(s.mar);
    case 'flags': return `C=${s.flagC} Z=${s.flagZ}`;
    case 'pc': return String(s.pc);
    case 'out': return String(s.out);
    case 'step': return `T${s.step}`;
    case 'ram': return Array.from(s.ram, (b) => b.toString(16).padStart(2, '0')).join(' ');
  }
};

/** Compare the state before and after pressing reset. */
export function resetEffects(before: ResettableState, after: ResettableState): ResetRow[] {
  return RESET_TARGETS.map((t) => {
    const b = fmtState(before, t.key);
    const a = fmtState(after, t.key);
    return { ...t, before: b, after: a, changed: a !== b };
  });
}

// ---------------------------------------------------------------------------
// Power distribution (video 39)

export interface RailParams {
  /** Breadboards in a chain, powered from board 1. */
  boards: number;
  /** Current drawn by each board, in amps. */
  currentPerBoard: number;
  /** Resistance of one rail from one board to the next (strip + jumper contacts), in ohms. */
  railOhms: number;
  /** Supply voltage at the connector, in volts. */
  supplyVolts: number;
  /** Resistance of the supply lead into board 1 (per rail), in ohms. */
  leadOhms: number;
  /** Extra feed wires running straight from the supply to boards further along. */
  feeds: number;
  /** Resistance of one feed wire (per rail), in ohms. */
  feedOhms: number;
  /** The ground rail drops by the same amount, so the chips see twice the drop. */
  groundToo: boolean;
}

export const DEFAULT_RAIL: RailParams = {
  boards: 12,
  currentPerBoard: 0.06,
  railOhms: 0.08,
  supplyVolts: 5,
  leadOhms: 0.05,
  feeds: 0,
  feedOhms: 0.05,
  groundToo: true,
};

/** Indices (0-based) of the boards that get an extra feed wire: spread out, the last one at the far end. */
export function feedPositions(boards: number, feeds: number): number[] {
  const out = new Set<number>();
  for (let i = 1; i <= feeds; i++) out.add(Math.round((i / feeds) * (boards - 1)));
  return [...out].sort((a, b) => a - b);
}

export interface RailResult {
  /** Voltage between VCC and GND at each board. */
  volts: number[];
  minVolts: number;
  totalCurrent: number;
  fed: number[];
}

/**
 * Nodal analysis of a chain of breadboard rails. Each board k draws
 * `currentPerBoard`; neighbouring boards are joined by `railOhms`; the
 * supply connects to board 0 through `leadOhms` and to the fed boards
 * through `feedOhms`. Solved with the tridiagonal (Thomas) algorithm.
 */
export function railVoltages(p: RailParams): RailResult {
  const n = Math.max(1, Math.round(p.boards));
  const g = 1 / Math.max(p.railOhms, 1e-6);
  const fed = feedPositions(n, Math.max(0, Math.round(p.feeds)));
  const gs = new Array<number>(n).fill(0);
  gs[0] += 1 / Math.max(p.leadOhms, 1e-6);
  for (const k of fed) gs[k] += 1 / Math.max(p.feedOhms, 1e-6);
  // Equation for node k (d = drop below the supply): gs_k d_k + Σ g (d_k − d_j) = I
  const a = new Array<number>(n).fill(0); // sub-diagonal
  const b = new Array<number>(n).fill(0); // diagonal
  const c = new Array<number>(n).fill(0); // super-diagonal
  const r = new Array<number>(n).fill(p.currentPerBoard);
  for (let k = 0; k < n; k++) {
    b[k] = gs[k];
    if (k > 0) { b[k] += g; a[k] = -g; }
    if (k < n - 1) { b[k] += g; c[k] = -g; }
  }
  for (let k = 1; k < n; k++) {
    const m = a[k] / b[k - 1];
    b[k] -= m * c[k - 1];
    r[k] -= m * r[k - 1];
  }
  const d = new Array<number>(n).fill(0);
  d[n - 1] = r[n - 1] / b[n - 1];
  for (let k = n - 2; k >= 0; k--) d[k] = (r[k] - c[k] * d[k + 1]) / b[k];
  const factor = p.groundToo ? 2 : 1;
  const volts = d.map((x) => p.supplyVolts - factor * x);
  return { volts, minVolts: Math.min(...volts), totalCurrent: n * p.currentPerBoard, fed };
}

/** 74LS TTL needs VCC between 4.75 V and 5.25 V. */
export const TTL_MIN_VOLTS = 4.75;

/**
 * Local VCC at a chip right after its outputs switch (clock edge). Without
 * a 0.1 µF decoupling capacitor the current spike has to come through the
 * long, inductive supply wiring, so VCC dips and rings; with the capacitor
 * next to the chip the dip is tiny. `t` is in arbitrary time units since the edge.
 */
export function vccAfterEdge(t: number, decoupled: boolean, vcc = 5): number {
  if (t < 0) return vcc;
  const amp = decoupled ? 0.08 : 0.9;
  const tau = decoupled ? 1.5 : 5;
  const omega = decoupled ? 0 : 0.9;
  return vcc - amp * Math.exp(-t / tau) * Math.cos(omega * t);
}
