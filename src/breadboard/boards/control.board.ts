import type { Machine } from '../../sim/machine';
import { SIGNALS } from '../../sim/signals';
import { ROW } from '../computer-layout';
import { holeXY, parseHole } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type ChipHandle, type LedColor, type PortSide, type WireColor } from '../layout';

/**
 * Control logic (videos 35-40, 43-44), wired like Ben's control.png / KiCad
 * netlist (research notes). Two boards:
 *
 * Board "control" (top): the microcode.
 *   U47 / U52 28C16, both holding the microcode image: A0-A2 = step, A3-A6 =
 *     IR4-IR7, A7 = GND on U47 (high byte) and VCC on U52 (low byte), A8 = CF,
 *     A9 = ZF, A10 = GND, ~CE = ~OE = GND, ~WE = VCC.
 *     U47 D7..D0 = HLT MI RI RO IO II AI AO, U52 D7..D0 = EO SU BI OI CE CO J FI.
 *   D58-D73: one blue LED per output (220 Ω to GND), HLT ... FI from left to
 *     right, as on Ben's control panel. Each EEPROM output runs to its LED;
 *     the line leaves the board from the LED's strip: HLT, RI, SU, OI and CE
 *     straight to the modules, the eleven active-low ones (CTL.MI ...) to the
 *     inverters on the board below.
 *
 * Board "control2" (below): step counter, reset and inverters.
 *   U48 74LS161: CP = ~CLK, ~PE = CEP = CET = VCC, P0-P3 = GND,
 *     ~MR = U51A(U51B) = ~Y5 AND ~CLR (U51A is a NAND used as an inverter),
 *     Q0-Q2 -> U50 A0-A2, the EEPROM step inputs (CTL.S0-CTL.S2) and the red
 *     step LEDs D50-D52 (220 Ω to GND, Q2 Q1 Q0 from the left).
 *   U50 74LS138 (turned 180°): ~E1 = ~E2 = GND, E3 = VCC. ~Y0-~Y4 light the
 *     green T0-T4 LEDs D53-D57 (anode through 220 Ω to VCC, cathode on the
 *     output); ~Y5 resets the counter, so steps run T0 .. T4.
 *   Reset: SW8 push button to VCC with R75 1k pull-down; U51C (inputs tied)
 *     gives ~CLR, U51D (inputs tied, fed ~CLR) gives CLR.
 *   U49 / U53 74LS04 invert the eleven active-low control lines, gate for gate
 *     as in the netlist (U49: MI, RO, IO, AO, AI, II; U53: EO, BI, FI, J, CO;
 *     U53 gate 4 is unused, its input tied to GND).
 *
 * LED and resistor numbers: Ben's notes give D58-D73 for the control word.
 * D50-D57 (between the program/run LEDs D48/D49 and D58) are the step and T
 * LEDs (their order is inferred); resistors carry the LED's number (RD58 ...).
 *
 * The step lines, and the active-high outputs of the eleven inverted
 * signals, cross between the two boards as module-local port tags (CTL.*);
 * everything else uses the shared names of docs/BREADBOARD.md.
 */

const b = new LayoutBuilder();

// ---- helpers ------------------------------------------------------------------------

const colOf = (hole: string) => parseHole(hole).col;
const isTop = (hole: string) => /^[a-e]/.test(hole);
const x = (hole: string) => holeXY(hole).x;
const X = (col: number) => holeXY(`a${col}`).x;
const at = (row: string, hole: string) => `${row}${colOf(hole)}`;
/** Outermost hole of a pin's strip (row a or j). */
const outer = (hole: string) => at(isTop(hole) ? 'a' : 'j', hole);
const sideOf = (hole: string): PortSide => (isTop(hole) ? 'top' : 'bottom');

function vcc(bb: BoardBuilder, hole: string) {
  bb.wire(outer(hole), bb.railHole(isTop(hole) ? 'tp' : 'bp', colOf(hole)), 'red');
}
function gnd(bb: BoardBuilder, hole: string) {
  bb.wire(outer(hole), bb.railHole(isTop(hole) ? 'tn' : 'bn', colOf(hole)), 'black');
}
function tag(bb: BoardBuilder, name: string, pinHole: string) {
  bb.port(name, outer(pinHole), sideOf(pinHole));
}
/** Jumper along a track at board-local y, leaving and entering its holes at a slant. */
function jumper(bb: BoardBuilder, p: string, q: string, y: number, color: WireColor, off = 0.8) {
  const xp = x(p), xq = x(q);
  const s = Math.sign(xq - xp) || 1;
  return bb.wire(p, q, color, [[xp + s * off, y], [xq - s * off, y]]);
}
/** LED across the channel at `col`, signal on the top strip: anode e, cathode f, 220 Ω from j to GND. */
function cellTop(bb: BoardBuilder, id: string, color: LedColor, col: number, label: string) {
  bb.resistor(`R${id}`, 220, `j${col}`, bb.railHole('bn', col), `R${id} 220`);
  return bb.led(id, color, `e${col}`, `f${col}`, label);
}
/** LED across the channel at `col`, signal on the bottom strip: anode f, cathode e, 220 Ω from a to GND. */
function cellBottom(bb: BoardBuilder, id: string, color: LedColor, col: number, label: string) {
  bb.resistor(`R${id}`, 220, `a${col}`, bb.railHole('tn', col), `R${id} 220`);
  return bb.led(id, color, `f${col}`, `e${col}`, label);
}
/** LED across the channel at `col` that lights when the bottom strip is low: anode e (220 Ω from a to VCC), cathode f. */
function cellSink(bb: BoardBuilder, id: string, color: LedColor, col: number, label: string) {
  bb.resistor(`R${id}`, 220, `a${col}`, bb.railHole('tp', col), `R${id} 220`);
  return bb.led(id, color, `e${col}`, `f${col}`, label);
}

// =======================================================================================
// Board "control": microcode EEPROMs and the control-word LEDs
// =======================================================================================

const top = b.board('control', { x: 0, y: 0 }, 'Control logic: microcode EEPROMs');

/** Signal of control-word bit k (15 = HLT ... 0 = FI, src/sim/signals.ts). */
const signalOf = (bit: number) => SIGNALS[15 - bit];
/** Active-high at the modules: these leave the board as they are, the rest go to the inverters. */
const DIRECT = new Set(['HLT', 'RI', 'SU', 'OI', 'CE']);
const lineName = (sig: string) => (DIRECT.has(sig) ? sig : `CTL.${sig}`);
/** LED of bit k: D58 (HLT) ... D73 (FI). */
const ledOf = (bit: number) => `D${73 - bit}`;

/**
 * One EEPROM (pin 1 at column `e`) with its eight LEDs at columns
 * `cells`..`cells + 7`. `high` = U47 (control word bits 15-8, A7 = GND).
 */
function eepromGroup(id: string, e: number, cells: number, high: boolean) {
  const U = top.chip(id, '28C16', e, { params: { image: 'microcode' } });
  const bit0 = high ? 8 : 0;
  // power and fixed pins
  vcc(top, U.pin('VCC'));
  gnd(top, U.pin('GND'));
  vcc(top, U.pin('~WE'));
  gnd(top, U.pin('~OE'));
  gnd(top, U.pin('A10'));
  gnd(top, U.pin('~CE'));
  (high ? gnd : vcc)(top, U.pin('A7'));
  // address inputs
  for (let k = 0; k < 3; k++) tag(top, `CTL.S${k}`, U.pin(`A${k}`));
  for (let k = 0; k < 4; k++) tag(top, `IR${4 + k}`, U.pin(`A${3 + k}`));
  tag(top, 'CF', U.pin('A8'));
  tag(top, 'ZF', U.pin('A9'));

  // ---- the five outputs on the top row (IO7-IO3) -> LEDs at cells+0..4, staircase of lanes
  // Lanes 3, 4, 5, 6, 7; each wire leaves its pin strip from the hole just below its lane
  // and enters its LED strip from above the next lane, so the bundle has two crossings only.
  const TOP_LANES = [3.0, 4.0, 5.0, 6.0, 7.0];
  const SRC_ROW = ['a', 'b', 'c', 'c', 'c'];
  const DST_ROW = ['b', 'b', 'c', 'd', 'd'];
  for (let i = 0; i < 5; i++) {
    const io = 7 - i; // IO7 first
    const bit = bit0 + io;
    const sig = signalOf(bit);
    const col = cells + i;
    cellTop(top, ledOf(bit), 'blue', col, sig).live((c) => ((c.controlWord >> bit) & 1) === 1);
    jumper(top, at(SRC_ROW[i], U.pin(`IO${io}`)), `${DST_ROW[i]}${col}`, TOP_LANES[i], 'blue');
    top.port(lineName(sig), `a${col}`, 'top');
  }

  // ---- the three outputs on the bottom row (IO2-IO0) -> LEDs at cells+5..7, nested
  // Below the EEPROM they need lanes under its body (13, 14, 15); past it they climb to
  // 11, 12, 13 so they clear the LED resistors and port tags on row j.
  for (let i = 0; i < 3; i++) {
    const io = 2 - i; // IO2 first (innermost)
    const bit = bit0 + io;
    const sig = signalOf(bit);
    const col = cells + 5 + i;
    const src = at('i', U.pin(`IO${io}`));
    const climb = X(e + 13 + i);
    const [y0, y1] = [13.0 + i, 11.0 + i];
    cellBottom(top, ledOf(bit), 'blue', col, sig).live((c) => ((c.controlWord >> bit) & 1) === 1);
    top.wire(src, `${'ghi'[i]}${col}`, 'blue', [[x(src), y0], [climb, y0], [climb, y1], [X(col), y1]]);
    top.port(lineName(sig), `j${col}`, 'bottom');
  }
  return U;
}

eepromGroup('U47', 3, 21, true); // cols 3-14, LEDs 21-28
eepromGroup('U52', 33, 51, false); // cols 33-44, LEDs 51-58

// =======================================================================================
// Board "control2": step counter, reset, inverters
// =======================================================================================

const bot = b.board('control2', { x: 0, y: ROW }, 'Control logic: step counter, reset and inverters');

const SW8 = 3; // push button across the channel at column 3
const U51 = bot.chip('U51', '74LS00', 5); // cols 5-11
const U48 = bot.chip('U48', '74LS161', 14); // cols 14-21
const STEP = 23; // step LEDs Q2, Q1, Q0 at 23-25
const U50 = bot.chip('U50', '74LS138', 36, { rotated: true }); // cols 29-36, A0-A2 on top
const T = 39; // T0-T4 LEDs at 39-43
const U49 = bot.chip('U49', '74LS04', 46); // cols 46-52
const U53 = bot.chip('U53', '74LS04', 55); // cols 55-61

// ---- power -------------------------------------------------------------------------------

for (const u of [U51, U48, U50, U49, U53]) {
  vcc(bot, u.pin('VCC'));
  if (u !== U48) gnd(bot, u.pin('GND'));
}
// U48: GND and CEP slant to the right, clear of the straight P0-P3 ties to the GND rail
bot.wire(outer(U48.pin('GND')), 'bn22', 'black');
bot.wire(outer(U48.pin('CEP')), 'bp21', 'red');

// ---- reset: SW8 to VCC, R75 pull-down, U51C -> ~CLR, U51D -> CLR ---------------------------

bot.button('SW8', `e${SW8}`, `f${SW8}`, { kind: 'button', press: (m: Machine) => m.reset() }, 'SW8 reset');
bot.wire(`j${SW8}`, bot.railHole('bp', SW8), 'red');
bot.resistor('R75', 1000, `a${SW8}`, bot.railHole('tn', SW8), 'R75 1k');
const tie = (u: ChipHandle, p: string, q: string, row: string) => bot.wire(at(row, u.pin(p)), at(row, u.pin(q)), 'white');
tie(U51, '3A', '3B', 'c');
bot.wireLane(`d${SW8}`, at('d', U51.pin('3B')), 6.0, 'white'); // button node -> U51C
tie(U51, '4A', '4B', 'b');
bot.wireLane(at('c', U51.pin('3Y')), at('c', U51.pin('4A')), 5.0, 'white'); // ~CLR -> U51D
tag(bot, '~CLR', U51.pin('3Y'));
tag(bot, 'CLR', U51.pin('4Y'));

// ---- step counter reset: ~MR = NOT NAND(~Y5, ~CLR) ------------------------------------------

// ~CLR down to U51B 2B, round the right end of U51 through the free column 12
bot.wire(at('d', U51.pin('3Y')), at('g', U51.pin('2B')), 'white', [
  [x(U51.pin('3Y')), 7.0], [X(12), 7.0], [X(12), 11.0], [x(U51.pin('2B')), 11.0],
]);
tie(U51, '1A', '1B', 'g');
bot.wireLane(at('h', U51.pin('2Y')), at('h', U51.pin('1B')), 12.0, 'white'); // U51B -> U51A
bot.wireLane(at('j', U51.pin('1Y')), at('j', U48.pin('~MR')), 14.0, 'white'); // U51A -> ~MR
bot.wireLane(at('h', U50.pin('~Y5')), at('i', U51.pin('2A')), 13.0, 'orange'); // ~Y5 -> U51B

// ---- U48 74LS161 ---------------------------------------------------------------------------

tag(bot, '~CLK', U48.pin('CP'));
for (const p of ['P0', 'P1', 'P2', 'P3']) gnd(bot, U48.pin(p));
for (const p of ['CET', '~PE']) vcc(bot, U48.pin(p));

// Q0-Q2 -> step LEDs (Q2 Q1 Q0 from the left) -> U50 A0-A2, one lane each (Q0 4, Q1 5, Q2 6)
for (let k = 0; k < 3; k++) {
  const q = U48.pin(`Q${k}`);
  const a = U50.pin(`A${k}`);
  const col = STEP + 2 - k;
  const y = 4.0 + k;
  const inRow = 'bcd'[k], outRow = 'abc'[k];
  tag(bot, `CTL.S${k}`, q);
  cellTop(bot, `D${50 + k}`, 'red', col, `Q${k}`).live((c) => ((c.step >> k) & 1) === 1);
  jumper(bot, at(inRow, q), `${inRow}${col}`, y, 'yellow');
  jumper(bot, `${outRow}${col}`, at(inRow, a), y, 'yellow');
}

// ---- U50 74LS138 -----------------------------------------------------------------------------

gnd(bot, U50.pin('~E1'));
bot.wire(at('b', U50.pin('~E2')), at('b', U50.pin('~E1')), 'black'); // ~E2 = ~E1 = GND
vcc(bot, U50.pin('E3'));
// ~Y0-~Y4 -> T0-T4 LEDs (cathode side), nested lanes 11 (T0) .. 15 (T4)
for (let k = 0; k < 5; k++) {
  const yk = U50.pin(`~Y${k}`);
  const col = T + k;
  const y = 11.0 + k;
  const row = 'ghijj'[k];
  cellSink(bot, `D${53 + k}`, 'green', col, `T${k}`).live((c) => c.step === k);
  bot.wireLane(at(row, yk), `${row}${col}`, y, 'yellow');
}

// ---- inverters: active-high lines in, active-low lines out -------------------------------------

const INVERT: [ChipHandle, string, number][] = [
  [U49, 'MI', 1], [U49, 'RO', 2], [U49, 'IO', 3], [U49, 'AO', 4], [U49, 'AI', 5], [U49, 'II', 6],
  [U53, 'EO', 1], [U53, 'BI', 2], [U53, 'FI', 3], [U53, 'J', 5], [U53, 'CO', 6],
];
for (const [u, sig, g] of INVERT) {
  tag(bot, `CTL.${sig}`, u.pin(`${g}A`));
  tag(bot, `~${sig}`, u.pin(`${g}Y`));
}
gnd(bot, U53.pin('4A')); // spare gate

export default b.module({
  id: 'control',
  title: 'Control logic',
  description:
    'Two 28C16 EEPROMs hold the microcode: the step counter (74LS161, clocked on the falling edge and decoded by a 74LS138 into T0-T4), the opcode and the flags address them, and the 16 outputs are the control word, shown on the blue LEDs. 74LS04s invert the active-low lines; the reset button clears every register through NAND gates.',
  videos: [35, 36, 37, 38, 39, 40, 43, 44],
});
