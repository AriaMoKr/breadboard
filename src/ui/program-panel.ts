import { disassemble, type AsmResult } from '../sim/assembler';
import type { Machine } from '../sim/machine';
import { MICROCODE_VERSIONS, type MicrocodeVersionId } from '../sim/microcode';
import { PROGRAMS, type ExampleProgram } from '../sim/programs';
import { Button, select, type SelectControl } from './components';
import { Disposer, h, setClass, setText } from './dom';

const VERSION_ORDER: MicrocodeVersionId[] = ['control-logic', 'arduino', 'more-instructions', 'flags'];

/** Dropdown value shown when the loaded source is not one of the examples. */
const CUSTOM = '__custom__';

/** Compare sources ignoring line endings and trailing whitespace. */
const normalize = (src: string) =>
  src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();

export interface ProgramPanelOptions {
  /** Only offer programs runnable with this microcode version (default: machine's). */
  version?: MicrocodeVersionId;
  /** Program id or source to load initially. */
  initial?: string;
  /** If the machine already holds a program (`machine.lastSource`), show it instead of loading `initial`. */
  keepLoaded?: boolean;
  /** Hide the source editor (memory view only). */
  memoryOnly?: boolean;
}

/**
 * Assembler editor + 16-byte memory view with clickable bits.
 *
 * The editor follows the machine: when anything calls `machine.loadSource()`
 * (a lab's "load this program" button, for instance) the textarea, the
 * Example dropdown and the error list update to match.
 */
export class ProgramPanel {
  readonly el: HTMLElement;
  private d = new Disposer();
  private ta: HTMLTextAreaElement | null = null;
  private picker: SelectControl<string> | null = null;
  private desc: HTMLElement | null = null;
  private errors: HTMLElement | null = null;
  private programs: ExampleProgram[];
  private seenSource = -1;

  constructor(
    readonly machine: Machine,
    opts: ProgramPanelOptions = {},
  ) {
    const m = machine;
    const c = m.computer;
    const version = opts.version ?? m.microcodeVersion;
    const allowed = (p: ExampleProgram) => VERSION_ORDER.indexOf(p.requires) <= VERSION_ORDER.indexOf(version);
    const programs = (this.programs = PROGRAMS.filter(allowed));

    // ---- editor ----
    const first = programs.find((p) => p.id === opts.initial) ?? programs[0];
    let editor: HTMLElement | null = null;
    if (!opts.memoryOnly) {
      const ta = (this.ta = h('textarea', { class: 'asm-source', spellcheck: false, rows: 14, 'aria-label': 'Assembly source' }));
      this.errors = h('ul', { class: 'asm-errors' });
      this.desc = h('p', { class: 'note' });
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          this.load();
        }
      });
      this.picker = select(
        [...programs.map((p) => ({ value: p.id, label: p.title })), { value: CUSTOM, label: '(your own program)' }],
        first?.id ?? CUSTOM,
        (id) => this.selectProgram(id),
        'Example',
      );
      editor = h(
        'div',
        { class: 'asm-editor' },
        h('div', { class: 'row' }, this.picker, new Button({ label: 'Assemble & load', kind: 'primary', title: 'Ctrl+Enter', onClick: () => this.load() }).el),
        this.desc,
        ta,
        this.errors,
        h('p', { class: 'note small' }, `Microcode: ${MICROCODE_VERSIONS[version].title}. Syntax: "label: LDA x", "14: 28", ".org 12", "x: .db 3", ";" comments. Ben's binary notation works too: "1110: 0001 1100".`),
      );
    }

    // ---- memory ----
    const rows = Array.from({ length: 16 }, (_, addr) => {
      const marker = h('td', { class: 'mem-marker' });
      const bits = Array.from({ length: 8 }, (_, i) => {
        const bit = 7 - i;
        const b = h('button', { type: 'button', class: `bit ${i < 4 ? 'hi' : 'lo'}`, title: `Toggle bit ${bit} of address ${addr}`, 'aria-label': `Address ${addr} bit ${bit}` });
        b.addEventListener('click', () => {
          c.ram[addr] ^= 1 << bit;
          m.changed();
        });
        return b;
      });
      const dec = h('td', { class: 'mono dim' });
      const dis = h('td', { class: 'mono' });
      const tr = h('tr', null, marker, h('td', { class: 'mono dim' }, addr.toString(2).padStart(4, '0')), h('td', { class: 'mono dim' }, String(addr)), h('td', { class: 'bits' }, bits), dec, dis);
      return { tr, marker, bits, dec, dis };
    });
    const table = h('table', { class: 'memory' }, h('thead', null, h('tr', null, h('th'), h('th', { colspan: 2 }, 'addr'), h('th', null, 'contents'), h('th', null, 'dec'), h('th', null, 'as instruction'))), h('tbody', null, rows.map((r) => r.tr)));

    const update = () => {
      rows.forEach((r, addr) => {
        const v = c.ram[addr];
        r.bits.forEach((b, i) => setClass(b, 'on', ((v >> (7 - i)) & 1) === 1));
        setText(r.dec, String(v));
        setText(r.dis, disassemble(v));
        const isPc = c.pc === addr, isMar = c.ramAddress === addr;
        setText(r.marker, `${isPc ? '▶' : ''}${isMar ? '●' : ''}`);
        setClass(r.tr, 'pc', isPc);
        setClass(r.tr, 'mar', isMar);
      });
      this.syncEditor();
    };
    this.d.add(m.onChange(update));

    this.el = h('div', { class: 'program-panel' }, editor, h('div', { class: 'memory-wrap' }, h('h4', null, 'RAM ', h('span', { class: 'dim small' }, '▶ PC  ● MAR — click bits to edit')), table));
    if (!opts.memoryOnly && !(opts.keepLoaded && m.lastSource !== null)) {
      if (opts.initial && !PROGRAMS.some((p) => p.id === opts.initial)) this.setSource(opts.initial);
      else if (first) this.selectProgram(first.id);
    }
    update();
  }

  /** Current editor text ('' without an editor). */
  get source(): string {
    return this.ta?.value ?? '';
  }

  /**
   * Put `source` into the editor and (unless `load: false`) assemble and load
   * it into RAM, which also resets the computer. The Example dropdown follows.
   */
  setSource(source: string, opts: { load?: boolean } = {}): AsmResult | null {
    if (this.ta) this.ta.value = source;
    if (opts.load === false) {
      this.syncPicker(source);
      return null;
    }
    return this.machine.loadSource(source);
  }

  /** Choose an example program by id, like picking it from the dropdown (loads it). */
  selectProgram(id: string): boolean {
    const p = PROGRAMS.find((x) => x.id === id);
    if (!p) {
      this.syncPicker(this.source);
      return false;
    }
    this.setSource(p.source.replace(/^\n/, ''));
    return true;
  }

  private load() {
    if (this.ta) this.machine.loadSource(this.ta.value);
  }

  /** Follow `machine.loadSource()` calls made by anyone (labs, this panel). */
  private syncEditor() {
    const m = this.machine;
    if (!this.ta || m.sourceVersion === this.seenSource) return;
    this.seenSource = m.sourceVersion;
    const src = m.lastSource;
    if (src === null) return;
    if (this.ta.value !== src) this.ta.value = src;
    const errs = m.lastAsm?.errors ?? [];
    this.errors?.replaceChildren(...errs.map((e) => h('li', null, `line ${e.line}: ${e.message}`)));
    setClass(this.ta, 'has-error', errs.length > 0);
    this.syncPicker(src);
  }

  private syncPicker(src: string) {
    if (!this.picker) return;
    const n = normalize(src);
    const p = this.programs.find((x) => normalize(x.source) === n) ?? PROGRAMS.find((x) => normalize(x.source) === n);
    const listed = p && this.programs.includes(p);
    this.picker.setValue(listed ? p.id : CUSTOM);
    if (this.desc) setText(this.desc, p ? `${p.description} (video ${p.video})` : '');
  }

  dispose() {
    this.d.dispose();
  }
}
