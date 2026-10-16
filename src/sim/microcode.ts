import { AI, AO, BI, CE, CO, EO, FI, HLT, II, IO, J, MI, OI, RI, RO, SU } from './signals';

/**
 * Microcode for Ben Eater's 8-bit computer.
 *
 * A microcode ROM maps (flags, opcode, step) -> 16-bit control word. In
 * hardware it lives in two 28C16 EEPROMs (one per byte). The final version
 * (CPU flags register / conditional jumps videos) uses the address layout
 *
 *   A9 A8 | A7       | A6 A5 A4 A3 | A2 A1 A0
 *   flags | byte sel | opcode      | step
 *
 * where flags = ZF<<1 | CF and byte select 0 = high byte (HLT..AO),
 * 1 = low byte (EO..FI). Both EEPROMs hold the same image; A7 is tied low on
 * the left chip and high on the right one.
 */

export const STEPS = 8; // microcode slots per instruction (the counter only reaches 5)
export const FLAG_COMBOS = 4;
export const OPCODE_COUNT = 16;

export const FLAG_C = 0b01;
export const FLAG_Z = 0b10;

export type MicrocodeTemplate = readonly (readonly number[])[]; // [opcode][step]

/** A complete microcode table: index = flags<<7 | opcode<<3 | step. */
export type Microcode = Uint16Array;

export const microIndex = (flags: number, opcode: number, step: number) =>
  ((flags & 3) << 7) | ((opcode & 15) << 3) | (step & 7);

const FETCH = [MI | CO, RO | II | CE] as const;
const row = (...rest: number[]): number[] => {
  const r = [...FETCH, ...rest];
  while (r.length < STEPS) r.push(0);
  return r;
};

export type MicrocodeVersionId = 'control-logic' | 'arduino' | 'more-instructions' | 'flags';

export interface InstructionDef {
  mnemonic: string;
  opcode: number;
  /** Whether the low nibble is an operand (address or immediate). */
  operand: 'address' | 'immediate' | 'none';
  description: string;
  /** Microcode version where the instruction first appears. */
  since: MicrocodeVersionId;
}

export const INSTRUCTIONS: InstructionDef[] = [
  { mnemonic: 'NOP', opcode: 0b0000, operand: 'none', description: 'No operation', since: 'control-logic' },
  { mnemonic: 'LDA', opcode: 0b0001, operand: 'address', description: 'A ← RAM[addr]', since: 'control-logic' },
  { mnemonic: 'ADD', opcode: 0b0010, operand: 'address', description: 'A ← A + RAM[addr]', since: 'control-logic' },
  { mnemonic: 'SUB', opcode: 0b0011, operand: 'address', description: 'A ← A − RAM[addr]', since: 'arduino' },
  { mnemonic: 'STA', opcode: 0b0100, operand: 'address', description: 'RAM[addr] ← A', since: 'more-instructions' },
  { mnemonic: 'LDI', opcode: 0b0101, operand: 'immediate', description: 'A ← 4-bit immediate', since: 'more-instructions' },
  { mnemonic: 'JMP', opcode: 0b0110, operand: 'address', description: 'PC ← addr', since: 'more-instructions' },
  { mnemonic: 'JC', opcode: 0b0111, operand: 'address', description: 'PC ← addr if carry flag set', since: 'flags' },
  { mnemonic: 'JZ', opcode: 0b1000, operand: 'address', description: 'PC ← addr if zero flag set', since: 'flags' },
  { mnemonic: 'OUT', opcode: 0b1110, operand: 'none', description: 'Output ← A', since: 'control-logic' },
  { mnemonic: 'HLT', opcode: 0b1111, operand: 'none', description: 'Halt the clock', since: 'control-logic' },
];

export const INSTRUCTION_BY_MNEMONIC = new Map(INSTRUCTIONS.map((i) => [i.mnemonic, i]));
export const INSTRUCTION_BY_OPCODE = new Map(INSTRUCTIONS.map((i) => [i.opcode, i]));

/** Final template, verbatim from microcode-eeprom-with-flags.ino (flags-independent part). */
export const UCODE_TEMPLATE_FLAGS: MicrocodeTemplate = [
  row(), //                                0000 - NOP
  row(IO | MI, RO | AI), //                0001 - LDA
  row(IO | MI, RO | BI, EO | AI | FI), //  0010 - ADD
  row(IO | MI, RO | BI, EO | AI | SU | FI), // 0011 - SUB
  row(IO | MI, AO | RI), //                0100 - STA
  row(IO | AI), //                         0101 - LDI
  row(IO | J), //                          0110 - JMP
  row(), //                                0111 - JC  (patched per flags)
  row(), //                                1000 - JZ  (patched per flags)
  row(), //                                1001
  row(), //                                1010
  row(), //                                1011
  row(), //                                1100
  row(), //                                1101
  row(AO | OI), //                         1110 - OUT
  row(HLT), //                             1111 - HLT
];

/** "Adding more machine language instructions": SUB, STA, LDI, JMP; no flags yet. */
export const UCODE_TEMPLATE_MORE: MicrocodeTemplate = UCODE_TEMPLATE_FLAGS.map((r, op) =>
  op === 0b0111 || op === 0b1000 ? row() : r.map((w) => w & ~FI),
);

/** "Reprogramming CPU microcode with an Arduino": adds SUB. */
export const UCODE_TEMPLATE_ARDUINO: MicrocodeTemplate = UCODE_TEMPLATE_FLAGS.map((r, op) =>
  [0b0001, 0b0010, 0b0011, 0b1110, 0b1111].includes(op) ? r.map((w) => w & ~FI) : row(),
);

/** "8-bit CPU control logic: Part 3": LDA, ADD, OUT, HLT. */
export const UCODE_TEMPLATE_BASIC: MicrocodeTemplate = UCODE_TEMPLATE_FLAGS.map((r, op) =>
  [0b0001, 0b0010, 0b1110, 0b1111].includes(op) ? r.map((w) => w & ~FI) : row(),
);

export interface MicrocodeVersion {
  id: MicrocodeVersionId;
  title: string;
  /** Video (1-based playlist index) that introduces this version. */
  video: number;
  template: MicrocodeTemplate;
  conditionalJumps: boolean;
}

export const MICROCODE_VERSIONS: Record<MicrocodeVersionId, MicrocodeVersion> = {
  'control-logic': { id: 'control-logic', title: 'Control logic (LDA, ADD, OUT, HLT)', video: 38, template: UCODE_TEMPLATE_BASIC, conditionalJumps: false },
  arduino: { id: 'arduino', title: 'Arduino-programmed (+SUB)', video: 40, template: UCODE_TEMPLATE_ARDUINO, conditionalJumps: false },
  'more-instructions': { id: 'more-instructions', title: 'More instructions (+SUB, STA, LDI, JMP)', video: 41, template: UCODE_TEMPLATE_MORE, conditionalJumps: false },
  flags: { id: 'flags', title: 'Flags & conditional jumps (+JC, JZ)', video: 44, template: UCODE_TEMPLATE_FLAGS, conditionalJumps: true },
};

/**
 * Expand a template to a full (flags × opcode × step) table. With
 * `conditionalJumps`, JC/JZ get `IO|J` in step 2 when their flag is set,
 * exactly like Ben's initUCode().
 */
export function buildMicrocode(template: MicrocodeTemplate = UCODE_TEMPLATE_FLAGS, conditionalJumps = true): Microcode {
  const mc = new Uint16Array(FLAG_COMBOS * OPCODE_COUNT * STEPS);
  for (let flags = 0; flags < FLAG_COMBOS; flags++) {
    for (let op = 0; op < OPCODE_COUNT; op++) {
      for (let step = 0; step < STEPS; step++) mc[microIndex(flags, op, step)] = template[op]?.[step] ?? 0;
    }
    if (conditionalJumps) {
      if (flags & FLAG_C) mc[microIndex(flags, 0b0111, 2)] = IO | J;
      if (flags & FLAG_Z) mc[microIndex(flags, 0b1000, 2)] = IO | J;
    }
  }
  return mc;
}

export function buildMicrocodeVersion(id: MicrocodeVersionId): Microcode {
  const v = MICROCODE_VERSIONS[id];
  return buildMicrocode(v.template, v.conditionalJumps);
}

/**
 * The 2 KB image Ben burns into both control-logic EEPROMs (28C16), using
 * the address layout documented above. Unused addresses (A10) are 0.
 */
export function microcodeEepromImage(mc: Microcode): Uint8Array {
  const img = new Uint8Array(2048);
  for (let address = 0; address < 1024; address++) {
    const flags = (address & 0b1100000000) >> 8;
    const byteSel = (address & 0b0010000000) >> 7;
    const opcode = (address & 0b0001111000) >> 3;
    const step = address & 0b0000000111;
    const word = mc[microIndex(flags, opcode, step)];
    img[address] = byteSel ? word & 0xff : word >> 8;
  }
  return img;
}

/** Read a control word back out of an EEPROM image (inverse of microcodeEepromImage). */
export function controlWordFromEeprom(img: Uint8Array, flags: number, opcode: number, step: number): number {
  const base = ((flags & 3) << 8) | ((opcode & 15) << 3) | (step & 7);
  return (img[base] << 8) | img[base | 0b0010000000];
}
