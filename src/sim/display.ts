/**
 * 7-segment encodings and the output-display EEPROM from Ben's
 * "Build an 8-bit decimal display" video (multiplexed-display.ino).
 *
 * Segment byte layout (common cathode, 1 = lit):
 *   bit 7  6  5  4  3  2  1  0
 *       dp a  b  c  d  e  f  g
 */

export const SEG = { dp: 0x80, a: 0x40, b: 0x20, c: 0x10, d: 0x08, e: 0x04, f: 0x02, g: 0x01 } as const;
export type SegmentName = keyof typeof SEG;
export const SEGMENT_NAMES: SegmentName[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];

/** Hex digits 0-F as used in the "Using an EEPROM to replace combinational logic" video. */
export const HEX_DIGITS = [0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b, 0x77, 0x1f, 0x4e, 0x3d, 0x4f, 0x47] as const;

/** Decimal digits 0-9 (digits[] in multiplexed-display.ino). */
export const DEC_DIGITS = HEX_DIGITS.slice(0, 10);

export const MINUS = SEG.g;
export const BLANK = 0x00;

/**
 * Output display EEPROM image (2 KB). Address layout:
 *   A10    : 0 = unsigned, 1 = two's complement
 *   A9 A8  : digit select (0 = ones, 1 = tens, 2 = hundreds, 3 = sign)
 *   A7..A0 : value from the output register
 */
export function displayEepromImage(): Uint8Array {
  const img = new Uint8Array(2048);
  for (let value = 0; value <= 255; value++) {
    img[value] = DEC_DIGITS[value % 10];
    img[value + 256] = DEC_DIGITS[Math.floor(value / 10) % 10];
    img[value + 512] = DEC_DIGITS[Math.floor(value / 100) % 10];
    img[value + 768] = BLANK;
  }
  for (let value = -128; value <= 127; value++) {
    const byte = value & 0xff;
    const abs = Math.abs(value);
    img[byte + 1024] = DEC_DIGITS[abs % 10];
    img[byte + 1280] = DEC_DIGITS[Math.floor(abs / 10) % 10];
    img[byte + 1536] = DEC_DIGITS[Math.floor(abs / 100) % 10];
    img[byte + 1792] = value < 0 ? MINUS : BLANK;
  }
  return img;
}

const DISPLAY_IMG = displayEepromImage();

/**
 * Segment bytes for the 4 display digits, left to right
 * [sign, hundreds, tens, ones], exactly as the EEPROM produces them
 * (note: Ben's EEPROM does not blank leading zeros).
 */
export function displaySegments(value: number, signed: boolean): [number, number, number, number] {
  const base = (signed ? 1024 : 0) | (value & 0xff);
  return [DISPLAY_IMG[base + 768], DISPLAY_IMG[base + 512], DISPLAY_IMG[base + 256], DISPLAY_IMG[base]];
}

/** Text the display shows, for tests/accessibility, e.g. " 042" or "-128". */
export function displayText(value: number, signed: boolean): string {
  return displaySegments(value, signed)
    .map((s) => {
      if (s === BLANK) return ' ';
      if (s === MINUS) return '-';
      const d = DEC_DIGITS.indexOf(s as (typeof DEC_DIGITS)[number]);
      return d >= 0 ? String(d) : '?';
    })
    .join('');
}

export const toSigned8 = (v: number) => ((v & 0xff) ^ 0x80) - 0x80;
