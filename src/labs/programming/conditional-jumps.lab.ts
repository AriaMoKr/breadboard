import { mountComputerWorkbench } from '../../app/computer-page';
import { Machine } from '../../sim/machine';
import { INSTRUCTION_BY_OPCODE, microcodeEepromImage, microIndex, type Microcode } from '../../sim/microcode';
import { PROGRAM_BY_ID } from '../../sim/programs';
import { SIGNALS, formatControlWord } from '../../sim/signals';
import { Button, Slider, note, panel } from '../../ui/components';
import { Disposer, h, s, setClass, setText } from '../../ui/dom';
import { onRisingEdge, scopedStyle } from '../control/_shared';
import { defineLab } from '../types';
import { decodeEepromAddress, FLAG_COMBO_NAMES, minusOne, multiplySource, quadrantDiffs } from './_models';

const CSS = `
.cj-lab .quads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.cj-lab .quad { border: 1px solid var(--border); border-radius: 8px; padding: 6px; background: var(--panel-2); }
.cj-lab .quad.active { border-color: var(--accent-2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-2) 45%, transparent); }
.cj-lab .quad h3 { margin: 0 0 4px; font-weight: 600; font-family: var(--mono); font-size: 0.74rem; display: flex; justify-content: space-between; gap: 4px; flex-wrap: wrap; }
.cj-lab .quad svg { width: 100%; height: auto; display: block; }
.cj-lab .quad rect { cursor: pointer; }
@media (pointer: coarse) and (max-width: 600px) { .cj-lab .quads { grid-template-columns: minmax(0, 1fr); } } /* bigger cells for fingertips */
.cj-lab .quad rect.z { fill: var(--panel); }
.cj-lab .quad rect.nz { fill: color-mix(in srgb, var(--led-blue) 55%, var(--panel)); }
.cj-lab .quad rect.diff { stroke: var(--accent-2); stroke-width: 1.6; }
.cj-lab .quad rect.cur { fill: var(--led-red); }
.cj-lab .quad rect.sel { stroke: var(--fg); stroke-width: 1.6; }
.cj-lab table td.curcol, .cj-lab table th.curcol { background: color-mix(in srgb, var(--accent-2) 20%, transparent); color: var(--fg); }
.cj-lab pre.sum { font-family: var(--mono); font-size: 0.82rem; margin: 0; padding: 6px 10px; background: var(--panel-2); border-radius: 8px; white-space: pre; overflow-x: auto; max-width: 100%; }
.cj-lab .progs { display: flex; flex-wrap: wrap; gap: 6px; }
`;

const PROGRAMS_HERE = [
  { id: 'count-by-10', label: 'Count by tens', hz: 60, src: () => PROGRAM_BY_ID.get('count-by-10')!.source },
  { id: 'up-down', label: 'Count up & down', hz: 1000, src: () => PROGRAM_BY_ID.get('up-down')!.source },
  { id: 'mul35', label: 'Multiply 3 × 5', hz: 50, src: () => multiplySource(3, 5) },
  { id: 'mul78', label: 'Multiply 7 × 8', hz: 100, src: () => multiplySource(7, 8) },
];

export default defineLab({
  id: 'conditional-jumps',
  title: 'Conditional jumps',
  summary:
    'With the flags on EEPROM address lines A8 (carry) and A9 (zero), Ben burns four copies of the microcode, one for each combination of the flags. They are identical except for T2 of JC (0111) and JZ (1000): IO|J in the copies where the flag is set, nothing in the others. So a conditional jump is just a lookup in a different quarter of the EEPROM. He tests it by counting in tens, by counting up and down, and with a multiply program: 3 × 5 = 15 and 7 × 8 = 56.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'cj-lab lab-stack' });
    d.add(scopedStyle(wrap, CSS));
    const m = new Machine({ microcodeVersion: 'flags' });
    m.setHz(60);

    // ---- four quadrants ----
    let img = microcodeEepromImage(m.computer.microcode);
    let lastMc: Microcode = m.computer.microcode;
    const diffs = new Set(quadrantDiffs(img));
    const CELL = 10;
    const quads = [0, 1, 2, 3].map((q) => {
      const rects: SVGRectElement[] = [];
      const svg = s('svg', { viewBox: `0 0 ${16 * CELL} ${16 * CELL + 6}`, role: 'img', 'aria-label': `${FLAG_COMBO_NAMES[q]} quarter of the EEPROM` });
      for (let a = 0; a < 256; a++) {
        const r = s('rect', { x: (a & 15) * CELL + 0.5, y: (a >> 4) * CELL + (a >= 128 ? 6 : 0) + 0.5, width: CELL - 1, height: CELL - 1, rx: 1.5 });
        r.addEventListener('click', () => select(q * 256 + a));
        rects.push(r);
        svg.appendChild(r);
      }
      const el = h('div', { class: 'quad' }, h('h3', null, h('span', null, FLAG_COMBO_NAMES[q]), h('span', { class: 'dim' }, `0x${(q * 256).toString(16).padStart(3, '0')}–0x${(q * 256 + 255).toString(16).padStart(3, '0')}`)), svg);
      return { el, rects };
    });
    let selected = -1;
    const cellInfo = h('div', { class: 'small mono' }, 'Click a cell to decode it. Orange outlines: the only bytes that differ between the four copies.');
    const select = (addr: number) => {
      selected = addr;
      renderQuads();
    };
    const renderQuads = () => {
      const c = m.computer;
      if (c.microcode !== lastMc) {
        lastMc = c.microcode;
        img = microcodeEepromImage(c.microcode);
      }
      const base = (c.opcode << 3) | c.step;
      quads.forEach((qd, q) => {
        setClass(qd.el, 'active', q === c.flags);
        qd.rects.forEach((r, a) => {
          const v = img[q * 256 + a];
          setClass(r, 'z', v === 0);
          setClass(r, 'nz', v !== 0);
          setClass(r, 'diff', diffs.has(a));
          setClass(r, 'cur', q === c.flags && (a === base || a === (base | 0x80)));
          setClass(r, 'sel', q * 256 + a === selected);
        });
      });
      if (selected >= 0) {
        const ad = decodeEepromAddress(selected);
        const v = img[selected];
        const sigs = (ad.byteSel ? SIGNALS.slice(8) : SIGNALS.slice(0, 8)).filter((_, i) => v & (0x80 >> i));
        setText(
          cellInfo,
          `0x${selected.toString(16).padStart(3, '0')}: ${FLAG_COMBO_NAMES[ad.flags]} (Z=${ad.zf}, C=${ad.cf}), ${ad.byteSel ? 'low byte (right chip)' : 'high byte (left chip)'}, opcode ${ad.opcode.toString(2).padStart(4, '0')} ${INSTRUCTION_BY_OPCODE.get(ad.opcode)?.mnemonic ?? ''}, T${ad.step} → 0x${v.toString(16).padStart(2, '0')} ${sigs.join(' ') || '—'}`,
        );
      }
    };

    // ---- JC / JZ T2 across the copies ----
    const jTable = h('table', { class: 'truth-table' });
    const renderJTable = () => {
      const c = m.computer;
      const head = h('tr', null, h('th', null, 'T2 of'), ...FLAG_COMBO_NAMES.map((n, q) => h('th', { class: q === c.flags ? 'curcol' : '' }, n.replace('FLAGS_', ''))));
      const rowsJ = [0b0111, 0b1000].map((op) =>
        h('tr', null, h('td', null, `${INSTRUCTION_BY_OPCODE.get(op)!.mnemonic} ${op.toString(2).padStart(4, '0')}`), ...[0, 1, 2, 3].map((q) => h('td', { class: q === c.flags ? 'curcol' : '' }, formatControlWord(c.microcode[microIndex(q, op, 2)])))),
      );
      jTable.replaceChildren(h('thead', null, head), h('tbody', null, rowsJ));
    };

    // ---- carry semantics of x − 1 ----
    const xSlider = new Slider({ label: 'x', min: 0, max: 255, step: 1, value: 3, format: (v) => String(v), onInput: () => renderSub() });
    const sumPre = h('pre', { class: 'sum' });
    const subNote = h('div', { class: 'small' });
    const loopTable = h(
      'table',
      { class: 'truth-table' },
      h('thead', null, h('tr', null, ['x', 'x − 1', 'carry', 'JC 6'].map((t) => h('th', null, t)))),
      h(
        'tbody',
        null,
        [3, 2, 1, 0].map((x) => {
          const r = minusOne(x);
          return h('tr', { class: x === 0 ? 'current' : '' }, h('td', null, String(x)), h('td', null, String(r.value)), h('td', null, String(r.carry)), h('td', null, r.carry ? 'jump: loop again' : 'no jump: output, halt'));
        }),
      ),
    );
    const renderSub = () => {
      const x = Math.round(xSlider.value);
      const r = minusOne(x);
      const b8 = (v: number) => v.toString(2).padStart(8, '0');
      setText(sumPre, `    x  =   ${b8(x)}   (${x})\n NOT 1 =   ${b8(0xfe)}   (SU inverts B = 1)\n  + 1  =          1   (SU is also the carry-in)\n ─────────────────────\n         ${r.carry} ${b8(r.value)}   = ${r.value}, carry ${r.carry}`);
      setText(subNote, r.carry ? `${x} − 1 = ${r.value} with carry 1. For subtraction, carry 1 means “no borrow”: x was at least 1.` : '0 − 1 = 255 with carry 0: the only x that does not carry. That is how the multiply loop knows x has run out.');
    };
    renderSub();

    // ---- live jump log ----
    const live = h('div', { class: 'callout' }, 'Pick a program. The orange quarter of the EEPROM is the one the computer is reading right now.');
    let lastMsg = '';
    let jumps = 0;
    let skips = 0;
    d.add(
      onRisingEdge(m.computer, (e) => {
        const op = e.pre.ir >> 4;
        if (e.pre.step === 2 && (op === 0b0111 || op === 0b1000)) {
          const taken = e.transfers.some((t) => t.signal === 'J');
          const flagName = op === 0b0111 ? 'carry' : 'zero';
          const flagVal = op === 0b0111 ? e.pre.flags & 1 : e.pre.flags >> 1;
          if (taken) jumps++; else skips++;
          lastMsg = `${op === 0b0111 ? 'JC' : 'JZ'} ${e.pre.ir & 15} at address ${(e.pre.pc - 1) & 15}: ${flagName} flag = ${flagVal}, so the EEPROM copy ${FLAG_COMBO_NAMES[e.pre.flags]} has ${taken ? 'IO|J in T2 → jump taken' : 'nothing in T2 → falls through'}.`;
        } else if (e.transfers.some((t) => t.signal === 'FI')) {
          const fl = e.transfers.find((t) => t.signal === 'FI')!.value;
          if (fl & 1 && !(e.pre.flags & 1)) lastMsg = `${e.pre.word & 0x40 ? 'SUB' : 'ADD'} set the carry flag (result ${e.transfers.find((t) => t.signal === 'AI')?.value ?? '?'}): from now on the control logic reads the ${FLAG_COMBO_NAMES[fl]} quarter.`;
        }
      }),
    );
    const renderLive = () => {
      const c = m.computer;
      setText(
        live,
        `${c.halted ? `Halted. Output: ${c.out}. ` : ''}Flags: C = ${c.flagC}, Z = ${c.flagZ} → EEPROM A9 A8 = ${c.flagZ}${c.flagC} → ${FLAG_COMBO_NAMES[c.flags]}. ${lastMsg}${jumps + skips ? ` (conditional jumps taken ${jumps}, not taken ${skips})` : ''}`,
      );
    };

    // ---- programs ----
    const wbHost = h('div');
    const wb = mountComputerWorkbench(wbHost, { machine: m, tabs: ['program', 'microcode', 'output'], program: 'count-by-10' });
    d.add(wb.dispose);
    const load = (p: (typeof PROGRAMS_HERE)[number]) => {
      const src = p.src();
      const ta = wbHost.querySelector<HTMLTextAreaElement>('textarea.asm-source');
      if (ta) ta.value = src;
      m.loadSource(src);
      lastMsg = '';
      jumps = skips = 0;
      m.setHz(p.hz);
      m.start();
    };
    const progBtns = PROGRAMS_HERE.map((p) => new Button({ label: p.label, onClick: () => load(p) }));

    d.add(
      m.onChange(() => {
        renderQuads();
        renderJTable();
        renderLive();
      }),
    );

    wrap.append(
      panel('Programs from the video', { accent: 'red' }, h('div', { class: 'progs' }, progBtns.map((b) => b.el)), live),
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'The EEPROM: four copies of the microcode',
          { accent: 'blue', subtitle: 'A9 A8 = Z C pick the quarter' },
          h('div', { class: 'quads' }, quads.map((q) => q.el)),
          cellInfo,
          note('Each square is one byte. In each quarter the top 8 rows are high bytes (left chip, A7 = 0) and the bottom 8 rows low bytes (right chip, A7 = 1); every row holds 2 opcodes × 8 steps. Red: the two bytes being read right now.'),
        ),
        panel(
          'The only difference: T2 of JC and JZ',
          { accent: 'blue' },
          h('div', { class: 'table-scroll' }, jTable),
          note('Ben’s initUCode() copies UCODE_TEMPLATE four times, then patches ucode[FLAGS_Z0C1][JC][2] = IO|J, ucode[FLAGS_Z1C0][JZ][2] = IO|J and both in FLAGS_Z1C1. A jump that is not taken is just a 5-cycle NOP. The highlighted column is the current flags.'),
        ),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Carry after subtraction', { accent: 'green', subtitle: 'why JC ends the multiply loop' }, xSlider.el, sumPre, subNote, loopTable, note('The multiply program does LDA x, SUB one, JC cont. Subtracting 1 sets carry for every x except 0, so the loop body runs exactly x times. Ben mentions this is a bit like the x86 CMP trick: subtract and look at the flags.')),
        panel(
          'What to watch',
          { accent: 'gray' },
          h(
            'ul',
            { class: 'note', style: 'padding-left:18px;margin:0' },
            h('li', null, 'Count by tens: 10, 20 … 250, then 4 (260 − 256) with the carry LED on; the program keeps running in the C = 1 quarter until the next ADD clears it.'),
            h('li', null, 'Count up & down: …254, 255, 255, 254… and …1, 0, 0, 1…: the turnarounds show each value twice, because the OUT after the jump repeats it.'),
            h('li', null, 'Multiply: no output until the end, then 15 (or 56) and HLT. Afterwards RAM[14] (x) is 0 and RAM[13] holds the product: reset the product to 0 before running it again.'),
          ),
        ),
      ),
      wbHost,
    );
    root.appendChild(wrap);
    m.changed();
    return d.dispose;
  },
});
