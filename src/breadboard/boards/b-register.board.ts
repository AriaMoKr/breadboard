import { RAIL_COLUMNS, ROWS, parseHole, type Rail, type Row } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type PortSide } from '../layout';

/**
 * B register (videos 11-13), wired like Ben's b-register.png and the
 * research notes: the A register again, minus the bus output.
 *   U11 74LS173 = bits 4-7, U12 74LS173 = bits 0-3
 *     ~M, ~N (pins 1, 2) -> GND: outputs always on (LEDs + ALU)
 *     ~G1, ~G2 (pins 9, 10) tied -> ~BI (active-low load)
 *     CP (7) -> CLK, MR (15) -> CLR
 *     D0-D3 <- bus, Q0-Q3 -> 245 A side, LEDs and the ALU's XOR gates (B0-B7)
 *   U10 74LS245: wired like the A register's (DIR -> VCC, A = Q, B = BUS) but
 *     ~OE (19) is tied to VCC (Ben's ~BO is tied high), so it never drives.
 *   8 red LEDs on the register outputs, no resistors (as on the A register).
 *
 * Layout: the B register sits below the ALU, so the board is the A register
 * turned round: the 173 outputs face up (the B0-B7 tags point at the ALU),
 * the bus side faces down, and the LEDs read bit 7 on the left. The 245 sits
 * between the two 173s, so each nibble's eight wires stay on its own side.
 */

const b = new LayoutBuilder();
const bb = b.board('b', { x: 0, y: 0 }, 'B register');

// All three chips turned 180° (pin 1 top right): Q and the 245 A side on top.
const U11 = bb.chip('U11', '74LS173', 11, { rotated: true }); // bits 4-7, cols 4-11
const U10 = bb.chip('U10', '74LS245', 29, { rotated: true }); // cols 20-29
const U12 = bb.chip('U12', '74LS173', 40, { rotated: true }); // bits 0-3, cols 33-40

const isTop = (hole: string) => ROWS.indexOf(parseHole(hole).row as Row) < 5;
const outward = (hole: string): PortSide => (isTop(hole) ? 'top' : 'bottom');

/** The free hole of `hole`'s strip furthest from the channel (row a or j): where tags and LED legs go. */
function far(board: BoardBuilder, hole: string): string {
  const free = board.freeInStrip(hole);
  if (!free.length) throw new Error(`Strip of ${hole} is full`);
  return free[free.length - 1];
}

/** Port tag at the outer end of a pin's strip, pointing off the board. */
const portAt = (name: string, pinHole: string) => bb.port(name, far(bb, pinHole), outward(pinHole));

/**
 * Rail holes for LED cathodes whose anodes sit in columns `cols` (ascending):
 * straight into the rail where it has a hole, the rest shifted one column
 * along, in whichever direction moves fewer LEDs.
 */
function railCathodes(board: BoardBuilder, rail: Rail, cols: number[]): string[] {
  const ok = (c: number) => RAIL_COLUMNS.includes(c) && board.isFree(`${rail}${c}`);
  const cascade = (dir: 1 | -1): number[] | null => {
    const order = dir === 1 ? cols : [...cols].reverse();
    const out: number[] = [];
    let prev = dir === 1 ? -Infinity : Infinity;
    for (const c of order) {
      let k = dir === 1 ? Math.max(c, prev + 1) : Math.min(c, prev - 1);
      while (k >= 1 && k <= 63 && !ok(k)) k += dir;
      if (k < 1 || k > 63) return null;
      out.push(k);
      prev = k;
    }
    return dir === 1 ? out : out.reverse();
  };
  const cost = (ks: number[] | null) => (ks ? ks.reduce((s, k, i) => s + Math.abs(k - cols[i]), 0) : Infinity);
  const up = cascade(1), down = cascade(-1);
  const best = cost(up) <= cost(down) ? up : down;
  if (!best) throw new Error(`No room on rail ${rail} for LEDs at ${cols.join(',')}`);
  return best.map((k) => `${rail}${k}`);
}

// ---- LEDs: anode on the 245's A strip (= register output), cathode to GND --
// A8..A1 = bits 7..0 sit in columns 21..28, so bit 7 is on the left.
const ledCols = [7, 6, 5, 4, 3, 2, 1, 0].map((bit) => Number(U10.pin(`A${bit + 1}`).slice(1)));
const cathodes = railCathodes(bb, 'tn', ledCols);
[7, 6, 5, 4, 3, 2, 1, 0].forEach((bit, i) => {
  const anode = far(bb, U10.pin(`A${bit + 1}`));
  bb.led(`D${8 - bit}`, 'red', anode, cathodes[i], `B${bit}`).live((c) => ((c.b >> bit) & 1) === 1);
});

// ---- power ----------------------------------------------------------------
for (const u of [U11, U12, U10]) {
  bb.toVcc(u.pin('VCC'));
  bb.toGnd(u.pin('GND'));
}
for (const u of [U11, U12]) {
  bb.toGnd(u.pin('~M'));
  bb.toGnd(u.pin('~N'));
}
bb.toVcc(U10.pin('DIR')); // A -> B, as on the A register
bb.toVcc(U10.pin('~OE')); // ~BO tied high: the B register never drives the bus

// ---- control --------------------------------------------------------------
for (const u of [U11, U12]) {
  bb.wire(u.free('~G1'), u.free('~G2'), 'white'); // tie the two load enables together
  portAt('~BI', u.pin('~G2'));
  portAt('CLK', u.pin('CP'));
  portAt('CLR', u.pin('MR'));
}

// ---- data -----------------------------------------------------------------
// Each nibble has four parallel runs per half; the two nibbles sit on either
// side of the 245, so they share the same four lanes.
const reg = (bit: number) => (bit < 4 ? U12 : U11);
const TOP_LANES = [7.0, 6.0, 5.0, 4.0]; // between hole rows d|e, c|d, b|c, a|b
const BOTTOM_LANES = [11.0, 12.0, 13.0, 14.0]; // f|g, g|h, h|i, i|j

for (let bit = 0; bit < 8; bit++) {
  const u = reg(bit);
  const k = bit % 4;
  // Q -> 245 A(bit+1), top half (yellow: data between chips). The runs of a
  // nibble are staggered; the one with the outer ends gets the outer lane.
  const qLane = bit < 4 ? TOP_LANES[k] : TOP_LANES[3 - k];
  bb.wireLane(u.free(`Q${k}`), U10.free(`A${bit + 1}`), qLane, 'yellow');
  // bus (245 B side) -> D, bottom half (blue: bus / data in)
  const dLane = bit < 4 ? BOTTOM_LANES[k] : BOTTOM_LANES[3 - k];
  bb.wireLane(U10.free(`B${bit + 1}`), u.free(`D${k}`), dLane, 'blue');
  portAt(`BUS${bit}`, U10.pin(`B${bit + 1}`));
  // register output up to the ALU board
  portAt(`B${bit}`, u.pin(`Q${k}`));
}

export default b.module({
  id: 'b-register',
  title: 'B register',
  description: 'Two 74LS173 4-bit registers hold the ALU’s second operand, loaded from the bus when ~BI is low. Its 74LS245 is wired but never enabled (~OE tied high). The LEDs always show the contents.',
  videos: [11, 12, 13],
});
