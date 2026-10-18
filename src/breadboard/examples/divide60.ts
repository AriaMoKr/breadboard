import { LayoutBuilder, type Layout } from '../layout';

/** Half period of the 555 in gate delays: it stands in for Ben's 60 Hz square wave. */
export const DIVIDE60_HALF_PERIOD = 20;

/**
 * Dividing 60 Hz down to one pulse a second (breadboard clock part 3), wired as Ben did:
 *   - A 555 astable stands in for the 60 Hz square wave that Ben extracts from the mains
 *     with an LM339 comparator (parts 1-2), which the sandbox can't simulate.
 *   - U2, a 74LS90: the "60 Hz" into ~CP0 (pin 14), Q0 (pin 12) round to ~CP1 (pin 1),
 *     so it divides by 2 and then by 5: 30 Hz on Q0, 6 Hz on Q3 (pin 11).
 *   - U3, a 74LS92: the 6 Hz into ~CP0, Q0 round to ~CP1, so it divides by 2 and then
 *     by 3: 3 Hz on Q0, 1 Hz on Q2 (pin 9), where Ben put his LED.
 *   - Every reset pin (MR1, MR2, and the 74LS90's MS1, MS2) to ground.
 * LEDs from 30 Hz to 1 Hz show each stage blinking slower than the last.
 */
export function buildDivide60(): Layout {
  const b = new LayoutBuilder();
  const bb = b.board('div', { x: 0, y: 0 }, '60 Hz ÷ 60 (74LS90, 74LS92)');

  // ---- 555 astable (U1): GND f3, TRIG f4, OUT f5, ~RESET f6; VCC e3, DIS e4, THR e5, CV e6
  const U1 = bb.chip('U1', 'NE555', 3, { params: { mode: 'astable', halfPeriod: DIVIDE60_HALF_PERIOD } });
  bb.toVcc(U1.pin('VCC'));
  bb.toGnd('j3');
  bb.toVcc('j6'); // ~RESET high
  bb.resistor('R1', 1000, 'a4', 'tp4');
  bb.resistor('R2', 100_000, 'c4', 'c5');
  bb.wire('d5', 'g4', 'white'); // THR to TRIG, over the chip
  bb.capacitor('C1', 10e-6, 'i4', 'bn4', true);
  bb.capacitor('C2', 0.01e-6, 'a6', 'tn6');
  bb.led('D1', 'blue', 'h5', 'h7', '60 Hz');
  bb.resistor('R3', 220, 'i7', 'bn7');

  // ---- U2 74LS90: ~CP1 f12, MR1 f13, MR2 f14, NC f15, VCC f16, MS1 f17, MS2 f18;
  //      ~CP0 e12, NC e13, Q0 e14, Q3 e15, GND e16, Q1 e17, Q2 e18
  bb.chip('U2', '74LS90', 12);
  bb.toVcc('j16');
  bb.toGnd('a16');
  for (const col of [13, 14, 17, 18]) bb.toGnd(`j${col}`); // MR1, MR2, MS1, MS2
  bb.wire('i5', 'd12', 'yellow', [[5.5, 13.0], [10.5, 13.0], [10.5, 6.5]]); // the "60 Hz" -> ~CP0
  bb.wire('c14', 'g12', 'white'); // Q0 -> ~CP1, over the chip
  bb.led('D2', 'green', 'a14', bb.railHole('tn', 14), '30 Hz');
  bb.led('D3', 'green', 'a15', bb.railHole('tn', 15), '6 Hz');

  // ---- U3 74LS92: ~CP1 f24, NC f25-f27, VCC f28, MR1 f29, MR2 f30;
  //      ~CP0 e24, NC e25, Q0 e26, Q1 e27, GND e28, Q2 e29, Q3 e30
  bb.chip('U3', '74LS92', 24);
  bb.toVcc('j28');
  bb.toGnd('a28');
  bb.toGnd('j29'); // MR1
  bb.toGnd('j30'); // MR2
  bb.wireLane('d15', 'd24', 5.0, 'yellow'); // 6 Hz -> ~CP0
  bb.wire('c26', 'g24', 'white'); // Q0 -> ~CP1, over the chip
  bb.led('D4', 'green', 'a26', bb.railHole('tn', 26), '3 Hz');
  bb.led('D5', 'red', 'b29', 'b32', '1 Hz');
  bb.resistor('R4', 220, 'a32', bb.railHole('tn', 32)); // Ben's 220 Ω on the 1 Hz LED

  return b.build();
}
