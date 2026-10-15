import { ROWS, parseHole, type Row } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type LedColor, type PortSide } from '../layout';

/**
 * Instruction register (videos 11-13), wired pin for pin like Ben's ir.png
 * (KiCad netlist, research notes):
 *   U14 74LS173 = IR7-4: D0-D3 <- BUS7-BUS4, Q0-Q3 = IR7-IR4
 *   U15 74LS173 = IR3-0: D0-D3 <- BUS3-BUS0, Q0-Q3 = IR3-IR0
 *     (Ben wires each nibble "mirrored": D0 takes its highest bit)
 *     ~M, ~N (pins 1, 2) -> GND: outputs always on (LEDs, 245, control logic)
 *     ~G1, ~G2 (pins 9, 10) tied -> ~II, CP (7) -> CLK, MR (15) -> CLR
 *   U13 74LS245: DIR (1) -> VCC (A to B), ~OE (19) -> ~IO.
 *     A1-A4 (pins 2-5) -> GND, so B1-B4 = BUS7-BUS4 are driven to 0;
 *     A5-A8 (pins 6-9) = IR3-IR0, so B5-B8 drive BUS3-BUS0.
 *     B1-B8 (pins 18-11) are BUS7-BUS0 and also feed the 173 D inputs.
 *   IR7-IR4 go to the control logic (ports IR4-IR7).
 *   LEDs (220 Ω on the cathode side to GND, as in the schematic):
 *     D26-D29 blue = IR7-IR4 (R40-R43), D30-D33 yellow = IR3-IR0 (R44-R47).
 *
 * Layout: the 245 sits between the two 173s (like the B register board), so
 * each nibble's bus wires stay on their own side. Each LED straddles the
 * centre channel in a column of its own: anode in the bottom strip (the
 * signal), cathode in the top strip, which its 220 Ω resistor takes to the
 * top GND rail. The low nibble runs 173 Q -> LED strip -> 245 A. Lanes lie
 * between hole rows; no two wires lie on top of each other and only one pair
 * crosses. Every pin of the three chips is used, so nothing is left floating.
 */

const b = new LayoutBuilder();
const bb = b.board('ir', { x: 0, y: 0 }, 'Instruction register');

const U14 = bb.chip('U14', '74LS173', 14); // IR7-4, cols 14-21
const U13 = bb.chip('U13', '74LS245', 27); // cols 27-36
const U15 = bb.chip('U15', '74LS173', 45); // IR3-0, cols 45-52

const LEDS_HIGH = [22, 23, 24, 25]; // IR7..IR4 (rail columns 21-25)
const LEDS_LOW = [39, 40, 41, 42]; // IR3..IR0 (rail columns 39-43)

// ---- helpers ------------------------------------------------------------------

const colOf = (hole: string) => parseHole(hole).col;
const isTop = (hole: string) => ROWS.indexOf(parseHole(hole).row as Row) < 5;
/** Outermost hole of a pin's strip (row a or j): tags and rail wires go there, signal wires use the inner holes. */
const outer = (hole: string) => `${isTop(hole) ? 'a' : 'j'}${colOf(hole)}`;
const side = (hole: string): PortSide => (isTop(hole) ? 'top' : 'bottom');
const at = (row: Row, hole: string) => `${row}${colOf(hole)}`;

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

// ---- ports first (outer holes) -------------------------------------------------

for (const u of [U14, U15]) {
  portAt(bb, 'CLR', u.pin('MR'));
  portAt(bb, '~II', u.pin('~G1'));
  portAt(bb, 'CLK', u.pin('CP'));
}
portAt(bb, '~IO', U13.pin('~OE'));
for (let k = 1; k <= 8; k++) portAt(bb, `BUS${8 - k}`, U13.pin(`B${k}`)); // B1 = BUS7 ... B8 = BUS0
LEDS_HIGH.forEach((col, i) => bb.port(`IR${7 - i}`, `j${col}`, 'bottom'));

// ---- power ----------------------------------------------------------------------

for (const u of [U14, U15, U13]) {
  vcc(bb, u.pin('VCC'));
  gnd(bb, u.pin('GND'));
}
for (const u of [U14, U15]) {
  gnd(bb, u.pin('~M'));
  gnd(bb, u.pin('~N'));
}
vcc(bb, U13.pin('DIR'));
for (let k = 1; k <= 4; k++) gnd(bb, U13.pin(`A${k}`)); // the 245 drives BUS7-4 = 0

// ---- control: load enables tied together -------------------------------------------

for (const u of [U14, U15]) bb.wire(at('d', u.pin('~G2')), at('d', u.pin('~G1')), 'white');

// ---- bus -> D inputs (blue), from the 245's B strips --------------------------------
// Each bundle is a staircase (every wire shifted one column from the last).
// The first wire runs on the lane between rows d and e; each next one takes
// the next lane out and starts one hole further from the chip, so it leaves
// above the lanes already used and no two wires cross.

const STAIR_ROWS: Row[] = ['d', 'd', 'c', 'b'];
for (let k = 0; k < 4; k++) {
  const y = 7 - k;
  // U14 D(k) = BUS(7-k) = U13 B(k+1); U15 D(k) = BUS(3-k) = U13 B(k+5)
  bb.wireLane(at(STAIR_ROWS[k], U14.pin(`D${k}`)), at('d', U13.pin(`B${k + 1}`)), y, 'blue');
  bb.wireLane(at(STAIR_ROWS[k], U13.pin(`B${k + 5}`)), at('d', U15.pin(`D${k}`)), y, 'blue');
}

// ---- outputs (yellow) and LEDs ---------------------------------------------------------
// High nibble: U14 Q(k) = IR(7-k) -> its LED strip (the IR tag sits there
// too), a staircase like the bus wires: lane 11 + k, starting one hole
// deeper each time.
// Low nibble: U15 Q(k) = IR(3-k) -> LED strip -> U13 A(k+5). The two wires
// of a bit use different holes of the LED strip and lanes that keep their
// ends apart, so no two wires lie on top of each other and none cross
// (except IR0's lane 15, over U13's short ground jumper).
// [Q row, LED row, lane] for Q -> LED, then [LED row, A row, lane] for LED -> A.
const HIGH_ROWS: Row[] = ['g', 'g', 'h', 'i'];
const LOW_IN: [Row, Row, number][] = [['g', 'g', 11], ['h', 'i', 13], ['g', 'g', 12], ['g', 'i', 14]];
const LOW_OUT: [Row, Row, number][] = [['h', 'g', 12], ['g', 'h', 13], ['i', 'i', 14], ['j', 'j', 15]];

for (let k = 0; k < 4; k++) {
  const hi = 7 - k, lo = 3 - k;
  bb.wireLane(at(HIGH_ROWS[k], U14.pin(`Q${k}`)), `g${LEDS_HIGH[k]}`, 11 + k, 'yellow');
  const [qRow, inRow, inLane] = LOW_IN[k];
  const [outRow, aRow, outLane] = LOW_OUT[k];
  bb.wireLane(at(qRow, U15.pin(`Q${k}`)), `${inRow}${LEDS_LOW[k]}`, inLane, 'yellow');
  bb.wireLane(`${outRow}${LEDS_LOW[k]}`, at(aRow, U13.pin(`A${k + 5}`)), outLane, 'yellow');

  ledCell(bb, `D${26 + k}`, 'blue', LEDS_HIGH[k], `R${40 + k}`, `IR${hi}`).live((c) => ((c.ir >> hi) & 1) === 1);
  ledCell(bb, `D${30 + k}`, 'yellow', LEDS_LOW[k], `R${44 + k}`, `IR${lo}`).live((c) => ((c.ir >> lo) & 1) === 1);
}

export default b.module({
  id: 'ir',
  title: 'Instruction register',
  description:
    'Two 74LS173s latch the instruction from the bus on II. The opcode (IR7-4, blue LEDs) goes to the control logic; a 74LS245 puts the operand (IR3-0, yellow LEDs) back on the bus on IO, with its upper four inputs grounded so BUS7-4 read 0.',
  videos: [11, 12, 13],
});
