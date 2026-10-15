import { ROW } from '../computer-layout';
import { ROWS, holeXY, parseHole, type Row } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type LedColor, type PortSide, type WireColor } from '../layout';

/**
 * RAM module (videos 19-23): 16 bytes in two 74189s, wired pin for pin like
 * Ben's ram.png (KiCad netlist, research notes). Two boards:
 *
 * Board "ram" (top): what goes into the RAM chips.
 *   U26 / U27 74LS157 (S = PROG, ~E = GND): data in. Run (PROG high): I1 =
 *     the bus. Program (PROG low): I0 = the 8-position DIP switch SW3, whose
 *     switch k grounds data bit k-1 when ON (no pull-ups: OFF floats high).
 *       U26 (bits 7-4): section 1 = bit 7 -> U24 D1, 2 = bit 6 -> D2,
 *                       4 = bit 5 -> D3, 3 = bit 4 -> D4
 *       U27 (bits 3-0): section 1 = bit 3 -> U25 D4, 2 = bit 2 -> D3,
 *                       4 = bit 1 -> D2, 3 = bit 0 -> D1
 *   U32 74LS157 section 4 (Ben's "c", pins 12-14), S = PROG, ~E = GND:
 *     I1 = U31 gate 1 = NAND(RI, CLK edge), I0 = push button SW4 to GND
 *     (program mode writes while it is held), Y = ~WE of both 74189s.
 *     As in the netlist there is no pull-up: with SW4 open, pin 14 floats,
 *     which LS-TTL reads as high (no write), like the open DIP switches. The
 *     other three sections are unconnected.
 *   U31 74LS00 gate 1: pin 1 = CLK through C7 0.01 µF, with R58 1k to GND
 *     (a ~10 µs pulse after each rising edge), pin 2 = RI. Gates 2-4 unused,
 *     inputs left open as in the schematic.
 *
 * Board "ram2" (below): the RAM and its output.
 *   U24 (bits 7-4) / U25 (bits 3-0) 74189: A0-A3 = RA0-RA3 (from the MAR
 *     board), ~CS = GND, ~WE from U32.
 *   Their outputs are inverted: U24 ~O1-~O4 -> U28 74LS04 1A, 2A, 3A, 4A
 *     (bits 7, 6, 5, 4); U25 ~O1-~O4 -> U29 74LS04 3A, 2A, 1A, 6A (bits 0, 1,
 *     2, 3). Spare inverter inputs are left open, as Ben does.
 *   Inverter outputs -> red LEDs D36-D43 (bits 7-0, 220 Ω R50-R57 on the
 *     cathode side to GND) and U30 74LS245 A1-A8 (bits 7-0); DIR = VCC,
 *     ~OE = ~RO, B1-B8 = BUS7-BUS0.
 *
 * The data lines (RAM.D0-RAM.D7) and ~WE (RAM.~WE) cross between the two
 * boards as module-local port tags; RA0-RA3, PROG, RI, ~RO, CLK and BUS0-7
 * are the shared ports from docs/BREADBOARD.md.
 */

const b = new LayoutBuilder();

// ---- helpers ------------------------------------------------------------------------

const colOf = (hole: string) => parseHole(hole).col;
const isTop = (hole: string) => ROWS.indexOf(parseHole(hole).row as Row) < 5;
/** Outermost hole of a pin's strip (row a or j): tags and rail wires go there, signal wires use the inner holes. */
const outer = (hole: string) => `${isTop(hole) ? 'a' : 'j'}${colOf(hole)}`;
const side = (hole: string): PortSide => (isTop(hole) ? 'top' : 'bottom');
const at = (row: Row, hole: string) => `${row}${colOf(hole)}`;
const x = (hole: string) => holeXY(hole).x;

function portAt(board: BoardBuilder, name: string, pinHole: string) {
  board.port(name, outer(pinHole), side(pinHole));
}
function vcc(board: BoardBuilder, hole: string) {
  board.wire(outer(hole), board.railHole(isTop(hole) ? 'tp' : 'bp', colOf(hole)), 'red');
}
function gnd(board: BoardBuilder, hole: string) {
  board.wire(outer(hole), board.railHole(isTop(hole) ? 'tn' : 'bn', colOf(hole)), 'black');
}
/** LED straddling the channel at `col`: anode f (signal in the bottom strip), cathode e, 220 Ω from a to the top GND rail. */
function ledCell(board: BoardBuilder, id: string, color: LedColor, col: number, rId: string, label: string) {
  board.resistor(rId, 220, `a${col}`, board.railHole('tn', col), rId);
  return board.led(id, color, `f${col}`, `e${col}`, label);
}
/** Wire from a hole in one half to a hole in the other: lane `ya`, through the channel at `xc`, lane `yb`. */
function across(board: BoardBuilder, from: string, to: string, ya: number, xc: number, yb: number, color: WireColor) {
  return board.wire(from, to, color, [[x(from), ya], [xc, ya], [xc, yb], [x(to), yb]]);
}

// =======================================================================================
// Board "ram": data-in muxes, DIP switch, write control
// =======================================================================================

const top = b.board('ram', { x: 0, y: 0 }, 'RAM: data in and write control');

const U27 = top.chip('U27', '74LS157', 3); // bits 3-0, cols 3-10
const SW3_COL = 13; // switch k at column 12 + k
const U26 = top.chip('U26', '74LS157', 23); // bits 7-4, cols 23-30
const SW4_COL = 32; // push button across the channel
const U32 = top.chip('U32', '74LS157', 34); // write mux, cols 34-41
const U31 = top.chip('U31', '74LS00', 50, { rotated: true }); // gate 1 on top, cols 44-50
const CLK_COL = 53;

// ---- ports ----------------------------------------------------------------------------

portAt(top, 'PROG', U27.pin('S'));
// mux sections: [section, bus bit, data bit] per chip (Ben's netlist)
const MUX_BITS: [typeof U27, number, number][][] = [
  [[U27, 1, 3], [U27, 2, 2], [U27, 4, 1], [U27, 3, 0]],
  [[U26, 1, 7], [U26, 2, 6], [U26, 4, 5], [U26, 3, 4]],
];
const SECTION_OF: Record<number, number> = {}; // data bit -> section
for (const chip of MUX_BITS) {
  for (const [u, s, bit] of chip) {
    SECTION_OF[bit] = s;
    portAt(top, `BUS${bit}`, u.pin(`${s}I1`));
    portAt(top, `RAM.D${bit}`, u.pin(`${s}Y`));
  }
}
portAt(top, 'RAM.~WE', U32.pin('4Y'));
portAt(top, 'RI', U31.pin('1B'));
top.port('CLK', `a${CLK_COL}`, 'top');

// ---- power ------------------------------------------------------------------------------

for (const u of [U27, U26, U32, U31]) {
  vcc(top, u.pin('VCC'));
  gnd(top, u.pin('GND'));
}
for (const u of [U27, U26, U32]) gnd(top, u.pin('~E'));

// ---- PROG to the three S pins (deepest lane, under everything) -----------------------------

top.wire(at('i', U27.pin('S')), at('i', U26.pin('S')), 'orange', [[x(U27.pin('S')), 14.0], [x(U26.pin('S')), 14.0]]);
top.wire(outer(U26.pin('S')), outer(U32.pin('S')), 'orange', [[x(U26.pin('S')), 14.0], [x(U32.pin('S')), 14.0]]);

// ---- SW3: data switches (ON = 0) ------------------------------------------------------------
// Switch k is data bit k-1. Bits 0, 1, 4, 5 go to the top row of their mux
// (3I0, 4I0), bits 2, 3, 6, 7 to the bottom row (2I0, 1I0): each switch uses
// the leg facing its input and grounds the other one, like Ben's SW3 pads.

// Lanes: each pair nests (the wire that spans more columns on the outer lane).
const SW3_LANE = [6, 5, 12, 13, 5, 6, 13, 12];
const SW3 = top.dip('SW3', 8, SW3_COL, {
  kind: 'dip',
  get: (m) => ~m.computer.dipData & 0xff,
  set: (m, v) => {
    m.computer.dipData = ~v & 0xff;
    m.changed();
  },
});
for (let k = 1; k <= 8; k++) {
  const bit = k - 1;
  const mux = bit < 4 ? U27 : U26;
  const s = SECTION_OF[bit];
  const onTop = s === 3 || s === 4; // 3I0 / 4I0 are on the top row
  gnd(top, SW3.pin(k, onTop ? 'bottom' : 'top'));
  const from = SW3.pin(k, onTop ? 'top' : 'bottom');
  const to = mux.pin(`${s}I0`);
  top.wireLane(at(onTop ? 'd' : 'g', from), at(onTop ? 'd' : 'g', to), SW3_LANE[bit], 'blue');
}

// ---- write control ------------------------------------------------------------------------------

// SW4 across the channel: top leg = U32 4I0 (floats high while open), bottom leg = GND.
top.button('SW4', `e${SW4_COL}`, `f${SW4_COL}`, {
  kind: 'button',
  press: (m) => {
    m.computer.programWrite(); // only does something in program mode
    m.changed();
  },
}, 'SW4 write');
gnd(top, `f${SW4_COL}`);
top.wireLane(`d${SW4_COL}`, at('d', U32.pin('4I0')), 6, 'white');
// U31 gate 1 -> U32 4I1
top.wireLane(at('d', U31.pin('1Y')), at('d', U32.pin('4I1')), 5, 'white');
// RC edge detector on pin 1: C7 from CLK, R58 to GND
top.capacitor('C7', 1e-8, `c${CLK_COL}`, at('c', U31.pin('1A')), false, 'C7');
top.resistor('R58', 1000, outer(U31.pin('1A')), `tn${colOf(U31.pin('1A')) + 1}`, 'R58');

// =======================================================================================
// Board "ram2": 74189s, output inverters, LEDs, bus driver
// =======================================================================================

const bot = b.board('ram2', { x: 0, y: ROW }, 'RAM: 74189 memory and output');

// U24 starts at column 3 (not 2), so its VCC (pin 16) has a rail hole right
// above it and every RA tag can sit on row a; column 11 stays free for ~O3.
const U24 = bot.chip('U24', '74LS189', 3); // bits 7-4, cols 3-10
const U28 = bot.chip('U28', '74LS04', 12); // cols 12-18
const LEDS_HIGH = [21, 22, 23, 24]; // bits 7..4 (D36-D39)
const U30 = bot.chip('U30', '74LS245', 27); // cols 27-36
const LEDS_LOW = [39, 40, 41, 42]; // bits 3..0 (D40-D43)
const U29 = bot.chip('U29', '74LS04', 45); // cols 45-51
const U25 = bot.chip('U25', '74LS189', 54); // bits 3-0, cols 54-61

// ---- ports --------------------------------------------------------------------------------

for (const [u, bits] of [[U24, [7, 6, 5, 4]], [U25, [0, 1, 2, 3]]] as const) {
  for (let a = 0; a < 4; a++) portAt(bot, `RA${a}`, u.pin(`A${a}`));
  portAt(bot, 'RAM.~WE', u.pin('~WE'));
  bits.forEach((bit, k) => portAt(bot, `RAM.D${bit}`, u.pin(`D${k + 1}`)));
}
portAt(bot, '~RO', U30.pin('~OE'));
for (let k = 1; k <= 8; k++) portAt(bot, `BUS${8 - k}`, U30.pin(`B${k}`));

// ---- power --------------------------------------------------------------------------------

for (const u of [U24, U28, U30, U29, U25]) {
  vcc(bot, u.pin('VCC'));
  gnd(bot, u.pin('GND'));
}
gnd(bot, U24.pin('~CS'));
gnd(bot, U25.pin('~CS'));
vcc(bot, U30.pin('DIR'));

// ---- 74189 outputs -> inverters -> LED strip -> 245 A side ------------------------------------------
//
// Every wire in the bottom half is a lane wire (down from one hole, along a
// lane between hole rows, up into another). The hole each wire uses in its
// strip and its lane are picked so that no two wires lie on top of each
// other and, in the bottom half, only one pair crosses (bit 5's lane 15 over
// U30's DIR jumper). In the top half the ~O4 -> 4A/6A wires run on lane 5
// and the top-row outputs (~O3, 4Y, 6Y) go through the channel on lane 6;
// on U25's side two crossings there are forced by the pinout.

/** A lane wire from strip `fromCol` (hole in row `fromRow`) to strip `toCol` (row `toRow`). */
const hop = (fromRow: Row, fromCol: string, toRow: Row, toCol: string | number, lane: number) =>
  bot.wireLane(at(fromRow, fromCol), `${toRow}${typeof toCol === 'number' ? toCol : colOf(toCol)}`, lane, 'yellow');

// U24 -> U28 (to its right); ~O3 is on the top row: through the channel at column 11
hop('g', U24.pin('~O1'), 'g', U28.pin('1A'), 12);
hop('h', U24.pin('~O2'), 'i', U28.pin('2A'), 14);
across(bot, at('d', U24.pin('~O3')), at('g', U28.pin('3A')), 6, x('a11'), 11, 'yellow');
bot.wireLane(at('d', U24.pin('~O4')), at('d', U28.pin('4A')), 5, 'yellow');
// U25 -> U29 (to its left); ~O3 through the channel at column 52
hop('h', U25.pin('~O1'), 'i', U29.pin('3A'), 14);
hop('g', U25.pin('~O2'), 'g', U29.pin('2A'), 12);
across(bot, at('d', U25.pin('~O3')), at('g', U29.pin('1A')), 6, x('a52'), 11, 'yellow');
bot.wireLane(at('d', U25.pin('~O4')), at('d', U29.pin('6A')), 5, 'yellow');

/**
 * [bit, inverter, output pin, then inverter -> LED strip: [from row, LED row, lane]
 * (top-row outputs: [LED row, lane] after the channel), then LED strip -> 245 A:
 * [LED row, A row, lane]].
 */
const OUTS: [number, typeof U28, string, [Row, Row, number], [Row, Row, number]][] = [
  [7, U28, '1Y', ['g', 'i', 13], ['h', 'h', 13]],
  [6, U28, '2Y', ['i', 'j', 14], ['i', 'h', 14]],
  [5, U28, '3Y', ['g', 'g', 12], ['j', 'h', 15]],
  [4, U28, '4Y', ['d', 'g', 11], ['h', 'g', 12]],
  [3, U29, '6Y', ['d', 'g', 12], ['h', 'g', 12]],
  [2, U29, '1Y', ['j', 'j', 15], ['h', 'h', 13]],
  [1, U29, '2Y', ['i', 'h', 14], ['j', 'i', 14]],
  [0, U29, '3Y', ['h', 'h', 13], ['g', 'g', 11]],
];
for (const [bit, inv, pin, [fromRow, ledRow, inLane], [outRow, aRow, outLane]] of OUTS) {
  const col = bit >= 4 ? LEDS_HIGH[7 - bit] : LEDS_LOW[3 - bit];
  const out = inv.pin(pin);
  if (isTop(out)) {
    // 4Y / 6Y are on the top row: over the channel in the gap next to the inverter
    const xc = bit >= 4 ? x('a19') : x('a43');
    across(bot, at(fromRow, out), `${ledRow}${col}`, 6, xc, inLane, 'yellow');
  } else {
    hop(fromRow, out, ledRow, col, inLane);
  }
  hop(outRow, `a${col}`, aRow, U30.pin(`A${8 - bit}`), outLane);
  ledCell(bot, `D${43 - bit}`, 'red', col, `R${57 - bit}`, `RAM${bit}`).live((c) => ((c.ramValue >> bit) & 1) === 1);
}

export default b.module({
  id: 'ram',
  title: 'RAM',
  description:
    '16 bytes in two 74189s. In run mode the address comes from the MAR, data from the bus, and RI writes on the clock edge; in program mode the DIP switches give address and data and the write button stores them. Inverters undo the 74189s’ inverted outputs for the red LEDs and the 74LS245 that drives the bus on RO.',
  videos: [19, 20, 21, 22, 23],
});
