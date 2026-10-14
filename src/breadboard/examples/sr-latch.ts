import { LayoutBuilder, type Layout } from '../layout';

/**
 * SR latch (video 6): two cross-coupled NOR gates of a 74LS02.
 *   Q  = 1Y = NOR(1A = R, 1B = Q̅)
 *   Q̅ = 2Y = NOR(2A = Q, 2B = S)
 * S and R are push buttons to +5 V with 1 kΩ pull-downs, so a released
 * button reads 0. Q and Q̅ drive LEDs through 330 Ω, as in the video.
 */
export function buildSrLatch(): Layout {
  const b = new LayoutBuilder();
  const bb = b.board('sr', { x: 0, y: 0 }, 'SR latch (74LS02)');

  const U1 = bb.chip('U1', '74LS02', 27); // pins 1-7 = f27..f33
  bb.toVcc(U1.pin('VCC'));
  bb.toGnd('j33'); // pin 7 strip, from the bottom so it stays clear of the LEDs

  // cross-coupling: Q̅ -> 1B, Q -> 2A
  bb.wire(U1.free('2Y'), U1.free('1B'), 'yellow');
  bb.wireLane(U1.free('1Y'), U1.free('2A'), 12.0, 'yellow');

  // R button (SW2): +5 V on i13, R line on i15 with a 1 kΩ pull-down
  bb.button('SW2', 'i13', 'i15', undefined, 'R');
  bb.wire('j13', 'bp13', 'red');
  bb.resistor('R2', 1000, 'j15', 'bn15');
  bb.wireLane('g15', U1.free('1A'), 11.0, 'white');

  // S button (SW1): +5 V on i19, S line on i21 with a 1 kΩ pull-down
  bb.button('SW1', 'i19', 'i21', undefined, 'S');
  bb.wire('j19', 'bp19', 'red');
  bb.resistor('R1', 1000, 'j21', 'bn21');
  bb.wireLane('h21', 'j32', 13.0, 'orange'); // to 2B (pin 6, f32)

  // LEDs: anode on the output, cathode through 330 Ω to ground
  bb.led('D1', 'red', 'h27', 'h25', 'Q');
  bb.resistor('R3', 330, 'i25', 'bn25');
  bb.led('D2', 'green', 'h30', 'h34', 'Q̅');
  bb.resistor('R4', 330, 'i34', 'bn34');

  bb.text('R', 14.5, 15.55, 0.9);
  bb.text('S', 20.5, 15.55, 0.9);
  return b.build();
}
