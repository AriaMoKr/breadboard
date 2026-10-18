import { LayoutBuilder, type BoardBuilder, type Layout } from '../layout';

/** Half period of the 555 in gate delays: it stands in for Ben's once-a-second pulse. */
export const SECONDS_HALF_PERIOD = 150;

const x = (col: number) => col + 0.5;

/**
 * A CD4511 turned round with its pin 1 at column `c` (its pins on columns c-7..c) and a
 * common-cathode display at c+3, wired as one digit:
 *   top    GND c-7, A c-6, D c-5, LE c-4, ~BI c-3, ~LT c-2, C c-1, B c
 *   bottom e c-7, d c-6, c c-5, b c-4, a c-3, g c-2, f c-1, VCC c
 * so its inputs face the counter on the left and its outputs the display on the right.
 * Segments e, d, c go straight across below; b, a, g, f come up between decoder and
 * display to the display's top row (f and g cross once). ~LT and ~BI high, LE low; the
 * common cathode to ground through one 220 Ω resistor, as Ben did.
 */
function digit(bb: BoardBuilder, dec: string, ds: string, c: number, groundD: boolean) {
  bb.chip(dec, 'CD4511', c, { rotated: true });
  bb.toGnd(`a${c - 7}`);
  bb.toGnd(`a${c - 4}`); // LE low: show the input
  bb.toVcc(`a${c - 2}`); // ~LT high
  bb.wire(`b${c - 3}`, `b${c - 2}`, 'red'); // ~BI high too
  if (groundD) bb.toGnd(`a${c - 5}`); // D low: the tens only go to 5
  bb.toVcc(`j${c}`);
  // display: top g k, f k+1, com k+2, a k+3, b k+4; bottom e k, d k+1, com k+2, c k+3, dp k+4
  const k = c + 3;
  bb.seg7(ds, k, 'cathode');
  bb.resistor(`R${ds}`, 220, `a${k + 2}`, bb.railHole('tn', k + 2));
  // e, d, c: a staircase in the bottom half
  bb.wire(`g${c - 7}`, `j${k}`, 'green', [[x(c - 7), 14.2], [x(k), 14.2]]);
  bb.wire(`g${c - 6}`, `j${k + 1}`, 'green', [[x(c - 6), 13.8], [x(k + 1), 13.8]]);
  bb.wire(`g${c - 5}`, `j${k + 3}`, 'green', [[x(c - 5), 13.4], [x(k + 3), 13.4]]);
  // b, a, g, f: right under the decoder, up between decoder and display, right to the top pins
  const up = (from: string, low: number, gapX: number, high: number, to: string, toCol: number) =>
    bb.wire(from, to, 'green', [[x(Number(from.slice(1))), low], [gapX, low], [gapX, high], [x(toCol), high]]);
  up(`g${c - 4}`, 12.9, c + 2.85, 5.8, `c${k + 4}`, k + 4); // b
  up(`g${c - 3}`, 12.4, c + 2.3, 5.0, `b${k + 3}`, k + 3); // a
  up(`g${c - 2}`, 11.9, c + 1.75, 3.9, `a${k}`, k); // g
  up(`g${c - 1}`, 11.4, c + 1.2, 4.6, `a${k + 1}`, k + 1); // f
}

/**
 * Seconds of Ben's digital clock (breadboard clock part 4): two counters count the
 * pulses 00 to 59 and two CD4511 decoders drive common-cathode displays.
 *   - U3, a 74LS92 divide-by-12 counter used as a ÷6, counts the tens 0-5 on Q0-Q2
 *     (Q0 wired round to ~CP1). Its D input on the decoder is grounded.
 *   - U2, a 74LS90 decade counter, counts the units 0-9 (Q0 wired round to ~CP1;
 *     MS1, MS2 to ground). Its Q3 clocks the tens: the counters count on falling
 *     edges, so the tens step as the units go from 9 to 0, not from 7 to 8.
 *   - A 555 astable (as in the binary counter example) stands in for the one pulse a
 *     second that Ben divides down from 60 Hz mains (parts 1-3), which the sandbox can't
 *     simulate. Its blue LED blinks with each pulse.
 *   - ZERO resets the seconds: the counters' MR1, MR2 are joined, held low through
 *     220 Ω and pulled high by the button.
 */
export function buildSeconds(): Layout {
  const b = new LayoutBuilder();
  const bb = b.board('sec', { x: 0, y: 0 }, 'Seconds 00-59 (74LS92, 74LS90, CD4511)');

  // ---- U3 74LS92, tens: top ~CP0 e2, NC e3, Q0 e4, Q1 e5, GND e6, Q2 e7, Q3 e8;
  //      bottom ~CP1 f2, NC f3-f5, VCC f6, MR1 f7, MR2 f8
  bb.chip('U3', '74LS92', 2);
  bb.toGnd('a6');
  bb.toVcc('j6');
  bb.wire('c4', 'g2', 'white'); // Q0 -> ~CP1, over the chip
  // tens digit: U4 at columns 10-17, DS1 at 20-24; Q0 Q1 Q2 -> A B C (Q1 and Q2 cross once)
  digit(bb, 'U4', 'DS1', 17, true);
  bb.wire('a4', 'b11', 'blue', [[x(4), 5.0], [x(11), 5.0]]);
  bb.wire('d5', 'b17', 'blue', [[x(5), 5.5], [x(17), 5.5]]);
  bb.wire('d7', 'b16', 'blue', [[x(7), 6.0], [x(16), 6.0]]);

  // ---- 555 astable (U1): GND f27, TRIG f28, OUT f29, ~RESET f30; VCC e27, DIS e28, THR e29, CV e30
  bb.chip('U1', 'NE555', 27, { params: { mode: 'astable', halfPeriod: SECONDS_HALF_PERIOD } });
  bb.toVcc('d27');
  bb.toGnd('j27');
  bb.toVcc('j30'); // ~RESET high
  bb.resistor('R1', 1000, 'a28', 'tp28'); // VCC -> DIS
  bb.resistor('R2', 100_000, 'c28', 'c29'); // DIS -> THR
  bb.wire('d29', 'g28', 'white'); // THR to TRIG, over the chip
  bb.capacitor('C1', 10e-6, 'i28', 'bn28', true);
  bb.capacitor('C2', 0.01e-6, 'a30', 'tn30');
  bb.led('D1', 'blue', 'h29', 'h31', '1 Hz');
  bb.resistor('R3', 220, 'i31', 'bn31');

  // ---- U2 74LS90, units: top ~CP0 e34, NC e35, Q0 e36, Q3 e37, GND e38, Q1 e39, Q2 e40;
  //      bottom ~CP1 f34, MR1 f35, MR2 f36, NC f37, VCC f38, MS1 f39, MS2 f40
  bb.chip('U2', '74LS90', 34);
  bb.toGnd('a38');
  bb.toVcc('j38');
  bb.toGnd('j39'); // MS1
  bb.toGnd('j40'); // MS2
  bb.wire('i29', 'd34', 'yellow', [[x(29), 13.0], [x(32), 13.0], [x(32), 6.5]]); // the pulse -> ~CP0
  bb.wire('c36', 'g34', 'white'); // Q0 -> ~CP1, over the chip
  // units digit: U5 at columns 42-49, DS2 at 52-56; Q0 Q3 Q1 Q2 -> A D B C (Q1 and Q2 cross once)
  digit(bb, 'U5', 'DS2', 49, false);
  bb.wire('a36', 'b43', 'blue', [[x(36), 4.9], [x(43), 4.9]]);
  bb.wire('d37', 'b44', 'blue', [[x(37), 5.3], [x(44), 5.3]]);
  bb.wire('d39', 'b49', 'blue', [[x(39), 5.7], [x(49), 5.7]]);
  bb.wire('d40', 'b48', 'blue', [[x(40), 6.1], [x(48), 6.1]]);

  // ---- units Q3 -> tens ~CP0, along the top between the +5 V rail and row a
  bb.wire('a37', 'a2', 'yellow', [[x(37), 3.0], [x(2), 3.0]]);

  // ---- ZERO: MR1, MR2 of both counters joined, 220 Ω to ground, S1 to +5 V
  bb.wire('g7', 'g8', 'green');
  bb.wire('g35', 'g36', 'green');
  bb.wireLane('i8', 'i36', 14.9, 'green');
  bb.resistor('R4', 220, 'j35', 'bn35');
  bb.button('S1', 'h33', 'h35', undefined, 'ZERO');
  bb.wire('j33', 'bp33', 'red');

  return b.build();
}
