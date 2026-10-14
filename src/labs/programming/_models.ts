/**
 * Pure models for the "Programming the CPU" chapter labs (videos 40-44).
 * No DOM access here: everything is unit-tested in tests/labs-control.test.ts.
 */
import { assemble } from '../../sim/assembler';
import { Computer, computeAlu } from '../../sim/computer';
import { buildMicrocodeVersion, INSTRUCTION_BY_OPCODE, OPCODE_COUNT, type MicrocodeTemplate, type MicrocodeVersionId } from '../../sim/microcode';
import { AI, AO, BI, CE, CO, EO, FI, HLT, II, IO, J, MI, OI, RI, RO, SIGNALS, SIGNAL_BITS, SIGNAL_INFO, SU, formatControlWord } from '../../sim/signals';

// ---------------------------------------------------------------------------
// EEPROM dump and the Arduino sketch (video 40)

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');

/**
 * Ben's printContents(): 16 bytes per line, "%03x:  %02x ... %02x   %02x ... %02x".
 */
export function printContents(img: ArrayLike<number>, start = 0, length = 256): string[] {
  const lines: string[] = [];
  for (let base = start; base < start + length; base += 16) {
    const bytes = Array.from({ length: 16 }, (_, i) => hx(img[base + i] ?? 0, 2));
    lines.push(`${hx(base, 3)}:  ${bytes.slice(0, 8).join(' ')}   ${bytes.slice(8).join(' ')}`);
  }
  return lines;
}

/** Control words spelled the way Ben writes them in the sketch ("IO|MI", not "MI|IO"). */
const BEN_SPELLING = new Map<number, string>([
  [MI | CO, 'MI|CO'],
  [RO | II | CE, 'RO|II|CE'],
  [IO | MI, 'IO|MI'],
  [RO | AI, 'RO|AI'],
  [RO | BI, 'RO|BI'],
  [EO | AI, 'EO|AI'],
  [EO | AI | SU, 'EO|AI|SU'],
  [EO | AI | FI, 'EO|AI|FI'],
  [EO | AI | SU | FI, 'EO|AI|SU|FI'],
  [AO | RI, 'AO|RI'],
  [IO | AI, 'IO|AI'],
  [IO | J, 'IO|J'],
  [AO | OI, 'AO|OI'],
  [HLT, 'HLT'],
]);

/** A control word as C source: "MI|CO", or "0". */
export function benWord(word: number): string {
  if (!word) return '0';
  return BEN_SPELLING.get(word) ?? formatControlWord(word);
}

/** "#define MI  0b0100000000000000  // Memory address register in" */
export function defineLine(sig: (typeof SIGNALS)[number]): string {
  const comments: Record<string, string> = {
    HLT: 'Halt clock', MI: 'Memory address register in', RI: 'RAM data in', RO: 'RAM data out', IO: 'Instruction register out',
    II: 'Instruction register in', AI: 'A register in', AO: 'A register out', EO: 'ALU out', SU: 'ALU subtract', BI: 'B register in',
    OI: 'Output register in', CE: 'Program counter enable', CO: 'Program counter out', J: 'Jump (program counter in)', FI: 'Flags in',
  };
  return `#define ${sig.padEnd(3)} 0b${SIGNAL_BITS[sig].toString(2).padStart(16, '0')}  // ${comments[sig] ?? SIGNAL_INFO[sig].title}`;
}

/**
 * The part of the microcode sketch that Ben edits in video 40: the #defines
 * and the 16 × 8 table, regenerated from `template`. With `flags`, FI is
 * defined too (video 43 onwards).
 */
export function arduinoSketch(template: MicrocodeTemplate, opts: { flags?: boolean } = {}): string {
  const sigs = SIGNALS.filter((s) => opts.flags || s !== 'FI');
  const lines: string[] = sigs.map(defineLine);
  lines.push('', opts.flags ? 'uint16_t UCODE_TEMPLATE[16][8] = {' : 'uint16_t data[] = {');
  const cells = template.map((row) => Array.from({ length: 8 }, (_, s) => benWord(row[s] ?? 0)));
  const widths = Array.from({ length: 8 }, (_, s) => Math.max(...cells.map((r) => r[s].length)) + 1);
  for (let op = 0; op < OPCODE_COUNT; op++) {
    const name = INSTRUCTION_BY_OPCODE.get(op)?.mnemonic;
    const used = op === 0 || template[op].slice(2).some((w) => w !== 0) || (opts.flags && (op === 0b0111 || op === 0b1000));
    const shown = name && used ? name : '';
    const body = cells[op].map((c, s) => (s < 7 ? `${c},`.padEnd(widths[s] + 1) : c)).join(' ');
    const open = opts.flags ? '{ ' : '';
    const close = opts.flags ? ' },' : ',';
    lines.push(`  ${open}${body}${close}   // ${op.toString(2).padStart(4, '0')}${shown ? ` - ${shown}` : ''}`);
  }
  lines.push('};');
  return lines.join('\n');
}

/** The EEPROM-writing loop from the video 40 sketch (high bytes first, then low bytes at +128). */
export const PROGRAMMING_LOOP = `// Program the 8 high-order bits of microcode into the first 128 bytes of EEPROM
for (int address = 0; address < sizeof(data)/sizeof(data[0]); address += 1) {
  writeEEPROM(address, data[address] >> 8);
}
// Program the 8 low-order bits of microcode into the second 128 bytes of EEPROM
for (int address = 0; address < sizeof(data)/sizeof(data[0]); address += 1) {
  writeEEPROM(address + 128, data[address]);
}
printContents();`;

/** Indices where two images differ. */
export function diffBytes(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// EEPROM address layout (videos 38, 40, 43, 44)

export const FLAG_COMBO_NAMES = ['FLAGS_Z0C0', 'FLAGS_Z0C1', 'FLAGS_Z1C0', 'FLAGS_Z1C1'] as const;

export interface EepromAddress {
  address: number;
  flags: number;
  zf: number;
  cf: number;
  /** 0 = high byte (left chip, A7 = GND), 1 = low byte (right chip, A7 = VCC). */
  byteSel: number;
  opcode: number;
  step: number;
}

/** address = ZF<<9 | CF<<8 | byteSel<<7 | opcode<<3 | step */
export function eepromAddress(flags: number, byteSel: number, opcode: number, step: number): number {
  return ((flags & 3) << 8) | ((byteSel & 1) << 7) | ((opcode & 15) << 3) | (step & 7);
}

export function decodeEepromAddress(address: number): EepromAddress {
  const flags = (address >> 8) & 3;
  return { address, flags, zf: flags >> 1, cf: flags & 1, byteSel: (address >> 7) & 1, opcode: (address >> 3) & 15, step: address & 7 };
}

/** Addresses (within one 256-byte quadrant) whose byte differs between the four flag copies. */
export function quadrantDiffs(img: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let a = 0; a < 256; a++) {
    const v = img[a];
    if (img[a + 256] !== v || img[a + 512] !== v || img[a + 768] !== v) out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Running programs

export interface RunResult {
  outputs: number[];
  halted: boolean;
  cycles: number;
  /** Rising-edge number of each OUT. */
  outputEdges: number[];
  computer: Computer;
}

/** Assemble and run a program with a given microcode version, collecting OUT values. */
export function runProgram(source: string, version: MicrocodeVersionId, maxCycles = 5000, maxOutputs = 64, ram?: (ram: Uint8Array) => void): RunResult {
  const asm = assemble(source);
  if (asm.errors.length) throw new Error(asm.errors.map((e) => `line ${e.line}: ${e.message}`).join('; '));
  const c = new Computer({ microcode: buildMicrocodeVersion(version), ram: asm.bytes });
  ram?.(c.ram);
  const outputs: number[] = [];
  const outputEdges: number[] = [];
  let cycles = 0;
  while (cycles < maxCycles && outputs.length < maxOutputs) {
    if (!c.tick()) break;
    cycles++;
    if (c.lastTransfers.some((t) => t.signal === 'OI')) {
      outputs.push(c.out);
      outputEdges.push(c.risingEdges);
    }
  }
  return { outputs, halted: c.halted, cycles, outputEdges, computer: c };
}

/** Clock cycles between consecutive OUTs. */
export const gaps = (edges: number[]) => edges.slice(1).map((e, i) => e - edges[i]);

/** Ben's multiply program (video 44) with x at 14 and y at 15. */
export function multiplySource(x: number, y: number): string {
  return `; product = x * y (Ben's multiply, video 44)
top:    LDA x
        SUB one
        JC  cont      ; carry set unless x was 0
        LDA product
        OUT
        HLT
cont:   STA x         ; x = x - 1
        LDA product
        ADD y
        STA product   ; product += y
        JMP top

12: one:     1
13: product: 0
14: x:       ${x & 0xff}
15: y:       ${y & 0xff}
`;
}

/**
 * The best a multiply loop can do without a conditional jump: it adds y
 * and counts x down, but nothing can stop it when x reaches 0, so it runs
 * forever and both values wrap around.
 */
export function multiplyNoBranchSource(x: number, y: number): string {
  return `; product = x * y ... without a conditional jump
top:    LDA product
        ADD y
        STA product   ; product += y
        OUT           ; show the running product
        LDA x
        SUB one
        STA x         ; x = x - 1, but nothing can stop at 0
        JMP top       ; so the loop never ends

12: one:     1
13: product: 0
14: x:       ${x & 0xff}
15: y:       ${y & 0xff}
`;
}

/**
 * x − 1 as the ALU does it: x + NOT(1) + 1. The carry out is set for every
 * x except 0, which is what the multiply loop tests with JC.
 */
export function minusOne(x: number) {
  return computeAlu(x & 0xff, 1, true);
}

// ---------------------------------------------------------------------------
// Flags hardware (video 43)

export interface ZeroDetect {
  /** 74LS02 outputs: NOR(S0,S1), NOR(S2,S3), NOR(S4,S5), NOR(S6,S7). */
  nors: [number, number, number, number];
  /** 74LS08: U23A = NOR1·NOR2, U23C = NOR3·NOR4. */
  and1: number;
  and2: number;
  /** U23B: the zero flag input. */
  zero: number;
}

export function zeroDetect(sum: number): ZeroDetect {
  const bit = (i: number) => (sum >> i) & 1;
  const nor = (a: number, b: number) => (a | b ? 0 : 1);
  const nors: [number, number, number, number] = [nor(bit(0), bit(1)), nor(bit(2), bit(3)), nor(bit(4), bit(5)), nor(bit(6), bit(7))];
  const and1 = nors[0] & nors[1];
  const and2 = nors[2] & nors[3];
  return { nors, and1, and2, zero: and1 & and2 };
}

/** Opcodes whose microcode asserts FI somewhere (only ADD and SUB in Ben's final microcode). */
export function opcodesSettingFlags(template: MicrocodeTemplate): number[] {
  return template.map((row, op) => (row.some((w) => w & FI) ? op : -1)).filter((op) => op >= 0);
}

// ---------------------------------------------------------------------------
// A tiny Turing machine (video 42)

export type Sym = '0' | '1' | '_';

export interface TmRule {
  state: string;
  read: Sym;
  write: Sym;
  move: -1 | 0 | 1;
  next: string;
}

/** Binary incrementer: walk to the right end, then add 1 with carry. */
export const INCREMENTER: TmRule[] = [
  { state: 'right', read: '0', write: '0', move: 1, next: 'right' },
  { state: 'right', read: '1', write: '1', move: 1, next: 'right' },
  { state: 'right', read: '_', write: '_', move: -1, next: 'carry' },
  { state: 'carry', read: '1', write: '0', move: -1, next: 'carry' },
  { state: 'carry', read: '0', write: '1', move: 0, next: 'halt' },
  { state: 'carry', read: '_', write: '1', move: 0, next: 'halt' },
];

export interface TmState {
  tape: Sym[];
  head: number;
  state: string;
  steps: number;
}

export function tmInit(bits: string): TmState {
  const clean = bits.replace(/[^01]/g, '') || '0';
  return { tape: ['_', ...(clean.split('') as Sym[]), '_'], head: 1, state: 'right', steps: 0 };
}

export function tmFindRule(rules: readonly TmRule[], s: TmState): TmRule | null {
  const read = s.tape[s.head] ?? '_';
  return rules.find((r) => r.state === s.state && r.read === read) ?? null;
}

/** One step; returns the rule used (null when halted). Grows the tape with blanks as needed. */
export function tmStep(rules: readonly TmRule[], s: TmState): TmRule | null {
  if (s.state === 'halt') return null;
  const rule = tmFindRule(rules, s);
  if (!rule) {
    s.state = 'halt';
    return null;
  }
  s.tape[s.head] = rule.write;
  s.head += rule.move;
  if (s.head < 0) {
    s.tape.unshift('_');
    s.head = 0;
  }
  if (s.head >= s.tape.length) s.tape.push('_');
  s.state = rule.next;
  s.steps++;
  return rule;
}

export function tapeValue(tape: readonly Sym[]): number {
  const bits = tape.join('').replace(/_/g, '');
  return bits ? parseInt(bits, 2) : 0;
}
