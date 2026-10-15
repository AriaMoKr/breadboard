import type { Rail } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type PortSide } from '../layout';

/**
 * The bus (videos 9, 34): 8 lines down the middle of the computer, built
 * like Ben's from breadboard rails. Two BB830s turned 90° side by side give
 * 8 vertical rail lines (rails: 'signal', not power):
 *
 *   left board  (x 0):  bn = BUS7, bp = BUS6, tp = BUS5, tn = BUS4
 *   right board (x 20): bn = BUS3, bp = BUS2, tp = BUS1, tn = BUS0
 *
 * so the lines read BUS7..BUS0 from left to right. Two such pairs are
 * stacked (y 0 and 65), covering module rows 0-4: every module that touches
 * the bus (PC, MAR, A, RAM, ALU, B, IR, output) sits in those rows. For each
 * row there is a full set of BUSn ports facing the left column and one
 * facing the right column, staggered so the tags don't overlap. Same-named
 * ports are one net, which is also what joins the stacked pairs (a wire
 * can't leave its board).
 *
 * The 8 × 10k pull-downs R8-R15 and the 8 red bus LEDs (220R) need a real
 * GND rail, which the signal boards don't have, and an 18-unit-wide slot
 * can't hold an unrotated BB830 next to the bus boards. So they sit on a
 * third, ordinary (powered) board turned 90° at the bottom of the bus
 * column (rows 5-6, where no module uses the bus; eater.net also suggests
 * mounting the bus LEDs on a breadboard instead of soldering them). Each
 * line is one column there: GND rail <- 10k <- BUSn strip -> LED (across the
 * channel) -> 220R -> GND rail, so every pull-down and LED resistor ends in a
 * GND rail.
 *
 * Designators as in the KiCad netlist, which numbers the bus MSB first:
 * pull-downs R8 (BUS7) ... R15 (BUS0), LEDs D2 (BUS7) ... D9 (BUS0) with
 * their 220R on the cathode side, R16 (BUS7) ... R23 (BUS0).
 */

const b = new LayoutBuilder();

const SEG_H = 65; // a turned board is 65 tall
const RAIL_OF: Record<number, Rail> = { 7: 'bn', 6: 'bp', 5: 'tp', 4: 'tn', 3: 'bn', 2: 'bp', 1: 'tp', 0: 'tn' };
/** Ports per row slot: [bit facing left, bit facing right] (tags never overlap at one height). */
const SLOTS: [number, number][] = [[7, 0], [6, 1], [5, 2], [4, 3], [3, 6], [2, 7], [1, 5], [0, 4]];
/** Columns that have rail holes (3-7, 9-13, ..., 57-61). */
const RAIL_COLS = Array.from({ length: 50 }, (_, i) => 3 + Math.floor(i / 5) * 6 + (i % 5));

const segments: { hi: BoardBuilder; lo: BoardBuilder; y: number }[] = [];
for (let s = 0; s < 2; s++) {
  const y = s * SEG_H;
  segments.push({
    y,
    hi: b.board(`bus-hi-${s + 1}`, { x: 0, y, rotate: 90 }, 'Bus 7-4', { rails: 'signal' }),
    lo: b.board(`bus-lo-${s + 1}`, { x: 20, y, rotate: 90 }, 'Bus 3-0', { rails: 'signal' }),
  });
}

// ---- one set of ports per module row (rows 0-4), facing both columns -----------
const ROW = 25; // = computer-layout ROW
// On a board turned 90°, its local 'bottom' faces scene left and 'top' scene right.
const LEFT: PortSide = 'bottom';
const RIGHT: PortSide = 'top';
for (let row = 0; row < 5; row++) {
  const seg = segments[row < 3 ? 0 : 1];
  const centre = row * ROW + 9 - seg.y - 0.5; // local column at the module's mid-height
  const cols = [...RAIL_COLS].sort((p, q) => Math.abs(p - centre) - Math.abs(q - centre) || p - q).slice(0, SLOTS.length).sort((p, q) => p - q);
  SLOTS.forEach(([left, right], i) => {
    for (const [bit, side] of [[left, LEFT], [right, RIGHT]] as const) {
      const board = bit >= 4 ? seg.hi : seg.lo;
      board.port(`BUS${bit}`, `${RAIL_OF[bit]}${cols[i]}`, side);
    }
  });
}

// ---- pull-downs and LEDs on a powered board below ----------------------------------
// Under the left bus column, with the 8 lines at the far end of the board, so
// these ports are never the nearest BUSn port for a module in rows 0-4 (the
// breadboard view draws each inter-board link from the nearest one).
const leds = b.board('bus-leds', { x: 0, y: 2 * SEG_H, rotate: 90 }, 'Bus LEDs & pull-downs');
for (let k = 0; k < 8; k++) {
  const bit = 7 - k; // BUS7 at the top
  const n = 40 + 3 * k; // columns 40, 43, ..., 61: all have rail holes
  leds.port(`BUS${bit}`, `c${n}`, 'left'); // points up, at the bus lines
  leds.resistor(`R${15 - bit}`, 10_000, `a${n}`, `tn${n}`, `R${15 - bit} BUS${bit} pull-down`);
  leds.led(`D${9 - bit}`, 'red', `e${n}`, `f${n}`, `BUS${bit}`).live((c) => ((c.bus.value >> bit) & 1) === 1);
  leds.resistor(`R${23 - bit}`, 220, `j${n}`, `bn${n}`, `R${23 - bit}`);
}

export default b.module({
  id: 'bus',
  title: 'Bus',
  description:
    'Eight lines shared by every module, on breadboard rails. Only one module drives it at a time; 10k pull-downs make an undriven line read 0, and the red LEDs show the value.',
  videos: [9, 34],
});
