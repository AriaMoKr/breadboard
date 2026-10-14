import { Circuit, Trace, type Bit, type Level, type Net } from '../../logic/circuit';
import { Scope, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, animate, h, s, setClass, setText } from '../../ui/dom';
import { Schematic, levelClass } from '../../ui/schematic';
import { defineLab } from '../types';
import { LS245_PINS, addLs245, joinOutputs, outputStage } from './_model';
import { labFrame, levelLegend, runCircuit, truthTable } from './_shared';

/**
 * Video 10 — "Tri-state logic: Connecting multiple outputs together".
 * 1. Two ordinary (totem-pole) outputs on one wire: opposite levels short
 *    +5 V to ground.
 * 2. Three tri-state buffers on one wire, with a floating-input demo.
 * 3. The 74LS245 transceiver that every module uses to reach the bus.
 */

const CSS = `
.ts-svg .tp-blade { stroke: var(--fg); stroke-width: 3; stroke-linecap: round; transition: all 0.12s; }
.ts-svg .tp-contact { fill: var(--panel-2); stroke: var(--fg-dim); stroke-width: 1.5; }
.ts-svg .tp-box { fill: none; stroke: var(--fg-faint); stroke-dasharray: 4 4; }
.ts-svg .tp-label { fill: var(--fg); font: 600 12px var(--sans); }
.ts-svg .tp-small { fill: var(--fg-dim); font: 11px var(--mono); }
.ts-svg .tp-on { fill: var(--ok); }
.ts-svg .tp-current { fill: none; stroke: var(--wire-x); stroke-width: 6; stroke-linejoin: round; stroke-dasharray: 10 10; opacity: 0; }
.ts-svg .tp-current.show { opacity: 0.85; }
.ts-svg .tp-led { fill: var(--led-off); stroke: rgba(0,0,0,.4); }
.ts-svg .tp-led.l1 { fill: var(--led-red); }
.ts-svg .tp-led.lx { fill: var(--wire-x); }
.ts-svg .tp-gnd { stroke: var(--fg-dim); stroke-width: 2; }
`;

export default defineLab({
  id: 'tri-state',
  title: 'Tri-state logic',
  summary:
    'An ordinary logic output is always driving: a 1 connects the wire to +5 V, a 0 connects it to ground. Wire two of them together and set them to different levels and you short the supply. Tri-state outputs add a third state, high-impedance (Z), where the output lets go of the wire completely. With them, many modules can share one bus as long as only one is enabled at a time. Every module of the computer reaches the bus through a 74LS245, a chip with eight of these buffers.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d, CSS);

    // =====================================================================
    // 1. Two totem-pole outputs on one wire
    // =====================================================================
    const tp = { v: [1, 0] as Bit[], en: [true, true], tri: false };
    const X1 = 80, X2 = 340, Y_RAIL = 30, Y_T1 = 50, Y_T2 = 96, Y_NODE = 126, Y_B1 = 156, Y_B2 = 202, Y_GND = 222;
    const tpSvg = s('svg', { viewBox: '0 0 420 250', class: 'schematic ts-svg', role: 'img', 'aria-label': 'Two output stages wired together' });
    tpSvg.style.maxWidth = '480px';
    const seg = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
      const l = s('line', { x1, y1, x2, y2, class: `wire ${cls}` });
      tpSvg.appendChild(l);
      return l;
    };
    const stage = (x: number, i: number) => {
      tpSvg.appendChild(s('rect', { x: x - 58, y: 16, width: 116, height: 218, rx: 8, class: 'tp-box' }));
      tpSvg.appendChild(s('text', { x, y: 12, 'text-anchor': 'middle', class: 'tp-label' }, `Output ${i + 1}`));
      tpSvg.appendChild(s('text', { x: x - 6, y: Y_RAIL + 4, 'text-anchor': 'end', class: 'tp-small' }, '+5 V'));
      seg(x, Y_RAIL, x, Y_T1, 'l1');
      const upper = seg(x, Y_T2, x, Y_NODE, 'lz');
      const lower = seg(x, Y_NODE, x, Y_B1, 'lz');
      seg(x, Y_B2, x, Y_GND, 'l0');
      tpSvg.appendChild(s('line', { x1: x - 12, y1: Y_GND, x2: x + 12, y2: Y_GND, class: 'tp-gnd' }));
      tpSvg.appendChild(s('line', { x1: x - 7, y1: Y_GND + 5, x2: x + 7, y2: Y_GND + 5, class: 'tp-gnd' }));
      tpSvg.appendChild(s('line', { x1: x - 3, y1: Y_GND + 10, x2: x + 3, y2: Y_GND + 10, class: 'tp-gnd' }));
      const bladeT = s('line', { x1: x, y1: Y_T1, x2: x, y2: Y_T2, class: 'tp-blade' });
      const bladeB = s('line', { x1: x, y1: Y_B1, x2: x, y2: Y_B2, class: 'tp-blade' });
      tpSvg.append(bladeT, bladeB);
      for (const y of [Y_T1, Y_T2, Y_B1, Y_B2]) tpSvg.appendChild(s('circle', { cx: x, cy: y, r: 3.5, class: 'tp-contact' }));
      const side = i === 0 ? -1 : 1;
      const tText = s('text', { x: x + side * 10, y: (Y_T1 + Y_T2) / 2 + 4, 'text-anchor': i === 0 ? 'end' : 'start', class: 'tp-small' }, '');
      const bText = s('text', { x: x + side * 10, y: (Y_B1 + Y_B2) / 2 + 4, 'text-anchor': i === 0 ? 'end' : 'start', class: 'tp-small' }, '');
      tpSvg.append(tText, bText);
      return { bladeT, bladeB, upper, lower, tText, bText, x };
    };
    const st = [stage(X1, 0), stage(X2, 1)];
    const shared = seg(X1, Y_NODE, X2, Y_NODE, 'lz');
    const ledWire = seg(210, Y_NODE, 210, 160, 'lz');
    const led = s('circle', { cx: 210, cy: 168, r: 9, class: 'tp-led' });
    tpSvg.appendChild(led);
    const ledText = s('text', { x: 210, y: 196, 'text-anchor': 'middle', class: 'tp-small' }, '');
    tpSvg.appendChild(ledText);
    const current = s('polyline', { points: '', class: 'tp-current' });
    tpSvg.appendChild(current);

    const tpStatus = h('div', { class: 'callout' });
    const v1 = new Toggle({ label: 'Output 1', value: true, onLabel: '1', offLabel: '0', onChange: (v) => { tp.v[0] = v ? 1 : 0; renderTp(); } });
    const v2 = new Toggle({ label: 'Output 2', value: false, onLabel: '1', offLabel: '0', onChange: (v) => { tp.v[1] = v ? 1 : 0; renderTp(); } });
    const e1 = new Toggle({ label: 'Enable 1', value: true, onChange: (v) => { tp.en[0] = v; renderTp(); } });
    const e2 = new Toggle({ label: 'Enable 2', value: true, onChange: (v) => { tp.en[1] = v; renderTp(); } });
    const enRow = row(e1.el, e2.el);
    const triMode = new Toggle({ label: 'Give the outputs an enable input (tri-state)', onChange: (v) => { tp.tri = v; renderTp(); } });

    function renderTp() {
      enRow.style.display = tp.tri ? '' : 'none';
      const stages = [0, 1].map((i) => outputStage(tp.v[i], !tp.tri || tp.en[i]));
      const j = joinOutputs(stages);
      const node = levelClass(j.level);
      stages.forEach((sg, i) => {
        const v = st[i];
        v.bladeT.setAttribute('x2', String(sg.top ? v.x : v.x + (i === 0 ? -16 : 16)));
        v.bladeT.setAttribute('y2', String(sg.top ? Y_T2 : Y_T2 - 8));
        v.bladeB.setAttribute('x2', String(sg.bottom ? v.x : v.x + (i === 0 ? -16 : 16)));
        v.bladeB.setAttribute('y2', String(sg.bottom ? Y_B2 : Y_B2 - 8));
        for (const el of [v.upper, v.lower]) {
          el.classList.remove('l0', 'l1', 'lz', 'lx');
          el.classList.add(node);
        }
        setText(v.tText, sg.top ? 'top ON' : 'top off');
        setText(v.bText, sg.bottom ? 'bottom ON' : 'bottom off');
      });
      for (const el of [shared, ledWire, led]) {
        el.classList.remove('l0', 'l1', 'lz', 'lx');
        el.classList.add(node);
      }
      setText(ledText, j.level === 'X' ? '? (short)' : j.level === 'Z' ? 'floating' : j.level === 1 ? 'on' : 'off');
      setClass(current, 'show', j.short);
      if (j.short) {
        const hi = stages[0].top ? 0 : 1;
        const lo = 1 - hi;
        current.setAttribute('points', `${st[hi].x},${Y_RAIL} ${st[hi].x},${Y_NODE} ${st[lo].x},${Y_NODE} ${st[lo].x},${Y_GND}`);
      }
      setClass(tpStatus, 'warn', j.short);
      setClass(tpStatus, 'good', !j.short && tp.tri);
      if (j.short) {
        setText(tpStatus, `Short circuit! Output ${stages[0].top ? 1 : 2} connects the wire to +5 V while output ${stages[0].top ? 2 : 1} connects it to ground. A large current flows straight through both chips (orange path), they heat up, and the wire sits at some voltage in between: neither a valid 0 nor a valid 1.`);
      } else if (j.level === 'Z') {
        setText(tpStatus, 'Both outputs are disabled: all four transistors are off and the wire is disconnected from everything. It floats (high impedance, Z).');
      } else if (stages.every((x) => x.out !== 'Z')) {
        setText(tpStatus, `Both outputs agree (${j.level}), so no current flows between them, for now. The moment one of them changes, they fight. Ordinary outputs can never safely share a wire.`);
      } else {
        const who = stages[0].out !== 'Z' ? 1 : 2;
        setText(tpStatus, `Only output ${who} is enabled; output ${3 - who} has both transistors off (Z), so it doesn't care what the wire does. The wire is ${j.level}. This is how the bus works: one driver at a time.`);
      }
    }

    // =====================================================================
    // 2. Three tri-state buffers on one wire (gate level)
    // =====================================================================
    const c = new Circuit();
    const A = [c.input('A1', 1), c.input('A2', 0), c.input('A3', 1)];
    const E = [c.input('E1', 0), c.input('E2', 0), c.input('E3', 0)];
    const W = c.net('bus wire', 'Z');
    A.forEach((a, i) => c.tri(a, E[i], W, { name: `buffer ${i + 1}` }));
    const R = c.net('74LS input', 1);
    c.buf(W, R); // what a 74LS gate input connected to the wire sees
    c.settle();

    const sch = new Schematic(c, { width: 470, height: 280 });
    const rowsY = [70, 150, 230];
    const BUS_X = 300;
    rowsY.forEach((y, i) => {
      const g = sch.gate('TRI', { x: 120, y }, { output: W });
      sch.wire(A[i], [76, y], g.inputs[0]);
      sch.wire(E[i], [104, y - 38], [g.enable!.x, y - 38], g.enable!);
      sch.wire(W, g.output, [BUS_X, y]);
      sch.dot(W, [BUS_X, y]);
      sch.switch(A[i], [76, y], { label: `A${i + 1}`, onToggle: (n) => { c.toggle(n); } });
      sch.switch(E[i], [104, y - 38], { label: `E${i + 1}`, onToggle: (n) => { c.toggle(n); } });
      sch.text(`buffer ${i + 1}`, [150, y + 26], { size: 10, class: 'gate-label' });
    });
    sch.wire(W, [BUS_X, rowsY[0]], [BUS_X, rowsY[2]]);
    sch.wire(W, [BUS_X, 150], [350, 150]);
    sch.probe(W, [BUS_X, 30], { label: 'LED on the wire', color: 'red' });
    sch.wire(W, [BUS_X, 38], [BUS_X, rowsY[0]]);
    const rd = sch.gate('BUF', { x: 360, y: 150 }, { output: R });
    sch.wire(W, [350, 150], rd.inputs[0]);
    sch.wire(R, rd.output, [430, 150]);
    sch.probe(R, [438, 150], { label: '', color: 'green' });
    sch.text('74LS input', [385, 184], { size: 10, class: 'gate-label' });
    sch.text('reads', [438, 128], { size: 10, class: 'gate-label' });
    d.add(sch.autoUpdate());

    const trace = new Trace([E[0], E[1], E[2], W], 300);
    const scope = new Scope(
      [
        { label: 'E1', color: '#fbbf24' },
        { label: 'E2', color: '#60a5fa' },
        { label: 'E3', color: '#a78bfa' },
        { label: 'bus wire', color: '#f87171' },
      ],
      { width: 640, laneHeight: 34 },
    );

    const busState = h('div', { class: 'callout' });
    const busLevel = h('span', { class: 'mono', style: 'font-size:1.4rem;font-weight:700' });
    const tt = truthTable(['E', 'A', 'Y', 'buffers in this row'], [
      ['0', '0', 'Z', ''],
      ['0', '1', 'Z', ''],
      ['1', '0', '0', ''],
      ['1', '1', '1', ''],
    ]);
    const ttRow = (e: Level, a: Level) => (e === 1 ? 2 : 0) + (a === 1 ? 1 : 0);

    function renderBus() {
      const w = W.value;
      setText(busLevel, String(w));
      busLevel.style.color = w === 1 ? 'var(--wire-1)' : w === 0 ? 'var(--wire-0)' : w === 'X' ? 'var(--wire-x)' : 'var(--fg-dim)';
      const rowsNow: number[] = [];
      const members: string[][] = [[], [], [], []];
      A.forEach((a, i) => {
        const r = ttRow(E[i].value, a.value);
        members[r].push(String(i + 1));
        rowsNow.push(r);
      });
      tt.highlight(rowsNow);
      members.forEach((m, r) => setText(tt.cells[r][3], m.join(', ')));
      const en = E.map((e, i) => (e.value === 1 ? i : -1)).filter((i) => i >= 0);
      setClass(busState, 'warn', w === 'X');
      if (w === 'X') setText(busState, `Contention: buffers ${en.map((i) => i + 1).join(' and ')} are both enabled and disagree. One pulls the wire high, the other low: a short circuit, exactly like the two plain outputs above. Only one enable may be on at a time.`);
      else if (w === 'Z') setText(busState, `No buffer is enabled, so the wire floats (Z). The LED on the wire stays dark, but look at the 74LS gate input: a floating LS-TTL input reads as 1. Ben runs into this when he loads a register from an undriven bus and gets 1111 1111; later he adds pull-down resistors to the bus.`);
      else if (en.length > 1) setText(busState, `Buffers ${en.map((i) => i + 1).join(' and ')} are enabled and happen to agree (${w}). No current flows yet, but flip one of their A switches and they will fight.`);
      else setText(busState, `Buffer ${en[0] + 1} is the only one enabled, so it drives its A value (${w}) onto the wire. The other two are high-impedance and ignore the wire. Everyone connected can read ${w}.`);
    }
    d.add(c.onChange(renderBus));
    d.add(
      runCircuit(c, {
        stepsPerSecond: 150,
        onStep: () => trace.sample(c.time),
        onFrame: () => scope.draw(trace.samples, { window: 300 }),
      }),
    );

    // =====================================================================
    // 3. The 74LS245 bus transceiver
    // =====================================================================
    const c2 = new Circuit();
    const regIn = Array.from({ length: 8 }, (_, i) => c2.input(`reg${i}`, ((0b10110010 >> i) & 1) as Bit));
    const aNet = Array.from({ length: 8 }, (_, i) => c2.net(`A${i + 1}`, 0));
    regIn.forEach((r, i) => c2.buf(r, aNet[i])); // the 74LS173 outputs (always enabled)
    const bNet = Array.from({ length: 8 }, (_, i) => c2.net(`bus${i}`, 'Z'));
    const DIR = c2.input('DIR', 1);
    const OE = c2.input('~OE', 1);
    const otherEn = c2.input('other', 0);
    const otherVal = Array.from({ length: 8 }, (_, i) => c2.input(`o${i}`, ((0b00001111 >> i) & 1) as Bit));
    otherVal.forEach((o, i) => c2.tri(o, otherEn, bNet[i]));
    addLs245(c2, { dir: DIR, oe: OE, a: aNet, b: bNet, name: 'U7' });
    c2.settle();

    const sch2 = new Schematic(c2, { width: 470, height: 300 });
    const chip = sch2.chip(
      { x: 190, y: 50 },
      {
        label: '74LS245',
        sublabel: 'transceiver',
        width: 120,
        height: 190,
        left: aNet.map((n, i) => ({ name: `${LS245_PINS.A[i]} A${i + 1}`, net: n })).reverse(),
        right: bNet.map((n, i) => ({ name: `B${i + 1} ${LS245_PINS.B[i]}`, net: n })).reverse(),
        top: [{ name: 'DIR 1', net: DIR }],
        bottom: [{ name: '~OE 19', net: OE, bubble: true }],
      },
    );
    const settle2 = (n: Net) => { c2.toggle(n); c2.settle(); };
    chip.left.forEach((p, k) => {
      const bit = 7 - k;
      sch2.wire(aNet[bit], [70, p.y], p);
      sch2.switch(regIn[bit], [70, p.y], { label: `Q${bit}`, onToggle: settle2 });
    });
    const other = sch2.chip({ x: 400, y: 50 }, { label: 'other', sublabel: 'module', width: 56, height: 190, left: bNet.map((n) => ({ name: '', net: n })).reverse(), bottom: [{ name: 'EN', net: otherEn }] });
    chip.right.forEach((p, k) => {
      const bit = 7 - k;
      sch2.wire(bNet[bit], p, other.left[k]);
      sch2.probe(bNet[bit], [350, p.y], { color: 'red' });
    });
    sch2.text('bus', [350, 36], { size: 11 });
    sch2.text('register (173 outputs)', [70, 36], { size: 10, class: 'gate-label', anchor: 'start' });
    sch2.wire(DIR, chip.top[0], [chip.top[0].x, 18], [150, 18]);
    sch2.switch(DIR, [150, 18], { label: 'DIR', onToggle: settle2 });
    sch2.wire(OE, chip.bottom[0], [chip.bottom[0].x, 280], [150, 280]);
    sch2.switch(OE, [150, 280], { label: '~OE', onToggle: settle2 });
    sch2.wire(otherEn, other.bottom[0], [other.bottom[0].x, 280], [400, 280]);
    sch2.switch(otherEn, [400, 280], { label: 'other EN', onToggle: settle2 });
    d.add(sch2.autoUpdate());

    const s245 = h('div', { class: 'callout' });
    const render245 = () => {
      const dir = DIR.value, oe = OE.value, oth = otherEn.value === 1;
      const aX = aNet.some((n) => n.value === 'X'), bX = bNet.some((n) => n.value === 'X');
      setClass(s245, 'warn', aX || bX);
      if (oe === 1) setText(s245, `~OE is high: all 16 buffers are off, both sides are high-impedance. The register is disconnected from the bus${oth ? ' and the other module can drive it freely' : ''}. (On Ben's board the 173 outputs still light the register LEDs, because those come before the 245.)`);
      else if (dir === 1 && bX) setText(s245, '~OE is low and DIR = 1, so the 245 drives the register value onto the bus, but the other module is driving too. Contention (orange) on every bit where they differ. Exactly one output enable at a time!');
      else if (dir === 1) setText(s245, '~OE is low and DIR = 1: A → B. The register value appears on the bus. This is the A register’s AO: Ben ties DIR to +5 V and drives ~OE with ~AO.');
      else if (aX) setText(s245, `DIR = 0 turns the chip around: B → A. Now the 245 drives the register side${oth ? ' with the bus value' : ' (the floating bus reads as 1s)'} while the 173 outputs are also driving it. Contention on the A side. That's why DIR is simply tied high on every output-only module.`);
      else setText(s245, 'DIR = 0: B → A. The bus value is copied to the A side. Nothing fights right now, but on a register board the A pins are the 173 outputs, so this would cause contention.');
    };
    d.add(c2.onChange(render245));

    // =====================================================================
    // layout
    // =====================================================================
    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Two ordinary outputs on one wire', { accent: 'orange', subtitle: 'why you can’t just join outputs' }, tpSvg, row(v1.el, v2.el), triMode.el, enRow, tpStatus),
        panel(
          'Inside an output',
          { accent: 'gray' },
          note('A TTL output stage is two transistors stacked between +5 V and ground (a “totem pole”). Output 1 turns the top one on, output 0 the bottom one. Exactly one of them conducts, so the output is always driving the wire one way or the other.'),
          note('A tri-state output adds an enable input. When it is disabled both transistors turn off. The output is then neither 1 nor 0; it is effectively disconnected. That third state is called high-impedance, written Z.'),
          levelLegend(),
        ),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Three tri-state buffers sharing one wire', { accent: 'red', chips: 'tri-state buffers (8 per 74LS245)' }, sch.el, levelLegend(), note('Click A1-A3 to change each buffer’s data and E1-E3 to enable it.')),
        h(
          'div',
          { class: 'lab-stack' },
          panel('The wire right now', { accent: 'gray' }, row(h('span', { class: 'dim' }, 'level:'), busLevel), busState),
          panel('Tri-state buffer truth table', { accent: 'gray' }, tt.el, note('E = enable, A = data in, Y = output. With E = 0 the output is Z whatever A is.')),
          panel('Timing', { accent: 'gray', subtitle: 'dashed = floating, shaded = contention' }, scope.el),
        ),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('74LS245 octal bus transceiver', { accent: 'blue', chips: '74LS245: DIR pin 1, A1-A8 pins 2-9, GND 10, B8-B1 pins 11-18, ~OE pin 19, VCC 20' }, sch2.el, note('Toggle the register bits (Q0-Q7), DIR and ~OE (active low: the bubble). “other EN” lets a second module drive 0000 1111 onto the bus.')),
        h(
          'div',
          { class: 'lab-stack' },
          panel('What the 245 is doing', { accent: 'gray' }, s245),
          panel(
            'On the computer',
            { accent: 'gray' },
            note('Eight tri-state buffers in each direction. ~OE (output enable, active low) switches all of them on or off; DIR picks the direction: 1 = A to B, 0 = B to A.'),
            note('Every module that writes to the bus (A register, ALU, RAM, instruction register, program counter) has a 74LS245 between it and the bus, with DIR tied high and ~OE driven by its “out” signal (~AO, ~EO, ~RO, ~IO, ~CO).'),
          ),
        ),
      ),
    );
    renderTp();
    renderBus();
    render245();
    d.add(animate((dt) => {
      // march the short-circuit current along its path
      const off = (Number(current.getAttribute('stroke-dashoffset') ?? 0) - dt * 0.06) % 20;
      current.setAttribute('stroke-dashoffset', String(off));
    }));
    return d.dispose;
  },
});
