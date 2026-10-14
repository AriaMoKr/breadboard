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
 *     Ben leaves pin 14 floating (LS-TTL reads it high) and the other three
 *     sections unconnected; this board adds a 1k pull-up on pin 14 ("R_SW4",
 *     not in Ben's schematic) so the input is defined while SW4 is open.
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

// SW4 across the channel: top leg = U32 4I0 (pulled up by R_SW4), bottom leg = GND.
top.button('SW4', `e${SW4_COL}`, `f${SW4_COL}`, {
  kind: 'button',
  press: (m) => {
    m.computer.programWrite(); // only does something in program mode
    m.changed();
  },
}, 'SW4 write');
top.resistor('R_SW4', 1000, `a${SW4_COL}`, top.railHole('tp', SW4_COL), 'SW4 pull-up (added)');
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

const U24 = bot.chip('U24', '74LS189', 2); // bits 7-4, cols 2-9
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

// ---- 74189 outputs -> inverters ------------------------------------------------------------------

// Lanes lie between hole rows (bottom 11-14, top 4-7) and are chosen so that
// no two wires share a lane where they overlap.
// U24 -> U28 (to its right); ~O3 is on the top row: through the channel at column 10
bot.wireLane(at('g', U24.pin('~O1')), at('g', U28.pin('1A')), 13, 'yellow');
bot.wireLane(at('g', U24.pin('~O2')), at('g', U28.pin('2A')), 11, 'yellow');
across(bot, at('d', U24.pin('~O3')), at('g', U28.pin('3A')), 6, x('a10'), 12, 'yellow');
bot.wireLane(at('d', U24.pin('~O4')), at('d', U28.pin('4A')), 5, 'yellow');
// U25 -> U29 (to its left); ~O3 through the channel at column 52
bot.wireLane(at('g', U25.pin('~O1')), at('g', U29.pin('3A')), 11, 'yellow');
bot.wireLane(at('g', U25.pin('~O2')), at('g', U29.pin('2A')), 12, 'yellow');
across(bot, at('d', U25.pin('~O3')), at('g', U29.pin('1A')), 6, x('a52'), 13, 'yellow');
bot.wireLane(at('d', U25.pin('~O4')), at('d', U29.pin('6A')), 5, 'yellow');

// ---- inverter outputs -> LED strip -> 245 A side, one lane per bit ---------------------------------

/** [bit, inverter, output pin, lane] */
const OUTS: [number, typeof U28, string, number][] = [
  [7, U28, '1Y', 14], [6, U28, '2Y', 13], [5, U28, '3Y', 12], [4, U28, '4Y', 11],
  [3, U29, '6Y', 13], [2, U29, '1Y', 12], [1, U29, '2Y', 11], [0, U29, '3Y', 14],
];
for (const [bit, inv, pin, y] of OUTS) {
  const col = bit >= 4 ? LEDS_HIGH[7 - bit] : LEDS_LOW[3 - bit];
  const out = inv.pin(pin);
  if (isTop(out)) {
    // 4Y / 6Y are on the top row: over the channel in the gap next to the inverter
    const xc = bit >= 4 ? x('a19') : x('a43');
    across(bot, at('d', out), `g${col}`, 6, xc, y, 'yellow');
  } else {
    bot.wireLane(at('g', out), `g${col}`, y, 'yellow');
  }
  bot.wireLane(`h${col}`, at('g', U30.pin(`A${8 - bit}`)), y, 'yellow');
  ledCell(bot, `D${43 - bit}`, 'red', col, `R${57 - bit}`, `RAM${bit}`).live((c) => ((c.ramValue >> bit) & 1) === 1);
}

export default b.module({
  id: 'ram',
  title: 'RAM',
  description:
    '16 bytes in two 74189s. In run mode the address comes from the MAR, data from the bus, and RI writes on the clock edge; in program mode the DIP switches give address and data and the write button stores them. Inverters undo the 74189s’ inverted outputs for the red LEDs and the 74LS245 that drives the bus on RO.',
  videos: [19, 20, 21, 22, 23],
});
