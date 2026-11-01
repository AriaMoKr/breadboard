import { Circuit } from '../../logic/circuit';
import { Button, Scope, Toggle, note, panel, readouts, row, select, type ScopeChannel } from '../../ui/components';
import { Disposer, animate, h, s, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { Kit, kitCss } from '../clock/_draw';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { Coupling, PHONES, R_OUT, SchmittCore, VBAT, VDIODE, VN, VP, coreTimes, coreWave, par, sampleCore } from './_analog';
import { battery, diode, jack, railDown, schmitt } from './_draw';
import { Tone } from './_sound';

const SCOPE_CLASS = 'synth-core';
const R = 100e3; // the 100k resistors, four of them
const C = 2.2e-9; // the core's 2.2 nF foil capacitor
const CC = 1e-6; // the 1 µF foil capacitor that AC-couples the output
const LINE_IN = 10e3; // an amplifier's line input, for the note on what else a jack could put on the core
const N = 500; // scope readings
const DT = 0.8e-6; // between readings: 0.4 ms across
const PRE = 12; // readings before the jump the scope triggers on
const AC_SPAN = 1.2; // the AC-coupled lanes show ±1.2 V; while the 1 µF charges, the wave comes down into them

/** The core alone; the capacitor with headphones on it; the core with a line input on it instead. */
const CORE = coreTimes(R, C);
const HELD = ((VBAT - VDIODE) * par(R, PHONES)) / (par(R, PHONES) + R_OUT);
const LINE = coreTimes(par(R, LINE_IN), C);
/** The wave after the 1 µF, once settled: centred on its average. */
const SETTLED = { lo: VN - CORE.mean, hi: VP - CORE.mean };

const CSS = `
.${SCOPE_CLASS} .synth-circuit { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; }
.${SCOPE_CLASS} .synth-circuit .schematic { flex: 1 1 380px; min-width: 0; }
.${SCOPE_CLASS} .synth-kv { flex: 1 1 220px; }
.${SCOPE_CLASS} .schmitt-sign { stroke-width: 1.5; }
.${SCOPE_CLASS} .kv dd { font-variant-numeric: tabular-nums; }
`;

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: { value: `${Step}`; label: string }[] = [
  { value: '1', label: '1. The core: a sawtooth' },
  { value: '2', label: '2. A jack straight on it' },
  { value: '3', label: '3. A buffer' },
  { value: '4', label: '4. AC coupling' },
  { value: '5', label: '5. A divider, to listen' },
];

/** Volts with a sign, to two places. */
const fmtV = (v: number) => `${v < -0.004 ? '−' : v > 0.004 ? '+' : ''}${Math.abs(v).toFixed(2)} V`;
const us = (t: number) => `${(t * 1e6).toFixed(t < 1e-5 ? 2 : 0)} µs`;
const kHz = (period: number) => `${(1 / period / 1e3).toFixed(period < 1e-5 ? 0 : 1)} kHz`;
const SWING = `from ${VN} to ${VP} V`;

/** The schematic's words, per step. */
function schematicLabel(step: Step, plugged: boolean): string {
  const core = 'one Schmitt-trigger inverter of a 40106 on 9 V, its input with 2.2 nF and 100k to ground and a 1N4148 from its output back to its input';
  const buffer = 'the capacitor to the + input of a TL074 op amp on ±9 V, wired as a voltage follower';
  switch (step) {
    case 1:
      return `Schematic of the core: ${core}.`;
    case 2:
      return `Schematic: the core (${core}), and a jack socket wired straight to the capacitor, ${plugged ? 'with headphones plugged in' : 'with nothing plugged in'}.`;
    case 3:
      return `Schematic: the core (${core}); ${buffer}.`;
    case 4:
      return `Schematic: the core (${core}); ${buffer}; after it, a 1 µF capacitor in series with 100k to ground.`;
    case 5:
      return `Schematic: the core (${core}); ${buffer}; after it, a 1 µF capacitor in series with 100k to ground, then a divider of two 100k whose middle goes to the jack.`;
  }
}

/** What the callout says, per step. */
function stepText(step: Step, plugged: boolean): string {
  switch (step) {
    case 1:
      return `The 40106’s inverter turns its input upside down, with a difference: its output goes low only once the input rises past about ${VP} V, and high again only once it falls under about ${VN} V. While the output is high, it fills the 2.2 nF through the diode almost at once, in about ${us(CORE.rise)}. Past ${VP} V the output goes low, the diode blocks, and the capacitor can only drain through the 100k, slowly: 100k × 2.2 nF × ln(${VP} ÷ ${VN}) ≈ ${us(CORE.fall)} to fall to ${VN} V. Then the output goes high and it starts again: a sawtooth that jumps up and falls slowly, about ${kHz(CORE.period)}. Only the fall sets the pitch, which is what will make it easy to control.`;
    case 2:
      return plugged
        ? `A jack wired straight to the capacitor puts whatever is plugged into it beside the 100k. Headphones (about ${PHONES} Ω, assumed here) drain it far faster than the 40106 can fill it through the diode: the capacitor gets no higher than about ${HELD.toFixed(1)} V, never reaches the ${VP} V threshold, and the output stays high. The oscillation stops, as Moritz says it would. Unplug them and it starts again.`
        : 'With nothing plugged into the jack, the socket draws no current and the core runs as before. Plug the headphones in to see what they do to it.';
    case 3:
      return `A TL074 op amp as a voltage follower: its output (pin 1) is wired back to its − input (pin 2), so it drives the output to whatever is on its + input (pin 3). That input draws almost no current, so the core runs as if nothing were there, while the output can feed a load from the batteries. The TL074 runs on ±9 V, from two 9 V batteries in series with their middle as ground: room above and below the wave (headroom), since a TL074’s inputs and output can’t get all the way to its supply rails. The copy still sits ${VN} to ${VP} V above ground, an offset of about ${CORE.mean.toFixed(1)} V that headphones and amplifiers shouldn’t get.`;
    case 4:
      return `The 1 µF in series passes the wave’s changes but not its average. The 100k after it, to ground, lets it charge up to the average, about ${CORE.mean.toFixed(2)} V, in about half a second (five time constants of 1 µF × 100k = 0.1 s). Then the wave is centred on 0 V, ${fmtV(SETTLED.lo)} to ${fmtV(SETTLED.hi)}: on its average rather than its middle, since the slow fall spends a little longer near the bottom. Start again to watch it settle.`;
    case 5:
      return `Two more 100k halve the wave, as Moritz’s scope shows it going from three divisions to one and a half: ${fmtV(SETTLED.lo / 2)} to ${fmtV(SETTLED.hi / 2)} at the jack, for an amplifier’s or an audio interface’s input. Beside the 100k to ground, they also let the 1 µF settle a little faster (100k ∥ 200k ≈ 67k). Turn on Listen: about ${kHz(CORE.period)}, a high whine, far higher than a VCO needs. Part 2 brings it down and puts it under control.`;
  }
}

/** The scope's note, per step. */
const SCOPE_NOTES: Record<Step, string> = {
  1: 'About 0.4 ms across, triggered on a jump: four cycles and a bit. The output is high only for the moment each jump takes.',
  2: 'A single shot, 0.4 ms across: the headphones go in (or come out) halfway along.',
  3: 'The buffer’s output is the capacitor’s wave, copied.',
  4: 'At first the wave is off the top of the lower lane, still about 4.3 V up; it comes down into view as the 1 µF charges, until its average is at 0 V.',
  5: 'After the divider: half the size on the same scale, still centred on 0 V.',
};

/** Readings 0.4 ms across of the core running steadily, a jump `PRE` readings in. */
function steadyWindow() {
  const core = new SchmittCore(R, C);
  core.vc = VP;
  core.high = false;
  core.step(CORE.fall - PRE * DT);
  return sampleCore(core, DT, N);
}

/** A single shot of the headphones going in (or coming out) halfway along. */
function jackShot(plugIn: boolean) {
  const core = new SchmittCore(R, C);
  if (plugIn) {
    core.vc = VP;
    core.high = false;
    core.step(CORE.fall - PRE * DT);
  } else {
    core.load = PHONES;
    core.vc = HELD;
  }
  const at = Math.round(N / 2);
  const a = sampleCore(core, DT, at);
  core.load = plugIn ? PHONES : Infinity;
  const b = sampleCore(core, DT, N - at);
  return { vc: [...a.vc, ...b.vc], out: [...a.out, ...b.out], at, label: plugIn ? 'headphones in' : 'headphones out' };
}

export default defineLab({
  id: 'oscillator-core',
  title: 'The oscillator core',
  summary:
    'Part 1 of Moritz Klein’s DIY VCO: the analog oscillator core anyone can build. One Schmitt-trigger inverter of a 40106, a diode, 2.2 nF and 100k make a sawtooth that jumps up at once and falls slowly, about 11,000 times a second. A jack straight on it stops it, so a TL074 follower buffers it, a 1 µF capacitor and 100k centre it on 0 V, and two more 100k halve it for an amplifier. Each step shows the schematic and a scope, and the last one plays it.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE_CLASS });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE_CLASS) + CSS));

    let step: Step = 1, plugged = true, listen = false;

    // ---- the schematic: the core, then what each step adds to it
    const dc = new Circuit();
    const sch = new Schematic(dc, { width: 540, height: 250, label: 'Schematic' });
    const kit = new Kit(sch, dc);

    // one battery for the core; two in series for the TL074's ±9 V, their middle as ground
    const gBat1 = kit.group(() => {
      battery(kit, 40, 130, '9 V');
      kit.ana('plain', [40, 112], [40, 98]);
      kit.vcc(40, 98, '+9 V');
      kit.ana('plain', [40, 148], [40, 160]);
      kit.ground(40, 160);
      kit.text('one battery', [40, 200], { size: 10, class: 'dim' });
    });
    const gBat2 = kit.group(() => {
      kit.vcc(40, 52, '+9 V');
      kit.ana('plain', [40, 52], [40, 64]);
      battery(kit, 40, 82, '9 V');
      kit.ana('plain', [40, 100], [40, 122]);
      kit.anaDot('plain', [40, 111]);
      kit.ana('plain', [40, 111], [62, 111]);
      kit.ground(62, 111);
      battery(kit, 40, 140, '9 V');
      kit.ana('plain', [40, 158], [40, 170]);
      railDown(kit, 40, 170, '−9 V');
      kit.text('two batteries', [40, 212], { size: 10, class: 'dim' });
    });

    // the core: inverter 1 of the 40106, the diode from its output back to its input, 2.2 nF and 100k to ground
    kit.group(() => {
      const inv = schmitt(kit, 150, 130);
      kit.ana('ana', [120, 130], inv.in);
      kit.text('1', [146, 123], { anchor: 'end', size: 9, class: 'faint' });
      kit.text('2', [202, 123], { anchor: 'start', size: 9, class: 'faint' });
      kit.ana('plain', [165, 117.5], [165, 104]);
      kit.text('+9 V', [165, 96], { size: 10, class: 'dim' });
      kit.text('14', [170, 111], { anchor: 'start', size: 9, class: 'faint' });
      kit.ana('plain', [170, 140], [170, 152]);
      kit.ground(170, 152);
      kit.text('7', [175, 146], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('40106', [212, 150], { anchor: 'start', size: 9, class: 'dim' });
      kit.ana('plain', inv.out, [232, 130], [232, 75], [207, 75]);
      diode(kit, 195, 75, 'left');
      kit.text('1N4148', [195, 61], { size: 10 });
      kit.ana('ana', [183, 75], [120, 75], [120, 176.5]);
      kit.anaDot('ana', [120, 130]);
      kit.cap(120, 180, 'v', '2.2 nF', 'right');
      kit.ana('plain', [120, 183.5], [120, 196]);
      kit.ground(120, 196);
      kit.anaDot('ana', [120, 150]);
      kit.ana('ana', [120, 150], [85, 150], [85, 160]);
      kit.resistor(85, 175, 'v', '100k', 'left');
      kit.ana('plain', [85, 190], [85, 196]);
      kit.ground(85, 196);
      kit.text('its other inputs (3, 5, 9, 11, 13) to ground', [150, 236], { size: 9, class: 'dim' });
    });

    // steps 2-5: a wire from the capacitor over to the right
    const gTap = kit.group(() => {
      kit.anaDot('ana', [120, 75]);
      kit.ana('ana', [120, 75], [120, 40], [255, 40], [255, 100], [270, 100]);
    });

    // step 2: a jack socket on it
    const gJack = kit.group(() => {
      const j = jack(kit, 270, 100);
      kit.ana('plain', j.sleeve, [262, 117], [262, 128]);
      kit.ground(262, 128);
    });
    const gPhones = kit.group(() => kit.text(`headphones in (about ${PHONES} Ω)`, [278, 152], { anchor: 'start', size: 10, class: 'dim' }));
    const gNoPhones = kit.group(() => kit.text('nothing plugged in', [278, 152], { anchor: 'start', size: 10, class: 'dim' }));

    // steps 3-5: op amp 1 of the TL074 as a voltage follower
    const gBuf = kit.group(() => {
      kit.comparator(270, 115, '+');
      kit.ana('ana', [315, 115], [330, 115]);
      kit.anaDot('ana', [330, 115]);
      kit.ana('ana', [330, 115], [330, 165], [258, 165], [258, 130], [270, 130]);
      kit.ana('plain', [285, 98.3], [285, 86]);
      kit.text('+9 V', [285, 78], { size: 10, class: 'dim' });
      kit.ana('plain', [285, 131.7], [285, 144]);
      kit.text('−9 V', [285, 153], { size: 10, class: 'dim' });
      kit.text('3', [264, 93], { anchor: 'end', size: 9, class: 'faint' });
      kit.text('2', [265, 139], { anchor: 'end', size: 9, class: 'faint' });
      kit.text('1', [320, 108], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('4', [290, 91], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('11', [290, 139], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('TL074', [294, 182], { size: 9, class: 'dim' });
    });
    const outTo = (x: number) =>
      kit.group(() => {
        kit.ana('ana', [x - 30, 115], [x - 4, 115]);
        kit.over.appendChild(s('circle', { cx: x, cy: 115, r: 3.5, class: 'contact' }));
        kit.text('out', [x + 8, 115], { anchor: 'start', size: 10, class: 'dim' });
      });
    const gOut3 = outTo(360);

    // steps 4 and 5: 1 µF in series, 100k to ground after it
    const gAc = kit.group(() => {
      kit.ana('ana', [330, 115], [356.5, 115]);
      kit.cap(360, 115, 'h', '1 µF', 'top');
      kit.ana('ana', [363.5, 115], [385, 115]);
      kit.anaDot('ana', [385, 115]);
      kit.ana('ana', [385, 115], [385, 135]);
      kit.resistor(385, 150, 'v', '100k', 'left');
      kit.ana('plain', [385, 165], [385, 172]);
      kit.ground(385, 172);
    });
    const gOut4 = outTo(415);

    // step 5: the divider, and the jack at its middle
    const gDiv = kit.group(() => {
      kit.ana('ana', [385, 115], [430, 115], [430, 135]);
      kit.resistor(430, 150, 'v', '100k', 'left');
      kit.ana('ana', [430, 165], [430, 195]);
      kit.anaDot('ana', [430, 180]);
      kit.resistor(430, 210, 'v', '100k', 'left');
      kit.ana('plain', [430, 225], [430, 232]);
      kit.ground(430, 232);
      const j = jack(kit, 452, 180);
      kit.ana('ana', [430, 180], j.tip);
      kit.ana('plain', j.sleeve, [452, 214]);
      kit.ground(452, 214);
    });

    // ---- the scope: the lanes each step shows
    const capLane: ScopeChannel = { label: 'the capacitor, 40106 pin 1: 3 to 6 V (thresholds dashed)', kind: 'analog', min: 3, max: 6, guides: [VN, VP], color: '#a78bfa' };
    const capWide: ScopeChannel = { label: 'the capacitor: 0 to 6 V', kind: 'analog', min: 0, max: 6, guides: [VN, VP], color: '#a78bfa' };
    const outLane: ScopeChannel = { label: 'the 40106’s output, pin 2: 0 to 9 V', kind: 'analog', min: 0, max: 9.5, color: '#f59e0b' };
    const bufLane: ScopeChannel = { label: 'the buffer’s output, TL074 pin 1: 3 to 6 V', kind: 'analog', min: 3, max: 6, guides: [VN, VP], color: '#4ade80' };
    const acLane: ScopeChannel = { label: `after the 1 µF: −${AC_SPAN} to +${AC_SPAN} V (0 V dashed)`, kind: 'analog', min: -AC_SPAN, max: AC_SPAN, guides: [0], color: '#60a5fa' };
    const jackLane: ScopeChannel = { label: 'the jack, after the divider: the same scale', kind: 'analog', min: -AC_SPAN, max: AC_SPAN, guides: [0], color: '#4ade80' };
    const lanes: Record<Step, ScopeChannel[]> = { 1: [capLane, outLane], 2: [capWide, outLane], 3: [capLane, bufLane], 4: [bufLane, acLane], 5: [acLane, jackLane] };
    const scopes = {} as Record<Step, Scope>;
    for (const k of [1, 2, 3, 4, 5] as const) scopes[k] = new Scope(lanes[k], { width: 640, laneHeight: 70 });
    const scopeNote = h('p', { class: 'note' });
    const scopeHost = h('div');

    // ---- readouts
    const kv = {
      1: readouts(['thresholds (typical, on 9 V)', 'the capacitor', 'the jump (through the diode)', 'the fall (through the 100k)', 'pitch']),
      2: readouts(['the jack', 'the capacitor', 'the 40106’s output (pin 2)', 'pitch']),
      3: readouts(['the capacitor', 'the buffer’s output (pin 1)', 'its average', 'pitch']),
      4: readouts(['the buffer’s output', 'after the 1 µF, settled', 'its average now', 'settled in', 'pitch']),
      5: readouts(['after the 1 µF, settled', 'at the jack, settled', 'its average now', 'settled in', 'pitch']),
    };
    const pitch = `${kHz(CORE.period)} (1 ÷ ${us(CORE.period)})`;
    const settled = `${fmtV(SETTLED.lo)} to ${fmtV(SETTLED.hi)}`;
    kv[1].set('thresholds (typical, on 9 V)', `${VP} V going up, ${VN} V coming down`);
    kv[1].set('the capacitor', SWING);
    kv[1].set('the jump (through the diode)', `about ${us(CORE.rise)}`);
    kv[1].set('the fall (through the 100k)', `${us(CORE.fall)} = 100k × 2.2 nF × ln(${VP} ÷ ${VN})`);
    kv[1].set('pitch', pitch);
    kv[3].set('the capacitor', SWING);
    kv[3].set('the buffer’s output (pin 1)', `${SWING}: the same`);
    kv[3].set('its average', fmtV(CORE.mean));
    kv[3].set('pitch', pitch);
    kv[4].set('the buffer’s output', `${SWING}, on average ${fmtV(CORE.mean)}`);
    kv[4].set('after the 1 µF, settled', settled);
    kv[4].set('settled in', `about ${(5 * R * CC).toFixed(1)} s (5 × 1 µF × 100k)`);
    kv[4].set('pitch', pitch);
    kv[5].set('after the 1 µF, settled', settled);
    kv[5].set('at the jack, settled', `${fmtV(SETTLED.lo / 2)} to ${fmtV(SETTLED.hi / 2)}`);
    kv[5].set('settled in', `about ${(5 * par(R, 2 * R) * CC).toFixed(2)} s (5 × 1 µF × 67k)`);
    kv[5].set('pitch', pitch);
    const kvHost = h('div', { class: 'synth-kv' });
    const status = callout();

    // ---- the models: the core runs steadily, so a triggered scope shows the same 0.4 ms each time
    const win = steadyWindow();
    let shot = jackShot(plugged);
    const coupling = new Coupling(R, CC);
    const wave = coreWave(256, R, C);
    const tone = new Tone();
    d.add(() => tone.dispose());
    const sound = () => {
      if (step === 5 && listen) tone.wave(1 / CORE.period, wave);
      else tone.stop();
    };

    // ---- controls
    const stepSel = select<`${Step}`>(STEPS, '1', (v) => { step = Number(v) as Step; apply(); }, 'Step');
    const jackToggle = new Toggle({ label: 'Headphones plugged into the jack', value: plugged, onChange: (v) => { plugged = v; apply(); } });
    const againBtn = new Button({ label: 'Start again, the 1 µF empty', onClick: () => { coupling.vcap = 0; } });
    const listenToggle = new Toggle({ label: 'Listen (quietly)', value: listen, onChange: (v) => { listen = v; sound(); } });

    const apply = () => {
      gBat1.show(step < 3);
      gBat2.show(step >= 3);
      gTap.show(step >= 2);
      gJack.show(step === 2);
      gPhones.show(step === 2 && plugged);
      gNoPhones.show(step === 2 && !plugged);
      gBuf.show(step >= 3);
      gOut3.show(step === 3);
      gAc.show(step >= 4);
      gOut4.show(step === 4);
      gDiv.show(step === 5);
      sch.el.setAttribute('aria-label', schematicLabel(step, plugged));
      jackToggle.el.style.display = step === 2 ? '' : 'none';
      againBtn.el.style.display = step >= 4 ? '' : 'none';
      listenToggle.el.style.display = step === 5 ? '' : 'none';
      kvHost.replaceChildren(kv[step].el);
      setText(status, stepText(step, plugged));
      if (step === 2) {
        shot = jackShot(plugged);
        kv[2].set('the jack', plugged ? `headphones in (about ${PHONES} Ω)` : 'nothing plugged in');
        kv[2].set('the capacitor', plugged ? `about ${HELD.toFixed(2)} V, under the ${VP} V it needs` : SWING);
        kv[2].set('the 40106’s output (pin 2)', plugged ? `+${VBAT} V: it stays high` : 'high only for each jump');
        kv[2].set('pitch', plugged ? 'none: it stopped' : pitch);
      }
      // the coupling capacitor starts empty with each step
      coupling.r = step === 5 ? par(R, 2 * R) : R;
      coupling.vcap = 0;
      scopeHost.replaceChildren(scopes[step].el);
      setText(scopeNote, SCOPE_NOTES[step]);
      sound();
      frame(0);
    };

    // ---- each frame: the 1 µF charges in real time; the scope shows the latest 0.4 ms
    const frame = (ms: number) => {
      if (step >= 4) coupling.step(Math.min(ms, 100) / 1000, CORE.mean);
      const sc = scopes[step];
      if (step === 1) sc.draw([win.vc, win.out], { window: N });
      else if (step === 2) sc.draw([shot.vc, shot.out], { window: N, markers: [{ at: shot.at, label: shot.label, dashed: true, color: '#f87171' }] });
      else if (step === 3) sc.draw([win.vc, win.vc], { window: N });
      else {
        // off the scale at first, as on a scope: held at the lane's edge
        const clip = (v: number) => Math.max(-AC_SPAN, Math.min(AC_SPAN, v));
        const ac = win.vc.map((v) => coupling.out(v));
        sc.draw(step === 4 ? [win.vc, ac.map(clip)] : [ac.map(clip), ac.map((v) => clip(v / 2))], { window: N });
        const avg = CORE.mean - coupling.vcap;
        kv[step].set('its average now', fmtV(step === 4 ? avg : avg / 2));
      }
    };
    d.add(animate((ms) => frame(ms)));

    wrap.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'The circuit',
          { accent: 'red', chips: '40106 · TL074 (one of its four op amps) · 1N4148 · 2.2 nF and 1 µF foil · 100k ×4 · a jack socket · two 9 V batteries' },
          row(stepSel, jackToggle.el, againBtn.el, listenToggle.el),
          h('div', { class: 'synth-circuit' }, sch.el, kvHost),
          status,
        ),
        panel('Scope', { accent: 'yellow' }, scopeHost, scopeNote),
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
    note('Moritz sets out to build the simplest VCO that is still musically useful: one that tracks 1 V per octave well enough for a standard sequencer to play it. Part 1 is its core; part 2 puts the pitch under a control voltage.'),
    note('He explains voltage and current as pressure and flow in a water pipe. A square wave switches between two levels; a sawtooth’s pitch is set by its slow fall alone, which makes it easy to control.'),
    note('The 40106 has six Schmitt-trigger inverters. A Schmitt trigger switches at one voltage going up and at a lower one coming down, which is what lets the core oscillate. The schematic here uses the first (input pin 1, output pin 2; 9 V on pin 14, ground on pin 7). Moritz ties the other five inputs to ground: left open, they pick up noise and switch on their own, which upsets the one in use.'),
    note('A jack straight on the capacitor drains it, so a TL074 follower buffers the core first. Its ±9 V comes from two 9 V batteries in series, their middle as ground (or a dual supply). Then 1 µF and 100k centre the wave on 0 V, and a 100k/100k divider halves it before the jack. (Part 2 starts by swapping the divider’s two 100k for 10k: the top of his wave looked odd, which he puts down to the 100k/100k making an accidental band-pass filter.)'),
    note(
      `Estimates here: the 40106’s thresholds on 9 V are interpolated from TI’s typical values, and chips differ by a volt or more; the diode drops ${VDIODE} V, and the 40106’s output is taken as about ${R_OUT} Ω. The chip’s delay of some tens of nanoseconds is left out: in a real core the capacitor overshoots the upper threshold a little, which lowers the pitch. So a real one can be well off ${kHz(CORE.period)}, which part 3’s tuning is about. Headphones are taken as about ${PHONES} Ω. An amplifier’s line input (about 10k) wouldn’t stop the core but drain it faster, to about ${kHz(LINE.period)}, far above hearing: either way, what’s plugged in sets the pitch, which is why the buffer goes in.`,
    ),
  );
}
