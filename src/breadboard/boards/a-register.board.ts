import { RAIL_COLUMNS, type Rail } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type ChipHandle } from '../layout';

/**
 * A register (videos 11-13), wired like Ben's a-register.png and the KiCad
 * netlist (eater.net 8bit-computer.zip):
 *   U8 74LS173 = bits 4-7, U9 74LS173 = bits 0-3
 *     ~M, ~N (pins 1, 2) -> GND: outputs always on (LEDs, 245 and the ALU)
 *     ~G1, ~G2 (pins 9, 10) tied -> ~AI (active-low load)
 *     CP (7) -> CLK, MR (15) -> CLR
 *     D <- bus, Q -> 245 A side, the LEDs and the ALU (ports A0-A7)
 *   U7 74LS245: DIR (1) -> VCC (A to B), ~OE (19) -> ~AO, B side = BUS0-7
 *
 * Bit order as in the netlist: each chip has the most significant bit on its
 * lowest-numbered pin, so with every notch to the left the bits read 7 ... 0
 * from left to right. U8 D0/Q0 = bit 7 ... D3/Q3 = bit 4, U9 D0/Q0 = bit 3
 * ... D3/Q3 = bit 0, U7 A1/B1 (pins 2/18) = bit 7 ... A8/B8 (pins 9/11) =
 * bit 0. (Logically the same register; it is how Ben's wires run.)
 *
 * 8 red LEDs on the 245's A side, ids D1 (A7) ... D8 (A0). (The netlist
 * numbers them D10 (A7) ... D17 (A0); the ids stay D1-D8 because
 * tests/breadboard-engine.test.ts reads them. The labels say A7 ... A0.)
 * The schematic gives them 220 Ω (R24-R31); Ben left those out on the
 * breadboard, and so do we, as on the B register and the ALU.
 *
 * Layout: U8 | U7 | U9, so each nibble's wires stay on its own side of the
 * 245. Register outputs run to the 245's A side in the bottom half, the bus
 * from its B side to the D inputs in the top half. Each run has its own
 * lane and enters its strips from the hole right next to that lane, so no
 * two wires cross or lie on top of each other, and none passes over another
 * part's leg. The A0-A7 tags point down to the ALU below, the bus tags up.
 *
 * This is the reference board for docs/BREADBOARD.md: lanes keep long runs
 * apart, every chip gets VCC/GND, off-board nets are named ports.
 */

const b = new LayoutBuilder();
const bb = b.board('a', { x: 0, y: 0 }, 'A register');

const U8 = bb.chip('U8', '74LS173', 4); // bits 7-4, cols 4-11
const U7 = bb.chip('U7', '74LS245', 20); // cols 20-29
const U9 = bb.chip('U9', '74LS173', 33); // bits 3-0, cols 33-40

// ---- helpers ------------------------------------------------------------------

const colOf = (hole: string) => Number(hole.slice(1));
const isTop = (hole: string) => /^[a-e]/.test(hole);
/** The hole in row `row` of the strip of `hole`. */
const at = (row: string, hole: string) => `${row}${colOf(hole)}`;
/** Outermost hole of a pin's strip (row a or j). */
const outer = (hole: string) => at(isTop(hole) ? 'a' : 'j', hole);

/** Wire a pin's strip (from its outer hole) to a supply rail, at `railCol` or the nearest rail column. */
function supply(pin: string, to: 'vcc' | 'gnd', railCol?: number) {
  const rail: Rail = to === 'vcc' ? (isTop(pin) ? 'tp' : 'bp') : isTop(pin) ? 'tn' : 'bn';
  bb.wire(outer(pin), railCol === undefined ? bb.railHole(rail, colOf(pin)) : `${rail}${railCol}`, to === 'vcc' ? 'red' : 'black');
}

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

/** The 74LS173 holding a bit. */
const reg = (bit: number): ChipHandle => (bit >= 4 ? U8 : U9);
/** D/Q index of a bit on its 74LS173: the high bit of each nibble on D0/Q0. */
const k173 = (bit: number) => 3 - (bit % 4);
/** 74LS245 A/B index of a bit: bit 7 on A1/B1 ... bit 0 on A8/B8. */
const k245 = (bit: number) => 8 - bit;

// ---- LEDs: anode on the 245's A strip (= register output), cathode to GND ------
// A1..A8 = bits 7..0 sit in columns 21..28, so bit 7 is on the left.

const BITS = [7, 6, 5, 4, 3, 2, 1, 0];
const ledCols = BITS.map((bit) => colOf(U7.pin(`A${k245(bit)}`)));
const cathodes = railCathodes(bb, 'bn', ledCols);
BITS.forEach((bit, i) => {
  bb.led(`D${8 - bit}`, 'red', `j${ledCols[i]}`, cathodes[i], `A${bit}`).live((c) => ((c.a >> bit) & 1) === 1);
});

// ---- power ------------------------------------------------------------------------

for (const u of [U8, U9]) {
  supply(u.pin('VCC'), 'vcc');
  supply(u.pin('GND'), 'gnd');
  supply(u.pin('~M'), 'gnd');
  supply(u.pin('~N'), 'gnd');
}
// U7: column 20 has no rail hole; lean left, away from the ~AO tag (column 21) and the LEDs
supply(U7.pin('VCC'), 'vcc', 19);
supply(U7.pin('DIR'), 'vcc', 19); // A (register) -> B (bus)
supply(U7.pin('GND'), 'gnd', colOf(U7.pin('GND')) + 1); // parallel to the LED next to it

// ---- control ------------------------------------------------------------------------

for (const u of [U8, U9]) {
  bb.wire(at('d', u.pin('~G1')), at('d', u.pin('~G2')), 'white'); // tie the two load enables together
  bb.port('~AI', outer(u.pin('~G2')), 'top');
  bb.port('CLR', outer(u.pin('MR')), 'top');
  bb.port('CLK', outer(u.pin('CP')), 'bottom');
}
bb.port('~AO', outer(U7.pin('~OE')), 'top');

// ---- data ---------------------------------------------------------------------------
// Four parallel runs per nibble and half. Run i (0 = leftmost) takes lane i,
// counted out from the chips, and uses the hole next to it in each strip.

const BOTTOM = [
  { y: 11.0, row: 'g' }, { y: 12.0, row: 'h' }, { y: 13.0, row: 'i' }, { y: 14.0, row: 'i' },
];
const TOP = [
  { y: 7.0, row: 'd' }, { y: 6.0, row: 'c' }, { y: 5.0, row: 'b' }, { y: 4.0, row: 'b' },
];

for (const bit of BITS) {
  const u = reg(bit);
  const i = 3 - (bit % 4); // position of the run within its nibble, left to right
  const q = u.pin(`Q${k173(bit)}`), d = u.pin(`D${k173(bit)}`);
  const a = U7.pin(`A${k245(bit)}`), bus = U7.pin(`B${k245(bit)}`);
  // register output -> 245 A side (yellow: data between chips)
  const lo = BOTTOM[i];
  bb.wireLane(at(lo.row, q), at(lo.row, a), lo.y, 'yellow');
  // bus (245 B side) -> D input (blue: bus / data in)
  const hi = TOP[i];
  bb.wireLane(at(hi.row, bus), at(hi.row, d), hi.y, 'blue');
  bb.port(`BUS${bit}`, outer(bus), 'top');
  bb.port(`A${bit}`, outer(q), 'bottom'); // to the ALU board below
}

export default b.module({
  id: 'a-register',
  title: 'A register',
  description: 'Two 74LS173 4-bit registers hold the value; a 74LS245 puts it on the bus when ~AO is low. The LEDs always show the contents.',
  videos: [11, 12, 13],
});
