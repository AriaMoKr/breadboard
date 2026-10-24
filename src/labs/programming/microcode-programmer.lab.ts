import { mountComputerWorkbench } from '../../app/computer-page';
import { disassemble } from '../../sim/assembler';
import { Machine } from '../../sim/machine';
import { buildMicrocodeVersion, INSTRUCTION_BY_OPCODE, microcodeEepromImage, MICROCODE_VERSIONS, type Microcode } from '../../sim/microcode';
import { CE, SIGNALS, formatControlWord } from '../../sim/signals';
import { Button, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { MicrocodePanel } from '../../ui/microcode-panel';
import { scopedStyle } from '../control/_shared';
import { defineLab } from '../types';
import { arduinoSketch, decodeEepromAddress, diffBytes, PROGRAMMING_LOOP } from './_models';

const CSS = `
.mp-lab .hexdump { font-family: var(--mono); font-size: 0.72rem; line-height: 1.5; white-space: pre; margin: 0; }
.mp-lab .hexdump .b { border-radius: 3px; cursor: pointer; }
.mp-lab .hexdump .b.nz { color: var(--fg); }
.mp-lab .hexdump .b.z { color: var(--fg-faint); }
.mp-lab .hexdump .b.edited { outline: 1px solid var(--accent-2); }
.mp-lab .hexdump .b.cur { background: var(--led-blue); color: var(--on-blue); }
.mp-lab .hexdump .b.flash { animation: mplab-flash 2.4s ease-out; }
.reduce-motion .mp-lab .hexdump .b.flash { animation: none; } /* less motion: no flash; .edited still marks the byte */
.mp-lab .hexdump .b.sel { outline: 2px solid var(--accent); }
@keyframes mplab-flash { 0%, 40% { background: var(--accent-2); color: #000; } 100% { background: transparent; } }
.mp-lab .hexdump .addr { color: var(--fg-dim); }
.mp-lab .hexdump .half { color: var(--fg-faint); }
.mp-lab .addr-bits { display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 3px; font-family: var(--mono); font-size: 0.68rem; text-align: center; }
.mp-lab .addr-bits div { border: 1px solid var(--border); border-radius: 4px; padding: 2px 0; }
.mp-lab .addr-bits .v1 { background: color-mix(in srgb, var(--wire-1) 25%, transparent); }
.mp-lab .addr-groups { display: grid; grid-template-columns: 3fr 1fr 4fr 3fr; gap: 3px; font-size: 0.68rem; color: var(--fg-dim); text-align: center; }
.mp-lab .addr-groups div { border-top: 2px solid var(--border); padding-top: 2px; }
.mp-lab pre.sketch { font-family: var(--mono); font-size: 0.7rem; line-height: 1.45; margin: 0; white-space: pre; }
.mp-lab pre.sketch .chg { background: color-mix(in srgb, var(--accent-2) 22%, transparent); display: inline-block; min-width: 100%; }
.mp-lab pre.sketch .cmt { color: var(--fg-faint); }
`;

export default defineLab({
  id: 'microcode-programmer',
  title: 'Reprogramming the microcode',
  summary:
    'Ben rewrites the microcode programmer so it reads like a table: each control signal is a #define bit mask and each instruction is a row of 8 control words. The sketch writes the high byte of every word into the first 128 bytes of the EEPROM and the low byte into the next 128 (A7 selects the byte), so both chips get the same image. He adds SUB and tests it with 5 + 6 − 7. Edit the table below and watch the EEPROM image and the sketch change.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'mp-lab lab-stack' });
    d.add(scopedStyle(wrap, CSS));

    const m = new Machine({ microcodeVersion: 'arduino' });
    m.setHz(10);
    const original = microcodeEepromImage(buildMicrocodeVersion('arduino'));
    const originalSketch = arduinoSketch(MICROCODE_VERSIONS.arduino.template).split('\n');

    // ---- editable microcode table ----
    const mp = new MicrocodePanel(m, { editable: true });
    d.add(() => mp.dispose());
    const expNote = h('div', { class: 'callout' });
    let ceRemoved = false;
    const setCE = (on: boolean) => {
      for (let op = 0; op < 16; op++) m.template[op][1] = on ? m.template[op][1] | CE : m.template[op][1] & ~CE;
      ceRemoved = !on;
      m.rebuildMicrocode();
      m.reset();
      if (!on) m.start();
    };
    const ceBtn = new Button({ label: 'Experiment: remove CE from T1', kind: 'danger', onClick: () => setCE(ceRemoved) });
    const restoreBtn = new Button({ label: 'Restore Ben’s microcode', onClick: () => { ceRemoved = false; m.setMicrocodeVersion('arduino'); m.reset(); } });

    // ---- EEPROM image ----
    let full = false;
    const dump = h('pre', { class: 'hexdump' });
    const byteInfo = h('div', { class: 'small mono dim' }, 'Click a byte to decode its address.');
    let spans: HTMLSpanElement[] = [];
    let selected = -1;
    const buildDump = () => {
      const len = full ? 2048 : 256;
      spans = [];
      const frag: (Node | string)[] = [];
      for (let base = 0; base < len; base += 16) {
        if (base % 256 === 0 && full) frag.push(h('span', { class: 'half' }, `; ${base < 1024 ? `flags copy ${base >> 8} (A9 A8 = ${(base >> 8).toString(2).padStart(2, '0')})` : 'A10 = 1: unused'}\n`));
        if (base % 256 === 0 || base % 256 === 128) frag.push(h('span', { class: 'half' }, base % 256 === 0 ? '; A7 = 0: high byte (HLT…AO), the left chip\n' : '; A7 = 1: low byte (EO…J), the right chip\n'));
        frag.push(h('span', { class: 'addr' }, `${base.toString(16).padStart(3, '0')}:  `));
        for (let i = 0; i < 16; i++) {
          const a = base + i;
          const sp = h('span', { class: 'b', dataset: { a: String(a) } }, '00');
          spans[a] = sp;
          frag.push(sp, i === 7 ? '   ' : i < 15 ? ' ' : '\n');
        }
      }
      dump.replaceChildren(...frag);
      lastImg = null;
      renderDump();
    };
    dump.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.b');
      if (!t) return;
      selected = Number(t.dataset.a);
      renderDump();
    });
    let lastImg: Uint8Array | null = null;
    let lastEdit: number[] = [];
    let lastMc: Microcode | null = null;
    const renderDump = () => {
      const img = microcodeEepromImage(m.computer.microcode);
      const changed = lastImg ? diffBytes(lastImg, img) : [];
      const c = m.computer;
      const cur = new Set([(c.opcode << 3) | c.step, 0x80 | (c.opcode << 3) | c.step]);
      for (let a = 0; a < spans.length; a++) {
        const sp = spans[a];
        if (!sp) continue;
        const v = img[a];
        setText(sp, v.toString(16).padStart(2, '0'));
        setClass(sp, 'nz', v !== 0);
        setClass(sp, 'z', v === 0);
        setClass(sp, 'edited', v !== original[a]);
        setClass(sp, 'cur', cur.has(a));
        setClass(sp, 'sel', a === selected);
      }
      for (const a of changed) {
        const sp = spans[a];
        if (!sp) continue;
        sp.classList.remove('flash');
        void sp.offsetWidth;
        sp.classList.add('flash');
      }
      lastImg = img;
      if (selected >= 0) {
        const ad = decodeEepromAddress(selected);
        const instr = INSTRUCTION_BY_OPCODE.get(ad.opcode)?.mnemonic ?? 'unused';
        const sigs = (ad.byteSel ? SIGNALS.slice(8) : SIGNALS.slice(0, 8)).filter((_, i) => img[selected] & (0x80 >> i));
        setText(
          byteInfo,
          `0x${selected.toString(16).padStart(3, '0')} = ${selected.toString(2).padStart(11, '0')}: ${selected >= 1024 ? 'A10 = 1 (not used)' : `flags ${ad.zf}${ad.cf}, ${ad.byteSel ? 'low' : 'high'} byte, opcode ${ad.opcode.toString(2).padStart(4, '0')} (${instr}), step T${ad.step}`} → 0x${img[selected].toString(16).padStart(2, '0')} = ${sigs.join(' ') || '—'}`,
        );
      }
      return changed;
    };
    const fullT = new Toggle({ label: 'Show the whole 2 KB', onChange: (v) => { full = v; buildDump(); } });

    // ---- address layout ----
    const bitCells = Array.from({ length: 11 }, (_, i) => h('div', { title: `A${10 - i}` }, '0'));
    const addrBits = h('div', { class: 'addr-bits' }, bitCells);
    const addrHead = h('div', { class: 'addr-bits' }, Array.from({ length: 11 }, (_, i) => h('div', { class: 'dim', style: 'border:0' }, `A${10 - i}`)));
    const addrGroups = h('div', { class: 'addr-groups' }, h('div', null, 'GND'), h('div', null, 'byte'), h('div', null, 'opcode'), h('div', null, 'step'));
    const addrText = h('div', { class: 'small mono' });

    // ---- sketch ----
    const sketch = h('pre', { class: 'sketch' });
    const renderSketch = () => {
      const lines = arduinoSketch(m.template).split('\n');
      sketch.replaceChildren(
        ...lines.flatMap((l, i) => {
          const chg = l !== originalSketch[i];
          const k = l.indexOf('//');
          const content: Node[] = k >= 0 ? [document.createTextNode(l.slice(0, k)), h('span', { class: 'cmt' }, l.slice(k))] : [document.createTextNode(l)];
          return [chg ? h('span', { class: 'chg' }, ...content) : h('span', null, ...content), '\n'];
        }),
        h('span', { class: 'cmt' }, '\n// ... setup():\n'),
        h('span', null, PROGRAMMING_LOOP),
      );
    };

    const update = () => {
      const c = m.computer;
      const mcChanged = c.microcode !== lastMc;
      lastMc = c.microcode;
      const changed = renderDump();
      if (changed.length) lastEdit = changed;
      if (mcChanged) renderSketch();
      const addr = (c.opcode << 3) | c.step;
      bitCells.forEach((cell, i) => {
        const bit = 10 - i;
        const v = bit === 7 ? '0/1' : String((addr >> bit) & 1);
        setText(cell, v);
        setClass(cell, 'v1', v === '1');
      });
      const w = c.microcodeWord;
      setText(addrText, `now: opcode ${c.opcode.toString(2).padStart(4, '0')}, T${c.step} → left chip reads 0x${addr.toString(16).padStart(3, '0')} = 0x${(w >> 8).toString(16).padStart(2, '0')}, right chip reads 0x${(addr | 0x80).toString(16).padStart(3, '0')} = 0x${(w & 0xff).toString(16).padStart(2, '0')} → ${formatControlWord(w)}`);
      ceBtn.setLabel(ceRemoved ? 'Put CE back into T1' : 'Experiment: remove CE from T1');
      const edits = diffBytes(original, microcodeEepromImage(c.microcode)).filter((a) => a < 256);
      if (ceRemoved) {
        setText(
          expNote,
          `CE is gone from T1, so the program counter never counts. ${edits.length} low bytes changed from 08 to 00 (one per opcode, at x81, x89, …). The computer now fetches address ${c.pc} over and over: ${disassemble(c.ram[c.pc & 15])} again and again, A = ${c.a}, and the display never changes. That is why every row starts with MI|CO, RO|II|CE.`,
        );
      } else if (edits.length) {
        setText(expNote, `${edits.length} byte${edits.length > 1 ? 's' : ''} of the image differ from Ben’s (outlined)${lastEdit.length ? `; the last edit changed ${lastEdit.map((a) => `0x${a.toString(16).padStart(3, '0')}`).join(', ')}` : ''}. Reset and run to see what your microcode does.`);
      } else {
        setText(expNote, `This is Ben’s table with SUB (0011: …, RO|BI, EO|AI|SU). Click a cell to edit it, e.g. type “IO|MI”. The program below is his test: 5 + 6 − 7 = ${c.halted ? c.out : '…'}${c.halted ? ' ✓' : ''}.`);
      }
    };
    d.add(m.onChange(update));

    // ---- workbench ----
    const wbHost = h('div');
    const wb = mountComputerWorkbench(wbHost, { machine: m, tabs: ['program', 'output'], program: 'add-sub' });
    d.add(wb.dispose);
    buildDump();

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Microcode table (editable)', { accent: 'blue', subtitle: 'click a cell to edit' }, mp.el, row(ceBtn.el, restoreBtn.el), expNote),
        panel(
          'EEPROM image',
          { accent: 'blue', subtitle: 'printContents() output', chips: '2 × 28C16, programmed with the Arduino from video 32' },
          addrHead,
          addrBits,
          addrGroups,
          addrText,
          h('div', { class: 'table-scroll' }, dump),
          byteInfo,
          fullT.el,
          note('Blue: the two bytes the EEPROMs are outputting right now. Outlined: bytes that differ from Ben’s image. Bytes flash when an edit changes them. Before the flags register, A8–A10 are tied to GND, so only these 256 bytes are ever read.'),
        ),
      ),
      panel('The Arduino sketch', { accent: 'gray', subtitle: 'microcode-eeprom-programmer.ino (excerpt), regenerated from the table' }, h('div', { class: 'table-scroll' }, sketch), note('Highlighted lines differ from Ben’s version. writeEEPROM(address, data) stores the 8 low bits of data, so “data[address] >> 8” is the high byte.')),
      wbHost,
    );
    root.appendChild(wrap);
    renderSketch();
    m.changed();
    return d.dispose;
  },
});
