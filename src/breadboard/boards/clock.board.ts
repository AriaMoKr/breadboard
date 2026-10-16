import type { Machine } from '../../sim/machine';
import { colX } from '../geometry';
import { LayoutBuilder, type WireColor } from '../layout';

/**
 * Clock module (videos 2-5), wired like Ben's clock.png / KiCad netlist.
 *
 *   U1 NE555 astable: R1 1k VCC -> DIS, R2 1k DIS -> wiper of RV1 (1M),
 *      RV1 pin 1 -> THR/TRIG and C6 1uF to GND, C5 0.01uF on CV, RESET -> VCC.
 *   U2 NE555 monostable: R3 1k pull-up on TRIG, SW1 TRIG -> GND,
 *      R4 1M VCC -> THR/DIS, C3 0.1uF to GND, C2 0.01uF on CV, RESET -> VCC.
 *   U3 NE555 bistable: R5 1k pull-up on TRIG, R6 1k pull-up on RESET,
 *      SW2 common -> GND, throws -> TRIG (auto) / RESET (manual),
 *      THR -> GND, DIS open, C4 0.01uF on CV.
 *   Logic, pin for pin as in the netlist: U5A = AST (pin 1) & SEL (pin 2),
 *      U4A = !SEL, U5B = !SEL (pin 4) & MONO (pin 5), U6A = U5A | U5B,
 *      U4D = !HLT, CLK = U5C = U6A (pin 9) & U4D (pin 10), ~CLK = U4F = !CLK.
 *   D1 blue CLK LED: anode on CLK, R7 220R from its cathode to GND.
 *   No LEDs on the 555 outputs: Ben uses them while building parts 1-3 and
 *   removes these debug LEDs at the end of part 4 (videos.md); the netlist
 *   has only D1. So the board shows what the finished module shows: the
 *   CLK LED, and the mode on the position of SW2.
 *
 * Unused gate inputs (U4 2A/3A/5A, U5D, U6B-D) are tied to GND; Ben leaves
 * them open, which LS-TTL reads as high, so the logic is the same.
 *
 * Routing: the astable and monostable outputs run to the logic chips on
 * lanes in the top half (over the 555s' tops, which only have parts going
 * up to the rails), and come down into the bottom half just before U4.
 */

const b = new LayoutBuilder();
const bb = b.board('clock', { x: 0, y: 0 }, 'Clock');
const X = colX;

// ---- chips --------------------------------------------------------------------
const U1 = bb.chip('U1', 'NE555', 6, { params: { mode: 'astable', halfPeriod: 2000 } });
const U2 = bb.chip('U2', 'NE555', 15, { params: { mode: 'monostable', pulseWidth: 1500 } });
const U3 = bb.chip('U3', 'NE555', 27, { params: { mode: 'bistable' } });
const U4 = bb.chip('U4', '74LS04', 37);
const U5 = bb.chip('U5', '74LS08', 46);
const U6 = bb.chip('U6', '74LS32', 55);

const col = (hole: string) => Number(hole.replace(/^[a-z]+/, ''));
/** Wire a hole straight up/down to the rail in the same column. */
const toRail = (hole: string, rail: 'tp' | 'tn' | 'bp' | 'bn', color: WireColor = rail === 'tp' || rail === 'bp' ? 'red' : 'black') =>
  bb.wire(hole, `${rail}${col(hole)}`, color);
/** Top-half hole of a pin's strip at row `row` (a-d) / bottom-half (g-j). */
const at = (u: { pin(p: string): string }, pin: string, row: string) => `${row}${col(u.pin(pin))}`;

// ---- power ----------------------------------------------------------------------
for (const u of [U1, U2, U3]) {
  toRail(at(u, 'VCC', 'a'), 'tp');
  toRail(at(u, 'GND', 'j'), 'bn');
}
for (const u of [U4, U5, U6]) {
  toRail(at(u, 'VCC', 'a'), 'tp');
  toRail(at(u, 'GND', 'j'), 'bn');
}

// ---- U1 astable -----------------------------------------------------------------
bb.resistor('R1', 1000, 'tp7', at(U1, 'DIS', 'a')); // VCC -> DIS
// RV1: pin 1 (a4) -> THR/TRIG, wiper (a3) -> R2, pin 3 (a2) open, as in the schematic
bb.pot('RV1', 1_000_000, 'a4', 'a3', 'a2', {
  kind: 'pot',
  // f = 1.44 / ((RA + 2 RB) C), RA = R1 = 1k, RB = R2 + pot = 1k + t * 1M, C = C6 = 1uF
  get: (m: Machine) => potFromHz(m.hz),
  set: (m: Machine, t: number) => m.setHz(hzFromPot(t)),
}, 'RV1 speed');
bb.resistor('R2', 1000, 'c3', at(U1, 'DIS', 'c')); // wiper -> DIS
bb.wire('d4', at(U1, 'THR', 'd'), 'green'); // pot pin 1 -> THR
bb.wire('e4', at(U1, 'TRIG', 'g'), 'green', [[X(4), 11.0], [X(7), 11.0]]); // pot pin 1 -> TRIG, round the chip
bb.capacitor('C6', 1e-6, at(U1, 'TRIG', 'i'), 'bn7', true); // timing cap, + on TRIG/THR
bb.capacitor('C5', 1e-8, at(U1, 'CV', 'a'), 'tn9');
toRail(at(U1, '~RESET', 'j'), 'bp');

// ---- U2 monostable --------------------------------------------------------------
bb.wire(at(U2, 'DIS', 'd'), at(U2, 'THR', 'd'), 'green'); // DIS-THR tie
bb.resistor('R4', 1_000_000, at(U2, 'DIS', 'a'), 'tp16'); // VCC -> DIS/THR
bb.capacitor('C3', 1e-7, at(U2, 'THR', 'a'), 'tn17'); // timing cap
bb.capacitor('C2', 1e-8, at(U2, 'CV', 'a'), 'tn18');
toRail(at(U2, '~RESET', 'j'), 'bp');
bb.resistor('R3', 1000, at(U2, 'TRIG', 'j'), 'bp16'); // TRIG pull-up
bb.button('SW1', 'e13', 'f13', {
  kind: 'button',
  // the one-shot gives one clean clock pulse per press; only selected in manual mode
  press: (m: Machine) => {
    if (m.mode === 'manual' && m.computer.clk === 0) m.halfPulse();
  },
  release: (m: Machine) => {
    if (m.mode === 'manual' && m.computer.clk === 1) m.halfPulse();
  },
}, 'SW1 step');
toRail('a13', 'tn'); // SW1 -> GND
bb.wire('h13', at(U2, 'TRIG', 'h'), 'green'); // SW1 -> TRIG

// ---- U3 bistable ----------------------------------------------------------------
toRail(at(U3, 'THR', 'a'), 'tn'); // THR -> GND
bb.capacitor('C4', 1e-8, at(U3, 'CV', 'a'), 'tn30');
bb.resistor('R5', 1000, at(U3, 'TRIG', 'j'), 'bp28'); // TRIG pull-up
bb.resistor('R6', 1000, at(U3, '~RESET', 'j'), 'bp30'); // RESET pull-up
// SW2: position 1 grounds TRIG (Q = 1, auto), position 0 grounds RESET (Q = 0, manual).
// The slide shows the selected mode, like the latch: auto stays auto while the
// app's Run button pauses the astable (then the step button still does
// nothing, as on Ben's board), and a click selects manual.
bb.slide('SW2', 'i22', 'i23', 'i24', {
  kind: 'slide',
  get: (m: Machine) => (m.mode === 'auto' ? 1 : 0),
  set: (m: Machine, pos: 0 | 1) => (pos ? m.start() : m.setMode('manual')),
  positions: ['manual', 'auto'],
}, 'SW2 auto/manual');
toRail('j23', 'bn'); // SW2 common -> GND
bb.wire('h24', at(U3, 'TRIG', 'h'), 'green'); // throw -> TRIG
bb.wire('g22', at(U3, '~RESET', 'h'), 'green', [[X(22), 12.0], [X(30), 12.0]]); // throw -> RESET

// ---- 555 outputs -> logic -----------------------------------------------------------
// AST: U1 OUT -> up through the free column 11 -> lane 4.5 -> down at column 36 -> U5 1A
bb.wire(at(U1, 'OUT', 'g'), at(U5, '1A', 'g'), 'orange', [
  [X(8), 11.0], [X(11), 11.0], [X(11), 4.5], [X(36), 4.5], [X(36), 11.0], [X(46), 11.0],
]);
// MONO: U2 OUT -> up through column 20 -> lane 5.0 -> down at column 35 -> U5 2B (pin 5, as in the netlist)
bb.wire(at(U2, 'OUT', 'g'), at(U5, '2B', 'g'), 'purple', [
  [X(17), 11.0], [X(20), 11.0], [X(20), 5.0], [X(35), 5.0], [X(35), 12.0], [X(50), 12.0],
]);
// SEL: U3 OUT -> along the bottom half -> U4 1A, then on to U5 1B
bb.wire(at(U3, 'OUT', 'g'), at(U4, '1A', 'h'), 'green', [[X(29), 11.0], [X(34), 11.0], [X(34), 12.5]]);
bb.wireLane(at(U4, '1A', 'i'), at(U5, '1B', 'i'), 14.0, 'green');

// ---- clock logic ------------------------------------------------------------------
bb.wireLane(at(U4, '1Y', 'h'), at(U5, '2A', 'h'), 13.0, 'yellow'); // !SEL -> U5B (pin 4)
bb.wire(at(U5, '1Y', 'i'), at(U6, '1A', 'i'), 'yellow'); // U5A -> U6A
bb.wire(at(U5, '2Y', 'g'), at(U6, '1B', 'g'), 'yellow'); // U5B -> U6A
// U6A -> U5C: round the right end of U5, through the free column 53
bb.wire(at(U6, '1Y', 'g'), at(U5, '3A', 'd'), 'yellow', [[X(57), 11.0], [X(53), 11.0], [X(53), 7.0], [X(51), 7.0]]);
bb.wireLane(at(U4, '4Y', 'd'), at(U5, '3B', 'd'), 6.0, 'yellow'); // !HLT -> U5C
bb.wireLane(at(U5, '3Y', 'c'), at(U4, '6A', 'c'), 5.0, 'white'); // CLK -> U4F
bb.port('CLK', at(U5, '3Y', 'a'), 'top');
bb.port('~CLK', at(U4, '6Y', 'a'), 'top');
bb.port('HLT', at(U4, '4A', 'a'), 'top');
// D1 as in the netlist: anode on CLK (U5 3Y's strip), R7 from the cathode to GND
bb.led('D1', 'blue', at(U5, '3Y', 'b'), 'b54', 'CLK').live((c) => c.clk === 1);
bb.resistor('R7', 220, 'a54', 'tn54', 'R7');

// unused inputs -> GND
for (const p of ['2A', '3A']) toRail(at(U4, p, 'j'), 'bn');
toRail(at(U4, '5A', 'a'), 'tn');
for (const p of ['4A', '4B']) toRail(at(U5, p, 'a'), 'tn');
for (const p of ['2A', '2B']) toRail(at(U6, p, 'j'), 'bn');
for (const p of ['4A', '3A', '3B']) toRail(at(U6, p, 'a'), 'tn');
bb.wire(at(U6, '4B', 'b'), at(U6, '4A', 'b'), 'black'); // 4B sits on a rail gap: tie it to 4A

// ---- pot <-> astable frequency ------------------------------------------------------
const RA = 1000, RB0 = 1000, RPOT = 1_000_000, CT = 1e-6;
/** Astable frequency for pot position t (0 = fastest, ~480 Hz; 1 = slowest, ~0.72 Hz). */
export function hzFromPot(t: number): number {
  const tt = Math.max(0, Math.min(1, t));
  return 1.44 / ((RA + 2 * (RB0 + tt * RPOT)) * CT);
}
/** Inverse of hzFromPot, clamped to 0..1. */
export function potFromHz(hz: number): number {
  const t = (1.44 / (hz * CT) - RA - 2 * RB0) / (2 * RPOT);
  return Math.max(0, Math.min(1, t));
}

export default b.module({
  id: 'clock',
  title: 'Clock',
  description:
    'Three 555 timers: an astable oscillator (speed set by the pot), a debounced one-shot for single steps and a debounced auto/manual latch. 74LS04/08/32 gates pick the source and stop the clock while HLT is high; CLK and ~CLK go to the rest of the computer.',
  videos: [2, 3, 4, 5],
});
