import type { Machine } from '../sim/machine';
import { INSTRUCTION_BY_OPCODE, MICROCODE_VERSIONS, microIndex } from '../sim/microcode';
import { formatControlWord, parseControlWord } from '../sim/signals';
import { Disposer, h, setClass, setText } from './dom';

export interface MicrocodePanelOptions {
  /** Let the user type new control words into cells (the Arduino reprogramming lab). */
  editable?: boolean;
  /** Show all 16 opcodes instead of only defined instructions. */
  allOpcodes?: boolean;
  /** Show all 8 step slots instead of just the ones the counter reaches. */
  allSteps?: boolean;
  /** Mark these opcode rows (e.g. the instructions a video adds); see `setHighlight`. */
  highlightOpcodes?: number[];
}

/**
 * The microcode ROM as a table: one row per opcode, one column per step.
 * Highlights the microinstruction currently on the control lines. JC/JZ rows
 * show the word for the *current* flags.
 */
export class MicrocodePanel {
  readonly el: HTMLElement;
  private d = new Disposer();
  private rowEls = new Map<number, HTMLTableRowElement>();

  constructor(
    readonly machine: Machine,
    opts: MicrocodePanelOptions = {},
  ) {
    const m = machine;
    const c = m.computer;
    const nSteps = opts.allSteps ? 8 : c.stepsPerInstruction;
    const opcodes = Array.from({ length: 16 }, (_, i) => i).filter((op) => opts.allOpcodes || INSTRUCTION_BY_OPCODE.has(op));
    const addrText = h('span', { class: 'mono dim' });
    const cells: { op: number; step: number; td: HTMLTableCellElement }[] = [];
    const rowEls = this.rowEls;

    const body = opcodes.map((op) => {
      const instr = INSTRUCTION_BY_OPCODE.get(op);
      const tds = Array.from({ length: nSteps }, (_, step) => {
        const td = h('td', { class: 'mono uc-cell', tabindex: opts.editable ? 0 : undefined, title: opts.editable ? 'Click to edit, e.g. "IO|MI"' : undefined });
        cells.push({ op, step, td });
        if (opts.editable) td.addEventListener('click', () => this.edit(td, op, step));
        if (opts.editable) td.addEventListener('keydown', (e) => e.key === 'Enter' && this.edit(td, op, step));
        return td;
      });
      const tr = h('tr', null, h('th', { class: 'mono' }, op.toString(2).padStart(4, '0')), h('th', null, instr?.mnemonic ?? '—'), tds);
      rowEls.set(op, tr);
      return tr;
    });

    const head = h('tr', null, h('th', null, 'opcode'), h('th', null, ''), Array.from({ length: nSteps }, (_, i) => h('th', null, `T${i}`)));
    const version = h('span', { class: 'dim small' });

    const update = () => {
      const flags = c.flags;
      for (const cell of cells) {
        const w = c.microcode[microIndex(flags, cell.op, cell.step)];
        if (!cell.td.querySelector('input')) setText(cell.td, formatControlWord(w));
        setClass(cell.td, 'current', c.opcode === cell.op && c.step === cell.step && c.manualControl === null);
        setClass(cell.td, 'fetch', cell.step < 2);
      }
      for (const [op, tr] of rowEls) setClass(tr, 'current', c.opcode === op);
      const a = (flags << 8) | (c.opcode << 3) | c.step;
      setText(addrText, `EEPROM address: ${(a >> 8).toString(2).padStart(2, '0')} · ${'x'} · ${c.opcode.toString(2).padStart(4, '0')} · ${c.step.toString(2).padStart(3, '0')}  (flags ZC · byte · opcode · step)`);
      setText(version, MICROCODE_VERSIONS[m.microcodeVersion].title + (m.conditionalJumps ? ' — JC/JZ rows show the current flags' : ''));
    };
    this.d.add(m.onChange(update));

    this.el = h(
      'div',
      { class: 'microcode-panel' },
      h('div', { class: 'row' }, h('h4', null, 'Microcode'), version),
      h('div', { class: 'table-scroll' }, h('table', { class: 'microcode' }, h('thead', null, head), h('tbody', null, body))),
      addrText,
    );
    if (opts.highlightOpcodes) this.setHighlight(opts.highlightOpcodes);
    update();
  }

  /** Mark these opcode rows with the `highlight` class (replaces the previous set). */
  setHighlight(opcodes: Iterable<number>) {
    const set = new Set(opcodes);
    for (const [op, tr] of this.rowEls) setClass(tr, 'highlight', set.has(op));
  }

  /** The table row of an opcode, if shown. */
  rowEl(opcode: number): HTMLTableRowElement | undefined {
    return this.rowEls.get(opcode);
  }

  private edit(td: HTMLTableCellElement, op: number, step: number) {
    if (td.querySelector('input')) return;
    const m = this.machine;
    const current = m.template[op]?.[step] ?? 0;
    const input = h('input', { class: 'uc-input mono', value: current ? formatControlWord(current) : '' });
    td.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (apply: boolean) => {
      if (done) return;
      if (apply) {
        try {
          const w = parseControlWord(input.value);
          done = true;
          td.replaceChildren();
          m.editMicrocode(op, step, w);
        } catch (err) {
          input.classList.add('has-error');
          input.title = (err as Error).message;
          return;
        }
      } else {
        done = true;
        td.replaceChildren();
        m.changed();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') commit(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => commit(true));
  }

  dispose() {
    this.d.dispose();
  }
}
