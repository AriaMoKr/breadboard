import { mountComputerWorkbench } from '../../app/computer-page';
import { Circuit } from '../../logic/circuit';
import { bin, hex } from '../../sim/assembler';
import { Machine } from '../../sim/machine';
import { Button, DipSwitch, LedBar, Scope, Slider, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, h, headCell, s, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import {
  TTL_THRESHOLD, busAt, cellAt, faultyStore, rcNode, rcPulseWidth, rcTau, simulateWrite, walkingOnes, wireDestination, writeWaveforms,
  type WiringFault, type WriteScenario,
} from './_shared';
import { badge, scopedStyle, stepList } from './_ui';

const CSS = `
.ram-test .wiring { width: 100%; max-width: 420px; height: auto; display: block; }
.ram-test .wiring line { stroke-width: 3; stroke-linecap: round; }
.ram-test .wiring .ok { stroke: var(--wire-0); }
.ram-test .wiring .shifted { stroke: var(--wire-x); }
.ram-test .wiring .pin { fill: var(--panel-2); stroke: var(--fg-dim); stroke-width: 1.5; }
.ram-test .wiring .pin.float { fill: var(--wire-1); }
.ram-test .wiring text { fill: var(--fg); font-family: var(--mono); font-size: 11px; }
.ram-test .wiring .dimtext { fill: var(--fg-dim); font-size: 10px; }
.ram-test .rc-part { stroke: var(--fg-dim); stroke-width: 2.5; fill: none; }
.ram-test .badbit { color: var(--danger); font-weight: 700; }
@media (prefers-color-scheme: light) { .ram-test .badbit { color: #b91c1c; } }
`;

const fmtTime = (t: number) => (Math.abs(t) >= 1e-3 ? `${+(t * 1e3).toPrecision(3)} ms` : `${+(t * 1e6).toPrecision(3)} µs`);
const fmtOhm = (r: number) => (r >= 1000 ? `${+(r / 1000).toPrecision(3)} kΩ` : `${Math.round(r)} Ω`);
const fmtFarad = (c: number) => (c >= 1e-6 ? `${+(c * 1e6).toPrecision(3)} µF` : `${+(c * 1e9).toPrecision(3)} nF`);

const BEFORE = 0x2a;
const AFTER = 0x55;
const JUNK = 0x00;

export default defineLab({
  id: 'ram-test',
  title: 'RAM testing and troubleshooting',
  summary:
    'Ben powers up the finished RAM module, finds data wires that were plugged in one hole off (the empty input floats high, so 1s appear), and then changes when RAM writes happen. With W̅E̅ = NAND(RI, CLK) the 74189 writes for the whole time the clock is high. Every other register only latches on the rising edge, so Ben adds a 0.01 µF / 1 kΩ RC edge detector that makes the write a ~10 µs pulse right after the edge. Compare the two below, solve the wiring puzzle, then test the real module on the computer.',
  mount(root) {
    const d = new Disposer();
    d.add(scopedStyle(root, CSS));
    root.classList.add('ram-test');

    // =====================================================================
    // 1 · write timing
    const sc: WriteScenario = { tHigh: 100e-6, tChange: 50e-6, before: BEFORE, after: AFTER, r: 1000, c: 10e-9 };
    let changeFrac = 0.5;
    let cursor = 0.35; // 0..1 across the scope window
    let playing = false;
    const N = 360;
    const win = () => [-0.12 * sc.tHigh, 1.3 * sc.tHigh] as const;
    const timeAt = (f: number) => win()[0] + (win()[1] - win()[0]) * f;

    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa', kind: 'analog', min: -1, max: 5.5 },
        { label: 'RC node (C7/R58)', color: '#fbbf24', kind: 'analog', min: -1, max: 5.5, guides: [TTL_THRESHOLD] },
        { label: 'W̅E̅ = NAND(RI, CLK)', color: '#f87171' },
        { label: 'W̅E̅ = NAND(RI, RC)', color: '#4ade80' },
        { label: `bus: 0x${hex(BEFORE)} → 0x${hex(AFTER)}`, color: '#c084fc' },
      ],
      { width: 640, laneHeight: 46 },
    );
    const cursorEl = h('div', { class: 'scope-cursor' });
    const scopeWrap = h('div', { class: 'scope-wrap' }, scope.el, cursorEl);

    const tHighS = new Slider({ label: 'clock high for', min: 20e-6, max: 5e-3, value: sc.tHigh, log: true, format: fmtTime, onInput: (v) => { sc.tHigh = v; sc.tChange = v * changeFrac; redraw(); } });
    const changeS = new Slider({ label: 'bus changes at', min: 0.02, max: 0.98, step: 0.01, value: changeFrac, format: (f) => `${Math.round(f * 100)} % of high`, onInput: (v) => { changeFrac = v; sc.tChange = sc.tHigh * v; redraw(); } });
    const rS = new Slider({ label: 'R58', min: 100, max: 10000, value: sc.r, log: true, format: fmtOhm, onInput: (v) => { sc.r = v; redraw(); } });
    const cS = new Slider({ label: 'C7', min: 1e-9, max: 0.1e-6, value: sc.c, log: true, format: fmtFarad, onInput: (v) => { sc.c = v; redraw(); } });
    const cursorS = new Slider({ label: 'time cursor', min: 0, max: 1, step: 0.002, value: cursor, format: () => fmtTime(timeAt(cursor)), onInput: (v) => { cursor = v; playing = false; redrawCursor(); } });
    const playBtn = new Button({ label: '▶ Play the clock pulse', onClick: () => { cursor = 0; playing = true; } });
    const benBtn = new Button({ label: 'Ben’s values', title: 'C7 = 0.01 µF, R58 = 1 kΩ', onClick: () => { sc.r = 1000; sc.c = 10e-9; rS.set(sc.r); cS.set(sc.c); redraw(); } });

    const levelRes = badge();
    const edgeRes = badge();
    const pulseInfo = h('div', { class: 'mono small' });
    const cellLevel = new LedBar({ bits: 8, color: 'red', formats: ['hex'], label: 'cell (level)' });
    const cellEdge = new LedBar({ bits: 8, color: 'green', formats: ['hex'], label: 'cell (RC)' });
    const busBar = new LedBar({ bits: 8, color: 'red', formats: ['hex'], label: 'bus' });
    const timingCallout = h('div', { class: 'callout' });

    // small live schematic of the edge detector, showing levels at the cursor
    const rc = new Circuit();
    const nClk = rc.input('CLK', 0);
    const nNode = rc.input('RC', 0);
    const nRi = rc.input('RI', 1);
    const nWe = rc.input('W̅E̅', 1);
    const sch = new Schematic(rc, { width: 420, height: 170 });
    sch.wire(nClk, [40, 60], [112, 60]);
    sch.probe(nClk, [34, 60], { label: 'CLK', labelSide: 'top', color: 'blue' });
    const plate = (x: number) => sch.el.appendChild(s('line', { x1: x, y1: 46, x2: x, y2: 74, class: 'rc-part' }));
    plate(112);
    plate(120);
    sch.text('C7 0.01 µF', [116, 34], { size: 10, class: 'cap' });
    const nand = sch.gate('NAND', [240, 80], { output: nWe, label: '74LS00' });
    sch.wire(nNode, [120, 60], [190, 60], [190, nand.inputs[0].y], nand.inputs[0]);
    sch.wire(nNode, [150, 60], [150, 92]);
    sch.dot(nNode, [150, 60]);
    sch.el.appendChild(s('polyline', { points: '150,92 142,96 158,102 142,108 158,114 142,120 158,126 150,130', class: 'rc-part' }));
    sch.el.appendChild(s('line', { x1: 150, y1: 130, x2: 150, y2: 142, class: 'rc-part' }));
    sch.el.appendChild(s('line', { x1: 138, y1: 142, x2: 162, y2: 142, class: 'rc-part' }));
    sch.el.appendChild(s('line', { x1: 143, y1: 147, x2: 157, y2: 147, class: 'rc-part' }));
    sch.text('R58 1 kΩ', [100, 112], { size: 10, class: 'cap' });
    sch.wire(nRi, [214, 140], [214, nand.inputs[1].y], nand.inputs[1]);
    sch.probe(nRi, [214, 148], { label: 'RI', labelSide: 'bottom', color: 'blue' });
    sch.wire(nWe, nand.output, [350, 80]);
    sch.probe(nWe, [358, 80], { label: 'W̅E̅', color: 'red', labelSide: 'top' });
    const nodeV = sch.label('', [196, 40], { anchor: 'start', size: 11, class: 'val' });
    d.add(sch.autoUpdate());

    const redraw = () => {
      const [t0, t1] = win();
      const wf = writeWaveforms(sc, N, t0, t1);
      scope.draw([wf.clk, wf.rc, wf.weLevel, wf.weEdge, wf.bus], { window: N });
      const L = simulateWrite(sc, 'level');
      const E = simulateWrite(sc, 'edge');
      levelRes.set(`NAND(RI, CLK) stored 0x${hex(L.stored)} ${L.correct ? '✓' : '✗ wrong byte'}`, L.correct ? 'ok' : 'bad');
      edgeRes.set(`NAND(RI, RC pulse) stored 0x${hex(E.stored)} ${E.correct ? '✓' : '✗ wrong byte'}`, E.correct ? 'ok' : 'bad');
      const pw = rcPulseWidth(sc.r, sc.c);
      setText(pulseInfo, `τ = RC = ${fmtTime(rcTau(sc.r, sc.c))} · node above ${TTL_THRESHOLD} V for ${fmtTime(pw)} · bus changes ${fmtTime(sc.tChange)} after the edge`);
      setText(
        timingCallout,
        !L.correct && E.correct
          ? `The bus changes ${fmtTime(sc.tChange)} after the rising edge. With W̅E̅ = NAND(RI, CLK) the 189 is still writing (the clock is high for ${fmtTime(sc.tHigh)}), so the cell ends up with the new value 0x${hex(AFTER)}. The RC version only wrote for the first ${fmtTime(Math.min(pw, sc.tHigh))}, while the bus still held 0x${hex(BEFORE)}, so it behaves like an edge-triggered register.`
          : !E.correct
            ? `The RC pulse (${fmtTime(Math.min(pw, sc.tHigh))}) is still going when the bus changes at ${fmtTime(sc.tChange)}, so even the edge version stores the wrong byte. The pulse has to be short compared with anything that happens after the edge: that is why Ben picks a small RC (0.01 µF × 1 kΩ = 10 µs).`
            : `Here both versions store 0x${hex(BEFORE)}: the bus didn’t change while either W̅E̅ was low. Move the “bus changes at” slider earlier to see the difference.`,
      );
      redrawCursor();
    };
    const redrawCursor = () => {
      const canvas = scope.canvas;
      cursorEl.style.left = `${canvas.offsetLeft + cursor * canvas.clientWidth}px`;
      const t = timeAt(cursor);
      cellLevel.set(cellAt(sc, 'level', t, JUNK));
      cellEdge.set(cellAt(sc, 'edge', t, JUNK));
      busBar.set(busAt(sc, t));
      cursorS.set(cursor);
      const v = rcNode(t, sc.tHigh, rcTau(sc.r, sc.c));
      rc.set(nClk, t >= 0 && t < sc.tHigh ? 1 : 0);
      rc.set(nNode, v > TTL_THRESHOLD ? 1 : 0);
      rc.set(nWe, v > TTL_THRESHOLD ? 0 : 1);
      nodeV.textContent = `node = ${v.toFixed(2)} V`;
    };
    d.add(
      animate((dt) => {
        if (!playing) return;
        cursor = Math.min(1, cursor + dt / 3500);
        if (cursor >= 1) playing = false;
        redrawCursor();
      }),
    );
    // the canvas size is only known after layout
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => redrawCursor()) : null;
    ro?.observe(scope.canvas);
    d.add(() => ro?.disconnect());

    // =====================================================================
    // 2 · troubleshooting puzzle
    let fault: WiringFault | null = { from: 1 + Math.floor(Math.random() * 6) };
    let revealed = false;
    let solved = false;
    const tests: { wrote: number; read: number }[] = [];
    const pDip = new DipSwitch({ bits: 8, label: 'data', value: 0 });
    const wroteBar = new LedBar({ bits: 8, color: 'yellow', formats: ['bin'], label: 'wrote' });
    const readBar = new LedBar({ bits: 8, color: 'red', formats: ['bin'], label: 'read ' });
    const testTable = h('tbody');
    const puzzleMsg = h('div', { class: 'callout' }, 'Something is wrong with this RAM module: write a few bytes and compare what comes back.');
    const wiring = s('svg', { viewBox: '0 0 420 150', class: 'wiring', role: 'img', 'aria-label': 'Data wires between the 74LS157 outputs and the 74189 inputs' });
    const drawWiring = () => {
      wiring.replaceChildren();
      wiring.appendChild(s('text', { x: 6, y: 16, class: 'dimtext' }, '74LS157 data outputs'));
      wiring.appendChild(s('text', { x: 6, y: 144, class: 'dimtext' }, '74189 data inputs'));
      const x = (i: number) => 380 - i * 48;
      for (let i = 0; i < 8; i++) {
        const dst = revealed ? wireDestination(i, fault) : i;
        const shifted = revealed && dst !== i;
        if (dst !== null) wiring.appendChild(s('line', { x1: x(i), y1: 36, x2: x(dst), y2: 112, class: shifted ? 'shifted' : 'ok' }));
        else wiring.appendChild(s('line', { x1: x(i), y1: 36, x2: x(i) + 30, y2: 100, class: 'shifted' }));
        wiring.appendChild(s('circle', { cx: x(i), cy: 32, r: 6, class: 'pin' }));
        const floating = revealed && fault !== null && i === fault.from;
        wiring.appendChild(s('circle', { cx: x(i), cy: 116, r: 6, class: `pin ${floating ? 'float' : ''}` }));
        wiring.appendChild(s('text', { x: x(i) - 8, y: 56, 'text-anchor': 'end' }, `D${i}`));
        wiring.appendChild(s('text', { x: x(i) - 8, y: 100, 'text-anchor': 'end' }, `D${i}`));
      }
      if (!revealed) wiring.appendChild(s('text', { x: 210, y: 78, 'text-anchor': 'middle', class: 'dimtext' }, 'wiring hidden: find the fault from the tests'));
    };
    const renderTests = () => {
      testTable.replaceChildren(
        ...tests.slice(-10).map((t) => {
          const diff = t.wrote ^ t.read;
          return h(
            'tr',
            null,
            h('td', null, bin(t.wrote, 8)),
            h('td', null, ...Array.from({ length: 8 }, (_, i) => {
              const b = 7 - i;
              return h('span', { class: (diff >> b) & 1 ? 'badbit' : '' }, String((t.read >> b) & 1));
            })),
            h('td', null, diff ? `bits ${[...Array(8).keys()].filter((b) => (diff >> b) & 1).reverse().join(', ')} differ` : 'ok'),
          );
        }),
      );
    };
    const doTest = (v: number) => {
      const r = faultyStore(v, fault);
      tests.push({ wrote: v, read: r });
      wroteBar.set(v);
      readBar.set(r);
      renderTests();
    };
    const writeRead = new Button({ label: 'Write, then read back', kind: 'primary', onClick: () => doTest(pDip.value) });
    const walk = new Button({ label: 'Walk a 1 through all 8 bits', onClick: () => { walkingOnes(fault).forEach((t) => doTest(t.wrote)); } });
    const zeros = new Button({ label: 'Write 00000000', onClick: () => doTest(0) });
    let guess = '1';
    const guessSel = select(
      Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: `D${i} (and the ones above it)` })),
      guess,
      (v) => (guess = v),
      'First wire one hole off:',
    );
    const check = new Button({
      label: 'Check',
      onClick: () => {
        if (!fault) return;
        solved = Number(guess) === fault.from;
        if (solved) revealed = true;
        drawWiring();
        setText(
          puzzleMsg,
          solved
            ? `Right. Data wires D${fault.from} to D6 were each pushed one hole up, D7 ended up on a pin that isn’t a data input, and the empty input D${fault.from} floats. A floating TTL input reads as 1, which is why every byte comes back with bit ${fault.from} set: exactly the “extra 1s” Ben saw.`
            : `Not quite. Look for the bit that always reads 1 (even when you write 00000000), then check where each single 1 bit you write actually lands.`,
        );
      },
    });
    const reveal = new Button({ label: 'Show the wiring', kind: 'ghost', onClick: () => { revealed = !revealed; drawWiring(); reveal.setLabel(revealed ? 'Hide the wiring' : 'Show the wiring'); } });
    const fixBtn = new Button({ label: 'Fix the wires', onClick: () => { fault = null; revealed = true; drawWiring(); setText(puzzleMsg, 'Fixed: every wire goes to its own pin, so every pattern reads back exactly as written.'); } });
    const newBoard = new Button({
      label: 'New faulty board',
      onClick: () => {
        fault = { from: Math.floor(Math.random() * 7) };
        revealed = false;
        solved = false;
        tests.length = 0;
        renderTests();
        drawWiring();
        reveal.setLabel('Show the wiring');
        setText(puzzleMsg, 'A new module with a wiring mistake somewhere in the data path. Write a few bytes and compare what comes back.');
      },
    });
    drawWiring();

    // =====================================================================
    // 3 · on the computer
    // No 10 kΩ bus pull-downs yet (they arrive in video 34): an undriven bus floats and reads 0xFF.
    const machine = new Machine({ microcodeVersion: 'flags', pullDowns: false });
    const cpu = machine.computer;
    for (let i = 0; i < 16; i++) cpu.ram[i] = Math.floor(Math.random() * 256);
    cpu.programMode = true;
    const wbHost = h('div');
    const written = new Map<number, number>();
    const readBack = new Map<number, number>();
    let ramSnap = Array.from(cpu.ram);
    let marLoaded = false;
    const checklist = stepList([
      'Program mode: set the address switches (Memory address) and data switches (RAM), then press Write. Store bytes at 3 different addresses.',
      'Turn Program off (run mode). The yellow LEDs now show the MAR instead of the switches.',
      'Turn on Drive bus, set one of your addresses on the bus switches, turn on MI and press Clock pulse: the MAR loads it.',
      'Turn MI and Drive bus off, turn on RO: the bus LEDs show the byte stored there. Read all your bytes back.',
    ]);
    const rbTable = h('tbody');
    const rbCallout = h('div', { class: 'callout' });
    const onMachine = () => {
      const now = Array.from(cpu.ram);
      now.forEach((v, a) => {
        if (v !== ramSnap[a] && cpu.programMode) {
          written.set(a, v);
          readBack.delete(a);
        }
      });
      ramSnap = now;
      if (!cpu.programMode && cpu.lastTransfers.some((t) => t.signal === 'MI')) marLoaded = true;
      const bus = cpu.bus;
      if (!cpu.programMode && bus.drivers.length === 1 && bus.drivers[0] === 'ram' && written.has(cpu.ramAddress)) readBack.set(cpu.ramAddress, bus.value);
      const allRead = written.size > 0 && [...written.keys()].every((a) => readBack.has(a));
      const done = [written.size >= 3, written.size >= 3 && !cpu.programMode, marLoaded, written.size >= 3 && allRead];
      checklist.set(done, done.indexOf(false));
      rbTable.replaceChildren(
        ...[...written.entries()].sort((a, b) => a[0] - b[0]).map(([a, v]) => {
          const r = readBack.get(a);
          return h('tr', { class: cpu.ramAddress === a ? 'current' : '' }, h('td', null, `${a} (${bin(a, 4)})`), h('td', null, bin(v, 8)), h('td', null, r === undefined ? '…' : bin(r, 8)), h('td', null, r === undefined ? '' : r === v ? '✓' : '✗'));
        }),
      );
      setText(
        rbCallout,
        cpu.programMode
          ? `Program mode: the RAM address is the address DIP (${bin(cpu.dipAddress, 4)}); Write stores the data DIP there. MI, RI and RO from the control switches don’t change what address the RAM sees.`
          : bus.contention
            ? 'Two things drive the bus at once (bus switches and RO). Turn the bus switches off before reading.'
            : `Run mode: the RAM address comes from the MAR (${bin(cpu.mar, 4)}) and holds 0x${hex(cpu.ramValue)}.${(cpu.controlWord & (1 << 12)) !== 0 ? ' RO is on, so that byte is on the bus.' : bus.drivers.length === 0 ? ' Nothing drives the bus and there are no pull-down resistors yet, so it floats and reads 0xFF: an MI pulse now would load 1111 into the MAR.' : ''}`,
      );
    };

    // ---- layout ----
    root.append(
      h(
        'div',
        { class: 'lab-stack' },
        h(
          'div',
          { class: 'lab-grid two' },
          panel(
            '1 · When does the RAM write?',
            { accent: 'red', subtitle: 'RI = 1, one clock pulse' },
            scopeWrap,
            row(playBtn.el, cursorS.el),
            row(busBar.el),
            row(cellLevel.el),
            row(cellEdge.el),
            row(levelRes.el, edgeRes.el),
            timingCallout,
          ),
          h(
            'div',
            { class: 'lab-stack' },
            panel('The RC edge detector', { accent: 'yellow', chips: '74LS00, C7 0.01 µF, R58 1 kΩ' }, sch.el, pulseInfo, note('When CLK jumps to 5 V the capacitor passes the jump straight through, then charges through R58 and the node decays back to 0 V with time constant RC. The NAND only sees a 1 while the node is above the TTL threshold, so W̅E̅ is a short pulse after each rising edge. On the falling edge the node dips below 0 V, which is clamped by the input diode and ignored.')),
            panel('Timing controls', { accent: 'gray' }, tHighS.el, changeS.el, rS.el, cS.el, row(benBtn.el), note('Ben’s real clock runs at a few Hz, so CLK is high for hundreds of milliseconds: the 10 µs pulse is a tiny sliver at the very start. The scope is zoomed in so you can see it.')),
          ),
        ),
        h(
          'div',
          { class: 'lab-grid two' },
          panel(
            '2 · Troubleshooting: walk a 1 through',
            { accent: 'orange', subtitle: 'a module with a wiring mistake' },
            puzzleMsg,
            row(pDip.el, writeRead.el),
            row(walk.el, zeros.el),
            row(wroteBar.el),
            row(readBar.el),
            h('div', { class: 'table-scroll' }, h('table', { class: 'truth-table compact' }, h('thead', null, h('tr', null, h('th', null, 'wrote'), h('th', null, 'read back'), headCell(''))), testTable)),
          ),
          panel('Find the fault', { accent: 'orange' }, wiring, row(guessSel), row(check.el, reveal.el, fixBtn.el, newBoard.el), note('Ben’s fix: some connections were shifted by one pin. Unconnected (floating) TTL inputs read as 1, so writing all zeros is a quick way to spot an input that isn’t wired.')),
        ),
        panel(
          '3 · Test it on the computer',
          { accent: 'blue', subtitle: 'clock, bus, MAR and RAM with manual control signals' },
          h('div', { class: 'lab-grid two' }, h('div', null, checklist.el), h('div', { class: 'mo-col' }, rbCallout, h('div', { class: 'table-scroll' }, h('table', { class: 'truth-table compact' }, h('thead', null, h('tr', null, h('th', null, 'address'), h('th', null, 'written'), h('th', null, 'read over the bus'), headCell(''))), rbTable)))),
          wbHost,
        ),
      ),
    );

    const wb = mountComputerWorkbench(wbHost, { machine, modules: ['clock', 'bus', 'mar', 'ram', 'control'], manualControl: true, busInput: true, tabs: ['program'], keyboard: false });
    d.add(wb.dispose);
    d.add(machine.onChange(onMachine));
    onMachine();
    redraw();
    return d.dispose;
  },
});
