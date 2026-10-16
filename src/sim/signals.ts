/**
 * The 16 control signals of Ben Eater's 8-bit computer, in microcode-word
 * bit order (bit 15 = MSB = HLT ... bit 0 = FI), as defined in
 * beneater/eeprom-programmer `microcode-eeprom-with-flags.ino`.
 *
 * The high byte (HLT..AO) is driven by the left EEPROM, the low byte
 * (EO..FI) by the right one.
 */

export const SIGNALS = ['HLT', 'MI', 'RI', 'RO', 'IO', 'II', 'AI', 'AO', 'EO', 'SU', 'BI', 'OI', 'CE', 'CO', 'J', 'FI'] as const;
export type Signal = (typeof SIGNALS)[number];

export const HLT = 1 << 15; // Halt clock
export const MI = 1 << 14; //  Memory address register in
export const RI = 1 << 13; //  RAM data in
export const RO = 1 << 12; //  RAM data out
export const IO = 1 << 11; //  Instruction register out
export const II = 1 << 10; //  Instruction register in
export const AI = 1 << 9; //   A register in
export const AO = 1 << 8; //   A register out
export const EO = 1 << 7; //   ALU (Σ) out
export const SU = 1 << 6; //   ALU subtract
export const BI = 1 << 5; //   B register in
export const OI = 1 << 4; //   Output register in
export const CE = 1 << 3; //   Program counter enable (count)
export const CO = 1 << 2; //   Program counter out
export const J = 1 << 1; //    Jump (program counter in)
export const FI = 1 << 0; //   Flags register in

export const SIGNAL_BITS: Record<Signal, number> = { HLT, MI, RI, RO, IO, II, AI, AO, EO, SU, BI, OI, CE, CO, J, FI };

export type ModuleId = 'clock' | 'pc' | 'mar' | 'ram' | 'ir' | 'a' | 'alu' | 'b' | 'out' | 'flags' | 'control' | 'bus' | 'input';

export interface SignalInfo {
  name: Signal;
  bit: number;
  /** Short human description. */
  title: string;
  /** Longer explanation for tooltips / the control-signal lab. */
  description: string;
  /** Module the signal controls. */
  module: ModuleId;
  /** 'in' = latches from bus on the clock edge, 'out' = drives the bus. */
  role: 'in' | 'out' | 'other';
  /** True if the chip input is active-low (the line is inverted on the board). */
  activeLowInHardware: boolean;
}

export const SIGNAL_INFO: Record<Signal, SignalInfo> = {
  HLT: { name: 'HLT', bit: 15, title: 'Halt', description: 'Stops the clock (gated in the clock module).', module: 'clock', role: 'other', activeLowInHardware: false },
  MI: { name: 'MI', bit: 14, title: 'Memory address in', description: 'MAR latches the low 4 bits of the bus on the next rising clock edge.', module: 'mar', role: 'in', activeLowInHardware: true },
  RI: { name: 'RI', bit: 13, title: 'RAM in', description: 'Writes the bus into RAM at the address in the MAR while the clock is high.', module: 'ram', role: 'in', activeLowInHardware: false },
  RO: { name: 'RO', bit: 12, title: 'RAM out', description: 'RAM at the current address drives the bus.', module: 'ram', role: 'out', activeLowInHardware: true },
  IO: { name: 'IO', bit: 11, title: 'Instruction register out', description: 'Low 4 bits of the IR (the operand) drive the bus.', module: 'ir', role: 'out', activeLowInHardware: true },
  II: { name: 'II', bit: 10, title: 'Instruction register in', description: 'IR latches the whole bus on the next rising clock edge.', module: 'ir', role: 'in', activeLowInHardware: true },
  AI: { name: 'AI', bit: 9, title: 'A register in', description: 'A latches the bus on the next rising clock edge.', module: 'a', role: 'in', activeLowInHardware: true },
  AO: { name: 'AO', bit: 8, title: 'A register out', description: 'A drives the bus.', module: 'a', role: 'out', activeLowInHardware: true },
  EO: { name: 'EO', bit: 7, title: 'Sum out (Σ)', description: 'ALU result drives the bus.', module: 'alu', role: 'out', activeLowInHardware: true },
  SU: { name: 'SU', bit: 6, title: 'Subtract', description: 'ALU computes A − B (B inverted through XOR gates, carry-in = 1).', module: 'alu', role: 'other', activeLowInHardware: false },
  BI: { name: 'BI', bit: 5, title: 'B register in', description: 'B latches the bus on the next rising clock edge.', module: 'b', role: 'in', activeLowInHardware: true },
  OI: { name: 'OI', bit: 4, title: 'Output register in', description: 'Output register latches the bus on the next rising clock edge.', module: 'out', role: 'in', activeLowInHardware: false },
  CE: { name: 'CE', bit: 3, title: 'Counter enable', description: 'Program counter increments on the next rising clock edge.', module: 'pc', role: 'other', activeLowInHardware: false },
  CO: { name: 'CO', bit: 2, title: 'Counter out', description: 'Program counter drives the low 4 bits of the bus.', module: 'pc', role: 'out', activeLowInHardware: true },
  J: { name: 'J', bit: 1, title: 'Jump', description: 'Program counter loads the low 4 bits of the bus on the next rising clock edge.', module: 'pc', role: 'in', activeLowInHardware: true },
  FI: { name: 'FI', bit: 0, title: 'Flags in', description: 'Flags register latches carry and zero from the ALU on the next rising clock edge.', module: 'flags', role: 'in', activeLowInHardware: true },
};

/** Signals asserted in a control word, MSB first. */
export function signalsIn(word: number): Signal[] {
  return SIGNALS.filter((s) => (word & SIGNAL_BITS[s]) !== 0);
}

/** Format a control word the way Ben writes microcode: "MI|CO". 0 -> "—". */
export function formatControlWord(word: number): string {
  const s = signalsIn(word);
  return s.length ? s.join('|') : '—';
}

/** Parse "MI|CO", "MI CO", "mi,co" ... into a control word. Throws on unknown names. */
export function parseControlWord(text: string): number {
  const parts = text
    .split(/[\s|,+]+/)
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p && p !== '0' && p !== '—' && p !== '-');
  let word = 0;
  for (const p of parts) {
    const name = (p === 'ΣO' || p === 'SO' ? 'EO' : p) as Signal;
    if (!(name in SIGNAL_BITS)) throw new Error(`Unknown control signal "${p}"`);
    word |= SIGNAL_BITS[name];
  }
  return word;
}
