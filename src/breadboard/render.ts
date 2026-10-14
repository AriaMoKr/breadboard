import { s } from '../ui/dom';
import './breadboard.css';
import { CHIPS, prettyPin } from './catalog';
import {
  BOARD_H, BOARD_W, COLUMNS, RAIL_COLUMNS, ROWS, ROW_Y, colX, dipRows, holeXY, isRail, parseHole, toScene,
  type BoardPlacement, type RowOrRail,
} from './geometry';
import { layoutBounds, partPins, type BoardSpec, type Layout, type LedColor, type Part, type WireColor } from './layout';

/**
 * SVG rendering of breadboard layouts. Everything is drawn in pitch units
 * (0.1"), boards stay white in both colour schemes like the real thing.
 * Interactive parts (buttons, switches, DIP switches, pots) report pointer
 * events through `onEvent`; live state is pushed in with the set* methods.
 */

export type PartEvent =
  | { type: 'press' }
  | { type: 'release' }
  | { type: 'toggle' } // slide switch clicked
  | { type: 'dip'; bit: number } // DIP switch k (bit k-1) clicked
  | { type: 'pot'; value: number } // pot dragged to 0..1
  | { type: 'click' }; // any other part clicked

export interface LayoutViewOptions {
  onEvent?: (partId: string, ev: PartEvent) => void;
  /** Extra margin around the boards (pitch units). */
  padding?: number;
  className?: string;
  /** Show row letters / column numbers (default true). */
  labels?: boolean;
}

export const WIRE_COLORS: Record<WireColor, string> = {
  red: '#d9261c', black: '#26262a', blue: '#2563d4', yellow: '#e8c516', green: '#24a148',
  white: '#f4f4f2', orange: '#f07d18', purple: '#8146c9', gray: '#8c8c8c', brown: '#7d4a22',
};

export const LED_COLORS: Record<LedColor, string> = {
  red: '#ff2a1a', green: '#2bff6a', yellow: '#ffd31a', blue: '#3b8cff', white: '#ffffff', orange: '#ff8a1f',
};

const BAND = ['#000000', '#7b3f00', '#d9261c', '#f07d18', '#f2d21b', '#1f9d3a', '#2563d4', '#7d3fc2', '#808080', '#ffffff'];

/** Colour bands (4-band code) for a resistor value. */
export function resistorBands(ohms: number): string[] {
  if (!(ohms > 0)) return [BAND[0], BAND[0], BAND[0], '#c9a23a'];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let sig = Math.round(ohms / 10 ** exp);
  if (sig >= 100) { sig = Math.round(sig / 10); exp++; }
  const d1 = Math.floor(sig / 10) % 10, d2 = sig % 10;
  const mult = exp >= 0 && exp <= 9 ? BAND[exp] : exp === -1 ? '#c9a23a' : '#c0c0c0';
  return [BAND[d1], BAND[d2], mult, '#c9a23a'];
}

export function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${+(ohms / 1e6).toPrecision(3)}MΩ`;
  if (ohms >= 1e3) return `${+(ohms / 1e3).toPrecision(3)}kΩ`;
  return `${ohms}Ω`;
}

export function formatFarads(f: number): string {
  if (f >= 1e-6) return `${+(f * 1e6).toPrecision(3)}µF`;
  if (f >= 1e-9) return `${+(f * 1e9).toPrecision(3)}nF`;
  return `${+(f * 1e12).toPrecision(3)}pF`;
}

let instance = 0;

interface Handle {
  part: Part;
  el: SVGGElement;
  set?: (v: unknown) => void;
}

export class LayoutView {
  readonly el: SVGSVGElement;
  readonly bounds: { x: number; y: number; w: number; h: number };
  private handles = new Map<string, Handle>();
  private boardsById = new Map<string, BoardSpec>();
  private uid = ++instance;
  private layerBoards: SVGGElement;
  private layerWires: SVGGElement;
  private layerParts: SVGGElement;
  private layerTop: SVGGElement;
  readonly layerOverlay: SVGGElement;

  constructor(
    readonly layout: Layout,
    private opts: LayoutViewOptions = {},
  ) {
    const pad = opts.padding ?? 3;
    const b = layoutBounds(layout);
    this.bounds = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    this.layerBoards = s('g', { class: 'bb-boards' });
    this.layerWires = s('g', { class: 'bb-wires' });
    this.layerParts = s('g', { class: 'bb-parts' });
    this.layerTop = s('g', { class: 'bb-top' });
    this.layerOverlay = s('g', { class: 'bb-overlay' });
    this.el = s(
      'svg',
      {
        class: `bb-svg ${opts.className ?? ''}`,
        viewBox: `${this.bounds.x} ${this.bounds.y} ${this.bounds.w} ${this.bounds.h}`,
        role: 'img',
        'aria-label': 'Breadboard',
      },
      this.defs(),
      this.layerBoards,
      this.layerWires,
      this.layerParts,
      this.layerTop,
      this.layerOverlay,
    );
    for (const board of layout.boards) {
      this.boardsById.set(board.id, board);
      this.layerBoards.appendChild(this.drawBoard(board));
    }
    for (const part of layout.parts) this.drawPart(part);
  }

  // ---- public API -------------------------------------------------------------

  setLed(id: string, on: boolean) {
    this.handles.get(id)?.set?.(on);
  }
  setSeg7(id: string, byte: number) {
    this.handles.get(id)?.set?.(byte);
  }
  setSlide(id: string, pos: 0 | 1) {
    this.handles.get(id)?.set?.(pos);
  }
  setDip(id: string, value: number) {
    this.handles.get(id)?.set?.(value);
  }
  setButton(id: string, pressed: boolean) {
    this.handles.get(id)?.set?.(pressed);
  }
  setPot(id: string, t: number) {
    this.handles.get(id)?.set?.(t);
  }
  partElement(id: string): SVGGElement | undefined {
    return this.handles.get(id)?.el;
  }
  boardOf(id: string): BoardSpec | undefined {
    return this.boardsById.get(id);
  }

  /** Scene position of a hole on a board. */
  holeScene(board: string, hole: string): { x: number; y: number } {
    const b = this.boardsById.get(board);
    if (!b) throw new Error(`Unknown board ${board}`);
    return toScene(b.place, holeXY(hole));
  }

  /** Scene coordinates of a pointer event. */
  scenePoint(clientX: number, clientY: number): { x: number; y: number } {
    const pt = this.el.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = this.el.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  /** The hole nearest to a scene point (within `maxDist` pitch units), if any. */
  holeAt(p: { x: number; y: number }, maxDist = 0.55): { board: string; hole: string } | null {
    for (const b of this.layout.boards) {
      const local = sceneToLocal(b.place, p);
      if (local.x < 0 || local.y < 0 || local.x > BOARD_W || local.y > BOARD_H) continue;
      const col = Math.round(local.x - 1.5) + 1;
      let best: { row: RowOrRail; d: number } | null = null;
      for (const [row, y] of Object.entries(ROW_Y) as [RowOrRail, number][]) {
        const d = Math.abs(local.y - y);
        if (!best || d < best.d) best = { row, d };
      }
      if (!best) continue;
      const hx = colX(col), hy = ROW_Y[best.row];
      if (Math.hypot(local.x - hx, local.y - hy) > maxDist) return null;
      if (col < 1 || col > COLUMNS) return null;
      if (isRail(best.row) && !RAIL_COLUMNS.includes(col)) return null;
      return { board: b.id, hole: `${best.row}${col}` };
    }
    return null;
  }

  // ---- drawing --------------------------------------------------------------------

  private defs(): SVGDefsElement {
    const id = (n: string) => `${n}-${this.uid}`;
    const hole = (pid: string, y: number) =>
      s('pattern', { id: id(pid), width: 1, height: 1, patternUnits: 'userSpaceOnUse', x: 0, y }, s('rect', { x: 0.31, y: 0.31, width: 0.38, height: 0.38, rx: 0.06, class: 'bb-hole' }));
    return s(
      'defs',
      null,
      hole('bb-holes', 0),
      hole('bb-holes-rt', 0.4),
      hole('bb-holes-rb', 0.6),
      s('filter', { id: id('bb-glow'), x: '-150%', y: '-150%', width: '400%', height: '400%' }, s('feGaussianBlur', { stdDeviation: 0.35 })),
    );
  }

  private ref(n: string) {
    return `url(#${n}-${this.uid})`;
  }

  private boardTransform(p: BoardPlacement) {
    return p.rotate === 90 ? `translate(${p.x + BOARD_H} ${p.y}) rotate(90)` : `translate(${p.x} ${p.y})`;
  }

  private drawBoard(b: BoardSpec): SVGGElement {
    const g = s('g', { class: `bb-board ${b.rails === 'signal' ? 'signal-rails' : ''}`, transform: this.boardTransform(b.place), 'data-board': b.id });
    g.appendChild(s('rect', { x: 0, y: 0, width: BOARD_W, height: BOARD_H, rx: 0.45, class: 'bb-body' }));
    g.appendChild(s('rect', { x: 0.7, y: 8.62, width: BOARD_W - 1.4, height: 0.76, rx: 0.2, class: 'bb-channel' }));
    // rail stripes
    g.appendChild(s('line', { x1: 2, x2: BOARD_W - 2, y1: 0.28, y2: 0.28, class: 'bb-stripe-n' }));
    g.appendChild(s('line', { x1: 2, x2: BOARD_W - 2, y1: 2.55, y2: 2.55, class: 'bb-stripe-p' }));
    g.appendChild(s('line', { x1: 2, x2: BOARD_W - 2, y1: 15.45, y2: 15.45, class: 'bb-stripe-p' }));
    g.appendChild(s('line', { x1: 2, x2: BOARD_W - 2, y1: 17.72, y2: 17.72, class: 'bb-stripe-n' }));
    // terminal holes
    g.appendChild(s('rect', { x: 1, y: 3, width: COLUMNS, height: 5, fill: this.ref('bb-holes') }));
    g.appendChild(s('rect', { x: 1, y: 10, width: COLUMNS, height: 5, fill: this.ref('bb-holes') }));
    // rail holes in groups of five
    for (let grp = 0; grp < 10; grp++) {
      const x = colX(RAIL_COLUMNS[grp * 5]) - 0.5;
      g.appendChild(s('rect', { x, y: 0.4, width: 5, height: 2, fill: this.ref('bb-holes-rt') }));
      g.appendChild(s('rect', { x, y: 15.6, width: 5, height: 2, fill: this.ref('bb-holes-rb') }));
    }
    if (this.opts.labels !== false) {
      const labels = s('g', { class: 'bb-labels' });
      for (const c of [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]) {
        labels.appendChild(s('text', { x: colX(c), y: 2.98, 'text-anchor': 'middle' }, String(c)));
        labels.appendChild(s('text', { x: colX(c), y: 15.32, 'text-anchor': 'middle' }, String(c)));
      }
      ROWS.forEach((r) => {
        labels.appendChild(s('text', { x: 0.5, y: ROW_Y[r] + 0.2, 'text-anchor': 'middle' }, r));
        labels.appendChild(s('text', { x: BOARD_W - 0.5, y: ROW_Y[r] + 0.2, 'text-anchor': 'middle' }, r));
      });
      g.appendChild(labels);
    }
    if (b.title) g.appendChild(s('text', { x: 0.3, y: -0.55, class: 'bb-title' }, b.title));
    return g;
  }

  private boardGroup(part: Part, layer: SVGGElement, cls: string): SVGGElement {
    const b = this.boardsById.get(part.board);
    const g = s('g', { class: `bb-part ${cls}`, 'data-part': part.id, transform: b ? this.boardTransform(b.place) : undefined });
    layer.appendChild(g);
    return g;
  }

  private emit(id: string, ev: PartEvent) {
    this.opts.onEvent?.(id, ev);
  }

  private drawPart(part: Part) {
    switch (part.kind) {
      case 'chip': return this.drawChip(part);
      case 'wire': return this.drawWire(part);
      case 'led': return this.drawLed(part);
      case 'resistor': return this.drawResistor(part);
      case 'capacitor': return this.drawCapacitor(part);
      case 'dip': return this.drawDip(part);
      case 'button': return this.drawButton(part);
      case 'slide': return this.drawSlide(part);
      case 'pot': return this.drawPot(part);
      case 'seg7': return this.drawSeg7(part);
      case 'port': return this.drawPort(part);
      case 'text': {
        const g = this.boardGroup(part, this.layerTop, 'bb-text');
        g.appendChild(s('text', { x: part.x, y: part.y, 'font-size': part.size ?? 1.1, class: 'bb-silk' }, part.text));
        this.handles.set(part.id, { part, el: g });
        return;
      }
    }
  }

  private drawChip(part: Extract<Part, { kind: 'chip' }>) {
    const def = CHIPS[part.chip];
    const g = this.boardGroup(part, this.layerParts, 'bb-chip');
    const n = def.pins.length / 2;
    const [top, bottom] = dipRows(def.spacing);
    const c0 = part.rotated ? part.col - n + 1 : part.col;
    const x0 = colX(c0) - 0.47, x1 = colX(c0 + n - 1) + 0.47;
    const y0 = ROW_Y[top] + 0.22, y1 = ROW_Y[bottom] - 0.22;
    // legs
    for (const pin of partPins(part)) {
      const { x, y } = holeXY(pin.hole);
      const isTop = parseHole(pin.hole).row === top;
      const leg = s('rect', { x: x - 0.22, y: isTop ? y - 0.12 : y1 - 0.05, width: 0.44, height: isTop ? y0 - y + 0.17 : y - y1 + 0.17, class: 'bb-leg' });
      leg.appendChild(s('title', null, `${part.label ?? part.id} pin ${pin.number}: ${prettyPin(pin.name)}`));
      g.appendChild(leg);
    }
    g.appendChild(s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 0.18, class: 'bb-chip-body' }));
    const notchX = part.rotated ? x1 : x0;
    const mid = (y0 + y1) / 2;
    g.appendChild(s('path', { d: part.rotated ? `M ${notchX} ${mid - 0.38} A 0.38 0.38 0 0 0 ${notchX} ${mid + 0.38}` : `M ${notchX} ${mid - 0.38} A 0.38 0.38 0 0 1 ${notchX} ${mid + 0.38}`, class: 'bb-notch' }));
    const p1 = holeXY(partPins(part)[0].hole);
    g.appendChild(s('circle', { cx: p1.x + (part.rotated ? -0.05 : 0.05), cy: part.rotated ? y0 + 0.35 : y1 - 0.35, r: 0.14, class: 'bb-pin1' }));
    const big = def.spacing === 6 ? 0.95 : 0.78;
    g.appendChild(s('text', { x: (x0 + x1) / 2, y: mid + (part.label ? 0.42 : 0.3), 'text-anchor': 'middle', 'font-size': big, class: 'bb-chip-text' }, part.chip));
    if (part.label) g.appendChild(s('text', { x: (x0 + x1) / 2, y: mid - 0.45, 'text-anchor': 'middle', 'font-size': 0.6, class: 'bb-chip-ref' }, part.label));
    g.appendChild(s('title', null, `${part.label ?? part.id}: ${def.id} — ${def.title}`));
    this.handles.set(part.id, { part, el: g });
  }

  private wirePath(part: Extract<Part, { kind: 'wire' }>): string {
    const a = holeXY(part.a), b = holeXY(part.b);
    const pts = [a, ...(part.via ?? []).map(([x, y]) => ({ x, y })), b];
    return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  }

  private drawWire(part: Extract<Part, { kind: 'wire' }>) {
    const g = this.boardGroup(part, this.layerWires, `bb-wire wire-${part.color}`);
    const d = this.wirePath(part);
    g.appendChild(s('path', { d, class: 'bb-wire-outline' }));
    g.appendChild(s('path', { d, class: 'bb-wire-core', stroke: WIRE_COLORS[part.color] }));
    for (const h of [part.a, part.b]) {
      const { x, y } = holeXY(h);
      g.appendChild(s('circle', { cx: x, cy: y, r: 0.13, class: 'bb-wire-end' }));
    }
    this.handles.set(part.id, { part, el: g });
  }

  private drawLed(part: Extract<Part, { kind: 'led' }>) {
    const g = this.boardGroup(part, this.layerParts, `bb-led led-${part.color}`);
    const a = holeXY(part.anode), k = holeXY(part.cathode);
    const dist = Math.hypot(k.x - a.x, k.y - a.y);
    // body sits near the anode for long spans (legs bent), centred for short ones
    const t = dist > 2.2 ? Math.min(0.5, 0.9 / dist) : 0.5;
    const c = { x: a.x + (k.x - a.x) * t, y: a.y + (k.y - a.y) * t };
    g.appendChild(s('line', { x1: a.x, y1: a.y, x2: c.x, y2: c.y, class: 'bb-lead' }));
    g.appendChild(s('line', { x1: k.x, y1: k.y, x2: c.x, y2: c.y, class: 'bb-lead' }));
    const color = LED_COLORS[part.color];
    const glow = s('circle', { cx: c.x, cy: c.y, r: 0.75, fill: color, class: 'bb-led-glow', filter: this.ref('bb-glow') });
    const dome = s('circle', { cx: c.x, cy: c.y, r: 0.42, class: 'bb-led-dome', fill: color });
    g.append(glow, dome, s('circle', { cx: c.x - 0.13, cy: c.y - 0.13, r: 0.12, class: 'bb-led-shine' }));
    g.appendChild(s('title', null, `${part.label ?? part.id} (${part.color} LED)`));
    let on = false;
    this.handles.set(part.id, {
      part,
      el: g,
      set: (v) => {
        const nv = !!v;
        if (nv !== on) {
          on = nv;
          g.classList.toggle('on', on);
        }
      },
    });
  }

  private axialGroup(part: Part & { a: string; b: string }, cls: string, layer = this.layerParts) {
    const g = this.boardGroup(part, layer, cls);
    const a = holeXY(part.a), b = holeXY(part.b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    g.appendChild(s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'bb-lead' }));
    const body = s('g', { transform: `translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) rotate(${ang})` });
    g.appendChild(body);
    return { g, body, len };
  }

  private drawResistor(part: Extract<Part, { kind: 'resistor' }>) {
    const { g, body, len } = this.axialGroup(part, 'bb-resistor');
    const L = Math.max(1.2, Math.min(2.6, len - 0.7));
    body.appendChild(s('rect', { x: -L / 2, y: -0.27, width: L, height: 0.54, rx: 0.22, class: 'bb-res-body' }));
    resistorBands(part.ohms).forEach((col, i) => {
      const x = -L / 2 + L * (0.2 + i * 0.17 + (i === 3 ? 0.1 : 0));
      body.appendChild(s('rect', { x, y: -0.27, width: L * 0.08, height: 0.54, fill: col }));
    });
    g.appendChild(s('title', null, `${part.label ?? part.id}: ${formatOhms(part.ohms)} resistor`));
    this.handles.set(part.id, { part, el: g });
  }

  private drawCapacitor(part: Extract<Part, { kind: 'capacitor' }>) {
    const { g, body } = this.axialGroup(part, 'bb-capacitor');
    if (part.polarized) {
      body.appendChild(s('circle', { cx: 0, cy: 0, r: 0.65, class: 'bb-cap-elec' }));
      body.appendChild(s('path', { d: 'M 0.25 -0.6 A 0.65 0.65 0 0 1 0.25 0.6', class: 'bb-cap-stripe' }));
    } else {
      body.appendChild(s('ellipse', { cx: 0, cy: 0, rx: 0.42, ry: 0.55, class: part.farads >= 1e-7 ? 'bb-cap-ceramic big' : 'bb-cap-ceramic' }));
    }
    g.appendChild(s('title', null, `${part.label ?? part.id}: ${formatFarads(part.farads)} capacitor`));
    this.handles.set(part.id, { part, el: g });
  }

  private drawDip(part: Extract<Part, { kind: 'dip' }>) {
    const g = this.boardGroup(part, this.layerParts, 'bb-dip interactive');
    const x0 = colX(part.col) - 0.48, x1 = colX(part.col + part.positions - 1) + 0.48;
    const y0 = ROW_Y.e - 0.2, y1 = ROW_Y.f + 0.2;
    g.appendChild(s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 0.15, class: 'bb-dip-body' }));
    g.appendChild(s('text', { x: x0 + 0.15, y: y0 + 0.62, 'font-size': 0.5, class: 'bb-dip-on' }, 'ON'));
    const knobs: SVGRectElement[] = [];
    for (let k = 1; k <= part.positions; k++) {
      const x = colX(part.col + k - 1);
      const slot = s('rect', { x: x - 0.25, y: y0 + 0.75, width: 0.5, height: y1 - y0 - 1.5, rx: 0.06, class: 'bb-dip-slot' });
      const knob = s('rect', { x: x - 0.22, y: y0 + 0.8, width: 0.44, height: 0.7, rx: 0.06, class: 'bb-dip-knob' });
      const hit = s('rect', { x: x - 0.5, y: y0, width: 1, height: y1 - y0, class: 'bb-hit' });
      hit.appendChild(s('title', null, `${part.label ?? part.id} switch ${k}`));
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit(part.id, { type: 'dip', bit: k - 1 });
      });
      g.append(slot, knob, hit);
      knobs.push(knob);
      g.appendChild(s('text', { x, y: y1 - 0.12, 'text-anchor': 'middle', 'font-size': 0.42, class: 'bb-dip-num' }, String(k)));
    }
    let value = -1;
    const set = (v: unknown) => {
      const nv = Number(v) | 0;
      if (nv === value) return;
      value = nv;
      knobs.forEach((knob, i) => knob.setAttribute('y', String(((nv >> i) & 1 ? y0 + 0.8 : y1 - 1.5))));
    };
    set(0);
    this.handles.set(part.id, { part, el: g, set });
  }

  private drawButton(part: Extract<Part, { kind: 'button' }>) {
    const { g, body } = this.axialGroup(part, 'bb-button interactive');
    body.appendChild(s('rect', { x: -0.85, y: -0.85, width: 1.7, height: 1.7, rx: 0.12, class: 'bb-btn-body' }));
    const cap = s('circle', { cx: 0, cy: 0, r: 0.55, class: 'bb-btn-cap' });
    body.appendChild(cap);
    const hit = s('circle', { cx: 0, cy: 0, r: 1, class: 'bb-hit' });
    hit.appendChild(s('title', null, `${part.label ?? part.id} (push button)`));
    body.appendChild(hit);
    let down = false;
    const press = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (down) return;
      down = true;
      g.classList.add('pressed');
      this.emit(part.id, { type: 'press' });
    };
    const release = () => {
      if (!down) return;
      down = false;
      g.classList.remove('pressed');
      this.emit(part.id, { type: 'release' });
    };
    hit.addEventListener('pointerdown', press);
    hit.addEventListener('pointerup', release);
    hit.addEventListener('pointerleave', release);
    this.handles.set(part.id, { part, el: g, set: (v) => g.classList.toggle('pressed', !!v) });
  }

  private drawSlide(part: Extract<Part, { kind: 'slide' }>) {
    const g = this.boardGroup(part, this.layerParts, 'bb-slide interactive');
    const pa = holeXY(part.a), pc = holeXY(part.common), pb = holeXY(part.b);
    for (const p of [pa, pc, pb]) g.appendChild(s('line', { x1: p.x, y1: p.y, x2: pc.x, y2: pc.y, class: 'bb-lead' }));
    const ang = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
    const len = Math.max(2.4, Math.hypot(pb.x - pa.x, pb.y - pa.y) + 0.9);
    const body = s('g', { transform: `translate(${pc.x} ${pc.y}) rotate(${ang})` });
    body.appendChild(s('rect', { x: -len / 2, y: -0.55, width: len, height: 1.1, rx: 0.15, class: 'bb-slide-body' }));
    const knob = s('rect', { x: -len / 2 + 0.2, y: -0.35, width: len / 2 - 0.2, height: 0.7, rx: 0.1, class: 'bb-slide-knob' });
    body.appendChild(knob);
    const hit = s('rect', { x: -len / 2, y: -0.8, width: len, height: 1.6, class: 'bb-hit' });
    hit.appendChild(s('title', null, `${part.label ?? part.id} (switch)`));
    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.emit(part.id, { type: 'toggle' });
    });
    body.appendChild(hit);
    g.appendChild(body);
    const set = (v: unknown) => knob.setAttribute('x', String(v ? 0 : -len / 2 + 0.2));
    set(part.initial ?? 0);
    this.handles.set(part.id, { part, el: g, set });
  }

  private drawPot(part: Extract<Part, { kind: 'pot' }>) {
    const g = this.boardGroup(part, this.layerParts, 'bb-pot interactive');
    const pins = [holeXY(part.a), holeXY(part.wiper), holeXY(part.b)];
    const cx = pins.reduce((a, p) => a + p.x, 0) / 3, cy = pins.reduce((a, p) => a + p.y, 0) / 3;
    for (const p of pins) g.appendChild(s('line', { x1: p.x, y1: p.y, x2: cx, y2: cy, class: 'bb-lead' }));
    g.appendChild(s('rect', { x: cx - 1.1, y: cy - 1.1, width: 2.2, height: 2.2, rx: 0.2, class: 'bb-pot-body' }));
    g.appendChild(s('circle', { cx, cy, r: 0.8, class: 'bb-pot-rotor' }));
    const slot = s('line', { x1: cx, y1: cy - 0.7, x2: cx, y2: cy + 0.7, class: 'bb-pot-slot' });
    g.appendChild(slot);
    const hit = s('circle', { cx, cy, r: 1.3, class: 'bb-hit' });
    hit.appendChild(s('title', null, `${part.label ?? part.id}: ${formatOhms(part.ohms)} potentiometer (drag to turn)`));
    g.appendChild(hit);
    let t = 0.5;
    const set = (v: unknown) => {
      t = Math.max(0, Math.min(1, Number(v)));
      slot.setAttribute('transform', `rotate(${-135 + 270 * t} ${cx} ${cy})`);
    };
    let drag: { y: number; t: number } | null = null;
    hit.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      drag = { y: e.clientY, t };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    });
    hit.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const nt = Math.max(0, Math.min(1, drag.t + (drag.y - e.clientY) / 150));
      set(nt);
      this.emit(part.id, { type: 'pot', value: nt });
    });
    hit.addEventListener('pointerup', () => (drag = null));
    set(t);
    this.handles.set(part.id, { part, el: g, set });
  }

  private drawSeg7(part: Extract<Part, { kind: 'seg7' }>) {
    const g = this.boardGroup(part, this.layerParts, 'bb-seg7');
    const [top, bottom] = dipRows(6);
    for (const pin of partPins(part)) {
      const { x, y } = holeXY(pin.hole);
      const leg = s('rect', { x: x - 0.2, y: y - 0.2, width: 0.4, height: 0.4, class: 'bb-leg' });
      leg.appendChild(s('title', null, `${part.label ?? part.id} pin ${pin.number}: ${pin.name}`));
      g.appendChild(leg);
    }
    const x0 = colX(part.col) - 0.48, x1 = colX(part.col + 4) + 0.48;
    const y0 = ROW_Y[top] - 0.45, y1 = ROW_Y[bottom] + 0.45;
    g.appendChild(s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 0.15, class: 'bb-seg7-body' }));
    // segments in a 3 × 5 box
    const cx = (x0 + x1) / 2 - 0.15, cy = (y0 + y1) / 2;
    const w = 2.3, hh = 2.4, th = 0.38, sk = 0.25;
    const X = (x: number, y: number) => `${cx + x - sk * (y / hh)},${cy + y}`;
    const H = (y: number) => [X(-w / 2 + 0.2, y), X(-w / 2 + 0.4, y - th / 2), X(w / 2 - 0.4, y - th / 2), X(w / 2 - 0.2, y), X(w / 2 - 0.4, y + th / 2), X(-w / 2 + 0.4, y + th / 2)].join(' ');
    const V = (x: number, ya: number, yb: number) => [X(x, ya + 0.15), X(x + th / 2, ya + 0.35), X(x + th / 2, yb - 0.35), X(x, yb - 0.15), X(x - th / 2, yb - 0.35), X(x - th / 2, ya + 0.35)].join(' ');
    const segs: [string, string][] = [
      ['a', H(-hh)], ['b', V(w / 2, -hh, 0)], ['c', V(w / 2, 0, hh)], ['d', H(hh)], ['e', V(-w / 2, 0, hh)], ['f', V(-w / 2, -hh, 0)], ['g', H(0)],
    ];
    const els: SVGElement[] = segs.map(([n, pts]) => {
      const el = s('polygon', { points: pts, class: `bb-seg seg-${n}` });
      g.appendChild(el);
      return el;
    });
    const dp = s('circle', { cx: cx + w / 2 + 0.25, cy: cy + hh, r: 0.22, class: 'bb-seg seg-dp' });
    g.appendChild(dp);
    els.push(dp);
    const bits = [0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01, 0x80];
    let value = -1;
    const set = (v: unknown) => {
      const nv = Number(v) | 0;
      if (nv === value) return;
      value = nv;
      els.forEach((el, i) => el.classList.toggle('on', (nv & bits[i]) !== 0));
    };
    set(0);
    g.appendChild(s('title', null, `${part.label ?? part.id}: common-${part.common} 7-segment display`));
    this.handles.set(part.id, { part, el: g, set });
  }

  private drawPort(part: Extract<Part, { kind: 'port' }>) {
    const g = this.boardGroup(part, this.layerTop, 'bb-port');
    const { x, y } = holeXY(part.hole);
    const label = part.name.startsWith('~') ? prettyPin(part.name) : part.name;
    const chars = label.replace(/̅/g, '').length;
    const w = chars * 0.42 + 0.55;
    const hgt = 0.72;
    const kind = /^BUS/i.test(part.name) ? 'bus' : /^~?CLK$/i.test(part.name) ? 'clk' : /^~?(CLR|RST)/i.test(part.name) ? 'clr' : 'sig';
    // Draw the tag pointing right of the hole, then rotate it to the requested side.
    const rot = { right: 0, bottom: 90, left: 180, top: -90 }[part.side];
    const tag = s('g', { transform: `rotate(${rot} ${x} ${y})` });
    tag.appendChild(s('line', { x1: x, y1: y, x2: x + 0.45, y2: y, class: 'bb-port-stub' }));
    tag.appendChild(s('rect', { x: x + 0.45, y: y - hgt / 2, width: w, height: hgt, rx: 0.18, class: `bb-port-tag port-${kind}` }));
    // keep text upright when the tag points left
    const tx = x + 0.45 + w / 2;
    const text = s('text', { x: tx, y: y + 0.19, 'text-anchor': 'middle', 'font-size': 0.52, class: 'bb-port-text', transform: rot === 180 ? `rotate(180 ${tx} ${y})` : undefined }, label);
    tag.appendChild(text);
    g.appendChild(tag);
    g.appendChild(s('circle', { cx: x, cy: y, r: 0.17, class: 'bb-port-dot' }));
    g.appendChild(s('title', null, `Connection "${part.name}": joins every port with the same name`));
    this.handles.set(part.id, { part, el: g });
  }
}

/** Inverse of `toScene`. */
export function sceneToLocal(p: BoardPlacement, scene: { x: number; y: number }): { x: number; y: number } {
  if (p.rotate === 90) return { x: scene.y - p.y, y: BOARD_H - (scene.x - p.x) };
  return { x: scene.x - p.x, y: scene.y - p.y };
}
