import type { Level } from '../../logic/circuit';
import { Led, type LedColor } from '../../ui/components';
import { h, s, setClass, setText } from '../../ui/dom';
import type { Schematic } from '../../ui/schematic';

/**
 * Small UI helpers shared by the RAM, program-counter and output-display
 * labs (src/labs/ram, src/labs/pc, src/labs/output). No `.lab.ts` suffix, so
 * the registry ignores this file.
 */

/** Root class for every lab in this group (scopes the extra CSS below). */
export const MO_CLASS = 'mo-lab';

const MO_CSS = `
.mo-lab .schematic .chip .pin-label { fill: #c3cad8; }
.mo-lab .schematic .chip .chip-label { fill: #fff; }
.mo-lab .schematic .chip .chip-sublabel { fill: #aeb6c5; }
.mo-lab .schematic .sch-text.val { font-size: 11px; fill: var(--accent-2); }
.mo-lab .schematic .sch-text.cap { fill: var(--fg-dim); }
.mo-lab .mo-bus { fill: none; stroke: var(--fg-faint); stroke-width: 6; stroke-linejoin: round; stroke-linecap: round; opacity: 0.5; transition: stroke 0.1s, opacity 0.1s; }
.mo-lab .mo-bus.active { stroke: var(--accent-2); opacity: 0.95; }
.mo-lab .mo-bus.off { stroke-dasharray: 7 6; opacity: 0.3; }
.mo-lab .mo-bus.bad { stroke: var(--wire-x); opacity: 0.95; }
.mo-lab .table-scroll { overflow-x: auto; max-width: 100%; }
.mo-lab .select { max-width: 100%; min-width: 0; flex-wrap: wrap; }
.mo-lab .select select { max-width: 100%; min-width: 0; }
.mo-lab .panel-body > * { min-width: 0; max-width: 100%; }
.mo-lab .truth-table td.sel, .mo-lab .truth-table th.sel { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.mo-lab .truth-table td.on { color: var(--led-red); font-weight: 700; }
.mo-lab .truth-table td.bad { background: color-mix(in srgb, var(--danger) 25%, transparent); }
.mo-lab .truth-table.compact th, .mo-lab .truth-table.compact td { padding: 2px 6px; font-size: 0.78rem; }
.mo-lab .mo-steps { margin: 4px 0; padding-left: 22px; font-size: 0.88rem; display: flex; flex-direction: column; gap: 3px; }
.mo-lab .mo-steps li { color: var(--fg-dim); }
.mo-lab .mo-steps li.done { color: var(--ok); }
.mo-lab .mo-steps li.done::marker { content: '✓  '; }
.mo-lab .mo-steps li.current { color: var(--fg); font-weight: 600; }
.mo-lab .mo-badge { display: inline-block; font-family: var(--mono); font-size: 0.75rem; padding: 1px 7px; border-radius: 6px; border: 1px solid var(--border); color: var(--fg-dim); }
.mo-lab .mo-badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 50%, var(--border)); }
.mo-lab .mo-badge.warn { color: var(--accent-2); border-color: color-mix(in srgb, var(--accent-2) 50%, var(--border)); }
.mo-lab .mo-badge.bad { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 50%, var(--border)); }
.mo-lab .mo-badge.on { color: white; background: var(--led-blue); border-color: var(--led-blue); }
.mo-lab .mo-big { font-family: var(--mono); font-size: 1.15rem; }
.mo-lab .mo-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mo-lab .mo-label { color: var(--fg-dim); font-size: 0.8rem; min-width: 64px; }
.mo-lab .mo-mode-leds { display: inline-flex; gap: 10px; align-items: center; }
.mo-lab .scope-wrap { position: relative; }
.mo-lab .scope-cursor { position: absolute; top: 6px; bottom: 6px; width: 2px; background: var(--accent-2); opacity: 0.85; pointer-events: none; }
@media (prefers-color-scheme: light) {
  .mo-lab .schematic .sch-text.val { fill: #b45309; }
  .mo-lab .mo-bus.active { stroke: #d97706; }
  .mo-lab .mo-steps li.done, .mo-lab .mo-badge.ok { color: #15803d; }
  .mo-lab .mo-badge.warn { color: #b45309; }
  .mo-lab .mo-badge.bad { color: #b91c1c; }
  .mo-lab .truth-table td.on { color: #c81e1e; }
}
`;

/** Inject the group CSS (and optional lab CSS) into `root`. Returns a remover. */
export function scopedStyle(root: HTMLElement, extra = ''): () => void {
  root.classList.add(MO_CLASS);
  const st = h('style', null, MO_CSS + extra);
  root.prepend(st);
  return () => {
    st.remove();
    root.classList.remove(MO_CLASS);
  };
}

export function ledCell(led: Led, caption: string): HTMLElement {
  return h('span', { class: 'led-cell' }, led.el, h('span', { class: 'led-caption' }, caption));
}

/** A row of individually addressable LEDs with captions (MSB/leftmost first). */
export function ledRow(captions: string[], color: LedColor | LedColor[]): { el: HTMLElement; leds: Led[]; set(levels: (Level | boolean)[]): void; setValue(v: number): void } {
  const colors = Array.isArray(color) ? color : captions.map(() => color);
  const leds = captions.map((c, i) => new Led(colors[i], c));
  const el = h('span', { class: 'ledbar-leds' }, leds.map((l, i) => ledCell(l, captions[i])));
  return {
    el,
    leds,
    set: (levels) => levels.forEach((l, i) => leds[i]?.set(l)),
    setValue: (v) => leds.forEach((l, i) => l.set(((v >> (leds.length - 1 - i)) & 1) === 1)),
  };
}

export interface Table {
  el: HTMLElement;
  table: HTMLTableElement;
  rows: HTMLTableRowElement[];
  cells: HTMLTableCellElement[][];
  head: HTMLTableCellElement[];
  highlight(i: number): void;
}

/** A `.truth-table` (wrapped in a horizontal scroller) whose rows can be highlighted. */
export function makeTable(headers: (string | Node)[], rows: (string | number | Node)[][], opts: { class?: string; caption?: string } = {}): Table {
  const head = headers.map((x) => h('th', null, x));
  const cells: HTMLTableCellElement[][] = [];
  const trs = rows.map((r) => {
    const tds = r.map((x) => h('td', null, typeof x === 'number' ? String(x) : x));
    cells.push(tds);
    return h('tr', null, tds);
  });
  const table = h('table', { class: `truth-table ${opts.class ?? ''}` }, opts.caption ? h('caption', { class: 'dim small' }, opts.caption) : null, h('thead', null, h('tr', null, head)), h('tbody', null, trs));
  let cur = -1;
  return {
    el: h('div', { class: 'table-scroll' }, table),
    table,
    rows: trs,
    cells,
    head,
    highlight(i: number) {
      if (i === cur) return;
      cur = i;
      trs.forEach((tr, k) => setClass(tr, 'current', k === i));
    },
  };
}

/** An ordered checklist: completed steps get a tick, the current one is bold. */
export function stepList(items: (string | Node)[]): { el: HTMLOListElement; set(done: boolean[], current: number): void } {
  const lis = items.map((x) => h('li', null, x));
  return {
    el: h('ol', { class: 'mo-steps' }, lis),
    set(done, current) {
      lis.forEach((li, i) => {
        setClass(li, 'done', !!done[i]);
        setClass(li, 'current', i === current);
      });
    },
  };
}

/** A thick multi-bit "bus" line in a schematic (drawn under the parts). Toggle classes `active` / `off` / `bad`. */
export function busLine(sch: Schematic, pts: readonly (readonly [number, number])[]): SVGPolylineElement {
  const pl = s('polyline', { points: pts.map((p) => `${p[0]},${p[1]}`).join(' '), class: 'mo-bus' });
  sch.el.insertBefore(pl, sch.el.firstChild);
  return pl;
}

export function setBusState(pl: SVGPolylineElement, state: 'active' | 'idle' | 'off' | 'bad') {
  setClass(pl, 'active', state === 'active');
  setClass(pl, 'off', state === 'off');
  setClass(pl, 'bad', state === 'bad');
}

/** Live text in a schematic (value labels next to bus lines). */
export function liveText(sch: Schematic, at: readonly [number, number], opts: { anchor?: 'start' | 'middle' | 'end'; size?: number; class?: string } = {}) {
  const t = sch.text('', at, { anchor: opts.anchor ?? 'start', class: opts.class ?? 'val', size: opts.size ?? 11 });
  return (str: string) => setText(t, str);
}

export function badge(text = '', kind: '' | 'ok' | 'warn' | 'bad' | 'on' = ''): { el: HTMLSpanElement; set(text: string, kind?: '' | 'ok' | 'warn' | 'bad' | 'on'): void } {
  const el = h('span', { class: `mo-badge ${kind}` }, text);
  return {
    el,
    set(t, k = '') {
      setText(el, t);
      el.className = `mo-badge ${k}`;
    },
  };
}

const HEXDUMP_CSS = `
.mo-lab .hexdump { border-collapse: collapse; font-family: var(--mono); font-size: 0.72rem; }
.mo-lab .hexdump th { color: var(--fg-faint); font-weight: 500; padding: 1px 3px; }
.mo-lab .hexdump td { padding: 1px 3px; color: var(--fg-dim); }
.mo-lab .hexdump td.set { color: var(--fg); }
.mo-lab .hexdump td.cur { background: var(--accent-2); color: #111; border-radius: 3px; }
.mo-lab .hexdump td.flash { background: color-mix(in srgb, var(--led-red) 40%, transparent); }
`;

/** A 16 × 16 hex dump of one 256-byte page. `set` marks bytes that differ from `blank`. */
export function makeHexDump(blank = 0xff): { el: HTMLElement; css: string; update(mem: ArrayLike<number>, base: number, cur?: number, flash?: number): void } {
  const body = h('tbody');
  const cells: HTMLTableCellElement[] = [];
  const heads: HTMLTableCellElement[] = [];
  for (let r = 0; r < 16; r++) {
    const th = h('th', null, '');
    heads.push(th);
    const tds = Array.from({ length: 16 }, () => h('td', null, ''));
    cells.push(...tds);
    body.appendChild(h('tr', null, th, tds));
  }
  const table = h('table', { class: 'hexdump' }, h('thead', null, h('tr', null, h('th'), Array.from({ length: 16 }, (_, i) => h('th', null, i.toString(16))))), body);
  return {
    el: h('div', { class: 'table-scroll' }, table),
    css: HEXDUMP_CSS,
    update(mem, base, cur = -1, flash = -1) {
      heads.forEach((th, r) => setText(th, (base + r * 16).toString(16).padStart(3, '0')));
      cells.forEach((td, i) => {
        const a = base + i;
        const v = mem[a] ?? 0;
        setText(td, v.toString(16).padStart(2, '0'));
        setClass(td, 'set', v !== blank);
        setClass(td, 'cur', a === cur);
        setClass(td, 'flash', a === flash);
      });
    },
  };
}

/** Bits of `v` as levels, MSB first. */
export const bitsMsbFirst = (v: number, n: number): (0 | 1)[] => Array.from({ length: n }, (_, i) => ((v >> (n - 1 - i)) & 1) as 0 | 1);
