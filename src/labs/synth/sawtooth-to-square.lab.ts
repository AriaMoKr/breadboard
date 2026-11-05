import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row, scrollBox, select, type ScopeChannel } from '../../ui/components';
import { Disposer, animate, growOnly, h, s, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { Kit, kitCss } from '../clock/_draw';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import {
  FINE,
  FloatingInput,
  PART3,
  ROOM,
  SAW_AMP,
  TUNING,
  V12,
  VD_PULL,
  VSAT12,
  amplify,
  converter,
  gainOf,
  noteHz,
  noteOf,
  pickupTau,
  potForPulse,
  pulse,
  pulseWidth,
  sawOut,
  sawTop,
  schmittOut,
  shaperIn,
  squareOut,
  thermistor,
  thresholds,
  tune,
  wiper,
  type Extras,
  type Shaper,
  type Temps,
} from './_analog';
import { diode, jack, npnLeft, ntc, pnpLeft, potDivider, railDown, schmitt } from './_draw';
import { HEARING, cents, fmtCv, fmtHz, offText, pitchText, playsText, sMV, sV, schBox, tunerCss, tunerRow } from './_shared';
import { Tone } from './_sound';

const SCOPE_CLASS = 'synth-square';
const FINGER = 32; // °C: a finger warms a transistor towards this, or leaves it at a warmer room's (an estimate, as in parts 2 and 3)
const WARM_TAU = 6; // s: and this fast (an estimate)
const NOTE_S = 1 / 3; // the sequencer moves on three times a second
const PERIOD_N = 512; // readings in one period of a wave
const WINDOW = 0.02; // s: the scope shows 20 ms
const N = 500; // readings across it
const CHART_N = 201; // the pulse-width chart's readings over the pot's turn
const POT = 100e3; // the pulse-width pot, a 100k linear one

/** What 0 V on the jack plays, once tuned: C2. */
const LOW = noteHz('C2');
const cvOf = (name: string) => Math.log2(noteHz(name) / LOW);
/** Part 3's last sequence, an arpeggio in C major over two octaves: the lab's own. */
const SEQ = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'G4'];
/** The note the VCO plays while the pulse is worked out (the third to fifth steps): the lab's choice. */
const NOTE = noteHz('C3');
const { vp: VP12, vn: VN12 } = thresholds(V12);
/** TI's lowest upper threshold at 25 °C on 12 V, between its 4.6 V at 10 V and 6.8 V at 15 V. */
const VP_LOWEST = 4.6 + ((V12 - 10) / (15 - 10)) * (6.8 - 4.6);
/** Where the illustration's floating input wanders: around the middle of the thresholds. */
const MID = (VP12 + VN12) / 2;

const AT_ROOM: Temps = { pnp: ROOM, npn: ROOM };
/** Part 4's thermistors at `celsius`, and the fine-tune knob's turn (null before there is one). */
const withNtc = (celsius: number, fine: number | null = null): Extras => ({ ntc: celsius, fine });

// ---- numbers the texts quote, from the models

/** How much further the CV gets through its 100k and thermistor for each degree warmer, and how much more each octave needs (V_T's growth), in %. */
const NTC_PER_K = (100 * (thermistor(ROOM) - thermistor(ROOM + 1))) / (TUNING.r + thermistor(ROOM));
const VT_PER_K = 100 / (ROOM + 273.15);

/**
 * The tunings the texts quote: part 3's, exact at 25 °C, then with the thermistors added (where 0 V
 * lands, and how much of an octave a volt plays); retuned with them, and the notes that tell what
 * warmth does there; and retuned with the fine-tune knob halfway, with each knob's whole turn.
 * Worked out when the lab first opens, not with the module: each tuning is some 1,700 runs of the
 * converter, and the build runs every lab's module on every page.
 */
function tunings() {
  const P3 = tune(LOW), T1 = tune(LOW, ROOM, withNtc(ROOM)), T2 = tune(LOW, ROOM, withNtc(ROOM, 0.5));
  const p3With = (cv: number) => converter(cv, P3.turn, TUNING.fixed + P3.trim, AT_ROOM, V12, withNtc(ROOM));
  const knobs = (turn: number, fine: number) => converter(0, turn, TUNING.fixed + T2.trim, AT_ROOM, V12, withNtc(ROOM, fine)).t.hz;
  /** The note with the BC558C's base at 0 V, which both transistors warming together leave alone. */
  const still = noteOf(converter(0, 0, TUNING.fixed + T1.trim, AT_ROOM, V12, withNtc(ROOM)).t.hz).name;
  // where a degree's warmer thermistors stop taking the base down and start lifting it: below that note,
  // since the offset's share grows a little slower than the CV's, the pot's wiper being in its path too
  const base = (cv: number, celsius: number) => converter(cv, T1.turn, TUNING.fixed + T1.trim, AT_ROOM, V12, withNtc(celsius)).vm;
  let lo = 0, hi = cvOf(still);
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (base(mid, ROOM + 1) < base(mid, ROOM)) lo = mid;
    else hi = mid;
  }
  return {
    P3,
    T1,
    T2,
    OUT0: cents(p3With(0).t.hz, LOW),
    OUT_OCT: Math.log2(p3With(1).t.hz / p3With(0).t.hz),
    STILL: still,
    DOWN: noteOf(LOW * 2 ** lo).name,
    FINE_OCT: Math.log2(knobs(T2.turn, 0) / knobs(T2.turn, 1)),
    COARSE_OCT: Math.log2(knobs(0, 0.5) / knobs(1, 0.5)),
  };
}
type Tunings = ReturnType<typeof tunings>;
let worked: Tunings | undefined;

/** Where the sawtooth is picked up: with part 2's two 10k to the jack still on it (the third to fifth steps), then without. */
const TAU_DIV = pickupTau(true), TAU = pickupTau(false);
/** The sawtooth's top after the 1 µF at C3, and at C1, where it droops more. */
const PEAK = sawTop(1 / NOTE, TAU_DIV);
const PEAK_C1 = sawTop(1 / noteHz('C1'), TAU_DIV);
/** The gain a pulse needs, and the most the pot can be for it: with the 100k, the 200k, both with TI's lowest threshold, and those at C1. */
const G_MIN = (VP12 + VD_PULL) / PEAK;
const R100 = potForPulse(100e3, PEAK), R200 = potForPulse(200e3, PEAK);
const R100_LOW = potForPulse(100e3, PEAK, VP_LOWEST), R200_LOW = potForPulse(200e3, PEAK, VP_LOWEST);
const R100_C1 = potForPulse(100e3, PEAK_C1, VP_LOWEST), R200_C1 = potForPulse(200e3, PEAK_C1, VP_LOWEST);
/** The upper threshold a gain of 3 (the 200k against the whole 100k) would need. */
const VP_WHOLE = 3 * PEAK - VD_PULL;

// ---- formatting

const kOhm = (r: number) => (r >= 1e3 ? `${(r / 1e3).toFixed(1)}k` : `${Math.round(r)} Ω`);
const pct = (x: number) => `${Math.round(100 * x)}%`;
/** Volts with a sign, to a hundredth. */
const pm = (v: number) => `${v >= 0.005 ? '+' : v <= -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)} V`;
const span = (top: number, bottom: number) => `${pm(top)} to ${pm(bottom)}`;
const gainText = (g: number) => (Number.isFinite(g) ? `${g.toFixed(2)} times` : 'no end (the op amp alone, a comparator)');
const tempText = (t: number, finger: boolean) => `${t.toFixed(1)} °C${finger ? ', fingers on them' : ''}`;

const CSS = `
.${SCOPE_CLASS} .synth-circuit { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; }
.${SCOPE_CLASS} .synth-sch { flex: 1 1 440px; min-width: 0; }
.${SCOPE_CLASS} .synth-kv { flex: 1 1 220px; }
.${SCOPE_CLASS} .schmitt-sign, .${SCOPE_CLASS} .ntc-mark { stroke-width: 1.5; }
.${SCOPE_CLASS} .kv dd { font-variant-numeric: tabular-nums; }
.${SCOPE_CLASS} .pot-slider { display: flex; width: 100%; }
.${SCOPE_CLASS} .pot-slider input { flex: 1 1 auto; width: auto; min-width: 0; }
${tunerCss(SCOPE_CLASS)}`;

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type ShapeStep = 3 | 4 | 5 | 6;
const STEPS: { value: `${Step}`; label: string }[] = [
  { value: '1', label: '1. Thermistors' },
  { value: '2', label: '2. A fine-tune knob' },
  { value: '3', label: '3. An amplifier' },
  { value: '4', label: '4. Sawtooth to pulse' },
  { value: '5', label: '5. A 200k for the 100k' },
  { value: '6', label: '6. 10 V peak to peak' },
];
const SHAPERS: { value: Shaper; label: string }[] = [
  { value: 'pulldown', label: 'the 1N4148 and a 100k pull-down' },
  { value: 'diode', label: 'the 1N4148 alone' },
  { value: 'wire', label: 'a wire' },
];

/** The schematic's words, per step. */
function schematicLabel(step: Step, how: Shaper): string {
  const vco = 'part 3’s VCO: a BC558C emitter follower, its emitter through 1M to +12 V and its collector on −12 V, its emitter on the base of a BC548C draining the core, one Schmitt-trigger inverter of a 40106 with 2.2 nF and a 1N4148, then part 1’s output stage';
  const mixer = (fine: boolean) =>
    `The BC558C’s base is a passive mixer: the coarse tuning pot’s wiper, from ground to −12 V, through 100k and a 10k NTC thermistor; the CV jack through another 100k and 10k NTC thermistor;${fine ? ' the fine-tune pot’s wiper, also from ground to −12 V, through 1M and a third 10k NTC thermistor;' : ''} and 1.5k with a 1k trimmer to ground.`;
  const pickup = `the VCO’s sawtooth after part 1’s buffer and 1 µF, with 100k to ground${step <= 5 ? ' and part 2’s two 10k to the jack beside it' : ''}`;
  const amp = `another of the TL074’s op amps as a non-inverting amplifier: the sawtooth on its + input, ${step >= 5 ? '200k' : '100k'} from its output to its − input, and a 100k pot from there to ground`;
  const shaper = (w: Shaper) => (w === 'wire' ? 'straight to' : w === 'diode' ? 'through a 1N4148 to' : 'through a 1N4148, with 100k from there to ground, to');
  switch (step) {
    case 1:
      return `Schematic: ${vco}. ${mixer(false)}`;
    case 2:
      return `Schematic: ${vco}. ${mixer(true)}`;
    case 3:
      return `Schematic: ${pickup}, into ${amp}. Its output goes to the scope.`;
    case 4:
    case 5:
      return `Schematic: ${pickup}, into ${amp}. Its output goes ${shaper(step === 4 ? how : 'pulldown')} the input of a second inverter of the 40106 (pin 3), whose output (pin 4) goes to the scope.${step === 4 && how === 'diode' ? ' While the diode blocks, that input is left floating.' : ''}`;
    case 6:
      return `Schematic: ${pickup}, into ${amp}. Its output goes ${shaper('pulldown')} a second inverter of the 40106, whose output goes through 1 µF, with 100k to ground, then 20k, with 100k to ground, to the square out jack. The sawtooth also goes to another of the TL074’s op amps, a non-inverting amplifier with 100k from its output to its − input and 33k from there to ground, to the saw out jack.`;
  }
}

/** What the callout says, per step. */
function stepText(step: Step, tn: Tunings): string {
  switch (step) {
    case 1:
      return `Part 3’s follower cancels most of the drift, but not the scale: V_T, in the exponent, grows about ${VT_PER_K.toFixed(2)}% a degree, so warmth narrows the octaves. A viewer reminded Moritz of thermistors, and he adds NTC ones, which lose resistance as they warm: 10k in series with each of the mixer’s 100k, as René Schmitz has them. Warmer, they let each input a little further through, about ${NTC_PER_K.toFixed(2)}% a degree for the CV’s, about what the scale needs. But they add 10k to each input, so part 3’s tuning is off: 0 V now plays ${(tn.OUT0 / 100).toFixed(1)} semitones above C2, and a volt only ${tn.OUT_OCT.toFixed(2)} of an octave. Retune, then warm or cool the room beside part 3’s circuit, tuned at the same time. Fingers on both transistors warm only them, towards a finger’s ${FINGER} °C: here the thermistors sit away from them, at the room’s temperature.`;
    case 2:
      return `The coarse knob picks 0 to −12 V, which the mixer divides by about 50, Moritz reckons: up to about −240 mV at the BC558C’s base, some ${Math.round(tn.COARSE_OCT)} octaves for its whole turn here. A fine-tune knob takes a smaller share: a second 100k pot, also from ground to −12 V, but through 1M where the others have 100k, dividing by about 500, with a thermistor of its own. Its whole turn is about ${tn.FINE_OCT.toFixed(1)} octaves here, a tenth of the coarse knob’s: easier tuning, and room to detune one VCO a little against another. Tuned here with it halfway, so that it goes either way.`;
    case 3:
      return `For a square, Moritz turns to the 40106’s five spare inverters: making pulses out of a signal is what a Schmitt trigger is for. Its output switches off once its input passes the upper threshold, about 7 V, and on again under the lower one. But after the 1 µF the sawtooth is only about ±1.2 V, so it needs amplifying first, by one of the TL074’s three spare op amps. The sawtooth goes to its + input, and its − input sits on a divider of its own output: 100k down to the pot. With that negative feedback the output rises until the divider’s middle matches the + input, 1 + 100k ÷ the pot times as high. Turn the pot down: the sawtooth grows until it clips, about 1.5 V short of the ±12 V rails, and at 0 Ω it is a square.`;
    case 4:
      return `A wire from the op amp to the inverter would let the sawtooth’s lower half through, below 0 V, which would probably fry the 40106, Moritz says: its inputs have to stay between 0 and 12 V. A 1N4148 pointing at the inverter lets only the upper half through, but while it blocks the input is connected to nothing and picks up noise: 100k pulls it down to 0 V then. Try all three. With the pull-down, the output goes low as each jump passes the upper threshold and high again once the fall gets under the lower one: a pulse, out of phase with the sawtooth, which doesn’t change its sound. Turning the gain down (the pot up from 0 Ω) widens the high part, until past about ${kOhm(R100)} the sawtooth’s top misses the upper threshold and the output stays high: only the first ${pct(R100 / POT)} of the pot’s turn makes a pulse here.`;
    case 5:
      return `Moritz finds the pulse over only the first third of the pot’s turn (here ${pct(R100 / POT)}), the rest useless: the amplifier needs a touch more gain. A bigger resistor from the output to the − input makes the op amp work harder, and by trial and error he settles on 200k for the 100k, doubling the gain above 1. Now it should move evenly from 50 to 100% over one turn, and it seems to work nicely, he finds; here the pulse lasts only to about ${kOhm(R200)}, the first ${pct(R200 / POT)} of the turn (see the notes below). The chart shows both, the 100k dashed.`;
    case 6:
      return `Two problems left, both solved before. The pulse sits between 0 and 12 V: a 1 µF and 100k, as in part 1, centre it on 0 V, ±6 V at 50%. And it’s loud: many modules follow and expect 10 V peak to peak, ±5 V, so 20k and 100k after the 1 µF take a sixth off. The sawtooth, 2.4 V peak to peak, needs the opposite: another of the TL074’s op amps, with 100k and 33k for a gain of about 4 (he says 32k, and puts it right in the description), once part 2’s two 10k are out. A jack for each. At 50% the square sounds round and heavy; turning the pot makes it more and more nasal.`;
  }
}

/** The scope's words, per step. */
const SCOPE_NOTES: Record<ShapeStep, string> = {
  3: '20 ms across, about 2.6 periods of C3, triggered on a jump. The op amp’s limits, about 1.5 V short of the rails, are dashed.',
  4: 'The same 20 ms: the op amp’s output, then the 40106’s input with its thresholds dashed (and 0 V), then its output, high or low.',
  5: 'The same 20 ms, with the 200k.',
  6: '20 ms across at the note the sequencer plays now: each output on its jack, ±5 V dashed.',
};

export default defineLab({
  id: 'sawtooth-to-square',
  title: 'Sawtooth to square',
  summary:
    'Part 4 of Moritz Klein’s DIY VCO: steadier, easier to tune, and a second wave. Three 10k NTC thermistors in the mixer keep a warmer room’s notes together, and a fine-tune knob through 1M takes a tenth of the coarse one’s share. Then a pulse: a spare op amp of the TL074 amplifies the sawtooth, a pot setting its gain, and a diode with a pull-down feeds it to a spare 40106 inverter, the pot setting the pulse’s width. A 200k widens the pot’s range, and both waves come out at 10 V peak to peak. Each step has its schematic, a tuner or a scope, and sound.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE_CLASS });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE_CLASS) + CSS));
    const tn = (worked ??= tunings());
    const { P3, T2 } = tn;

    let step: Step = 1, listen = false, running = true, fingers = false, how: Shaper = 'pulldown';
    let hear: 'square' | 'saw' = 'square';
    /** The room, and the transistors, which follow it or a finger. */
    let room = ROOM, tT = ROOM;
    /** The sequencer's step, and the time towards its next. */
    let pos = 0, acc = 0;
    /** When the first step's VCO was last tuned (by the button or by hand), and whether it has been, since it starts on part 3's tuning. */
    let tunedAt = ROOM, retuned = false;
    /** The coarse knob's turn and the trimmer, in the first two steps; the fine knob's turn; the pulse-width pot in each later step. */
    const coarse: Record<1 | 2, number> = { 1: P3.turn, 2: T2.turn };
    const trims: Record<1 | 2, number> = { 1: P3.trim, 2: T2.trim };
    let fine = 0.5;
    const pw: Record<ShapeStep, number> = { 3: 50e3, 4: 10e3, 5: 20e3, 6: 0 };
    const floating = new FloatingInput(4, 1.5, 1);

    /** Part 3's circuit tuned at `at`, for the first step's comparison: worked out again only when that changes. */
    let p3Cache = { at: ROOM, t: P3 };
    const p3At = (at: number) => (p3Cache.at === at ? p3Cache.t : (p3Cache = { at, t: tune(LOW, at) }).t);
    const temps = (): Temps => ({ pnp: tT, npn: tT });
    /** The converter with `cv` on the jack, as the first or second step has it. */
    const play = (cv: number) =>
      step === 1
        ? converter(cv, coarse[1], TUNING.fixed + trims[1], temps(), V12, withNtc(room))
        : converter(cv, coarse[2], TUNING.fixed + trims[2], AT_ROOM, V12, withNtc(ROOM, fine));
    const part3 = (cv: number) => {
      const t = retuned ? p3At(tunedAt) : P3;
      return converter(cv, t.turn, TUNING.fixed + t.trim, temps(), V12, PART3);
    };

    // ---- schematic A (the first two steps): part 3's VCO, the thermistors and the fine-tune knob in its mixer
    const dcA = new Circuit();
    const schA = new Schematic(dcA, { width: 690, height: 370, label: 'Schematic' });
    const a = new Kit(schA, dcA);

    // the coarse knob, from ground to −12 V, through 100k and a thermistor into the mixer's bus at x = 200
    const cp = potDivider(a, 60, 100);
    a.ana('plain', cp.top, [60, 72]);
    a.vcc(60, 72, '−12 V');
    a.ana('plain', cp.bottom, [60, 126]);
    a.ground(60, 126);
    a.text('100k', [48, 94], { anchor: 'end', size: 11 });
    a.text('coarse', [48, 107], { anchor: 'end', size: 11 });
    a.ana('ana', cp.wiper, [95, 100]);
    a.resistor(110, 100, 'h', '100k', 'top');
    a.ana('ana', [125, 100], [140, 100]);
    ntc(a, 155, 100, '10k');
    a.ana('ana', [170, 100], [200, 100], [200, 285]);
    // the CV jack, through 100k and a thermistor
    const cvJack = jack(a, 86, 200, 'left', 'CV in (0 to 5 V)');
    a.ana('ana', cvJack.tip, [95, 200]);
    a.resistor(110, 200, 'h', '100k', 'top');
    a.ana('ana', [125, 200], [140, 200]);
    ntc(a, 155, 200, '10k');
    a.ana('ana', [170, 200], [200, 200]);
    a.anaDot('ana', [200, 200]);
    a.ana('plain', cvJack.sleeve, [94, 217], [94, 226]);
    a.ground(94, 226);
    // 1.5k and the 1k trimmer to ground, at the bus's foot
    a.resistor(200, 300, 'v', '1.5k', 'right');
    a.ana('ana', [200, 315], [200, 318]);
    a.pot(200, 333, '1k trimmer', 'right');
    const trimText = a.text('', [212, 348], { anchor: 'start', size: 9, class: 'dim' });
    a.ana('plain', [200, 348], [200, 351]);
    a.ground(200, 351);
    // the second step: the fine-tune knob, also from ground to −12 V, through 1M and a thermistor
    const gFine = a.group(() => {
      const fp = potDivider(a, 60, 285);
      a.ana('plain', fp.top, [60, 262]);
      a.vcc(60, 262, '−12 V');
      a.ana('plain', fp.bottom, [60, 311]);
      a.ground(60, 311);
      a.text('100k', [48, 279], { anchor: 'end', size: 11 });
      a.text('fine', [48, 292], { anchor: 'end', size: 11 });
      a.ana('ana', fp.wiper, [95, 285]);
      a.resistor(110, 285, 'h', '1M', 'top');
      a.ana('ana', [125, 285], [140, 285]);
      ntc(a, 155, 285, '10k');
      a.ana('ana', [170, 285], [200, 285]);
      a.anaDot('ana', [200, 285]);
    });

    // the BC558C follower: its base on the mixer, its emitter through 1M to +12 V, its collector on −12 V
    const pnp = pnpLeft(a, 260, 175);
    a.anaDot('ana', [200, 175]);
    a.ana('ana', [200, 175], pnp.base);
    a.ana('ana', pnp.emitter, [275, 115]);
    a.resistor(275, 100, 'v', '1M', 'left');
    a.ana('plain', [275, 85], [275, 72]);
    a.vcc(275, 72, '+12 V');
    a.anaDot('ana', [275, 130]);
    a.ana('plain', pnp.collector, [275, 212]);
    railDown(a, 275, 212, '−12 V');
    a.text('BC558C', [248, 152], { anchor: 'end', size: 10 });
    const pnpTemp = a.text('', [248, 196], { anchor: 'end', size: 10, class: 'dim' });
    // the BC548C on its emitter, draining the core: part 3's converter and part 1's core, as they were
    const npn = npnLeft(a, 350, 175);
    a.ana('ana', [275, 130], [295, 130], [295, 175], npn.base);
    a.ana('plain', npn.emitter, [365, 200]);
    a.ground(365, 200);
    a.text('BC548C', [340, 158], { anchor: 'end', size: 10 });
    const npnTemp = a.text('', [340, 196], { anchor: 'end', size: 10, class: 'dim' });
    const core = schmitt(a, 430, 130);
    a.ana('ana', [400, 130], core.in);
    a.text('1', [426, 123], { anchor: 'end', size: 9, class: 'faint' });
    a.text('2', [482, 123], { anchor: 'start', size: 9, class: 'faint' });
    a.ana('plain', [445, 117.5], [445, 104]);
    a.text('+12 V', [445, 96], { size: 10, class: 'dim' });
    a.text('14', [450, 111], { anchor: 'start', size: 9, class: 'faint' });
    a.ana('plain', [450, 140], [450, 152]);
    a.ground(450, 152);
    a.text('7', [455, 146], { anchor: 'start', size: 9, class: 'faint' });
    a.text('40106', [492, 150], { anchor: 'start', size: 9, class: 'dim' });
    a.ana('plain', core.out, [512, 130], [512, 75], [487, 75]);
    diode(a, 475, 75, 'left');
    a.text('1N4148', [475, 61], { size: 10 });
    a.ana('ana', [463, 75], [400, 75], [400, 176.5]);
    a.anaDot('ana', [400, 130]);
    a.cap(400, 180, 'v');
    a.text('2.2 nF', [414, 180], { anchor: 'start', size: 11 });
    a.ana('plain', [400, 183.5], [400, 196]);
    a.ground(400, 196);
    a.anaDot('ana', [400, 150]);
    a.ana('ana', [400, 150], [365, 150], npn.collector);
    a.text('its other inputs (3, 5, 9, 11, 13) to ground', [540, 236], { size: 9, class: 'dim' });
    a.anaDot('ana', [400, 75]);
    a.ana('ana', [400, 75], [400, 40], [610, 40], [610, 58]);
    a.block(540, 58, 140, 56);
    a.text('part 1’s output stage:', [610, 72], { size: 9, class: 'dim' });
    a.text('buffer, 1 µF and 100k,', [610, 86], { size: 9, class: 'dim' });
    a.text('two 10k to the jack', [610, 100], { size: 9, class: 'dim' });

    // ---- schematic B (the later steps): the sawtooth amplified, shaped into a pulse, and both brought to the jacks
    const dcB = new Circuit();
    const schB = new Schematic(dcB, { width: 690, height: 368, label: 'Schematic' });
    const b = new Kit(schB, dcB);

    // the VCO up to part 1's buffer, then its 1 µF and 100k: the sawtooth is picked up there
    b.block(10, 62, 104, 46);
    b.text('part 3’s VCO,', [62, 79], { size: 9, class: 'dim' });
    b.text('to its buffer', [62, 93], { size: 9, class: 'dim' });
    b.ana('ana', [114, 85], [146.5, 85]);
    b.cap(150, 85, 'h', '1 µF', 'top');
    b.ana('ana', [153.5, 85], [250, 85]);
    b.anaDot('ana', [185, 85]);
    b.ana('ana', [185, 85], [185, 135]);
    b.resistor(185, 150, 'v', '100k', 'left');
    b.ana('plain', [185, 165], [185, 172]);
    b.ground(185, 172);
    // part 2's two 10k to the jack, until the last step
    const gOld = b.group(() => {
      b.anaDot('ana', [185, 110]);
      b.ana('ana', [185, 110], [140, 110], [140, 190]);
      b.block(90, 190, 110, 40);
      b.text('part 2’s two 10k', [145, 205], { size: 9, class: 'dim' });
      b.text('to the jack', [145, 219], { size: 9, class: 'dim' });
    });
    // the pulse-width amplifier: op amp 2 of the TL074, its gain 1 + Rf ÷ the pot
    const amp = b.comparator(250, 100, '+');
    b.text('5', [244, 78], { anchor: 'end', size: 9, class: 'faint' });
    b.text('6', [245, 125], { anchor: 'end', size: 9, class: 'faint' });
    b.text('7', [300, 93], { anchor: 'start', size: 9, class: 'faint' });
    b.text('TL074', [272, 64], { size: 9, class: 'dim' });
    b.ana('ana', [250, 115], [232, 115], [232, 160], [262, 160]);
    b.resistor(277, 160, 'h');
    const rfText = b.text('100k', [277, 147], { size: 11 });
    b.ana('ana', [292, 160], [310, 160], [310, 100]);
    b.anaDot('ana', [310, 100]);
    b.anaDot('ana', [232, 160]);
    b.ana('ana', [232, 160], [232, 180]);
    b.pot(232, 195, '100k pot', 'right');
    const potText = b.text('', [243, 209], { anchor: 'start', size: 9, class: 'dim' });
    b.ana('plain', [232, 210], [232, 218]);
    b.ground(232, 218);
    b.ana('ana', amp.out, [330, 100]);
    // the third step: its output to the scope
    const outContact = (x: number) =>
      b.group(() => {
        b.ana('ana', [x - 20, 100], [x - 4, 100]);
        b.over.appendChild(s('circle', { cx: x, cy: 100, r: 3.5, class: 'contact' }));
        b.text('to the scope', [x + 8, 100], { anchor: 'start', size: 10, class: 'dim' });
      });
    const gOut3 = outContact(350);
    // the fourth step on: a wire, or the 1N4148, into inverter 2 of the 40106, and the pull-down
    const gWire = b.group(() => b.ana('ana', [330, 100], [354, 100]));
    const gDiode = b.group(() => {
      diode(b, 342, 100, 'right');
      b.text('1N4148', [342, 86], { size: 10 });
    });
    const gInv = b.group(() => {
      b.ana('ana', [354, 100], [400, 100]);
      schmitt(b, 400, 100);
      b.text('3', [396, 93], { anchor: 'end', size: 9, class: 'faint' });
      b.text('4', [452, 93], { anchor: 'start', size: 9, class: 'faint' });
      b.text('40106', [412, 132], { anchor: 'start', size: 9, class: 'dim' });
    });
    const gPull = b.group(() => {
      b.anaDot('ana', [380, 100]);
      b.ana('ana', [380, 100], [380, 135]);
      b.resistor(380, 150, 'v', '100k\npull-down', 'right');
      b.ana('plain', [380, 165], [380, 172]);
      b.ground(380, 172);
    });
    const gFloat = b.group(() => b.text('floating', [380, 120], { size: 9, class: 'faint' }));
    const gOut45 = outContact(470);
    // the last step: the square through 1 µF and 100k, then 20k and 100k, to its jack
    const gSquare = b.group(() => {
      b.ana('ana', [448, 100], [476.5, 100]);
      b.cap(480, 100, 'h', '1 µF', 'top');
      b.ana('ana', [483.5, 100], [520, 100]);
      b.anaDot('ana', [505, 100]);
      b.ana('ana', [505, 100], [505, 135]);
      b.resistor(505, 150, 'v', '100k', 'left');
      b.ana('plain', [505, 165], [505, 172]);
      b.ground(505, 172);
      b.resistor(535, 100, 'h', '20k', 'top');
      b.ana('ana', [550, 100], [600, 100]);
      b.anaDot('ana', [570, 100]);
      b.ana('ana', [570, 100], [570, 135]);
      b.resistor(570, 150, 'v', '100k', 'left');
      b.ana('plain', [570, 165], [570, 172]);
      b.ground(570, 172);
      const j = jack(b, 600, 100, 'right', 'square out');
      b.ana('plain', j.sleeve, [600, 134]);
      b.ground(600, 134);
    });
    // and the sawtooth through op amp 3 of the TL074, 100k and 33k, to its own
    const gSaw = b.group(() => {
      b.anaDot('ana', [205, 85]);
      b.ana('ana', [205, 85], [205, 245], [430, 245]);
      const sa = b.comparator(430, 260, '+');
      b.text('10', [424, 238], { anchor: 'end', size: 9, class: 'faint' });
      b.text('9', [425, 285], { anchor: 'end', size: 9, class: 'faint' });
      b.text('8', [480, 253], { anchor: 'start', size: 9, class: 'faint' });
      b.text('TL074', [455, 229], { size: 9, class: 'dim' });
      b.ana('ana', [430, 275], [412, 275], [412, 305], [442, 305]);
      b.resistor(457, 305, 'h', '100k', 'top');
      b.ana('ana', [472, 305], [490, 305], [490, 260]);
      b.anaDot('ana', [490, 260]);
      b.anaDot('ana', [412, 305]);
      b.resistor(412, 320, 'v', '33k', 'left');
      b.ana('plain', [412, 335], [412, 342]);
      b.ground(412, 342);
      b.ana('ana', sa.out, [540, 260]);
      const j = jack(b, 540, 260, 'right', 'saw out');
      b.ana('plain', j.sleeve, [540, 294]);
      b.ground(540, 294);
    });
    const schHost = schBox();

    // ---- readouts
    const kv = {
      1: readouts(['the room', 'tuned at', 'the transistors', 'the thermistors', 'the sequencer now', 'pitch', 'off the note meant', 'part 3’s circuit would be']),
      2: readouts(['the coarse knob', 'the fine knob', 'the trimmer', 'the sequencer now', 'pitch', 'off the note meant', 'a whole turn']),
      3: readouts(['the pot', 'the gain', 'the note', 'after the 1 µF', 'the op amp’s output']),
      4: readouts(['the pot', 'the gain', 'the op amp’s output', 'the 40106’s input', 'its output', 'a pulse with the pot under']),
      5: readouts(['the pot', 'the gain', 'the 40106’s output', 'a pulse with the pot under', 'with the 100k, it was']),
      6: readouts(['the pot', 'the square out', 'the saw out', 'the sequencer now', 'pitch']),
    };
    for (const r of Object.values(kv)) growOnly(r.el); // they follow the sequencer, the temperatures and the pot
    const kvHost = h('div', { class: 'synth-kv' });
    const status = callout();

    // ---- the tuner (the first two steps), with the arpeggio in the first
    const nowRow = tunerRow('now');
    const seqRows = SEQ.map((meant, k) => {
      const off = h('td'), was = h('td');
      return { tr: h('tr', null, h('td', null, String(k + 1)), h('td', null, fmtCv(cvOf(meant))), h('td', null, meant), off, was), off, was };
    });
    const seqHead = h('h3', { class: 'sub-head' }, 'The sequence');
    const seqTable = scrollBox(
      'The sequence',
      h('table', { class: 'truth-table seq-table' }, h('thead', null, h('tr', null, ['step', 'CV', 'meant', 'off', 'part 3’s'].map((x) => h('th', null, x)))), h('tbody', null, seqRows.map((r) => r.tr))),
    );
    const seqNote = note('“off”: how far each note is from the one meant, with the thermistors. “part 3’s”: the same note on part 3’s circuit, without them, tuned at the same time (“tuned at”), in this room now. Both with the transistors as warm as they are.');
    const tunerPanel = panel('The tuner', { accent: 'blue' }, h('div', { class: 'tuner' }, nowRow.el), seqHead, seqTable, seqNote);

    // ---- the scopes (the later steps), and the pulse-width chart (the fifth)
    const opLane: ScopeChannel = { label: 'the op amp’s output, TL074 pin 7: −12 to +12 V', kind: 'analog', min: -12, max: 12, guides: [-VSAT12, 0, VSAT12], color: '#4ade80' };
    const lanes: Record<ShapeStep, ScopeChannel[]> = {
      3: [{ label: 'after the 1 µF: −1.5 to +1.5 V (0 V dashed)', kind: 'analog', min: -1.5, max: 1.5, guides: [0], color: '#60a5fa' }, opLane],
      4: [
        opLane,
        { label: 'the 40106’s input, pin 3: −2 to +12 V (thresholds dashed)', kind: 'analog', min: -2, max: 12, guides: [0, VN12, VP12], color: '#a78bfa' },
        { label: 'its output, pin 4: 0 to 12 V', kind: 'analog', min: 0, max: 12.5, color: '#f59e0b' },
      ],
      5: [],
      6: [
        { label: 'square out: −10 to +10 V (±5 V dashed)', kind: 'analog', min: -10, max: 10, guides: [-5, 5], color: '#f59e0b' },
        { label: 'saw out: −10 to +10 V (±5 V dashed)', kind: 'analog', min: -10, max: 10, guides: [-5, 5], color: '#4ade80' },
      ],
    };
    lanes[5] = lanes[4];
    const scopes = {} as Record<ShapeStep, Scope>;
    for (const k of [3, 4, 5, 6] as const) scopes[k] = new Scope(lanes[k], { width: 640, laneHeight: 70 });
    const scopeHost = h('div');
    const scopeNote = h('p', { class: 'note' });
    const chartOf = (rf: number) => Array.from({ length: CHART_N }, (_, k) => 100 * pulse(NOTE, rf, (k / (CHART_N - 1)) * POT, TAU_DIV, PERIOD_N).width);
    const chart100 = chartOf(100e3), chart200 = chartOf(200e3);
    const chart = new Scope([{ label: 'pulse width, 45 to 100%', kind: 'analog', min: 45, max: 102, guides: [50, 100], color: '#f59e0b', overlayColor: '#60a5fa' }], { width: 640, laneHeight: 80 });
    chart.canvas.setAttribute(
      'aria-label',
      `Chart: the pulse width over the pot’s turn at C3. With the 200k it rises from about ${Math.round(chart200[0])}% at 0 Ω to about ${Math.round(100 * pulse(NOTE, 200e3, R200 - 100, TAU_DIV).width)}% at ${kOhm(R200)}, then the output stays high; with the 100k, the same by ${kOhm(R100)}.`,
    );
    const chartNote = note('The pulse width at C3 for each setting of the pot, its whole turn from 0 Ω on the left to 100k on the right: with the 200k solid, with the 100k dashed, 50% and 100% dashed across, and the pot now a dashed line down. Past the step up to 100%, the sawtooth’s top misses the upper threshold and the output stays high.');
    const scopePanel = panel('Scope', { accent: 'yellow' }, scopeHost, scopeNote, h('div', { class: 'pw-chart' }, h('h3', { class: 'sub-head' }, 'Pulse width over the pot’s turn'), chart.el, chartNote));
    const chartBox = scopePanel.querySelector('.pw-chart') as HTMLElement;

    // ---- sound: a sawtooth at the VCO's pitch (the first two steps), then the waves the scope shows
    const tone = new Tone();
    d.add(() => tone.dispose());
    let toneKey = '';
    const quiet = () => {
      tone.stop();
      toneKey = '';
    };
    const sound = (hz: number, wave?: () => readonly number[], key = '') => {
      if (!listen || !(hz >= 0.1 && hz <= HEARING)) return quiet();
      const k = `${wave ? key : 'saw'}|${hz}`;
      if (k === toneKey) return;
      toneKey = k;
      if (wave) tone.wave(hz, wave());
      else tone.saw(hz);
    };

    // ---- controls
    const stepSel = select<`${Step}`>(STEPS, '1', (v) => { step = Number(v) as Step; apply(); }, 'Step');
    const shaperSel = select<Shaper>(SHAPERS, how, (v) => { how = v; apply(); }, 'From the op amp to the 40106');
    const hearSel = select<'square' | 'saw'>([{ value: 'square', label: 'the square out' }, { value: 'saw', label: 'the saw out' }], hear, (v) => { hear = v; update(); }, 'Listen to');
    const wide = (sl: Slider) => {
      sl.el.classList.add('pot-slider');
      return row(sl.el);
    };
    const roomSlider = new Slider({
      label: 'The room',
      min: 15,
      max: 35,
      value: ROOM,
      positions: 200,
      format: (c) => `${c.toFixed(1)} °C`,
      onInput: (v) => {
        room = v;
        if (!fingers) tT = room;
        update();
      },
    });
    const byHand = () => {
      if (step === 1) {
        tunedAt = room;
        retuned = true;
      }
      update();
    };
    const coarseSlider = new Slider({ label: 'The coarse knob', min: 0, max: V12, value: P3.turn * V12, positions: 12000, format: (v) => sV(-v), onInput: (v) => { coarse[step === 1 ? 1 : 2] = v / V12; byHand(); } });
    const fineSlider = new Slider({ label: 'The fine knob', min: 0, max: V12, value: fine * V12, positions: 1200, format: (v) => sV(-v), onInput: (v) => { fine = v / V12; update(); } });
    const trimSlider = new Slider({ label: 'The trimmer', min: 0, max: TUNING.trimmer, value: P3.trim, positions: 10000, format: (r) => `${(r / 100).toFixed(2)} turns`, onInput: (v) => { trims[step === 1 ? 1 : 2] = v; byHand(); } });
    const pwSlider = new Slider({ label: 'The pot', min: 0, max: POT, value: pw[3], positions: 1000, format: kOhm, onInput: (v) => { pw[step as ShapeStep] = v; update(); } });
    const roomRow = wide(roomSlider), coarseRow = wide(coarseSlider), fineRow = wide(fineSlider), trimRow = wide(trimSlider), pwRow = wide(pwSlider);
    const fingerToggle = new Toggle({ label: 'Fingers on both transistors', value: false, onChange: (v) => { fingers = v; update(); } });
    const runToggle = new Toggle({ label: 'Sequencer running', value: running, onChange: (v) => { running = v; acc = 0; } });
    const nextBtn = new Button({ label: 'Next note', onClick: () => { pos = (pos + 1) % 8; acc = 0; update(); } });
    const retuneBtn = new Button({
      label: 'Retune',
      onClick: () => {
        if (step === 1) {
          const t = tune(LOW, room, withNtc(room));
          coarse[1] = t.turn;
          trims[1] = t.trim;
          tunedAt = room;
          retuned = true;
        } else {
          const t = tune(LOW, ROOM, withNtc(ROOM, fine));
          coarse[2] = t.turn;
          trims[2] = t.trim;
        }
        coarseSlider.set(coarse[step === 1 ? 1 : 2] * V12);
        trimSlider.set(trims[step === 1 ? 1 : 2]);
        update();
      },
    });
    const listenToggle = new Toggle({ label: 'Listen (quietly)', value: listen, onChange: (v) => { listen = v; toneKey = ''; update(); } });

    const sequencerNow = () => `step ${pos + 1} of 8: ${fmtCv(cvOf(SEQ[pos]))}, meant as ${SEQ[pos]}`;

    /** The waves the later steps show, one period of each at `hz`, worked out again on each update. */
    let view = { hz: NOTE, saw: [] as number[], op: [] as number[], input: [] as number[], out: [] as boolean[], width: 0, square: [] as number[], sawOut: [] as number[] };
    const dtW = WINDOW / (N - 1);
    /** A wave over the scope's 20 ms, from one period of it. */
    const win = (wave: readonly number[], hz: number) => Array.from({ length: N }, (_, k) => wave[Math.floor(((k * dtW * hz) % 1) * wave.length) % wave.length]);
    const asVolts = (out: readonly boolean[]) => out.map((v) => (v ? V12 : 0));

    const drawScope = () => {
      const { hz } = view;
      if (step === 3) return scopes[3].draw([win(view.saw, hz), win(view.op, hz)], { window: N });
      if (step === 6) return scopes[6].draw([win(view.square, hz), win(view.sawOut, hz)], { window: N });
      const op = win(view.op, hz);
      if (step === 4 && how === 'diode') {
        // while the diode blocks, the input goes wherever the floating input does
        const input = op.map((v) => shaperIn(v, 'diode', MID + floating.step(dtW)));
        let high = true;
        const out = input.map((v) => ((high = high ? v < VP12 : v <= VN12) ? V12 : 0));
        return scopes[4].draw([op, input, out], { window: N });
      }
      scopes[step as 4 | 5].draw([op, win(view.input, hz), win(asVolts(view.out), hz)], { window: N });
      if (step === 5) {
        const at = (pw[5] / POT) * (CHART_N - 1);
        chart.draw([chart200], { window: CHART_N, overlays: [chart100], markers: [{ at, dashed: true }] });
      }
    };

    /** Everything that follows the circuit: the schematic's words, the readouts, the tuner or the scope, and the sound. */
    const update = () => {
      if (step <= 2) {
        const cv = cvOf(SEQ[pos]), n = play(cv), meant = noteHz(SEQ[pos]);
        nowRow.setLabel(`step ${pos + 1}`);
        nowRow.set(n.t.hz);
        if (step === 1) {
          setText(pnpTemp, `${tT.toFixed(1)} °C`);
          setText(npnTemp, `${tT.toFixed(1)} °C`);
          setText(trimText, `${(trims[1] / 100).toFixed(2)} of 10 turns`);
          kv[1].set('the room', `${room.toFixed(1)} °C`);
          kv[1].set('tuned at', retuned ? `${tunedAt.toFixed(1)} °C` : `${ROOM.toFixed(1)} °C, as part 3, before the thermistors`);
          kv[1].set('the transistors', tempText(tT, fingers));
          kv[1].set('the thermistors', `${kOhm(thermistor(room))} each, at the room’s temperature`);
          kv[1].set('the sequencer now', sequencerNow());
          kv[1].set('pitch', pitchText(n.t));
          kv[1].set('off the note meant', offText(cents(n.t.hz, meant)));
          kv[1].set('part 3’s circuit would be', offText(cents(part3(cv).t.hz, meant)));
          seqRows.forEach((r, k) => {
            const m = noteHz(SEQ[k]), c = cvOf(SEQ[k]);
            setText(r.off, offText(cents(play(c).t.hz, m)));
            setText(r.was, offText(cents(part3(c).t.hz, m)));
            setClass(r.tr, 'current', k === pos);
          });
        } else {
          setText(pnpTemp, `${ROOM.toFixed(1)} °C`);
          setText(npnTemp, `${ROOM.toFixed(1)} °C`);
          setText(trimText, `${(trims[2] / 100).toFixed(2)} of 10 turns`);
          // each knob's wiper, loaded by its path into the mixer, and what it adds there: its path's share of all the mixer's paths to ground, the thermistors at 25 °C
          const rt = thermistor(ROOM), wc = wiper(coarse[2], -V12, TUNING.pot), wf = wiper(fine, -V12, FINE.pot);
          const rCoarse = TUNING.r + rt + wc.r, rFine = FINE.r + rt + wf.r, sum = 1 / rCoarse + 1 / (TUNING.r + rt) + 1 / rFine + 1 / (TUNING.fixed + trims[2]);
          const knob = (w: { v: number; r: number }, r: number) => {
            const loaded = w.v - (w.r * (w.v - n.vm)) / r;
            return `${sV(loaded)} on its wiper${Math.abs(loaded - w.v) > 5e-4 ? ` (${sV(w.v)} with nothing on it)` : ''}, adding ${sMV(w.v / r / sum)} at the mixer`;
          };
          kv[2].set('the coarse knob', knob(wc, rCoarse));
          kv[2].set('the fine knob', knob(wf, rFine));
          kv[2].set('the trimmer', `${Math.round(trims[2])} Ω`);
          kv[2].set('the sequencer now', sequencerNow());
          kv[2].set('pitch', pitchText(n.t));
          kv[2].set('off the note meant', offText(cents(n.t.hz, meant)));
          // each knob's whole turn with the trimmer as it is now: the scale follows the shunt
          const hzAt = (turn: number, f: number) => converter(0, turn, TUNING.fixed + trims[2], AT_ROOM, V12, withNtc(ROOM, f)).t.hz;
          kv[2].set('a whole turn', `the fine knob’s ${Math.log2(hzAt(coarse[2], 0) / hzAt(coarse[2], 1)).toFixed(2)} octaves, the coarse knob’s ${Math.log2(hzAt(0, fine) / hzAt(1, fine)).toFixed(1)}`);
        }
        sound(n.t.hz);
        return;
      }

      const r = pw[step as ShapeStep], rf = step >= 5 ? 200e3 : 100e3, hz = step === 6 ? noteHz(SEQ[pos]) : NOTE;
      const p = pulse(hz, rf, r, step === 6 ? TAU : TAU_DIV, PERIOD_N);
      // a wire: the op amp's output held at the protection diode, the input with it
      const wire = step === 4 && how === 'wire';
      const opOf = (v: number) => (wire ? shaperIn(amplify(v, p.g), 'wire') : amplify(v, p.g));
      const op = wire ? p.op.map((v) => shaperIn(v, 'wire')) : p.op;
      const out = wire ? schmittOut(op, VP12, VN12) : p.out;
      view = { hz, saw: p.saw, op, input: wire ? op : p.input, out, width: pulseWidth(out), square: [], sawOut: [] };
      // the sawtooth's top and bottom, just after its jump and just before it (its readings stop a reading short of
      // the bottom), and the same through each stage after it, none of which turns it upside down
      const top = p.saw[0], bottom = top - (VP12 - VN12);
      const ends = (f: (v: number) => number) => span(f(top), f(bottom));
      setText(potText, `at ${kOhm(r)}`);
      const rfName = `${rf / 1e3}k`;
      setText(rfText, rfName);
      const gain = `${gainText(p.g)}: 1 + ${rfName} ÷ ${kOhm(r)}`;
      const pulseText = view.width >= 1 ? 'it stays high, no pulse' : `high ${pct(view.width)} of the time`;
      const key = `${step}|${how}|${r}`;
      if (step === 3) {
        kv[3].set('the pot', kOhm(r));
        kv[3].set('the gain', gain);
        kv[3].set('the note', `C3, ${fmtHz(hz)}, held there`);
        kv[3].set('after the 1 µF', `${ends((v) => v)}, drooping a little with part 2’s two 10k beside its 100k`);
        kv[3].set('the op amp’s output', `${ends(opOf)}${opOf(top) >= VSAT12 - 1e-9 ? ', clipped' : ''}`);
        sound(hz, () => p.op, key);
      } else if (step === 4) {
        kv[4].set('the pot', kOhm(r));
        kv[4].set('the gain', gain);
        kv[4].set('the op amp’s output', wire ? `${ends(opOf)}: held there by the 40106’s protection diode` : ends(opOf));
        kv[4].set(
          'the 40106’s input',
          how === 'pulldown'
            ? `${ends((v) => shaperIn(opOf(v), 'pulldown'))}: 0 V while the diode blocks`
            : how === 'diode'
              ? 'whatever it picks up while the diode blocks: here a made-up drift and hum'
              : `${ends(opOf)}: below the −0.5 V TI allows, taking as much current as the op amp gives (a TL074H about 26 mA into a short; the 40106 is rated for 10 mA)`,
        );
        kv[4].set('its output', how === 'diode' ? 'whatever the noise makes it' : pulseText);
        kv[4].set('a pulse with the pot under', `${kOhm(R100)}, the first ${pct(R100 / POT)} of its turn (with the diode and pull-down)`);
        if (how === 'diode') quiet();
        else if (view.width >= 1) quiet();
        else sound(hz, () => asVolts(out), key);
      } else if (step === 5) {
        kv[5].set('the pot', kOhm(r));
        kv[5].set('the gain', gain);
        kv[5].set('the 40106’s output', pulseText);
        kv[5].set('a pulse with the pot under', `${kOhm(R200)}, the first ${pct(R200 / POT)} of its turn`);
        kv[5].set('with the 100k, it was', `${kOhm(R100)}, the first ${pct(R100 / POT)}`);
        if (view.width >= 1) quiet();
        else sound(hz, () => asVolts(out), key);
      } else {
        view.square = squareOut(out, hz);
        view.sawOut = sawOut(p.saw);
        const gSaw = gainOf(SAW_AMP.rf, SAW_AMP.rg);
        const pp = (hi: number, lo: number) => `${span(hi, lo)}, ${(hi - lo).toFixed(1)} V peak to peak`;
        kv[6].set('the pot', `${kOhm(r)}: ${pulseText}`);
        kv[6].set('the square out', view.width >= 1 ? '0 V: no pulse to pass' : pp(Math.max(...view.square), Math.min(...view.square)));
        kv[6].set('the saw out', `${pp(amplify(top, gSaw), amplify(bottom, gSaw))}, a gain of ${gSaw.toFixed(2)}`);
        kv[6].set('the sequencer now', sequencerNow());
        kv[6].set('pitch', playsText({ hz, stalled: false }));
        if (hear === 'square' && view.width >= 1) quiet();
        else sound(hz, () => (hear === 'square' ? view.square : view.sawOut), `${key}|${hear}`);
      }
      drawScope();
    };

    /** A new step: its schematic and parts of it, its controls, its readouts, its text, and its tuner or scope. */
    const apply = () => {
      const show = (el: HTMLElement, v: boolean) => (el.style.display = v ? '' : 'none');
      const shape = step >= 3;
      schHost.show(shape ? schB : schA);
      gFine.show(step === 2);
      gOld.show(step <= 5);
      gOut3.show(step === 3);
      gWire.show(step === 4 && how === 'wire');
      gDiode.show(step >= 5 || (step === 4 && how !== 'wire'));
      gInv.show(step >= 4);
      gPull.show(step >= 5 || (step === 4 && how === 'pulldown'));
      gFloat.show(step === 4 && how === 'diode');
      gOut45.show(step === 4 || step === 5);
      gSquare.show(step === 6);
      gSaw.show(step === 6);
      // the saw out's amplifier, below the rest, only in the last step
      schB.el.setAttribute('viewBox', `0 0 690 ${step === 6 ? 368 : 242}`);
      (shape ? schB : schA).el.setAttribute('aria-label', schematicLabel(step, how));
      show(roomRow, step === 1);
      show(coarseRow, step <= 2);
      show(fineRow, step === 2);
      show(trimRow, step <= 2);
      show(pwRow, shape);
      show(fingerToggle.el, step === 1);
      show(retuneBtn.el, step <= 2);
      show(runToggle.el, step <= 2 || step === 6);
      show(nextBtn.el, step <= 2 || step === 6);
      show(shaperSel, step === 4);
      show(hearSel, step === 6);
      show(tunerPanel, !shape);
      show(seqHead, step === 1);
      show(seqTable, step === 1);
      show(seqNote, step === 1);
      show(scopePanel, shape);
      show(chartBox, step === 5);
      if (step <= 2) {
        const k = step as 1 | 2;
        coarseSlider.set(coarse[k] * V12);
        trimSlider.set(trims[k]);
        fineSlider.set(fine * V12);
      } else {
        const k = step as ShapeStep;
        pwSlider.set(pw[k]);
        scopeHost.replaceChildren(scopes[k].el);
        setText(scopeNote, SCOPE_NOTES[k]);
        scopes[k].canvas.setAttribute(
          'aria-label',
          k === 3
            ? 'Scope: the sawtooth after the 1 µF, and the op amp’s output, 20 ms across.'
            : k === 6
              ? 'Scope: the square out and the saw out, 20 ms across.'
              : 'Scope: the op amp’s output, the 40106’s input and its output, 20 ms across.',
        );
      }
      // the first step starts cool, the fingers off
      fingers = false;
      fingerToggle.set(false);
      tT = room;
      kvHost.replaceChildren(kv[step].el);
      setText(status, stepText(step, tn));
      update();
    };

    // ---- each frame: the sequencer moves on, the transistors warm or cool, and a floating input wanders
    d.add(
      animate((ms) => {
        const dt = Math.min(ms, 100) / 1000;
        let changed = false;
        if (running && (step <= 2 || step === 6)) {
          acc += dt;
          while (acc >= NOTE_S) {
            acc -= NOTE_S;
            pos = (pos + 1) % 8;
            changed = true;
          }
        }
        if (step === 1) {
          const target = fingers ? Math.max(FINGER, room) : room;
          const t = Math.abs(tT - target) < 0.005 ? target : target + (tT - target) * Math.exp(-dt / WARM_TAU);
          if (t !== tT) {
            tT = t;
            changed = true;
          }
        }
        if (changed) update();
        else if (step === 4 && how === 'diode') {
          // the noise moves on between sweeps as well
          floating.step(dt);
          drawScope();
        }
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'The circuit',
          { accent: 'red', chips: 'three 10k NTC thermistors · a second 100k pot and 1M · two of the TL074’s three spare op amps · the 40106’s second inverter · 1N4148 · a 100k pot · 200k · 100k ×4 · 33k · 20k · 1 µF · two jacks · part 3’s VCO' },
          row(stepSel, shaperSel, hearSel, fingerToggle.el, runToggle.el, nextBtn.el, retuneBtn.el, listenToggle.el),
          roomRow,
          coarseRow,
          fineRow,
          trimRow,
          pwRow,
          h('div', { class: 'synth-circuit' }, schHost.el, kvHost),
          status,
        ),
        tunerPanel,
        scopePanel,
        notes(tn),
      ),
    );
    apply();
    return d.dispose;
  },
});

function notes(tn: Tunings): HTMLElement {
  return panel(
    'From the video',
    { accent: 'gray' },
    note('A viewer reminded Moritz that thermistors could make the VCO steadier still. He admits that the NPN and the PNP reacting alike to warmth was a broad generalisation, points to the Ebers-Moll equation for the real thing, and tries a primitive experiment instead: a finger on both transistors at once. The pitch goes down before it settles, “the PNP wins”, so he deduces that its response needs taming: its base should rise as it warms. NTC thermistors in series with the 100k make the mixer’s ratio depend on the temperature: warmer, they let more through and raise its output, which is how he means to do it.'),
    note(`In the model, both transistors follow the same law, so the follower cancels the drift of their I_S exactly, and what is left is V_T, the scale. With both equally warm, the note at 0 V on the BC558C’s base stays put (here about ${tn.STILL}), those below it go sharp and those above flat: fingers on both raise most of the sequence. A BC558C that warms first would make the pitch dip before it settles, as he hears. The thermistors make up for V_T by scaling each input’s share with the temperature; with the offset on the negative side, that lets the BC558C’s base further down as they warm, not up, for the notes below about ${tn.DOWN}. (From there to ${tn.STILL} it rises a little: the offset’s path has the pot’s wiper in it too, so its share grows a little slower than the CV’s.)`),
    note(`He takes their value from René Schmitz’s VCO, which he says he draws on heavily for this series: 10k with the 100k. They add 10k to each input, so the trimmer has to move, in the model from about ${Math.round(tn.P3.trim)} Ω to about ${Math.round(tn.T1.trim)} Ω. Here they follow the room with the transistors: a finger on the transistors doesn’t reach them.`),
    note('The fine-tune knob: the coarse knob’s 0 to −12 V divided by about 50 is 0 to about −240 mV, a huge range. Through 1M instead of 100k the division is about 500 (the captions give 0 to −4 mV; 12 V over 500 is 24 mV), and a 10k thermistor goes with it, as with the others. Besides tuning, it makes it easier to detune one VCO slightly against others.'),
    note('The op amp, in his water pipes: both inputs are pressure sensors that let no water in, and the output is a pump that pushes out their difference times a huge gain, as far as its supply lets it, which is where it nearly always ends up. Negative feedback calms it. As a buffer, its output on its − input, it rises only until the difference times the gain is what it puts out, a hair under the input: a unity-gain amplifier, an amplifier that doesn’t amplify. Through a divider instead, the output has to work harder: two 100k double the input, and any divider gives a gain above 1, never below, since a divider can only reduce.'),
    note('The pulse is out of phase with the sawtooth, which doesn’t change its sound, and its width depends on the sawtooth’s size: the higher its peak, the later its fall crosses the lower threshold. Too small, and it never crosses the upper one: the output stays on. With a fixed 50% square all he wanted, the amplifier alone would do, its output scaled down.'),
    note(
      `The pot’s range: here a pulse needs a gain of ${G_MIN.toFixed(1)}, which the pot gives up to ${kOhm(R100)} with the 100k (${pct(R100 / POT)} of its turn) and ${kOhm(R200)} with the 200k (${pct(R200 / POT)}). Moritz finds a third, then the whole turn. A 40106 at the bottom of TI’s range, its upper threshold about ${VP_LOWEST.toFixed(1)} V on 12 V, would give ${kOhm(R100_LOW)} and ${kOhm(R200_LOW)}. And while part 2’s two 10k are still on the 1 µF, the sawtooth droops, its top higher the lower the note: ${PEAK.toFixed(2)} V at C3, ${PEAK_C1.toFixed(2)} V at C1. Both together, that 40106 at C1, give ${kOhm(R100_C1)} and ${kOhm(R200_C1)}: his third, then two thirds. The whole turn would need a gain of 3 to be enough, an upper threshold under ${VP_WHOLE.toFixed(1)} V, below TI’s range: the model can’t say how his got there.`,
    ),
    note('Modular levels: many modules follow and expect 10 V peak to peak, a wave between +5 and −5 V. In part 1 a 50% divider was enough to listen with; now the square goes from ±6 V to ±5 V, and the sawtooth from ±1.2 V to about ±4.8 V. Next: getting it off the breadboard and into a module, panel, stripboard and all, with complete schematics on his Patreon.'),
    note(
      `Estimates here: the thermistors’ B value, 3950 K, common for 10k ones (the video gives none); the TL074’s swing on ±12 V, 1.5 V short of either rail as on ±9 V (his scope shows the clipping near the rails, and TI’s newer TL074H gets within about 0.1 V); the 1N4148’s 0.5 V with the 100k after it; the 40106’s protection diode at 0.7 V; its thresholds, TI’s typical ones; the floating input, a made-up drift and mains hum around the middle of the thresholds; the note, C3, from the third step to the fifth; and which of the TL074’s spare op amps each amplifier uses (he says only “one of the remaining”). Only the transistors and the thermistors warm here, the thermistors with the room alone, out of a finger’s reach (the video doesn’t say where they sit): the 40106, the capacitors and the other resistors don’t. The fingers’ ${FINGER} °C and ${WARM_TAU} s are made up, as in parts 2 and 3, the sequence is the lab’s own, and the core’s jump is taken as instant. Listen plays the browser’s sawtooth in the first two steps, then the waves the scope shows; with the 1N4148 alone it stays quiet, since that noise is made up.`,
    ),
  );
}
