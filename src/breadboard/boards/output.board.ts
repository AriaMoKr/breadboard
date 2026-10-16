import { displaySegments } from '../../sim/display';
import type { Machine } from '../../sim/machine';
import { ROW } from '../computer-layout';
import { holeXY, parseHole } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type WireColor } from '../layout';

/**
 * Output register and decimal display (videos 33-34), wired like Ben's
 * output.png / KiCad netlist (research notes). Two boards:
 *
 * Board "output" (top): the register and the digit multiplexer.
 *   U44 74LS273: D0-D7 = BUS0-7, CP = OI AND CLK (U46A 74LS08), ~MR = ~CLR,
 *     Q0-Q7 -> display EEPROM A0-A7 (OUT.A0-OUT.A7, to the board below).
 *     U46 gates B-D are unused; their inputs are tied to GND.
 *   U39 NE555 astable: R65 1k VCC -> DIS, R66 100k DIS -> THR/TRIG, C8 10nF
 *     THR/TRIG -> GND, C9 10nF on CV. ~RESET (pin 4) is drawn "not
 *     connected" in Ben's schematic; it is tied to VCC here, as the 555
 *     datasheet asks (an open LS input reads high anyway, so the logic is the
 *     same). The engine runs it at a half period of 400 gate delays.
 *   U37 74LS76, both JK flip-flops with J = K = ~PRE = ~CLR = 1 (toggle):
 *     FF1 clock = 555 OUT; FF1 ~Q -> FF2 clock, EEPROM A8 (OUT.A8) and
 *     U38 1A0; FF2 ~Q -> EEPROM A9 (OUT.A9) and U38 1A1. Taking the ~Q
 *     outputs makes the pair count 0, 1, 2, 3 on the 555's falling edges.
 *   U38 74LS139 half 1 (~1E = GND): ~1Y0-~1Y3 sink the digit commons
 *     (OUT.~Y0 ones ... OUT.~Y3 sign). Half 2 is unused: ~2E = VCC,
 *     2A0/2A1 = GND.
 *
 * Board "output2" (below): the display EEPROM and the four digits.
 *   U45 28C16 (the multiplexed-display image), turned 180° so its data pins
 *     face the digits: A0-A7 = register, A8/A9 = digit select, A10 = SW7,
 *     ~CE = ~OE = GND, ~WE = VCC. IO0-IO7 drive segments g, f, e, d, c, b,
 *     a, dp of all four common-cathode digits in parallel (no segment
 *     resistors, as in Ben's parts list).
 *   SW7 (slide): common -> A10, one throw -> VCC (signed), the other open;
 *     R104 10k pulls A10 low (unsigned).
 *   U40 (sign, leftmost), U41 (hundreds), U42 (tens), U43 (ones): their
 *     commons come from U38 on the board above.
 *
 * The register, select and common lines cross between the two boards as
 * module-local port tags (OUT.*); BUS0-7, OI, CLK and ~CLR are the shared
 * ports from docs/BREADBOARD.md.
 *
 * Routing: on the display board every segment line has its own track above
 * (g, f, a, b) or below (e, d, c, dp) the digits; jumpers between digits
 * leave their holes at a slant so the two wires on one pin never lie on
 * top of each other.
 */

const b = new LayoutBuilder();

// ---- helpers ------------------------------------------------------------------------

const colOf = (hole: string) => parseHole(hole).col;
const x = (hole: string) => holeXY(hole).x;
const X = (col: number) => holeXY(`a${col}`).x;
/** The hole in row `row` of the column of `hole`. */
const at = (row: string, hole: string) => `${row}${colOf(hole)}`;

function vcc(bb: BoardBuilder, hole: string) {
  const top = /^[a-e]/.test(hole);
  bb.wire(hole, bb.railHole(top ? 'tp' : 'bp', colOf(hole)), 'red');
}
function gnd(bb: BoardBuilder, hole: string) {
  const top = /^[a-e]/.test(hole);
  bb.wire(hole, bb.railHole(top ? 'tn' : 'bn', colOf(hole)), 'black');
}
/**
 * Jumper from hole `p` to hole `q` along a track at board-local y: it leaves
 * and enters its holes at a slant (0.8 columns towards the other end), so a
 * second wire on the same pin, going the other way, never overlaps it.
 */
function jumper(bb: BoardBuilder, p: string, q: string, y: number, color: WireColor, off = 0.8) {
  const xp = x(p), xq = x(q);
  const s = Math.sign(xq - xp) || 1;
  return bb.wire(p, q, color, [[xp + s * off, y], [xq - s * off, y]]);
}

// =======================================================================================
// Board "output": 74LS273 register, clock gate, 555 + 74LS76 digit counter, 74LS139
// =======================================================================================

const top = b.board('output', { x: 0, y: 0 }, 'Output register and digit multiplexer');

const U46 = top.chip('U46', '74LS08', 8, { rotated: true }); // cols 2-8, gate A on top
const U44 = top.chip('U44', '74LS273', 11); // cols 11-20
const U39 = top.chip('U39', 'NE555', 24, { params: { mode: 'astable', halfPeriod: 400 } }); // cols 24-27
const U37 = top.chip('U37', '74LS76', 31); // cols 31-38
const U38 = top.chip('U38', '74LS139', 42); // cols 42-49

// ---- power --------------------------------------------------------------------------------

for (const u of [U44, U39, U37, U38]) {
  const v = u.pin('VCC'), g = u.pin('GND');
  vcc(top, at(/^[a-e]/.test(v) ? 'a' : 'j', v));
  if (u !== U44) gnd(top, at(/^[a-e]/.test(g) ? 'a' : 'j', g));
}
top.wire(at('j', U44.pin('GND')), 'bn21', 'black'); // away from the OUT.A3 tag next to it
top.wire(at('j', U46.pin('VCC')), 'bp9', 'red'); // bp7 lies under the GND wire of 4B
gnd(top, at('a', U46.pin('GND')));

// ---- U46A: CP = OI AND CLK -------------------------------------------------------------------

top.port('OI', at('a', U46.pin('1A')), 'top');
top.port('CLK', at('a', U46.pin('1B')), 'top');
top.wireLane(at('d', U46.pin('1Y')), at('d', U44.pin('CP')), 6.0, 'white');
// unused gates B-D: inputs to GND
for (const p of ['2A', '2B']) gnd(top, at('a', U46.pin(p)));
for (const p of ['3A', '3B', '4A', '4B']) gnd(top, at('j', U46.pin(p)));

// ---- U44: bus in, register out ----------------------------------------------------------------

top.port('~CLR', at('j', U44.pin('~MR')), 'bottom');
for (let bit = 0; bit < 8; bit++) {
  const d = U44.pin(`D${bit}`), q = U44.pin(`Q${bit}`);
  const isTop = /^[a-e]/.test(d);
  top.port(`BUS${bit}`, at(isTop ? 'a' : 'j', d), isTop ? 'top' : 'bottom');
  const qTop = /^[a-e]/.test(q);
  top.port(`OUT.A${bit}`, at(qTop ? 'a' : 'j', q), qTop ? 'top' : 'bottom');
}

// ---- U39: 555 astable (about 716 Hz on Ben's board) --------------------------------------------

top.resistor('R65', 1000, top.railHole('tp', colOf(U39.pin('DIS'))), at('a', U39.pin('DIS')), 'R65 1k');
top.resistor('R66', 100_000, at('c', U39.pin('DIS')), at('a', U39.pin('THR')), 'R66 100k');
// THR -> TRIG, round the left end of the chip through the free column 23
top.wire(at('d', U39.pin('THR')), at('g', U39.pin('TRIG')), 'green', [
  [x(U39.pin('THR')), 6.0], [X(22), 6.0], [X(22), 11.0], [x(U39.pin('TRIG')), 11.0],
]);
top.capacitor('C8', 1e-8, at('i', U39.pin('TRIG')), top.railHole('bn', colOf(U39.pin('TRIG'))), false, 'C8 10nF');
top.capacitor('C9', 1e-8, at('a', U39.pin('CV')), top.railHole('tn', colOf(U39.pin('CV'))), false, 'C9 10nF');
vcc(top, at('j', U39.pin('~RESET')));

// ---- U37: two toggling JK flip-flops -----------------------------------------------------------

for (const p of ['~1PRE', '~1CLR', '1J', '~2PRE', '~2CLR']) vcc(top, at('j', U37.pin(p)));
for (const p of ['1K', '2K', '2J']) vcc(top, at('a', U37.pin(p)));
top.wireLane(at('h', U39.pin('OUT')), at('h', U37.pin('~1CLK')), 13.0, 'orange'); // 555 -> FF1 clock
// FF1 ~Q -> 139 1A0: over the top of U37, through the channel at column 41
top.wire(at('d', U37.pin('~1Q')), at('g', U38.pin('1A0')), 'purple', [
  [x(U37.pin('~1Q')), 5.0], [X(41), 5.0], [X(41), 12.0], [x(U38.pin('1A0')), 12.0],
]);
// FF2 ~Q -> 139 1A1: one lane further in, through the channel at column 40
top.wire(at('d', U37.pin('~2Q')), at('h', U38.pin('1A1')), 'orange', [
  [x(U37.pin('~2Q')), 6.0], [X(40), 6.0], [X(40), 13.0], [x(U38.pin('1A1')), 13.0],
]);
// FF1 ~Q -> FF2 clock, picked up again from the 1A0 strip
top.wireLane(at('i', U38.pin('1A0')), at('i', U37.pin('~2CLK')), 14.0, 'purple');

// ---- U38: digit decoder -------------------------------------------------------------------------

gnd(top, at('j', U38.pin('~1E')));
top.port('OUT.A8', at('j', U38.pin('1A0')), 'bottom');
top.port('OUT.A9', at('j', U38.pin('1A1')), 'bottom');
for (let k = 0; k < 4; k++) top.port(`OUT.~Y${k}`, at('j', U38.pin(`~1Y${k}`)), 'bottom');
vcc(top, at('a', U38.pin('~2E')));
for (const p of ['2A0', '2A1']) gnd(top, at('a', U38.pin(p)));

// =======================================================================================
// Board "output2": display EEPROM, signed switch, four digits
// =======================================================================================

const bot = b.board('output2', { x: 0, y: ROW }, 'Decimal display');

const U45 = bot.chip('U45', '28C16', 51, { rotated: true, params: { image: 'display' } }); // cols 40-51
/** The four digits, left to right, and the 74LS139 output that sinks each common. */
const DIGITS = [
  { id: 'U40', col: 12, name: 'sign', sel: 3 },
  { id: 'U41', col: 18, name: 'hundreds', sel: 2 },
  { id: 'U42', col: 24, name: 'tens', sel: 1 },
  { id: 'U43', col: 30, name: 'ones', sel: 0 },
] as const;
DIGITS.forEach(({ id, col, name }, i) => {
  bot.seg7(id, col, 'cathode', (c) => displaySegments(c.out, c.signedDisplay)[i], `${id} ${name}`);
});

// ---- EEPROM power, control pins, address ---------------------------------------------------------

vcc(bot, at('j', U45.pin('VCC')));
gnd(bot, at('a', U45.pin('GND')));
gnd(bot, at('j', U45.pin('~CE')));
gnd(bot, at('j', U45.pin('~OE')));
vcc(bot, at('j', U45.pin('~WE')));
for (let k = 0; k < 8; k++) bot.port(`OUT.A${k}`, at('a', U45.pin(`A${k}`)), 'top');
bot.port('OUT.A8', at('j', U45.pin('A8')), 'bottom');
bot.port('OUT.A9', at('j', U45.pin('A9')), 'bottom');

// ---- SW7 signed mode: common -> A10, b -> VCC, a open; R104 pulls A10 low ---------------------------

const SW = 52; // legs in row c, columns 52-54
bot.slide('SW7', `c${SW}`, `c${SW + 1}`, `c${SW + 2}`, {
  kind: 'slide',
  get: (m: Machine) => (m.computer.signedDisplay ? 1 : 0),
  set: (m: Machine, pos: 0 | 1) => {
    m.computer.signedDisplay = pos === 1;
  },
}, 'SW7 signed');
bot.wire(`a${SW + 2}`, bot.railHole('tp', SW + 2), 'red');
const a10 = U45.pin('A10');
bot.wire(`d${SW + 1}`, at('i', a10), 'white', [[X(SW + 1), 13.0], [x(a10), 13.0]]);
bot.resistor('R104', 10_000, at('j', a10), bot.railHole('bn', colOf(a10)), 'R104 10k');

// ---- digit commons from U38 ----------------------------------------------------------------------

for (const { col, sel } of DIGITS) bot.port(`OUT.~Y${sel}`, `c${col + 2}`, 'right'); // label sits over the digit

// ---- segment lines -------------------------------------------------------------------------------

/** Per segment: column of its pin within a digit, top or bottom pin row, its track (board-local y), the EEPROM IO bit driving it. */
const SEGMENTS = {
  g: { off: 0, top: true, y: 2.5, io: 0 },
  f: { off: 1, top: true, y: 3.0, io: 1 },
  a: { off: 3, top: true, y: 4.0, io: 6 },
  b: { off: 4, top: true, y: 4.9, io: 5 },
  e: { off: 0, top: false, y: 14.0, io: 2 },
  d: { off: 1, top: false, y: 15.5, io: 3 },
  c: { off: 3, top: false, y: 15.0, io: 4 },
  dp: { off: 4, top: false, y: 13.2, io: 7 },
} as const;
type Seg = keyof typeof SEGMENTS;

/** The two holes a segment line uses on a digit pin: [0] for the wire from the left, [1] for the wire to the right. */
const pinHoles = (seg: Seg, col: number) => (SEGMENTS[seg].top ? [`a${col}`, `b${col}`] : [`j${col}`, `i${col}`]);

// jumpers between neighbouring digits
for (const seg of Object.keys(SEGMENTS) as Seg[]) {
  const s = SEGMENTS[seg];
  for (let k = 0; k + 1 < DIGITS.length; k++) {
    const left = DIGITS[k].col + s.off, right = DIGITS[k + 1].col + s.off;
    jumper(bot, pinHoles(seg, left)[1], pinHoles(seg, right)[0], s.y, 'yellow');
  }
}

// feeds from the EEPROM to the ones digit (U43); e, a and b change sides in the gap
const ONES = DIGITS[3].col;
const io = (seg: Seg) => U45.pin(`IO${SEGMENTS[seg].io}`);
const feedEnd = (seg: Seg) => pinHoles(seg, ONES + SEGMENTS[seg].off)[1];
// top to top: g, f
jumper(bot, feedEnd('g'), at('b', io('g')), SEGMENTS.g.y, 'yellow');
jumper(bot, feedEnd('f'), at('b', io('f')), SEGMENTS.f.y, 'yellow');
// bottom to bottom: d, c on their tracks; dp flat along row j
jumper(bot, feedEnd('d'), at('i', io('d')), SEGMENTS.d.y, 'yellow');
jumper(bot, feedEnd('c'), at('i', io('c')), SEGMENTS.c.y, 'yellow');
bot.wire(at('j', io('dp')), feedEnd('dp'), 'yellow', [[X(ONES + SEGMENTS.dp.off) + 0.8, 14.5]]);
// e: top pin -> down through the channel at column 35 -> bottom track
const XE = 35, XB = 37, XA = 38;
bot.wire(at('c', io('e')), feedEnd('e'), 'yellow', [
  [x(io('e')), 6.1], [X(XE), 6.1], [X(XE), SEGMENTS.e.y], [X(ONES + SEGMENTS.e.off) + 0.8, SEGMENTS.e.y],
]);
// b and a: bottom pins -> up through the channel at columns 37 / 38 -> top tracks
bot.wire(at('i', io('b')), feedEnd('b'), 'yellow', [
  [x(io('b')) - 0.6, 14.0], [X(XB), 14.0], [X(XB), SEGMENTS.b.y], [X(ONES + SEGMENTS.b.off) + 0.8, SEGMENTS.b.y],
]);
bot.wire(at('i', io('a')), feedEnd('a'), 'yellow', [
  [x(io('a')) - 0.6, 13.2], [X(XA), 13.2], [X(XA), SEGMENTS.a.y], [X(ONES + SEGMENTS.a.off) + 0.8, SEGMENTS.a.y],
]);

export default b.module({
  id: 'output',
  title: 'Output register',
  description:
    'A 74LS273 latches the bus when OI is high on the clock edge. A 28C16 EEPROM turns the value into decimal digits; a 555, a 74LS76 counter and a 74LS139 light the four common-cathode digits one at a time, faster than the eye can follow. SW7 switches to signed (two’s complement) mode.',
  videos: [33, 34],
});
