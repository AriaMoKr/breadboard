/**
 * Shared UI helpers for the "Control logic" and "Programming the CPU" labs.
 * (Not a lab: no .lab.ts suffix.)
 */
import { disassemble } from '../../sim/assembler';
import type { Computer, Transfer } from '../../sim/computer';
import type { Machine } from '../../sim/machine';
import { microIndex } from '../../sim/microcode';
import { HLT, SIGNAL_BITS, SIGNAL_INFO, SIGNALS, formatControlWord, type ModuleId, type Signal } from '../../sim/signals';
import { Button, Toggle, select } from '../../ui/components';
import { Disposer, growOnly, h, setClass, setText } from '../../ui/dom';
import { describeTransfer, explainMicrostepMistake, microstepGoal } from './_models';

// ---------------------------------------------------------------------------
// Small DOM helpers

/** Inject a <style> element (scope your selectors under a lab class). Returns a remover. */
export function scopedStyle(parent: HTMLElement, css: string): () => void {
  const el = h('style', null, css);
  parent.appendChild(el);
  return () => el.remove();
}

/**
 * The shared schematic draws chip bodies dark in both colour schemes, but
 * pin labels use --fg-dim, which is too dark on them in light mode.
 */
export const chipContrastCss = (scope: string) =>
  `@media (prefers-color-scheme: light) { ${scope} .schematic .chip .pin-label, ${scope} .schematic .chip .chip-sublabel { fill: #c5cbd6; } }`;

/** Video index from the route (#/lab/<id>/<video>), if any. */
export function routeVideo(): number | null {
  const m = typeof location !== 'undefined' ? location.hash.match(/#\/lab\/[^/]+\/(\d+)/) : null;
  return m ? Number(m[1]) : null;
}

/** Signal badges for a control word (uses the shared `.sig` style). */
export function sigChips(word: number, opts: { all?: boolean; dimOff?: boolean } = {}): HTMLElement {
  const sigs = opts.all ? SIGNALS : SIGNALS.filter((s) => word & SIGNAL_BITS[s]);
  if (!sigs.length) return h('span', { class: 'dim mono small' }, '— (nothing)');
  return h(
    'span',
    { class: 'sig-row', style: 'display:inline-flex' },
    sigs.map((s) => h('span', { class: `sig ${word & SIGNAL_BITS[s] ? 'on' : ''}`, title: `${s}: ${SIGNAL_INFO[s].title}` }, s)),
  );
}

/** Toggle the shared `.highlight` class on the ComputerView module cards inside `root`. */
export function highlightModules(root: HTMLElement, modules: readonly ModuleId[]) {
  root.querySelectorAll<HTMLElement>('.module').forEach((el) => setClass(el, 'highlight', modules.includes(el.dataset.module as ModuleId)));
}

/** Briefly add a class to the module cards (e.g. a flash animation). */
export function flashModules(root: HTMLElement, modules: readonly ModuleId[], cls: string, ms: number, d: Disposer) {
  const els = [...root.querySelectorAll<HTMLElement>('.module')].filter((el) => modules.includes(el.dataset.module as ModuleId));
  for (const el of els) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }
  const t = setTimeout(() => els.forEach((el) => el.classList.remove(cls)), ms);
  d.add(() => clearTimeout(t));
}

// ---------------------------------------------------------------------------
// Tabs inside a lab (each tab is mounted when shown and disposed when hidden)

export interface LabTab {
  id: string;
  label: string;
  mount(el: HTMLElement): () => void;
}

export function labTabs(tabs: LabTab[], initial?: string): { el: HTMLElement; show(id: string): void; dispose(): void } {
  const bar = h('div', { class: 'tabs lab-tabs', role: 'tablist' });
  const body = h('div', { class: 'lab-tab-body' });
  let current: { id: string; dispose: () => void } | null = null;
  const show = (id: string) => {
    const tab = tabs.find((t) => t.id === id) ?? tabs[0];
    if (current?.id === tab.id) return;
    current?.dispose();
    body.replaceChildren();
    const el = h('div', { class: 'lab-stack' });
    body.appendChild(el);
    current = { id: tab.id, dispose: tab.mount(el) };
    bar.querySelectorAll('button').forEach((b) => {
      setClass(b, 'active', b.dataset.tab === tab.id);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab.id));
    });
  };
  for (const t of tabs) bar.appendChild(h('button', { type: 'button', role: 'tab', dataset: { tab: t.id }, onClick: () => show(t.id) }, t.label));
  const el = h('div', { class: 'lab-stack' }, h('div', { style: 'border:1px solid var(--border);border-radius:var(--radius);overflow:hidden' }, bar), body);
  show(initial ?? tabs[0].id);
  return {
    el,
    show,
    dispose: () => {
      current?.dispose();
      current = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Saving / restoring the computer state (undo in the exercises)

export interface SavedState {
  a: number;
  b: number;
  ir: number;
  mar: number;
  pc: number;
  out: number;
  step: number;
  flagC: 0 | 1;
  flagZ: 0 | 1;
  clk: 0 | 1;
  ram: Uint8Array;
  cycles: number;
  instructions: number;
}

export function saveState(c: Computer): SavedState {
  return { a: c.a, b: c.b, ir: c.ir, mar: c.mar, pc: c.pc, out: c.out, step: c.step, flagC: c.flagC, flagZ: c.flagZ, clk: c.clk, ram: c.ram.slice(), cycles: c.cycles, instructions: c.instructions };
}

export function restoreState(c: Computer, s: SavedState) {
  c.a = s.a;
  c.b = s.b;
  c.ir = s.ir;
  c.mar = s.mar;
  c.pc = s.pc;
  c.out = s.out;
  c.step = s.step;
  c.flagC = s.flagC;
  c.flagZ = s.flagZ;
  c.clk = s.clk;
  c.ram.set(s.ram);
  c.cycles = s.cycles;
  c.instructions = s.instructions;
  c.lastTransfers = [];
}

// ---------------------------------------------------------------------------
// Observing every rising clock edge

export interface EdgeInfo {
  /** State just before the rising edge. */
  pre: { step: number; ir: number; pc: number; mar: number; a: number; b: number; flags: number; word: number; microWord: number; bus: number; drivers: ModuleId[]; aluCarry: number; aluZero: number };
  /** What the edge latched. */
  transfers: Transfer[];
  /** Rising-edge counter after the edge. */
  edge: number;
}

export interface EdgeListener {
  /** Called just before the rising edge (state still pre-edge). */
  before?: () => void;
  after: (e: EdgeInfo) => void;
}
const edgeHooks = new WeakMap<Computer, { listeners: Set<EdgeListener>; restore: () => void }>();

/**
 * Observe every rising clock edge of `c` (`after` gets the pre-edge state).
 * Works by wrapping this Computer instance's `halfCycle` (shared between
 * subscribers; unwrapped when the last one unsubscribes).
 */
export function onRisingEdge(c: Computer, cb: EdgeListener | ((e: EdgeInfo) => void)): () => void {
  const listener: EdgeListener = typeof cb === 'function' ? { after: cb } : cb;
  let hook = edgeHooks.get(c);
  if (!hook) {
    const listeners = new Set<EdgeListener>();
    const orig = c.halfCycle;
    const wrapped = (): boolean => {
      if (c.clk === 1 || c.halted || listeners.size === 0) return orig.call(c);
      for (const l of listeners) l.before?.();
      const bus = c.bus;
      const alu = c.alu;
      const pre = { step: c.step, ir: c.ir, pc: c.pc, mar: c.mar, a: c.a, b: c.b, flags: c.flags, word: c.controlWord, microWord: c.microcodeWord, bus: bus.value, drivers: bus.drivers, aluCarry: alu.carry, aluZero: alu.zero };
      const ok = orig.call(c);
      if (ok) {
        const info: EdgeInfo = { pre, transfers: c.lastTransfers, edge: c.risingEdges };
        for (const l of listeners) l.after(info);
      }
      return ok;
    };
    c.halfCycle = wrapped;
    hook = { listeners, restore: () => { if (c.halfCycle === wrapped) c.halfCycle = orig; } };
    edgeHooks.set(c, hook);
  }
  hook.listeners.add(listener);
  return () => {
    const hk = edgeHooks.get(c);
    if (!hk) return;
    hk.listeners.delete(listener);
    if (hk.listeners.size === 0) {
      hk.restore();
      edgeHooks.delete(c);
    }
  };
}

export const transferText = (t: Transfer) =>
  t.signal === 'FI' ? `flags C=${t.value & 1} Z=${t.value >> 1}` : t.signal === 'CE' ? `PC → ${t.value}` : `${t.to === 'out' ? 'OUT' : t.to.toUpperCase()} ← ${t.value}`;

// ---------------------------------------------------------------------------
// Toolbar for composed computer views

export interface ToolbarOptions {
  speeds?: number[];
  keyboard?: boolean;
  extra?: (Node | null)[];
}

export function machineToolbar(m: Machine, opts: ToolbarOptions = {}): { el: HTMLElement; dispose: () => void } {
  const d = new Disposer();
  const run = new Button({ label: 'Run', labels: ['Run', 'Stop'], kind: 'primary', title: 'Start/stop the astable clock', onClick: () => (m.running && m.mode === 'auto' ? m.stop() : m.start()) });
  const pulse = new Button({ label: 'Clock pulse', title: 'One clock cycle (Space)', onClick: () => m.pulse() });
  const instr = new Button({ label: 'Step instruction', title: 'Clock until the next T0', onClick: () => m.stepInstruction() });
  const reset = new Button({ label: 'Reset', kind: 'danger', onClick: () => m.reset() });
  const speeds = opts.speeds ?? [1, 2, 5, 10, 50, 300];
  const near = () => String(speeds.reduce((best, s) => (Math.abs(Math.log(s / m.hz)) < Math.abs(Math.log(best / m.hz)) ? s : best), speeds[0]));
  const speed = select(speeds.map((s) => ({ value: String(s), label: `${s} Hz` })), near(), (v) => m.setHz(Number(v)), 'Speed');
  const status = h('span', { class: 'mono dim small' });
  const upd = () => {
    const c = m.computer;
    run.setLabel(m.running && m.mode === 'auto' ? 'Stop' : 'Run');
    setText(status, `${c.halted ? 'HALTED · ' : ''}cycle ${c.cycles}`);
    const sel = speed.querySelector('select');
    if (sel && document.activeElement !== sel && sel.value !== near()) sel.value = near();
  };
  d.add(m.onChange(upd));
  upd();
  if (opts.keyboard) {
    d.listen(window, 'keydown', (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, select, [contenteditable], button')) return;
      if (e.key === ' ') {
        e.preventDefault();
        m.pulse();
      }
    });
  }
  const el = h('div', { class: 'toolbar' }, run.el, pulse.el, instr.el, reset.el, speed, ...(opts.extra ?? []), status);
  return { el, dispose: d.dispose };
}

// ---------------------------------------------------------------------------
// Micro-step trace (logic-analyser style table)

export interface TraceRow {
  edge: number;
  step: number;
  ir: number;
  pc: number;
  word: number;
  bus: number;
  drivers: ModuleId[];
  transfers: Transfer[];
  flags: number;
  /** Live ALU carry/zero just before the edge. */
  aluCarry: number;
  aluZero: number;
  note?: string;
}

export class MicrostepTrace {
  readonly el: HTMLElement;
  readonly rows: TraceRow[] = [];
  private body: HTMLTableSectionElement;
  private dirty = true;
  private skipped = 0;
  private d = new Disposer();
  private info: HTMLElement;

  constructor(
    readonly machine: Machine,
    private opts: { max?: number; title?: string; annotate?: (row: TraceRow) => string | undefined; showFlags?: boolean; showAlu?: boolean } = {},
  ) {
    const c = machine.computer;
    this.body = h('tbody');
    this.info = h('span', { class: 'dim small' });
    const head = ['clk', 'T', 'instr.', 'control word', 'bus', 'latched', ...(opts.showAlu ? ['ALU C Z (live)'] : []), ...(opts.showFlags ? ['flags C Z'] : [])];
    this.el = h(
      'div',
      { class: 'ustep-trace' },
      h('div', { class: 'row' }, h('h3', { class: 'sub-head' }, opts.title ?? 'Micro-step trace'), this.info),
      h('div', { class: 'table-scroll' }, h('table', { class: 'microcode ustep-table' }, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))), this.body)),
    );
    this.d.add(
      onRisingEdge(c, (e) => {
        if (machine.running && machine.mode === 'auto' && machine.hz > 1000) {
          this.skipped++;
          return;
        }
        const row: TraceRow = { edge: e.edge, step: e.pre.step, ir: e.pre.ir, pc: e.pre.pc, word: e.pre.word, bus: e.pre.bus, drivers: e.pre.drivers, transfers: e.transfers, flags: c.flags, aluCarry: e.pre.aluCarry, aluZero: e.pre.aluZero };
        row.note = opts.annotate?.(row);
        this.rows.push(row);
        if (this.rows.length > (opts.max ?? 40)) this.rows.shift();
        this.dirty = true;
      }),
    );
    this.d.add(machine.onChange(() => this.render()));
    this.render();
  }

  clear() {
    this.rows.length = 0;
    this.skipped = 0;
    this.dirty = true;
    this.render();
  }

  private render() {
    setText(this.info, this.skipped ? `(${this.skipped} cycles too fast to trace)` : this.rows.length ? 'newest first' : 'pulse the clock to fill the trace');
    if (!this.dirty) return;
    this.dirty = false;
    const rows = this.rows.slice().reverse().slice(0, this.opts.max ?? 40);
    this.body.replaceChildren(
      ...rows.map((r) =>
        h(
          'tr',
          { class: r.step < 2 ? 'fetch-row' : '' },
          h('td', { class: 'mono dim' }, String(r.edge)),
          h('td', { class: 'mono' }, `T${r.step}`),
          h('td', { class: 'mono' }, r.step < 2 ? 'fetch' : disassemble(r.ir)),
          h('td', { class: 'mono' }, formatControlWord(r.word)),
          h('td', { class: 'mono' }, r.drivers.length ? `${r.bus} (${r.drivers.map((x) => x.toUpperCase()).join('+')})` : '—'),
          h('td', { class: 'mono' }, [r.transfers.map(transferText).join(', ') || '—', r.note ? h('span', { class: 'ustep-note' }, ` ${r.note}`) : null]),
          this.opts.showAlu ? h('td', { class: 'mono' }, `${r.aluCarry} ${r.aluZero}`) : null,
          this.opts.showFlags ? h('td', { class: 'mono' }, `${r.flags & 1} ${r.flags >> 1}`) : null,
        ),
      ),
    );
  }

  dispose() {
    this.d.dispose();
  }
}

// ---------------------------------------------------------------------------
// "Be the control unit" exercise

const EXERCISE_CSS = `
.cu-ex .cu-switches { display: flex; flex-wrap: wrap; gap: 5px; }
.cu-ex .cu-switches button.sig { cursor: pointer; font-size: 0.8rem; padding: 4px 8px; background: var(--panel-2); min-width: 40px; }
.cu-ex .cu-switches button.sig.on { background: var(--led-blue); color: var(--on-blue); }
@media (pointer: coarse) { .cu-ex .cu-switches button.sig { padding: 8px 10px; } }
.cu-ex .cu-prog { display: flex; flex-wrap: wrap; gap: 6px; }
.cu-ex .cu-prog span { font-family: var(--mono); font-size: 0.78rem; border: 1px solid var(--border); border-radius: 6px; padding: 2px 7px; color: var(--fg-dim); }
.cu-ex .cu-prog span.cur { border-color: var(--led-green); color: var(--fg); box-shadow: inset 3px 0 0 var(--led-green); }
.cu-ex .cu-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.cu-ex .cu-step { border: 1px solid var(--border); border-radius: 6px; padding: 3px 5px; font-family: var(--mono); font-size: 0.7rem; min-height: 40px; overflow-wrap: anywhere; color: var(--fg-dim); }
.cu-ex .cu-step b { display: block; color: var(--fg); font-size: 0.74rem; }
.cu-ex .cu-step.done { background: color-mix(in srgb, var(--ok) 10%, transparent); }
.cu-ex .cu-step.cur { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.cu-ex .cu-feedback { border-radius: 8px; padding: 6px 10px; font-size: 0.86rem; }
.cu-ex .cu-feedback.ok { border-left: 3px solid var(--ok); background: color-mix(in srgb, var(--ok) 9%, var(--panel)); }
.cu-ex .cu-feedback.bad { border-left: 3px solid var(--danger); background: color-mix(in srgb, var(--danger) 9%, var(--panel)); }
.cu-ex .cu-feedback ul { margin: 4px 0 0; padding-left: 18px; }
.cu-ex .cu-feedback:empty { display: none; }
`;

export interface ExerciseOptions {
  /** Assembly source loaded into RAM. */
  source: string;
  /** Start in guided mode (the switches are set for you). */
  guided?: boolean;
  /** Short heading above the exercise. */
  intro?: string;
  /** RAM addresses from here on are shown as data (default 14). */
  dataFrom?: number;
}

/**
 * The learner plays the control logic: for each micro-step they set the 16
 * control switches and pulse the clock. Each rising edge is checked against
 * the reference microcode (the EEPROMs Ben burns later), mistakes are
 * explained, and the pulse can be undone.
 */
export class ControlUnitExercise {
  readonly el: HTMLElement;
  private d = new Disposer();
  private fetchAddr = 0;
  private undo: { snap: SavedState; fetchAddr: number }[] = [];
  private correct = 0;
  private mistakes = 0;
  private feedback: { kind: 'ok' | 'bad'; title: string; messages: string[] } | null = null;
  private reveal = false;

  constructor(
    readonly machine: Machine,
    private opts: ExerciseOptions,
  ) {
    const m = machine;
    const c = m.computer;
    if (c.manualControl === null) c.setManualControl(0);

    const progEl = h('div', { class: 'cu-prog' });
    const stepsEl = h('div', { class: 'cu-steps' });
    const goal = h('div', { class: 'callout' });
    const fb = h('div', { class: 'cu-feedback' });
    // these change with every step (every clock pulse while it runs): what's below mustn't move
    for (const el of [stepsEl, goal, fb]) growOnly(el);
    const score = h('span', { class: 'mono dim small' });

    const setWord = (w: number) => {
      c.setManualControl(w & 0xffff);
      m.changed();
    };
    const switches = SIGNALS.map((sig) => {
      const b = h('button', { type: 'button', class: 'sig', title: `${sig}: ${SIGNAL_INFO[sig].title}. ${SIGNAL_INFO[sig].description}`, 'aria-pressed': 'false' }, sig);
      b.addEventListener('click', () => setWord((c.manualControl ?? 0) ^ SIGNAL_BITS[sig]));
      return { sig, b };
    });

    const guided = new Toggle({ label: 'Set the switches for me (guided)', value: !!opts.guided, onChange: () => sync() });
    const pulse = new Button({ label: 'Pulse clock', kind: 'primary', title: 'One clock pulse with the switches as set', onClick: () => m.pulse() });
    const check = new Button({ label: 'Check switches', onClick: () => {
      const r = explainMicrostepMistake(c.manualControl ?? 0, c.microcodeWord);
      this.feedback = r.ok ? { kind: 'ok', title: '✓ Those switches are right. Pulse the clock.', messages: [] } : { kind: 'bad', title: 'Not quite:', messages: r.messages };
      render();
    } });
    const hint = new Button({ label: 'Hint', title: 'Show the control word for this step', onClick: () => { this.reveal = true; render(); } });
    const setForMe = new Button({ label: 'Set them for me', onClick: () => setWord(c.microcodeWord) });
    const undoBtn = new Button({ label: 'Undo last pulse', onClick: () => {
      const u = this.undo.pop();
      if (!u) return;
      restoreState(c, u.snap);
      this.fetchAddr = u.fetchAddr;
      this.feedback = { kind: 'ok', title: '↶ Took the last clock pulse back. Fix the switches and try again.', messages: [] };
      m.changed();
    } });
    const restart = new Button({ label: 'Restart', kind: 'danger', onClick: () => this.restart() });

    // check every rising edge against the reference microcode
    let preSnapshot: SavedState | null = null;
    this.d.add(
      onRisingEdge(c, {
        before: () => (preSnapshot = saveState(c)),
        after: (e) => {
          if (c.manualControl === null) return;
          const used = e.pre.word;
          const expected = e.pre.microWord;
          if (preSnapshot) this.undo.push({ snap: preSnapshot, fetchAddr: this.fetchAddr });
          if (this.undo.length > 64) this.undo.shift();
          const r = explainMicrostepMistake(used, expected);
          this.reveal = false;
          if (r.ok) {
            this.correct++;
            this.feedback = { kind: 'ok', title: `✓ T${e.pre.step}: ${describeTransfer(used)}`, messages: [] };
          } else {
            this.mistakes++;
            this.feedback = {
              kind: 'bad',
              title: `✗ T${e.pre.step}: you set ${formatControlWord(used)}, the microcode would set ${formatControlWord(expected)}.`,
              messages: [...r.messages, 'Press “Undo last pulse” to take it back, or carry on and watch what goes wrong.'],
            };
          }
        },
      }),
    );

    const sync = () => {
      if (c.step === 0) this.fetchAddr = c.pc;
      if (guided.value && c.clk === 0 && c.manualControl !== null && c.manualControl !== c.microcodeWord && !c.halted) {
        c.setManualControl(c.microcodeWord);
        m.changed();
        return;
      }
      render();
    };

    const render = () => {
      const step = c.step;
      const fetchAddr = this.fetchAddr;
      const opcode = step < 2 ? (c.ram[fetchAddr] >> 4) & 15 : c.opcode;
      const expected = c.microcodeWord;
      const used = c.manualControl ?? 0;
      // program listing
      progEl.replaceChildren(
        ...Array.from(c.ram).flatMap((b, addr) => {
          if (b === 0 && addr !== fetchAddr) return [];
          const data = addr >= (opts.dataFrom ?? 14);
          return [h('span', { class: addr === fetchAddr ? 'cur' : '' }, `${addr}: ${data ? b : disassemble(b)}`)];
        }),
      );
      // the current instruction's micro-steps
      stepsEl.replaceChildren(
        ...[0, 1, 2, 3, 4].map((s) => {
          const w = c.microcode[microIndex(c.flags, opcode, s)];
          const done = s < step;
          const cur = s === step;
          const show = done || (cur && (guided.value || this.reveal));
          return h('div', { class: `cu-step ${done ? 'done' : ''} ${cur ? 'cur' : ''}` }, h('b', null, `T${s}${s < 2 ? ' fetch' : ''}`), show ? formatControlWord(w) : cur ? '?' : '·');
        }),
      );
      // goal / status
      const live = { fetchAddr, operand: c.operand, ram: c.ram, a: c.a, b: c.b };
      const finished = c.halted && (expected & HLT) !== 0;
      if (finished) setText(goal, `Done! The clock is halted and the display shows ${c.out}. You were the control logic for the whole program: ${this.correct} correct pulses, ${this.mistakes} mistakes. In “Control logic part 3” two EEPROMs do exactly this.`);
      else if (c.halted) setText(goal, 'HLT is on, so the clock is stopped and pulses do nothing. Switch HLT off to carry on.');
      else if (c.clk === 1) setText(goal, 'The clock is high: the registers latched on the rising edge. Release the button to finish the pulse.');
      else setText(goal, `T${step} · ${microstepGoal(opcode, step, expected, live)}`);
      // feedback
      if (this.feedback) {
        fb.className = `cu-feedback ${this.feedback.kind}`;
        fb.replaceChildren(h('div', null, this.feedback.title));
        if (this.feedback.messages.length) fb.appendChild(h('ul', null, this.feedback.messages.map((t) => h('li', null, t))));
      } else fb.replaceChildren();
      switches.forEach(({ sig, b }) => {
        const on = (used & SIGNAL_BITS[sig]) !== 0;
        setClass(b, 'on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      undoBtn.setDisabled(this.undo.length === 0);
      setText(score, `${this.correct} correct · ${this.mistakes} mistakes`);
    };

    this.d.add(m.onChange(sync));

    const styleEl = h('style', null, EXERCISE_CSS);
    this.el = h(
      'div',
      { class: 'cu-ex lab-stack', style: 'gap:10px' },
      styleEl,
      opts.intro ? h('p', { class: 'note' }, opts.intro) : null,
      progEl,
      stepsEl,
      goal,
      h('div', { class: 'cu-switches', role: 'group', 'aria-label': 'Control switches' }, switches.map((x) => x.b)),
      h('div', { class: 'row' }, pulse.el, check.el, hint.el, setForMe.el),
      fb,
      h('div', { class: 'row' }, undoBtn.el, restart.el, guided.el, score),
    );
    this.d.add(() => styleEl.remove());
    this.restart();
  }

  restart() {
    const m = this.machine;
    const c = m.computer;
    m.stop();
    m.setMode('manual');
    m.loadSource(this.opts.source);
    c.setManualControl(0);
    this.fetchAddr = 0;
    this.undo = [];
    this.correct = 0;
    this.mistakes = 0;
    this.reveal = false;
    this.feedback = null;
    m.changed();
  }

  dispose() {
    this.d.dispose();
  }
}

export const isSignal = (s: string): s is Signal => (SIGNALS as readonly string[]).includes(s);
