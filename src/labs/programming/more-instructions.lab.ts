import { mountComputerWorkbench } from '../../app/computer-page';
import { Machine } from '../../sim/machine';
import { INSTRUCTION_BY_MNEMONIC, microIndex } from '../../sim/microcode';
import { formatControlWord } from '../../sim/signals';
import { DipSwitch, LedBar, note, panel, row, select } from '../../ui/components';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { MicrocodePanel } from '../../ui/microcode-panel';
import { describeTransfer } from '../control/_models';
import { MicrostepTrace, onRisingEdge, scopedStyle } from '../control/_shared';
import { defineLab } from '../types';

const CSS = `
.mi-lab .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.mi-lab .seg button { font: inherit; font-weight: 600; background: var(--panel-2); color: var(--fg-dim); border: 0; padding: 6px 16px; cursor: pointer; }
.mi-lab .seg button.active { background: color-mix(in srgb, var(--accent) 73%, black); color: #fff; }
.mi-lab table.microcode tr.new-instr th { color: var(--accent-2); font-weight: 700; }
.mi-lab table.microcode tr.focus td:not(.fetch) { box-shadow: inset 0 0 0 2px var(--accent-2); }
.mi-lab .steps td, .mi-lab .steps th { text-align: left; }
.mi-lab .pc-line { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-family: var(--mono); font-size: 0.85rem; }
.mi-lab .pc-line span.box { border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; }
.mi-lab .pc-line span.box.over { text-decoration: line-through; color: var(--fg-faint); }
.mi-lab .pc-line span.box.final { border-color: var(--led-green); box-shadow: inset 0 0 0 1px var(--led-green); }
.mi-lab .loopclocks { font-family: var(--mono); font-size: 1.4rem; font-weight: 700; }
`;

type NewInstr = 'STA' | 'LDI' | 'JMP';

const TEXT: Record<NewInstr, { summary: string; steps: Record<number, string> }> = {
  STA: {
    summary: 'STA addr (0100): store the A register into RAM. The opposite of LDA.',
    steps: {
      2: 'The operand (the address) goes from the IR into the MAR, like LDA.',
      3: 'A drives the bus and RI writes it into RAM. The write happens during the short (≈10 µs) pulse the RC edge detector makes after the rising edge, so it only works in run mode.',
    },
  },
  LDI: {
    summary: 'LDI n (0101): load the 4-bit number in the instruction itself straight into A, no RAM access needed.',
    steps: {
      2: 'IO puts the low 4 bits of the IR on the bus and AI loads them into A. The IR’s 74LS245 drives bits 7–4 low (its inputs are tied to GND), so A gets 0000 nnnn: LDI can only load 0 to 15.',
    },
  },
  JMP: {
    summary: 'JMP addr (0110): continue the program at another address by loading the program counter.',
    steps: {
      2: 'IO puts the target address on the bus and J loads it into the 74LS161 (its parallel-load input). The PC was already incremented in T1, so the load simply overrides that.',
    },
  },
};

export default defineLab({
  id: 'more-instructions',
  title: 'More instructions: STA, LDI, JMP',
  summary:
    'Three new instructions without any new hardware: just new rows in the microcode. STA stores A into RAM, LDI loads a small constant into A, and JMP changes the program counter, so programs can finally loop. Ben’s first program with them counts in multiples of 3 forever: one trip round the loop is three instructions, 15 clock cycles.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'mi-lab lab-stack' });
    d.add(scopedStyle(wrap, CSS));
    const m = new Machine({ microcodeVersion: 'more-instructions' });
    m.setHz(10);

    // ---- microcode table with the new rows highlighted ----
    const mp = new MicrocodePanel(m);
    d.add(() => mp.dispose());
    const ucRows = new Map<string, HTMLElement>();
    mp.el.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
      const mn = tr.querySelectorAll('th')[1]?.textContent ?? '';
      ucRows.set(mn, tr);
      if (mn === 'STA' || mn === 'LDI' || mn === 'JMP') tr.classList.add('new-instr');
    });

    // ---- explainer ----
    let cur: NewInstr = 'LDI';
    const segBtns = (['STA', 'LDI', 'JMP'] as NewInstr[]).map((k) => {
      const b = h('button', { type: 'button', onClick: () => choose(k) }, k);
      return { k, b };
    });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Instruction' }, segBtns.map((x) => x.b));
    const summary = h('p', { class: 'note' });
    const stepsBody = h('tbody');
    const extra = h('div', { class: 'lab-stack', style: 'gap:8px' });

    // LDI visual: IR and bus bits
    const imm = new DipSwitch({ bits: 4, value: 0b0011, label: 'n', onChange: () => updLdi() });
    const irBar = new LedBar({ bits: 8, color: ['blue', 'blue', 'blue', 'blue', 'yellow', 'yellow', 'yellow', 'yellow'], label: 'IR', formats: ['bin'] });
    const busBar = new LedBar({ bits: 8, color: 'red', label: 'bus (T2)', formats: ['dec'] });
    const ldiText = h('div', { class: 'small' });
    const updLdi = () => {
      const n = imm.value & 15;
      irBar.set(0x50 | n);
      busBar.set(n);
      setText(ldiText, `LDI ${n} = 0101 ${n.toString(2).padStart(4, '0')}. In T2 the bus carries 0000 ${n.toString(2).padStart(4, '0')} = ${n}, and A loads it. LDI 15 is the biggest constant; for anything larger, put the number in RAM and use LDA.`);
    };
    updLdi();
    // JMP visual: the PC through the three steps
    let jmpAt = 5;
    let jmpTo = 3;
    const pcLine = h('div', { class: 'pc-line' });
    const updJmp = () => {
      pcLine.replaceChildren(
        h('span', { class: 'box' }, `T0  PC = ${jmpAt}`),
        '→',
        h('span', { class: 'box over' }, `T1  CE: PC = ${(jmpAt + 1) & 15}`),
        '→',
        h('span', { class: 'box final' }, `T2  IO|J: PC = ${jmpTo}`),
      );
    };
    const jmpAtSel = select(Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: String(i) })), String(jmpAt), (v) => { jmpAt = Number(v); updJmp(); }, 'JMP at address');
    const jmpToSel = select(Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: String(i) })), String(jmpTo), (v) => { jmpTo = Number(v); updJmp(); }, 'target');
    updJmp();
    // STA visual
    const staText = h('div', { class: 'small' }, 'In the multiples-of-3 program, LDI 3 then STA 15 puts the constant 3 into RAM[15], where ADD 15 can find it. That is how Ben gets a constant into memory without the DIP switches.');

    const choose = (k: NewInstr) => {
      cur = k;
      segBtns.forEach((x) => {
        setClass(x.b, 'active', x.k === k);
        x.b.setAttribute('aria-pressed', String(x.k === k));
      });
      const op = INSTRUCTION_BY_MNEMONIC.get(k)!.opcode;
      setText(summary, TEXT[k].summary);
      stepsBody.replaceChildren(
        ...[0, 1, 2, 3, 4].map((s) => {
          const w = m.computer.microcode[microIndex(0, op, s)];
          const why = s === 0 ? 'Fetch: PC → MAR.' : s === 1 ? 'Fetch: RAM → IR, PC + 1.' : (TEXT[k].steps[s] ?? 'Nothing: an empty step (the counter still runs to T4).');
          return h('tr', null, h('th', { class: 'mono' }, `T${s}`), h('td', { class: 'mono' }, formatControlWord(w)), h('td', null, h('div', { class: 'mono small dim' }, describeTransfer(w)), why));
        }),
      );
      extra.replaceChildren(...(k === 'LDI' ? [row(imm.el), irBar.el, busBar.el, ldiText] : k === 'JMP' ? [row(jmpAtSel, jmpToSel), pcLine] : [staText]));
      ucRows.forEach((tr, mn) => setClass(tr, 'focus', mn === k));
    };

    // ---- 15-clock loop ----
    const loopClocks = h('span', { class: 'loopclocks' }, '–');
    const loopInfo = h('div', { class: 'callout' });
    let lastOutEdge = -1;
    let gap = 0;
    let loops = 0;
    d.add(
      onRisingEdge(m.computer, (e) => {
        if (e.transfers.some((t) => t.signal === 'OI')) {
          if (lastOutEdge >= 0) {
            gap = e.edge - lastOutEdge;
            loops++;
          }
          lastOutEdge = e.edge;
        }
      }),
    );
    const resetLoop = () => {
      lastOutEdge = -1;
      gap = 0;
      loops = 0;
    };
    let trace: MicrostepTrace | null = null;
    const origReset = m.reset.bind(m);
    m.reset = () => {
      origReset();
      resetLoop();
      trace?.clear();
    };
    d.add(() => (m.reset = origReset));
    const updLoop = () => {
      const c = m.computer;
      setText(loopClocks, gap ? String(gap) : '–');
      const sinceOut = lastOutEdge >= 0 ? c.risingEdges - lastOutEdge : null;
      setText(
        loopInfo,
        gap
          ? `Each pass through the loop (ADD 15, OUT, JMP 3) is 3 instructions × 5 steps = ${gap} clock cycles between outputs. Output now ${c.out}, ${loops} loops so far${sinceOut !== null ? `, ${sinceOut} clocks since the last OUT` : ''}. It never stops: after 255 the sum wraps around (255 + 3 = 2).`
          : 'Run the program (or pulse the clock). First LDI 3 / STA 15 puts 3 into RAM[15], LDI 0 clears A, then the loop starts at address 3.',
      );
    };
    d.add(m.onChange(updLoop));

    const wbHost = h('div');
    const wb = mountComputerWorkbench(wbHost, { machine: m, tabs: ['program', 'output'], program: 'count-by-3' });
    d.add(wb.dispose);
    const tr = new MicrostepTrace(m, { max: 30, title: 'Micro-step trace' });
    trace = tr;
    d.add(() => tr.dispose());

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'The new instructions',
          { accent: 'blue', subtitle: 'microcode only, no new hardware' },
          seg,
          summary,
          h('div', { class: 'table-scroll' }, h('table', { class: 'truth-table steps' }, h('thead', null, h('tr', null, ['step', 'control word', 'what happens'].map((x) => h('th', null, x)))), stepsBody)),
          extra,
        ),
        panel('Microcode', { accent: 'blue', subtitle: 'new rows in orange' }, mp.el, note('The current micro-step is blue while the program runs. STA, LDI and JMP each take 5 clocks like every other instruction, even though LDI and JMP only need T2.')),
      ),
      panel('Multiples of 3', { accent: 'red', subtitle: 'clock cycles per loop' }, row(loopClocks, h('span', { class: 'dim' }, 'clocks between outputs')), loopInfo),
      wbHost,
      tr.el,
    );
    root.appendChild(wrap);
    choose(cur);
    m.changed();
    return d.dispose;
  },
});
