/**
 * Pinouts of the chips used in Ben Eater's 8-bit computer (and a few more for
 * the sandbox). Pin names follow the TI / Fairchild datasheets; an overline
 * marks active-low pins (written with a trailing "̅" combining overline on
 * the first letter, e.g. "C̅L̅R̅" is written as "~CLR" here for ASCII
 * friendliness: a leading "~" means active low).
 *
 * `pins[0]` is pin 1.
 */

export interface ChipDef {
  /** Catalog id, also printed on the package, e.g. "74LS173". */
  id: string;
  /** One-line description. */
  title: string;
  pins: string[];
  /** Row spacing of the package in 0.1" (3 = 0.3" DIP, 6 = 0.6" DIP). */
  spacing: 3 | 6;
  vcc: number;
  gnd: number;
  /** Datasheet link (Ben's copies on eater.net where available). */
  datasheet?: string;
}

const quadGate = (id: string, title: string): ChipDef => ({
  id, title, spacing: 3, vcc: 14, gnd: 7,
  pins: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'],
});

export const CHIPS: Record<string, ChipDef> = {
  '74LS00': { ...quadGate('74LS00', 'Quad 2-input NAND'), datasheet: 'https://eater.net/datasheets/74ls00.pdf' },
  '74LS02': {
    id: '74LS02', title: 'Quad 2-input NOR', spacing: 3, vcc: 14, gnd: 7,
    pins: ['1Y', '1A', '1B', '2Y', '2A', '2B', 'GND', '3A', '3B', '3Y', '4A', '4B', '4Y', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls02.pdf',
  },
  '74LS04': {
    id: '74LS04', title: 'Hex inverter', spacing: 3, vcc: 14, gnd: 7,
    pins: ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls04.pdf',
  },
  '74LS08': { ...quadGate('74LS08', 'Quad 2-input AND'), datasheet: 'https://eater.net/datasheets/74ls08.pdf' },
  '74LS32': { ...quadGate('74LS32', 'Quad 2-input OR'), datasheet: 'https://eater.net/datasheets/74ls32.pdf' },
  '74LS86': { ...quadGate('74LS86', 'Quad 2-input XOR'), datasheet: 'https://eater.net/datasheets/74ls86.pdf' },
  '74LS74': {
    id: '74LS74', title: 'Dual D flip-flop with preset and clear', spacing: 3, vcc: 14, gnd: 7,
    pins: ['~1CLR', '1D', '1CLK', '~1PRE', '1Q', '~1Q', 'GND', '~2Q', '2Q', '~2PRE', '2CLK', '2D', '~2CLR', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls74.pdf',
  },
  '74LS76': {
    id: '74LS76', title: 'Dual JK flip-flop (negative-edge) with preset and clear', spacing: 3, vcc: 5, gnd: 13,
    pins: ['~1CLK', '~1PRE', '~1CLR', '1J', 'VCC', '~2CLK', '~2PRE', '~2CLR', '2J', '~2Q', '2Q', '2K', 'GND', '~1Q', '1Q', '1K'],
    datasheet: 'https://eater.net/datasheets/74ls76.pdf',
  },
  '74LS107': {
    id: '74LS107', title: 'Dual JK flip-flop (negative-edge) with clear', spacing: 3, vcc: 14, gnd: 7,
    pins: ['1J', '~1Q', '1Q', '1K', '2Q', '~2Q', 'GND', '2J', '~2CLK', '~2CLR', '2K', '~1CLK', '~1CLR', 'VCC'],
  },
  '74LS138': {
    id: '74LS138', title: '3-to-8 line decoder (active-low outputs)', spacing: 3, vcc: 16, gnd: 8,
    pins: ['A0', 'A1', 'A2', '~E1', '~E2', 'E3', '~Y7', 'GND', '~Y6', '~Y5', '~Y4', '~Y3', '~Y2', '~Y1', '~Y0', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls138.pdf',
  },
  '74LS139': {
    id: '74LS139', title: 'Dual 2-to-4 line decoder (active-low outputs)', spacing: 3, vcc: 16, gnd: 8,
    pins: ['~1E', '1A0', '1A1', '~1Y0', '~1Y1', '~1Y2', '~1Y3', 'GND', '~2Y3', '~2Y2', '~2Y1', '~2Y0', '2A1', '2A0', '~2E', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls139.pdf',
  },
  '74LS157': {
    id: '74LS157', title: 'Quad 2-to-1 multiplexer (S low selects I0)', spacing: 3, vcc: 16, gnd: 8,
    pins: ['S', '1I0', '1I1', '1Y', '2I0', '2I1', '2Y', 'GND', '3Y', '3I1', '3I0', '4Y', '4I1', '4I0', '~E', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls157.pdf',
  },
  '74LS161': {
    id: '74LS161', title: 'Synchronous 4-bit binary counter (async clear)', spacing: 3, vcc: 16, gnd: 8,
    pins: ['~MR', 'CP', 'P0', 'P1', 'P2', 'P3', 'CEP', 'GND', '~PE', 'CET', 'Q3', 'Q2', 'Q1', 'Q0', 'TC', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls161.pdf',
  },
  '74LS173': {
    id: '74LS173', title: '4-bit D register, 3-state outputs', spacing: 3, vcc: 16, gnd: 8,
    pins: ['~M', '~N', 'Q0', 'Q1', 'Q2', 'Q3', 'CP', 'GND', '~G1', '~G2', 'D3', 'D2', 'D1', 'D0', 'MR', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls173.pdf',
  },
  '74LS189': {
    id: '74LS189', title: '64-bit (16×4) RAM, inverted 3-state outputs', spacing: 3, vcc: 16, gnd: 8,
    pins: ['A0', '~CS', '~WE', 'D1', '~O1', 'D2', '~O2', 'GND', '~O3', 'D3', '~O4', 'D4', 'A3', 'A2', 'A1', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74189.pdf',
  },
  '74LS245': {
    id: '74LS245', title: 'Octal bus transceiver, 3-state', spacing: 3, vcc: 20, gnd: 10,
    pins: ['DIR', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'GND', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', '~OE', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls245.pdf',
  },
  '74LS273': {
    id: '74LS273', title: 'Octal D flip-flop with clear', spacing: 3, vcc: 20, gnd: 10,
    pins: ['~MR', 'Q0', 'D0', 'D1', 'Q1', 'Q2', 'D2', 'D3', 'Q3', 'GND', 'CP', 'Q4', 'D4', 'D5', 'Q5', 'Q6', 'D6', 'D7', 'Q7', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls273.pdf',
  },
  '74LS283': {
    id: '74LS283', title: '4-bit binary full adder with fast carry', spacing: 3, vcc: 16, gnd: 8,
    pins: ['S2', 'B2', 'A2', 'S1', 'A1', 'B1', 'C0', 'GND', 'C4', 'S4', 'B4', 'A4', 'S3', 'A3', 'B3', 'VCC'],
    datasheet: 'https://eater.net/datasheets/74ls283.pdf',
  },
  '28C16': {
    id: '28C16', title: '2K × 8 parallel EEPROM', spacing: 6, vcc: 24, gnd: 12,
    pins: ['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'IO0', 'IO1', 'IO2', 'GND', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', '~CE', 'A10', '~OE', '~WE', 'A9', 'A8', 'VCC'],
    datasheet: 'https://eater.net/datasheets/28c16.pdf',
  },
  NE555: {
    id: 'NE555', title: '555 timer', spacing: 3, vcc: 8, gnd: 1,
    pins: ['GND', 'TRIG', 'OUT', '~RESET', 'CV', 'THR', 'DIS', 'VCC'],
    datasheet: 'https://eater.net/datasheets/lm555.pdf',
  },
};

export const CHIP_IDS = Object.keys(CHIPS);

/** 1-based pin number of a named pin (case-insensitive). Throws if unknown. */
export function pinNumber(chip: ChipDef, name: string): number {
  const i = chip.pins.findIndex((p) => p.toLowerCase() === name.toLowerCase());
  if (i < 0) throw new Error(`${chip.id} has no pin "${name}" (pins: ${chip.pins.join(', ')})`);
  return i + 1;
}

/** Label for a pin as printed in the UI (leading "~" becomes an overline). */
export function prettyPin(name: string): string {
  return name.startsWith('~') ? [...name.slice(1)].map((ch) => ch + '̅').join('') : name;
}
