import { LayoutBuilder, type Layout } from '../layout';

/** Half period of the 555 in gate delays (the engine's time unit). */
export const COUNTER_HALF_PERIOD = 200;

/**
 * Binary counter: a 555 astable clock (videos 2-3, values as Ben's clock
 * module: R1 1 kΩ, a fixed 100 kΩ for RB, 0.01 µF on CV) drives the clock
 * input of a 74LS161 (video 28), whose outputs Q0-Q3 light four green LEDs.
 * The 161 counts on every rising edge: ~MR, ~PE, CEP and CET are tied
 * high, P0-P3 are unused (as in Ben's step counter).
 *
 * The engine doesn't model the RC timing; the 555's speed is its
 * `halfPeriod` parameter.
 */
export function buildCounter(): Layout {
  const b = new LayoutBuilder();
  const bb = b.board('ctr', { x: 0, y: 0 }, '555 clock + 74LS161 counter');

  // ---- 555 astable (U1): GND f9, TRIG f10, OUT f11, ~RESET f12, CV e12, THR e11, DIS e10, VCC e9
  const U1 = bb.chip('U1', 'NE555', 9, { params: { mode: 'astable', halfPeriod: COUNTER_HALF_PERIOD } });
  bb.toVcc(U1.pin('VCC'));
  bb.toGnd('j9');
  bb.toVcc('j12'); // ~RESET high
  bb.resistor('R1', 1000, 'a10', 'tp10'); // VCC -> DIS
  bb.resistor('R2', 100_000, 'c10', 'c11'); // DIS -> THR
  bb.wire('d11', 'g10', 'white'); // THR to TRIG, over the chip
  bb.capacitor('C1', 10e-6, 'i10', 'bn10', true); // timing capacitor
  bb.capacitor('C2', 0.01e-6, 'a12', 'tn12'); // CV
  bb.led('D1', 'blue', 'h11', 'h13', 'CLK');
  bb.resistor('R3', 220, 'i13', 'bn13');

  // ---- 74LS161 (U2): ~MR f27, CP f28, P0-P3 f29-f32, CEP f33, GND f34; ~PE e34, CET e33, Q3-Q0 e32-e29, TC e28, VCC e27
  const U2 = bb.chip('U2', '74LS161', 27);
  bb.toVcc(U2.pin('VCC'));
  bb.toGnd('j34');
  bb.toVcc('j27'); // ~MR high: no clear
  bb.toVcc('j33'); // CEP
  bb.toVcc('a33'); // CET
  bb.toVcc('a34'); // ~PE high: count, don't load
  bb.wireLane(U1.free('OUT'), U2.free('CP'), 11.0, 'white');

  // outputs: LEDs straight to ground, like Ben's register LEDs
  for (let bit = 0; bit < 4; bit++) bb.led(`D${2 + bit}`, 'green', `a${29 + bit}`, `tn${28 + bit}`, `Q${bit}`);

  return b.build();
}
