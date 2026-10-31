import { LayoutView } from '../../breadboard/render';
import { Circuit } from '../../logic/circuit';
import { Scope, Toggle, note, panel, readouts, row, select, type ScopeChannel } from '../../ui/components';
import { Disposer, animate, h, s, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { Kit, kitCss } from '../clock/_draw';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { FloatingInput, Relaxation, VBAT, VLED, VSAT, comparator, divide, ledCurrent, relaxationPeriod } from './_analog';
import { SUPPLY_COLORS, VIEW, drawLeads, drawStrips, guideLayout, type Jumper, type Setup, type Step } from './_board';
import { battery, jack, ledUp, railDown } from './_draw';
import { Tone } from './_sound';

const SCOPE_CLASS = 'synth-guide';
const C = 1e-6; // the 1 µF foil capacitor
/** The output's divider to the jack in circuit 4: 10k, then 1k to ground. */
const DIV_TOP = 10e3, DIV_BOTTOM = 1e3;

const CSS = `
.${SCOPE_CLASS} .synth-bb { max-width: 640px; }
.${SCOPE_CLASS} .synth-bb .bb-svg { height: auto; aspect-ratio: ${VIEW.w} / ${VIEW.h}; touch-action: auto; border-radius: 6px; }
.${SCOPE_CLASS} .synth-battery-body { fill: #2b2b30; stroke: #000; stroke-width: 0.05; }
.${SCOPE_CLASS} .synth-battery-end { fill: #c9a23a; }
.${SCOPE_CLASS} .synth-battery-clip { fill: #141416; }
.${SCOPE_CLASS} .synth-battery-text { font-size: 1.1px; font-weight: 700; fill: #f4f4f2; font-family: var(--sans); }
.${SCOPE_CLASS} .synth-jack-body { fill: #2b2b30; stroke: #000; stroke-width: 0.05; }
.${SCOPE_CLASS} .synth-jack-bush { fill: #b9bcc2; stroke: #6b6f76; stroke-width: 0.04; }
.${SCOPE_CLASS} .synth-jack-lug { fill: #c9ccd2; stroke: #6b6f76; stroke-width: 0.04; }
.${SCOPE_CLASS} .synth-jack-text { font-size: 0.55px; fill: #e9e9ec; font-family: var(--sans); }
.${SCOPE_CLASS} .synth-pin { stroke: #b9bcc2; stroke-width: 0.14; stroke-linecap: round; }
.${SCOPE_CLASS} .synth-strip { fill: none; stroke: #c4bead; stroke-width: 0.05; }
.${SCOPE_CLASS} .synth-strip.used { fill: color-mix(in srgb, var(--net) 40%, transparent); stroke: var(--net); stroke-width: 0.08; }
.${SCOPE_CLASS} .schematic .wire.ana.pos { stroke: var(--wire-1); }
.${SCOPE_CLASS} .schematic .wire.ana.neg { stroke: var(--wire-0); }
.${SCOPE_CLASS} .synth-legend i { height: 10px; width: 14px; forced-color-adjust: none; }
.${SCOPE_CLASS} .kv dd { font-variant-numeric: tabular-nums; }
`;

const STEPS: { value: `${Step}`; label: string }[] = [
  { value: '1', label: '1. A simple LED circuit' },
  { value: '2', label: '2. An inverter' },
  { value: '3', label: '3. A low-frequency oscillator' },
  { value: '4', label: '4. An audible oscillator' },
];

/** Volts with a sign, to two places. */
const fmtV = (v: number) => `${v < -0.004 ? '−' : v > 0.004 ? '+' : ''}${Math.abs(v).toFixed(2)} V`;
const fmtMA = (a: number) => `${(a * 1e3).toFixed(1)} mA`;

/** The breadboard picture's words, per step. */
function boardLabel(su: Setup): string {
  const chip = 'the TL074 across the channel with pin 1 in column 14, its V+ (pin 4) to the + rail and its V− (pin 11) to the top rail, which the second battery makes −9 V';
  switch (su.step) {
    case 1:
      return `The breadboard, circuit 1: a 9 V battery on the bottom rails, + on the inner one; a 1k from the + rail into column 10; the LED from column 10 to 11, ${su.reversed ? 'turned round, with its long leg in 11' : 'its long leg in 10'}; a jumper from column 11 to the ground rail.`;
    case 2:
      return `The breadboard, circuit 2: ${chip}; the + input (pin 3) to ground; the output (pin 1) through a 1k to column 10 and the LED, whose short leg is in the ground rail; and a long jumper from the − input (pin 2) ${su.jumper === 'minus' ? 'to the top rail, −9 V' : su.jumper === 'loose' ? 'that is plugged into nothing' : 'to the + rail, +9 V'}.`;
    case 3:
      return `The breadboard, circuit 3: ${chip}; the + input with 100k to ground and 100k to the output; the − input with a jumper to column 7, a 1 µF foil capacitor from column 7 to 6, a jumper from column 6 to ground, and 100k to the output; the output through a 1k to the LED.`;
    case 4:
      return `The breadboard, circuit 4: as circuit 3, with 1k from the − input to the output; the output goes through 10k to column 10, which has 1k to ground and the jack’s tip lead; the jack’s sleeve lead goes into the ground rail.`;
  }
}

/** What the callout says, per step and option: it changes only with them, so nothing jumps while it runs. */
function stepText(su: Setup): string {
  const T3 = relaxationPeriod(100e3, C), T4 = relaxationPeriod(1e3, C);
  switch (su.step) {
    case 1:
      return su.reversed
        ? 'Turned round, the LED’s short leg is in the resistor’s row and its long leg in the jumper’s. An LED only lets current through from its long leg (the anode) to its short leg (the cathode), so nothing flows and it stays dark. Nothing breaks either: the whole 9 V sits across it the wrong way, and the 1k would keep any current that leaked through small.'
        : `The battery’s red lead goes into the + rail and its black lead into the − rail, which is ground (0 V) here. The 1k goes from the + rail into a row, the LED’s long leg into the same row and its short leg into the next, and a small jumper takes that row to ground. Current flows from +9 V through the 1k and the LED to ground: about (9 − ${VLED}) V ÷ 1k = ${fmtMA(ledCurrent(VBAT, 1e3))}.`;
    case 2:
      if (su.jumper === 'loose')
        return 'Left out, the − input isn’t at any voltage of its own: a TL074’s inputs draw almost no current, so it drifts with whatever is near it, mains hum from the room’s wiring among it. The output flips whenever the input crosses the + input’s 0 V, and the LED flickers, stays lit or stays dark by chance. The drift and hum here are an illustration, not a measurement: never leave an input floating.';
      return su.jumper === 'minus'
        ? `On the − rail, the − input (−9 V) is below the + input (0 V), so the output goes as high as it can, about +${VSAT} V on ±9 V, and the LED lights: (${VSAT} − ${VLED}) V ÷ 1k ≈ ${fmtMA(ledCurrent(VSAT, 1e3))}. High in, low out; low in, high out: a crude inverter.`
        : `The + input is on ground. On the + rail, the long jumper puts the − input (+9 V) above the + input (0 V), so the output goes as low as it can, about −${VSAT} V on ±9 V, and the LED stays dark. The op amp compares its two inputs and swings its output all the way: here it works as a crude inverter. Move the jumper to the − rail.`;
    case 3:
      return `The two 100k on the + input share the output between them, so the + input sits at half of it: +${(VSAT / 2).toFixed(2)} V or −${(VSAT / 2).toFixed(2)} V. The 1 µF on the − input charges towards the output through the other 100k until it passes the + input; then the output flips, the + input with it, and the capacitor heads back the other way. Each half takes 100k × 1 µF × ln 3 ≈ ${(T3 / 2).toFixed(2)} s, so the LED flashes about ${(1 / T3).toFixed(1)} times a second.`;
    case 4:
      return `With 1k from the output to the − input instead of 100k, the capacitor charges 100 times faster: about ${(1 / T4).toFixed(0)} times a second, a little above the A that orchestras tune to (440 Hz). The 10k and the 1k divide the output by 11, from about ±${VSAT} V to ±${divide(VSAT, DIV_TOP, DIV_BOTTOM).toFixed(2)} V, a level headphones, an aux input or an audio interface can take: the jack’s tip goes where the LED’s long leg was, its sleeve to ground. Turn on Listen to hear it, quietly.`;
  }
}

export default defineLab({
  id: 'using-a-breadboard',
  title: 'Using a breadboard',
  summary:
    'Moritz Klein’s beginner’s guide to the breadboard, in four circuits on one board: an LED with its resistor on a 9 V battery; a TL074 op amp on ±9 V from two batteries, as a crude inverter that lights the LED when its input goes negative; the same op amp as a square-wave oscillator that flashes the LED about 4.6 times a second; and, with a 1k in place of one 100k, the same oscillator at about 455 Hz, divided down to line level for a jack. Each step shows his breadboard, the schematic it follows, the strips inside the board and a scope, and the last one plays it.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE_CLASS });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE_CLASS) + CSS));

    let step: Step = 1, reversed = false, jumper: Jumper = 'plus', inside = false, listen = false;
    const setup = (): Setup => ({ step, reversed, jumper });

    // ---- the breadboard
    const bbHost = h('div', { class: 'synth-bb' });
    let view: LayoutView | null = null;
    const drawBoard = () => {
      const su = setup();
      view = new LayoutView(guideLayout(su), { padding: 0 });
      view.el.setAttribute('viewBox', `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`);
      view.el.setAttribute('aria-label', boardLabel(su));
      if (inside) view.el.querySelector('.bb-boards')?.after(drawStrips(su));
      view.layerOverlay.appendChild(drawLeads(su));
      bbHost.replaceChildren(view.el);
    };
    const legend = h(
      'div',
      { class: 'legend synth-legend' },
      ([['+9V', '+9 V'], ['GND', 'ground, 0 V'], ['-9V', '−9 V']] as const).map(([k, t]) => h('span', null, h('i', { style: `background:${SUPPLY_COLORS[k]}` }), t)),
      h('span', null, 'and each other connection a colour of its own'),
    );

    // ---- the schematic: one drawing per step, shown in turn
    const dc = new Circuit();
    const sch = new Schematic(dc, { width: 460, height: 260, label: 'Schematic' });
    const kit = new Kit(sch, dc);
    const live: { el: Element; v: () => number }[] = [];
    const liveWire = (...pts: [number, number][]) => kit.ana('ana', ...pts);

    // circuit 1: the battery, the 1k and the LED in a loop
    let led1!: ReturnType<Kit['led']>, led1r!: ReturnType<typeof ledUp>;
    const g1 = kit.group(() => {
      battery(kit, 120, 150, '9 V');
      kit.ana('plain', [120, 132], [120, 80], [215, 80]);
      kit.text('+9 V', [128, 70], { anchor: 'start', size: 10, class: 'dim' });
      kit.resistor(230, 80, 'h', '1k');
      kit.ana('ana', [245, 80], [320, 80], [320, 138]);
      kit.ana('plain', [320, 162], [320, 220], [120, 220], [120, 168]);
      kit.anaDot('plain', [220, 220]);
      kit.ground(220, 220);
      kit.text('0 V', [128, 232], { anchor: 'start', size: 10, class: 'dim' });
    });
    const g1led = kit.group(() => {
      led1 = kit.led(320, 150);
      kit.text('long leg', [336, 132], { anchor: 'start', size: 10, class: 'dim' });
    });
    const g1rev = kit.group(() => {
      led1r = ledUp(kit, 320, 150);
      kit.text('long leg', [336, 168], { anchor: 'start', size: 10, class: 'dim' });
    });

    // circuits 2-4: two batteries make ±9 V; the TL074's op amp 1
    const gSupply = kit.group(() => {
      kit.vcc(50, 52, '+9 V');
      kit.ana('plain', [50, 52], [50, 64]);
      battery(kit, 50, 82, '9 V');
      kit.ana('plain', [50, 100], [50, 122]);
      kit.anaDot('plain', [50, 111]);
      kit.ana('plain', [50, 111], [72, 111]);
      kit.ground(72, 111);
      battery(kit, 50, 140, '9 V');
      kit.ana('plain', [50, 158], [50, 170]);
      railDown(kit, 50, 170, '−9 V');
      kit.text('two batteries', [50, 212], { size: 10, class: 'dim' });
    });
    let outWire!: SVGPolylineElement;
    const gAmp = kit.group(() => {
      kit.comparator(200, 140, '+');
      kit.ana('plain', [215, 123.3], [215, 106]);
      kit.text('+9 V', [215, 98], { size: 10, class: 'dim' });
      kit.ana('plain', [215, 156.7], [215, 174]);
      kit.text('−9 V', [215, 182], { size: 10, class: 'dim' });
      kit.text('3', [194, 117], { anchor: 'end', size: 9, class: 'faint' });
      kit.text('2', [194, 164], { anchor: 'end', size: 9, class: 'faint' });
      kit.text('1', [252, 131], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('4', [220, 113], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('11', [220, 167], { anchor: 'start', size: 9, class: 'faint' });
      kit.text('TL074', [183, 140], { size: 9, class: 'dim' });
      outWire = liveWire([245, 140], [330, 140], [330, 150]);
    });

    // circuit 2: the + input on ground, a long jumper on the − input
    const g2 = kit.group(() => {
      kit.ana('plain', [200, 125], [170, 125]);
      kit.ground(170, 125);
    });
    const g2plus = kit.group(() => {
      kit.ana('ana', [200, 155], [140, 155], [140, 140]);
      kit.vcc(140, 140, '+9 V');
    });
    const g2minus = kit.group(() => {
      kit.ana('ana', [200, 155], [140, 155], [140, 170]);
      railDown(kit, 140, 170, '−9 V');
    });
    const g2loose = kit.group(() => {
      kit.ana('ana', [200, 155], [146, 155]);
      // its end, plugged into nothing
      kit.over.appendChild(s('circle', { cx: 142, cy: 155, r: 3.5, class: 'contact' }));
      kit.text('nothing', [140, 172], { size: 10, class: 'dim' });
    });

    // circuits 2 and 3: the output through 1k to the LED
    let ledOut!: ReturnType<Kit['led']>;
    const gLed = kit.group(() => {
      kit.resistor(330, 165, 'v', '1k');
      kit.ana('plain', [330, 180], [330, 188]);
      ledOut = kit.led(330, 200);
      kit.ana('plain', [330, 212], [330, 222]);
      kit.ground(330, 222);
    });

    // circuits 3 and 4: 100k and 100k on the + input, 1 µF and Rf on the − input
    let outNode!: SVGPolylineElement;
    const g34 = kit.group(() => {
      kit.ana('ana', [200, 125], [165, 125], [165, 80], [225, 80]);
      kit.anaDot('ana', [165, 80]);
      kit.resistor(240, 80, 'h', '100k');
      outNode = liveWire([255, 80], [290, 80], [290, 200], [255, 200]);
      kit.anaDot('ana', [290, 140]);
      kit.ana('ana', [165, 80], [130, 80], [130, 95]);
      kit.resistor(130, 110, 'v', '100k', 'left');
      kit.ana('plain', [130, 125], [130, 135]);
      kit.ground(130, 135);
      kit.ana('ana', [200, 155], [165, 155], [165, 200], [225, 200]);
      kit.anaDot('ana', [165, 200]);
      kit.ana('ana', [165, 200], [165, 218.5]);
      kit.cap(165, 222, 'v', '1 µF', 'left');
      kit.ana('plain', [165, 225.5], [165, 236]);
      kit.ground(165, 236);
      kit.resistor(240, 200, 'h');
    });
    const g3rf = kit.group(() => kit.text('100k', [240, 218], { size: 11 }));
    const g4rf = kit.group(() => kit.text('1k', [240, 218], { size: 11 }));

    // circuit 4: 10k and 1k down to the jack
    let jackNode!: SVGPolylineElement;
    const g4 = kit.group(() => {
      kit.resistor(330, 165, 'v', '10k');
      jackNode = liveWire([330, 180], [330, 200]);
      kit.anaDot('ana', [330, 192]);
      kit.resistor(330, 215, 'v', '1k');
      kit.ana('plain', [330, 230], [330, 240]);
      kit.ground(330, 240);
      const j = jack(kit, 372, 192);
      live.push({ el: liveWire([330, 192], j.tip), v: () => vJack });
      kit.ana('plain', j.sleeve, [360, 209], [360, 226]);
      kit.ground(360, 226);
    });
    live.push({ el: outWire, v: () => vOut }, { el: outNode, v: () => vOut }, { el: jackNode, v: () => vJack });

    // ---- the scope: one per step, as each shows other signals
    const out: ScopeChannel = { label: 'output, pin 1', kind: 'analog', min: -9, max: 9, guides: [0], color: '#f59e0b' };
    const scopes: Record<2 | 3 | 4, { scope: Scope; dt: number; trigger: boolean }> = {
      2: {
        scope: new Scope([out, { label: '− input, pin 2 (+ input, pin 3, dashed)', kind: 'analog', min: -9.5, max: 9.5, guides: [0], color: '#a78bfa', overlayColor: '#60a5fa' }], { width: 640, laneHeight: 70 }),
        dt: 2e-3,
        trigger: false,
      },
      3: {
        scope: new Scope([out, { label: '− input, pin 2: the capacitor (+ input dashed)', kind: 'analog', min: -4.5, max: 4.5, guides: [0], color: '#a78bfa', overlayColor: '#60a5fa' }], { width: 640, laneHeight: 70 }),
        dt: 3e-3,
        trigger: false,
      },
      4: {
        scope: new Scope(
          [out, { label: '− input, pin 2 (+ input dashed)', kind: 'analog', min: -4.5, max: 4.5, guides: [0], color: '#a78bfa', overlayColor: '#60a5fa' }, { label: 'the jack: after 10k and 1k', kind: 'analog', min: -0.9, max: 0.9, guides: [0], color: '#4ade80' }],
          { width: 640, laneHeight: 60 },
        ),
        dt: 1e-5,
        trigger: true,
      },
    };
    const N = 500;
    const scopeNote = h('p', { class: 'note' });
    const scopeHost = h('div');
    const scopePanel = panel('Scope', { accent: 'yellow' }, scopeHost, scopeNote);

    // ---- readouts
    const kv = {
      1: readouts(['battery', 'across the 1k', 'across the LED', 'current']),
      2: readouts(['+ input (pin 3)', '− input (pin 2)', 'output (pin 1)', 'LED current']),
      3: readouts(['+ input (pin 3)', '− input (pin 2): the capacitor', 'output (pin 1)', 'flashes']),
      4: readouts(['+ input (pin 3)', '− input (pin 2)', 'output (pin 1)', 'at the jack', 'pitch']),
    };
    const kvHost = h('div');
    const status = callout();

    // ---- the models
    const floating = new FloatingInput(7);
    let osc = new Relaxation(100e3, C);
    let vOut = 0, vMinus = 0, vPlus = 0, vJack = 0;
    const buf = { out: [] as number[], minus: [] as number[], plus: [] as number[], jack: [] as number[] };
    let acc = 0;
    const tone = new Tone();
    d.add(() => tone.dispose());

    const sample = (dt: number) => {
      if (step === 2) {
        vPlus = 0;
        vMinus = jumper === 'plus' ? VBAT : jumper === 'minus' ? -VBAT : floating.step(dt);
        vOut = comparator(vPlus, vMinus);
      } else {
        osc.step(dt);
        vPlus = osc.vplus;
        vMinus = osc.vc;
        vOut = osc.vout;
        vJack = divide(vOut, DIV_TOP, DIV_BOTTOM);
      }
      buf.out.push(vOut);
      buf.minus.push(vMinus);
      buf.plus.push(vPlus);
      buf.jack.push(vJack);
    };

    const sound = () => {
      if (step === 4 && listen) tone.square(1 / relaxationPeriod(1e3, C));
      else tone.stop();
    };

    // ---- controls
    const ledToggle = new Toggle({ label: 'LED turned round', value: reversed, onChange: (v) => { reversed = v; apply(); } });
    const jumperSel = select<Jumper>(
      [
        { value: 'plus', label: 'the + rail, +9 V' },
        { value: 'minus', label: 'the − rail, −9 V' },
        { value: 'loose', label: 'nothing: it is left out' },
      ],
      jumper,
      (v) => { jumper = v; apply(); },
      'The long jumper from the − input goes to',
    );
    const listenToggle = new Toggle({ label: 'Listen (quietly)', value: listen, onChange: (v) => { listen = v; sound(); } });
    const insideToggle = new Toggle({ label: 'Show the strips inside the board', value: inside, onChange: (v) => { inside = v; legend.style.display = v ? '' : 'none'; drawBoard(); } });
    const stepSel = select<`${Step}`>(STEPS, '1', (v) => { step = Number(v) as Step; apply(); }, 'Circuit');

    const apply = () => {
      const su = setup();
      g1.show(step === 1);
      g1led.show(step === 1 && !reversed);
      g1rev.show(step === 1 && reversed);
      gSupply.show(step > 1);
      gAmp.show(step > 1);
      g2.show(step === 2);
      g2plus.show(step === 2 && jumper === 'plus');
      g2minus.show(step === 2 && jumper === 'minus');
      g2loose.show(step === 2 && jumper === 'loose');
      gLed.show(step === 2 || step === 3);
      g34.show(step >= 3);
      g3rf.show(step === 3);
      g4rf.show(step === 4);
      g4.show(step === 4);
      sch.el.setAttribute('aria-label', `Schematic of circuit ${step}`);
      ledToggle.el.style.display = step === 1 ? '' : 'none';
      jumperSel.style.display = step === 2 ? '' : 'none';
      listenToggle.el.style.display = step === 4 ? '' : 'none';
      drawBoard();
      kvHost.replaceChildren(kv[step].el);
      setText(status, stepText(su));
      // the models start again with each circuit
      if (step >= 3) osc = new Relaxation(step === 3 ? 100e3 : 1e3, C);
      for (const a of Object.values(buf)) a.length = 0;
      acc = 0;
      vOut = vMinus = vPlus = vJack = 0;
      scopePanel.style.display = step === 1 ? 'none' : '';
      if (step === 1) {
        scopeHost.replaceChildren();
        const i = reversed ? 0 : ledCurrent(VBAT, 1e3);
        kv[1].set('battery', `${VBAT} V`);
        kv[1].set('across the 1k', reversed ? '0 V (no current through it)' : `${(i * 1e3).toFixed(1)} V (7 mA × 1k)`);
        kv[1].set('across the LED', reversed ? `${VBAT} V, the wrong way` : `about ${VLED} V (red, typical)`);
        kv[1].set('current', fmtMA(i));
        led1.set(!reversed);
        led1r.set(false);
        view?.setLed('led', !reversed);
      } else {
        scopeHost.replaceChildren(scopes[step].scope.el);
        const T = relaxationPeriod(step === 3 ? 100e3 : 1e3, C);
        if (step === 3) kv[3].set('flashes', `${(1 / T).toFixed(2)} a second (T = 2 × 100k × 1 µF × ln 3 = ${T.toFixed(3)} s)`);
        if (step === 4) kv[4].set('pitch', `${(1 / T).toFixed(0)} Hz (T = 2 × 1k × 1 µF × ln 3 = ${(T * 1e3).toFixed(2)} ms)`);
        setText(
          scopeNote,
          step === 2
            ? 'One second across: the output against the − input.'
            : step === 3
              ? 'A second and a half across, rolling: the capacitor charges towards the output until it meets the + input (dashed), and the output flips.'
              : 'Five milliseconds across, triggered on the output’s rising edge: about two cycles of 455 Hz.',
        );
      }
      sound();
      frame(0);
    };

    // ---- each frame: run the model in real time, draw what it did
    const frame = (ms: number) => {
      if (step === 1) return;
      const sc = scopes[step];
      acc += Math.min(ms, 100) / 1000;
      let hi = 0, n = 0;
      while (acc >= sc.dt) {
        acc -= sc.dt;
        sample(sc.dt);
        if (vOut > 0) hi++;
        n++;
      }
      const keep = 3 * N;
      const over = buf.out.length - keep;
      if (over > 0) for (const a of Object.values(buf)) a.splice(0, over);
      let from = Math.max(0, buf.out.length - N);
      if (sc.trigger) {
        // the latest rising edge with a whole window after it
        for (let i = buf.out.length - N; i > 0; i--) {
          if (buf.out[i] > 0 && buf.out[i - 1] <= 0) {
            from = Math.max(0, i - 10);
            break;
          }
        }
      }
      const sl = (a: number[]) => a.slice(from, from + N);
      if (step === 4) sc.scope.draw([sl(buf.out), sl(buf.minus), sl(buf.jack)], { window: N, overlays: [undefined, sl(buf.plus)] });
      else sc.scope.draw([sl(buf.out), sl(buf.minus)], { window: N, overlays: [undefined, sl(buf.plus)] });
      // the LED: lit for most of the frame looks lit
      const lit = (n ? hi / n : vOut > 0 ? 1 : 0) >= 0.5;
      if (step === 2 || step === 3) {
        view?.setLed('led', lit);
        ledOut.set(lit);
      }
      for (const w of live) {
        const v = w.v();
        setClass(w.el, 'pos', v > 0);
        setClass(w.el, 'neg', v < 0);
      }
      const r = kv[step];
      r.set('+ input (pin 3)', fmtV(vPlus));
      r.set(step === 3 ? '− input (pin 2): the capacitor' : '− input (pin 2)', fmtV(vMinus));
      r.set('output (pin 1)', fmtV(vOut));
      if (step === 2) r.set('LED current', vOut > 0 ? fmtMA(ledCurrent(vOut, 1e3)) : `0 mA (${Math.abs(vOut).toFixed(1)} V the wrong way)`);
      if (step === 4) r.set('at the jack', fmtV(vJack));
    };
    d.add(animate((ms) => frame(ms)));

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'On the breadboard',
          { accent: 'red', chips: 'a full-size breadboard · two 9 V batteries · TL074 · LEDs · 1 µF foil · 100k ×3 · 10k · 1k ×2 · a jack socket and two alligator leads' },
          row(stepSel, ledToggle.el, jumperSel, listenToggle.el),
          row(insideToggle.el),
          bbHost,
          legend,
          status,
        ),
        panel('The schematic', { accent: 'gray' }, sch.el, kvHost),
      ),
      h('div', { class: 'lab-stack' }, scopePanel, notes()),
    );
    legend.style.display = 'none';
    apply();
    return d.dispose;
  },
});

function notes(): HTMLElement {
  return panel(
    'From the video',
    { accent: 'gray' },
    note('The board: a rail along each long edge, red for + and blue for −, whose holes are all joined (on some boards only to halfway, shown by a gap in the red and blue lines); a channel down the middle; and across it, on each side, rows of five holes joined underneath. A chip straddles the channel, so each of its pins gets a row of its own. Turn on the strips to see which holes are joined.'),
    note('Batteries rather than a mains supply for a first circuit, Moritz suggests: if something shorts, they only get warm.'),
    note('The parts: small 0.4 W resistors, whose values he reads with the multimeter rather than from the colour rings. Capacitors come as electrolytic (a can, polarised: its − leg is marked), foil (a box) and ceramic (a disc), the last two not polarised; foil is the one to use for audio, and every capacitor has a voltage rating not to go over. An LED’s long leg is its anode, the side towards +.'),
    note('The TL074 has four op amps in one 14-pin package. Schematics leave out the op amps’ supply pins, so look up the pinout: with the notch on the left, pin 1 is bottom left, V+ is pin 4 and V− pin 11. Moritz uses op amp 1 (pins 1-3).'),
    note('The jack: the tip carries the signal and the sleeve goes to ground. Which lug is which, he finds with the multimeter’s continuity beeper, a plug in the socket; a switched socket’s third lug is left unused. Alligator leads go from the lugs to short jumpers in the board.'),
    note(`Estimates here: a TL074 on ±9 V gets to about ±${VSAT} V (its datasheet gives the swing on ±15 V only), and a red LED drops about ${VLED} V. When the output swings negative, the LEDs of circuits 2 and 3 are reversed by about ${VSAT} V, more than the 5 V most LED datasheets allow, with the 1k limiting any current; his later sequencer video looks at safe status LEDs. Into headphones (about 32 Ω) the 1k of the divider is loaded down to a few tens of millivolts: quiet, but you hear it.`),
  );
}
