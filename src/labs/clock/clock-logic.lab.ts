import { Circuit } from '../../logic/circuit';
import { Button, Led, Scope, Slider, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { callout, netRecorder, stepLoop, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { buildClockLogic } from './_shared';

/** Gate delays per second at normal speed (one delay = 1/150 s on screen). */
const RATE = 150;
const WINDOW = 600;
/** Monostable pulse: 110 ms. */
const MONO_DELAYS = Math.round(0.11 * RATE);

export default defineLab({
  id: 'clock-logic',
  title: 'Clock logic',
  summary:
    'Three gate chips combine the three 555s into one clock. The bistable SEL signal picks the astable clock (auto) or the monostable single-step pulse (manual), HLT stops the clock, and an inverter makes ~CLK as well. Flip SEL and HLT, press the step button, and watch the signal pass through each gate.',
  mount(root) {
    const d = new Disposer();
    const c = new Circuit();
    const { AST, MONO, SEL, HLT, u5a, u4a, u5b, u6a, u4d, CLK, CLKn } = buildClockLogic(c);

    let freq = 2;
    let slow = false;
    let held = false;
    let monoUntil = -1;
    let astPhase = 0;
    let selChangedAt = -1e9;
    let clkRise = -1;
    let shortPulseAt = -1e9;

    // ---- schematic ----
    const sch = new Schematic(c, { width: 620, height: 322 });
    const src = (y: number, label: string, sub: string, net = AST) => sch.chip([10, y - 20], { label, sublabel: sub, width: 80, height: 40, right: [{ name: 'Q', net }] }).right[0];
    const astOut = src(50, 'U1 555', 'astable', AST);
    const monoOut = src(195, 'U2 555', 'monostable', MONO);
    const gU5A = sch.gate('AND', [220, 57.5], { label: 'U5A 74LS08', output: u5a });
    const gU4A = sch.gate('NOT', [165, 165], { label: 'U4A 74LS04', output: u4a });
    const gU5B = sch.gate('AND', [260, 187.5], { label: 'U5B 74LS08', output: u5b });
    const gU6A = sch.gate('OR', [350, 120], { label: 'U6A 74LS32', output: u6a });
    const gU4D = sch.gate('NOT', [165, 285], { label: 'U4D 74LS04', output: u4d });
    const gU5C = sch.gate('AND', [440, 135], { label: 'U5C 74LS08', output: CLK });
    const gU4F = sch.gate('NOT', [520, 215], { label: 'U4F 74LS04', output: CLKn });
    sch.wire(AST, astOut, gU5A.inputs[0]);
    sch.wire(SEL, [92, 120], [150, 120], [150, 65], gU5A.inputs[1]);
    sch.wire(SEL, [150, 120], [150, 165], gU4A.inputs[0]);
    sch.dot(SEL, [150, 120]);
    sch.wire(u4a, gU4A.output, [232, 165], [232, 180], gU5B.inputs[0]);
    sch.wire(MONO, monoOut, gU5B.inputs[1]);
    sch.wire(u5a, gU5A.output, [300, 57.5], [300, 112.5], gU6A.inputs[0]);
    sch.wire(u5b, gU5B.output, [322, 187.5], [322, 127.5], gU6A.inputs[1]);
    sch.wire(HLT, [92, 285], gU4D.inputs[0]);
    sch.wire(u6a, gU6A.output, [420, 120], [420, 127.5], gU5C.inputs[0]);
    sch.wire(u4d, gU4D.output, [425, 285], [425, 142.5], gU5C.inputs[1]);
    sch.wire(CLK, gU5C.output, [575, 135]);
    sch.wire(CLK, [500, 135], [500, 215], gU4F.inputs[0]);
    sch.dot(CLK, [500, 135]);
    sch.wire(CLKn, gU4F.output, [575, 215]);
    sch.switch(SEL, [92, 120], { label: 'SEL (U3)', onToggle: () => setSel(SEL.value !== 1) });
    sch.switch(HLT, [92, 285], { label: 'HLT', onToggle: () => setHlt(HLT.value !== 1) });
    sch.probe(CLK, [584, 135], { label: 'CLK', color: 'blue', labelSide: 'top' });
    sch.probe(CLKn, [584, 215], { label: '~CLK', color: 'yellow', labelSide: 'top' });
    d.add(sch.autoUpdate());

    // ---- widgets ----
    const rec = netRecorder([AST, MONO, SEL, HLT, CLK, CLKn], WINDOW);
    const scope = new Scope(
      [
        { label: 'astable (U1)', color: '#94a3b8' },
        { label: 'manual pulse (U2)', color: '#4ade80' },
        { label: 'SEL (U3)', color: '#fbbf24' },
        { label: 'HLT', color: '#f87171' },
        { label: 'CLK', color: '#60a5fa' },
        { label: '~CLK', color: '#c084fc' },
      ],
      { width: 640, laneHeight: 36 },
    );
    const tt = truthTable(
      ['SEL', 'HLT', 'CLK', ''],
      [
        ['1', '0', 'astable', 'auto: free-running clock'],
        ['0', '0', 'manual', 'single step: one pulse per press'],
        ['x', '1', '0', 'halted'],
      ],
    );
    const status = callout();
    const clkLed = new Led('blue', 'CLK');
    clkLed.el.style.width = clkLed.el.style.height = '22px';

    const setSel = (v: boolean) => {
      if ((SEL.value === 1) === v) return;
      c.set(SEL, v ? 1 : 0);
      selToggle.set(v);
      selChangedAt = c.time;
    };
    const setHlt = (v: boolean) => {
      c.set(HLT, v ? 1 : 0);
      hltToggle.set(v);
    };
    const selToggle = new Toggle({ label: 'Mode (bistable SEL)', value: true, onLabel: 'AUTO', offLabel: 'MANUAL', onChange: setSel });
    const hltToggle = new Toggle({ label: 'HLT', onChange: setHlt });
    const stepBtn = new Button({
      label: 'Step (monostable)',
      kind: 'primary',
      onPress: () => {
        held = true;
        if (MONO.value === 0) monoUntil = c.time + MONO_DELAYS;
      },
      onRelease: () => (held = false),
    });
    const freqSlider = new Slider({ label: 'Astable', min: 0.5, max: 8, log: true, value: freq, format: (v) => `${v.toFixed(1)} Hz`, onInput: (v) => (freq = v) });
    const slowToggle = new Toggle({ label: 'Slow motion (one gate delay per step)', onChange: (v) => (slow = v) });

    const update = () => {
      const sel = SEL.value === 1, hlt = HLT.value === 1;
      tt.set(hlt ? 2 : sel ? 0 : 1);
      clkLed.set(CLK.value);
      let msg: string;
      if (hlt) msg = 'HLT is high. U4D turns it into a 0 at U5C, so CLK stays low in both modes and ~CLK stays high. The HLT instruction will stop the computer this way.';
      else if (sel) msg = `Auto: SEL = 1 opens U5A for the astable clock, and U4A turns SEL into a 0 that blocks the step button at U5B. U6A passes the astable signal on, and U5C passes it through because HLT is low. CLK follows the ${freq.toFixed(1)} Hz astable, three gate delays later.`;
      else msg = 'Manual: SEL = 0 blocks the astable at U5A, and U4A turns it into a 1 that lets the monostable pulse through U5B. Each press of the step button gives exactly one clean CLK pulse.';
      if (c.time - shortPulseAt < WINDOW * 0.6) msg += ' Notice the short CLK pulse: you changed SEL while the astable was high. The bistable 555 removes switch bounce, but switching mid-cycle can still cut one pulse short.';
      setText(status, msg);
    };

    d.add(
      stepLoop({
        rate: () => RATE,
        slow: () => slow,
        slowMs: 300,
        step: () => {
          // astable square wave
          astPhase += 1;
          const half = Math.max(2, Math.round(RATE / (2 * freq)));
          if (astPhase >= half) {
            astPhase = 0;
            c.set(AST, AST.value === 1 ? 0 : 1);
          }
          // monostable: 110 ms pulse, longer while the button is held
          const mono = held || c.time < monoUntil ? 1 : 0;
          if (MONO.value !== mono) c.set(MONO, mono);
          const before = CLK.value;
          c.step();
          if (CLK.value === 1 && before === 0) clkRise = c.time;
          if (CLK.value === 0 && before === 1 && clkRise >= 0) {
            // A pulse was cut short by SEL if it started or ended a few gate
            // delays (the path through U4A/U5x/U6A/U5C) after SEL changed
            // and is clearly shorter than a full astable half period.
            const len = c.time - clkRise;
            const near = (t: number) => t - selChangedAt >= 0 && t - selChangedAt <= 6;
            if (len < half * 0.85 && (near(c.time) || near(clkRise))) shortPulseAt = c.time;
          }
          rec.sample();
        },
        frame: () => {
          scope.draw(rec.samples, { window: WINDOW });
          update();
        },
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Clock logic',
          { accent: 'blue', chips: '74LS08 (U5A, U5B, U5C) · 74LS32 (U6A) · 74LS04 (U4A, U4D, U4F) · CLK LED 220 Ω' },
          sch.el,
          row(stepBtn.el, selToggle.el, hltToggle.el),
          row(freqSlider.el, slowToggle.el),
          row(clkLed.el, h('strong', null, 'CLK')),
          note('Click SEL or HLT in the drawing to flip them. Wire colours: red = high, blue = low.'),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('What CLK does', { accent: 'gray' }, tt.el, status),
          panel('Timing diagram', { accent: 'gray' }, scope.el, note('CLK = ((astable AND SEL) OR (manual AND NOT SEL)) AND NOT HLT, and ~CLK = NOT CLK. ~CLK will clock the step counter of the control logic later. Ben notes that a NAND-only version would need fewer chips, but he uses AND, OR and NOT because they are easier to follow.')),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
