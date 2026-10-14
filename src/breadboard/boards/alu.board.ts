import { RAIL_COLUMNS, ROWS, holeXY, parseHole, type Rail, type Row } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type ChipHandle, type PortSide, type WireColor } from '../layout';

/**
 * ALU (videos 15-18), wired like Ben's alu.png and the research notes:
 *   U21 74LS283 = low nibble (bits 0-3), C0 (7) = SU, C4 (9) -> U20 C0
 *   U20 74LS283 = high nibble (bits 4-7), C4 (9) -> CARRY (to the flags)
 *     A1-A4 <- A register (ports A0-A7); B1-B4 <- B XOR SU
 *     (283 pins: S1..S4, A1..A4, B1..B4 are bits 0..3 of the nibble)
 *   U18 / U16 74LS86: each gate XORs one B bit with SU (conditional invert)
 *   Sum S -> 8 red LEDs, ports SUM0-SUM7 (zero detector on the flags board)
 *     and the U17 74LS245: DIR (1) -> VCC, ~OE (19) = ~EO, B1-B8 -> BUS0-7
 *   So the ALU computes A + (B XOR SU·0xFF) + SU: A + B, or A − B with SU = 1.
 *
 * Choices where the notes are silent: U18 takes the low nibble and U16 the
 * high one (KiCad numbers the upper half of a sheet first, as with U20/U21);
 * which XOR gate and which gate input carries which bit was chosen so each
 * gate's wire to its adder nests inside the next one's (few crossings). No
 * LED resistors, as on the A register.
 *
 * Layout: high nibble on the left, low on the right, the 245 and its LEDs in
 * the middle (bit 7 on the left, like the B register below). All chips are
 * turned 180° so the sum LEDs sit on the 245's A side at the top. SU comes in
 * twice, once at each end, on a channel-bridging jumper.
 */

const b = new LayoutBuilder();
const bb = b.board('alu', { x: 0, y: 0 }, 'ALU');

const U16 = bb.chip('U16', '74LS86', 14, { rotated: true }); // B XOR SU, bits 4-7 (cols 8-14)
const U20 = bb.chip('U20', '74LS283', 25, { rotated: true }); // adder, bits 4-7 (cols 18-25)
const U17 = bb.chip('U17', '74LS245', 38, { rotated: true }); // sum out (cols 29-38)
const U21 = bb.chip('U21', '74LS283', 49, { rotated: true }); // adder, bits 0-3 (cols 42-49)
const U18 = bb.chip('U18', '74LS86', 59, { rotated: true }); // B XOR SU, bits 0-3 (cols 53-59)

const SU_LEFT = 5; // jumper columns that bring SU to both halves of the board
const SU_RIGHT = 61;
const GAP_HIGH = { carry: 26.5, bit6: 27.5, bit7: 28.5 }; // channel crossings between U20 and U17
const GAP_LOW = { bit2: 39.5, bit3: 40.5 }; // between U17 and U21

// ---------------------------------------------------------------------------
// helpers

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

/**
 * Lanes: horizontal runs lie between hole rows, innermost (next to the
 * chips) first; two runs never share a lane where they overlap.
 */
const LANES = { top: [7.0, 6.0, 5.0, 4.0, 4.5, 5.5], bottom: [11.0, 12.0, 13.0, 14.0, 13.5, 12.5] };
const taken: { half: 'top' | 'bottom'; y: number; x0: number; x1: number }[] = [];
function lane(half: 'top' | 'bottom', xa: number, xb: number): number {
  const x0 = Math.min(xa, xb) - 0.3, x1 = Math.max(xa, xb) + 0.3;
  for (const y of LANES[half]) {
    if (taken.some((r) => r.half === half && r.y === y && r.x0 < x1 && x0 < r.x1)) continue;
    taken.push({ half, y, x0, x1 });
    return y;
  }
  throw new Error(`ALU board: no free ${half} lane for x ${xa}..${xb}`);
}

/** A wire between two strips: `pin` is the hole of the strip's chip pin, `hole` picks a free hole when built. */
interface End {
  pin: string;
  hole: () => string;
}
const at = (u: ChipHandle, pin: string): End => ({ pin: u.pin(pin), hole: () => u.free(pin) });
const strip = (hole: string): End => ({ pin: hole, hole: () => bb.freeOr(hole) });

interface Route {
  a: End;
  b: End;
  color: WireColor;
  /** x where the wire crosses the channel (between two chips), for ends in different halves. */
  gx?: number;
  via?: [number, number][];
}
const routes: Route[] = [];
const route = (a: End, b: End, color: WireColor, gx?: number) => routes.push({ a, b, color, gx });

// ---------------------------------------------------------------------------
// LEDs on the 245's A strips (= the sum), bit 7 on the left

const ledBits = [7, 6, 5, 4, 3, 2, 1, 0];
const ledCols = ledBits.map((bit) => Number(U17.pin(`A${bit + 1}`).slice(1)));
const cathodes = railCathodes(bb, 'tn', ledCols);
ledBits.forEach((bit, i) => {
  bb.led(`D${8 - bit}`, 'red', far(bb, U17.pin(`A${bit + 1}`)), cathodes[i], `Σ${bit}`).live((c) => ((c.alu.value >> bit) & 1) === 1);
});

// ---------------------------------------------------------------------------
// power

/** Power wire from a pin's strip to a given rail column (where the nearest one would cross a tag or an LED). */
const toRail = (pinHole: string, rail: Rail, railCol: number) =>
  bb.wire(bb.freeOr(pinHole), `${rail}${railCol}`, rail === 'tp' || rail === 'bp' ? 'red' : 'black');
const colOf = (hole: string) => Number(hole.slice(1));

for (const u of [U16, U20, U17, U21, U18]) bb.toGnd(u.pin('GND'));
for (const u of [U20, U21, U18]) bb.toVcc(u.pin('VCC'));
// columns 14 and 38 have no rail hole: lean away from the B7 tag and from the LEDs / ~EO tag
toRail(U16.pin('VCC'), 'bp', colOf(U16.pin('VCC')) + 1);
toRail(U17.pin('VCC'), 'bp', colOf(U17.pin('VCC')) + 1);
toRail(U17.pin('DIR'), 'tp', colOf(U17.pin('DIR')) + 1); // A (sum) -> B (bus)

// ---------------------------------------------------------------------------
// SU: one jumper across the channel at each end of the board

for (const col of [SU_LEFT, SU_RIGHT]) {
  bb.wire(`e${col}`, `f${col}`, 'orange');
  bb.port('SU', `a${col}`, 'top');
}

/** XOR gate of each B bit: [chip, B input, SU input, output]. Gates 1, 2 face the top, 3, 4 the bottom. */
const XOR: [ChipHandle, string, string, string][] = [
  [U18, '1A', '1B', '1Y'], // bit 0
  [U18, '2B', '2A', '2Y'], // bit 1
  [U18, '3A', '3B', '3Y'], // bit 2
  [U18, '4B', '4A', '4Y'], // bit 3
  [U16, '1A', '1B', '1Y'], // bit 4
  [U16, '2B', '2A', '2Y'], // bit 5
  [U16, '3A', '3B', '3Y'], // bit 6
  [U16, '4B', '4A', '4Y'], // bit 7
];
const adder = (bit: number) => (bit < 4 ? U21 : U20);
const n = (bit: number) => (bit % 4) + 1; // 283 pin suffix of a bit

// SU daisy chains: jumper strip -> the gate inputs of each half, and on to U21 C0
route(strip(`e${SU_RIGHT}`), at(U18, '1B'), 'orange');
route(at(U18, '1B'), at(U18, '2A'), 'orange');
route(at(U18, '1B'), at(U21, 'C0'), 'orange'); // carry-in of the low adder: +1 when subtracting
route(strip(`f${SU_RIGHT}`), at(U18, '4A'), 'orange');
route(at(U18, '4A'), at(U18, '3B'), 'orange');
route(strip(`e${SU_LEFT}`), at(U16, '2A'), 'orange');
route(at(U16, '2A'), at(U16, '1B'), 'orange');
route(strip(`f${SU_LEFT}`), at(U16, '3B'), 'orange');
route(at(U16, '3B'), at(U16, '4A'), 'orange');

// B XOR SU -> adder B inputs (same half of the board for every bit)
for (let bit = 0; bit < 8; bit++) {
  const [u, , , y] = XOR[bit];
  route(at(u, y), at(adder(bit), `B${n(bit)}`), 'yellow');
}

// carry chain: U21 C4 -> U20 C0
route(at(U21, 'C4'), at(U20, 'C0'), 'yellow', GAP_HIGH.carry);

// sum -> 245 A side (S1/S2 face the top like the A strips; S3/S4 cross the channel)
const SUM_GAP: Record<number, number> = { 2: GAP_LOW.bit2, 3: GAP_LOW.bit3, 6: GAP_HIGH.bit6, 7: GAP_HIGH.bit7 };
for (let bit = 0; bit < 8; bit++) {
  route(at(adder(bit), `S${n(bit)}`), at(U17, `A${bit + 1}`), 'yellow', SUM_GAP[bit]);
}

// ---- allocate lanes: channel crossings first (they want the inner lanes so
// their drop through the channel passes nothing), then the shortest runs.
const half = (e: End) => (isTop(e.pin) ? 'top' : 'bottom');
const X = (e: End) => holeXY(e.pin).x;
const span = (r: Route) => Math.abs(X(r.a) - (r.gx ?? X(r.b))) + Math.abs((r.gx ?? X(r.a)) - X(r.b));
const order = [...routes].sort((p, q) => Number(q.gx !== undefined) - Number(p.gx !== undefined) || span(p) - span(q));
for (const r of order) {
  const xa = X(r.a), xb = X(r.b);
  if (r.gx === undefined) {
    if (half(r.a) !== half(r.b)) throw new Error('ALU board: route across the channel needs a crossing column');
    const y = lane(half(r.a), xa, xb);
    r.via = [[xa, y], [xb, y]];
  } else {
    const ya = lane(half(r.a), xa, r.gx), yb = lane(half(r.b), r.gx, xb);
    r.via = [[xa, ya], [r.gx, ya], [r.gx, yb], [xb, yb]];
  }
}
for (const r of routes) bb.wire(r.a.hole(), r.b.hole(), r.color, r.via);

// ---------------------------------------------------------------------------
// ports

for (let bit = 0; bit < 8; bit++) {
  const [u, bIn] = XOR[bit];
  portAt(`A${bit}`, adder(bit).pin(`A${n(bit)}`)); // from the A register
  portAt(`B${bit}`, u.pin(bIn)); // from the B register
  portAt(`SUM${bit}`, adder(bit).pin(`S${n(bit)}`)); // to the zero detector
  portAt(`BUS${bit}`, U17.pin(`B${bit + 1}`));
}
portAt('~EO', U17.pin('~OE'));
portAt('CARRY', U20.pin('C4'));

export default b.module({
  id: 'alu',
  title: 'ALU',
  description: 'Two 74LS283 adders add A and B; 74LS86 XOR gates invert B and SU sets the carry-in when subtracting. The sum LEDs always show the result; the 74LS245 puts it on the bus when ~EO is low.',
  videos: [15, 16, 17, 18],
});
