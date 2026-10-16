import { mountComputerWorkbench } from '../../app/computer-page';
import { Trace } from '../../logic/circuit';
import { PROGRAM_BY_ID } from '../../sim/programs';
import { DipSwitch, LedBar, Scope, Toggle, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { buildClockGate } from './_circuits';
import { busLevels, ttlRead, type BusSource } from './_models';
import { ControlUnitExercise, chipContrastCss, scopedStyle } from './_shared';

const SOURCES: { value: BusSource; label: string }[] = [
  { value: 'pc', label: 'PC (CO): 4 bits only' },
  { value: 'none', label: 'nothing' },
  { value: 'ir', label: 'IR (IO)' },
  { value: 'ram', label: 'RAM (RO)' },
  { value: 'a', label: 'A (AO)' },
];

export default defineLab({
  id: 'connecting-bus',
  title: 'Connecting the bus',
  summary:
    'Ben adds the output register (a 74LS273 whose clock is gated by OI), joins every module to one 8-bit bus with 10 kΩ pull-downs, and moves data around by setting the control lines by hand. Here you are the control logic: set the switches for each micro-step of the 28 + 14 program and pulse the clock. Each pulse is checked against the microcode Ben writes later.',
  mount(root) {
    const d = new Disposer();

    // ---- the computer with manual control switches ----
    const exHost = h('div');
    const wbHost = h('div');
    const wb = mountComputerWorkbench(wbHost, { manualControl: true, microcodeVersion: 'control-logic', tabs: ['program'] });
    d.add(wb.dispose);
    const ex = new ControlUnitExercise(wb.machine, {
      source: PROGRAM_BY_ID.get('add')!.source,
      intro: 'RAM holds Ben’s first program: LDA 14, ADD 15, OUT, HLT with 28 and 14 as data. Click the control signals below (or use the switches in the computer’s control panel), then pulse the clock. Every instruction starts with the same two fetch steps.',
    });
    d.add(() => ex.dispose());
    exHost.appendChild(ex.el);

    // ---- bus pull-downs ----
    let source: BusSource = 'pc';
    let pulldowns = true;
    const value = new DipSwitch({ bits: 8, value: 0b00000011, label: 'module output', onChange: () => updBus() });
    const busLeds = new LedBar({ bits: 8, color: 'red', label: 'bus', captions: ['7', '6', '5', '4', '3', '2', '1', '0'] });
    const latched = h('span', { class: 'mono' });
    const busNote = h('div', { class: 'callout' });
    const pdToggle = new Toggle({ label: '10 kΩ pull-downs fitted (R8–R15)', value: true, onChange: (v) => { pulldowns = v; updBus(); } });
    const updBus = () => {
      const lv = busLevels(source, value.value, pulldowns);
      busLeds.setLevels(lv);
      const v = ttlRead(lv);
      setText(latched, `${v.toString(2).padStart(8, '0')} = ${v}`);
      const floating = lv.filter((l) => l === 'Z').length;
      setText(
        busNote,
        floating === 0
          ? source === 'none'
            ? 'Nothing drives the bus, but the pull-downs hold every line at 0 V, so a register loading the bus reads 0.'
            : source === 'ir'
              ? 'IO drives all 8 lines: the operand on bits 0-3, and bits 4-7 are driven low because those 74LS245 inputs are tied to GND.'
              : source === 'pc'
                ? 'The PC’s 74LS245 only drives bits 0-3; the pull-downs hold bits 4-7 at 0, so the value on the bus is just the address.'
                : 'This module drives all 8 lines, so the pull-downs make no difference.'
          : `${floating} bus lines float. A floating LS-TTL input reads as 1, so a register loading the bus would see ${v} instead of ${value.value & (source === 'pc' ? 15 : source === 'none' ? 0 : 255)}. That is why Ben adds a 10 kΩ pull-down to every bus line.`,
      );
    };
    const sourceSel = select(SOURCES, source, (v) => { source = v; updBus(); }, 'On the bus');
    updBus();

    // ---- output register clock gating ----
    const g = buildClockGate();
    g.setBus(42);
    const sch = new Schematic(g.c, { width: 520, height: 200 });
    const and = sch.gate('AND', { x: 170, y: 85 }, { label: '74LS08 U46A', output: g.cp });
    const chip = sch.chip({ x: 300, y: 30 }, { label: '74LS273', sublabel: 'U44', width: 120, height: 130, left: [{ name: 'D0-7' }, { name: 'CP', net: g.cp }, { name: 'M̅R̅', bubble: true }], right: [{ name: 'Q0-7' }] });
    sch.wire(g.clk, [70, 50], [140, 50], [140, and.inputs[0].y], and.inputs[0]);
    sch.wire(g.oi, [70, 125], [140, 125], [140, and.inputs[1].y], and.inputs[1]);
    sch.wire(g.cp, and.output, [255, and.output.y], [255, chip.left[1].y], chip.left[1]);
    sch.text('bus', [272, chip.left[0].y], { size: 11, anchor: 'end' });
    sch.text('CLR̅', [272, chip.left[2].y], { size: 11, anchor: 'end' });
    sch.text('→ display', [438, chip.right[0].y], { size: 11, anchor: 'start' });
    sch.text('CP = CLK · OI', [195, 160], { size: 12 });
    let spurious = false;
    let lastCount = 0;
    const toggleNet = (n: typeof g.clk) => {
      const wasClkHigh = g.clk.value === 1;
      g.c.toggle(n);
      g.c.settle();
      const l = g.latched();
      if (l.count !== lastCount) {
        spurious = n === g.oi && wasClkHigh;
        lastCount = l.count;
      }
      updGate();
    };
    sch.switch(g.clk, [70, 50], { label: 'CLK', momentary: true, onToggle: toggleNet });
    sch.switch(g.oi, [70, 125], { label: 'OI', onToggle: toggleNet });
    d.add(sch.autoUpdate());
    const outBar = new LedBar({ bits: 8, color: 'red', formats: ['dec'], label: 'Q' });
    const gateBus = new DipSwitch({ bits: 8, value: 42, label: 'bus', onChange: (v) => g.setBus(v) });
    const gateNote = h('div', { class: 'callout' });
    const updGate = () => {
      const l = g.latched();
      outBar.set(l.value);
      const clk = g.clk.value === 1, oi = g.oi.value === 1;
      setText(
        gateNote,
        spurious
          ? `OI went high while CLK was already high, so CP rose in the middle of the clock cycle and the register latched ${l.value} at the wrong moment. The control logic avoids this by changing control lines only while CLK is low.`
          : l.count === 0
            ? 'The 74LS273 has no load-enable pin: it latches on every rising edge of its clock. So Ben ANDs CLK with OI. Turn OI on, then press CLK.'
            : oi && clk
              ? `CLK rose while OI was high, so CP rose too and the output register latched the bus (${l.value}).`
              : oi
                ? 'OI is high: the next rising edge of CLK will latch the bus.'
                : 'OI is low, so CP stays low and the register ignores the clock. Now try holding the CLK button (CLK high) and switching OI on.',
      );
    };
    updGate();

    const trace = new Trace([g.clk, g.oi, g.cp], 240);
    const scope = new Scope([{ label: 'CLK', color: '#60a5fa' }, { label: 'OI', color: '#fbbf24' }, { label: 'CP = CLK·OI', color: '#f87171' }], { width: 520, laneHeight: 34 });
    let acc = 0;
    d.add(
      animate((dt) => {
        acc += dt;
        while (acc > 1000 / 60) {
          acc -= 1000 / 60;
          trace.sample(g.c.time);
        }
        if (acc > 200) acc = 0;
        scope.draw(trace.samples, { window: 240 });
      }),
    );

    const wrap = h('div', { class: 'cb-lab lab-stack' });
    d.add(scopedStyle(wrap, chipContrastCss('.cb-lab')));
    root.appendChild(wrap);
    wrap.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel('Be the control unit', { accent: 'blue', subtitle: 'run 28 + 14 by hand' }, exHost),
        wbHost,
        h(
          'div',
          { class: 'lab-grid' },
          panel(
            'Bus pull-downs',
            { accent: 'red', chips: '8 × 10 kΩ to GND (R8–R15), 8 bus LEDs' },
            sourceSel,
            row(value.el),
            pdToggle.el,
            busLeds.el,
            h('div', { class: 'kv' }, h('span', { class: 'dim' }, 'A register would latch'), latched),
            busNote,
            note('Hatched LEDs are floating lines. On the real bus they read as 1, and the bus LEDs may glow dimly or flicker.'),
          ),
          panel(
            'Output register clock gating',
            { accent: 'red', chips: '74LS273 (U44), 74LS08 (U46A)' },
            sch.el,
            row(gateBus.el),
            outBar.el,
            gateNote,
            scope.el,
            note('Hold CLK (it is a push button), toggle OI. Ben picked the 273 (eight D flip-flops with clear) instead of two 74LS173s, so he had to gate its clock.'),
          ),
        ),
      ),
    );
    return d.dispose;
  },
});
