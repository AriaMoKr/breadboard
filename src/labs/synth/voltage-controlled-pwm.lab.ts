import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row, select, type ScopeChannel } from '../../ui/components';
import { Disposer, animate, growOnly, h, s, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { Kit, kitCss } from '../clock/_draw';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import {
  OUT_STAGES,
  PWM,
  PWM_TAU,
  SQUARE_Z,
  TL074_LOADED,
  V12,
  VSAT12,
  comparator,
  comparatorPeriods,
  comparatorWidth,
  coupledFromRest,
  coupledSaw,
  crossesOnce,
  cvShare,
  heldStill,
  noteHz,
  offsetFeed,
  outStage,
  outZ,
  pwmBuilt,
  squareOut,
  swingInto,
  thresholdOf,
  thresholds,
  type OutStage,
  type Periods,
  type Threshold,
} from './_analog';
import { jack, potDivider, railDown, rheostat, schmitt } from './_draw';
import { HEARING, fmtA, fmtHz, schBox, schBoxCss } from './_shared';
import { PwmTone, triangle } from './_sound';

const SCOPE_CLASS = 'synth-pwm';
const PERIOD_N = 512; // readings in one period of a wave
const WINDOW = 0.02; // s: the scope shows 20 ms, as part 4's does
const N = 500; // readings across it
const CHART_N = 201; // the width charts' readings
const NOTE_S = 1 / 3; // the sequencer moves on three times a second
/** The note the VCO holds until the last step: C3, as in part 4's lab (the lab's choice). */
const NOTE = noteHz('C3');
/** Part 4's arpeggio, in C major over two octaves: the lab's own sequence. */
const SEQ = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'G4'];
/** The core's jump, top to bottom, on 12 V. */
const JUMP = thresholds(V12).vp - thresholds(V12).vn;
/** His three examples, at 40 Hz through 1 µF and 100k, 16 periods of 100 readings from the moment each is connected. */
const EX_HZ = 40, EX_TAU = 1e-6 * 100e3, EX_PERIODS = 16, EX_PER = 100, EX_SETTLE = 200;
/** The oscillator his last sound demo puts on the CV: here 110 Hz (the lab's choice). */
const AUDIO_RATE = 110;

// ---- formatting

/** Volts with a sign, to a hundredth. */
const pm = (v: number) => `${v >= 0.005 ? '+' : v <= -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)} V`;
const span = (top: number, bottom: number) => `${pm(top)} to ${pm(bottom)}`;
const pct = (x: number) => `${Math.round(100 * x)}%`;
/** A share from 0 to 1 as a percentage, never rounding some of it to none or all of it. */
const part = (x: number) => (x <= 0 ? '0%' : x >= 1 ? '100%' : x < 0.005 ? 'under 1%' : x >= 0.995 ? 'over 99%' : pct(x));
const ohms = (r: number) => (r >= 1e6 ? `${+(r / 1e6).toPrecision(3)}M` : r >= 1e3 ? `${+(r / 1e3).toPrecision(3)}k` : `${Math.round(r)} Ω`);
/** How much of the time the comparator's output is high, in words. */
const widthText = (w: number) => (w <= 0 ? 'no pulse: the output stays low' : w >= 1 ? 'no pulse: the output stays high' : `high ${part(w)} of the time`);
const mean = (vals: readonly number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
/** The offset pot's wiper with nothing on it, its turn from the −12 V end. */
const wiperOpen = (turn: number) => 2 * V12 * turn - V12;
/** A schematic's drawing cut to `w` by `hgt`, at no more than its own size (and on a touch screen no less than 3/4 of it, styles.css). */
function frame(sch: Schematic, w: number, hgt: number) {
  sch.el.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  sch.el.style.setProperty('--sch-w', String(w));
  sch.el.style.maxWidth = `${w}px`;
}
const clampTo = (vals: readonly number[], lo: number, hi: number) => vals.map((v) => Math.max(lo, Math.min(hi, v)));

const CSS = `
.${SCOPE_CLASS} .synth-circuit { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; }
.${SCOPE_CLASS} .synth-sch { flex: 1 1 440px; }
.${SCOPE_CLASS} .synth-kv { flex: 1 1 220px; }
.${SCOPE_CLASS} .schmitt-sign { stroke-width: 1.5; }
.${SCOPE_CLASS} .kv dd { font-variant-numeric: tabular-nums; }
.${SCOPE_CLASS} .pot-slider { display: flex; width: 100%; }
.${SCOPE_CLASS} .pot-slider input { flex: 1 1 auto; width: auto; min-width: 0; }`;

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const STEPS: { value: `${Step}`; label: string }[] = [
  { value: '1', label: '1. The trouble with pulse waves' },
  { value: '2', label: '2. AC coupling, cycle by cycle' },
  { value: '3', label: '3. A comparator' },
  { value: '4', label: '4. 100k and 14k' },
  { value: '5', label: '5. External CV' },
  { value: '6', label: '6. Output impedances' },
  { value: '7', label: '7. The sound' },
];

type Example = 'square' | 'offset' | 'pulse';
const EXAMPLES: { value: Example; label: string }[] = [
  { value: 'square', label: 'a 50% square, ±5 V' },
  { value: 'offset', label: 'the same, 7 V up' },
  { value: 'pulse', label: 'a 5% pulse, 7 V up' },
];
const EX_WAVE: Record<Example, { lo: number; hi: number; d: number }> = {
  square: { lo: -5, hi: 5, d: 0.5 },
  offset: { lo: 2, hi: 12, d: 0.5 },
  pulse: { lo: 2, hi: 12, d: 0.05 },
};
const EX_TEXT: Record<Example, [string, string, string]> = {
  square: ['a 50% square,', '±5 V at 40 Hz', 'A 50% square wave of ±5 V at 40 Hz'],
  offset: ['the same square,', '+2 to +12 V', 'The same square wave 7 V up, from +2 to +12 V,'],
  pulse: ['a 5% pulse,', '+2 to +12 V', 'A 5% pulse wave from +2 to +12 V'],
};

type CvKind = 'lfo' | 'steady';
const CV_KINDS: { value: CvKind; label: string }[] = [
  { value: 'lfo', label: 'an LFO, ±7 V' },
  { value: 'steady', label: 'a steady voltage' },
];

const STAGES: { value: OutStage; label: string }[] = [
  { value: 'divider', label: '100k and 68k alone' },
  { value: 'low', label: '1k and 680 Ω alone' },
  { value: 'buffered', label: '100k and 68k, a buffer, 1k (his)' },
];
type Load = 'scope' | 'module' | 'three' | 'ten';
const LOADS: { value: Load; label: string }[] = [
  { value: 'scope', label: 'a scope, 1M' },
  { value: 'module', label: 'a module’s input, 100k' },
  { value: 'three', label: 'three inputs at once, 33k' },
  { value: 'ten', label: '10k' },
];
const LOAD_R: Record<Load, number> = { scope: 1e6, module: 100e3, three: 33e3, ten: 10e3 };
const LOAD_TEXT: Record<Load, string> = { scope: 'a scope’s 1M', module: 'a module’s 100k input', three: 'three modules’ inputs at once, 33k', ten: '10k' };

/**
 * His three sounds, as the lab sets them: the offset pot's turn, the intensity pot's (1: all the way
 * up, 0 Ω; 0.8: 50k), and the LFO's rate. Through zero, the offset pot a quarter of the way up
 * leaves about a fifth of each cycle with no pulse.
 */
const PRESETS = {
  slow: { turn: 0.5, up: 0.8, rate: 0.4 },
  zero: { turn: 0.25, up: 1, rate: 2 },
  audio: { turn: 0.5, up: 1, rate: AUDIO_RATE },
};

// ---- numbers the texts quote, from the model

const C3_TOP = coupledSaw(1, 1 / NOTE, PWM_TAU)[0];
const JUMPER: Threshold = { turn: 0.5, rOffset: 0, rGround: Infinity, rCv: null };
const DIVIDED: Threshold = { turn: 0.5, rOffset: PWM.offset, rGround: PWM.ground, rCv: null };
/** Where on the pot's turn there is a pulse at C3: the share of it, and where it starts. */
function pulseSpan(t: Threshold) {
  const at = (turn: number) => comparatorWidth(thresholdOf({ ...t, turn }), NOTE);
  let lo = 0, hi = 0.5;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= 1) lo = mid;
    else hi = mid;
  }
  let lo2 = 0.5, hi2 = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo2 + hi2) / 2;
    if (at(mid) > 0) lo2 = mid;
    else hi2 = mid;
  }
  return { from: lo, to: lo2, share: lo2 - lo };
}
const SHARE_UP = cvShare(pwmBuilt(0.5, 0));
/**
 * Where on the offset pot's turn the LFO, the intensity up, takes the pulse through zero at C3:
 * below `down`, where its −7 V holds the output high, and above `up`, where its +7 V holds it low.
 */
function zeroEdges() {
  const at = (turn: number, cv: number) => comparatorWidth(thresholdOf(pwmBuilt(turn, 0), cv), NOTE);
  let a = 0, b = 0.5;
  for (let k = 0; k < 40; k++) {
    const mid = (a + b) / 2;
    if (at(mid, -PWM.lfo) >= 1) a = mid;
    else b = mid;
  }
  let c = 0.5, e = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (c + e) / 2;
    if (at(mid, PWM.lfo) <= 0) e = mid;
    else c = mid;
  }
  return { down: a, up: e };
}
const ZERO = zeroEdges();

/** What the callout says, per step. */
const STEP_TEXT: Record<Step, string> = {
  1: 'Until this video Moritz’s VCO set its pulse’s width only with a knob. He adds voltage control here, and fixes a bug first. On a scope, part 4’s square out sits centred on 0 V at 50%; widen the pulse and the whole wave slides down, its centre reaching about −4.5 V at the widest he shows, about 95%. An offset that big is too much, he says, and you can hear it as distortion. The AC coupling (1 µF, then 100k to ground) is there and working: it just doesn’t suit every wave. Here a slider sets the 40106’s pulse width directly, since part 4’s model pot only reaches about 84%, a centre at about −3.4 V.',
  2: 'His water analogy explains it, with three waves through a large capacitor and a large resistor (1 µF, then 100k to ground), each from the moment it is connected. A 50% square with no offset comes through almost unchanged: each phase leaks a little through the resistor, so it droops slightly, and it stays centred on 0 V. Raise the same square and it sinks, period after period, until its centre reaches 0 V, where what the high phase loses the low phase gains back, the two being equally long. A 5% pulse sinks too, but once its low phase is a little below 0 V, the long low phase gains back what the short high phase loses, and it stays far off centre. AC coupling only centres a wave that is symmetrical, as a sawtooth, a sine or a triangle is.',
  3: 'The way out is never to add the offset. Part 4 amplified the sawtooth with an op amp and fed it to a Schmitt trigger inverter, whose pulse sat 6 V up. A comparator does the job with one op amp and no feedback: it amplifies the difference between its inputs so much that its output sits at one rail or the other (a TL074 stops about 1.5 V short of them). With the sawtooth on its + input and a threshold on its − input, the output is high while the sawtooth is above the threshold and low while it is below: a square, with the threshold setting its width. For the threshold he first tries a 100k pot as a voltage divider across ±12 V. Centred it gives about 50%, but most of its turn does nothing. The sawtooth only swings about ±1.2 V here (about ±1.5 V on his scope), and once the threshold is outside that, the output stays high or low and the oscillation stops.',
  4: `The threshold must stay inside the sawtooth’s swing, and a plain voltage divider keeps it there: a 100k in place of the jumper, and 14k to ground, scale ±12 V down to about ±1.47 V, and now most of the turn works. The sawtooth here is a little smaller than his, so the last ${pct(pulseSpan(DIVIDED).from)} of the turn at each end still holds the output; with his ±1.5 V the pulse would run nearly end to end. The chart shows both, the jumper dashed.`,
  5: `The CV comes into the mix through another resistor, and in a divider with several inputs, each input’s resistor sets how much of the mix is its own. Two questions decide it: what range comes in, and should the CV be able to stop the pulse altogether (going through zero)? His LFOs swing ±7 V and he wants it to go through zero; he found 68k by trial and error, with a 250k pot in series to set how strongly the CV acts. Here, with a slow LFO, the intensity up and the offset pot centred, the LFO moves the threshold about ±${(PWM.lfo * SHARE_UP).toFixed(2)} V and the width from about ${pct(comparatorWidth(PWM.lfo * SHARE_UP, NOTE))} to ${pct(comparatorWidth(-PWM.lfo * SHARE_UP, NOTE))}, just short of zero. Turn the offset pot below ${pm(wiperOpen(ZERO.down))} or above ${pm(wiperOpen(ZERO.up))} (its wiper with nothing on it, as its slider shows) and it goes through zero on that side, the output stuck for part of each cycle; up takes more turning than down, since the sawtooth sits a little above centre (${span(C3_TOP, C3_TOP - JUMP)}).`,
  6: `Last, the level. The comparator swings around 24 V peak to peak, he says (about 21 V here, the TL074 stopping 1.5 V short of the rails), where modules expect 10. Part 4 cut its square down with a plain voltage divider, which works but leaves the output 20k behind the jack (${ohms(SQUARE_Z)} with the 100k beside it), easily dragged down by whatever it drives. Most professional modules have about 1k there. A divider of smaller resistors would waste current to ground, almost 10 mA by his count. So he takes a divider of large resistors with new values, for the comparator’s bigger swing: 100k with 68k to ground, then another op amp as a buffer, and 1k between that and the jack. Try his, and two the lab adds for comparison, his divider without the buffer and one a hundred times lower, each into a load.`,
  7: 'The finished circuit, with the sequencer playing part 4’s arpeggio. A slow LFO sounds like several slightly detuned oscillators, going through zero turns it into a rhythm, and an audio-rate oscillator on the CV makes harsh, strange tones. Try his three (their settings the lab’s: he doesn’t give them), then set it yourself. The comparator also frees a Schmitt trigger inverter, so in theory one 40106 could run six VCOs, more than anyone needs, he admits.',
};

/** The scope's words, per step. */
const SCOPE_NOTES: Record<Step, string> = {
  1: '20 ms across, about 2.6 periods of C3: the 40106’s output, then the square out with its middle dashed (0 V and ±5 V dashed across).',
  2: '0.4 s across, from the moment the wave is connected, the 1 µF empty: 16 periods at 40 Hz, slow enough for the drift to fit (at audio pitches it spans hundreds). The wave, then what comes out after the 1 µF, the middle of each period dashed. Listen stays quiet here.',
  3: '20 ms across at C3, from a jump: the sawtooth with the threshold dashed (at the lane’s edge when it is further), then the comparator’s output, its swing dashed.',
  4: '20 ms across at C3, from a jump: the sawtooth with the threshold dashed (at the lane’s edge when it is further), then the comparator’s output, its swing dashed.',
  5: '20 ms across at C3, from a jump: the CV in, the sawtooth with the threshold dashed (at the lane’s edge when it is further), and the comparator’s output.',
  6: '20 ms across at C3, the offset pot centred and the CV at 0 V: the comparator’s output, then the jack’s, into the load, with ±5 V dashed.',
  7: '20 ms across at the note the sequencer plays now: the CV in, the sawtooth with the threshold dashed (at the lane’s edge when it is further), and the pulse out.',
};

export default defineLab({
  id: 'voltage-controlled-pwm',
  title: 'Voltage-controlled PWM',
  summary:
    'Moritz Klein’s VCO gets voltage control of its pulse width, and a bug fixed on the way: part 4’s square out drifts off centre as its pulse widens, since AC coupling keeps a wave’s average at 0 V, not its middle. A comparator, one op amp with the sawtooth on one input and a threshold on the other, makes the pulse with no offset to remove; 100k and 14k keep the threshold within the sawtooth’s swing, a CV comes in through 68k and a 250k intensity pot, and a buffered divider with 1k behind it brings the output down towards the 10 V peak to peak modules expect (8.5 V here, the TL074 swinging ±10.5 V). Each step has its schematic and a scope, sound in all but the second, and charts of the width wherever the offset pot turns.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE_CLASS });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE_CLASS) + schBoxCss(SCOPE_CLASS) + CSS));

    let step: Step = 1, listen = false;
    let width1 = 0.5, example: Example = 'square';
    /** The offset pot's turn in the third step, the fourth, and the built circuit's; the intensity pot's turn up (1: 0 Ω). */
    const turns = { 3: 0.5, 4: 0.5, built: 0.5 };
    let up = 1, cvKind: CvKind = 'lfo', cvSteady = 0, rate = 0.5, lfoPh = 0;
    let stage: OutStage = 'divider', load: Load = 'module';
    let running = true, pos = 0, acc = 0;

    const intensity = () => (1 - up) * PWM.intensity;
    /** The threshold's mixer as the step has it: in the sixth, the offset pot centred, the pulse holding still for the output stage. */
    const th = (): Threshold =>
      step === 3 ? { ...JUMPER, turn: turns[3] } : step === 4 ? { ...DIVIDED, turn: turns[4] } : step === 6 ? pwmBuilt(0.5, 0) : pwmBuilt(turns.built, intensity());
    const hzNow = () => (step === 7 ? noteHz(SEQ[pos]) : NOTE);
    /** Whether an LFO is on the CV jack: in the fifth step if chosen, and in the last. */
    const lfoOn = () => step === 7 || (step === 5 && cvKind === 'lfo');
    /** The CV `time` seconds from now: the sixth step's is 0 V, the pulse holding still for the output stage. */
    const cvAt = (time: number) => (lfoOn() ? PWM.lfo * triangle(lfoPh + rate * time) : step === 5 ? cvSteady : 0);
    const saws = new Map<number, number[]>();
    const sawAt = (hz: number) => {
      let w = saws.get(hz);
      if (!w) saws.set(hz, (w = coupledSaw(PERIOD_N, 1 / hz, PWM_TAU)));
      return w;
    };

    // ---- schematic A (the first two steps): part 4's square out, or his examples, through 1 µF and 100k
    const dcA = new Circuit();
    const schA = new Schematic(dcA, { width: 440, height: 155, label: 'Schematic' });
    const a = new Kit(schA, dcA);
    a.block(10, 60, 116, 50);
    const srcA1 = a.text('', [68, 77], { size: 10, class: 'dim' });
    const srcA2 = a.text('', [68, 93], { size: 10, class: 'dim' });
    const gInvA = a.group(() => {
      a.ana('ana', [126, 85], [140, 85]);
      schmitt(a, 140, 85);
      a.text('40106', [160, 117], { size: 9, class: 'dim' });
    });
    const gWireA = a.group(() => a.ana('ana', [126, 85], [188, 85]));
    a.ana('ana', [188, 85], [211.5, 85]);
    a.cap(215, 85, 'h', '1 µF', 'top');
    a.ana('ana', [218.5, 85], [250, 85]);
    a.anaDot('ana', [245, 85]);
    a.ana('ana', [245, 85], [245, 100]);
    a.resistor(245, 115, 'v', '100k', 'left');
    a.ana('plain', [245, 130], [245, 137]);
    a.ground(245, 137);
    const gOutA = a.group(() => {
      a.ana('ana', [250, 85], [265, 85]);
      a.resistor(280, 85, 'h', '20k', 'top');
      a.ana('ana', [295, 85], [330, 85]);
      a.anaDot('ana', [312, 85]);
      a.ana('ana', [312, 85], [312, 100]);
      a.resistor(312, 115, 'v', '100k', 'left');
      a.ana('plain', [312, 130], [312, 137]);
      a.ground(312, 137);
      const j = jack(a, 330, 85, 'right', 'square out');
      a.ana('plain', j.sleeve, [330, 112]);
      a.ground(330, 112);
    });
    const gScopeA = a.group(() => {
      a.ana('ana', [250, 85], [296, 85]);
      a.over.appendChild(s('circle', { cx: 300, cy: 85, r: 3.5, class: 'contact' }));
      a.text('to the scope', [308, 85], { anchor: 'start', size: 10, class: 'dim' });
    });

    // ---- schematic B (the later steps): the comparator, its threshold's mixer, and the output
    const dcB = new Circuit();
    const schB = new Schematic(dcB, { width: 690, height: 278, label: 'Schematic' });
    const b = new Kit(schB, dcB);
    b.block(10, 50, 116, 46);
    b.text('the VCO’s sawtooth', [68, 66], { size: 10, class: 'dim' });
    const srcB2 = b.text('', [68, 80], { size: 10, class: 'dim' });
    b.ana('ana', [126, 73], [300, 73]);
    b.comparator(300, 88, '+');
    b.text('TL074', [322, 124], { size: 9, class: 'dim' });
    // the − input, and the mixer under it: the offset pot, through a jumper or 100k
    b.ana('ana', [300, 103], [280, 103], [280, 150]);
    b.ana('ana', [280, 150], [230, 150]);
    const g100k = b.group(() => {
      b.resistor(215, 150, 'h', '100k', 'top');
      b.ana('ana', [200, 150], [162, 150]);
    });
    const gJumper = b.group(() => {
      b.ana('ana', [230, 150], [162, 150]);
      b.text('a jumper', [196, 140], { size: 9, class: 'faint' });
    });
    const op = potDivider(b, 140, 150);
    b.ana('plain', op.top, [140, 122]);
    b.vcc(140, 122, '+12 V');
    b.ana('plain', op.bottom, [140, 178]);
    railDown(b, 140, 178, '−12 V');
    b.text('100k', [128, 144], { anchor: 'end', size: 11 });
    b.text('offset', [128, 157], { anchor: 'end', size: 11 });
    // 14k to ground, from the fourth step
    const g14k = b.group(() => {
      b.anaDot('ana', [280, 150]);
      b.ana('ana', [280, 150], [280, 160]);
      b.resistor(280, 175, 'v', '14k', 'right');
      b.ana('plain', [280, 190], [280, 197]);
      b.ground(280, 197);
    });
    // the CV in, through the 250k intensity pot and 68k, from the fifth
    const gCv = b.group(() => {
      b.anaDot('ana', [250, 150]);
      b.ana('ana', [250, 150], [250, 235], [205, 235]);
      b.resistor(190, 235, 'h', '68k', 'top');
      b.ana('ana', [175, 235], [140, 235]);
      rheostat(b, 125, 235);
      b.text('250k', [119, 212], { size: 11 });
      b.text('intensity', [125, 257], { size: 9, class: 'dim' });
      b.ana('ana', [110, 235], [86, 235]);
      const j = jack(b, 86, 235, 'left', 'CV in');
      b.ana('plain', j.sleeve, [86, 260]);
      b.ground(86, 260);
    });
    // the comparator's output: to the scope (the third step to the fifth), or the output stage
    b.ana('ana', [345, 88], [375, 88]);
    const gScopeB = b.group(() => {
      b.ana('ana', [375, 88], [396, 88]);
      b.over.appendChild(s('circle', { cx: 400, cy: 88, r: 3.5, class: 'contact' }));
      b.text('to the scope', [408, 88], { anchor: 'start', size: 10, class: 'dim' });
    });
    let topText!: SVGTextElement, botText!: SVGTextElement, loadText!: SVGTextElement;
    const gOutB = b.group(() => {
      b.resistor(390, 88, 'h');
      topText = b.text('100k', [390, 75], { size: 11 });
      b.ana('ana', [405, 88], [430, 88]);
      b.anaDot('ana', [430, 88]);
      b.ana('ana', [430, 88], [430, 100]);
      b.resistor(430, 115, 'v');
      botText = b.text('68k', [442, 115], { anchor: 'start', size: 11 });
      b.ana('plain', [430, 130], [430, 137]);
      b.ground(430, 137);
      const j = jack(b, 600, 88, 'right', 'pulse out');
      b.ana('plain', j.sleeve, [600, 116]);
      b.ground(600, 116);
    });
    // his buffer, another of the TL074's op amps, and its 1k; or the divider straight to the jack
    const gBuffer = b.group(() => {
      b.ana('ana', [430, 88], [470, 88]);
      b.comparator(470, 73, '−');
      b.text('TL074', [492, 110], { size: 9, class: 'dim' });
      b.anaDot('ana', [528, 73]);
      b.ana('ana', [515, 73], [528, 73], [528, 40], [460, 40], [460, 58], [470, 58]);
      b.ana('ana', [528, 73], [528, 88], [540, 88]);
      b.resistor(555, 88, 'h', '1k', 'top');
      b.ana('ana', [570, 88], [600, 88]);
    });
    const gBypass = b.group(() => b.ana('ana', [430, 88], [600, 88]));
    const gLoad = b.group(() => {
      b.anaDot('ana', [582, 88]);
      b.ana('ana', [582, 88], [582, 105]);
      b.resistor(582, 120, 'v');
      b.ana('plain', [582, 135], [582, 142]);
      b.ground(582, 142);
      b.text('the load', [571, 113], { anchor: 'end', size: 9, class: 'dim' });
      loadText = b.text('', [571, 127], { anchor: 'end', size: 11 });
    });
    const schHost = schBox();

    /** The schematic's words, per step. */
    const schematicLabel = (): string => {
      if (step === 1)
        return 'Schematic: part 4’s pulse, the sawtooth amplified by an op amp whose gain a pot sets, through a 1N4148 with a 100k pull-down into a 40106 inverter (its width set directly here). Its output goes through 1 µF, with 100k to ground after it, then 20k, with 100k to ground, to the square out jack.';
      if (step === 2) return `Schematic: ${EX_TEXT[example][2]} goes through 1 µF, with 100k to ground after it, to the scope.`;
      const offset = step === 3 ? 'its wiper on the − input through a jumper' : 'its wiper through 100k to the − input, with 14k from there to ground';
      const cv = step >= 5 ? ' The CV in jack goes through a 250k pot, as a variable resistor, and 68k to the − input too.' : '';
      const o = OUT_STAGES[stage];
      const out =
        step <= 5
          ? 'The comparator’s output goes to the scope.'
          : step === 6 && !o.buffer
            ? `The comparator’s output goes through ${ohms(o.top)}, with ${ohms(o.bottom)} to ground, to the pulse out jack, with ${LOAD_TEXT[load]} on it.`
            : `The comparator’s output goes through 100k, with 68k to ground, into another of the TL074’s op amps as a buffer, its output wired back to its − input, then through 1k to the pulse out jack${step === 6 ? `, with ${LOAD_TEXT[load]} on it` : ''}.`;
      return `Schematic: the VCO’s sawtooth, after its 1 µF, on the + input of one of a TL074’s op amps with nothing from its output back: a comparator. A 100k pot across +12 V and −12 V has ${offset}.${cv} ${out}`;
    };

    // ---- readouts
    const kv = {
      1: readouts(['the pulse width', 'the square out', 'its middle', 'its average']),
      2: readouts(['the wave', 'after the 1 µF, at first', 'after 0.4 s', 'once settled']),
      3: readouts(['the offset pot', 'the threshold', 'the sawtooth', 'the output', 'a pulse']),
      4: readouts(['the offset pot', 'the threshold', 'the sawtooth', 'the output', 'a pulse']),
      5: readouts(['the offset pot', 'the CV', 'the intensity pot', 'the CV’s share', 'the threshold', 'the pulse', 'through zero']),
      6: readouts(['after the comparator', 'with nothing on it', 'into the load', 'the output impedance', 'the comparator gives', 'into ground']),
      7: readouts(['the sequencer now', 'the LFO', 'the threshold', 'the pulse', 'through zero']),
    };
    for (const r of Object.values(kv)) growOnly(r.el); // they follow the LFO, the sequencer and the controls
    const kvHost = h('div', { class: 'synth-kv' });
    const status = callout();

    // ---- the scopes, and the charts of the width
    const sawLane: ScopeChannel = { label: 'the sawtooth, the threshold dashed: −2 to +2 V', kind: 'analog', min: -2, max: 2, guides: [0], color: '#60a5fa', overlayColor: '#f59e0b' };
    const compLane: ScopeChannel = { label: 'the comparator’s output: −12 to +12 V (±10.5 V dashed)', kind: 'analog', min: -12, max: 12, guides: [-VSAT12, 0, VSAT12], color: '#4ade80' };
    const cvLane: ScopeChannel = { label: 'the CV in: −8 to +8 V (±7 V dashed)', kind: 'analog', min: -8, max: 8, guides: [-PWM.lfo, 0, PWM.lfo], color: '#a78bfa' };
    const jackLane = (label: string): ScopeChannel => ({ label: `${label}: −6 to +6 V (±5 V dashed)`, kind: 'analog', min: -6, max: 6, guides: [-5, 0, 5], color: '#f59e0b' });
    const lanes: Record<Step, ScopeChannel[]> = {
      1: [
        { label: 'the 40106’s output: 0 to 12 V', kind: 'analog', min: 0, max: 12.5, color: '#f59e0b' },
        { label: 'square out, its middle dashed: −10 to +10 V', kind: 'analog', min: -10, max: 10, guides: [-5, 0, 5], color: '#4ade80', overlayColor: '#f472b6' },
      ],
      2: [
        { label: 'the wave: −6 to +13 V (0 V dashed)', kind: 'analog', min: -6, max: 13, guides: [0], color: '#60a5fa' },
        { label: 'after the 1 µF, each middle dashed: −8 to +13 V', kind: 'analog', min: -8, max: 13, guides: [0], color: '#4ade80', overlayColor: '#f472b6' },
      ],
      3: [sawLane, compLane],
      4: [sawLane, compLane],
      5: [cvLane, sawLane, compLane],
      6: [compLane, jackLane('the jack, into the load')],
      7: [cvLane, sawLane, jackLane('pulse out')],
    };
    const scopes = {} as Record<Step, Scope>;
    for (const k of [1, 2, 3, 4, 5, 6, 7] as const) scopes[k] = new Scope(lanes[k], { width: 640, laneHeight: 70 });
    const scopeHost = h('div');
    const scopeNote = h('p', { class: 'note' });
    const pctLane = (label: string): ScopeChannel => ({ label, kind: 'analog', min: -3, max: 103, guides: [0, 50, 100], color: '#f59e0b', overlayColor: '#60a5fa' });
    const chartTurn = new Scope([pctLane('pulse width over the offset pot’s turn: 0 to 100%')], { width: 640, laneHeight: 80 });
    const chartLfo = new Scope([pctLane('pulse width over one cycle of the LFO: 0 to 100%')], { width: 640, laneHeight: 80 });
    const chartCv = new Scope([pctLane('pulse width over the CV, −7 to +7 V: 0 to 100%')], { width: 640, laneHeight: 80 });
    const chartHead = h('h3', { class: 'sub-head' }, 'Pulse width');
    const chartNote = h('p', { class: 'note' });
    const chartHost = h('div');
    const chartBox = h('div', null, chartHead, chartHost, chartNote);
    const scopePanel = panel('Scope', { accent: 'yellow' }, scopeHost, scopeNote, chartBox);

    // ---- sound
    const voice = new PwmTone();
    d.add(() => voice.dispose());
    let voiceKey = '';
    const quiet = () => {
      voice.stop();
      voiceKey = '';
    };
    /** Play a pulse at `hz`, its width `width(v)` with the threshold at v, which is `steady` plus `swing` of the LFO. */
    const play = (hz: number, width: (v: number) => number, wKey: string, steady: number, swing: number, r: number) => {
      if (!listen || !(hz >= 20 && hz <= HEARING)) return quiet();
      const k = `${hz}|${wKey}|${steady}|${swing}|${r}`;
      if (k === voiceKey) return;
      voiceKey = k;
      voice.set(hz, width, `${wKey}|${hz}`, steady, swing, r);
    };
    const widthAt = (hz: number) => (v: number) => comparatorWidth(v, hz);

    // ---- controls
    const wide = (sl: Slider) => {
      sl.el.classList.add('pot-slider');
      return row(sl.el);
    };
    const show = (el: HTMLElement, v: boolean) => (el.style.display = v ? '' : 'none');
    const stepSel = select<`${Step}`>(STEPS, '1', (v) => { step = Number(v) as Step; apply(); }, 'Step');
    const exampleSel = select<Example>(EXAMPLES, example, (v) => { example = v; apply(); }, 'The wave');
    const cvSel = select<CvKind>(CV_KINDS, cvKind, (v) => { cvKind = v; apply(); }, 'Into the CV jack');
    const stageSel = select<OutStage>(STAGES, stage, (v) => { stage = v; apply(); }, 'After the comparator');
    const loadSel = select<Load>(LOADS, load, (v) => { load = v; apply(); }, 'On the jack');
    const widthSlider = new Slider({ label: 'The pulse width', min: 0.5, max: 0.99, value: width1, positions: 490, format: (v) => `${(100 * v).toFixed(1)}%`, onInput: (v) => { width1 = v; update(); } });
    const turnSlider = new Slider({
      label: 'The offset pot',
      min: 0,
      max: 1,
      value: 0.5,
      positions: 1200,
      format: (v) => `${pm(wiperOpen(v))} with nothing on it`,
      onInput: (v) => {
        if (step === 3 || step === 4) turns[step] = v;
        else turns.built = v;
        update();
      },
    });
    const cvSlider = new Slider({ label: 'The CV', min: -PWM.lfo, max: PWM.lfo, value: cvSteady, positions: 280, format: pm, onInput: (v) => { cvSteady = v; update(); } });
    const rateSlider = new Slider({ label: 'The LFO’s rate', min: 0.1, max: 1000, value: rate, log: true, positions: 400, format: fmtHz, onInput: (v) => { rate = v; update(); } });
    const upSlider = new Slider({ label: 'The intensity pot', min: 0, max: 1, value: up, positions: 250, format: (v) => `${ohms((1 - v) * PWM.intensity)}${v >= 1 ? ', all the way up' : v <= 0 ? ', all the way down' : ''}`, onInput: (v) => { up = v; update(); } });
    const preset = (p: (typeof PRESETS)[keyof typeof PRESETS]) => {
      turns.built = p.turn;
      up = p.up;
      rate = p.rate;
      turnSlider.set(turns.built);
      upSlider.set(up);
      rateSlider.set(rate);
      update();
    };
    const slowBtn = new Button({ label: 'A slow LFO', onClick: () => preset(PRESETS.slow) });
    const zeroBtn = new Button({ label: 'Through zero', onClick: () => preset(PRESETS.zero) });
    const audioBtn = new Button({ label: 'Audio rate', onClick: () => preset(PRESETS.audio) });
    const runToggle = new Toggle({ label: 'Sequencer running', value: running, onChange: (v) => { running = v; acc = 0; } });
    const nextBtn = new Button({ label: 'Next note', onClick: () => { pos = (pos + 1) % SEQ.length; acc = 0; update(); } });
    const listenToggle = new Toggle({ label: 'Listen (quietly)', value: listen, onChange: (v) => { listen = v; voiceKey = ''; update(); } });
    const widthRow = wide(widthSlider), turnRow = wide(turnSlider), cvRow = wide(cvSlider), rateRow = wide(rateSlider), upRow = wide(upSlider);

    // ---- drawing
    /** A wave over the scope's window, from one period of it. */
    const win = (wave: readonly number[], hz: number) => Array.from({ length: N }, (_, k) => wave[Math.floor(((((k * WINDOW) / (N - 1)) * hz) % 1) * wave.length) % wave.length]);
    /** The comparator over the scope's window from a jump, the LFO going on from where it is now. */
    const sweep = (hz: number, t: Threshold) => {
      const saw = sawAt(hz), base = thresholdOf(t, 0), share = cvShare(t), live = step >= 5;
      const cv: number[] = [], vth: number[] = [], sv: number[] = [], out: number[] = [];
      for (let k = 0; k < N; k++) {
        const time = (k * WINDOW) / (N - 1);
        const c = live ? cvAt(time) : 0, v = base + share * c, w = saw[Math.floor(((time * hz) % 1) * PERIOD_N) % PERIOD_N];
        cv.push(c);
        vth.push(v);
        sv.push(w);
        out.push(comparator(w, v, VSAT12));
      }
      return { cv, vth, saw: sv, out };
    };
    /** The width over one cycle of the LFO, over the CV from −7 to +7 V, and over the offset pot's turn, in %. */
    const overCycle = (hz: number, t: Threshold) => {
      const base = thresholdOf(t, 0), share = cvShare(t);
      return Array.from({ length: CHART_N }, (_, k) => 100 * comparatorWidth(base + share * PWM.lfo * triangle(k / (CHART_N - 1)), hz));
    };
    const overCv = (hz: number, t: Threshold) => Array.from({ length: CHART_N }, (_, k) => 100 * comparatorWidth(thresholdOf(t, -PWM.lfo + (2 * PWM.lfo * k) / (CHART_N - 1)), hz));
    const overTurn = (hz: number, t: Threshold) => Array.from({ length: CHART_N }, (_, k) => 100 * comparatorWidth(thresholdOf({ ...t, turn: k / (CHART_N - 1) }), hz));
    /** Worked out again only when what they depend on changes. */
    let chartKey = '', chartData: number[] = [];
    const chartOf = (key: string, f: () => number[]) => (key === chartKey ? chartData : ((chartKey = key), (chartData = f())));
    /** The LFO moving the threshold within each period (`comparatorPeriods`), worked out once for each note and setting. */
    const periods = new Map<string, Periods>();
    /** What the readouts say of the pulse over the LFO's cycle, and the cycle chart's name. */
    const cycleText = (hz: number, t: Threshold) => {
      const base = thresholdOf(t, 0), swing = PWM.lfo * cvShare(t), held = heldStill(base, swing, hz), past = held.low + held.high;
      const label = `Chart: the pulse width over one cycle of the LFO, the threshold held still at each point: ${part(held.lo)} to ${part(held.hi)}${past > 0 ? `, no pulse for ${part(past)} of it` : ''}.`;
      // the threshold slow enough to cross the sawtooth once a period, as it falls: held still says it exactly
      if (crossesOnce(4 * swing * rate, hz))
        return {
          label,
          range: `${part(held.lo)} to ${part(held.hi)} over the LFO’s cycle`,
          zero: past > 0 ? `yes: no pulse for ${part(past)} of each cycle, the output stuck ${held.low > 0 && held.high > 0 ? 'low at one end, high at the other' : held.low > 0 ? 'low' : 'high'}` : `no: ${part(held.lo)} at its narrowest, ${part(held.hi)} at its widest`,
        };
      // faster: the threshold moves within each period, and may cross the sawtooth more than once
      const key = `${hz}|${base}|${swing}|${rate}`;
      let p = periods.get(key);
      if (!p) {
        if (periods.size >= 32) periods.clear();
        periods.set(key, (p = comparatorPeriods(base, swing, hz, rate)));
      }
      const none = p.low + p.high;
      return {
        label,
        range: `${part(p.lo) === part(p.hi) ? part(p.lo) : `${part(p.lo)} to ${part(p.hi)}`} of each period, the LFO moving the threshold within it${p.more >= 1 ? '; more than one pulse in every period' : p.more > 0 ? `; more than one pulse in ${part(p.more)} of the periods` : ''}`,
        zero:
          none > 0
            ? `yes: no pulse in ${part(none)} of the periods, the output stuck ${p.low > 0 && p.high > 0 ? 'low in some, high in others' : p.low > 0 ? 'low' : 'high'}`
            : `no: every period has a pulse${past > 0 ? `, though the threshold is past the sawtooth ${part(past)} of the time` : ''}`,
      };
    };
    /** The offset pot's wiper with the threshold at `vth`: loaded through what follows it, and with nothing on it where that differs. */
    const wiperText = (t: Threshold, vth: number) => {
      const open = wiperOpen(t.turn), r = t.turn * (1 - t.turn) * PWM.pot;
      const loaded = r > 0 ? open - (r * (open - vth)) / (r + t.rOffset) : open;
      return `${pm(loaded)} on its wiper${pm(loaded) !== pm(open) ? ` (${pm(open)} with nothing on it)` : ''}`;
    };
    /** A chart's name, set only when it changes. */
    const nameChart = (chart: Scope, text: string) => {
      if (chart.canvas.getAttribute('aria-label') !== text) chart.canvas.setAttribute('aria-label', text);
    };

    /** Everything that follows the circuit: the schematic's words, the readouts, the scope, the chart and the sound. */
    const update = () => {
      (step <= 2 ? schA : schB).el.setAttribute('aria-label', schematicLabel());
      if (step === 1) return updateOld();
      if (step === 2) return updateDrift();
      const t = th(), hz = hzNow(), saw = sawAt(hz), top = saw[0], bottom = top - JUMP;
      const sw = sweep(hz, t), base = thresholdOf(t, 0), share = cvShare(t);
      const vNow = sw.vth[0], wNow = comparatorWidth(vNow, hz), wiperV = wiperOpen(t.turn);
      const slowLfo = lfoOn() && rate <= 5;
      setText(srcB2, `${step === 7 ? SEQ[pos] : 'C3'}, after its 1 µF`);
      const overlays = step >= 5 ? [undefined, clampTo(sw.vth, -2, 2)] : [clampTo(sw.vth, -2, 2)];
      if (step === 3 || step === 4) {
        const sp = pulseSpan(t);
        kv[step].set('the offset pot', `${pct(t.turn)} of its turn: ${wiperText(t, vNow)}`);
        kv[step].set('the threshold', pm(vNow));
        kv[step].set('the sawtooth', `${span(top, bottom)}, at C3`);
        kv[step].set('the output', widthText(wNow));
        kv[step].set('a pulse', `with the pot from ${pct(sp.from)} to ${pct(sp.to)} of its turn: ${pct(sp.share)} of it`);
        scopes[step].draw([sw.saw, sw.out], { window: N, overlays });
        const curve = chartOf(`t|${step}|${JSON.stringify({ ...t, turn: 0 })}`, () => overTurn(hz, t));
        chartTurn.draw([curve], { window: CHART_N, overlays: step === 4 ? [overTurn(hz, JUMPER)] : [], markers: [{ at: t.turn * (CHART_N - 1), dashed: true }] });
        play(hz, widthAt(hz), 'c', vNow, 0, 0);
        return;
      }
      // the built circuit: the CV, the chart over the LFO's cycle (or the CV), and the output stage
      const swing = lfoOn() ? PWM.lfo * share : 0, steady = lfoOn() ? base : base + share * cvAt(0);
      const lfoText = `±7 V at ${fmtHz(rate)}${slowLfo ? `, now ${pm(sw.cv[0])}` : ''}`;
      const of = offsetFeed(t), gSum = 1 / of.r + 1 / t.rGround + 1 / (t.rCv ?? Infinity);
      const offsetAt = of.v / of.r / gSum;
      if (step === 5) {
        const cyc = lfoOn() ? cycleText(hz, t) : null;
        // the wiper moves with the threshold: read it as it is now unless the LFO is too quick to follow
        kv[5].set('the offset pot', `${lfoOn() && !slowLfo ? `${pm(wiperV)} on its wiper with nothing on it` : wiperText(t, vNow)}: ${pm(offsetAt)} of the threshold`);
        kv[5].set('the CV', lfoOn() ? `an LFO, ${lfoText}` : pm(cvSteady));
        kv[5].set('the intensity pot', `${ohms(intensity())}: the CV through ${ohms(t.rCv ?? 0)} in all`);
        kv[5].set('the CV’s share', `${share.toFixed(3)} of it: ${pm(PWM.lfo * share)} for its +7 V`);
        kv[5].set('the threshold', lfoOn() ? `${slowLfo ? `${pm(vNow)} now; ` : ''}${span(base + swing, base - swing)} over the LFO` : pm(vNow));
        kv[5].set('the pulse', cyc ? `${slowLfo ? `${widthText(wNow)} now; ` : ''}${cyc.range}` : widthText(wNow));
        if (cyc) {
          kv[5].set('through zero', cyc.zero);
          nameChart(chartLfo, cyc.label);
        } else {
          const lo = comparatorWidth(thresholdOf(t, PWM.lfo), hz), hi = comparatorWidth(thresholdOf(t, -PWM.lfo), hz);
          kv[5].set('through zero', lo <= 0 || hi >= 1 ? `yes, within ±7 V: the CV can stop the pulse` : `no: ±7 V gives ${part(lo)} to ${part(hi)}`);
          nameChart(chartCv, `Chart: the pulse width over the CV from −7 to +7 V: ${part(hi)} at −7 V, ${part(lo)} at +7 V.`);
        }
        scopes[5].draw([sw.cv, sw.saw, sw.out], { window: N, overlays });
      } else if (step === 6) {
        // a load as heavy as the low-value divider pulls the comparator's swing in (swingInto): with
        // nothing on the jack, and with the load on it as well
        const into = LOAD_R[load], open = outStage(swingInto(outStage(VSAT12, stage).rIn), stage).open;
        const vc = swingInto(outStage(VSAT12, stage, into).rIn), o = outStage(vc, stage, into), loaded = 1 - o.out / open, z = outZ(stage);
        setText(topText, ohms(OUT_STAGES[stage].top));
        setText(botText, ohms(OUT_STAGES[stage].bottom));
        setText(loadText, ohms(into));
        kv[6].set('after the comparator', STAGES.find((x) => x.value === stage)!.label);
        kv[6].set('with nothing on it', `${span(open, -open)}, ${(2 * open).toFixed(1)} V peak to peak`);
        kv[6].set('into the load', `${span(o.out, -o.out)}: ${(100 * loaded).toFixed(1)}% less, into ${LOAD_TEXT[load]}`);
        kv[6].set(
          'the output impedance',
          `${ohms(z)}${OUT_STAGES[stage].buffer ? ': the 1k, the buffer behind it' : z > o.z ? `: the divider’s two halves side by side, ${ohms(o.z)}, with the comparator’s own ${Math.round(TL074_LOADED.r)} Ω behind the ${ohms(OUT_STAGES[stage].top)}` : ': the divider’s two halves side by side'}`,
        );
        kv[6].set('the comparator gives', `${fmtA(o.current)} at its peaks${vc < VSAT12 ? `, reaching only ±${vc.toFixed(2)} V into ${ohms(o.rIn)}` : ''}`);
        kv[6].set('into ground', `${fmtA(o.toGround)} through the ${ohms(OUT_STAGES[stage].bottom)}`);
        const out = sw.out.map((v) => (v * vc) / VSAT12);
        scopes[6].draw([out, out.map((v) => outStage(v, stage, into).out)], { window: N });
      } else {
        const cyc = cycleText(hz, t);
        kv[7].set('the sequencer now', `step ${pos + 1} of ${SEQ.length}: ${SEQ[pos]}, ${fmtHz(hz)}`);
        kv[7].set('the LFO', `${lfoText}; the intensity pot at ${ohms(intensity())}, the offset pot’s wiper at ${pm(wiperV)} with nothing on it`);
        kv[7].set('the threshold', `${slowLfo ? `${pm(vNow)} now; ` : ''}${span(base + swing, base - swing)} over the LFO`);
        kv[7].set('the pulse', `${slowLfo ? `${widthText(wNow)} now; ` : ''}${cyc.range}`);
        kv[7].set('through zero', cyc.zero);
        nameChart(chartLfo, cyc.label);
        scopes[7].draw([sw.cv, sw.saw, sw.out.map((v) => outStage(v, 'buffered').out)], { window: N, overlays });
      }
      if (step !== 6) {
        const cycle = lfoOn() ? chartOf(`l|${hz}|${t.turn}|${t.rCv}`, () => overCycle(hz, t)) : chartOf(`v|${hz}|${t.turn}|${t.rCv}`, () => overCv(hz, t));
        const at = lfoOn() ? lfoPh * (CHART_N - 1) : ((cvSteady + PWM.lfo) / (2 * PWM.lfo)) * (CHART_N - 1);
        (lfoOn() ? chartLfo : chartCv).draw([cycle], { window: CHART_N, markers: [{ at, dashed: true }] });
      }
      play(hz, widthAt(hz), 'c', steady, swing, lfoOn() ? rate : 0);
    };

    /** The first step: part 4's pulse, its width set directly, through its AC coupling and divider. */
    const updateOld = () => {
      const bits = Array.from({ length: PERIOD_N }, (_, k) => k < Math.round(width1 * PERIOD_N));
      const sq = squareOut(bits, NOTE), hi = Math.max(...sq), lo = Math.min(...sq), mid = (hi + lo) / 2;
      setText(srcA1, 'part 4’s sawtooth,');
      setText(srcA2, 'amplified, shaped');
      kv[1].set('the pulse width', `high ${(100 * width1).toFixed(1)}% of the time`);
      kv[1].set('the square out', `${span(hi, lo)}, ${(hi - lo).toFixed(1)} V peak to peak`);
      kv[1].set('its middle', `${pm(mid)}${Math.abs(mid) < 0.05 ? ': centred' : ': off centre'}`);
      kv[1].set('its average', `${pm(mean(sq))}, held there by the 1 µF`);
      scopes[1].draw([win(bits.map((v) => (v ? V12 : 0)), NOTE), win(sq, NOTE)], { window: N, overlays: [undefined, Array<number>(N).fill(mid)] });
      play(NOTE, () => width1, `w${width1}`, 0, 0, 0);
    };

    /** The second step: one of his examples from the moment it is connected, and once settled. */
    const updateDrift = () => {
      const e = EX_WAVE[example], n = EX_PERIODS * EX_PER, dt = 1 / EX_HZ / EX_PER;
      const input = Array.from({ length: n }, (_, k) => (k % EX_PER < e.d * EX_PER ? e.hi : e.lo));
      const y = coupledFromRest(input, dt, EX_TAU);
      const mids: number[] = [];
      const ends = (p: readonly number[]) => [Math.max(...p), Math.min(...p)] as const;
      for (let p = 0; p < EX_PERIODS; p++) {
        const [hi, lo] = ends(y.slice(p * EX_PER, (p + 1) * EX_PER));
        for (let k = 0; k < EX_PER; k++) mids.push((hi + lo) / 2);
      }
      // once settled: the same wave run for 5 s, 50 times the 1 µF and 100k's time constant
      const settled = coupledFromRest(Array.from({ length: EX_SETTLE * EX_PER }, (_, k) => input[k % EX_PER]), dt, EX_TAU).slice(-EX_PER);
      const said = (p: readonly number[]) => {
        const [hi, lo] = ends(p);
        return `${span(hi, lo)}, its middle ${pm((hi + lo) / 2)}`;
      };
      setText(srcA1, EX_TEXT[example][0]);
      setText(srcA2, EX_TEXT[example][1]);
      kv[2].set('the wave', `${span(e.hi, e.lo)}, high ${pct(e.d)} of the time: its average ${pm(e.lo + e.d * (e.hi - e.lo))}`);
      kv[2].set('after the 1 µF, at first', said(y.slice(0, EX_PER)));
      kv[2].set('after 0.4 s', said(y.slice(n - EX_PER)));
      kv[2].set('once settled', `${said(settled)}, its average 0 V`);
      scopes[2].draw([input, y], { window: n, overlays: [undefined, mids] });
      quiet();
    };

    /** A new step: its schematic and parts of it, its controls, its readouts, its text, its scope and chart. */
    const apply = () => {
      // the CV path hangs below the mixer from the fifth step, and the output stage reaches right from the sixth
      if (step >= 3) frame(schB, step >= 6 ? 690 : 480, step >= 5 ? 278 : 214);
      schHost.show(step <= 2 ? schA : schB);
      gInvA.show(step === 1);
      gWireA.show(step === 2);
      gOutA.show(step === 1);
      gScopeA.show(step === 2);
      g100k.show(step >= 4);
      gJumper.show(step === 3);
      g14k.show(step >= 4);
      gCv.show(step >= 5);
      gScopeB.show(step <= 5);
      gOutB.show(step >= 6);
      const buffered = step === 7 || OUT_STAGES[stage].buffer;
      gBuffer.show(step >= 6 && buffered);
      gBypass.show(step === 6 && !buffered);
      gLoad.show(step === 6);
      if (step === 7) {
        setText(topText, '100k');
        setText(botText, '68k');
      }
      show(widthRow, step === 1);
      show(exampleSel, step === 2);
      show(turnRow, step >= 3 && step !== 6);
      show(cvSel, step === 5);
      show(cvRow, step === 5 && cvKind === 'steady');
      show(rateRow, step === 7 || (step === 5 && cvKind === 'lfo'));
      show(upRow, step === 5 || step === 7);
      show(stageSel, step === 6);
      show(loadSel, step === 6);
      for (const btn of [slowBtn, zeroBtn, audioBtn]) show(btn.el, step === 7);
      show(runToggle.el, step === 7);
      show(nextBtn.el, step === 7);
      turnSlider.set(step === 3 || step === 4 ? turns[step] : turns.built);
      scopeHost.replaceChildren(scopes[step].el);
      setText(scopeNote, SCOPE_NOTES[step]);
      // the chart: over the pot's turn (the third and fourth steps), the LFO's cycle or the CV (the fifth), the LFO's cycle (the last)
      const chart = step <= 4 ? chartTurn : step === 5 && cvKind === 'steady' ? chartCv : chartLfo;
      show(chartBox, step >= 3 && step !== 6);
      chartHost.replaceChildren(chart.el);
      chartKey = '';
      setText(
        chartNote,
        step <= 4
          ? `The pulse width at C3 for each setting of the offset pot, its whole turn from −12 V on the left to +12 V on the right${step === 4 ? ', with the jumper dashed' : ''}; 0, 50 and 100% dashed across, and the pot now a dashed line down. At 0% or 100% there is no pulse.`
          : chart === chartCv
            ? 'The pulse width for each CV from −7 V on the left to +7 V on the right, the CV now a dashed line down. At 0% or 100% there is no pulse.'
            : 'The pulse width over one cycle of the LFO, from 0 V rising: up to +7 V a quarter of the way, down to −7 V at three quarters, the LFO now a dashed line down. At 0% or 100% there is no pulse, the oscillation silenced. It is the width the threshold would set if it held still, as it all but does while the LFO is well below the note; nearer the note the threshold moves within each period, and the readouts give what the periods get.',
      );
      const jumper = pulseSpan(JUMPER), divided = pulseSpan(DIVIDED);
      nameChart(
        chartTurn,
        step === 3
          ? `Chart: the pulse width over the offset pot’s turn. With the jumper there is a pulse over ${pct(jumper.share)} of it, around the middle.`
          : `Chart: the pulse width over the offset pot’s turn. With 100k and 14k there is a pulse over ${pct(divided.share)} of it, from ${pct(divided.from)} to ${pct(divided.to)}; with the jumper, dashed, over ${pct(jumper.share)}, around the middle.`,
      );
      kvHost.replaceChildren(kv[step].el);
      setText(status, STEP_TEXT[step]);
      update();
    };

    // ---- each frame: the sequencer moves on, and the LFO
    d.add(
      animate((ms) => {
        const dt = Math.min(ms, 100) / 1000;
        let changed = false;
        if (step === 7 && running) {
          acc += dt;
          while (acc >= NOTE_S) {
            acc -= NOTE_S;
            pos = (pos + 1) % SEQ.length;
            changed = true;
          }
        }
        if (lfoOn()) {
          // in step with what plays, when it plays
          lfoPh = voice.lfoPhase() ?? (lfoPh + rate * dt) % 1;
          changed = true;
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
          { accent: 'red', chips: 'TL074 (a comparator and a buffer) · 100k ×2 · 68k ×2 · 14k · 1k · a 250k linear pot · two jacks · a 100k pot · part 4’s VCO' },
          row(stepSel, exampleSel, cvSel, stageSel, loadSel, slowBtn.el, zeroBtn.el, audioBtn.el, runToggle.el, nextBtn.el, listenToggle.el),
          widthRow,
          turnRow,
          cvRow,
          rateRow,
          upRow,
          h('div', { class: 'synth-circuit' }, schHost.el, kvHost),
          status,
        ),
        scopePanel,
        notes(),
      ),
    );
    apply();
    return d.dispose;
  },
});

function notes(): HTMLElement {
  const patched = pulseSpan(pwmBuilt(0.5, 0)), jumper = pulseSpan(JUMPER), divided = pulseSpan(DIVIDED);
  // where the bare divider, its wiper with no resistance of its own, would put the pulse's ends
  const ideal = (v: number) => ((v * (PWM.offset + PWM.ground)) / PWM.ground + V12) / (2 * V12);
  // the pot's own resistance at its wiper where the pulse stops, at either end: its two parts side by side
  const [edgeLo, edgeHi] = [divided.to, divided.from].map((x) => Math.round((x * (1 - x) * PWM.pot) / 1e3)).sort((a, b) => a - b);
  // the comparator's swing as each stage loads it (swingInto), and what the stage does with it
  const swingOf = (stage: OutStage, load = Infinity) => swingInto(outStage(VSAT12, stage, load).rIn);
  /** How much of its level `stage` loses into a module's 100k, against what it gives with nothing on it. */
  const loss = (stage: OutStage) => 1 - outStage(swingOf(stage, 100e3), stage, 100e3).out / outStage(swingOf(stage), stage).open;
  const low = outStage(swingOf('low'), 'low'), lowFull = outStage(V12, 'low');
  const full = outStage(V12, 'buffered').open, ours = outStage(VSAT12, 'buffered').open;
  // the "Through zero" preset's gap at C3: how long the LFO holds the threshold below the sawtooth's bottom
  const z = pwmBuilt(PRESETS.zero.turn, 0), zSwing = PWM.lfo * cvShare(z), gap = (C3_TOP - JUMP - thresholdOf(z, 0) + zSwing) / (2 * zSwing);
  return panel(
    'From the video',
    { accent: 'gray' },
    note('His VCO lacked one thing he wanted: voltage control of the pulse’s width. After a short demo, the video adds it, and first fixes a bug that anyone who built the VCO may have seen on a scope.'),
    note('Why about −4.5 V: part 4’s 40106 puts out 0 or 12 V, an offset of +6 V. The 1 µF can only keep the wave’s average at 0 V: a pulse high a fraction d of the time comes out with its high part at 12 (1 − d) V and its low part at −12 d V, and the 20k and 100k take a sixth off. Its middle is (6 − 12 d) V times five sixths: 0 V at 50%, −4.5 V at 95%. In part 4’s model its pot takes the pulse to about 84% before it stops, a middle at about −3.4 V; his evidently goes further.'),
    note('In his water analogy the capacitor is a stretchy membrane that can move a lot of water, and the 100k a thin pipe to ground that lets little through. A step pushes straight through the membrane; while it lasts, water slowly leaks away through the pipe, or back in, which is the droop. The far side settles where as much comes back as leaks away: where the wave’s average is 0 V, which is its middle only if the wave is symmetrical.'),
    note(`The comparator: the op amp amplifies the difference between its inputs so hugely that its output is all but always at a rail, ±12 V as he puts it; a TL074 gets about 1.5 V short of either rail, ±10.5 V here. His graphs lay the sawtooth, several thresholds and the output over each other, the output high whenever the sawtooth is above the threshold. With the core’s sawtooth falling nearly straight from its top (the 1 µF bends it a little), the width is about (top − threshold) ÷ (top − bottom): here ${span(C3_TOP, C3_TOP - JUMP)} at C3, so the bare pot gives a pulse over ${pct(jumper.share)} of its turn.`),
    note(`The divider: 100k and 14k take ±12 V down by 114 ÷ 14, to ±1.47 V, his ±1.5 V or so. The pot’s own resistance adds to the 100k, a quarter of its 100k at the middle and nothing at the ends, so the ±1.47 V stands. This sawtooth runs out short of the ends, though, where the pot still has about ${edgeLo === edgeHi ? edgeLo : `${edgeLo} to ${edgeHi}`}k of its own: here a pulse needs the pot between ${pct(divided.from)} and ${pct(divided.to)} of its turn, ${pct(ideal(C3_TOP - JUMP))} and ${pct(ideal(C3_TOP))} if its wiper had no resistance. Once something is in the CV jack, its 68k (to the CV, 0 V at rest) sits beside the 14k, and the pot then reaches only about ±1.25 V: a pulse over ${pct(patched.share)} of its turn here.`),
    note(`The CV’s share: each input’s share of the mix is its conductance’s share of them all. With the intensity up, the 68k against the 14k, the 100k and the offset pot lets ${SHARE_UP.toFixed(3)} of the CV through, ±${(PWM.lfo * SHARE_UP).toFixed(2)} V of the LFO’s ±7 V; with the intensity pot at 250k, ±${(PWM.lfo * cvShare(pwmBuilt(0.5, PWM.intensity))).toFixed(2)} V. He picked 68k by trial and error rather than working it out. On his scope, the intensity turned up, it goes through zero. Here, the offset pot centred, it stops just short, at ${pct(comparatorWidth(PWM.lfo * SHARE_UP, NOTE))} and ${pct(comparatorWidth(-PWM.lfo * SHARE_UP, NOTE))} (his larger sawtooth would stop further short), and a little off centre it goes through.`),
    note(`Output impedances, into a module’s 100k input: 100k and 68k alone (${ohms(outZ('divider'))} behind them) lose ${pct(loss('divider'))} of the level; 1k and 680 Ω take ${fmtA(low.current)} from the comparator, a load so heavy that its swing comes in to ±${swingOf('low').toFixed(2)} V (TI’s typical curve of the TL074’s swing against its load), and with its own ${Math.round(TL074_LOADED.r)} Ω behind the 1k, ${ohms(outZ('low'))} stands behind them, not the ${ohms(low.z)} of the two alone: they lose ${(100 * loss('low')).toFixed(1)}%; his buffer and 1k lose ${pct(loss('buffered'))}, the divider in front taking only ${fmtA(outStage(VSAT12, 'buffered').current)}. He puts the current a divider of smaller resistors would waste at almost 10 mA; 1k and 680 Ω, the buffer’s divider a hundred times smaller and the lab’s own example, take ${fmtA(low.current)} here, ${fmtA(lowFull.current)} from a full ±12 V. His 100k and 68k turn ±12 V into ±${full.toFixed(2)} V, ${(2 * full).toFixed(1)} V peak to peak; from the TL074’s ±10.5 V, ±${ours.toFixed(2)} V. He also changes the saw out’s 20k to 1k on the schematic, to match.`),
    note('His simulation, linked in the description, is the finished circuit with a ±1.5 V, 300 Hz sawtooth from a generator on the comparator’s + input; the offset pot (“OFFSET”) a little below centre, its wiper at −0.71 V with nothing on it (CircuitJS’s 53% counts from its +12 V end: 47% of the turn as this lab counts it), through 100k, with 14k to ground, on its − input; a CV slider of ±7 V through the intensity pot (“CV INT”, at 1.25k) and 68k; and the output through 100k, with 68k to ground, into a buffer and 1k. Its op amps swing to ±12 V: the buffer puts out ±4.86 V.'),
    note(
      `Estimates here: the sawtooth, the model’s core with TI’s typical thresholds, ${span(C3_TOP, C3_TOP - JUMP)} after the 1 µF at C3, where his scope shows about ±1.5 V; the TL074’s swing, 1.5 V short of the rails for both op amps, and less into a load as heavy as the low-value divider (TI’s typical curve of its swing against its load, as if ${TL074_LOADED.short.toFixed(2)} V short of the rails behind ${Math.round(TL074_LOADED.r)} Ω); the offset pot, a 100k as he says, presumably part 4’s pulse-width pot (his parts list has none); the 40106’s pulse width in the first step, set directly; his three examples at 40 Hz, ±5 V and 7 V up (he gives the first as ±5 V and the others only a positive offset); the LFO, a triangle (his LFO’s wave isn’t said) without a resistance of its own; 100k and 68k alone (his divider without his buffer) and the low-value divider, the lab’s own comparisons, and the loads; the note, C3, until the last step; the sequence, the lab’s own (part 4’s), its notes as tuned; and his three sounds’ settings, which he doesn’t give: the slow LFO at ${PRESETS.slow.rate} Hz with the intensity pot at ${ohms((1 - PRESETS.slow.up) * PWM.intensity)}; through zero at ${PRESETS.zero.rate} Hz, the intensity up and the offset pot a quarter of the way up, for no pulse over ${pct(gap)} of each cycle at C3; and the audio-rate oscillator, a triangle at ${AUDIO_RATE} Hz. Listen plays the pulse the scope shows, a sawtooth less a copy of it delayed by the width; with no pulse it is quiet, as in the second step.`,
    ),
  );
}
