import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row, scrollBox, select, type ScopeChannel } from '../../ui/components';
import { Disposer, animate, growOnly, h, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { Kit, kitCss } from '../clock/_draw';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { R_FOLLOW, ROOM, TUNING, V12, collectorCurrent, converter, follower, noteHz, noteOf, offsetFor, sinkTimes, thermalVoltage, tune, type Temps } from './_analog';
import { diode, jack, npnLeft, pnpLeft, potDivider, railDown, schmitt } from './_draw';
import { HEARING, IN_TUNE, cents, fmtA, fmtCv, fmtV, mV, offText, pitchText, playsText, sMV, sV, schBox, schBoxCss, tunerCss, tunerRow } from './_shared';
import { Tone } from './_sound';

const SCOPE_CLASS = 'synth-tune';
const R4K = 4e3; // part 2's rough scaling, still in place in the third step
const FINGER = 32; // °C: a finger warms a transistor towards this (an estimate, as in part 2's lab)
const WARM_TAU = 6; // s: and this fast (an estimate)
const NOTE_S = 1 / 3; // the sequencer moves on three times a second
const REC_N = 300; // the chart recorder's readings: thirty seconds' worth
const REC_DT = 0.1; // s between them

/** What 0 V on the jack plays, once tuned: C2. */
const LOW = noteHz('C2');
const cvOf = (name: string) => Math.log2(noteHz(name) / LOW);
/** Part 2's sequence again, in the third step: eight notes over 0 to 4 V. */
const SEQ3 = ['C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'C6'];
/** The last step's sequence, an arpeggio in C major over two octaves: the lab's own. */
const SEQ5 = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'G4'];
/** The tuning step's top: four steps at 0 V and four at 1, 2 or 5 V, as his SQ-1 can be set. */
type Range = 1 | 2 | 5;

const AT_ROOM: Temps = { pnp: ROOM, npn: ROOM };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---- numbers the texts quote, from the models

/** The follower alone with its base on ground, as Moritz first measures it. */
const ALONE = follower(0, ROOM, null);
/** How far its emitter falls for each degree the BC558C warms, in mV. */
const PER_K = (follower(0, ROOM + 1, null).ve - ALONE.ve) * 1e3;
/** What a datasheet's typical `veb` at 2 mA would put on the emitter instead. */
const vebFrom = (veb: number) => veb - thermalVoltage(ROOM) * Math.log(2e-3 / ALONE.ic);
/** The second step: the follower on the BC548C's base, its own base on ground, both at `temps`. */
const onBase = (temps: Temps) => {
  const f = follower(0, temps.pnp, temps.npn), i = collectorCurrent(f.ve, temps.npn);
  return { ...f, i, t: sinkTimes(i) };
};
const STEP2 = onBase(AT_ROOM);
/** The most the BC548C can draw through the 1M, its base pulled as high as it goes. */
const MOST = collectorCurrent(follower(V12).ve);
/** The third step's pot: 0 V on C2 with part 2's 4k. */
const TURN3 = offsetFor(R4K, LOW);
const PER_VOLT_4K = Math.log2(converter(1, TURN3, R4K).t.hz / converter(0, TURN3, R4K).t.hz);
/** What 1 V per octave needs at the BC548C's base, for each volt of CV. */
const DOUBLING = thermalVoltage(ROOM) * Math.LN2;
type Tuning = { turn: number; trim: number };
/** Both rails 0.1 V low, the VCO tuned as `tuned`: how many cents every note moves. */
const sagCents = (tuned: Tuning) => 1200 * Math.log2(converter(0, tuned.turn, TUNING.fixed + tuned.trim, AT_ROOM, V12 - 0.1).t.hz / LOW);

// ---- formatting

const tempText = (t: number, finger: boolean) => `${t.toFixed(1)} °C${finger ? ', a finger on it' : t > ROOM + 0.05 ? ', cooling' : ''}`;

const CSS = `
.${SCOPE_CLASS} .synth-circuit { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; }
.${SCOPE_CLASS} .synth-sch { flex: 1 1 440px; }
.${SCOPE_CLASS} .synth-kv { flex: 1 1 220px; }
.${SCOPE_CLASS} .schmitt-sign { stroke-width: 1.5; }
.${SCOPE_CLASS} .kv dd { font-variant-numeric: tabular-nums; }
.${SCOPE_CLASS} .pot-slider { display: flex; width: 100%; }
.${SCOPE_CLASS} .pot-slider input { flex: 1 1 auto; width: auto; min-width: 0; }
${tunerCss(SCOPE_CLASS)}`;

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: { value: `${Step}`; label: string }[] = [
  { value: '1', label: '1. An emitter follower' },
  { value: '2', label: '2. On the BC548C’s base' },
  { value: '3', label: '3. Subtracting the offset' },
  { value: '4', label: '4. Tuning with a trimmer' },
  { value: '5', label: '5. In tune, in a warmer room' },
];

/** The schematic's words, per step. */
function schematicLabel(step: Step): string {
  const follow = 'a BC558C, a PNP transistor, its emitter through 1M to +12 V and its collector on −12 V';
  const core = 'part 2’s converter: a BC548C draining the core, one Schmitt-trigger inverter of a 40106 on 12 V with 2.2 nF on its input and a 1N4148 from its output back to it, the capacitor on to part 1’s output stage';
  switch (step) {
    case 1:
      return `Schematic of an emitter follower: ${follow}, its base on the voltage the slider sets, and a multimeter on its emitter.`;
    case 2:
      return `Schematic: ${follow}, its base on ground and its emitter on the base of ${core}.`;
    case 3:
      return `Schematic: ${follow}, its emitter on the base of ${core}. The BC558C’s base is a passive mixer: the wiper of a 100k pot from ground to −12 V through 100k, the CV jack through another 100k, and 4k to ground.`;
    case 4:
    case 5:
      return `Schematic: ${follow}, its emitter on the base of ${core}. The BC558C’s base is a passive mixer: the wiper of a 100k pot from ground to −12 V through 100k, the CV jack through another 100k, and 1.5k with a 1k trimmer to ground.`;
  }
}

/** What the callout says, per step. */
function stepText(step: Step): string {
  switch (step) {
    case 1:
      return `Part 2’s converter drifts with temperature, and its scaling was only roughed in; part 3 deals with both. First the BC548C’s twin, the BC558C: a PNP transistor, built upside down, which opens as its base goes below its emitter rather than above, but which warms open just the same. Here it is an emitter follower, its emitter through 1M to +12 V and its collector on −12 V. With its base on ground, as Moritz has it, his multimeter reads 480 mV on the emitter: the follower copies its base, always about ${mV(ALONE.ve)} higher. Move the base and see. A finger on the transistor lets the emitter down, about ${Math.abs(PER_K).toFixed(1)} mV a degree.`;
    case 2:
      return `The emitter now drives the BC548C’s base, the BC558C’s base still on ground: ${mV(STEP2.ve)} at the BC548C, and the core plays ${pitchText(STEP2.t)}, too high a baseline, as Moritz says. Now the temperature. Warmth opens the BC548C, which raises the pitch, as in part 2. It opens the BC558C too, which lets its emitter down and so closes the BC548C a little: the pitch falls. Touch one, then the other, as he does: since both react about the same way, they cancel once they’re at the same temperature. A negative feedback loop, as long as the two sit close together.`;
    case 3:
      return `The follower adds about 480 mV, which is too much: where part 2 added an offset, this one has to take it away. So the pot now goes from ground to −12 V. The passive mixer doesn’t mind a negative input: it subtracts. Its wiper and the sequencer’s CV each go through 100k into the BC558C’s base, with part 2’s 4k to ground. The pot brings the baseline down (here 0 V plays C2), and the sequence plays, but out of tune: the 4k still gives about ${PER_VOLT_4K.toFixed(1)} octaves a volt.`;
    case 4:
      return `Proper scaling, for 1 V per octave: each volt of CV has to move the BC548C’s base ${(DOUBLING * 1e3).toFixed(1)} mV. Moritz could work out the resistor, but puts 1.5k and a 1k precision trimmer in series instead, the trimmer taking ten turns from end to end: the right value is somewhere between 1.5k and 2.5k. To tune it he sets four of the sequencer’s steps to 0 V and four to the top (1 V first, then 2, then 5), and watches a tuner: the offset pot puts the low note on a C, the trimmer stretches the high one to the C above. The trimmer moves both notes, so the pot has to follow it: trial and error.`;
    case 5:
      return `Tuned, a sequence in C major (the lab’s own) plays in tune. Now warm or cool the room: both transistors follow it together, and the follower cancels most of the drift, but not all. What’s left is the scale: each octave needs V_T ln 2 at the BC548C’s base, and V_T grows with the absolute temperature, about ${(100 / (ROOM + 273.15)).toFixed(2)}% a degree, so warmth narrows the octaves. The note that puts the BC558C’s base at 0 V hardly moves (about ${noteOf(STEP2.t.hz).name}, as in the second step); those below it go sharp, those above flat, by cents. Part 2’s converter, tuned the same, would be off by semitones. Retuning puts it right for the new temperature; part 4 takes on what’s left, with thermistors.`;
  }
}

export default defineLab({
  id: 'vco-tuning',
  title: 'Tuning the VCO',
  summary:
    'Part 3 of Moritz Klein’s DIY VCO: tuning it, and keeping it in tune. A BC558C, the BC548C’s PNP twin, set up as an emitter follower in front of the BC548C’s base, warms open just as the BC548C does, and the two cancel: a finger on either sends the pitch the other way. The follower’s 480 mV turns the offset into a subtraction, the pot now going to −12 V, and 1.5k with a ten-turn 1k trimmer in place of the 4k sets the scale to 1 V per octave, tuned with the sequencer and a tuner as he does it. A warmer room still nudges it, by cents rather than semitones.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE_CLASS });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE_CLASS) + schBoxCss(SCOPE_CLASS) + CSS));

    let step: Step = 1, listen = false, running = true;
    /** The first step's base; both transistors' temperatures and the fingers on them; the last step's room. */
    let base1 = 0, pnpT = ROOM, npnT = ROOM, pnpFinger = false, npnFinger = false, room = ROOM;
    let range: Range = 1;
    /** The sequencer's step, the time towards its next, and towards the chart recorder's next reading. */
    let pos = 0, acc = 0, recAcc = 0;
    /** Tuned exactly at 25 °C: worked out as the lab opens, since its bisections take a few milliseconds. */
    const tuned = tune(LOW);
    /** The room's temperature when the last step's VCO was last tuned, by the button or by hand: part 2's converter is taken as tuned the same, then. */
    let tunedAt = ROOM;
    /** The offset pot (its turn from ground towards −12 V) and the trimmer (ohms), in each step that has them: each starts where its text says. */
    const pots: Record<3 | 4 | 5, number> = { 3: TURN3, 4: TURN3, 5: tuned.turn };
    const trims: Record<4 | 5, number> = { 4: TUNING.trimmer / 2, 5: tuned.trim };

    const temps = (): Temps => (step <= 2 ? { pnp: pnpT, npn: npnT } : step === 5 ? { pnp: room, npn: room } : AT_ROOM);
    const shunt = () => (step === 3 ? R4K : TUNING.fixed + trims[step === 4 ? 4 : 5]);
    const seq = (): number[] => (step === 3 ? SEQ3.map(cvOf) : step === 4 ? [0, 0, 0, 0, range, range, range, range] : SEQ5.map(cvOf));
    /** The converter with `cv` on the jack, as this step has it. */
    const play = (cv: number, t = temps()) => converter(cv, pots[step === 3 ? 3 : step === 4 ? 4 : 5], shunt(), t);

    // ---- the schematic: the follower in the middle, the mixer on its left, part 2's converter on its right
    const dc = new Circuit();
    const sch = new Schematic(dc, { width: 650, height: 310, label: 'Schematic' });
    const kit = new Kit(sch, dc);

    // the BC558C: its emitter through 1M to +12 V, its collector on −12 V
    let pnpTemp!: SVGTextElement;
    kit.group(() => {
      const q = pnpLeft(kit, 220, 175);
      kit.ana('ana', q.emitter, [235, 115]);
      kit.resistor(235, 100, 'v', '1M', 'left');
      kit.ana('plain', [235, 85], [235, 72]);
      kit.vcc(235, 72, '+12 V');
      kit.anaDot('ana', [235, 130]);
      kit.ana('plain', q.collector, [235, 212]);
      railDown(kit, 235, 212, '−12 V');
      kit.text('BC558C', [208, 152], { anchor: 'end', size: 10 });
      pnpTemp = kit.text('', [208, 198], { anchor: 'end', size: 10, class: 'dim' });
    });

    // step 1: the base on a voltage set below, and a multimeter on the emitter
    let baseText!: SVGTextElement, meterText!: SVGTextElement;
    const gAlone = kit.group(() => {
      kit.ana('ana', [202, 175], [172, 175]);
      kit.text('the base:', [168, 160], { anchor: 'end', size: 10, class: 'dim' });
      baseText = kit.text('', [168, 176], { anchor: 'end', size: 11 });
      kit.ana('ana', [235, 130], [262, 130]);
      kit.text('multimeter:', [266, 115], { anchor: 'start', size: 10, class: 'dim' });
      meterText = kit.text('', [266, 130], { anchor: 'start', size: 11 });
    });

    // steps 2-5: part 2's converter, the BC548C's base on the follower's emitter
    let npnTemp!: SVGTextElement;
    const gCore = kit.group(() => {
      const inv = schmitt(kit, 390, 130);
      kit.ana('ana', [360, 130], inv.in);
      kit.text('1', [386, 123], { anchor: 'end', size: 9, class: 'faint' });
      kit.text('2', [442, 123], { anchor: 'start', size: 9, class: 'faint' });
      kit.ana('plain', [405, 117.5], [405, 104]);
      kit.text('+12 V', [405, 96], { size: 10, class: 'dim' });
      kit.text('14', [410, 111], { anchor: 'start', size: 9, class: 'faint' });
      kit.ana('plain', [410, 140], [410, 152]);
      kit.ground(410, 152);
      kit.text('7', [415, 146], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('40106', [452, 150], { anchor: 'start', size: 9, class: 'dim' });
      kit.ana('plain', inv.out, [472, 130], [472, 75], [447, 75]);
      diode(kit, 435, 75, 'left');
      kit.text('1N4148', [435, 61], { size: 10 });
      kit.ana('ana', [423, 75], [360, 75], [360, 176.5]);
      kit.anaDot('ana', [360, 130]);
      kit.cap(360, 180, 'v');
      kit.text('2.2 nF', [374, 180], { anchor: 'start', size: 11 });
      kit.ana('plain', [360, 183.5], [360, 196]);
      kit.ground(360, 196);
      kit.anaDot('ana', [360, 150]);
      kit.ana('ana', [360, 150], [325, 150]);
      kit.text('its other inputs (3, 5, 9, 11, 13) to ground', [500, 236], { size: 9, class: 'dim' });
      kit.anaDot('ana', [360, 75]);
      kit.ana('ana', [360, 75], [360, 40], [570, 40], [570, 58]);
      kit.block(500, 58, 140, 56);
      kit.text('part 1’s output stage:', [570, 72], { size: 9, class: 'dim' });
      kit.text('buffer, 1 µF and 100k,', [570, 86], { size: 9, class: 'dim' });
      kit.text('two 10k to the jack', [570, 100], { size: 9, class: 'dim' });
      const q = npnLeft(kit, 310, 175);
      kit.ana('ana', [325, 150], q.collector);
      kit.ana('plain', q.emitter, [325, 200]);
      kit.ground(325, 200);
      kit.text('BC548C', [300, 158], { anchor: 'end', size: 10 });
      npnTemp = kit.text('', [300, 198], { anchor: 'end', size: 10, class: 'dim' });
      kit.ana('ana', [235, 130], [255, 130], [255, 175], q.base);
    });

    // step 2: the BC558C's base on ground
    const gGround = kit.group(() => {
      kit.ana('plain', [202, 175], [150, 175], [150, 186]);
      kit.ground(150, 186);
    });

    // steps 3-5: the mixer, the offset pot now to −12 V, and the CV jack
    const gMix = kit.group(() => {
      const p = potDivider(kit, 60, 130);
      kit.ana('plain', p.top, [60, 100]);
      kit.vcc(60, 100, '−12 V');
      kit.ana('plain', p.bottom, [60, 160]);
      kit.ground(60, 160);
      kit.text('100k', [48, 124], { anchor: 'end', size: 11 });
      kit.text('pot', [48, 137], { anchor: 'end', size: 11 });
      kit.ana('ana', p.wiper, [105, 130]);
      kit.resistor(120, 130, 'h', '100k', 'top');
      kit.ana('ana', [135, 130], [160, 130], [160, 220]);
      const j = jack(kit, 86, 220, 'left', 'CV in (0 to 5 V)');
      kit.ana('ana', j.tip, [105, 220]);
      kit.resistor(120, 220, 'h', '100k', 'top');
      kit.ana('ana', [135, 220], [160, 220]);
      kit.ana('plain', j.sleeve, [94, 237], [94, 250]);
      kit.ground(94, 250);
      kit.anaDot('ana', [160, 175]);
      kit.anaDot('ana', [160, 220]);
      kit.ana('ana', [160, 175], [202, 175]);
    });

    // step 3: part 2's 4k to ground
    const g4k = kit.group(() => {
      kit.ana('ana', [160, 220], [160, 230]);
      kit.resistor(160, 245, 'v', '4k', 'right');
      kit.ana('plain', [160, 260], [160, 266]);
      kit.ground(160, 266);
    });

    // steps 4 and 5: 1.5k and the 1k trimmer instead
    let trimText!: SVGTextElement;
    const gTrim = kit.group(() => {
      kit.ana('ana', [160, 220], [160, 228]);
      kit.resistor(160, 243, 'v', '1.5k', 'right');
      kit.ana('ana', [160, 258], [160, 262]);
      kit.pot(160, 277, '1k trimmer', 'right');
      trimText = kit.text('', [172, 292], { anchor: 'start', size: 9, class: 'dim' });
      kit.ana('plain', [160, 292], [160, 294]);
      kit.ground(160, 294);
    });

    // ---- readouts
    const kv = {
      1: readouts(['the base', 'the emitter', 'the emitter, above the base', 'through the 1M', 'the BC558C']),
      2: readouts(['the BC558C', 'the BC548C', 'the BC548C’s base', 'pitch', 'drift since 25 °C']),
      3: readouts(['the pot’s wiper', 'the sequencer now', 'the mixer (the BC558C’s base)', 'the BC548C’s base', 'pitch', 'per volt of CV']),
      4: readouts(['the pot’s wiper', 'the trimmer', 'the sequencer now', 'the BC548C’s base', 'pitch', 'per volt of CV']),
      5: readouts(['the room', 'tuned at', 'the sequencer now', 'pitch', 'off the note meant', 'part 2’s converter would be']),
    };
    for (const r of Object.values(kv)) growOnly(r.el); // they follow the sequencer and the temperatures
    const kvHost = h('div', { class: 'synth-kv' });
    const status = callout();

    // ---- the sequence (third step), and the tuner (fourth and fifth)
    const seqRows = SEQ3.map((meant, k) => {
      const plays = h('td');
      return { tr: h('tr', null, h('td', null, String(k + 1)), h('td', null, fmtCv(cvOf(meant))), h('td', null, meant), plays), plays };
    });
    const sequencePanel = panel(
      'The sequence',
      { accent: 'blue' },
      scrollBox('The sequence', h('table', { class: 'truth-table seq-table' }, h('thead', null, h('tr', null, ['step', 'CV', 'meant', 'plays'].map((x) => h('th', null, x)))), h('tbody', null, seqRows.map((r) => r.tr)))),
      note('Part 2’s eight notes for 0 to 4 V, meant at 1 V per octave from C2. The pot sets where they start; the 4k, how far apart they land.'),
    );

    const lowRow = tunerRow('0 V'), highRow = tunerRow('1 V'), nowRow = tunerRow('now');
    const spanNote = h('p', { class: 'note' }), verdict = h('p', { class: 'note' });
    const majorRows = SEQ5.map((meant, k) => {
      const off = h('td'), part2 = h('td');
      return { tr: h('tr', null, h('td', null, String(k + 1)), h('td', null, fmtCv(cvOf(meant))), h('td', null, meant), off, part2), off, part2 };
    });
    const majorHead = h('h3', { class: 'sub-head' }, 'The sequence');
    const majorTable = scrollBox(
      'The sequence on the tuner',
      h('table', { class: 'truth-table seq-table' }, h('thead', null, h('tr', null, ['step', 'CV', 'meant', 'off', 'part 2’s'].map((x) => h('th', null, x)))), h('tbody', null, majorRows.map((r) => r.tr))),
    );
    const majorNote = note('“off”: how far each note is from the one meant, with the follower. “part 2’s”: the same note on part 2’s converter, had it been tuned the same at the same time (“tuned at”), in this room now.');
    const tunerPanel = panel('The tuner', { accent: 'blue' }, h('div', { class: 'tuner' }, lowRow.el, highRow.el, nowRow.el), spanNote, verdict, majorHead, majorTable, majorNote);

    // ---- the chart recorder (second step): both temperatures and the pitch, the last thirty seconds
    const recLanes: ScopeChannel[] = [
      { label: 'the BC548C (NPN): 24 to 33 °C', kind: 'analog', min: 24, max: 33, guides: [ROOM, FINGER], color: '#f87171' },
      { label: 'the BC558C (PNP): 24 to 33 °C', kind: 'analog', min: 24, max: 33, guides: [ROOM, FINGER], color: '#60a5fa' },
      { label: 'the pitch: semitones from 25 °C, −12 to +12', kind: 'analog', min: -12, max: 12, guides: [0], color: '#a78bfa' },
    ];
    const recorder = new Scope(recLanes, { width: 640, laneHeight: 60 });
    recorder.canvas.setAttribute('aria-label', 'Chart recorder: the last thirty seconds of both transistors’ temperatures, and the pitch’s drift from where it was at 25 °C.');
    const rec: number[][] = [[], [], []];
    const record = () => {
      const t = temps(), drift = 12 * Math.log2(onBase(t).t.hz / STEP2.t.hz);
      [clamp(t.npn, 24, 33), clamp(t.pnp, 24, 33), clamp(drift, -12, 12)].forEach((v, k) => {
        rec[k].push(v);
        if (rec[k].length > REC_N) rec[k].shift();
      });
      recorder.draw(rec, { window: REC_N });
    };
    const recorderPanel = panel(
      'The chart recorder',
      { accent: 'yellow' },
      recorder.el,
      note(`Thirty seconds, ten readings a second, newest on the right. The temperature lanes have ${ROOM} °C and a finger’s ${FINGER} °C dashed; the pitch lane, where it was with both at ${ROOM} °C.`),
    );

    // ---- sound: a sawtooth at the core's pitch
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
    const rangeSel = select<`${Range}`>([{ value: '1', label: '1 V' }, { value: '2', label: '2 V' }, { value: '5', label: '5 V' }], '1', (v) => { range = Number(v) as Range; update(); }, 'The top steps');
    const fine = (sl: Slider) => {
      sl.el.classList.add('pot-slider');
      return row(sl.el);
    };
    const baseSlider = new Slider({ label: 'The base', min: -1, max: 1, value: 0, positions: 2000, format: sV, onInput: (v) => { base1 = v; update(); } });
    const potSlider = new Slider({
      label: 'The offset pot',
      min: 0,
      max: V12,
      value: TURN3 * V12,
      positions: 12000, // a millivolt an arrow key
      format: (v) => sV(-v),
      onInput: (v) => {
        if (step >= 3) pots[step === 3 ? 3 : step === 4 ? 4 : 5] = v / V12;
        if (step === 5) tunedAt = room;
        update();
      },
    });
    const trimSlider = new Slider({
      label: 'The trimmer',
      min: 0,
      max: TUNING.trimmer,
      value: trims[4],
      positions: 10000, // a hundredth of a turn every ten arrow keys
      format: (r) => `${(r / 100).toFixed(2)} turns`,
      onInput: (v) => {
        if (step >= 4) trims[step === 4 ? 4 : 5] = v;
        if (step === 5) tunedAt = room;
        update();
      },
    });
    const roomSlider = new Slider({ label: 'The room', min: 15, max: 35, value: ROOM, positions: 200, format: (c) => `${c.toFixed(1)} °C`, onInput: (v) => { room = v; update(); } });
    const baseRow = fine(baseSlider), potRow = fine(potSlider), trimRow = fine(trimSlider), roomRow = fine(roomSlider);
    const pnpToggle = new Toggle({ label: 'A finger on the BC558C', value: false, onChange: (v) => { pnpFinger = v; update(); } });
    const npnToggle = new Toggle({ label: 'A finger on the BC548C', value: false, onChange: (v) => { npnFinger = v; update(); } });
    const runToggle = new Toggle({ label: 'Sequencer running', value: running, onChange: (v) => { running = v; acc = 0; } });
    const nextBtn = new Button({ label: 'Next note', onClick: () => { pos = (pos + 1) % 8; acc = 0; update(); } });
    const tuneBtn = new Button({
      label: 'Tune it exactly',
      onClick: () => {
        pots[4] = tuned.turn;
        trims[4] = tuned.trim;
        potSlider.set(tuned.turn * V12);
        trimSlider.set(tuned.trim);
        update();
      },
    });
    const retuneBtn = new Button({
      label: 'Retune for this room',
      onClick: () => {
        const t = tune(LOW, room);
        pots[5] = t.turn;
        trims[5] = t.trim;
        tunedAt = room;
        potSlider.set(t.turn * V12);
        trimSlider.set(t.trim);
        update();
      },
    });
    const listenToggle = new Toggle({ label: 'Listen (quietly)', value: listen, onChange: (v) => { listen = v; update(); } });

    const sequencerNow = (cvs: number[]) => `step ${pos + 1} of 8: ${fmtCv(cvs[pos])}`;
    const wiperText = (n: ReturnType<typeof play>) => {
      const loaded = n.w.v - (n.w.r * (n.w.v - n.vm)) / (TUNING.r + n.w.r);
      return Math.abs(loaded - n.w.v) > 5e-4 ? `${sV(loaded)} (${sV(n.w.v)} with nothing on it)` : sV(loaded);
    };
    const perVolt = () => {
      const a = play(0), b = play(1);
      return `${sMV(b.ve - a.ve)} at the BC548C’s base: ${Math.log2(b.t.hz / a.t.hz).toFixed(2)} octaves (1 V per octave needs ${(DOUBLING * 1e3).toFixed(1)} mV)`;
    };

    /** Everything that follows the circuit: the schematic's words, the readouts, the tuner and tables, and the sound. */
    const update = () => {
      const t = temps();
      setText(pnpTemp, step === 1 || step === 2 || step === 5 ? `${t.pnp.toFixed(1)} °C` : '');
      setText(npnTemp, step === 2 || step === 5 ? `${t.npn.toFixed(1)} °C` : '');
      if (step === 1) {
        const f = follower(base1, t.pnp, null);
        setText(baseText, sV(base1));
        setText(meterText, mV(f.ve));
        kv[1].set('the base', sV(base1));
        kv[1].set('the emitter', `${sV(f.ve)}${Math.abs(base1) < 5e-4 && !pnpFinger && t.pnp === ROOM ? ' (his multimeter: about 480 mV)' : ''}`);
        kv[1].set('the emitter, above the base', mV(f.ve - base1));
        kv[1].set('through the 1M', fmtA((V12 - f.ve) / R_FOLLOW));
        kv[1].set('the BC558C', tempText(t.pnp, pnpFinger));
        sound(0);
        return;
      }
      if (step === 2) {
        const n = onBase(t), drift = 12 * Math.log2(n.t.hz / STEP2.t.hz);
        kv[2].set('the BC558C', tempText(t.pnp, pnpFinger));
        kv[2].set('the BC548C', tempText(t.npn, npnFinger));
        kv[2].set('the BC548C’s base', fmtV(n.ve));
        kv[2].set('pitch', pitchText(n.t));
        kv[2].set('drift since 25 °C', `${drift >= 0.05 ? '+' : drift <= -0.05 ? '−' : ''}${Math.abs(drift).toFixed(1)} semitones`);
        sound(n.t.hz);
        return;
      }
      const cvs = seq(), n = play(cvs[pos]);
      if (step === 3) {
        kv[3].set('the pot’s wiper', wiperText(n));
        kv[3].set('the sequencer now', `${sequencerNow(cvs)}, meant as ${SEQ3[pos]}`);
        kv[3].set('the mixer (the BC558C’s base)', sMV(n.vm));
        kv[3].set('the BC548C’s base', fmtV(n.ve));
        kv[3].set('pitch', pitchText(n.t));
        kv[3].set('per volt of CV', perVolt());
        seqRows.forEach((r, k) => {
          setText(r.plays, playsText(play(cvs[k]).t));
          setClass(r.tr, 'current', k === pos);
        });
      } else if (step === 4) {
        const lo = play(0), hi = play(range), r = trims[4];
        setText(trimText, `${(r / 100).toFixed(2)} of 10 turns`);
        kv[4].set('the pot’s wiper', wiperText(n));
        kv[4].set('the trimmer', `${Math.round(r)} Ω: ${((TUNING.fixed + r) / 1e3).toFixed(3)}k to ground with the 1.5k`);
        kv[4].set('the sequencer now', `${sequencerNow(cvs)}, the ${pos < 4 ? 'low' : 'high'} note`);
        kv[4].set('the BC548C’s base', fmtV(n.ve));
        kv[4].set('pitch', pitchText(n.t));
        kv[4].set('per volt of CV', perVolt());
        highRow.setLabel(`${range} V`);
        lowRow.set(lo.t.hz);
        highRow.set(hi.t.hz);
        setClass(lowRow.el, 'current', pos < 4);
        setClass(highRow.el, 'current', pos >= 4);
        const span = cents(hi.t.hz, lo.t.hz), want = 1200 * range, low = noteOf(lo.t.hz);
        const octaves = range === 1 ? 'an octave' : `${range} octaves`;
        setText(spanNote, `From 0 V to ${range} V: ${Math.round(span)} cents, where ${octaves} is ${want}.`);
        const lowOk = low.name.startsWith('C') && !low.name.startsWith('C♯') && Math.abs(low.cents) <= IN_TUNE;
        const spanOk = Math.abs(span - want) <= IN_TUNE;
        setText(
          verdict,
          lowOk && spanOk
            ? `In tune over ${range} V: 0 V plays ${low.name} and the top steps ${octaves} higher, each within ${IN_TUNE} cents.${range < 5 ? ` Now check ${range === 1 ? 2 : 5} V.` : ''}`
            : [
                lowOk ? '' : `The low note isn’t on a C yet: the offset pot moves both notes.`,
                spanOk ? '' : `The gap is ${Math.abs(Math.round(span - want))} cents too ${span < want ? 'narrow: turn the trimmer up' : 'wide: turn the trimmer down'}.`,
              ]
                .filter(Boolean)
                .join(' '),
        );
      } else {
        const meant = noteHz(SEQ5[pos]), off = cents(n.t.hz, meant), then: Temps = { pnp: tunedAt, npn: tunedAt };
        /** Part 2's converter, tuned the same when this one was: its BC548C's base held where the follower put it then, the BC548C now in this room. */
        const part2 = (cv: number) => sinkTimes(collectorCurrent(play(cv, then).ve, room)).hz;
        setText(trimText, `${(trims[5] / 100).toFixed(2)} of 10 turns`);
        kv[5].set('the room', `${room.toFixed(1)} °C, both transistors with it`);
        kv[5].set('tuned at', `${tunedAt.toFixed(1)} °C`);
        kv[5].set('the sequencer now', `${sequencerNow(cvs)}, meant as ${SEQ5[pos]}`);
        kv[5].set('pitch', pitchText(n.t));
        kv[5].set('off the note meant', offText(off));
        kv[5].set('part 2’s converter would be', offText(cents(part2(cvs[pos]), meant)));
        nowRow.setLabel(`step ${pos + 1}`);
        nowRow.set(n.t.hz);
        majorRows.forEach((r, k) => {
          const m = noteHz(SEQ5[k]);
          setText(r.off, offText(cents(play(cvs[k]).t.hz, m)));
          setText(r.part2, offText(cents(part2(cvs[k]), m)));
          setClass(r.tr, 'current', k === pos);
        });
      }
      sound(n.t.hz);
    };

    /** A new step: its parts of the schematic, its controls, its readouts and its text. */
    const apply = () => {
      gAlone.show(step === 1);
      gCore.show(step >= 2);
      gGround.show(step === 2);
      gMix.show(step >= 3);
      g4k.show(step === 3);
      gTrim.show(step >= 4);
      sch.el.setAttribute('aria-label', schematicLabel(step));
      const show = (el: HTMLElement, v: boolean) => (el.style.display = v ? '' : 'none');
      show(baseRow, step === 1);
      show(potRow, step >= 3);
      show(trimRow, step >= 4);
      show(roomRow, step === 5);
      show(rangeSel, step === 4);
      show(pnpToggle.el, step <= 2);
      show(npnToggle.el, step === 2);
      show(runToggle.el, step >= 3);
      show(nextBtn.el, step >= 3);
      show(tuneBtn.el, step === 4);
      show(retuneBtn.el, step === 5);
      show(listenToggle.el, step >= 2);
      show(recorderPanel, step === 2);
      show(sequencePanel, step === 3);
      show(tunerPanel, step >= 4);
      show(lowRow.el, step === 4);
      show(highRow.el, step === 4);
      show(spanNote, step === 4);
      show(verdict, step === 4);
      show(nowRow.el, step === 5);
      show(majorHead, step === 5);
      show(majorTable, step === 5);
      show(majorNote, step === 5);
      if (step >= 3) potSlider.set(pots[step === 3 ? 3 : step === 4 ? 4 : 5] * V12);
      if (step >= 4) trimSlider.set(trims[step === 4 ? 4 : 5]);
      // each step starts cool: the fingers come off, and the transistors are at room temperature again
      pnpFinger = npnFinger = false;
      pnpToggle.set(false);
      npnToggle.set(false);
      pnpT = npnT = ROOM;
      if (step === 2) {
        for (const lane of rec) lane.length = 0;
        recAcc = 0;
        record();
      }
      kvHost.replaceChildren(kv[step].el);
      setText(status, stepText(step));
      update();
    };

    // ---- each frame: the sequencer moves on, the transistors warm or cool, and the chart recorder reads
    d.add(
      animate((ms) => {
        const dt = Math.min(ms, 100) / 1000;
        let changed = false;
        if (step >= 3 && running) {
          acc += dt;
          while (acc >= NOTE_S) {
            acc -= NOTE_S;
            pos = (pos + 1) % 8;
            changed = true;
          }
        }
        if (step <= 2) {
          const warm = (t: number, finger: boolean) => {
            const target = finger ? FINGER : ROOM;
            return Math.abs(t - target) < 0.005 ? target : target + (t - target) * Math.exp(-dt / WARM_TAU);
          };
          const p = warm(pnpT, pnpFinger), n = step === 2 ? warm(npnT, npnFinger) : npnT;
          if (p !== pnpT || n !== npnT) {
            pnpT = p;
            npnT = n;
            changed = true;
          }
        }
        if (step === 2) {
          recAcc += dt;
          while (recAcc >= REC_DT) {
            recAcc -= REC_DT;
            record();
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
          { accent: 'red', chips: 'BC558C · 1M · ±12 V · the offset pot, now to −12 V · 1.5k and a 1k ten-turn trimmer for the 4k · part 2’s converter: 40106, BC548C, 1N4148, 2.2 nF, 100k ×2 · a jack for the CV · part 1’s output stage' },
          row(stepSel, rangeSel, pnpToggle.el, npnToggle.el, runToggle.el, nextBtn.el, tuneBtn.el, retuneBtn.el, listenToggle.el),
          baseRow,
          potRow,
          trimRow,
          roomRow,
          h('div', { class: 'synth-circuit' }, schBox(sch).el, kvHost),
          status,
        ),
        recorderPanel,
        sequencePanel,
        tunerPanel,
        notes(sagCents(tuned)),
      ),
    );
    apply();
    return d.dispose;
  },
});

function notes(sag: number): HTMLElement {
  return panel(
    'From the video',
    { accent: 'gray' },
    note('Moritz pictures the PNP transistor in his water pipes too, upside down: the emitter on top, the collector below. Water gets from the emitter to the collector only when it can also leave by the base, so it opens as the base drops below the emitter (by about 0.7 V before its spring gives, in his picture), the spring pulling rather than pushing. What matters here: warmth opens it just as it opens the NPN, and about as much.'),
    note(`An emitter follower is a divider of the 1M and the transistor, used as a voltage-controlled resistor: what is on the base appears at the emitter, plus a fixed amount (about 500 mV in his experiments, 480 mV on his multimeter). It is negative current feedback: a smaller resistor lets more current in, but the transistor opens to let it through, so the 1M’s value hardly matters to the voltage. It sets the most current the follower can give, and a base needs little: hence 1M. (In the model that also holds the BC548C under about ${fmtA(MOST)}, so the core can no longer stop, as it could in part 2.)`),
    note('Biasing: for a follower the transistor should sit in its linear region, and his rule of thumb is half the supply on the base. 6 V on the base is out of the question here, so the collector goes to −12 V instead: the range is then 24 V around 0 V, and the base can stay near 0 V. The BC558’s pins are in the BC548’s order: collector, base, emitter.'),
    note('The pot now goes to −12 V: the mixer is a divider with two inputs either way, and doesn’t mind which side of 0 V they are on, so it subtracts as well as it adds.'),
    note(`Why a trimmer rather than the right resistor: his supply, he says, is hardly ever exactly ±12 V, and sags as modules are added. In the model a sagging supply moves every note alike, about ${Math.round(sag)} cents for both rails 0.1 V low: an offset, which the offset pot puts back. The scale is a ratio of resistors and doesn’t care. The trimmer earns its place anyway: the resistors’ tolerance, and the transistors’ temperature through V_T, set where it has to go.`),
    note('Tuning: four steps at the sequencer’s lowest level (0 V) and four at its highest, which on his SQ-1 is 1, 2 or 5 V, and Ableton’s tuner plugin, since by ear he finds it hard. The low note onto a C with the offset pot, the high one onto the C above with the trimmer, back and forth; then the 2 V and 5 V ranges check out, and in major mode the sequence sounds harmonious. Part 4 adds a fine-tune knob and a square wave.'),
    note(
      `Estimates here: the BC558C’s I_S is set so that its emitter sits 480 mV above its base for the 1M’s ${fmtA(ALONE.ic)}, as his multimeter read (onsemi’s typical 620 mV at 2 mA would make it about ${mV(vebFrom(0.62))}, Fairchild’s 660 mV about ${mV(vebFrom(0.66))}); its current gain is onsemi’s typical for the C grade at 10 µA, 270, and it follows SPICE’s law for temperature, as the BC548C does. Only the transistors warm here: the 40106, the capacitor and the resistors don’t. The finger’s ${FINGER} °C and ${WARM_TAU} s are made up, as in part 2’s lab. The rails are taken as exactly ±12 V, 0 V on the jack is meant as C2, and the sequences are the lab’s own. Listen plays a sawtooth at the core’s pitch: the browser’s own, rising where the core’s falls.`,
    ),
  );
}
