import { LayoutBuilder } from '../layout';

/**
 * Program counter (videos 28-29), wired like Ben's pc.png / KiCad netlist:
 *   U35 74LS161: ~MR = ~CLR, CP = CLK, P0-P3 = BUS0-3, CEP = CET = CE,
 *                ~PE = ~J, TC unused.
 *   U36 74LS245 turned around (DIR = GND: B -> A, counter -> bus),
 *                ~OE = ~CO. Only four channels are used: B5-B8 take Q3-Q0,
 *                A5-A8 drive BUS3-BUS0 (the KiCad drawing also uses the
 *                upper four channels). The unused B1-B4 inputs are tied to
 *                GND; the unused A1-A4 outputs stay open.
 *   D82-D85: 4 green LEDs on Q0-Q3, read MSB first from the left.
 *
 * Ben's parts list for the build video is "1x 74LS161, 1x 74LS245, 4 LEDs"
 * (no resistors, like the A register), so the LEDs go straight from the
 * outputs to GND. The later KiCad schematic adds 220R in series.
 *
 * Routing: the four Q -> B wires are nested in the top half (Q0 on the
 * outer lane), the four bus -> P wires are nested in the bottom half; the
 * channel mapping Qk -> B(8-k) is what makes both bundles nest without
 * crossing and puts the LEDs in MSB-first order.
 */

const b = new LayoutBuilder();
const bb = b.board('pc', { x: 0, y: 0 }, 'Program counter');

const C35 = 22; // U35 pin 1 at f22
const C36 = 33; // U36 pin 1 at f33
const U35 = bb.chip('U35', '74LS161', C35);
const U36 = bb.chip('U36', '74LS245', C36);

const col = (hole: string) => Number(hole.replace(/^[a-z]+/, ''));
/** Wire a pin's strip straight up/down to the rail in the same column. */
const toRail = (hole: string, rail: 'tp' | 'tn' | 'bp' | 'bn', color: 'red' | 'black') => bb.wire(hole, `${rail}${col(hole)}`, color);

// ---- power ------------------------------------------------------------------
toRail(`a${C35}`, 'tp', 'red'); // U35 VCC (pin 16)
toRail(`j${C35 + 7}`, 'bn', 'black'); // U35 GND (pin 8)
toRail(`a${C36}`, 'tp', 'red'); // U36 VCC (pin 20)
toRail(`j${C36 + 9}`, 'bn', 'black'); // U36 GND (pin 10)
toRail(`j${C36}`, 'bn', 'black'); // U36 DIR (pin 1) = GND: B -> A

// unused B1-B4 inputs to GND (B4 sits on a rail gap, so it is tied to B3)
for (const pin of ['B1', 'B2', 'B3']) toRail(`a${col(U36.pin(pin))}`, 'tn', 'black'); // above the lanes
bb.wire(`d${col(U36.pin('B4'))}`, `d${col(U36.pin('B3'))}`, 'black'); // B4 -> B3 strip, below the lanes

// ---- control ----------------------------------------------------------------
bb.port('~CLR', `j${C35}`, 'bottom'); // ~MR
bb.port('CLK', `j${C35 + 1}`, 'bottom'); // CP
bb.port('CE', `j${C35 + 6}`, 'bottom'); // CEP
bb.port('CE', `a${C35 + 6}`, 'top'); // CET (tied to CEP through the CE net)
bb.port('~J', `a${C35 + 7}`, 'top'); // ~PE
bb.port('~CO', `a${C36 + 1}`, 'top'); // U36 ~OE

// ---- counter outputs -> 245 B side (top half, nested lanes) ------------------
for (let k = 0; k < 4; k++) {
  const q = U35.pin(`Q${k}`); // e24..e27
  const bPin = U36.pin(`B${8 - k}`); // e42..e39
  bb.wireLane(`d${col(q)}`, `d${col(bPin)}`, 4.5 + (3 - k) * 0.5, 'yellow'); // Q0 outermost (4.5)
}

// ---- bus -> P inputs, 245 A side -> bus (bottom half, nested lanes) ----------
for (let k = 0; k < 4; k++) {
  const a = U36.pin(`A${8 - k}`); // f41..f38 = BUS0..BUS3
  const p = U35.pin(`P${k}`); // f24..f27
  bb.wireLane(`g${col(a)}`, `g${col(p)}`, 12.0 + (3 - k) * 0.5, 'blue'); // BUS0 outermost (13.5)
  bb.port(`BUS${k}`, `j${col(a)}`, 'bottom');
}

// ---- LEDs: anode on the B strip (= Qk), cathode in the GND rail ---------------
for (let k = 3; k >= 0; k--) {
  const c = col(U36.pin(`B${8 - k}`)); // 39..42 for Q3..Q0
  bb.led(`D${82 + k}`, 'green', `a${c}`, `tn${c}`, `PC${k}`).live((cpu) => ((cpu.pc >> k) & 1) === 1);
}

export default b.module({
  id: 'pc',
  title: 'Program counter',
  description:
    'A 74LS161 4-bit counter counts on CLK when CE is high and loads BUS0-3 when ~J is low; a 74LS245 (B to A) puts the count on the bus when ~CO is low. The green LEDs always show the count.',
  videos: [28, 29],
});
