import { LayoutBuilder, type Layout } from '../layout';

/**
 * Hex display from an EEPROM (videos 30-31): a 4-position DIP switch sets
 * address A0-A3 of a 28C16 programmed with Ben's hex-digit table (image
 * "hex", the common-anode codes 81 CF 92 86 ... from eeprom-programmer.ino),
 * whose data lines drive a common-anode 7-segment display.
 *   - DIP switches connect A0-A3 to +5 V, with 10 kΩ pull-downs (video 31).
 *   - A4-A10, ~CE and ~OE to GND, ~WE to +5 V: always reading.
 *   - IO0..IO7 -> segments g f e d c b a dp (Ben's bit order: dp is the MSB).
 *   - The common anode goes to +5 V through one 100 Ω resistor, as Ben did.
 * A segment lights when its data bit is 0.
 *
 * The EEPROM is turned 180° so that A0-A7 face the DIP switch.
 */
export function buildHexDisplay(): Layout {
  const b = new LayoutBuilder();
  const bb = b.board('hex', { x: 0, y: 0 }, 'EEPROM hex display (28C16)');

  // rotated 180°: pins 1-12 run right to left in row d (A7 d34 .. A0 d27, IO0 d26, IO1 d25, IO2 d24, GND d23),
  // pins 13-24 left to right in row h (IO3 h23 .. IO7 h27, ~CE h28, A10 h29, ~OE h30, ~WE h31, A9 h32, A8 h33, VCC h34)
  const U1 = bb.chip('U1', '28C16', 34, { rotated: true, params: { image: 'hex' } });
  bb.toGnd('a23');
  bb.toVcc('j34');
  bb.toVcc('j31'); // ~WE high
  for (const pin of ['~CE', 'A10', '~OE', 'A9', 'A8']) bb.toGnd(`j${U1.pin(pin).slice(1)}`);
  for (const pin of ['A4', 'A5', 'A6', 'A7']) bb.toGnd(`a${U1.pin(pin).slice(1)}`);

  // DIP switch SW1 (cols 40-43): bottom legs to +5 V, top legs are A0-A3 with 10 kΩ pull-downs
  bb.dip('SW1', 4, 40, undefined, 'A0-A3');
  for (let k = 0; k < 4; k++) {
    const col = 40 + k;
    const dest = Number(U1.pin(`A${k}`).slice(1)); // 27..30
    bb.wire(`j${col}`, `bp${col}`, 'red');
    bb.resistor(`R${k + 1}`, 10_000, `a${col}`, `tn${col}`);
    const lane = 5.9 - 0.6 * k; // A0 lowest, A3 highest: no crossings
    bb.wire(`d${col}`, `a${dest}`, 'blue', [[col + 0.5, lane], [dest + 0.5, lane]]);
  }

  // common-anode display DS1 (cols 12-16): top g d12, f d13, com d14, a d15, b d16; bottom e h12, d h13, com h14, c h15, dp h16
  bb.seg7('DS1', 12, 'anode');
  bb.resistor('R5', 100, 'a14', 'tp15'); // common anode to +5 V

  // data lines to the segments
  const x = (col: number) => col + 0.5;
  bb.wire('a25', 'a13', 'green', [[x(25), 4.0], [x(13), 4.0]]); // IO1 -> f
  bb.wire('a26', 'a12', 'green', [[x(26), 4.5], [x(12), 4.5]]); // IO0 -> g
  bb.wire('c24', 'i12', 'green', [[x(24), 6.0], [x(17), 6.0], [x(17), 10.0], [x(12), 10.0]]); // IO2 -> e
  bb.wire('i23', 'i13', 'green', [[x(23), 11.5], [x(13), 11.5]]); // IO3 -> d
  bb.wire('i24', 'i15', 'green', [[x(24), 11.0], [x(15), 11.0]]); // IO4 -> c
  bb.wire('i25', 'c16', 'green', [[x(25), 9.5], [x(19), 9.5], [x(19), 5.5]]); // IO5 -> b
  bb.wire('i26', 'c15', 'green', [[x(26), 9.0], [x(20), 9.0], [x(20), 5.0], [x(15), 5.0]]); // IO6 -> a
  bb.wire('i27', 'i16', 'green', [[x(27), 12.0], [x(16), 12.0]]); // IO7 -> dp

  return b.build();
}
