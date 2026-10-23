/**
 * UI helpers shared by the datapath labs (registers, bus, two's complement,
 * ALU). Styling is injected per lab as a <style> element scoped under
 * `.dp-lab` and removed in cleanup.
 */
import type { Circuit, Level } from '../../logic/circuit';
import type { Transfer } from '../../sim/computer';
import type { Machine } from '../../sim/machine';
import { SIGNAL_BITS, SIGNAL_INFO, type Signal } from '../../sim/signals';
import { Toggle } from '../../ui/components';
import { Disposer, animate, h, headCell, setClass, setText } from '../../ui/dom';
import type { GateHandle, P } from '../../ui/schematic';

const DP_CSS = `
.dp-lab { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.dp-lab .lab-grid > *, .dp-lab .lab-stack > * { min-width: 0; }
.dp-lab .callout { min-height: 2.6em; }
.dp-lab .callout.warn { border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--panel)); }
.dp-lab .callout.good { border-left-color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, var(--panel)); }
.dp-lab .dp-warn { color: var(--danger); font-weight: 600; }
.dp-lab .dp-good { color: var(--ok); font-weight: 600; }
.dp-lab .dp-scroll { overflow-x: auto; max-width: 100%; }
.dp-lab svg.schematic { touch-action: manipulation; }
.dp-lab .legend .lz { background: repeating-linear-gradient(90deg, var(--wire-z) 0 4px, transparent 4px 7px); }
/* bit rows */
.dp-bits { display: inline-flex; flex-direction: column; gap: 3px; min-width: 0; }
.dp-bits-row { display: inline-flex; align-items: flex-end; gap: 3px; }
.dp-bits-label { font-size: 0.8rem; color: var(--fg-dim); min-width: 1.4em; align-self: center; }
.dp-bit { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; }
.dp-bit.gap { margin-left: 6px; }
.dp-bit button { width: 26px; height: 30px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel-2); color: var(--fg-dim); font: 600 0.95rem var(--mono); cursor: pointer; padding: 0; transition: background 0.12s, color 0.12s, transform 0.12s; }
.dp-bit button:disabled { cursor: default; }
.dp-bit button.on { background: color-mix(in srgb, var(--led-red) 75%, var(--panel)); border-color: var(--led-red); color: #fff; box-shadow: 0 0 8px color-mix(in srgb, var(--led-red) 50%, transparent); }
.dp-bits.blue .dp-bit button.on { background: color-mix(in srgb, var(--led-blue) 75%, var(--panel)); border-color: var(--led-blue); box-shadow: 0 0 8px color-mix(in srgb, var(--led-blue) 50%, transparent); }
.dp-bits.green .dp-bit button.on { background: color-mix(in srgb, var(--led-green) 65%, var(--panel)); border-color: var(--led-green); color: #04210f; }
.dp-bits.yellow .dp-bit button.on { background: color-mix(in srgb, var(--led-yellow) 70%, var(--panel)); border-color: var(--led-yellow); color: #2a2000; }
.dp-bit button.flash { transform: translateY(-3px); outline: 2px solid var(--accent-2); outline-offset: 1px; }
.dp-bit button.bad { outline: 2px solid var(--danger); outline-offset: 1px; }
.dp-bit button.neg { border-style: dashed; }
.dp-bit .dp-w { font: 0.62rem var(--mono); color: var(--fg-faint); white-space: nowrap; }
@media (pointer: coarse) { .dp-bit button { width: 32px; height: 36px; } }
.dp-bit .dp-w.neg { color: var(--danger); font-weight: 700; }
/* checklist */
.dp-check { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; counter-reset: dpstep; }
.dp-check li { counter-increment: dpstep; position: relative; padding: 7px 10px 7px 38px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); font-size: 0.88rem; }
.dp-check li::before { content: counter(dpstep); position: absolute; left: 9px; top: 7px; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--fg-faint); color: var(--fg-dim); font: 600 0.72rem/20px var(--mono); text-align: center; }
.dp-check li.current { border-color: var(--accent-2); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-2) 40%, transparent); }
.dp-check li.done { opacity: 0.75; }
.dp-check li.done::before { content: '✓'; background: var(--ok); border-color: var(--ok); color: #04210f; }
.dp-check li .dp-check-detail { display: block; color: var(--fg-dim); font-size: 0.8rem; margin-top: 2px; }
.dp-check li.current .dp-check-detail { color: var(--fg); }
/* manual control jumpers */
.dp-jumpers { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.dp-jumper { display: inline-flex; flex-direction: column; gap: 2px; }
.dp-jumper .dp-line { font: 0.68rem var(--mono); color: var(--fg-faint); padding-left: 41px; }
.dp-jumper .dp-line.low { color: var(--led-blue); }
/* equations and tables */
.dp-eq { font-family: var(--mono); font-size: 0.95rem; line-height: 1.6; overflow-wrap: anywhere; }
.dp-eq b { color: var(--fg); }
.dp-sum { font-family: var(--mono); font-size: 0.95rem; border-collapse: collapse; }
.dp-sum td { padding: 1px 6px; text-align: right; white-space: nowrap; }
.dp-sum tr.rule td { border-top: 2px solid var(--fg-dim); }
.dp-sum .dim { color: var(--fg-faint); }
.dp-sum .carry { color: var(--accent-2); font-size: 0.75rem; }
.dp-sum .strike { text-decoration: line-through; color: var(--fg-faint); }
.dp-lab table.truth-table { max-width: 100%; }
.dp-lab .truth-table td.z { color: var(--fg-faint); }
.dp-lab .truth-table td.x { color: var(--wire-x); font-weight: 700; }
.dp-lab .truth-table.compact th, .dp-lab .truth-table.compact td { padding: 2px 7px; }
.dp-pill { display: inline-block; font: 600 0.7rem var(--mono); padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-dim); }
.dp-pill.on { background: var(--led-blue); border-color: var(--led-blue); color: #fff; }
.dp-pill.bad { background: var(--danger); border-color: var(--danger); color: #fff; }
.dp-pill.good { background: var(--ok); border-color: var(--ok); color: #04210f; }
.dp-log { margin: 0; padding-left: 20px; font: 0.8rem var(--mono); color: var(--fg-dim); max-height: 9.5em; overflow-y: auto; }
.dp-log li.bad { color: var(--danger); }
.dp-log li.good { color: var(--ok); }
@media (max-width: 860px) {
  .dp-lab .module-slot.empty { display: none; }
}
@media (max-width: 420px) {
  .dp-bit button { width: 24px; height: 28px; font-size: 0.85rem; }
  .dp-bits-row { gap: 2px; }
  .dp-bit.gap { margin-left: 4px; }
}
`;

/**
 * Create the lab wrapper (`div.dp-lab`) inside `root` with the shared styles
 * plus optional lab-specific CSS. The style elements are removed by `d`.
 */
export function labFrame(root: HTMLElement, d: Disposer, extraCss = ''): HTMLDivElement {
  const wrap = h('div', { class: 'dp-lab' });
  const style = h('style', null, DP_CSS + extraCss);
  root.append(style, wrap);
  d.add(() => style.remove());
  return wrap;
}

export const levelText = (l: Level) => String(l);

/** Legend for wire colours: 1 / 0 / Z (floating) / X (contention). */
export function levelLegend(): HTMLElement {
  const item = (style: string, label: string, cls = '') => h('span', null, h('i', { style, class: cls }), label);
  return h(
    'div',
    { class: 'legend' },
    item('background: var(--wire-1)', '1 (high)'),
    item('background: var(--wire-0)', '0 (low)'),
    item('', 'Z (floating, high-impedance)', 'lz'),
    item('background: var(--wire-x)', 'X (contention / unknown)'),
  );
}

export interface TruthTable {
  el: HTMLTableElement;
  rows: HTMLTableRowElement[];
  cells: HTMLTableCellElement[][];
  /** Highlight one row (or several, or none with -1). */
  highlight(i: number | number[]): void;
}

export function truthTable(headers: (string | Node)[], rows: (string | number)[][], opts: { compact?: boolean; caption?: string } = {}): TruthTable {
  const cells: HTMLTableCellElement[][] = [];
  const trs = rows.map((r) => {
    const tds = r.map((x) => {
      const s = String(x);
      return h('td', { class: s === 'Z' ? 'z' : s === 'X' ? 'x' : '' }, s);
    });
    cells.push(tds);
    return h('tr', null, tds);
  });
  const el = h(
    'table',
    { class: `truth-table ${opts.compact ? 'compact' : ''}` },
    opts.caption ? h('caption', { class: 'small dim', style: 'caption-side: bottom; text-align: left; padding-top: 4px' }, opts.caption) : null,
    h('thead', null, h('tr', null, headers.map((x) => headCell(x)))),
    h('tbody', null, trs),
  );
  return {
    el,
    rows: trs,
    cells,
    highlight(i) {
      const set = new Set(Array.isArray(i) ? i : [i]);
      trs.forEach((tr, k) => setClass(tr, 'current', set.has(k)));
    },
  };
}

// ---------------------------------------------------------------------------
// Clickable bits

export interface BitRowOptions {
  bits: number;
  value?: number;
  /** Captions under each bit, MSB first (e.g. place values). */
  weights?: (number | string)[];
  label?: string;
  color?: 'red' | 'blue' | 'green' | 'yellow';
  readOnly?: boolean;
  /** Called with the new value after a click. */
  onChange?: (v: number) => void;
  title?: string;
}

/** A row of clickable bits (MSB on the left) with place values underneath. */
export class BitRow {
  readonly el: HTMLDivElement;
  value: number;
  private buttons: HTMLButtonElement[] = [];
  private caps: HTMLSpanElement[] = [];
  constructor(private opts: BitRowOptions) {
    this.value = opts.value ?? 0;
    const cells = Array.from({ length: opts.bits }, (_, i) => {
      const bit = opts.bits - 1 - i;
      const b = h('button', { type: 'button', 'aria-label': `bit ${bit}`, title: `bit ${bit}`, disabled: !!opts.readOnly }, '0');
      b.addEventListener('click', () => {
        if (this.opts.readOnly) return;
        this.set(this.value ^ (1 << bit));
        this.opts.onChange?.(this.value);
      });
      const cap = h('span', { class: 'dp-w' });
      this.buttons.push(b);
      this.caps.push(cap);
      return h('span', { class: `dp-bit ${i > 0 && bit % 4 === 3 ? 'gap' : ''}` }, b, cap);
    });
    this.el = h(
      'div',
      { class: `dp-bits ${opts.color ?? 'red'}`, title: opts.title },
      h('div', { class: 'dp-bits-row' }, opts.label ? h('span', { class: 'dp-bits-label' }, opts.label) : null, cells),
    );
    this.setWeights(opts.weights ?? null);
    this.render();
  }
  set(v: number) {
    this.value = v & ((1 << this.opts.bits) - 1);
    this.render();
  }
  setWeights(w: (number | string)[] | null) {
    this.caps.forEach((c, i) => {
      const s = w ? String(w[i]) : '';
      setText(c, s);
      setClass(c, 'neg', s.startsWith('-') || s.startsWith('−'));
      c.style.display = w ? '' : 'none';
    });
  }
  /** Add/remove a class on one bit's button (bit index, LSB = 0). */
  mark(bit: number, cls: 'flash' | 'bad' | 'neg', on: boolean) {
    const b = this.buttons[this.opts.bits - 1 - bit];
    if (b) setClass(b, cls, on);
  }
  clearMarks() {
    this.buttons.forEach((b) => b.classList.remove('flash', 'bad'));
  }
  setReadOnly(ro: boolean) {
    this.opts.readOnly = ro;
    this.buttons.forEach((b) => (b.disabled = ro));
  }
  private render() {
    this.buttons.forEach((b, i) => {
      const on = ((this.value >> (this.opts.bits - 1 - i)) & 1) === 1;
      setClass(b, 'on', on);
      setText(b, on ? '1' : '0');
      b.setAttribute('aria-label', `bit ${this.opts.bits - 1 - i}: ${on ? '1' : '0'}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Guided checklist

export interface CheckStep {
  title: string;
  detail?: string;
}

export class Checklist {
  readonly el: HTMLOListElement;
  readonly done: boolean[];
  private items: HTMLLIElement[];
  constructor(steps: CheckStep[]) {
    this.done = steps.map(() => false);
    this.items = steps.map((s) => h('li', null, h('span', null, s.title), s.detail ? h('span', { class: 'dp-check-detail' }, s.detail) : null));
    this.el = h('ol', { class: 'dp-check' }, this.items);
    this.render();
  }
  /** Index of the first step not done yet (or length when finished). */
  get current(): number {
    const i = this.done.indexOf(false);
    return i < 0 ? this.done.length : i;
  }
  get allDone(): boolean {
    return this.done.every(Boolean);
  }
  complete(i: number): boolean {
    if (this.done[i]) return false;
    this.done[i] = true;
    this.render();
    return true;
  }
  reset() {
    this.done.fill(false);
    this.render();
  }
  private render() {
    const cur = this.current;
    this.items.forEach((li, i) => {
      setClass(li, 'done', this.done[i]);
      setClass(li, 'current', i === cur);
    });
  }
}

// ---------------------------------------------------------------------------
// Whole-computer helpers

/**
 * Compact control-signal jumpers for a Machine in manual-control mode: only
 * the signals this chapter has wired up. Shows the active-low line level
 * underneath ("~AI = 0") because that's what the 74LS173/245 pins see.
 */
export function controlJumpers(machine: Machine, signals: Signal[]): { el: HTMLElement; update(): void; dispose(): void } {
  const d = new Disposer();
  const c = machine.computer;
  const lines: HTMLElement[] = [];
  const toggles: Toggle[] = [];
  const cells = signals.map((sig) => {
    const t = new Toggle({
      label: sig,
      title: `${sig}: ${SIGNAL_INFO[sig].description}`,
      value: ((c.manualControl ?? 0) & SIGNAL_BITS[sig]) !== 0,
      onChange: (v) => {
        const w = c.manualControl ?? 0;
        c.setManualControl(v ? w | SIGNAL_BITS[sig] : w & ~SIGNAL_BITS[sig]);
        machine.changed();
      },
    });
    toggles.push(t);
    const line = h('span', { class: 'dp-line' });
    lines.push(line);
    return h('span', { class: 'dp-jumper' }, t.el, line);
  });
  const update = () => {
    const w = c.manualControl ?? 0;
    signals.forEach((sig, i) => {
      const on = (w & SIGNAL_BITS[sig]) !== 0;
      toggles[i].set(on);
      const info = SIGNAL_INFO[sig];
      setText(lines[i], info.activeLowInHardware ? `~${sig} = ${on ? 0 : 1}` : `${sig} = ${on ? 1 : 0}`);
      setClass(lines[i], 'low', info.activeLowInHardware && on);
    });
  };
  d.add(machine.onChange(update));
  update();
  return { el: h('div', { class: 'dp-jumpers' }, cells), update, dispose: d.dispose };
}

/** Call `cb` after every rising clock edge of the machine (with the edge count since the last call). */
export function onRisingEdge(machine: Machine, cb: (transfers: Transfer[], edges: number) => void): () => void {
  let seen = machine.computer.risingEdges;
  return machine.onChange(() => {
    const c = machine.computer;
    if (c.risingEdges === seen) return;
    const n = c.risingEdges - seen;
    seen = c.risingEdges;
    cb(c.lastTransfers, n);
  });
}

// ---------------------------------------------------------------------------
// Gate-level helpers

/** Let time flow in a gate-level circuit (like the reference SR-latch lab). Returns the stop function. */
export function runCircuit(
  c: Circuit,
  o: { slow?: () => boolean; slowStepMs?: number; stepsPerSecond?: number; maxStepsPerFrame?: number; onStep?: () => void; onFrame?: () => void },
): () => void {
  let acc = 0;
  return animate((dt) => {
    acc += dt;
    const stepMs = o.slow?.() ? (o.slowStepMs ?? 350) : 1000 / (o.stepsPerSecond ?? 240);
    const max = o.maxStepsPerFrame ?? 8;
    let n = 0;
    while (acc >= stepMs && n < max) {
      acc -= stepMs;
      c.step();
      o.onStep?.();
      n++;
    }
    if (acc > stepMs * max) acc = 0;
    o.onFrame?.();
  });
}

/** Mirror a Schematic gate horizontally about its anchor so it points left. */
export function mirrorGate(g: GateHandle, at: P, scale = 1): GateHandle {
  g.el.setAttribute('transform', `translate(${at.x},${at.y}) scale(${-scale},${scale})`);
  const mx = (p: P): P => ({ x: 2 * at.x - p.x, y: p.y });
  return { el: g.el, inputs: g.inputs.map(mx), output: mx(g.output), enable: g.enable ? mx(g.enable) : undefined };
}

/** Format a byte as "0010 1010". */
export const bin8 = (v: number) => (v & 0xff).toString(2).padStart(8, '0').replace(/(.{4})/, '$1 ');
