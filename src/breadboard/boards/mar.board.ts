import { ROWS, holeXY, parseHole, type Row } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type LedColor, type LiveControl, type PortSide, type WireColor } from '../layout';

/**
 * Memory address register + program/run address mux (videos 19-22), wired
 * pin for pin like Ben's mar.png (KiCad netlist, research notes):
 *   U34 74LS173 (MAR): D3-D0 (pins 11-14) <- BUS0-BUS3 (Ben wires the nibble
 *     reversed, so Q3 holds address bit 0), ~G1/~G2 -> ~MI, CP -> CLK,
 *     MR -> CLR, ~M/~N -> GND.
 *   U33 74LS157: S = PROG (low = program: I0, the DIP switch; high = run:
 *     I1, the MAR), ~E -> GND.
 *     section 1 (Ben's a): I1 = Q0, I0 = SW5 switch 4, Y = RA3
 *     section 2 (b):       I1 = Q1, I0 = SW5 switch 3, Y = RA2
 *     section 4 (c):       I1 = Q2, I0 = SW5 switch 2, Y = RA1
 *     section 3 (d):       I1 = Q3, I0 = SW5 switch 1, Y = RA0
 *   SW5 4-position DIP: switch k grounds address bit k-1 when ON. No pull-ups:
 *     an open switch floats high (LS-TTL), so OFF = 1.
 *   RA0-RA3 go to both 74189s on the RAM board and to the yellow LEDs
 *     D47-D44 (220 Ω R62-R59 on the cathode side to GND).
 *   Program/run switch exactly as in the schematic: SW6 common -> GND;
 *     throw A -> PROG, throw C -> cathode of the green LED D49 (anode via R64
 *     1k from VCC: lit in run). The red LED D48 sits between R63 1k from VCC
 *     and PROG (lit when SW6 grounds PROG). In run, R63 + D48 are PROG's only
 *     pull-up ("pulled high through the LED"); a TTL input left like that reads
 *     high. PROG goes to the four 74LS157 S pins (U33 here, U26/U27/U32 on the
 *     RAM board).
 *
 * Layout: SW5 sits between the 173 and the 157, each switch using the leg that
 * faces its mux input and grounding the other one (Ben's SW5 pads 3, 4, 7, 8
 * are the grounded ones), so the switch wires nest without crossing. Each
 * address LED straddles the centre channel (anode = address line in the
 * bottom strip, 220 Ω from the top strip to GND). The RA tags point down at
 * the RAM board. Lanes lie between hole rows (one short jumper lies along
 * row h); nothing lies on top of another wire.
 */

const b = new LayoutBuilder();
const bb = b.board('mar', { x: 0, y: 0 }, 'Memory address register');

const O = 12; // shift everything right to centre it (keeps rail-hole alignment: rail groups repeat every 6 columns)
const U34 = bb.chip('U34', '74LS173', O + 3); // cols 15-22
const SW5_COL = O + 14; // switch k at column SW5_COL + k - 1
const U33 = bb.chip('U33', '74LS157', O + 20); // cols 32-39
const LEDS = [33, 34, 35, 36].map((c) => O + c); // RA3, RA2, RA1, RA0 (D44-D47)
const MODE = O + 39; // D48, SW6, D49 in columns MODE .. MODE+2

// ---- helpers ------------------------------------------------------------------

const colOf = (hole: string) => parseHole(hole).col;
const isTop = (hole: string) => ROWS.indexOf(parseHole(hole).row as Row) < 5;
/** Outermost hole of a pin's strip (row a or j): tags and rail wires go there, signal wires use the inner holes. */
const outer = (hole: string) => `${isTop(hole) ? 'a' : 'j'}${colOf(hole)}`;
const side = (hole: string): PortSide => (isTop(hole) ? 'top' : 'bottom');
const at = (row: Row, hole: string) => `${row}${colOf(hole)}`;
const x = (hole: string) => holeXY(hole).x;
/** x of the gap column `c` (for wires that cross the channel there). */
const gapX = (c: number) => x(`a${c}`);

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
function across(from: string, to: string, ya: number, xc: number, yb: number, color: WireColor) {
  return bb.wire(from, to, color, [[x(from), ya], [xc, ya], [xc, yb], [x(to), yb]]);
}

// ---- ports (outer holes) ------------------------------------------------------------

portAt(bb, 'CLR', U34.pin('MR'));
for (let k = 0; k < 4; k++) portAt(bb, `BUS${3 - k}`, U34.pin(`D${k}`)); // D0 = BUS3 ... D3 = BUS0
portAt(bb, '~MI', U34.pin('~G1'));
portAt(bb, 'CLK', U34.pin('CP'));
LEDS.forEach((col, i) => bb.port(`RA${3 - i}`, `j${col}`, 'bottom'));
bb.port('PROG', `j${MODE}`, 'bottom');

// ---- power ------------------------------------------------------------------------

for (const u of [U34, U33]) {
  vcc(bb, u.pin('VCC'));
  gnd(bb, u.pin('GND'));
}
gnd(bb, U34.pin('~M'));
gnd(bb, U34.pin('~N'));
gnd(bb, U33.pin('~E'));

// ---- MAR load enables tied together ------------------------------------------------------

bb.wire(at('d', U34.pin('~G2')), at('d', U34.pin('~G1')), 'white');

// ---- SW5: address switches (ON = 0) -----------------------------------------------------
// Switch k is address bit k-1. Bits 0-1 feed the top row of U33 (3I0, 4I0),
// bits 2-3 the bottom row (2I0, 1I0); the other leg goes to GND.

const SW5 = bb.dip('SW5', 4, SW5_COL, {
  kind: 'dip',
  get: (m) => ~m.computer.dipAddress & 0x0f,
  set: (m, v) => {
    m.computer.dipAddress = ~v & 0x0f;
    m.changed();
  },
});
gnd(bb, SW5.pin(1, 'bottom'));
gnd(bb, SW5.pin(2, 'bottom'));
gnd(bb, SW5.pin(3, 'top'));
gnd(bb, SW5.pin(4, 'top'));
bb.wireLane(at('d', SW5.pin(1, 'top')), at('d', U33.pin('3I0')), 6, 'blue'); // bit 0 (outer)
bb.wireLane(at('d', SW5.pin(2, 'top')), at('d', U33.pin('4I0')), 7, 'blue'); // bit 1 (inner)
bb.wireLane(at('g', SW5.pin(3, 'bottom')), at('g', U33.pin('2I0')), 11, 'blue'); // bit 2
bb.wireLane(at('j', SW5.pin(4, 'bottom')), at('j', U33.pin('1I0')), 15, 'blue'); // bit 3, under everything

// ---- MAR outputs -> mux I1 inputs (run mode) --------------------------------------------
// Q2/Q3 feed the top row of U33: through the channel in the gap after U34.
// The bottom-half wires below (and PROG) use the holes and lanes that keep
// them from crossing each other; the only crossings left on this board are
// three in the top half that the pinout forces.

bb.wireLane(at('g', U34.pin('Q0')), at('i', U33.pin('1I1')), 14, 'yellow'); // bit 3
bb.wireLane(at('g', U34.pin('Q1')), at('g', U33.pin('2I1')), 12, 'yellow'); // bit 2
across(at('h', U34.pin('Q2')), at('d', U33.pin('4I1')), 13, gapX(O + 12), 5, 'yellow'); // bit 1
across(at('g', U34.pin('Q3')), at('d', U33.pin('3I1')), 11, gapX(O + 11), 4, 'yellow'); // bit 0

// ---- mux outputs = RAM address -> LED strips (RA tags there) -------------------------------
// 4Y/3Y are on the top row: through the channel in the gap after U33.

bb.wireLane(at('i', U33.pin('1Y')), `i${LEDS[0]}`, 14, 'yellow'); // RA3
bb.wire(at('h', U33.pin('2Y')), `h${LEDS[1]}`, 'yellow'); // RA2: a straight jumper along row h
across(at('d', U33.pin('4Y')), `g${LEDS[2]}`, 5, gapX(O + 29), 11, 'yellow'); // RA1
across(at('d', U33.pin('3Y')), `g${LEDS[3]}`, 6, gapX(O + 28), 12, 'yellow'); // RA0

for (let i = 0; i < 4; i++) {
  const bit = 3 - i;
  ledCell(bb, `D${44 + i}`, 'yellow', LEDS[i], `R${59 + i}`, `RA${bit}`).live((c) => ((c.ramAddress >> bit) & 1) === 1);
}

// ---- program / run -----------------------------------------------------------------------

// D48 red: VCC - R63 - anode (top strip), cathode in the PROG strip (bottom).
bb.resistor('R63', 1000, `a${MODE}`, bb.railHole('tp', MODE), 'R63');
bb.led('D48', 'red', `e${MODE}`, `f${MODE}`, 'PROG').live((c) => c.programMode);
// D49 green: VCC - R64 - anode, cathode to SW6's run throw.
bb.resistor('R64', 1000, `a${MODE + 2}`, bb.railHole('tp', MODE + 2), 'R64');
bb.led('D49', 'green', `e${MODE + 2}`, `f${MODE + 2}`, 'RUN').live((c) => !c.programMode);
// SW6: position 0 (program) joins the common (GND) to PROG, position 1 (run)
// to D49. Added directly so the board starts in run mode, like the simulator.
const sw6: LiveControl = {
  kind: 'slide',
  get: (m) => (m.computer.programMode ? 0 : 1),
  set: (m, pos) => {
    m.computer.programMode = pos === 0;
    m.changed();
  },
};
b.add({ id: 'SW6', board: 'mar', label: 'SW6', kind: 'slide', a: `h${MODE}`, common: `h${MODE + 1}`, b: `h${MODE + 2}`, initial: 1 });
b.live.controls.SW6 = sw6;
gnd(bb, `h${MODE + 1}`);
// PROG -> U33 S, on lane 13 under the address wires (nothing crosses it).
bb.wireLane(`i${MODE}`, at('h', U33.pin('S')), 13, 'orange');

export default b.module({
  id: 'mar',
  title: 'Memory address register',
  description:
    'A 74LS173 latches the RAM address from the bus on MI. A 74LS157 picks the address the RAM sees: the MAR in run mode, the 4 DIP switches in program mode (yellow LEDs). The program/run switch drives the PROG line (red = program, green = run).',
  videos: [19, 20, 21, 22],
});
