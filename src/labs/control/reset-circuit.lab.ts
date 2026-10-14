import type { Level } from '../../logic/circuit';
import { Machine } from '../../sim/machine';
import { PROGRAM_BY_ID } from '../../sim/programs';
import { Button, Scope, Slider, Toggle, note, panel, row } from '../../ui/components';
import { ComputerView } from '../../ui/computer-view';
import { Disposer, animate, h, s, setText } from '../../ui/dom';
import { ProgramPanel } from '../../ui/program-panel';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { buildResetLogic } from './_circuits';
import { DEFAULT_RAIL, TTL_MIN_VOLTS, railVoltages, resetEffects, vccAfterEdge, type RailParams, type ResettableState } from './_models';
import { flashModules, machineToolbar, scopedStyle } from './_shared';

const CSS = `
.rst-lab .module.rst-clear { animation: rstlab-clear 1s ease-out; }
.rst-lab .module.rst-kept { animation: rstlab-kept 1s ease-out; }
@keyframes rstlab-clear { 0%, 30% { box-shadow: 0 0 0 3px var(--danger); border-color: var(--danger); } 100% { box-shadow: none; } }
@keyframes rstlab-kept { 0%, 30% { box-shadow: 0 0 0 3px var(--ok); border-color: var(--ok); } 100% { box-shadow: none; } }
.rst-lab .schematic .rst-part { fill: none; stroke: var(--fg-dim); stroke-width: 2; }
.rst-lab .rst-big { font-size: 1rem; padding: 10px 18px; }
.rst-lab .rail-chart { width: 100%; height: auto; display: block; }
.rst-lab .rail-chart text { fill: var(--fg-dim); font-family: var(--mono); font-size: 10px; }
.rst-lab .rail-chart .bar-ok { fill: var(--ok); } .rst-lab .rail-chart .bar-warn { fill: var(--accent-2); } .rst-lab .rail-chart .bar-bad { fill: var(--danger); }
.rst-lab .rail-chart .limit { stroke: var(--danger); stroke-dasharray: 5 4; stroke-width: 1.5; }
.rst-lab .rail-chart .axis { stroke: var(--border); }
.rst-lab .rail-chart .feed { fill: var(--accent); }
.rst-lab .warn { color: var(--danger); font-weight: 600; }
.rst-lab .okv { color: var(--ok); font-weight: 600; }
`;

const snap = (m: Machine): ResettableState => {
  const c = m.computer;
  return { a: c.a, b: c.b, ir: c.ir, mar: c.mar, pc: c.pc, out: c.out, step: c.step, flagC: c.flagC, flagZ: c.flagZ, ram: c.ram.slice() };
};

export default defineLab({
  id: 'reset-circuit',
  title: 'Reset circuit & power supply',
  summary:
    'One push button now clears the whole computer: a 74LS00 turns it into CLR (for the 74LS173 registers) and CLR̅ (for the 74LS161 program counter, the 74LS273 output register and the step counter). RAM has no reset pin, so the program survives. Press reset while the program runs and watch what clears. Then Ben’s power tips: long breadboard rails drop voltage, and decoupling capacitors keep switching spikes local.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'rst-lab lab-stack' });
    d.add(scopedStyle(wrap, CSS));

    // ---- the running computer ----
    const m = new Machine({ microcodeVersion: 'control-logic' });
    m.loadSource(PROGRAM_BY_ID.get('add')!.source);
    m.setHz(4);
    m.start();
    const view = new ComputerView(m, { driveClock: false });
    d.add(() => view.dispose());
    const prog = new ProgramPanel(m, { memoryOnly: true });
    d.add(() => prog.dispose());
    const tb = machineToolbar(m, { speeds: [1, 2, 4, 10, 50] });
    d.add(tb.dispose);

    // ---- reset logic (gate level) ----
    const rl = buildResetLogic();
    const sch = new Schematic(rl.c, { width: 640, height: 250 });
    const gC = sch.gate('NAND', { x: 180, y: 110 }, { label: '74LS00 U51C', output: rl.clrn });
    const gD = sch.gate('NAND', { x: 300, y: 50 }, { label: 'U51D', output: rl.clr });
    const gB = sch.gate('NAND', { x: 300, y: 200 }, { label: 'U51B', output: rl.nand1 });
    const gA = sch.gate('NAND', { x: 390, y: 200 }, { label: 'U51A', output: rl.stepMrn });
    sch.wire(rl.button, [70, 110], [150, 110]);
    sch.wire(rl.button, [150, 110], [150, gC.inputs[0].y], gC.inputs[0]);
    sch.wire(rl.button, [150, 110], [150, gC.inputs[1].y], gC.inputs[1]);
    sch.wire(rl.button, [130, 110], [130, 128]);
    sch.dot(rl.button, [130, 110]);
    sch.dot(rl.button, [150, 110]);
    // R75 (1 kΩ) to GND, and VCC above the button
    const zig = s('polyline', { points: '130,128 136,132 124,138 136,144 124,150 136,156 130,160 130,172', class: 'rst-part' });
    const gnd = s('path', { d: 'M118,172 H142 M122,177 H138 M126,182 H134', class: 'rst-part' });
    sch.el.append(zig, gnd);
    sch.text('R75 1 kΩ', [100, 150], { size: 10, anchor: 'end' });
    sch.text('VCC', [48, 84], { size: 10 });
    sch.wire(rl.clrn, gC.output, [260, 110]);
    sch.wire(rl.clrn, [260, 110], [260, 50], [275, 50], [275, gD.inputs[0].y], gD.inputs[0]);
    sch.wire(rl.clrn, [275, 50], [275, gD.inputs[1].y], gD.inputs[1]);
    sch.wire(rl.clrn, [260, 110], [470, 110]);
    sch.wire(rl.clrn, [260, 110], [260, gB.inputs[1].y], gB.inputs[1]);
    sch.dot(rl.clrn, [260, 110]);
    sch.dot(rl.clrn, [275, 50]);
    sch.wire(rl.clr, gD.output, [470, 50]);
    sch.wire(rl.o5n, [200, gB.inputs[0].y], gB.inputs[0]);
    sch.text('O5̅ (74LS138)', [196, gB.inputs[0].y], { size: 11, anchor: 'end' });
    sch.wire(rl.nand1, gB.output, [365, 200], [365, gA.inputs[0].y], gA.inputs[0]);
    sch.wire(rl.nand1, [365, 200], [365, gA.inputs[1].y], gA.inputs[1]);
    sch.dot(rl.nand1, [365, 200]);
    sch.wire(rl.stepMrn, gA.output, [470, 200]);
    sch.probe(rl.clr, [480, 50], { label: 'CLR', color: 'yellow' });
    sch.text('→ 74LS173s: A, B, IR, MAR, flags', [440, 72], { size: 10, anchor: 'start' });
    sch.probe(rl.clrn, [480, 110], { label: 'CLR̅', color: 'yellow' });
    sch.text('→ M̅R̅: PC (161), OUT (273)', [440, 132], { size: 10, anchor: 'start' });
    sch.probe(rl.stepMrn, [480, 200], { label: 'step M̅R̅', color: 'yellow' });
    sch.text('→ step counter (74LS161)', [440, 222], { size: 10, anchor: 'start' });
    d.add(sch.autoUpdate());

    // ---- reset behaviour ----
    const rows = h('tbody');
    const effect = h('div', { class: 'callout' }, 'The program is running. Press and hold RESET (or the SW8 button in the schematic).');
    const origReset = m.reset.bind(m);
    const showEffects = (before: ResettableState, wasHalted: boolean) => {
      const after = snap(m);
      const fx = resetEffects(before, after);
      rows.replaceChildren(
        ...fx.map((r) =>
          h(
            'tr',
            { class: r.changed ? 'current' : '' },
            h('td', { style: 'text-align:left' }, r.label),
            h('td', null, r.line),
            h('td', null, r.key === 'ram' ? 'program' : r.before),
            h('td', null, r.key === 'ram' ? 'still there ✓' : r.after),
          ),
        ),
      );
      const cleared = fx.filter((r) => r.changed);
      flashModules(view.el, cleared.map((r) => r.module), 'rst-clear', 1000, d);
      flashModules(view.el, ['ram'], 'rst-kept', 1000, d);
      effect.replaceChildren(
        h('strong', null, 'Reset! '),
        cleared.length ? `Cleared: ${cleared.map((r) => `${r.label.replace(/ \(.*\)/, '')} (${r.before} → ${r.after})`).join(', ')}. ` : 'Everything was already zero. ',
        'RAM has no reset input, so the program and its data stay put. ',
        wasHalted ? 'The computer had halted: clearing the IR makes the control word MI|CO, so HLT drops and the clock starts again by itself. ' : '',
        m.running && m.mode === 'auto' ? 'The clock is in auto mode, so as soon as you let go the computer fetches from address 0 and runs the program again.' : 'In manual mode, pulse the clock to run it again.',
      );
    };
    // Every reset (toolbar, control panel, the big button) goes through here.
    m.reset = () => {
      const before = snap(m);
      const wasHalted = m.computer.halted;
      origReset();
      showEffects(before, wasHalted);
    };
    d.add(() => {
      m.reset = origReset;
    });
    const press = () => {
      rl.c.set(rl.button, 1);
      rl.c.settle();
      m.reset();
    };
    const release = () => {
      rl.c.set(rl.button, 0);
      rl.c.settle();
    };
    sch.switch(rl.button, [70, 110], { label: 'SW8', momentary: true, onToggle: (n) => (n.value === 1 ? release() : press()) });
    const big = new Button({ label: 'RESET (hold)', kind: 'danger', title: 'The SW8 push button', onPress: press, onRelease: release });
    big.el.classList.add('rst-big');

    // drive the clock ourselves so reset can hold the computer
    let o5Until = 0;
    let lastStep = m.computer.step;
    let now = 0;
    d.add(
      animate((dt) => {
        now += dt;
        if (rl.button.value === 1) {
          m.computer.reset(); // held in reset: every clear is asynchronous and level-held
          m.changed();
        } else m.frame(dt);
        const st = m.computer.step;
        if (st === 0 && lastStep === 4) {
          rl.c.set(rl.o5n, 0); // the counter reached 5 for a moment: O5̅ pulses low
          rl.c.settle();
          o5Until = now + 120;
        }
        lastStep = st;
        if (rl.o5n.value === 0 && now > o5Until) {
          rl.c.set(rl.o5n, 1);
          rl.c.settle();
        }
      }),
    );

    // ---- power supply: rail drop ----
    const p: RailParams = { ...DEFAULT_RAIL };
    const chart = s('svg', { viewBox: '0 0 360 170', class: 'rail-chart', role: 'img', 'aria-label': 'Voltage at each breadboard' });
    const railInfo = h('div', { class: 'callout' });
    const drawRail = () => {
      const r = railVoltages(p);
      const lo = 4.0, hi = 5.05;
      const x0 = 34, w = 316, y0 = 10, hgt = 130;
      const y = (v: number) => y0 + hgt - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * hgt;
      const n = r.volts.length;
      const bw = w / n;
      const parts: SVGElement[] = [
        s('line', { x1: x0, y1: y0 + hgt, x2: x0 + w, y2: y0 + hgt, class: 'axis' }),
        s('line', { x1: x0, y1: y(TTL_MIN_VOLTS), x2: x0 + w, y2: y(TTL_MIN_VOLTS), class: 'limit' }),
        s('text', { x: x0 - 4, y: y(5) + 3, 'text-anchor': 'end' }, '5.0'),
        s('text', { x: x0 - 4, y: y(4.75) + 3, 'text-anchor': 'end' }, '4.75'),
        s('text', { x: x0 - 4, y: y(4.5) + 3, 'text-anchor': 'end' }, '4.5'),
        s('text', { x: x0 - 4, y: y(4.0) + 3, 'text-anchor': 'end' }, '4.0'),
      ];
      r.volts.forEach((v, k) => {
        const cls = v >= TTL_MIN_VOLTS ? 'bar-ok' : v >= 4.5 ? 'bar-warn' : 'bar-bad';
        const bx = x0 + k * bw + bw * 0.15;
        parts.push(s('rect', { x: bx, y: y(v), width: bw * 0.7, height: y0 + hgt - y(v), class: cls, rx: 2 }, s('title', null, `board ${k + 1}: ${v.toFixed(2)} V`)));
        if (n <= 14 || k % 2 === 0) parts.push(s('text', { x: bx + bw * 0.35, y: y0 + hgt + 12, 'text-anchor': 'middle' }, String(k + 1)));
        if (r.fed.includes(k) || k === 0) parts.push(s('path', { d: `M${bx + bw * 0.35 - 5},${y0 + hgt + 17} h10 l-5,7 z`, class: 'feed' }));
      });
      parts.push(s('text', { x: x0 + w / 2, y: 167, 'text-anchor': 'middle' }, 'board  (▼ = fed from the supply)'));
      chart.replaceChildren(...parts);
      const worst = r.volts.indexOf(r.minVolts);
      railInfo.replaceChildren(
        `Total current ${(r.totalCurrent * 1000).toFixed(0)} mA. The far end gets `,
        h('span', { class: r.minVolts < TTL_MIN_VOLTS ? 'warn' : 'okv' }, `${r.minVolts.toFixed(2)} V`),
        ` (board ${worst + 1}). `,
        r.minVolts < TTL_MIN_VOLTS
          ? `⚠ That is below the 4.75 V that 74LS chips are specified for: expect flaky behaviour on the far boards, like registers that sometimes latch the wrong value or a clock that skips. Add feed wires from the supply in parallel with the rails.`
          : 'Every board is inside the 74LS supply range (4.75–5.25 V).',
        p.groundToo ? ' The ground rail rises by the same amount, so the chips lose the drop twice.' : '',
      );
    };
    const sBoards = new Slider({ label: 'Boards', min: 2, max: 20, step: 1, value: p.boards, format: (v) => String(v), onInput: (v) => { p.boards = v; drawRail(); } });
    const sCur = new Slider({ label: 'Current/board', min: 10, max: 300, step: 5, value: p.currentPerBoard * 1000, format: (v) => `${v} mA`, onInput: (v) => { p.currentPerBoard = v / 1000; drawRail(); } });
    const sRes = new Slider({ label: 'Rail R/board', min: 0.02, max: 0.5, log: true, value: p.railOhms, format: (v) => `${(v * 1000).toFixed(0)} mΩ`, onInput: (v) => { p.railOhms = v; drawRail(); } });
    const sFeeds = new Slider({ label: 'Feed wires', min: 0, max: 4, step: 1, value: p.feeds, format: (v) => String(v), onInput: (v) => { p.feeds = v; drawRail(); } });
    const tGnd = new Toggle({ label: 'Ground rail drops too', value: p.groundToo, onChange: (v) => { p.groundToo = v; drawRail(); } });
    drawRail();

    // ---- decoupling capacitors ----
    let decoupled = false;
    const tCap = new Toggle({ label: '0.1 µF decoupling capacitor next to the chip', onChange: (v) => (decoupled = v) });
    const dScope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'VCC at the chip', color: '#fbbf24', kind: 'analog', min: 3.8, max: 5.2, guides: [TTL_MIN_VOLTS, 5] },
      ],
      { width: 360, laneHeight: 60 },
    );
    const dS: (Level | number)[][] = [[], []];
    const capNote = h('div', { class: 'callout' });
    let tt = 0;
    let lastEdge = -100;
    let minV = 5;
    let accD = 0;
    d.add(
      animate((dt) => {
        accD += dt;
        while (accD > 25) {
          accD -= 25;
          tt++;
          const clk = (Math.floor(tt / 20) % 2) as 0 | 1;
          if (tt % 20 === 0) lastEdge = tt;
          const v = vccAfterEdge(tt - lastEdge, decoupled);
          minV = Math.min(minV * 0.995 + 5 * 0.005, v);
          dS[0].push(clk);
          dS[1].push(v);
          for (const a of dS) if (a.length > 160) a.shift();
        }
        if (accD > 500) accD = 0;
        dScope.draw(dS, { window: 160 });
        setText(
          capNote,
          decoupled
            ? `With a 0.1 µF capacitor right at the chip’s power pins, the current spike of each switching edge comes from the capacitor, so VCC barely moves (lowest ≈ ${minV.toFixed(2)} V).`
            : `Without decoupling, every clock edge makes many outputs switch at once. That current surge has to come through long, inductive power wires, so VCC dips and rings (lowest ≈ ${minV.toFixed(2)} V). Dips below 4.75 V can upset flip-flops and counters.`,
        );
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Reset logic', { accent: 'yellow', chips: 'SW8 push button, R75 1 kΩ, 74LS00 (U51)' }, sch.el, row(big.el), note('Pressing SW8 pulls the node high; U51C inverts it into CLR̅ and U51D inverts it again into CLR. U51B and U51A make the step counter’s M̅R̅ = O5̅ AND CLR̅, so either the decoder (every 5th step) or the reset button clears it.')),
        panel(
          'What reset clears',
          { accent: 'red', subtitle: 'highlighted rows changed' },
          h('div', { class: 'table-scroll' }, h('table', { class: 'truth-table' }, h('thead', null, h('tr', null, ['module', 'line', 'before', 'after'].map((x) => h('th', null, x)))), rows)),
          effect,
          note('Ben lists PC, A, B, OUT, IR, MAR and the micro-step counter here; the flags register (video 43) joins the CLR line later.'),
        ),
      ),
      tb.el,
      h('div', { class: 'workbench' }, h('div', { class: 'workbench-main' }, view.el), h('aside', { class: 'workbench-side' }, h('div', { class: 'tab-body' }, prog.el))),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Power rails: voltage drop', { accent: 'orange', subtitle: 'Ohm’s law along the breadboards' }, chart, sBoards.el, sCur.el, sRes.el, sFeeds.el, tGnd.el, railInfo, note('Each breadboard rail and the jumper to the next board add a little resistance, and every board’s current flows through all the rails before it. Ben measured the supply sagging towards the far boards and ran extra wires from the supply to them, in parallel with the rails.')),
        panel('Decoupling capacitors', { accent: 'orange', subtitle: '0.1 µF per chip' }, dScope.el, tCap.el, capNote, note('A 10 µF capacitor where the power comes in smooths the supply for the whole computer; small 0.1 µF ceramics next to each chip supply the fast spikes locally.')),
      ),
    );
    root.appendChild(wrap);
    m.changed();
    return d.dispose;
  },
});
