import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row, select, type ScopeChannel } from '../../ui/components';
import { Disposer, animate, growOnly, h, s, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { rng } from '../dclock/_analog';
import { Kit, kitCss } from '../clock/_draw';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { D1N4148, ROOM, SCOPE_IN, TRI, TRI_BASIC, TRI_BUILT, TRI_SAW, VSAT12, diodePoint, noteHz, rampTop, sawToTriangle, thermalVoltage, type Pull, type TriSetup } from './_analog';
import { diode, railDown } from './_draw';
import { HEARING, fmtHz } from './_shared';
import { Tone, harmonics } from './_sound';

const SCOPE_CLASS = 'synth-triangle';
const PERIOD_N = 512; // readings in one period of a wave
const WINDOW = 0.01; // s: the scope shows 10 ms, two periods at 200 Hz
const SEQ_WINDOW = 0.02; // s: and 20 ms under the sequencer, which goes down to C3
const N = 500; // readings across it
const CLOSE = 50e-6; // s: the close-up of the peak, either side of the jump
const CLOSE_N = 201;
const NOTE_S = 1 / 3; // the sequencer moves on three times a second
const HARMONICS = 12; // how many the chart shows
const FLOOR = -60; // dB: its bottom
const R = TRI.r;
/** His bag's tolerance: 1%. */
const TOL = 0.01;
/** Part 4's arpeggio, in C major over two octaves: the lab's own sequence. */
const SEQ = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'G4'];
const { amp: AMP, hz: HZ } = TRI_SAW;
/** The sawtooth's fall, V a millisecond. */
const SLOPE = (2 * AMP * HZ) / 1e3;

// ---- numbers the texts quote, from the model

const TAU_IN = TRI.c * TRI.rc;
/** Without the buffer: the input's 200k with the inverter's 10k, its − input at 0 V, beside it. */
const TAU_UNBUFFERED = TRI.c * ((TRI.rc * R) / (TRI.rc + R));
/** The step the input's 1 µF leaves at the peak: its top less how far its bottom is below 0 V. */
const bendStep = (hz: number) => 2 * rampTop(1 / hz, TAU_IN, 2 * AMP) - 2 * AMP;
const VD_MA = D1N4148.n * thermalVoltage(ROOM) * Math.log(1e-3 / D1N4148.is);

// ---- formatting

/** Volts with a sign, to a hundredth. */
const pm = (v: number) => `${v >= 0.005 ? '+' : v <= -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)} V`;
const span = (a: number, b: number) => `${pm(a)} to ${pm(b)}`;
const kOhm = (r: number) => `${(r / 1e3).toFixed(2)}k`;
/** A 10k as its value, unless it is exactly that. */
const tenK = (r: number) => (r === R ? '10k' : kOhm(r));
const pct = (x: number) => `${Math.round(100 * x)}%`;
const mA = (i: number) => `${i < -5e-6 ? '−' : i > 5e-6 ? '+' : ''}${Math.abs(i * 1e3).toFixed(2)} mA`;
const dB = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const dbText = (v: number) => (v < FLOOR ? `under −${-FLOOR} dB` : `${v < -0.05 ? '−' : ''}${Math.abs(v).toFixed(0)} dB`);
const nth = (k: number) => `${k}${k === 1 ? 'st' : k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'}`;
/** The step at the peak, in words. */
const stepText = (step: number) => (Math.abs(step) < 0.0005 ? 'none' : `${Math.abs(step).toFixed(3)} V ${step > 0 ? 'up' : 'down'} as the sawtooth jumps`);

const CSS = `
.${SCOPE_CLASS} .synth-circuit { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; }
.${SCOPE_CLASS} .synth-circuit .schematic { flex: 1 1 440px; min-width: 0; }
.${SCOPE_CLASS} .synth-kv { flex: 1 1 220px; }
.${SCOPE_CLASS} .kv dd { font-variant-numeric: tabular-nums; }
.${SCOPE_CLASS} .pot-slider { display: flex; width: 100%; }
.${SCOPE_CLASS} .pot-slider input { flex: 1 1 auto; width: auto; min-width: 0; }
.${SCOPE_CLASS} .harmonics { width: 100%; max-width: 640px; height: auto; display: block; }
.${SCOPE_CLASS} .harmonics .h-grid { stroke: var(--grid); stroke-width: 1; }
.${SCOPE_CLASS} .harmonics .h-text { fill: var(--fg-dim); font-size: 13px; }
.${SCOPE_CLASS} .harmonics .h-bar { fill: var(--ana); }
.${SCOPE_CLASS} .harmonics .h-ref { stroke: var(--fg); stroke-width: 2.5; stroke-dasharray: 6 3; }`;

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const STEPS: { value: `${Step}`; label: string }[] = [
  { value: '1', label: '1. Inverting buffers' },
  { value: '2', label: '2. Spliced triangles' },
  { value: '3', label: '3. A matched pair' },
  { value: '4', label: '4. AC coupling the input' },
  { value: '5', label: '5. AC coupling the output' },
  { value: '6', label: '6. The sound' },
];
type Buffer = 'inverting' | 'follower';
type Input = 'saw' | 'steady';
const PULLS: { value: Pull; label: string }[] = [
  { value: 'none', label: 'nothing' },
  { value: 'ground', label: '20k to ground' },
  { value: 'negative', label: '20k to −12 V' },
];

/** What the callout says, per step. */
const STEP_TEXT: Record<Step, string> = {
  1: 'Moritz’s VCO puts out a sawtooth and a square. For a third wave, a triangle, he starts with an op amp as a buffer the other way round. Part 1’s buffer takes the signal on its + input, its output wired back to its − input, and puts out the same. The inverting buffer has its + input on ground, the signal coming through 10k to its − input, and another 10k from its output back to it. The op amp pushes its output until its − input is where its + input is, at 0 V: then whatever comes in through one 10k has to leave through the other, so 5 V in makes −5 V out. That only works with the two resistors the same value, and within the supply: on ±12 V, a TL074 gets no further than about ±10.5 V. Try a steady voltage, then the sawtooth: it comes out upside down.',
  2: 'Put the sawtooth and its inverted copy on top of each other: they start and end at the same points and cross at 0 V halfway. A triangle is hiding in there, in their upper halves: the sawtooth falling to 0 V, then its copy rising from it. Diodes splice them, since they conduct only one way: a 1N4148 from each op amp’s output to one point lets through whichever is higher and blocks the other. So the converter is just the sawtooth and its inverted copy, each through a diode, with the scope on the point. Take each diode out to see the half it lets through.',
  3: 'On the scope the halves come up at slightly different angles, with a step at the peak. The devil is in the details: the inverting buffer’s two resistors have to be exactly the same, and his bag of 10k says 1%. Each may be up to 1% off, so two picked at random can be 2% apart. For most circuits that’s negligible; here it decides how much of the inverted half there is. With the feedback 10k bigger, the inverter’s copy comes out bigger than the sawtooth, its half of the triangle steeper and taller; smaller, the other way. That adds overtones, which in his opinion is never great. His fix: measure a bunch with a multimeter and use a matched pair. Try two at random, then a matched pair; the close-up shows the peak.',
  4: 'All this needs the sawtooth centred on 0 V. Shift it up and its inverted copy goes down by as much: they cross off the middle, and the peaks differ by twice the shift, not much of a triangle. So the input gets AC coupled, as his modules’ inputs and outputs usually are: 1 µF and 200k, a high-pass that takes out any offset. But the converter draws a fair amount of current, the inverter’s 10k and whichever diode conducts, which would mess with the high-pass, so another of the TL074’s op amps buffers it. Shift the sawtooth, then put the 1 µF, the 200k and the buffer in.',
  5: 'The triangle sits above 0 V, so the output wants AC coupling too: 1 µF with 200k to ground. That gives no output at all. A high-pass needs its capacitor to charge and discharge, current flowing both ways, but the diodes only let it flow one way: the capacitor fills up and stays there. A resistor from the diodes’ point to a lower voltage lets it discharge: 20k. Why not to ground? He answers loosely, and puts it right in the description: a diode only conducts with about 0.6 V across it, so with the point’s lowest voltage at 0 V the diodes turn off before the triangle reaches its valleys, and flatten them. To −12 V, the point can go a fair bit below 0 V, and all of the triangle gets through. Try each.',
  6: 'The finished converter, playing a sequence as in his sound demo: Listen to the triangle, then the sawtooth it comes from. A triangle has only odd harmonics, each falling with the square of its number, a ninth at three times the pitch, where a sawtooth has all of them, each falling with its number: a softer, rounder sound. Set the pair 2% apart and the even ones come up.',
};

/** The scope's words, per step. */
const SCOPE_NOTES: Record<Step, string> = {
  1: '10 ms across, two periods of the sawtooth, from its jump. The op amp’s limits, about 1.5 V short of the ±12 V rails, are dashed.',
  2: 'The same 10 ms: the sawtooth with the inverter’s copy dashed, then the diodes’ point, with 0 V dashed.',
  3: 'The same 10 ms, then a close-up of the peak: 50 µs either side of the jump, the jump dashed.',
  4: 'The same 10 ms: the sawtooth, then what the inverter gets with its output dashed, then the diodes’ point.',
  5: 'The same 10 ms: the diodes’ point, worked out here rather than probed, then the output after the 1 µF and 200k.',
  6: '20 ms across at the note the sequencer plays now: the sawtooth, then the triangle out.',
};

export default defineLab({
  id: 'sawtooth-to-triangle',
  title: 'Sawtooth to triangle',
  summary:
    'Moritz Klein’s quick tip after the VCO series: a third wave from the VCO’s sawtooth. An inverting buffer turns it upside down, and two diodes splice the upper halves of it and its copy into a triangle. Its resistors have to be a matched pair, the input is AC coupled through a buffer so that the sawtooth is centred, and the output needs a 20k to −12 V before its own AC coupling gives anything. Each step has its schematic, a scope and sound, and the last its harmonics.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE_CLASS });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE_CLASS) + CSS));

    let step: Step = 1, listen = false;
    let buffer: Buffer = 'inverting', input: Input = 'saw', steady = 5;
    let d1 = true, d2 = true;
    let rIn = R * (1 - TOL / 2), rFb = R * (1 + TOL / 2);
    let offset = 1, inCap = false;
    let pull: Pull = 'none';
    let running = true, pos = 0, acc = 0, hear: 'triangle' | 'saw' = 'triangle', apart = false;
    const pick = rng(7);

    /** The converter as each step has it. */
    const setup = (): TriSetup => {
      switch (step) {
        case 2:
          return { ...TRI_BASIC, d1, d2 };
        case 3:
          return { ...TRI_BASIC, rIn, rFb };
        case 4:
          return { ...TRI_BASIC, offset, inCap };
        case 5:
          return { ...TRI_BUILT, pull };
        default:
          // 2% apart, the feedback 10k the smaller: its step adds to the input 1 µF's (the other way round, it takes from it)
          return { ...TRI_BUILT, rIn: R * (apart ? 1 + TOL : 1), rFb: R * (apart ? 1 - TOL : 1) };
      }
    };
    /** Worked out once for each setup and pitch: the output's 1 µF takes some finding. */
    const cache = new Map<string, ReturnType<typeof sawToTriangle>>();
    const waves = (t: TriSetup, hz: number) => {
      const key = `${JSON.stringify(t)}|${hz}`;
      let r = cache.get(key);
      if (!r) {
        if (cache.size > 64) cache.clear();
        cache.set(key, (r = sawToTriangle(t, hz, PERIOD_N)));
      }
      return r;
    };

    // ---- schematic A (the first step): a buffer, inverting or not
    const dcA = new Circuit();
    const schA = new Schematic(dcA, { width: 400, height: 190, label: 'Schematic' });
    const a = new Kit(schA, dcA);
    a.block(10, 76, 96, 48);
    const srcA1 = a.text('a sawtooth', [58, 92], { size: 10, class: 'dim' });
    const srcA2 = a.text('', [58, 108], { size: 10, class: 'dim' });
    const gInvA = a.group(() => {
      a.ana('ana', [106, 100], [130, 100]);
      a.resistor(145, 100, 'h', '10k', 'top');
      a.ana('ana', [160, 100], [200, 100]);
      a.anaDot('ana', [180, 100]);
      a.comparator(200, 115, '−');
      a.ana('plain', [200, 130], [188, 130], [188, 140]);
      a.ground(188, 140);
      a.ana('ana', [180, 100], [180, 62], [207, 62]);
      a.resistor(222, 62, 'h', '10k', 'top');
      a.ana('ana', [237, 62], [262, 62], [262, 115]);
    });
    const minusA = a.text('', [176, 113], { anchor: 'end', size: 9, class: 'dim' });
    const gFolA = a.group(() => {
      a.ana('ana', [106, 100], [200, 100]);
      a.comparator(200, 115, '+');
      a.ana('ana', [262, 115], [262, 150], [188, 150], [188, 130], [200, 130]);
    });
    a.text('TL074', [222, 158], { size: 9, class: 'dim' });
    a.ana('ana', [245, 115], [296, 115]);
    a.anaDot('ana', [262, 115]);
    a.over.appendChild(s('circle', { cx: 300, cy: 115, r: 3.5, class: 'contact' }));
    a.text('to the scope', [308, 115], { anchor: 'start', size: 10, class: 'dim' });

    // ---- schematic B (the later steps): the converter
    const dcB = new Circuit();
    const schB = new Schematic(dcB, { width: 690, height: 265, label: 'Schematic' });
    const b = new Kit(schB, dcB);
    b.block(10, 66, 100, 48);
    b.text('a sawtooth', [60, 82], { size: 10, class: 'dim' });
    const srcB2 = b.text('', [60, 98], { size: 10, class: 'dim' });
    // the input's 1 µF and 200k, and the buffer: op amp 1 of the TL074
    const gIn = b.group(() => {
      b.ana('ana', [110, 90], [131.5, 90]);
      b.cap(135, 90, 'h', '1 µF', 'top');
      b.ana('ana', [138.5, 90], [175, 90], [175, 75], [190, 75]);
      b.anaDot('ana', [160, 90]);
      b.ana('ana', [160, 90], [160, 110]);
      b.resistor(160, 125, 'v', '200k', 'left');
      b.ana('plain', [160, 140], [160, 146]);
      b.ground(160, 146);
      b.comparator(190, 90, '+');
      b.text('3', [184, 68], { anchor: 'end', size: 9, class: 'faint' });
      b.text('2', [184, 113], { anchor: 'end', size: 9, class: 'faint' });
      b.text('1', [240, 82], { anchor: 'start', size: 9, class: 'faint' });
      b.text('TL074', [212, 58], { size: 9, class: 'dim' });
      b.ana('ana', [235, 90], [270, 90]);
      b.anaDot('ana', [248, 90]);
      b.ana('ana', [248, 90], [248, 122], [180, 122], [180, 105], [190, 105]);
    });
    const gNoIn = b.group(() => b.ana('ana', [110, 90], [270, 90]));
    b.anaDot('ana', [270, 90]);
    // the inverting buffer: op amp 2, its two resistors
    b.ana('ana', [270, 90], [270, 200], [285, 200]);
    b.resistor(300, 200, 'h');
    const rInText = b.text('10k', [300, 187], { size: 11 });
    b.ana('ana', [315, 200], [345, 200]);
    b.anaDot('ana', [330, 200]);
    b.comparator(345, 215, '−');
    b.text('6', [339, 193], { anchor: 'end', size: 9, class: 'faint' });
    b.text('5', [339, 238], { anchor: 'end', size: 9, class: 'faint' });
    b.text('7', [394, 208], { anchor: 'start', size: 9, class: 'faint' });
    b.text('TL074', [367, 250], { size: 9, class: 'dim' });
    b.ana('plain', [345, 230], [330, 230], [330, 238]);
    b.ground(330, 238);
    b.ana('ana', [330, 200], [330, 165], [352, 165]);
    b.resistor(367, 165, 'h');
    const rFbText = b.text('10k', [367, 152], { size: 11 });
    b.ana('ana', [382, 165], [405, 165], [405, 215]);
    b.anaDot('ana', [405, 215]);
    b.ana('ana', [390, 215], [460, 215], [460, 197]);
    b.ana('ana', [270, 90], [460, 90], [460, 103]);
    // the two 1N4148s into the diodes' point
    const gD1 = b.group(() => {
      diode(b, 460, 115, 'down');
      b.text('1N4148', [472, 115], { anchor: 'start', size: 10 });
      b.ana('ana', [460, 127], [460, 150]);
    });
    const gD2 = b.group(() => {
      diode(b, 460, 185, 'up');
      b.text('1N4148', [472, 185], { anchor: 'start', size: 10 });
      b.ana('ana', [460, 173], [460, 150]);
    });
    const gD1Out = b.group(() => b.text('out', [460, 116], { size: 9, class: 'faint' }));
    const gD2Out = b.group(() => b.text('out', [460, 186], { size: 9, class: 'faint' }));
    b.anaDot('ana', [460, 150]);
    // the scope on the point (the second step to the fourth)
    const gProbe = b.group(() => {
      b.ana('ana', [460, 150], [520, 150]);
      b.over.appendChild(s('circle', { cx: 524, cy: 150, r: 3.5, class: 'contact' }));
      b.text('to the scope (1M)', [532, 150], { anchor: 'start', size: 10, class: 'dim' });
    });
    // the output: the 20k, and 1 µF with 200k to ground
    const gOut = b.group(() => {
      b.ana('ana', [460, 150], [526.5, 150]);
      b.cap(530, 150, 'h', '1 µF', 'top');
      b.ana('ana', [533.5, 150], [600, 150]);
      b.anaDot('ana', [560, 150]);
      b.ana('ana', [560, 150], [560, 165]);
      b.resistor(560, 180, 'v', '200k', 'right');
      b.ana('plain', [560, 195], [560, 201]);
      b.ground(560, 201);
      b.over.appendChild(s('circle', { cx: 604, cy: 150, r: 3.5, class: 'contact' }));
      b.text('out, to', [612, 144], { anchor: 'start', size: 10, class: 'dim' });
      b.text('the scope', [612, 157], { anchor: 'start', size: 10, class: 'dim' });
    });
    const gPull = b.group(() => {
      b.anaDot('ana', [490, 150]);
      b.ana('ana', [490, 150], [490, 165]);
      b.resistor(490, 180, 'v', '20k', 'left');
      b.ana('plain', [490, 195], [490, 203]);
    });
    const gPullGround = b.group(() => b.ground(490, 203));
    const gPullNeg = b.group(() => railDown(b, 490, 203, '−12 V'));
    const schHost = h('div', { style: 'display: contents' });

    /** The schematic's words, per step. */
    const schematicLabel = (): string => {
      if (step === 1)
        return buffer === 'inverting'
          ? `Schematic: ${input === 'saw' ? 'a sawtooth' : 'a steady voltage'} through 10k into the − input of one of a TL074’s op amps, its + input on ground, with another 10k from its output back to its − input: an inverting buffer. Its output goes to the scope.`
          : `Schematic: ${input === 'saw' ? 'a sawtooth' : 'a steady voltage'} into the + input of one of a TL074’s op amps, its output wired back to its − input: a buffer, as in part 1. Its output goes to the scope.`;
      const t = setup();
      const source = t.inCap ? 'A sawtooth through 1 µF, with 200k to ground, into the + input of op amp 1 of a TL074 (pin 3), its output (pin 1) wired back to its − input (pin 2): a buffer. Its output' : 'A sawtooth';
      const diodes = t.d1 && t.d2 ? 'A 1N4148 goes from each op amp’s output to one point.' : t.d1 ? 'A 1N4148 goes from the sawtooth to a point; the inverter’s is out.' : t.d2 ? 'A 1N4148 goes from the inverter’s output to a point; the sawtooth’s is out.' : 'Both 1N4148s are out.';
      const after = !t.outCap
        ? 'The scope is on that point.'
        : `${t.pull === 'none' ? '' : `20k goes from that point to ${t.pull === 'ground' ? 'ground' : '−12 V'}. `}From the point, 1 µF with 200k to ground after it goes to the output.`;
      return `Schematic: ${source} goes through ${tenK(t.rIn)} into the − input of op amp 2 (pin 6), its + input (pin 5) on ground, with ${tenK(t.rFb)} from its output (pin 7) back to its − input: the inverting buffer. ${diodes} ${after}`;
    };

    // ---- readouts
    const kv = {
      1: readouts(['the input', 'the − input', 'the current', 'the output']),
      2: readouts(['the diodes', 'the diodes’ point', 'a diode’s drop']),
      3: readouts(['the input 10k', 'the feedback 10k', 'the inverter’s gain', 'the halves', 'the step at the peak']),
      4: readouts(['the sawtooth', 'the inverter gets', 'they cross', 'the step at the peak']),
      5: readouts(['from the diodes’ point', 'the output’s 1 µF', 'the output', 'its valleys']),
      6: readouts(['the sequencer now', 'the output', 'the step at the peak', 'the 10k pair']),
    };
    for (const r of Object.values(kv)) growOnly(r.el); // they follow the controls and the sequencer
    const kvHost = h('div', { class: 'synth-kv' });
    const status = callout();

    // ---- the scopes, the close-up of the peak (the third step) and the harmonics (the last)
    const pointLane = (max: number): ScopeChannel => ({ label: `the diodes’ point: −1 to +${max} V (0 V dashed)`, kind: 'analog', min: -1, max, guides: [0], color: '#f59e0b' });
    const lanes: Record<Step, ScopeChannel[]> = {
      1: [
        { label: 'the input: −12 to +12 V (±10.5 V dashed)', kind: 'analog', min: -12, max: 12, guides: [-VSAT12, 0, VSAT12], color: '#60a5fa' },
        { label: 'the output: −12 to +12 V', kind: 'analog', min: -12, max: 12, guides: [-VSAT12, 0, VSAT12], color: '#4ade80' },
      ],
      2: [{ label: 'the sawtooth, the inverter’s output dashed: −6 to +6 V', kind: 'analog', min: -6, max: 6, guides: [0], color: '#60a5fa', overlayColor: '#4ade80' }, pointLane(6)],
      3: [],
      4: [
        { label: 'the sawtooth: −11 to +11 V (0 V dashed)', kind: 'analog', min: -11, max: 11, guides: [0], color: '#60a5fa' },
        { label: 'what the inverter gets, its output dashed: −11 to +11 V', kind: 'analog', min: -11, max: 11, guides: [0], color: '#a78bfa', overlayColor: '#4ade80' },
        pointLane(11),
      ],
      5: [
        { label: 'the diodes’ point, worked out: −2 to +6 V (0 V dashed)', kind: 'analog', min: -2, max: 6, guides: [0], color: '#f59e0b' },
        { label: 'the output: −4 to +4 V (0 V dashed)', kind: 'analog', min: -4, max: 4, guides: [0], color: '#4ade80' },
      ],
      6: [
        { label: 'the sawtooth: −6 to +6 V (0 V dashed)', kind: 'analog', min: -6, max: 6, guides: [0], color: '#60a5fa' },
        { label: 'the triangle out: −4 to +4 V (0 V dashed)', kind: 'analog', min: -4, max: 4, guides: [0], color: '#4ade80' },
      ],
    };
    lanes[3] = lanes[2];
    const scopes = {} as Record<Step, Scope>;
    for (const k of [1, 2, 3, 4, 5, 6] as const) {
      scopes[k] = new Scope(lanes[k], { width: 640, laneHeight: 70 });
      scopes[k].canvas.setAttribute('role', 'img');
    }
    // wide enough for any pair the sliders give: the ends at about 4.46 V or more, the peak at most about 4.76 V
    const CLOSE_LO = 4.4, CLOSE_HI = 4.8;
    const close = new Scope([{ label: `around the peak, 0.1 ms across: ${CLOSE_LO} to ${CLOSE_HI} V`, kind: 'analog', min: CLOSE_LO, max: CLOSE_HI, color: '#f59e0b' }], { width: 640, laneHeight: 80 });
    close.canvas.setAttribute('role', 'img');
    const scopeHost = h('div');
    const scopeNote = h('p', { class: 'note' });
    const closeBox = h('div', null, h('h3', { class: 'sub-head' }, 'Close-up of the peak'), close.el);

    // the harmonics: a bar for each of the triangle's, a dashed tick for the sawtooth's
    const CW = 640, CH = 200, CL = 58, CR = 8, CT = 12, CB = 30;
    const slot = (CW - CL - CR) / HARMONICS;
    const yDb = (v: number) => CT + (Math.max(FLOOR, Math.min(0, v)) / FLOOR) * (CH - CT - CB);
    const chart = s('svg', { viewBox: `0 0 ${CW} ${CH}`, class: 'harmonics', role: 'img', 'aria-label': '' });
    for (const v of [0, -20, -40, -60])
      chart.append(s('line', { x1: CL, x2: CW - CR, y1: yDb(v), y2: yDb(v), class: 'h-grid' }), s('text', { x: CL - 8, y: yDb(v), 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'h-text' }, v ? `−${-v} dB` : '0 dB'));
    const bars = Array.from({ length: HARMONICS }, (_, k) => s('rect', { x: CL + (k + 0.22) * slot, width: slot * 0.56, y: yDb(0), height: 0, class: 'h-bar' }));
    const ticks = Array.from({ length: HARMONICS }, (_, k) => s('line', { x1: CL + (k + 0.08) * slot, x2: CL + (k + 0.92) * slot, y1: yDb(0), y2: yDb(0), class: 'h-ref' }));
    for (let k = 0; k < HARMONICS; k++) chart.append(s('text', { x: CL + (k + 0.5) * slot, y: CH - 10, 'text-anchor': 'middle', class: 'h-text' }, String(k + 1)));
    chart.append(...bars, ...ticks);
    const chartNote = note('Each harmonic’s strength in decibels under the first, the note itself: the triangle out as bars, the sawtooth as dashed lines, down to −60 dB. Every 20 dB is a tenth of the size.');
    const chartBox = h('div', null, h('h3', { class: 'sub-head' }, 'Harmonics'), chart, chartNote);
    const scopePanel = panel('Scope', { accent: 'yellow' }, scopeHost, scopeNote, closeBox, chartBox);
    const SAW_LEVELS = harmonics(Array.from({ length: PERIOD_N }, (_, k) => AMP - (2 * AMP * k) / PERIOD_N), HARMONICS);

    // ---- sound
    const tone = new Tone();
    d.add(() => tone.dispose());
    let toneKey = '';
    const quiet = () => {
      tone.stop();
      toneKey = '';
    };
    const sound = (hz: number, wave: readonly number[] | null, key: string) => {
      if (!listen || !wave || !(hz >= 0.1 && hz <= HEARING)) return quiet();
      const k = `${key}|${hz}`;
      if (k === toneKey) return;
      toneKey = k;
      tone.wave(hz, wave);
    };

    // ---- controls
    const wide = (sl: Slider) => {
      sl.el.classList.add('pot-slider');
      return row(sl.el);
    };
    const stepSel = select<`${Step}`>(STEPS, '1', (v) => { step = Number(v) as Step; apply(); }, 'Step');
    const bufferSel = select<Buffer>([{ value: 'inverting', label: 'inverting' }, { value: 'follower', label: 'not inverting (part 1’s)' }], buffer, (v) => { buffer = v; apply(); }, 'The buffer');
    const inputSel = select<Input>([{ value: 'saw', label: 'the sawtooth' }, { value: 'steady', label: 'a steady voltage' }], input, (v) => { input = v; apply(); }, 'The input');
    const steadySlider = new Slider({ label: 'The steady voltage', min: -12, max: 12, value: steady, positions: 480, format: pm, onInput: (v) => { steady = v; update(); } });
    const d1Toggle = new Toggle({ label: 'The sawtooth’s diode', value: d1, onChange: (v) => { d1 = v; apply(); } });
    const d2Toggle = new Toggle({ label: 'The inverter’s diode', value: d2, onChange: (v) => { d2 = v; apply(); } });
    const rInSlider = new Slider({ label: 'The input 10k', min: R * (1 - TOL), max: R * (1 + TOL), value: rIn, positions: 200, format: kOhm, onInput: (v) => { rIn = v; update(); } });
    const rFbSlider = new Slider({ label: 'The feedback 10k', min: R * (1 - TOL), max: R * (1 + TOL), value: rFb, positions: 200, format: kOhm, onInput: (v) => { rFb = v; update(); } });
    const setPair = (i: number, f: number) => {
      rIn = i;
      rFb = f;
      rInSlider.set(rIn);
      rFbSlider.set(rFb);
      update();
    };
    // a 1% resistor: anywhere within 1%, to the slider's 10 Ω
    const draw = () => Math.round((R * (1 - TOL + 2 * TOL * pick())) / 10) * 10;
    const randomBtn = new Button({ label: 'Two at random', onClick: () => setPair(draw(), draw()) });
    const matchBtn = new Button({ label: 'A matched pair', onClick: () => setPair(rIn, rIn) });
    const offsetSlider = new Slider({ label: 'The sawtooth’s offset', min: -5, max: 5, value: offset, positions: 200, format: pm, onInput: (v) => { offset = v; update(); } });
    const inCapToggle = new Toggle({ label: '1 µF, 200k and a buffer at the input', value: inCap, onChange: (v) => { inCap = v; apply(); } });
    const pullSel = select<Pull>(PULLS, pull, (v) => { pull = v; apply(); }, 'From the diodes’ point');
    const hearSel = select<'triangle' | 'saw'>([{ value: 'triangle', label: 'the triangle out' }, { value: 'saw', label: 'the sawtooth in' }], hear, (v) => { hear = v; update(); }, 'Listen to');
    const pairSel = select<'matched' | 'apart'>([{ value: 'matched', label: 'a matched pair' }, { value: 'apart', label: '2% apart' }], 'matched', (v) => { apart = v === 'apart'; apply(); }, 'The 10k pair');
    const runToggle = new Toggle({ label: 'Sequencer running', value: running, onChange: (v) => { running = v; acc = 0; } });
    const nextBtn = new Button({ label: 'Next note', onClick: () => { pos = (pos + 1) % SEQ.length; acc = 0; update(); } });
    const listenToggle = new Toggle({ label: 'Listen (quietly)', value: listen, onChange: (v) => { listen = v; toneKey = ''; update(); } });
    const steadyRow = wide(steadySlider), rInRow = wide(rInSlider), rFbRow = wide(rFbSlider), offsetRow = wide(offsetSlider);

    // ---- drawing
    /** A wave over the scope's window, from one period of it, starting at the jump. */
    const win = (wave: readonly number[], hz: number, window = WINDOW) => Array.from({ length: N }, (_, k) => wave[Math.floor(((((k * window) / (N - 1)) * hz) % 1) * wave.length) % wave.length]);
    const SAW = Array.from({ length: PERIOD_N }, (_, k) => AMP - (2 * AMP * k) / PERIOD_N);
    const clip = (v: number) => Math.max(-VSAT12, Math.min(VSAT12, v));
    const ranged = (vals: readonly number[]) => [Math.max(...vals), Math.min(...vals)] as const;

    /** Everything that follows the circuit: the schematic's words, the readouts, the scope and the sound. */
    const update = () => {
      (step === 1 ? schA : schB).el.setAttribute('aria-label', schematicLabel());
      if (step === 1) return updateBuffer();
      const t = setup(), hz = step === 6 ? noteHz(SEQ[pos]) : HZ, r = waves(t, hz);
      const ends = [r.ends.after - r.vc, r.ends.before - r.vc];
      const [hi, lo] = ranged([...r.out, ...ends]);
      const peakStep = r.ends.after - r.ends.before;
      const valued = step === 3 || (step === 6 && apart);
      setText(rInText, valued ? kOhm(t.rIn) : '10k');
      setText(rFbText, valued ? kOhm(t.rFb) : '10k');
      setText(srcB2, step === 6 ? `${SEQ[pos]}, ±5 V` : step === 4 && Math.abs(offset) >= 0.005 ? `±5 V, ${pm(offset)} up` : '±5 V, 200 Hz');
      const key = `${step}|${JSON.stringify(t)}`;
      if (step === 2) {
        kv[2].set('the diodes', d1 && d2 ? 'both: whichever op amp’s output is higher gets through' : d1 ? 'the sawtooth’s alone: its upper half gets through' : d2 ? 'the inverter’s alone: its upper half gets through' : 'neither: nothing reaches the point');
        kv[2].set('the diodes’ point', `${pm(hi)} at the peaks, ${pm(lo)} at the valleys`);
        kv[2].set('a diode’s drop', d1 || d2 ? `about ${(AMP - Math.max(r.ends.after, r.ends.before)).toFixed(2)} V at the peaks, less near 0 V: only the scope’s 1M takes current` : '—');
        sound(hz, d1 || d2 ? r.node : null, key);
      } else if (step === 3) {
        const g = r.gain;
        kv[3].set('the input 10k', kOhm(t.rIn));
        kv[3].set('the feedback 10k', kOhm(t.rFb));
        kv[3].set('the inverter’s gain', `−${g.toFixed(3)}${Math.abs(g - 1) < 5e-4 ? ', exactly' : `: ${(100 * Math.abs(g - 1)).toFixed(1)}% too ${g > 1 ? 'much' : 'little'}`}`);
        kv[3].set('the halves', `falling ${SLOPE.toFixed(2)} V a millisecond, rising ${(g * SLOPE).toFixed(2)}`);
        kv[3].set('the step at the peak', stepText(peakStep));
        sound(hz, r.node, key);
      } else if (step === 4) {
        kv[4].set('the sawtooth', `${span(offset + AMP, offset - AMP)}${Math.abs(offset) < 0.005 ? ', centred on 0 V' : `, ${pm(offset)} off centre`}`);
        kv[4].set('the inverter gets', inCap ? `${span(r.a[0], r.a[0] - 2 * AMP)}: the 1 µF has taken the offset out` : 'the sawtooth itself');
        kv[4].set('they cross', r.cross === null ? 'never: the sawtooth stays on one side of 0 V' : `at 0 V, ${pct(r.cross)} of the way through the period${Math.abs(r.cross - 0.5) < 0.005 ? ', halfway' : ''}`);
        kv[4].set('the step at the peak', stepText(peakStep));
        sound(hz, r.node, key);
      } else if (step === 5) {
        const off = r.node.filter((v, k) => Math.max(r.a[k], r.b[k]) - v < 0.25).length / PERIOD_N;
        kv[5].set('from the diodes’ point', pull === 'none' ? 'nothing: the 1 µF and the 200k alone' : pull === 'ground' ? '20k to ground' : '20k to −12 V');
        kv[5].set('the output’s 1 µF', `charged to ${pm(r.vc)}`);
        const pp = hi - lo;
        kv[5].set('the output', pp < 0.2 ? `next to nothing: blips of ${hi.toFixed(2)} V at the peaks, as the diodes top up the 1 µF` : `${span(hi, lo)}, ${pp.toFixed(2)} V peak to peak`);
        kv[5].set('its valleys', pull === 'none' ? 'none: the diodes are off nearly all the time' : off > 0.005 ? `flat at ${pm(Math.min(...r.node))} on the point, for ${pct(off)} of each period: the diodes are off there` : 'whole: the diodes never turn off');
        sound(hz, pull === 'none' ? null : r.out, key);
      } else {
        const levels = harmonics(r.out, HARMONICS);
        drawChart(levels);
        kv[6].set('the sequencer now', `step ${pos + 1} of ${SEQ.length}: ${SEQ[pos]}, ${fmtHz(hz)}`);
        kv[6].set('the output', `${span(hi, lo)}, ${(hi - lo).toFixed(2)} V peak to peak`);
        kv[6].set('the step at the peak', `${stepText(peakStep)}${apart ? ': the mismatch’s and the input 1 µF’s together' : ': the input’s 1 µF bends the sawtooth a little'}`);
        kv[6].set('the 10k pair', `${apart ? `the input ${kOhm(t.rIn)}, the feedback ${kOhm(t.rFb)}` : 'matched'}: the 2nd harmonic at ${dbText(dB(levels[1] / levels[0]))}`);
        sound(hz, hear === 'triangle' ? r.out : SAW, `${key}|${hear}`);
      }
      drawScope(r, hz);
    };

    /** The first step: one op amp, as a buffer either way round, the two 10k matched. */
    const updateBuffer = () => {
      const inv = buffer === 'inverting', steadyIn = input === 'steady';
      setText(srcA1, steadyIn ? 'a steady' : 'a sawtooth');
      setText(srcA2, steadyIn ? `voltage, ${pm(steady)}` : '±5 V, 200 Hz');
      const outOf = (v: number) => clip(inv ? -v : v);
      // the − input: between the input and the output, through the two 10k; held at 0 V while the output can follow
      const minusOf = (v: number) => (inv ? (v + outOf(v)) / 2 : outOf(v));
      if (steadyIn) {
        const out = outOf(steady), clipped = Math.abs(inv ? -steady : steady) > VSAT12, minus = minusOf(steady);
        kv[1].set('the input', pm(steady));
        kv[1].set('the − input', inv ? (clipped ? `${pm(minus)}: the output can go no further, so it isn’t held at 0 V` : '0.00 V, held there: its + input is on ground') : clipped ? `${pm(minus)}, the output’s, as far as it goes` : `${pm(minus)}, the output’s`);
        kv[1].set('the current', inv ? `${mA((steady - minus) / R)} in through one 10k and on through the other` : 'none to speak of: an op amp’s inputs take next to nothing');
        kv[1].set('the output', `${pm(out)}${clipped ? ', clipped' : ''}`);
        setText(minusA, inv ? pm(minus) : '');
        quiet();
      } else {
        kv[1].set('the input', span(AMP, -AMP));
        kv[1].set('the − input', inv ? '0.00 V throughout, held there' : 'the output’s, the same as the input');
        kv[1].set('the current', inv ? `${mA(AMP / R)} to ${mA(-AMP / R)}, in through one 10k and on through the other` : 'none to speak of: an op amp’s inputs take next to nothing');
        kv[1].set('the output', inv ? `${span(-AMP, AMP)}: upside down` : `${span(AMP, -AMP)}: the same`);
        setText(minusA, inv ? '0 V' : '');
        sound(HZ, SAW.map(outOf), `1|${buffer}`);
      }
      const ins = steadyIn ? Array<number>(N).fill(steady) : win(SAW, HZ);
      scopes[1].draw([ins, ins.map(outOf)], { window: N });
    };

    const drawChart = (levels: readonly number[]) => {
      const tri = levels.map((x) => dB(x / levels[0])), saw = SAW_LEVELS.map((x) => dB(x / SAW_LEVELS[0]));
      bars.forEach((bar, k) => {
        const y = yDb(tri[k]);
        bar.setAttribute('y', y.toFixed(1));
        bar.setAttribute('height', Math.max(0, yDb(FLOOR) - y).toFixed(1));
      });
      ticks.forEach((tick, k) => {
        const y = yDb(saw[k]).toFixed(1);
        tick.setAttribute('y1', y);
        tick.setAttribute('y2', y);
      });
      const list = (v: number[]) => v.slice(1, 6).map((x, k) => `${nth(k + 2)} ${dbText(x)}`).join(', ');
      chart.setAttribute('aria-label', `Chart: the harmonics in decibels under the first. The triangle out: ${list(tri)}. The sawtooth: ${list(saw)}.`);
    };

    /** The scope for steps 2 to 6, from one period of each wave at `hz`. */
    const drawScope = (r: ReturnType<typeof sawToTriangle>, hz: number) => {
      const w = (wave: readonly number[]) => win(wave, hz, step === 6 ? SEQ_WINDOW : WINDOW);
      if (step === 2 || step === 3) scopes[step].draw([w(r.a), w(r.node)], { window: N, overlays: [w(r.b)] });
      else if (step === 4) scopes[4].draw([w(r.saw), w(r.a), w(r.node)], { window: N, overlays: [undefined, w(r.b)] });
      else if (step === 5) scopes[5].draw([w(r.node), w(r.out)], { window: N });
      else scopes[6].draw([w(SAW), w(r.out)], { window: N });
      if (step === 3) {
        // the peak, either side of the jump: the inverted half rising to it, the sawtooth's falling from it
        const t = setup(), g = t.rFb / t.rIn, loads = [{ g: 1 / SCOPE_IN, v: 0 }];
        const at = (time: number) => {
          const av = time < 0 ? -AMP - SLOPE * 1e3 * time : AMP - SLOPE * 1e3 * time;
          return Math.max(CLOSE_LO, Math.min(CLOSE_HI, diodePoint(av, clip(-g * av), loads)));
        };
        close.draw([Array.from({ length: CLOSE_N }, (_, k) => at(-CLOSE + (2 * CLOSE * k) / (CLOSE_N - 1)))], { window: CLOSE_N, markers: [{ at: (CLOSE_N - 1) / 2, dashed: true }] });
      }
    };

    /** A new step: its schematic and parts of it, its controls, its readouts, its text and its scope. */
    const apply = () => {
      const show = (el: HTMLElement, v: boolean) => (el.style.display = v ? '' : 'none');
      const t = step === 1 ? null : setup();
      schHost.replaceChildren(step === 1 ? schA.el : schB.el);
      gInvA.show(buffer === 'inverting');
      gFolA.show(buffer === 'follower');
      if (t) {
        gIn.show(t.inCap);
        gNoIn.show(!t.inCap);
        gD1.show(t.d1);
        gD2.show(t.d2);
        gD1Out.show(!t.d1);
        gD2Out.show(!t.d2);
        gProbe.show(!t.outCap);
        gOut.show(t.outCap);
        gPull.show(t.outCap && t.pull !== 'none');
        gPullGround.show(t.outCap && t.pull === 'ground');
        gPullNeg.show(t.outCap && t.pull === 'negative');
        // the output stage hangs below the point only in the last two steps
        schB.el.setAttribute('viewBox', `0 0 690 ${t.outCap ? 265 : 258}`);
      }
      show(bufferSel, step === 1);
      show(inputSel, step === 1);
      show(steadyRow, step === 1 && input === 'steady');
      show(d1Toggle.el, step === 2);
      show(d2Toggle.el, step === 2);
      show(rInRow, step === 3);
      show(rFbRow, step === 3);
      show(randomBtn.el, step === 3);
      show(matchBtn.el, step === 3);
      show(offsetRow, step === 4);
      show(inCapToggle.el, step === 4);
      show(pullSel, step === 5);
      show(hearSel, step === 6);
      show(pairSel, step === 6);
      show(runToggle.el, step === 6);
      show(nextBtn.el, step === 6);
      show(closeBox, step === 3);
      show(chartBox, step === 6);
      scopeHost.replaceChildren(scopes[step].el);
      setText(scopeNote, SCOPE_NOTES[step]);
      scopes[step].canvas.setAttribute(
        'aria-label',
        step === 1
          ? 'Scope: the buffer’s input and output, 10 ms across.'
          : step === 5
            ? 'Scope: the diodes’ point and the output, 10 ms across.'
            : step === 6
              ? 'Scope: the sawtooth and the triangle out, 20 ms across.'
              : `Scope: the sawtooth${step === 4 ? ', what the inverter gets' : ''} and the inverter’s output, then the diodes’ point, 10 ms across.`,
      );
      close.canvas.setAttribute('aria-label', 'Scope: a close-up of the diodes’ point around the peak, 50 µs either side of the jump.');
      kvHost.replaceChildren(kv[step].el);
      setText(status, STEP_TEXT[step]);
      update();
    };

    // ---- each frame: the sequencer moves on
    d.add(
      animate((ms) => {
        if (!running || step !== 6) return;
        acc += Math.min(ms, 100) / 1000;
        let changed = false;
        while (acc >= NOTE_S) {
          acc -= NOTE_S;
          pos = (pos + 1) % SEQ.length;
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
          { accent: 'red', chips: 'TL074 (two of its op amps) · 1N4148 ×2 · 10k ×2, matched · 1 µF ×2 · 200k ×2 · 20k · a sawtooth, ±5 V' },
          row(stepSel, bufferSel, inputSel, d1Toggle.el, d2Toggle.el, randomBtn.el, matchBtn.el, inCapToggle.el, pullSel, hearSel, pairSel, runToggle.el, nextBtn.el, listenToggle.el),
          steadyRow,
          rInRow,
          rFbRow,
          offsetRow,
          h('div', { class: 'synth-circuit' }, schHost, kvHost),
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
  const g = sawToTriangle({ ...TRI_BUILT, pull: 'ground' }), n12 = sawToTriangle(TRI_BUILT);
  const off = g.node.filter((v, k) => Math.max(g.a[k], g.b[k]) - v < 0.25).length / g.node.length;
  return panel(
    'From the video',
    { accent: 'gray' },
    note('A quick tip, the first of a new series of shorter videos on smaller circuit ideas: a third wave for his VCO, which so far has a sawtooth and a square, or for any sawtooth. He suggests watching the VCO series first for the basics. The aim is a triangle as perfectly symmetrical as it can be.'),
    note('The inverting buffer, his part 4 op amp in other words: its action is at the − input, which the op amp holds where its + input is, here on ground. 5 V in pushes current in through the first 10k, and the output has to take it away through the second: at −5 V, if the two are the same value. Within the supply’s range, of course.'),
    note(`Splicing: the sawtooth and its copy share their start and end points and cross precisely at 0 V halfway, so there are at least three ways to splice a triangle out of them, by taking turns. He takes the upper halves, with diodes, which let current through one way only. Each costs its forward drop, about ${VD_MA.toFixed(2)} V at a milliamp, less at the microamps a scope takes.`),
    note('The resistors: his bag of 10k from SEGOR says 1%. Each is within 1% of 10k, so two picked at random can be up to 2% apart. He tests a bunch with a multimeter, keeps two that seem a good fit, and the peak comes out clean. A trimmer in place of one would let it be set exactly.'),
    note(`The input’s 1 µF and 200k are a high-pass with its corner at 0.8 Hz, 1 ÷ (2π R C), which takes out any offset. Without the buffer, the inverter’s 10k, its − input held at 0 V, would sit across the 200k: the high-pass’s time constant would fall from ${Math.round(TAU_IN * 1e3)} ms to about ${(TAU_UNBUFFERED * 1e3).toFixed(1)} ms, two periods at 200 Hz, and the sawtooth would droop badly; whichever diode conducts loads it too. With the buffer, the 1 µF still bends the sawtooth’s ramp a little, its top a little higher than its bottom is low: at the peak that leaves a step of its own, ${bendStep(HZ).toFixed(2)} V at 200 Hz, ${bendStep(noteHz('C3')).toFixed(2)} V at C3 and ${bendStep(noteHz('C2')).toFixed(2)} V at C2, as big as a 2% mismatch’s 0.10 V there. A mismatch with the feedback 10k the smaller adds to it, as the last step’s 2% apart does; the other way round, it takes from it. His simulation, with 100k, bends it twice as much.`),
    note(`The output: with no way to discharge, the 1 µF charges to the triangle’s peak, less the diodes’ drop, and stays there. Why −12 V and not ground: the description says he cut corners there. Diodes only conduct with about 0.6 V across them, so with the point’s lowest voltage at 0 V they turn off before the triangle reaches its valleys, and flatten them; with −12 V the point can go a fair bit below 0 V. In the model, with 20k to ground the diodes are off for about ${pct(off)} of each period and the valleys sit flat at about ${pm(Math.min(...g.node))}; with −12 V the point swings from about ${pm(Math.min(...n12.node))} to ${pm(Math.max(...n12.node))} and the output about ±2.5 V.`),
    note('His sound demo plays the triangle from a sequence of notes, with the scope following it. A triangle’s harmonics are the odd ones, each falling with the square of its number (the third at a ninth, −19 dB, the fifth at a 25th, −28 dB), where a sawtooth’s are all of them, each falling with its number (the second at −6 dB, the third at −10 dB). A step at the peak, from a mismatched pair or the input’s 1 µF, brings in even ones.'),
    note(
      'Estimates here: the 1N4148 by the Shockley law, with the common SPICE model’s I_S and n; the scope’s 1M on the diodes’ point as its only load from the second step to the fourth; the TL074 on ±12 V, clipping 1.5 V short of the rails, as in part 4; which of its op amps buffers (pins 1 to 3) and which inverts (pins 5 to 7), since his breadboard is filmed upside down; the sawtooth, his simulation’s ±5 V at 200 Hz, falling as his VCO’s does (his bench source isn’t shown), and instant at its jump; the output’s 1 µF holding its charge over a period; and the sequence, the lab’s own (part 4’s). His simulation has the same circuit with 100k at the input and 10k to −12 V. Listen plays the waves the scope shows; with nothing from the diodes’ point it stays quiet.',
    ),
  );
}
