import type { Circuit, Level, Net } from '../logic/circuit';
import { media, s } from './dom';

/**
 * Spacing for a stack of switches and the chip pins they feed: `normal` with a mouse, at least
 * 36 on touch screens so neighbouring switches are a fingertip apart. Drawings that use it grow
 * taller there.
 */
export function switchPitch(normal = 20): number {
  return media('(pointer: coarse)')?.matches ? Math.max(normal, 36) : normal;
}

/**
 * Live SVG schematics bound to a logic `Circuit`. Wires take the colour of
 * the net they carry (high / low / floating / contention), so labs can show
 * signals moving through gates as the circuit is stepped.
 *
 *   const sch = new Schematic(circuit, { width: 520, height: 260 });
 *   const g1 = sch.gate('NOR', { x: 200, y: 80 });
 *   sch.wire(R, [40, 72], g1.inputs[0]);
 *   sch.wire(Q, g1.output, [420, 80]);
 *   sch.switch(R, { x: 40, y: 72 }, { label: 'R' });
 *   sch.probe(Q, { x: 420, y: 80 }, { label: 'Q' });
 *   const stop = sch.autoUpdate();
 *
 * Layers, bottom to top: background shapes (`box`, `add`), multi-bit `bus`
 * lines, wires, parts (gates, chips), top (labels, switches, probes).
 */

export type Pt = { x: number; y: number } | readonly [number, number];
export interface P { x: number; y: number }
const P = (p: Pt): P => (Array.isArray(p) ? { x: p[0], y: p[1] } : (p as P));

export type SchematicGate = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR' | 'XNOR' | 'BUF' | 'TRI';

export interface GateHandle {
  el: SVGGElement;
  /** Absolute input pin positions, top to bottom. */
  inputs: P[];
  output: P;
  /** For TRI: the enable pin (top). */
  enable?: P;
}

export interface ChipPin {
  name: string;
  net?: Net;
  /** Draw an inversion bubble (active-low pin). */
  bubble?: boolean;
  /** Physical pin number, drawn small outside the chip body next to the stub. */
  pin?: number | string;
}

export interface SchematicOptions {
  width: number;
  height: number;
  class?: string;
  /** viewBox origin (default 0, 0); e.g. `x0: -20` leaves room for labels left of x = 0. */
  x0?: number;
  y0?: number;
}

/** State of a multi-bit bus line drawn with `Schematic.bus`. */
export type BusLineState = 'active' | 'idle' | 'floating' | 'contention' | 'off';

export interface BusLineHandle {
  el: SVGGElement;
  line: SVGPolylineElement;
  /** Value label (if `label` was given a position), else null. */
  text: SVGTextElement | null;
  /** Set the state (colour) and optionally the value label text. */
  set(state: BusLineState, label?: string): void;
}

export type SchematicLayer = 'back' | 'bus' | 'wires' | 'parts' | 'top';

export interface ChipHandle {
  el: SVGGElement;
  left: P[];
  right: P[];
  top: P[];
  bottom: P[];
}

export const levelClass = (l: Level) => (l === 1 ? 'l1' : l === 0 ? 'l0' : l === 'Z' ? 'lz' : 'lx');

export class Schematic {
  readonly el: SVGSVGElement;
  private bound: { net: Net; el: Element; last?: Level }[] = [];
  private layerBack: SVGGElement;
  private layerBus: SVGGElement;
  private layerWires: SVGGElement;
  private layerParts: SVGGElement;
  private layerTop: SVGGElement;
  /** Hit areas of the switches placed so far, so neighbouring ones don't overlap (see `switch`). */
  private switchHits: { x: number; y: number; rect: SVGRectElement; half: number }[] = [];

  constructor(
    readonly circuit: Circuit,
    opts: SchematicOptions,
  ) {
    this.layerBack = s('g', { class: 'sch-back' });
    this.layerBus = s('g', { class: 'sch-buses' });
    this.layerWires = s('g', { class: 'sch-wires' });
    this.layerParts = s('g', { class: 'sch-parts' });
    this.layerTop = s('g', { class: 'sch-top' });
    this.el = s(
      'svg',
      { viewBox: `${opts.x0 ?? 0} ${opts.y0 ?? 0} ${opts.width} ${opts.height}`, class: `schematic ${opts.class ?? ''}`, role: 'img', preserveAspectRatio: 'xMidYMid meet', style: `--sch-w: ${opts.width}` },
      this.layerBack,
      this.layerBus,
      this.layerWires,
      this.layerParts,
      this.layerTop,
    );
    this.el.style.maxWidth = `${opts.width}px`;
  }

  /** The SVG group of a layer, for drawing custom shapes. */
  layer(name: SchematicLayer): SVGGElement {
    return { back: this.layerBack, bus: this.layerBus, wires: this.layerWires, parts: this.layerParts, top: this.layerTop }[name];
  }

  /** Append any SVG element to a layer (default: the background, under everything). */
  add<E extends SVGElement>(el: E, layer: SchematicLayer = 'back'): E {
    this.layer(layer).appendChild(el);
    return el;
  }

  private bind(net: Net, el: Element) {
    this.bound.push({ net, el });
    el.classList.add(levelClass(net.value));
  }

  /** Recolour every bound element from current net values. */
  update() {
    for (const b of this.bound) {
      const v = b.net.value;
      if (v === b.last) continue;
      if (b.last !== undefined) b.el.classList.remove(levelClass(b.last));
      else b.el.classList.remove('l0', 'l1', 'lz', 'lx');
      b.el.classList.add(levelClass(v));
      b.last = v;
    }
  }

  /**
   * Update on every circuit change, throttled to animation frames. The
   * returned function unsubscribes and cancels a frame that is still queued.
   */
  autoUpdate(): () => void {
    const hasRaf = typeof requestAnimationFrame !== 'undefined';
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      frame = null;
      timer = null;
      this.update();
    };
    const off = this.circuit.onChange(() => {
      if (frame !== null || timer !== null) return;
      if (hasRaf) frame = requestAnimationFrame(run);
      else timer = setTimeout(run, 16);
    });
    this.update();
    return () => {
      off();
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    };
  }

  // ---- primitives -----------------------------------------------------------

  /** Polyline wire coloured by `net`. Points may be {x,y} or [x,y]. */
  wire(net: Net, ...pts: Pt[]): SVGPolylineElement {
    const pl = s('polyline', { points: pts.map(P).map((p) => `${p.x},${p.y}`).join(' '), class: 'wire' });
    this.layerWires.appendChild(pl);
    this.bind(net, pl);
    return pl;
  }

  /** Orthogonal wire: goes horizontally first, then vertically (or the reverse). */
  route(net: Net, from: Pt, to: Pt, opts: { via?: 'h' | 'v'; midX?: number; midY?: number } = {}) {
    const a = P(from), b = P(to);
    if (opts.midX !== undefined) return this.wire(net, a, [opts.midX, a.y], [opts.midX, b.y], b);
    if (opts.midY !== undefined) return this.wire(net, a, [a.x, opts.midY], [b.x, opts.midY], b);
    return opts.via === 'v' ? this.wire(net, a, [a.x, b.y], b) : this.wire(net, a, [b.x, a.y], b);
  }

  /** Junction dot. */
  dot(net: Net, at: Pt) {
    const p = P(at);
    const c = s('circle', { cx: p.x, cy: p.y, r: 3.5, class: 'junction' });
    this.layerTop.appendChild(c);
    this.bind(net, c);
    return c;
  }

  text(str: string, at: Pt, opts: { anchor?: 'start' | 'middle' | 'end'; class?: string; size?: number } = {}) {
    const p = P(at);
    const t = s('text', { x: p.x, y: p.y, 'text-anchor': opts.anchor ?? 'middle', class: `sch-text ${opts.class ?? ''}`, 'font-size': opts.size ?? 13, 'dominant-baseline': 'middle' }, str);
    this.layerTop.appendChild(t);
    return t;
  }

  /** Text whose content you update yourself (returns the element). */
  label(str: string, at: Pt, opts: { anchor?: 'start' | 'middle' | 'end'; class?: string; size?: number } = {}) {
    return this.text(str, at, opts);
  }

  /**
   * Background rectangle under everything, e.g. a chip package outline or a
   * dashed box grouping the gates that live in one chip. `label` is drawn
   * inside its top-left corner.
   */
  box(at: Pt, size: { width: number; height: number }, opts: { dashed?: boolean; fill?: boolean; label?: string; class?: string; rx?: number } = {}): SVGGElement {
    const p = P(at);
    const cls = ['sch-box', opts.dashed ? 'dashed' : '', opts.fill ? 'filled' : '', opts.class ?? ''].filter(Boolean).join(' ');
    const g = s('g', { class: cls });
    g.appendChild(s('rect', { x: p.x, y: p.y, width: size.width, height: size.height, rx: opts.rx ?? 6 }));
    if (opts.label) g.appendChild(s('text', { x: p.x + 6, y: p.y + 11, class: 'sch-text sch-box-label', 'font-size': 10 }, opts.label));
    this.layerBack.appendChild(g);
    return g;
  }

  /**
   * A thick multi-bit bus line (drawn under the single wires). It is not tied
   * to a net: call `set(state, label)` with 'active' (driven), 'idle',
   * 'floating' (nothing drives it), 'contention' or 'off' (not connected).
   */
  bus(pts: Pt[], opts: { label?: Pt; labelAnchor?: 'start' | 'middle' | 'end'; state?: BusLineState; width?: number } = {}): BusLineHandle {
    const g = s('g', { class: 'sch-bus' });
    const line = s('polyline', { points: pts.map(P).map((p) => `${p.x},${p.y}`).join(' '), class: 'sch-bus-line', 'stroke-width': opts.width ?? 7 });
    g.appendChild(line);
    let text: SVGTextElement | null = null;
    if (opts.label) {
      const lp = P(opts.label);
      text = s('text', { x: lp.x, y: lp.y, 'text-anchor': opts.labelAnchor ?? 'start', 'dominant-baseline': 'middle', class: 'sch-text sch-bus-label', 'font-size': 11 });
      this.layerTop.appendChild(text);
    }
    this.layerBus.appendChild(g);
    let state: BusLineState | null = null;
    const set = (st: BusLineState, label?: string) => {
      if (st !== state) {
        if (state) g.classList.remove(state);
        g.classList.add(st);
        state = st;
      }
      if (text && label !== undefined && text.textContent !== label) text.textContent = label;
    };
    set(opts.state ?? 'idle');
    return { el: g, line, text, set };
  }

  // ---- gates ----------------------------------------------------------------

  /**
   * Draw a gate whose body's left-middle is at `at`. Bodies are 40×30
   * (scaled by `scale`); input pins stick out 10 to the left, the output pin
   * is at x+50. `inputs` = number of inputs (default 2; NOT/BUF/TRI 1).
   * Pass `output` to colour the gate body by its output net, and
   * `flip: true` to mirror it so it points left (input pins 10 to the right
   * of `at`, output 50 to the left); its label stays readable.
   */
  gate(kind: SchematicGate, at: Pt, opts: { inputs?: number; label?: string; scale?: number; output?: Net; flip?: boolean } = {}): GateHandle {
    const p = P(at);
    const k = opts.scale ?? 1;
    const fx = opts.flip ? -1 : 1;
    const single = kind === 'NOT' || kind === 'BUF' || kind === 'TRI';
    const n = single ? 1 : Math.max(2, opts.inputs ?? 2);
    const inverted = kind === 'NOT' || kind === 'NAND' || kind === 'NOR' || kind === 'XNOR';
    const g = s('g', { class: `gate gate-${kind.toLowerCase()}${opts.flip ? ' flipped' : ''}`, transform: opts.flip ? `translate(${p.x},${p.y}) scale(${-k},${k})` : `translate(${p.x},${p.y}) scale(${k})` });
    const H = Math.max(30, n * 12);
    const h2 = H / 2;
    let body = '';
    let bodyRight = 40;
    let leftAt = (_y: number) => 0; // x where an input stub meets the body
    switch (kind) {
      case 'AND':
      case 'NAND':
        body = `M0,${-h2} H${40 - h2} A${h2},${h2} 0 0 1 ${40 - h2},${h2} H0 Z`;
        bodyRight = 40;
        break;
      case 'OR':
      case 'NOR':
      case 'XOR':
      case 'XNOR': {
        const x0 = kind.startsWith('X') ? 6 : 0;
        body = `M${x0},${-h2} Q${x0 + 12},0 ${x0},${h2} Q${x0 + 28},${h2} 40,0 Q${x0 + 28},${-h2} ${x0},${-h2} Z`;
        if (x0) body += ` M0,${-h2} Q12,0 0,${h2}`;
        leftAt = (y) => x0 + 12 * (1 - (y / h2) ** 2) * 0.5;
        bodyRight = 40;
        break;
      }
      case 'NOT':
      case 'BUF':
      case 'TRI':
        body = `M4,-13 L36,0 L4,13 Z`;
        leftAt = () => 4;
        bodyRight = 36;
        break;
    }
    const bodyEl = s('path', { d: body, class: 'gate-body' });
    g.appendChild(bodyEl);
    if (opts.output) this.bind(opts.output, bodyEl);
    let outX = bodyRight;
    if (inverted) {
      g.appendChild(s('circle', { cx: bodyRight + 4, cy: 0, r: 4, class: 'gate-bubble' }));
      outX = bodyRight + 8;
    }
    g.appendChild(s('line', { x1: outX, y1: 0, x2: 50, y2: 0, class: 'gate-pin' }));
    const inputs: P[] = [];
    for (let i = 0; i < n; i++) {
      const yy = n === 1 ? 0 : -h2 + (H * (i + 0.5)) / n;
      g.appendChild(s('line', { x1: -10, y1: yy, x2: leftAt(yy), y2: yy, class: 'gate-pin' }));
      inputs.push({ x: p.x - 10 * k * fx, y: p.y + yy * k });
    }
    let enable: P | undefined;
    if (kind === 'TRI') {
      g.appendChild(s('line', { x1: 20, y1: -22, x2: 20, y2: -7, class: 'gate-pin' }));
      enable = { x: p.x + 20 * k * fx, y: p.y - 22 * k };
    }
    // a flipped gate mirrors its label back so the text stays readable
    if (opts.label) g.appendChild(s('text', { x: 18, y: h2 + 13, 'text-anchor': 'middle', class: 'sch-text gate-label', 'font-size': 11, transform: opts.flip ? 'translate(36,0) scale(-1,1)' : undefined }, opts.label));
    this.layerParts.appendChild(g);
    return { el: g, inputs, output: { x: p.x + 50 * k * fx, y: p.y }, enable };
  }

  /**
   * A chip / module box with named pins. `at` is the top-left corner.
   * Pins are spaced 20 apart; pin stubs are 12 long.
   */
  chip(
    at: Pt,
    opts: { label: string; sublabel?: string; width?: number; height?: number; left?: ChipPin[]; right?: ChipPin[]; top?: ChipPin[]; bottom?: ChipPin[] },
  ): ChipHandle {
    const p = P(at);
    const left = opts.left ?? [], right = opts.right ?? [], top = opts.top ?? [], bottom = opts.bottom ?? [];
    const H = opts.height ?? Math.max(40, Math.max(left.length, right.length) * 20 + 20);
    const W = opts.width ?? Math.max(90, Math.max(top.length, bottom.length) * 22 + 20);
    const g = s('g', { class: 'chip', transform: `translate(${p.x},${p.y})` });
    g.appendChild(s('rect', { x: 0, y: 0, width: W, height: H, rx: 4, class: 'chip-body' }));
    g.appendChild(s('text', { x: W / 2, y: H / 2 - (opts.sublabel ? 7 : 0), 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'sch-text chip-label', 'font-size': 13 }, opts.label));
    if (opts.sublabel) g.appendChild(s('text', { x: W / 2, y: H / 2 + 9, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'sch-text chip-sublabel', 'font-size': 10 }, opts.sublabel));
    const place = (pins: ChipPin[], side: 'left' | 'right' | 'top' | 'bottom'): P[] =>
      pins.map((pin, i) => {
        const n = pins.length;
        const span = side === 'left' || side === 'right' ? H : W;
        const off = (span / (n + 1)) * (i + 1);
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0, tx = 0, ty = 0;
        let anchor: 'start' | 'end' | 'middle' = 'start';
        if (side === 'left') { x1 = -12; x2 = 0; y1 = y2 = off; tx = 4; ty = off; anchor = 'start'; }
        if (side === 'right') { x1 = W; x2 = W + 12; y1 = y2 = off; tx = W - 4; ty = off; anchor = 'end'; }
        if (side === 'top') { y1 = -12; y2 = 0; x1 = x2 = off; tx = off; ty = 9; anchor = 'middle'; }
        if (side === 'bottom') { y1 = H; y2 = H + 12; x1 = x2 = off; tx = off; ty = H - 8; anchor = 'middle'; }
        const line = s('line', { x1, y1, x2, y2, class: 'gate-pin' });
        g.appendChild(line);
        if (pin.net) this.bind(pin.net, line);
        if (pin.bubble) {
          const bx = side === 'left' ? -3 : side === 'right' ? W + 3 : off;
          const by = side === 'top' ? -3 : side === 'bottom' ? H + 3 : off;
          g.appendChild(s('circle', { cx: bx, cy: by, r: 3, class: 'gate-bubble' }));
        }
        g.appendChild(s('text', { x: tx, y: ty, 'text-anchor': anchor, 'dominant-baseline': 'middle', class: 'sch-text pin-label', 'font-size': 9 }, pin.name));
        if (pin.pin !== undefined) {
          // physical pin number just outside the body, above / beside the stub
          const nx = side === 'left' ? -3 : side === 'right' ? W + 3 : off + 3;
          const ny = side === 'top' ? -5 : side === 'bottom' ? H + 10 : off - 4;
          const na = side === 'left' ? 'end' : 'start';
          g.appendChild(s('text', { x: nx, y: ny, 'text-anchor': na, class: 'sch-text pin-num', 'font-size': 7.5 }, String(pin.pin)));
        }
        const end = side === 'left' ? { x: x1, y: y1 } : side === 'right' ? { x: x2, y: y2 } : side === 'top' ? { x: x1, y: y1 } : { x: x2, y: y2 };
        return { x: p.x + end.x, y: p.y + end.y };
      });
    const handle: ChipHandle = { el: g, left: place(left, 'left'), right: place(right, 'right'), top: place(top, 'top'), bottom: place(bottom, 'bottom') };
    this.layerParts.appendChild(g);
    return handle;
  }

  // ---- interactive I/O --------------------------------------------------------

  /**
   * Clickable toggle switch driving an input net. By default it calls
   * circuit.toggle(net); pass `onToggle` to e.g. also settle/animate.
   */
  switch(net: Net, at: Pt, opts: { label?: string; onToggle?: (net: Net) => void; momentary?: boolean } = {}) {
    const p = P(at);
    const g = s('g', { class: `sch-switch ${opts.momentary ? 'momentary' : ''}`, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': opts.label ?? net.name });
    const box = s('rect', { x: -22, y: -10, width: 22, height: 20, rx: 4, class: 'switch-body' });
    const knob = s('circle', { cx: -11, cy: 0, r: 5, class: 'switch-knob' });
    // Invisible hit area, bigger than the switch so a fingertip finds it: wide (over the label)
    // and up to 36 tall, but never reaching into a neighbouring switch's area.
    const hit = s('rect', { x: -40, y: -18, width: 54, height: 36, class: 'switch-hit' });
    const me = { x: p.x, y: p.y, rect: hit, half: 18 };
    for (const o of this.switchHits) {
      if (Math.abs(o.x - p.x) >= 54) continue;
      const half = Math.max(10, Math.min(18, Math.abs(o.y - p.y) / 2));
      for (const sw of [o, me]) {
        if (half >= sw.half) continue;
        sw.half = half;
        sw.rect.setAttribute('y', String(-half));
        sw.rect.setAttribute('height', String(2 * half));
      }
    }
    this.switchHits.push(me);
    g.append(hit, box, knob);
    if (opts.label) g.appendChild(s('text', { x: -28, y: 0, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'sch-text', 'font-size': 13 }, opts.label));
    this.bind(net, g);
    const act = () => (opts.onToggle ? opts.onToggle(net) : this.circuit.toggle(net));
    if (opts.momentary) {
      const down = (e: Event) => { e.preventDefault(); if (net.value !== 1) act(); };
      const up = () => { if (net.value === 1) act(); };
      g.addEventListener('pointerdown', down);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointerleave', up);
      g.addEventListener('keydown', (e) => (e as KeyboardEvent).key === ' ' && down(e));
      g.addEventListener('keyup', (e) => (e as KeyboardEvent).key === ' ' && up());
    } else {
      g.addEventListener('click', act);
      g.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === ' ' || k === 'Enter') { e.preventDefault(); act(); }
      });
    }
    this.layerTop.appendChild(g);
    return g;
  }

  /** LED probe showing a net's level. `r` is the LED radius (default 8). */
  probe(net: Net, at: Pt, opts: { label?: string; color?: 'red' | 'green' | 'yellow' | 'blue'; labelSide?: 'right' | 'left' | 'top' | 'bottom'; r?: number } = {}) {
    const p = P(at);
    const r = opts.r ?? 8;
    const g = s('g', { class: `sch-probe probe-${opts.color ?? 'red'}`, transform: `translate(${p.x},${p.y})` });
    g.appendChild(s('circle', { cx: 0, cy: 0, r, class: 'probe-led' }));
    if (opts.label) {
      const side = opts.labelSide ?? 'right';
      const tx = side === 'right' ? r + 6 : side === 'left' ? -(r + 6) : 0;
      const ty = side === 'top' ? -(r + 8) : side === 'bottom' ? r + 10 : 0;
      g.appendChild(s('text', { x: tx, y: ty, 'text-anchor': side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle', 'dominant-baseline': 'middle', class: 'sch-text', 'font-size': 13 }, opts.label));
    }
    this.bind(net, g);
    this.layerTop.appendChild(g);
    return g;
  }
}
