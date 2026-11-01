import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row, select, type ScopeChannel } from '../../ui/components';
import { Disposer, animate, growOnly, h, s, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { Kit, kitCss } from '../clock/_draw';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { R_OUT, ROOM, SchmittCore, SinkCore, V12, VDIODE, baseVoltage, collectorCurrent, coreTimes, noteHz, sampleCore, sinkTimes, thermalVoltage, thresholds, wiper, type Feed } from './_analog';
import { diode, jack, npnLeft, potDivider, schmitt } from './_draw';
import { HEARING, fmtA, fmtCv, fmtHz, fmtT, fmtV, mV, pitchText, playsText } from './_shared';
import { Tone } from './_sound';

const SCOPE_CLASS = 'synth-expo';
const C = 2.2e-9; // the core's 2.2 nF foil capacitor
const BIG_C = 1e-6; // the first step's bigger capacitor
const R = 100e3; // part 1's drain; then the 100k from the pot, and from the jack, to the base
const BIG_R = 1e6; // the first step's bigger resistor
const R_SCALE = 4e3; // from the base to ground: it scales the CV down
const { vp: VP12, vn: VN12 } = thresholds(V12);
/** The most current the 40106 can put back through the diode and still get the capacitor to the upper threshold. */
const STOP = (V12 - VDIODE - VP12) / R_OUT;
const N = 500; // scope readings
const PRE = 12; // readings before the jump the scope triggers on
const NOTE_S = 1 / 3; // the sequencer moves on three times a second
const FINGER = 32; // °C: a finger warms the transistor towards this (an estimate)
const WARM_TAU = 6; // s: and this fast (an estimate)

/** The lab's sequence: eight notes for 1 V per octave, 0 V being C2. */
const MEANT = ['C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'C6'];
const SEQ = MEANT.map((n) => Math.log2(noteHz(n) / noteHz('C2')));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---- numbers the texts quote, from the models

const hzOf = (r: number, c: number) => 1 / coreTimes(r, c, V12, VP12, VN12).period;
/** The pitch with `v` at the base, at `celsius`. */
const hzAt = (v: number, celsius = ROOM) => sinkTimes(collectorCurrent(v, celsius)).hz;
/** The pot's wiper, unloaded, through 100k into the base, as in the second step. */
const potAlone = (v: number) => {
  const w = wiper(v / V12);
  return baseVoltage([{ v: w.v, r: R + w.r }]);
};
/** Where the core stops as the pot turns up, in the second step: found by bisection. */
const STALL_POT = (() => {
  let lo = 0, hi = V12;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (sinkTimes(collectorCurrent(potAlone(mid))).stalled) hi = mid;
    else lo = mid;
  }
  return hi;
})();
/** The sequence's top note alone through 100k and 4k, as in the third step. */
const SCALED_TOP = baseVoltage([{ v: SEQ[SEQ.length - 1], r: R }], R_SCALE);
/** What each volt of CV adds at the base with the pot's 100k beside it, the pot near the top. */
const PER_VOLT = (() => {
  const w = wiper(11.6 / V12);
  const base = (cv: number) => baseVoltage([{ v: w.v, r: R + w.r }, { v: cv, r: R }], R_SCALE);
  return base(1) - base(0);
})();
/** The base voltage that doubles the current: what 1 V per octave needs from each volt of CV. */
const DOUBLING = thermalVoltage(ROOM) * Math.LN2;
const DECADE = thermalVoltage(ROOM) * Math.LN10;
const DRIFT = (12 * Math.log2(hzAt(0.45, FINGER) / hzAt(0.45))) / (FINGER - ROOM);
/** The current that plays `hz`, leaving out the jump's fraction of a microsecond. */
const currentFor = (hz: number) => C * (VP12 - VN12) * hz;

const CSS = `
.${SCOPE_CLASS} .synth-circuit { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; }
.${SCOPE_CLASS} .synth-circuit .schematic { flex: 1 1 420px; min-width: 0; }
.${SCOPE_CLASS} .synth-kv { flex: 1 1 220px; }
.${SCOPE_CLASS} .schmitt-sign { stroke-width: 1.5; }
.${SCOPE_CLASS} .kv dd { font-variant-numeric: tabular-nums; }
.${SCOPE_CLASS} .pot-slider { display: flex; width: 100%; }
.${SCOPE_CLASS} .pot-slider input { flex: 1 1 auto; width: auto; min-width: 0; }
.${SCOPE_CLASS} .ic-chart { width: 100%; max-width: 460px; height: auto; display: block; }
.${SCOPE_CLASS} .ic-chart text { fill: var(--fg-dim); font-family: var(--mono); font-size: 10px; }
.${SCOPE_CLASS} .ic-chart .axis { fill: none; stroke: var(--fg-faint); stroke-width: 1.5; }
.${SCOPE_CLASS} .ic-chart .grid { stroke: var(--grid); }
.${SCOPE_CLASS} .ic-chart .band { fill: color-mix(in srgb, var(--accent) 14%, transparent); }
.${SCOPE_CLASS} .ic-chart .level { stroke: var(--fg-faint); stroke-dasharray: 4 4; }
.${SCOPE_CLASS} .ic-chart .stop { stroke: var(--danger); stroke-dasharray: 6 4; }
.${SCOPE_CLASS} .ic-chart .curve { fill: none; stroke: var(--ana); stroke-width: 2; }
.${SCOPE_CLASS} .ic-chart .curve.warm { stroke: var(--danger); stroke-dasharray: 6 4; }
.${SCOPE_CLASS} .ic-chart .pt { fill: var(--panel); stroke: var(--fg); stroke-width: 1.5; }
.${SCOPE_CLASS} .ic-chart .pt.now { fill: var(--accent); }
.${SCOPE_CLASS} .seq-table { font-size: 0.8rem; }
.${SCOPE_CLASS} .seq-table th, .${SCOPE_CLASS} .seq-table td { padding: 2px 7px; }
.${SCOPE_CLASS} .seq-table td:last-child { text-align: left; }
`;

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: { value: `${Step}`; label: string }[] = [
  { value: '1', label: '1. Lower: a bigger R or C?' },
  { value: '2', label: '2. A transistor for the 100k' },
  { value: '3', label: '3. A sequencer, scaled down' },
  { value: '4', label: '4. An offset from the pot' },
  { value: '5', label: '5. A warm finger' },
];

/** The schematic's words, per step. */
function schematicLabel(step: Step): string {
  const core = 'one Schmitt-trigger inverter of a 40106 on 12 V, its input with 2.2 nF to ground and a 1N4148 from its output back to its input, the capacitor on to part 1’s output stage';
  const tr = 'a BC548C from the capacitor to ground, its collector on the capacitor and its emitter on ground';
  switch (step) {
    case 1:
      return `Schematic of the core: ${core}; a resistor from the capacitor to ground drains it.`;
    case 2:
      return `Schematic: the core (${core}), with ${tr}, in place of the 100k; its base through 100k from the wiper of a 100k pot across 12 V.`;
    case 3:
      return `Schematic: the core (${core}), with ${tr}; its base through 100k from a jack for a sequencer’s CV, and 4k from the base to ground.`;
    case 4:
    case 5:
      return `Schematic: the core (${core}), with ${tr}; its base through 100k from the wiper of a 100k pot across 12 V and through another 100k from the CV jack, with 4k from the base to ground: a passive mixer.`;
  }
}

/** What the callout says, per step. */
function stepText(step: Step): string {
  switch (step) {
    case 1:
      return `Part 1’s core plays about ${fmtHz(hzOf(R, C))}, far too high, and only its slow fall sets the pitch: so slow the fall down. A capacitor about 450 times as big (1 µF for the 2.2 nF) takes it to about ${fmtHz(hzOf(R, BIG_C))}, nearly an LFO; ten times the resistance (1M for the 100k) to about ${fmtHz(hzOf(BIG_R, C))}. Moritz rules the capacitor out: it can only be changed by hand, and a big one bends the quick jump into a slope on his scope, a weird triangle. (Not here: the model’s 40106 fills even 1 µF in about ${fmtT(coreTimes(R, BIG_C, V12, VP12, VN12).rise)}.) A resistance can be controlled instead: an LDR by light, a thermistor by heat, or a transistor by a voltage. Part 2 takes a transistor.`;
    case 2:
      return `A BC548C in the 100k’s place, its collector on the capacitor and its emitter on ground. A 100k pot across the 12 V rail sets its base, through another 100k so that turning it too far can’t burn the transistor out. The transistor drains a current set by its base voltage, whatever the capacitor’s, so the capacitor now falls in a straight line, and the pitch follows the current: ten times the current for every ${mV(DECADE)} more at the base. About 350 mV clicks a couple of times a second (${fmtHz(hzAt(0.35))} here); about 550 mV whines at ${fmtHz(hzAt(0.55))}. Past about ${STALL_POT.toFixed(1)} V on the pot, the transistor drains more than the 40106 can put back through the diode, and the core stops. So it all happens in the first twentieth of the pot’s turn, as finicky as Moritz finds it: the arrow keys move it a millivolt at a time.`;
    case 3:
      return `Moritz’s SQ-1 sequencer puts out 0 to 5 V, 0 V being a low C, but the transistor’s useful window is about 200 mV: 25 times smaller. So the CV is scaled down, through 100k with about 4k from there to ground (roughed in, he says, to be tuned later). On its own that isn’t enough. The lab’s sequence, eight notes over 4 V, gets 0 to ${mV(SCALED_TOP)} at the base, where the transistor passes a few picoamps at most, and the core hardly moves. It needs an offset to sit on.`;
    case 4:
      return `The offset comes from the pot again, through its own 100k into the same point. The two 100k and the 4k make a passive mixer: the base gets about 1/27 of each input’s voltage, added up. With the pot low, the sequence only clicks, as Moritz finds; turned up near the top, it slides into hearing. But it isn’t in tune: each volt of CV adds about ${mV(PER_VOLT)} at the base, where 1 V per octave needs ${(DOUBLING * 1e3).toFixed(1)} mV, the step that doubles the current. So every interval comes out about twice as wide, about ${(PER_VOLT / DOUBLING).toFixed(1)} octaves a volt.`;
    case 5:
      return `Moritz ends with a warning: touch the transistor and the pitch drifts a long way. At the same base voltage a warmer transistor passes more current (for the same current it needs about 2.4 mV less a degree). Here a finger warms it from ${ROOM} °C towards ${FINGER} °C over some seconds: about ${DRIFT.toFixed(1)} semitones a degree, nearly an octave in all. Part 3 is about keeping it in tune.`;
  }
}

// ---- the transistor's chart: collector current, on a log scale, against the base voltage

const CW = 340, CH = 246;
const PX0 = 52, PX1 = 330, PY0 = 22, PY1 = 202;
const V_LO = 0.3, V_HI = 0.75, DEC_LO = -9, DEC_HI = -1;
const px = (v: number) => PX0 + ((v - V_LO) / (V_HI - V_LO)) * (PX1 - PX0);
const py = (i: number) => PY1 - ((Math.log10(i) - DEC_LO) / (DEC_HI - DEC_LO)) * (PY1 - PY0);
const onChart = (v: number, i: number) => v >= V_LO && v <= V_HI && i >= 10 ** DEC_LO && i <= 10 ** DEC_HI;

/** The transistor's curve at `celsius`, as polyline points. */
function curvePoints(celsius: number): string {
  return Array.from({ length: 91 }, (_, k) => {
    const v = V_LO + ((V_HI - V_LO) * k) / 90;
    return `${px(v).toFixed(1)},${py(clamp(collectorCurrent(v, celsius), 10 ** DEC_LO, 10 ** DEC_HI)).toFixed(1)}`;
  }).join(' ');
}

/** What doesn't move: the axes, the decades, Moritz's window, the limits, and the transistor at 25 °C. */
function chartFrame(): SVGElement[] {
  const els: SVGElement[] = [
    s('rect', { x: px(0.35), y: PY0, width: px(0.55) - px(0.35), height: PY1 - PY0, class: 'band' }),
    s('text', { x: px(0.45), y: PY1 - 6, 'text-anchor': 'middle' }, 'his 350 to 550 mV'),
  ];
  ['1 nA', '10 nA', '100 nA', '1 µA', '10 µA', '100 µA', '1 mA', '10 mA', '100 mA'].forEach((label, k) => {
    const y = py(10 ** (DEC_LO + k));
    els.push(s('line', { x1: PX0, y1: y, x2: PX1, y2: y, class: 'grid' }), s('text', { x: PX0 - 5, y: y + 3.5, 'text-anchor': 'end' }, label));
  });
  for (const v of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    els.push(s('line', { x1: px(v), y1: PY1, x2: px(v), y2: PY1 + 4, class: 'axis' }), s('text', { x: px(v), y: PY1 + 16, 'text-anchor': 'middle' }, `${v.toFixed(1)} V`));
  }
  const level = (i: number, label: string, cls: string) => els.push(s('line', { x1: PX0, y1: py(i), x2: PX1, y2: py(i), class: cls }), s('text', { x: PX0 + 5, y: py(i) - 4 }, label));
  level(currentFor(20), '20 Hz', 'level');
  level(currentFor(HEARING), '20 kHz', 'level');
  level(STOP, 'the core stops', 'stop');
  els.push(
    s('path', { d: `M${PX0},${PY0} V${PY1} H${PX1}`, class: 'axis' }),
    s('polyline', { points: curvePoints(ROOM), class: 'curve' }),
    s('text', { x: PX0, y: 12 }, 'collector current, log scale'),
    s('text', { x: (PX0 + PX1) / 2, y: CH - 5, 'text-anchor': 'middle' }, 'the base voltage'),
  );
  return els;
}

export default defineLab({
  id: 'exponential-converter',
  title: 'The exponential converter',
  summary:
    'Part 2 of Moritz Klein’s DIY VCO: the simplest exponential converter. A bigger capacitor or resistor would lower the core’s pitch, but a BC548C in place of its 100k puts the pitch under control: the transistor’s current grows ten times for every 59 mV at its base, so 350 to 550 mV takes the core from clicks to a whine. A pot sets the base; then a sequencer’s CV, scaled down by 100k and 4k and offset by the pot in a passive mixer, plays it, at about two octaves a volt rather than one; and a warm finger on the transistor detunes it by over a semitone a degree.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE_CLASS });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE_CLASS) + CSS));

    let step: Step = 1, bigR = false, bigC = false, listen = false, running = true, finger = false;
    /** The sequencer's note, the time towards its next, and the transistor's temperature. */
    let pos = 0, acc = 0, temp = ROOM;
    /** The pot's wiper, unloaded, in each step that has the pot: each starts where its text says. */
    const pots: Record<2 | 4 | 5, number> = { 2: 0.5, 4: 8, 5: 11.6 };
    const potStep = (): 2 | 4 | 5 | null => (step === 2 || step === 4 || step === 5 ? step : null);

    /** The base, the collector current and the core's times with `cv` on the jack, at `celsius`. */
    const state = (cv: number, celsius = temp) => {
      const p = potStep(), w = wiper((p ? pots[p] : 0) / V12);
      const fromPot: Feed = { v: w.v, r: R + w.r }, fromJack: Feed = { v: cv, r: R };
      const feeds = step === 2 ? [fromPot] : step === 3 ? [fromJack] : [fromPot, fromJack];
      const vb = baseVoltage(feeds, step === 2 ? Infinity : R_SCALE, celsius);
      const i = collectorCurrent(vb, celsius);
      return { vb, i, t: sinkTimes(i), w, loaded: w.v - (w.r * (w.v - vb)) / (R + w.r) };
    };

    // ---- the schematic: the core, and what drains it in each step
    const dc = new Circuit();
    const sch = new Schematic(dc, { width: 600, height: 284, label: 'Schematic' });
    const kit = new Kit(sch, dc);

    // the core: inverter 1 of the 40106, the diode from its output back to its input, 2.2 nF to ground
    let capText!: SVGTextElement;
    kit.group(() => {
      const inv = schmitt(kit, 330, 130);
      kit.ana('ana', [300, 130], inv.in);
      kit.text('1', [326, 123], { anchor: 'end', size: 9, class: 'faint' });
      kit.text('2', [382, 123], { anchor: 'start', size: 9, class: 'faint' });
      kit.ana('plain', [345, 117.5], [345, 104]);
      kit.text('+12 V', [345, 96], { size: 10, class: 'dim' });
      kit.text('14', [350, 111], { anchor: 'start', size: 9, class: 'faint' });
      kit.ana('plain', [350, 140], [350, 152]);
      kit.ground(350, 152);
      kit.text('7', [355, 146], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('40106', [392, 150], { anchor: 'start', size: 9, class: 'dim' });
      kit.ana('plain', inv.out, [412, 130], [412, 75], [387, 75]);
      diode(kit, 375, 75, 'left');
      kit.text('1N4148', [375, 61], { size: 10 });
      kit.ana('ana', [363, 75], [300, 75], [300, 176.5]);
      kit.anaDot('ana', [300, 130]);
      kit.cap(300, 180, 'v');
      capText = kit.text('2.2 nF', [314, 180], { anchor: 'start', size: 11 });
      kit.ana('plain', [300, 183.5], [300, 196]);
      kit.ground(300, 196);
      kit.anaDot('ana', [300, 150]);
      kit.ana('ana', [300, 150], [265, 150]);
      kit.text('its other inputs (3, 5, 9, 11, 13) to ground', [440, 236], { size: 9, class: 'dim' });
      // on to part 1's output stage, with part 2's fix in it
      kit.anaDot('ana', [300, 75]);
      kit.ana('ana', [300, 75], [300, 40], [510, 40], [510, 58]);
      kit.block(440, 58, 140, 56);
      kit.text('part 1’s output stage:', [510, 72], { size: 9, class: 'dim' });
      kit.text('buffer, 1 µF and 100k,', [510, 86], { size: 9, class: 'dim' });
      kit.text('two 10k to the jack', [510, 100], { size: 9, class: 'dim' });
    });

    // step 1: a resistor drains it, 100k or 1M
    let drainText!: SVGTextElement;
    const gDrain = kit.group(() => {
      kit.ana('ana', [265, 150], [265, 160]);
      kit.resistor(265, 175, 'v');
      drainText = kit.text('100k', [254, 175], { anchor: 'end', size: 11 });
      kit.ana('plain', [265, 190], [265, 196]);
      kit.ground(265, 196);
    });

    // steps 2-5: the BC548C instead, its base on the left
    let tempText!: SVGTextElement;
    const gTr = kit.group(() => {
      const q = npnLeft(kit, 250, 175);
      kit.ana('ana', [265, 150], q.collector);
      kit.ana('plain', q.emitter, [265, 200]);
      kit.ground(265, 200);
      kit.text('BC548C', [240, 158], { anchor: 'end', size: 10 });
      tempText = kit.text('', [240, 198], { anchor: 'end', size: 10, class: 'dim' });
    });
    const gBase = kit.group(() => kit.ana('ana', [170, 175], [232, 175]));

    // steps 2, 4 and 5: the pot across 12 V, its wiper through 100k
    const gPot = kit.group(() => {
      const p = potDivider(kit, 72, 130);
      kit.ana('plain', p.top, [72, 100]);
      kit.vcc(72, 100, '+12 V');
      kit.ana('plain', p.bottom, [72, 160]);
      kit.ground(72, 160);
      kit.text('100k pot', [58, 130], { anchor: 'end', size: 11 });
      kit.ana('ana', p.wiper, [115, 130]);
      kit.resistor(130, 130, 'h', '100k', 'top');
      kit.ana('ana', [145, 130], [170, 130], [170, 175]);
    });

    // steps 3-5: the CV jack through 100k, and 4k to ground
    const gScale = kit.group(() => {
      const j = jack(kit, 96, 220, 'left', 'CV in (0 to 5 V)');
      kit.ana('ana', j.tip, [115, 220]);
      kit.resistor(130, 220, 'h', '100k', 'top');
      kit.ana('ana', [145, 220], [170, 220], [170, 175]);
      kit.anaDot('ana', [170, 220]);
      kit.ana('ana', [170, 220], [170, 230]);
      kit.resistor(170, 245, 'v', '4k', 'right');
      kit.ana('plain', [170, 260], [170, 266]);
      kit.ground(170, 266);
      kit.ana('plain', j.sleeve, [104, 237], [104, 250]);
      kit.ground(104, 250);
    });
    // steps 4 and 5: both into one point, the passive mixer
    const gMix = kit.group(() => kit.anaDot('ana', [170, 175]));

    // ---- the transistor's chart, and the sequence
    const warmCurve = s('polyline', { points: '', class: 'curve warm' });
    const dots = s('g');
    const chart = s('svg', { viewBox: `0 0 ${CW} ${CH}`, class: 'ic-chart', role: 'img', 'aria-label': 'Chart of the transistor' }, ...chartFrame(), warmCurve, dots);
    const chartNote = h('p', { class: 'note' });
    const seqRows = MEANT.map((meant, k) => {
      const plays = h('td');
      return { tr: h('tr', null, h('td', null, String(k + 1)), h('td', null, fmtCv(SEQ[k])), h('td', null, meant), plays), plays };
    });
    const seqHead = h('h3', { class: 'sub-head' }, 'The sequence');
    const seqTable = h(
      'div',
      { class: 'table-scroll' },
      h('table', { class: 'truth-table seq-table' }, h('thead', null, h('tr', null, ['note', 'CV', 'meant', 'plays'].map((x) => h('th', null, x)))), h('tbody', null, seqRows.map((r) => r.tr))),
    );

    // ---- the scope: the capacitor and the output, triggered on a jump
    const capLane: ScopeChannel = { label: '', kind: 'analog', min: 4, max: 8, guides: [VN12, VP12], color: '#a78bfa' };
    const outLane: ScopeChannel = { label: 'the 40106’s output, pin 2: 0 to 12 V', kind: 'analog', min: 0, max: 12.5, color: '#f59e0b' };
    const scope = new Scope([capLane, outLane], { width: 640, laneHeight: 70 });
    /** About four and a half cycles of `core`, which starts at the top of a fall, a jump `PRE` readings in. */
    const drawScope = (core: SchmittCore | SinkCore, fall: number, period: number) => {
      let span = 1e-3;
      if (Number.isFinite(period)) {
        span = clamp(4.5 * period, 20e-6, 2);
        core.step(Math.max(0, fall - (PRE * span) / N));
      }
      const w = sampleCore(core, span / N, N);
      capLane.label = `the capacitor, 40106 pin 1: 4 to 8 V, ${fmtT(span)} across`;
      scope.draw([w.vc.map((v) => clamp(v, 4, 8)), w.out], { window: N });
    };

    // ---- readouts
    const kv = {
      1: readouts(['thresholds (typical, on 12 V)', 'the drain', 'the capacitor', 'the jump (through the diode)', 'the fall', 'pitch']),
      2: readouts(['the pot’s wiper', 'the base', 'collector current', 'the fall', 'pitch']),
      3: readouts(['the sequencer now', 'at the base', 'collector current', 'pitch']),
      4: readouts(['the pot’s wiper', 'the sequencer now', 'at the base', 'pitch', 'per volt of CV']),
      5: readouts(['the transistor', 'the sequencer now', 'at the base', 'pitch', 'drift since 25 °C']),
    };
    for (const r of Object.values(kv)) growOnly(r.el); // they follow the sequencer
    kv[1].set('thresholds (typical, on 12 V)', `${VP12.toFixed(2)} V going up, ${VN12.toFixed(2)} V coming down`);
    const kvHost = h('div', { class: 'synth-kv' });
    const status = callout();

    // ---- sound: a sawtooth at the core's pitch, from clicks to the top of hearing
    const tone = new Tone();
    d.add(() => tone.dispose());
    let toneHz = 0;
    const sound = (hz: number) => {
      const want = listen && hz >= 0.1 && hz <= HEARING ? hz : 0;
      if (!want) {
        tone.stop();
        toneHz = 0;
      } else if (Math.abs(want - toneHz) > want * 1e-4) {
        tone.saw(want);
        toneHz = want;
      }
    };

    // ---- controls
    const stepSel = select<`${Step}`>(STEPS, '1', (v) => { step = Number(v) as Step; apply(); }, 'Step');
    const rSel = select<'100k' | '1M'>([{ value: '100k', label: '100k' }, { value: '1M', label: '1M' }], '100k', (v) => { bigR = v === '1M'; update(); }, 'The drain');
    const cSel = select<'2.2n' | '1u'>([{ value: '2.2n', label: '2.2 nF' }, { value: '1u', label: '1 µF' }], '2.2n', (v) => { bigC = v === '1u'; update(); }, 'The capacitor');
    const potSlider = new Slider({
      label: 'The pot',
      min: 0,
      max: V12,
      value: pots[2],
      positions: 12000, // a millivolt an arrow key
      format: (v) => `${v.toFixed(3)} V`,
      onInput: (v) => {
        const p = potStep();
        if (p) pots[p] = v;
        update();
      },
    });
    potSlider.el.classList.add('pot-slider');
    const potRow = row(potSlider.el);
    const runToggle = new Toggle({ label: 'Sequencer running', value: running, onChange: (v) => { running = v; acc = 0; } });
    const nextBtn = new Button({ label: 'Next note', onClick: () => { pos = (pos + 1) % SEQ.length; acc = 0; update(); } });
    const fingerToggle = new Toggle({ label: 'A finger on the transistor', value: finger, onChange: (v) => { finger = v; update(); } });
    const listenToggle = new Toggle({ label: 'Listen (quietly)', value: listen, onChange: (v) => { listen = v; update(); } });

    const transistorPanel = panel('The transistor', { accent: 'blue' }, chart, chartNote, seqHead, seqTable);

    const sequencerNow = () => `note ${pos + 1} of ${SEQ.length}: ${fmtV(SEQ[pos])}, meant as ${MEANT[pos]}`;
    const wiperText = (n: ReturnType<typeof state>) => (Math.abs(n.loaded - n.w.v) > 5e-4 ? `${fmtV(n.loaded)} (${fmtV(n.w.v)} with nothing on it)` : fmtV(n.loaded));

    /** Everything that follows the circuit: readouts, chart, table, scope and sound. */
    const update = () => {
      if (step === 1) {
        const r = bigR ? BIG_R : R, c = bigC ? BIG_C : C, t = coreTimes(r, c, V12, VP12, VN12);
        const rName = bigR ? '1M' : '100k', cName = bigC ? '1 µF' : '2.2 nF';
        setText(drainText, rName);
        setText(capText, cName);
        kv[1].set('the drain', rName);
        kv[1].set('the capacitor', cName);
        kv[1].set('the jump (through the diode)', `about ${fmtT(t.rise)}`);
        kv[1].set('the fall', `${fmtT(t.fall)} = ${rName} × ${cName} × ln(${VP12.toFixed(2)} ÷ ${VN12.toFixed(2)})`);
        kv[1].set('pitch', pitchText({ hz: 1 / t.period, stalled: false }));
        const core = new SchmittCore(r, c, V12, VP12, VN12);
        core.vc = VP12;
        core.high = false;
        drawScope(core, t.fall, t.period);
        sound(1 / t.period);
        return;
      }
      setText(capText, '2.2 nF');
      const n = state(step === 2 ? 0 : SEQ[pos]);
      const pitch = pitchText(n.t);
      if (step === 2) {
        kv[2].set('the pot’s wiper', wiperText(n));
        kv[2].set('the base', fmtV(n.vb));
        kv[2].set('collector current', n.t.stalled ? `${fmtA(n.i)}: over the ${fmtA(STOP)} the 40106 can put back` : fmtA(n.i));
        kv[2].set('the fall', n.t.stalled ? 'none: the capacitor never gets to the top' : Number.isFinite(n.t.fall) ? `${fmtT(n.t.fall)} = 2.2 nF × ${(VP12 - VN12).toFixed(2)} V ÷ ${fmtA(n.i)}` : 'never: nothing drains it');
        kv[2].set('pitch', pitch);
      } else if (step === 3) {
        kv[3].set('the sequencer now', sequencerNow());
        kv[3].set('at the base', fmtV(n.vb));
        kv[3].set('collector current', fmtA(n.i));
        kv[3].set('pitch', pitch);
      } else if (step === 4) {
        const perVolt = state(SEQ[pos] + 0.01).vb - n.vb;
        kv[4].set('the pot’s wiper', wiperText(n));
        kv[4].set('the sequencer now', sequencerNow());
        kv[4].set('at the base', fmtV(n.vb));
        kv[4].set('pitch', pitch);
        kv[4].set('per volt of CV', `${(perVolt * 1e5).toFixed(1)} mV at the base: ${(perVolt / 0.01 / DOUBLING).toFixed(2)} octaves (1 V per octave needs ${(DOUBLING * 1e3).toFixed(1)} mV)`);
      } else {
        const cold = state(SEQ[pos], ROOM);
        const drift = n.t.hz > 0 && cold.t.hz > 0 ? 12 * Math.log2(n.t.hz / cold.t.hz) : 0;
        kv[5].set('the transistor', `${temp.toFixed(1)} °C${finger ? ', a finger on it' : temp > ROOM ? ', cooling' : ''}`);
        kv[5].set('the sequencer now', sequencerNow());
        kv[5].set('at the base', fmtV(n.vb));
        kv[5].set('pitch', pitch);
        kv[5].set('drift since 25 °C', `${drift >= 0.05 ? '+' : drift <= -0.05 ? '−' : ''}${Math.abs(drift).toFixed(1)} semitones`);
      }
      setText(tempText, step === 5 ? `${temp.toFixed(1)} °C` : '');

      // the chart: the base now, or the sequence's notes at the base
      const notes = step === 2 ? [n] : SEQ.map((cv) => state(cv));
      const now = step === 2 ? 0 : pos;
      warmCurve.setAttribute('points', step === 5 && temp > ROOM + 0.05 ? curvePoints(temp) : '');
      dots.replaceChildren(...notes.flatMap((p, k) => (onChart(p.vb, p.i) ? [s('circle', { cx: px(p.vb).toFixed(1), cy: py(p.i).toFixed(1), r: k === now ? 5.5 : 3.5, class: k === now ? 'pt now' : 'pt' })] : [])));
      const curve = `Chart of the BC548C’s collector current against its base voltage, on a log scale, at ${ROOM} °C: a straight line, ten times the current for every ${mV(DECADE)}. Shaded: 350 to 550 mV.`;
      if (step === 2) {
        chart.setAttribute('aria-label', `${curve} The base is at ${fmtV(n.vb)}: ${fmtA(n.i)}, ${pitch}.`);
        setText(chartNote, `The curve is the transistor at ${ROOM} °C: a straight line on this scale. The dot is its base now. Shaded: the 350 to 550 mV Moritz finds works, from clicks to a high whine. Under the 20 Hz line it clicks; above the 20 kHz line it whines out of hearing; above the top line the core stops.`);
      } else {
        const lo = notes[0], hi = notes[notes.length - 1];
        // the top note's current over the bottom's, from the exponential (the bottom can be nothing at all)
        const ratio = Math.exp((hi.vb - lo.vb) / thermalVoltage(temp));
        chart.setAttribute('aria-label', `${curve}${step === 5 ? ` The transistor is at ${temp.toFixed(1)} °C.` : ''} The sequence’s eight notes get ${fmtV(lo.vb)} to ${fmtV(hi.vb)} at the base; note ${pos + 1} plays ${pitch}.`);
        setText(
          chartNote,
          step === 3
            ? `The sequence’s eight notes get ${fmtV(lo.vb)} to ${fmtV(hi.vb)} at the base, off this chart to the left: the transistor passes ${fmtA(hi.i)} at most.`
            : step === 4
              ? `The dots are the sequence’s eight notes at the base, the big one playing. The pot slides them along together. They span ${mV(hi.vb - lo.vb)}, so the top note gets about ${Math.round(ratio)} times the current of the bottom one: ${Math.log2(ratio).toFixed(1)} octaves, for a sequence meant to span ${Math.round(SEQ[SEQ.length - 1])}.`
              : temp > ROOM + 0.05
                ? `The dashed curve is the transistor now, at ${temp.toFixed(1)} °C: more current at every base voltage, and the notes climb with it.`
                : `The dots are the sequence’s eight notes at the base, the big one playing. Put a finger on the transistor and a dashed curve shows it warmed, the notes on it.`,
        );
        seqRows.forEach((r, k) => {
          setText(r.plays, playsText(notes[k].t));
          setClass(r.tr, 'current', k === pos);
        });
      }

      // the scope, and the sound
      const core = new SinkCore(C, V12);
      core.i = n.i;
      if (n.t.stalled) {
        core.vc = core.held;
        core.high = true;
      }
      drawScope(core, n.t.fall, n.t.period);
      sound(n.t.stalled ? 0 : n.t.hz);
    };

    /** A new step: its parts of the schematic, its controls, its readouts and its text. */
    const apply = () => {
      gDrain.show(step === 1);
      gTr.show(step >= 2);
      gBase.show(step >= 2);
      gPot.show(step === 2 || step >= 4);
      gScale.show(step >= 3);
      gMix.show(step >= 4);
      sch.el.setAttribute('aria-label', schematicLabel(step));
      const show = (el: HTMLElement, v: boolean) => (el.style.display = v ? '' : 'none');
      show(rSel, step === 1);
      show(cSel, step === 1);
      show(potRow, potStep() !== null);
      show(runToggle.el, step >= 3);
      show(nextBtn.el, step >= 3);
      show(fingerToggle.el, step === 5);
      show(transistorPanel, step >= 2);
      show(seqHead, step >= 3);
      show(seqTable, step >= 3);
      const p = potStep();
      if (p) potSlider.set(pots[p]);
      if (step !== 5) {
        // the finger comes off, and the transistor is at room temperature again
        finger = false;
        fingerToggle.set(false);
        temp = ROOM;
      }
      kvHost.replaceChildren(kv[step].el);
      setText(status, stepText(step));
      update();
    };

    // ---- each frame: the sequencer moves on, and the transistor warms or cools
    d.add(
      animate((ms) => {
        const dt = Math.min(ms, 100) / 1000;
        let changed = false;
        if (step >= 3 && running) {
          acc += dt;
          while (acc >= NOTE_S) {
            acc -= NOTE_S;
            pos = (pos + 1) % SEQ.length;
            changed = true;
          }
        }
        if (step === 5) {
          const target = finger ? FINGER : ROOM;
          if (temp !== target) {
            temp = Math.abs(temp - target) < 0.005 ? target : target + (temp - target) * Math.exp(-dt / WARM_TAU);
            changed = true;
          }
        }
        if (changed) update();
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'The circuit',
          { accent: 'red', chips: '40106 · BC548C · 1N4148 · 2.2 nF foil · a 100k pot · 100k ×2 · 4k · a jack for the CV · part 1’s output stage, its divider now two 10k · 12 V' },
          row(stepSel, rSel, cSel, runToggle.el, nextBtn.el, fingerToggle.el, listenToggle.el),
          potRow,
          h('div', { class: 'synth-circuit' }, sch.el, kvHost),
          status,
        ),
        transistorPanel,
        panel('Scope', { accent: 'yellow' }, scope.el, note('Triggered on a jump, its time across turned to show about four and a half cycles (between 20 µs and 2 s). The capacitor’s lane has the 40106’s thresholds dashed; its output is high only for each jump, or all the time once the core stops.')),
        notes(),
      ),
    );
    apply();
    return d.dispose;
  },
});

function notes(): HTMLElement {
  return panel(
    'From the video',
    { accent: 'gray' },
    note('Moritz begins by fixing part 1’s output stage: with two 100k, he says, the divider after the 1 µF made an accidental band-pass filter that bent the top of the wave, so two 10k take their place. The schematic keeps that stage as a box.'),
    note('He pictures an NPN transistor in water pipes, with a T joint, a seal and a spring: a small flow into the base lets a much larger one through, from the collector to the emitter. Used as a current amplifier (its linear region, with a gain of 100 to 900), it would let too much through, answer to current rather than voltage, and be linear. Below about 0.7 V, he says, it is barely open, answers to the base voltage, and grows exponentially: what a VCO needs.'),
    note('His description’s update corrects the video: the split into a linear region and a half-on state is wrong, since the collector current depends exponentially on the base voltage throughout. That is how the model has it; the circuit works either way.'),
    note('1 V per octave: C0 is 16.35 Hz, each octave up doubles the pitch, and each volt more of CV should play an octave higher. The transistor doubles its current for every 17.8 mV at its base (at 25 °C), which is why its window is so narrow, and why the CV has to be scaled down.'),
    note('Scaling and offset: his SQ-1’s 0 to 5 V into a window of about 200 mV is 25 times smaller, hence 100k and about 4k, roughed in. The offset is a passive mixer, a resistor from each voltage into one point; with the 4k it is a divider with two inputs. Part 3 tunes the scaling and fights the drift.'),
    note(
      `Estimates here: the 40106’s thresholds on 12 V are interpolated from TI’s typical values (${VP12.toFixed(2)} and ${VN12.toFixed(2)} V), and its output is taken as about ${R_OUT} Ω, through the diode’s ${VDIODE} V. The BC548C follows I_S (e^(V_BE / V_T) − 1), with I_S from its datasheets’ typical 660 mV at 2 mA, a current gain of 520, and SPICE’s law for temperature; the Early effect and what happens at tens of milliamps are left out. Transistors differ: the datasheets allow 580 to 700 mV at 2 mA, a factor of about 100 in current at a given base voltage, so another BC548C’s window can sit tens of millivolts away from Moritz’s. The finger’s ${FINGER} °C and the ${WARM_TAU} s it takes are made up, to show the drift. The sequence (C2, G2, C3, G3, C4, G4, C5 and C6 for 0 to 4 V) is the lab’s own. Listen plays a sawtooth at the core’s pitch: the browser’s own, rising where the core’s falls, with the same harmonics.`,
    ),
  );
}
