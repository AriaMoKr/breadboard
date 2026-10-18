import { mountComputerWorkbench } from '../../app/computer-page';
import { Machine } from '../../sim/machine';
import type { MicrocodeVersionId } from '../../sim/microcode';
import { Button, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, growOnly, h, s, setClass, setText } from '../../ui/dom';
import { onRisingEdge, scopedStyle } from '../control/_shared';
import { defineLab } from '../types';
import { INCREMENTER, multiplyNoBranchSource, multiplySource, tapeValue, tmFindRule, tmInit, tmStep, type TmRule, type TmState } from './_models';

const CSS = `
.tc-lab pre.pseudo { font-family: var(--mono); font-size: 0.85rem; line-height: 1.6; margin: 0; padding: 8px 10px; background: var(--panel-2); border-radius: 8px; white-space: pre-wrap; }
.tc-lab pre.pseudo .if { background: color-mix(in srgb, var(--accent-2) 25%, transparent); border-radius: 3px; }
.tc-lab .tape { display: flex; gap: 3px; flex-wrap: wrap; padding-top: 18px; }
.tc-lab .cell { position: relative; width: 30px; height: 34px; border: 1px solid var(--border); border-radius: 5px; display: grid; place-items: center; font-family: var(--mono); font-size: 1rem; background: var(--panel-2); }
.tc-lab .cell.head { border-color: var(--accent-2); box-shadow: 0 0 0 2px var(--accent-2); }
.tc-lab .cell.head::before { content: '▼'; position: absolute; top: -17px; color: var(--accent-2); font-size: 0.8rem; }
.tc-lab .cell.blank { color: var(--fg-faint); }
.tc-lab .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.tc-lab .seg button { font: inherit; font-size: 0.82rem; font-weight: 600; background: var(--panel-2); color: var(--fg-dim); border: 0; padding: 6px 10px; cursor: pointer; }
.tc-lab .seg button.active { background: var(--accent); color: #fff; }
.tc-lab .spark { width: 100%; height: auto; display: block; background: var(--panel-2); border-radius: 8px; }
.tc-lab .spark polyline { fill: none; stroke: var(--led-red); stroke-width: 2; }
.tc-lab .spark .lim { stroke: var(--fg-faint); stroke-dasharray: 4 4; }
.tc-lab .spark text { fill: var(--fg-dim); font-family: var(--mono); font-size: 10px; }
.tc-lab .big { font-family: var(--mono); font-size: 1.15rem; font-weight: 700; }
`;

type Mode = 'nojc' | 'oldjc' | 'jc';
const MODES: { id: Mode; label: string; version: MicrocodeVersionId }[] = [
  { id: 'nojc', label: 'No conditional jump (video 41)', version: 'more-instructions' },
  { id: 'oldjc', label: 'JC on the old microcode', version: 'more-instructions' },
  { id: 'jc', label: 'With JC (video 44)', version: 'flags' },
];

export default defineLab({
  id: 'turing-complete',
  title: 'Making a computer Turing complete',
  summary:
    'What makes a computer a computer? Ben compares it with a Turing machine: a tape, a head and a table of rules, where the rule to apply depends on the symbol just read. Our CPU can add, store and jump, but every instruction does the same thing whatever the data is. It cannot decide, so it cannot run a loop that stops when it is done. One small addition, a conditional jump, fixes that. Apart from its 16-byte memory, the computer is then Turing complete.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'tc-lab lab-stack' });
    d.add(scopedStyle(wrap, CSS));

    // ---- pseudocode ----
    const pseudo = h(
      'pre',
      { class: 'pseudo' },
      'product = 0\nloop:\n',
      h('span', { class: 'if' }, '    if x == 0: output product, halt   ← a decision'),
      '\n    x = x - 1\n    product = product + y\n    goto loop',
    );

    // ---- Turing machine ----
    let tm: TmState = tmInit('1011');
    let lastRule: TmRule | null = null;
    let tmRunning = false;
    const tapeEl = h('div', { class: 'tape', 'aria-label': 'Tape' });
    const tmState = h('div', { class: 'callout' });
    growOnly(tmState); // changes with every step of the machine, above the buttons
    const ruleRows = INCREMENTER.map((r) => ({
      r,
      tr: h('tr', null, h('td', null, r.state), h('td', null, r.read), h('td', null, r.write), h('td', null, r.move < 0 ? '← left' : r.move > 0 ? 'right →' : 'stay'), h('td', null, r.next)),
    }));
    const ruleTable = h('table', { class: 'truth-table' }, h('thead', null, h('tr', null, ['state', 'read', 'write', 'move', 'next state'].map((x) => h('th', null, x)))), h('tbody', null, ruleRows.map((x) => x.tr)));
    const inputSel = select(['1011', '111', '1001', '0', '10111'].map((v) => ({ value: v, label: v })), '1011', (v) => { tm = tmInit(v); lastRule = null; renderTm(); }, 'Start with');
    const stepB = new Button({ label: 'Step', kind: 'primary', onClick: () => { lastRule = tmStep(INCREMENTER, tm); renderTm(); } });
    const runB = new Button({ label: 'Run', labels: ['Run', 'Pause'], onClick: () => { tmRunning = !tmRunning; renderTm(); } });
    const resetB = new Button({ label: 'Reset', onClick: () => { tm = tmInit((inputSel.querySelector('select') as HTMLSelectElement).value); lastRule = null; tmRunning = false; renderTm(); } });
    const renderTm = () => {
      tapeEl.replaceChildren(...tm.tape.map((sym, i) => h('div', { class: `cell ${i === tm.head ? 'head' : ''} ${sym === '_' ? 'blank' : ''}` }, sym === '_' ? '·' : sym)));
      const next = tmFindRule(INCREMENTER, tm);
      ruleRows.forEach((x) => setClass(x.tr, 'current', tm.state !== 'halt' && x.r === next));
      runB.setLabel(tmRunning ? 'Pause' : 'Run');
      if (tm.state === 'halt') {
        tmRunning = false;
        runB.setLabel('Run');
        setText(tmState, `Halted after ${tm.steps} steps. The tape now reads ${tm.tape.join('').replace(/_/g, '')} = ${tapeValue(tm.tape)}: the machine added 1. It stopped because a rule said “halt” for this state and symbol.`);
      } else {
        const read = tm.tape[tm.head];
        setText(
          tmState,
          `State “${tm.state}”, the head reads “${read === '_' ? 'blank' : read}”. ${next ? `Rule: write ${next.write === '_' ? 'blank' : next.write}, move ${next.move < 0 ? 'left' : next.move > 0 ? 'right' : 'nowhere'}, go to “${next.next}”.` : ''} ${lastRule ? '' : 'The rule depends on what is read: that choice is the conditional branch our CPU is missing.'}`,
        );
      }
    };
    let tmAcc = 0;
    d.add(
      animate((dt) => {
        if (!tmRunning) return;
        tmAcc += dt;
        if (tmAcc > 450) {
          tmAcc = 0;
          lastRule = tmStep(INCREMENTER, tm);
          renderTm();
        }
      }),
    );
    renderTm();

    // ---- multiply on the breadboard computer ----
    const m = new Machine({ microcodeVersion: 'more-instructions' });
    let mode: Mode = 'nojc';
    let x = 3;
    let y = 5;
    let products: number[] = [];
    let iterations = 0;
    const source = () => (mode === 'nojc' ? multiplyNoBranchSource(x, y) : multiplySource(x, y));
    const wbHost = h('div');
    const wb = mountComputerWorkbench(wbHost, { machine: m, tabs: ['program', 'output'], program: source() });
    d.add(wb.dispose);
    const load = (autostart: boolean) => {
      const v = MODES.find((mm) => mm.id === mode)!.version;
      if (m.microcodeVersion !== v) m.setMicrocodeVersion(v);
      const src = source();
      const ta = wbHost.querySelector<HTMLTextAreaElement>('textarea.asm-source');
      if (ta) ta.value = src;
      m.loadSource(src);
      products = [];
      iterations = 0;
      if (autostart) m.start();
    };
    d.add(
      onRisingEdge(m.computer, (e) => {
        for (const t of e.transfers) {
          if (t.signal === 'RI' && e.pre.mar === 13) {
            products.push(t.value);
            iterations++;
            if (products.length > 120) products.shift();
          }
        }
      }),
    );
    const segBtns = MODES.map((mm) => ({ mm, b: h('button', { type: 'button', onClick: () => { mode = mm.id; load(true); } }, mm.label) }));
    const seg = h('div', { class: 'seg' }, segBtns.map((x2) => x2.b));
    const xSel = select(Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: String(i) })), String(x), (v) => { x = Number(v); load(true); }, 'x');
    const ySel = select(Array.from({ length: 21 }, (_, i) => ({ value: String(i), label: String(i) })), String(y), (v) => { y = Number(v); load(true); }, 'y');
    const speedBtns = [
      new Button({ label: '10 Hz', onClick: () => { m.setHz(10); m.start(); } }),
      new Button({ label: '300 Hz (Ben’s maximum)', onClick: () => { m.setHz(300); m.start(); } }),
      new Button({ label: 'Turbo', onClick: () => { m.setHz(20000); m.start(); } }),
    ];
    const reload = new Button({ label: 'Reload program', kind: 'primary', onClick: () => load(true) });
    const xOut = h('span', { class: 'big' });
    const pOut = h('span', { class: 'big' });
    const iOut = h('span', { class: 'big' });
    const spark = s('svg', { viewBox: '0 0 320 110', class: 'spark', role: 'img', 'aria-label': 'product after each pass through the loop' });
    const status = h('div', { class: 'callout' });
    growOnly(status); // follows the program as it runs
    let lastLen = -1;
    const renderSpark = () => {
      if (products.length === lastLen) return;
      lastLen = products.length;
      const n = Math.max(products.length, 2);
      const X = (i: number) => 30 + (i / (n - 1)) * 282;
      const Y = (v: number) => 95 - (v / 255) * 85;
      const pts = products.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      spark.replaceChildren(
        s('line', { x1: 30, y1: Y(255), x2: 312, y2: Y(255), class: 'lim' }),
        s('text', { x: 26, y: Y(255) + 3, 'text-anchor': 'end' }, '255'),
        s('text', { x: 26, y: Y(0) + 3, 'text-anchor': 'end' }, '0'),
        s('text', { x: 171, y: 108, 'text-anchor': 'middle' }, products.length ? `product after each pass (${iterations} passes)` : 'product after each pass'),
      );
      if (products.length > 1) spark.appendChild(s('polyline', { points: pts }));
    };
    const update = () => {
      const c = m.computer;
      segBtns.forEach((b) => setClass(b.b, 'active', b.mm.id === mode));
      setText(xOut, String(c.ram[14]));
      setText(pOut, String(c.ram[13]));
      setText(iOut, String(iterations));
      renderSpark();
      const halted = c.halted;
      let msg: string;
      if (mode === 'nojc') {
        msg =
          iterations === 0
            ? 'Without a conditional jump the best we can write is a loop that adds y and counts x down, with JMP back to the top. Press Run.'
            : `x has been counted down ${iterations} times and is now ${c.ram[14]}${iterations > x ? `: it went past 0 and wrapped to 255` : ''}. The product passed ${x * y} ${iterations >= x ? 'long ago' : 'soon'}, but nothing in the program can notice x reaching 0, so it never stops. The product keeps growing and wraps around at 256.`;
      } else if (mode === 'oldjc') {
        msg = halted
          ? `The display shows ${c.out}, not ${x * y}. On the video 41 microcode, opcode 0111 (JC) has no T2 step: it is just a NOP, so the program falls straight through to LDA product / OUT / HLT without looping even once.`
          : 'Ben’s real multiply program uses JC… but this microcode doesn’t know JC yet. Watch what happens.';
      } else {
        msg = halted
          ? `Halted with ${c.out} on the display: ${x} × ${y} = ${x * y}${x * y > 255 ? ' (mod 256)' : ''}. SUB one sets the carry flag unless x was already 0, so JC keeps looping exactly x times, then falls through to OUT and HLT. That one data-dependent decision is what makes the computer Turing complete.`
          : `Looping: x = ${c.ram[14]}, product = ${c.ram[13]}. Each pass does x − 1 and JC checks the carry: still set while x was not 0.`;
      }
      setText(status, msg);
    };
    d.add(m.onChange(update));
    m.setHz(10);
    load(false);

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('What is missing?', { accent: 'gray', subtitle: 'compute x × y' }, pseudo, note('Our instructions can load, add, subtract, store, output and jump. But JMP always jumps, so a program either never loops or loops forever. To run a loop that ends we need an instruction whose effect depends on the data: “jump if…”. That is a conditional branch.')),
        panel('A Turing machine', { accent: 'blue', subtitle: 'binary +1' }, tapeEl, row(inputSel, stepB.el, runB.el, resetB.el), h('div', { class: 'table-scroll' }, ruleTable), tmState),
      ),
      panel(
        'Multiply on the breadboard computer',
        { accent: 'red', subtitle: 'x × y by repeated addition' },
        seg,
        row(xSel, ySel, reload.el),
        row(...speedBtns.map((b) => b.el)),
        h('div', { class: 'kv' }, h('span', { class: 'dim' }, 'x (RAM 14)'), xOut, h('span', { class: 'dim' }, 'product (RAM 13)'), pOut, h('span', { class: 'dim' }, 'passes'), iOut),
        spark,
        status,
        note('Ben estimates his computer runs at most about 300 Hz with the parts on his breadboards; the simulator can go much faster.'),
      ),
      wbHost,
    );
    root.appendChild(wrap);
    update();
    return d.dispose;
  },
});
