import { LayoutBuilder, type Layout } from '../layout';

/**
 * 4-bit register (videos 12-13): a 74LS173 loads D0-D3 from a DIP switch
 * on the rising edge of its clock, which here is a push button (1 kΩ
 * pull-down). ~G1/~G2 (load enable) and ~M/~N (output enable) are tied
 * low, MR (clear) is tied low. Each switch connects its line to +5 V and a
 * pull-down holds it at 0 when the switch is off, so ON = 1. The pull-downs
 * are 1 kΩ, not the 10 kΩ of Ben's EEPROM video: a 74LS input sources up
 * to 0.4 mA, which would lift a 10 kΩ pull-down to about 4 V (a 1), while
 * 1 kΩ keeps it at 0.4 V (a 0). The 28C16's CMOS inputs don't mind 10 kΩ,
 * the 74LS173's do. Four red LEDs show the stored value.
 */
export function buildRegister(): Layout {
  const b = new LayoutBuilder();
  const bb = b.board('reg', { x: 0, y: 0 }, '74LS173 register');

  // ~M f27, ~N f28, Q0-Q3 f29-f32, CP f33, GND f34; ~G1 e34, ~G2 e33, D3-D0 e32-e29, MR e28, VCC e27
  const U1 = bb.chip('U1', '74LS173', 27);
  bb.toVcc('a27');
  bb.toGnd('j34');
  bb.toGnd('a28'); // MR low
  bb.toGnd('a33'); // ~G2
  bb.toGnd('a34'); // ~G1
  bb.toGnd('j27'); // ~M
  bb.toGnd('j28'); // ~N

  // DIP switch SW1 (cols 22-25): bottom legs to +5 V, top legs are D0-D3 with 1 kΩ pull-downs
  bb.dip('SW1', 4, 22, undefined, 'D0-D3');
  for (let k = 0; k < 4; k++) {
    const col = 22 + k;
    bb.wire(`j${col}`, `bp${col}`, 'red');
    bb.resistor(`R${k + 1}`, 1000, `a${col}`, `tn${col}`);
    // staircase of lanes so the four data wires never cross
    bb.wire(`d${col}`, `a${29 + k}`, 'blue', [[col + 0.5, 4.1 + 0.6 * k], [29 + k + 0.5, 4.1 + 0.6 * k]]);
  }

  // load button SW2: +5 V on i37, clock line on i39 with a 1 kΩ pull-down
  bb.button('SW2', 'i37', 'i39', undefined, 'LOAD');
  bb.wire('j37', 'bp37', 'red');
  bb.resistor('R5', 1000, 'j39', 'bn39');
  bb.wireLane('g39', U1.free('CP'), 11.0, 'white');

  // LEDs on Q0-Q3, straight to ground like Ben's register LEDs
  for (let bit = 0; bit < 4; bit++) {
    const col = 29 + bit;
    bb.led(`D${bit + 1}`, 'red', `j${col}`, bb.railHole('bn', col), `Q${bit}`);
  }
  return b.build();
}
