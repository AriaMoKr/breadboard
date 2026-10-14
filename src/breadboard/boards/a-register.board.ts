import { LayoutBuilder } from '../layout';

/**
 * A register (videos 11-13), wired like Ben's schematic (eater.net
 * a-register.png, research notes):
 *   U9 74LS173 = bits 0-3, U8 74LS173 = bits 4-7
 *     ~M, ~N (pins 1, 2) -> GND: outputs always on (LEDs + 245 + ALU)
 *     ~G1, ~G2 (pins 9, 10) tied -> ~AI (active-low load)
 *     CP (7) -> CLK, MR (15) -> CLR
 *     D0-D3 <- bus, Q0-Q3 -> 245 A side, LEDs and the ALU (A0-A7 ports)
 *   U7 74LS245: DIR (1) -> VCC (A to B), ~OE (19) -> ~AO, B1-B8 -> BUS0-7
 *   8 red LEDs on the register outputs (Ben left out the resistors here).
 *
 * This is the reference board for docs/BREADBOARD.md: lanes keep long runs
 * apart, every chip gets VCC/GND, off-board nets are named ports.
 */

const b = new LayoutBuilder();
const bb = b.board('a', { x: 0, y: 0 }, 'A register');

const U9 = bb.chip('U9', '74LS173', 4); // bits 0-3
const U8 = bb.chip('U8', '74LS173', 15); // bits 4-7
const U7 = bb.chip('U7', '74LS245', 28);

// ---- power ----------------------------------------------------------------
for (const u of [U9, U8, U7]) {
  bb.toVcc(u.pin('VCC'));
  bb.toGnd(u.pin('GND'));
}
for (const u of [U9, U8]) {
  bb.toGnd(u.pin('~M'));
  bb.toGnd(u.pin('~N'));
}
bb.toVcc(U7.pin('DIR'));

// ---- control --------------------------------------------------------------
for (const u of [U9, U8]) {
  bb.wire(u.free('~G1'), u.free('~G2'), 'white'); // tie the two load enables together
  bb.port('~AI', u.free('~G2'), 'top');
  bb.port('CLK', u.free('CP'), 'bottom');
  bb.port('CLR', u.free('MR'), 'top');
}
bb.port('~AO', U7.free('~OE'), 'top');

// ---- data -----------------------------------------------------------------
const reg = (bit: number) => (bit < 4 ? U9 : U8);
const q = (bit: number) => `Q${bit % 4}`;
const d = (bit: number) => `D${bit % 4}`;

for (let bit = 0; bit < 8; bit++) {
  const u = reg(bit);
  // Q -> 245 A(bit+1), along its own lane in the bottom half
  bb.wireLane(u.free(q(bit)), U7.free(`A${bit + 1}`), 10.95 + (7 - bit) * 0.5, 'yellow');
  // bus -> D, from the 245's B(bit+1) strip, along a lane in the top half
  bb.wireLane(U7.free(`B${bit + 1}`), u.free(d(bit)), 7.05 - bit * 0.5, 'blue');
  bb.port(`BUS${bit}`, U7.free(`B${bit + 1}`), 'top');
  // register output to the ALU board
  bb.port(`A${bit}`, u.free(q(bit), 1), 'bottom');
}

// ---- LEDs: anode on the 245's A strip (= register output), cathode to GND --
for (let bit = 0; bit < 8; bit++) {
  const strip = U7.pin(`A${bit + 1}`); // f29..f36
  const col = Number(strip.slice(1));
  const anode = bb.freeOr(`j${col}`);
  bb.led(`D${8 - bit}`, 'red', anode, bb.railHole('bn', col), `A${bit}`).live((c) => ((c.a >> bit) & 1) === 1);
}

export default b.module({
  id: 'a-register',
  title: 'A register',
  description: 'Two 74LS173 4-bit registers hold the value; a 74LS245 puts it on the bus when ~AO is low. The LEDs always show the contents.',
  videos: [11, 12, 13],
});
