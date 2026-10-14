import { holeXY } from '../geometry';
import { LayoutBuilder, type BoardBuilder, type ChipHandle, type LiveLed, type WireColor } from '../layout';

/**
 * Flags register (video 43), wired like Ben's alu.png / control.png and the
 * research notes:
 *   Zero detect on the ALU sum (SUM0-SUM7), zero = 1 when all eight are 0:
 *     U22 74LS02 NORs the pairs (SUM0,SUM1) (SUM2,SUM3) (SUM4,SUM5) (SUM6,SUM7)
 *     U23 74LS08: U23A = NOR1·NOR2, U23C = NOR3·NOR4, U23B = U23A·U23C = zero
 *   U19 74LS173: D0 = CARRY (ALU U20 C4), D1 = zero, D2/D3 unused -> GND
 *     ~G1/~G2 = ~FI, CP = CLK, MR = CLR, ~M/~N = GND (outputs always on)
 *     Q0 -> CF and green LED D34, Q1 -> ZF and green LED D35, each through
 *     220 Ω as in the schematic. CF/ZF go to the control EEPROMs' A8/A9.
 *
 * Choices where the notes are silent: the unused fourth AND gate (U23D) has
 * its inputs tied to VCC (where floating LS-TTL inputs would sit anyway);
 * which NOR/AND input takes which signal was chosen for uncrossed wires; the
 * LED resistors (our ids R_D34/R_D35, not Ben's numbers) sit between Q and
 * the LED.
 */

const b = new LayoutBuilder();
const bb = b.board('flags', { x: 0, y: 0 }, 'Flags register');

const U22 = bb.chip('U22', '74LS02', 4); // cols 4-10
const U23 = bb.chip('U23', '74LS08', 14); // cols 14-20
const U19 = bb.chip('U19', '74LS173', 30, { rotated: true }); // cols 23-30: D side faces the gates, Q side the top

const GAP = 21.5; // where U23C's output crosses the channel to U23B

// ---------------------------------------------------------------------------
// helpers

/** The free hole of `hole`'s strip furthest from the channel (row a or j): where tags and LED legs go. */
function far(board: BoardBuilder, hole: string): string {
  const free = board.freeInStrip(hole);
  if (!free.length) throw new Error(`Strip of ${hole} is full`);
  return free[free.length - 1];
}

/** Port tag at the outer end of a pin's strip, pointing off the board. */
const portAt = (name: string, pinHole: string) => bb.port(name, far(bb, pinHole), /^[a-e]/.test(pinHole) ? 'top' : 'bottom');

/** Wire between two chip pins' strips along a lane (same half of the board). */
const link = (u: ChipHandle, p: string, v: ChipHandle, q: string, laneY: number, color: WireColor = 'yellow') =>
  bb.wireLane(u.free(p), v.free(q), laneY, color);

const col = (hole: string) => Number(hole.slice(1));

// ---------------------------------------------------------------------------
// power and ties

for (const u of [U22, U23, U19]) {
  bb.toVcc(u.pin('VCC'));
  bb.toGnd(u.pin('GND'));
}
// ~M and ~N: hop across, then one wire up to the rail (keeps the LED wires below uncrossed)
bb.wire(`d${col(U19.pin('~N'))}`, `d${col(U19.pin('~M'))}`, 'black');
bb.toGnd(U19.pin('~M'));
bb.toGnd(U19.pin('D3')); // unused flag bits (D3 first: it gets the rail hole below it, D2 leans right, clear of the ~FI tag)
bb.toGnd(U19.pin('D2'));
// unused AND gate U23D: 4B to the VCC strip next to it, 4A to 4B
bb.wire(`c${col(U23.pin('VCC'))}`, `c${col(U23.pin('4B'))}`, 'red');
bb.wire(`d${col(U23.pin('4B'))}`, `d${col(U23.pin('4A'))}`, 'red');

// ---------------------------------------------------------------------------
// zero detector

// SUM pairs into the NOR gates (gates 1, 2 face the bottom, 3, 4 the top)
const NOR_IN: [number, string][] = [
  [0, '1A'], [1, '1B'], [2, '2A'], [3, '2B'], [4, '3A'], [5, '3B'], [6, '4A'], [7, '4B'],
];
for (const [bit, pin] of NOR_IN) portAt(`SUM${bit}`, U22.pin(pin));

// NOR outputs into U23A / U23C, nested so the wires don't cross
link(U22, '2Y', U23, '1A', 11.0); // NOR2 -> U23A
link(U22, '1Y', U23, '1B', 12.0); // NOR1 -> U23A
link(U22, '3Y', U23, '3B', 7.0); // NOR3 -> U23C
link(U22, '4Y', U23, '3A', 6.0); // NOR4 -> U23C
// U23A -> U23B
link(U23, '1Y', U23, '2A', 11.0);
// U23C (top) -> U23B (bottom), round the end of U23
{
  const a = U23.free('3Y'), z = U23.free('2B');
  const pa = holeXY(a), pz = holeXY(z);
  bb.wire(a, z, 'yellow', [[pa.x, 7.0], [GAP, 7.0], [GAP, 12.0], [pz.x, 12.0]]);
}
// zero -> flag register D1
link(U23, '2Y', U19, 'D1', 11.0);

// ---------------------------------------------------------------------------
// flags register

bb.wire(U19.free('~G1'), U19.free('~G2'), 'white'); // tie the two load enables together
portAt('~FI', U19.pin('~G2'));
portAt('CARRY', U19.pin('D0'));
portAt('CLR', U19.pin('MR'));
portAt('CLK', U19.pin('CP'));

// LEDs: Q -> wire -> 220 Ω -> LED -> GND. CF's wire runs inside ZF's.
const station = (id: string, label: string, q: string, at: number, laneY: number, live: LiveLed) => {
  bb.wireLane(U19.free(q), `d${at}`, laneY, 'yellow');
  bb.resistor(`R_${id}`, 220, `b${at}`, `b${at + 3}`, '220Ω');
  bb.led(id, 'green', `a${at + 3}`, bb.railHole('tn', at + 3), label).live(live);
};
station('D34', 'CF', 'Q0', 34, 7.0, (c) => c.flagC === 1);
station('D35', 'ZF', 'Q1', 40, 6.0, (c) => c.flagZ === 1);
portAt('CF', U19.pin('Q0')); // to both control EEPROMs' A8
portAt('ZF', U19.pin('Q1')); // A9

export default b.module({
  id: 'flags',
  title: 'Flags register',
  description: 'A 74LS02/74LS08 tree detects a zero ALU result; a 74LS173 latches the carry and zero flags when ~FI is low. The green LEDs show CF and ZF, which pick the microcode for JC/JZ.',
  videos: [43],
});
