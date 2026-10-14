import { Button, Toggle, note, panel, row, select } from '../../ui/components';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { defineLab } from '../types';
import { BitRow, labFrame } from '../registers/_shared';
import { BEN_FAULTS, LS283_PINS, applyFaults, bitOf, describeSource, evalWiring, fixWire, isCorrect, nextHint, randomFaults, toBinSpaced, wireId, wrongWires, type AluTest, type AluWiring, type Fault, type Side } from './_model';

/**
 * Video 17 — "Troubleshooting the ALU".
 * A miswired ALU: by default the two faults Ben found (A bit 3 jumpered one
 * row off, B bits 2/3, his 3rd and 4th, swapped), or random ones. Isolate with simple test
 * vectors, probe, re-seat jumpers, then confirm 2 + 6 = 8 and 6 − 2 = 4.
 */

const CSS = `
.tr-matrix { border-collapse: collapse; font-family: var(--mono); font-size: 0.8rem; }
.tr-matrix th { color: var(--fg-dim); font-weight: 500; padding: 2px 3px; text-align: center; }
.tr-matrix th.rowh { text-align: left; padding-right: 8px; white-space: nowrap; }
.tr-matrix td { padding: 2px; }
.tr-cell { width: 28px; height: 26px; border-radius: 5px; border: 1px solid var(--border); background: var(--panel-2); color: var(--fg-faint); font: 700 0.8rem var(--mono); cursor: pointer; padding: 0; }
.tr-cell.ok { background: color-mix(in srgb, var(--ok) 30%, var(--panel)); border-color: var(--ok); color: var(--fg); }
.tr-cell.bad { background: color-mix(in srgb, var(--danger) 35%, var(--panel)); border-color: var(--danger); color: var(--fg); }
.tr-cell.cur { outline: 2px solid var(--accent); outline-offset: 1px; }
.tr-wires { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 4px; max-width: 330px; }
.tr-wires button { font: 600 0.75rem var(--mono); padding: 5px 0; border-radius: 6px; border: 1px solid var(--border); background: var(--panel-2); color: var(--fg); cursor: pointer; }
.tr-wires button.fixed { background: color-mix(in srgb, var(--ok) 30%, var(--panel)); border-color: var(--ok); }
.tr-wires button.fine { color: var(--fg-faint); }
.tr-wires button.probe { border-style: dashed; }
.tr-result { display: flex; flex-direction: column; gap: 4px; }
.tr-result .lbl { color: var(--fg-dim); font-size: 0.82rem; margin-top: 4px; }
.tr-big { font: 700 1.05rem var(--mono); }
`;

type Scenario = 'ben' | 'one' | 'two';

export default defineLab({
  id: 'alu-troubleshooting',
  title: 'Troubleshooting the ALU',
  summary:
    'Ben powers up his freshly built ALU and it gets the wrong answers: with A = 0 and B = 8 the sum LEDs show 4. Instead of staring at the wires he simplifies the inputs until the fault has nowhere to hide: A = B = 0 first, then A on its own one bit at a time, then B on its own. Use the same strategy on this board, find the bad jumpers, re-seat them, and prove the fix with 2 + 6 = 8 and 6 − 2 = 4.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d, CSS);

    let scenario: Scenario = 'ben';
    let faults: Fault[] = BEN_FAULTS;
    let wiring: AluWiring = applyFaults(faults);
    let a = 0, b = 8, su = false;
    let tests = new Map<string, { a: number; b: number; su: boolean }>();
    let order: string[] = [];
    let inspections = 0, probes = 0;
    let wireNotes = new Map<string, 'fixed' | 'fine'>();
    let ran = { add: false, sub: false };
    const log: { text: string; cls: string }[] = [];

    // ---- inputs ----
    const aRow = new BitRow({ bits: 8, value: a, label: 'A', weights: [128, 64, 32, 16, 8, 4, 2, 1], onChange: (v) => setInputs(v, b, su) });
    const bRow = new BitRow({ bits: 8, value: b, label: 'B', weights: [128, 64, 32, 16, 8, 4, 2, 1], onChange: (v) => setInputs(a, v, su) });
    const suT = new Toggle({ label: 'SU (subtract)', onChange: (v) => setInputs(a, b, v) });
    const expRow = new BitRow({ bits: 8, readOnly: true, color: 'green' });
    const gotRow = new BitRow({ bits: 8, readOnly: true });
    const expText = h('span', { class: 'tr-big' });
    const gotText = h('span', { class: 'tr-big' });
    const verdict = h('div', { class: 'callout' });
    const scenarioSel = select<Scenario>(
      [
        { value: 'ben', label: 'Ben’s ALU (video 17)' },
        { value: 'one', label: 'Random: one fault' },
        { value: 'two', label: 'Random: two faults' },
      ],
      'ben',
      (v) => { scenario = v; newBoard(); },
      'Board',
    );
    const newBtn = new Button({ label: 'New board', kind: 'ghost', onClick: () => newBoard() });

    // ---- isolation matrix ----
    const hint = h('div', { class: 'callout' });
    const cellsA: HTMLButtonElement[] = [], cellsB: HTMLButtonElement[] = [];
    const mkCell = (side: Side, bit: number) => {
      const btn = h('button', { type: 'button', class: 'tr-cell', title: `${side.toUpperCase()} = ${1 << bit} alone` }, '·');
      btn.addEventListener('click', () => (side === 'a' ? setInputs(1 << bit, 0, false) : setInputs(0, 1 << bit, false)));
      (side === 'a' ? cellsA : cellsB).push(btn);
      return h('td', null, btn);
    };
    const bitsHdr = [7, 6, 5, 4, 3, 2, 1, 0];
    const matrix = h(
      'table',
      { class: 'tr-matrix' },
      h('thead', null, h('tr', null, h('th', { class: 'rowh' }, 'bit'), bitsHdr.map((i) => h('th', null, String(i))))),
      h(
        'tbody',
        null,
        h('tr', null, h('th', { class: 'rowh' }, 'A alone'), bitsHdr.map((i) => mkCell('a', i))),
        h('tr', null, h('th', { class: 'rowh' }, 'B alone'), bitsHdr.map((i) => mkCell('b', i))),
      ),
    );
    const zeroAdd = new Button({ label: '0 + 0', onClick: () => setInputs(0, 0, false) });
    const zeroSub = new Button({ label: '0 − 0', onClick: () => setInputs(0, 0, true) });
    const symptom = new Button({ label: 'Ben’s symptom: 0 + 8', kind: 'ghost', onClick: () => setInputs(0, 8, false) });

    // ---- logic probe ----
    const probeOut = h('div', { class: 'mono small' }, 'Click a pin to measure it with the logic probe.');
    const probeBtns = (side: Side) =>
      h(
        'div',
        { class: 'tr-wires' },
        bitsHdr.map((i) => {
          const btn = h('button', { type: 'button', class: 'probe', title: side === 'a' ? `adder A input, bit ${i}` : `XOR input, bit ${i}` }, `${side.toUpperCase()}${i}`);
          btn.addEventListener('click', () => {
            probes++;
            const r = evalWiring(wiring, a, b, su);
            const lvl = bitOf(side === 'a' ? r.adderA : r.xorIn, i);
            const reg = bitOf(side === 'a' ? a : b, i);
            const chip = i < 4 ? 'U21' : 'U20';
            const where = side === 'a' ? `${chip} pin ${LS283_PINS.A[i % 4]} (A${(i % 4) + 1})` : `the 74LS86 input for B bit ${i}`;
            setText(probeOut, `${where}: ${lvl ? 'HIGH (1)' : 'LOW (0)'} · the ${side.toUpperCase()} register’s bit ${i} LED is ${reg ? 'on (1)' : 'off (0)'}${lvl !== reg ? ' → mismatch!' : ''} · probes used: ${probes}`);
          });
          return btn;
        }),
      );

    // ---- re-seat jumpers ----
    const wireBtns = new Map<string, HTMLButtonElement>();
    const wireGrid = (side: Side) =>
      h(
        'div',
        { class: 'tr-wires' },
        bitsHdr.map((i) => {
          const id = wireId(side, i);
          const btn = h('button', { type: 'button', title: `Check and re-seat the jumper for ${side.toUpperCase()} bit ${i}` }, id);
          btn.addEventListener('click', () => inspect(side, i));
          wireBtns.set(id, btn);
          return btn;
        }),
      );
    const inspectOut = h('div', { class: 'callout' }, 'When you know which jumpers are suspicious, click them to trace and re-seat them. Every check costs time, so test first!');

    // ---- final checks ----
    const check1 = h('div', { class: 'mono' });
    const check2 = h('div', { class: 'mono' });
    const run1 = new Button({ label: 'Run 2 + 6', onClick: () => setInputs(2, 6, false) });
    const run2 = new Button({ label: 'Run 6 − 2', onClick: () => setInputs(6, 2, true) });
    const victory = h('div', { class: 'callout good', style: 'display:none' });
    const logEl = h('ol', { class: 'dp-log' });

    // ---- logic ----
    const key = (x: number, y: number, s: boolean) => `${x},${y},${s ? 1 : 0}`;
    const currentTests = (): AluTest[] =>
      order.map((k) => {
        const t = tests.get(k)!;
        const r = evalWiring(wiring, t.a, t.b, t.su);
        return { ...t, got: r.value, expected: r.expected, ok: r.ok };
      });

    function setInputs(x: number, y: number, s: boolean) {
      a = x & 0xff;
      b = y & 0xff;
      su = s;
      const k = key(a, b, su);
      if (!tests.has(k)) {
        tests.set(k, { a, b, su });
        order.push(k);
      }
      const r = evalWiring(wiring, a, b, su);
      log.push({ text: `${a} ${su ? '−' : '+'} ${b}: expected ${r.expected}, got ${r.value}${r.ok ? '' : ' ✗'}`, cls: r.ok ? 'good' : 'bad' });
      if (wrongWires(wiring).length === 0) {
        if (a === 2 && b === 6 && !su && r.ok) ran.add = true;
        if (a === 6 && b === 2 && su && r.ok) ran.sub = true;
      }
      render();
    }

    function inspect(side: Side, bit: number) {
      const id = wireId(side, bit);
      if (wireNotes.get(id) === 'fixed') return;
      inspections++;
      const src = wiring[side][bit];
      const target = side === 'a' ? `adder ${bit < 4 ? 'U21' : 'U20'} pin ${LS283_PINS.A[bit % 4]}` : `the XOR gate for B bit ${bit}`;
      if (isCorrect(src, bit)) {
        wireNotes.set(id, 'fine');
        setText(inspectOut, `${id} is fine: ${side.toUpperCase()} register bit ${bit} → ${target}. (checks so far: ${inspections})`);
        setClass(inspectOut, 'warn', false);
      } else {
        wiring = fixWire(wiring, side, bit);
        wireNotes.set(id, 'fixed');
        setText(inspectOut, `Found it: the jumper into ${target} came from ${describeSource(src)}. Re-seated so it now comes from ${side.toUpperCase()} register bit ${bit}. Your earlier tests have been re-run with the new wiring. (checks so far: ${inspections})`);
        setClass(inspectOut, 'warn', false);
        log.push({ text: `— re-seated ${id} —`, cls: '' });
      }
      render();
    }

    function newBoard() {
      faults = scenario === 'ben' ? BEN_FAULTS : randomFaults(Math.random, scenario === 'one' ? 1 : 2);
      wiring = applyFaults(faults);
      tests = new Map();
      order = [];
      inspections = 0;
      probes = 0;
      wireNotes = new Map();
      ran = { add: false, sub: false };
      log.length = 0;
      setText(inspectOut, 'When you know which jumpers are suspicious, click them to trace and re-seat them. Every check costs time, so test first!');
      setText(probeOut, 'Click a pin to measure it with the logic probe.');
      setInputs(0, scenario === 'ben' ? 8 : 0, false);
    }

    function render() {
      const r = evalWiring(wiring, a, b, su);
      aRow.set(a);
      bRow.set(b);
      suT.set(su);
      expRow.set(r.expected);
      gotRow.set(r.value);
      gotRow.clearMarks();
      for (let i = 0; i < 8; i++) gotRow.mark(i, 'bad', bitOf(r.value, i) !== bitOf(r.expected, i));
      setText(expText, `${a} ${su ? '−' : '+'} ${b} = ${r.expected}`);
      setText(gotText, `${r.value}${r.carry !== r.expectedCarry ? ` (carry ${r.carry}, should be ${r.expectedCarry})` : ''}`);
      setClass(verdict, 'warn', !r.ok);
      setClass(verdict, 'good', r.ok);
      setText(verdict, r.ok ? `PASS: the board shows ${r.value}.` : `FAIL: the board shows ${toBinSpaced(r.value, 8)} (${r.value}) instead of ${toBinSpaced(r.expected, 8)} (${r.expected}). Wrong bits are outlined.`);
      // matrix
      const tl = currentTests();
      const find = (x: number, y: number) => tl.find((t) => t.a === x && t.b === y && !t.su);
      bitsHdr.forEach((bit, k) => {
        for (const [cells, x, y] of [[cellsA, 1 << bit, 0], [cellsB, 0, 1 << bit]] as const) {
          const t = find(x, y);
          const cell = cells[k];
          setText(cell, t ? (t.ok ? '✓' : '✗') : '·');
          cell.title = t ? `${x} + ${y}: expected ${t.expected}, got ${t.got}` : `${x} + ${y}: not tested yet`;
          setClass(cell, 'ok', !!t?.ok);
          setClass(cell, 'bad', !!t && !t.ok);
          setClass(cell, 'cur', a === x && b === y && !su);
        }
      });
      const wrong = wrongWires(wiring);
      setText(hint, nextHint(tl, wrong.length === 0));
      // wires
      for (const [id, btn] of wireBtns) {
        const wn = wireNotes.get(id);
        setClass(btn, 'fixed', wn === 'fixed');
        setClass(btn, 'fine', wn === 'fine');
        btn.textContent = wn === 'fixed' ? `${id}✓` : id;
      }
      // final checks
      const c1 = evalWiring(wiring, 2, 6, false), c2 = evalWiring(wiring, 6, 2, true);
      setText(check1, `2 + 6 = ${c1.value} ${c1.ok ? '✓' : '✗ (should be 8)'}${ran.add ? ' · confirmed' : ''}`);
      setText(check2, `6 − 2 = ${c2.value} ${c2.ok ? '✓' : '✗ (should be 4)'}${ran.sub ? ' · confirmed' : ''}`);
      const won = wrong.length === 0 && ran.add && ran.sub;
      victory.style.display = won ? '' : 'none';
      if (won) {
        const minimum = new Set(faults.flatMap((f) => (f.kind === 'swap' ? f.bits.map((x) => wireId(f.side, x)) : [wireId(f.side, f.bit)]))).size;
        setText(victory, `Fixed! Both of Ben’s final checks pass. You checked ${inspections} jumper${inspections === 1 ? '' : 's'} (the minimum is ${minimum}) and used the logic probe ${probes} time${probes === 1 ? '' : 's'}. ${scenario === 'ben' ? 'In the video the culprits were the A3 jumper (one row off, it came from A register bit 2) and the swapped B2/B3 jumpers (Ben counts them as the 3rd and 4th bits).' : 'Try another random board!'}`);
      }
      logEl.replaceChildren(...log.slice(-12).reverse().map((e) => h('li', { class: e.cls }, e.text)));
    }

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'The ALU on the bench',
          { accent: 'red', subtitle: 'A and B come from the registers; Σ is the ALU’s LEDs' },
          row(scenarioSel, newBtn.el),
          aRow.el,
          bRow.el,
          suT.el,
          h('div', { class: 'tr-result' }, h('div', { class: 'lbl' }, 'should be: ', expText), expRow.el, h('div', { class: 'lbl' }, 'Σ LEDs on the board: ', gotText), gotRow.el),
          verdict,
        ),
        panel('Isolate the fault', { accent: 'yellow' }, hint, row(zeroAdd.el, zeroSub.el, symptom.el), h('div', { class: 'dp-scroll' }, matrix), note('Each square sets up one single-bit test (B = 0 and one A bit, or A = 0 and one B bit). ✓ = right answer, ✗ = wrong. Hover a square to see what came out.')),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Logic probe',
          { accent: 'blue', subtitle: 'measure what actually reaches the chips' },
          h('div', { class: 'small dim' }, 'Adder A inputs (74LS283):'),
          probeBtns('a'),
          h('div', { class: 'small dim' }, 'XOR inputs (74LS86, B side):'),
          probeBtns('b'),
          probeOut,
          note('Ben checks the register LEDs against what arrives at the adder: if a register bit is 1 but the adder pin reads 0 (or the other way round), the jumper between them is wrong.'),
        ),
        panel(
          'Trace and re-seat jumpers',
          { accent: 'orange' },
          h('div', { class: 'small dim' }, 'A register → adder:'),
          wireGrid('a'),
          h('div', { class: 'small dim' }, 'B register → XOR gates:'),
          wireGrid('b'),
          inspectOut,
        ),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Ben’s final checks', { accent: 'green' }, row(run1.el, run2.el), check1, check2, victory, note('Run both after fixing the wiring. 6 − 2 = 0000 0110 + 1111 1101 + 1 = 1 0000 0100: 4 with the carry out set (no borrow).')),
        panel('Test log', { accent: 'gray' }, logEl, note('A fault can hide behind a lucky test: with A = 0 a wrong A jumper is invisible, and a swap only shows when the two swapped bits differ. That’s why testing one bit at a time works so well.')),
      ),
    );
    newBoard();
    return d.dispose;
  },
});
