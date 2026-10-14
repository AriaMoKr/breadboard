import { LayoutBuilder, type Layout } from '../layout';

/**
 * D latch (video 7): an SR latch (74LS02) whose S and R come from AND gates
 * (74LS08) enabled by E, with R fed from D through an inverter (74LS04), so
 * the invalid S = R = 1 state can't happen.
 *   S = D · E      (U2 gate 1)          Q  = NOR(R, Q̅)   (U1 gate 1)
 *   R = D̅ · E      (U2 gate 2)          Q̅ = NOR(S, Q)    (U1 gate 2)
 * D and E are slide switches between GND and +5 V. LEDs (330 Ω) on D, E,
 * Q and Q̅, as in the video. (Ben made the inverter from a spare NOR gate;
 * here it's a 74LS04, which works the same.)
 */
export function buildDLatch(): Layout {
  const b = new LayoutBuilder();
  const bb = b.board('dl', { x: 0, y: 0 }, 'D latch (74LS02, 74LS08, 74LS04)');

  const U3 = bb.chip('U3', '74LS04', 15); // inverter, pins 1-7 = f15..f21
  const U2 = bb.chip('U2', '74LS08', 27); // AND gates, f27..f33
  const U1 = bb.chip('U1', '74LS02', 39); // NOR latch, f39..f45
  for (const u of [U3, U2, U1]) {
    bb.toVcc(u.pin('VCC'));
    const gnd = u.pin('GND');
    bb.toGnd(`j${gnd.slice(1)}`);
  }

  // inputs: slide switches, position 0 = GND, 1 = +5 V
  bb.slide('SW2', 'c3', 'c4', 'c5', undefined, 'E'); // E line = column 4
  bb.wire('a3', 'tn3', 'black');
  bb.wire('a5', 'tp5', 'red');
  bb.slide('SW1', 'c9', 'c10', 'c11', undefined, 'D'); // D line = column 10
  bb.wire('a9', 'tn9', 'black');
  bb.wire('a11', 'tp11', 'red');

  // input LEDs
  bb.led('D2', 'yellow', 'b4', 'b6', 'E');
  bb.resistor('R2', 330, 'a6', 'tn6');
  bb.led('D1', 'yellow', 'b10', 'b12', 'D');
  bb.resistor('R1', 330, 'a12', 'tn12');

  // D -> inverter and S gate; D̅ -> R gate; E -> both gates
  bb.wireLane('e10', U3.free('1A'), 11.0, 'blue');
  bb.wireLane(U3.free('1A'), U2.free('1A'), 12.0, 'blue');
  bb.wireLane('i16', 'i30', 13.0, 'yellow'); // D̅ (U3 1Y) -> U2 2A
  bb.wireLane('e4', 'i28', 14.0, 'blue'); // E -> U2 1B
  bb.wire('j28', 'j31', 'blue'); // E -> U2 2B

  // S -> U1 2B, R -> U1 1A
  bb.wireLane('h29', U1.free('2B'), 12.0, 'yellow');
  bb.wireLane(U2.free('2Y'), U1.free('1A'), 11.0, 'yellow');

  // the latch: Q̅ -> 1B, Q -> 2A
  bb.wire(U1.free('2Y'), U1.free('1B'), 'yellow');
  bb.wireLane('h39', 'h43', 13.0, 'yellow');

  // output LEDs
  bb.led('D3', 'red', 'i39', 'i37', 'Q');
  bb.resistor('R3', 330, 'j37', 'bn37');
  bb.led('D4', 'green', 'i42', 'i46', 'Q̅');
  bb.resistor('R4', 330, 'j46', 'bn46');

  bb.text('E', 4.5, 8.9, 0.9);
  bb.text('D', 10.5, 8.9, 0.9);
  return b.build();
}
