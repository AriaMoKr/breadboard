import type { Circuit, Level, Net } from '../../logic/circuit';
import { s, setClass, setText } from '../../ui/dom';
import type { Schematic } from '../../ui/schematic';

/**
 * Drawing kit for the analog 555 diagrams. Digital wires are bound to nets
 * of a small "display" Circuit so they take the usual high/low colours;
 * analog nodes (capacitor voltage, divider references) use their own
 * colours. Everything is drawn into a `Schematic` SVG so it scales the same
 * way as the gate-level labs.
 */

/** Scoped CSS for the kit; inject it under `.${scope}`. */
export const kitCss = (scope: string) => `
.${scope} { --ana: #f59e0b; --ref: #8b5cf6; }
@media (prefers-color-scheme: light) { .${scope} { --ana: #d97706; --ref: #7c3aed; } }
.${scope} .schematic .wire.ana { stroke: var(--ana); }
.${scope} .schematic .wire.ref { stroke: var(--ref); }
.${scope} .schematic .wire.plain { stroke: var(--fg-dim); }
.${scope} .part-fill.hot { stroke: var(--ana); fill: color-mix(in srgb, var(--ana) 28%, var(--panel-2)); }
.${scope} .schematic .junction.ana { fill: var(--ana); }
.${scope} .schematic .junction.ref { fill: var(--ref); }
.${scope} .schematic .sch-text.ana-text { fill: var(--ana); font-weight: 600; }
.${scope} .schematic .sch-text.ref-text { fill: var(--ref); }
.${scope} .schematic .sch-text.faint { fill: var(--fg-faint); }
.${scope} .schematic .sch-text.dim { fill: var(--fg-dim); }
.${scope} .schematic .sch-text.title { font-weight: 700; }
.${scope} .part { fill: none; stroke: var(--fg-dim); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.${scope} .part-fill { fill: var(--panel-2); stroke: var(--fg-dim); stroke-width: 2; }
.${scope} .chip-outline { fill: color-mix(in srgb, var(--panel) 55%, transparent); stroke: var(--fg-faint); stroke-width: 1.5; stroke-dasharray: 7 5; }
.${scope} .blk { fill: var(--panel-2); stroke: var(--fg-dim); stroke-width: 2; transition: fill .12s, stroke .12s; }
.${scope} .blk.hi { fill: color-mix(in srgb, var(--wire-1) 18%, var(--panel-2)); }
.${scope} .cmp { fill: var(--panel-2); stroke: var(--fg-dim); stroke-width: 2; transition: fill .1s, stroke .1s; }
.${scope} .cmp.armed { stroke: var(--ana); stroke-dasharray: 5 4; }
.${scope} .cmp.fired { fill: color-mix(in srgb, var(--ana) 50%, var(--panel-2)); stroke: var(--ana); stroke-dasharray: none; }
.${scope} .cmp.dead { opacity: 0.4; }
.${scope} .npn .part { transition: stroke .1s; }
.${scope} .npn.on .part { stroke: var(--wire-1); }
.${scope} .led-body { fill: var(--led-off); stroke: var(--fg-dim); stroke-width: 1.5; }
.${scope} .led-g.on .led-body { fill: var(--c, var(--led-red)); filter: drop-shadow(0 0 5px var(--c, var(--led-red))); }
.${scope} .led-g .led-ray { stroke: var(--fg-faint); stroke-width: 1.5; fill: none; }
.${scope} .led-g.on .led-ray { stroke: var(--c, var(--led-red)); }
.${scope} .contact { fill: var(--panel-2); stroke: var(--fg-dim); stroke-width: 2; }
.${scope} .lever { stroke: var(--fg); stroke-width: 3; stroke-linecap: round; transition: none; }
.${scope} .clickable { cursor: pointer; }
.${scope} .clickable:hover .lever, .${scope} .clickable:hover .contact { stroke: var(--accent); }
`;

export type AnaKind = 'ana' | 'ref' | 'plain';

export class Kit {
  readonly under: SVGGElement;
  readonly over: SVGGElement;
  private nets = new Map<string, Net>();

  constructor(
    readonly sch: Schematic,
    readonly c: Circuit,
  ) {
    this.under = s('g', { class: 'kit-under' });
    this.over = s('g', { class: 'kit-over' });
    sch.el.insertBefore(this.under, sch.el.firstChild);
    sch.el.appendChild(this.over);
  }

  /**
   * Run `fn` and return the elements it added to the kit layers, so a
   * variant of the drawing (e.g. a fixed resistor vs a pot) can be shown
   * or hidden as a group.
   */
  group(fn: () => void): { els: Element[]; show(v: boolean): void } {
    // every layer of the SVG: the kit's own and the Schematic's wires/parts/top
    const layers = Array.from(this.sch.el.childNodes) as Element[];
    const before = layers.map((l) => l.childNodes.length);
    fn();
    const els = layers.flatMap((l, i) => Array.from(l.childNodes).slice(before[i]) as Element[]);
    return {
      els,
      show(v: boolean) {
        for (const e of els) (e as SVGElement).style.display = v ? '' : 'none';
      },
    };
  }

  /** A display net (input of the display circuit) set with `level()`. */
  net(name: string, initial: Level = 0): Net {
    let n = this.nets.get(name);
    if (!n) {
      n = this.c.input(name, initial);
      this.nets.set(name, n);
    }
    return n;
  }

  level(name: string, v: Level | boolean) {
    const n = this.net(name);
    const l: Level = v === true ? 1 : v === false ? 0 : v;
    if (n.value !== l) this.c.set(n, l);
  }

  wire(name: string, ...pts: [number, number][]) {
    return this.sch.wire(this.net(name), ...pts);
  }

  dot(name: string, at: [number, number]) {
    return this.sch.dot(this.net(name), at);
  }

  ana(kind: AnaKind, ...pts: [number, number][]) {
    const pl = s('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: `wire ${kind}` });
    this.under.appendChild(pl);
    return pl;
  }

  anaDot(kind: AnaKind, at: [number, number]) {
    const c = s('circle', { cx: at[0], cy: at[1], r: 3.5, class: `junction ${kind}` });
    this.over.appendChild(c);
    return c;
  }

  text(str: string, at: [number, number], opts: { anchor?: 'start' | 'middle' | 'end'; size?: number; class?: string } = {}) {
    const t = s('text', { x: at[0], y: at[1], 'text-anchor': opts.anchor ?? 'middle', 'dominant-baseline': 'middle', 'font-size': opts.size ?? 12, class: `sch-text ${opts.class ?? ''}` }, str);
    this.over.appendChild(t);
    return t;
  }

  /** Resistor centred at (x, y), 30 long. Returns its two ends. */
  resistor(x: number, y: number, orient: 'v' | 'h', label?: string, side: 'left' | 'right' | 'top' | 'bottom' = orient === 'v' ? 'right' : 'top') {
    const w = orient === 'v' ? 11 : 30, hgt = orient === 'v' ? 30 : 11;
    const el = s('rect', { x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, rx: 2, class: 'part-fill' });
    this.over.appendChild(el);
    if (label) this.sideLabel(label, x, y, side, orient === 'v' ? 11 : 9);
    return orient === 'v' ? { el, a: [x, y - 15] as [number, number], b: [x, y + 15] as [number, number] } : { el, a: [x - 15, y] as [number, number], b: [x + 15, y] as [number, number] };
  }

  /** Potentiometer (vertical): resistor with a wiper arrow. */
  pot(x: number, y: number, label?: string, side: 'left' | 'right' = 'right') {
    const r = this.resistor(x, y, 'v', label, side);
    const ax = side === 'right' ? x - 16 : x + 16;
    this.over.appendChild(s('path', { d: `M${ax},${y + 12} L${x + (side === 'right' ? 10 : -10)},${y - 12}`, class: 'part' }));
    this.over.appendChild(s('path', { d: `M${x + (side === 'right' ? 10 : -10)},${y - 12} l${side === 'right' ? -7 : 7},2 M${x + (side === 'right' ? 10 : -10)},${y - 12} l${side === 'right' ? -2 : 2},7`, class: 'part' }));
    return r;
  }

  /** Capacitor centred at (x, y); 'v' = vertical leads (plates horizontal). */
  cap(x: number, y: number, orient: 'v' | 'h', label?: string, side: 'left' | 'right' | 'top' | 'bottom' = orient === 'v' ? 'right' : 'top') {
    const g = s('g', { class: 'cap' });
    if (orient === 'v') {
      g.append(s('line', { x1: x - 11, y1: y - 3.5, x2: x + 11, y2: y - 3.5, class: 'part' }), s('line', { x1: x - 11, y1: y + 3.5, x2: x + 11, y2: y + 3.5, class: 'part' }));
    } else {
      g.append(s('line', { x1: x - 3.5, y1: y - 11, x2: x - 3.5, y2: y + 11, class: 'part' }), s('line', { x1: x + 3.5, y1: y - 11, x2: x + 3.5, y2: y + 11, class: 'part' }));
    }
    this.over.appendChild(g);
    if (label) this.sideLabel(label, x, y, side, 14);
    return orient === 'v' ? { a: [x, y - 3.5] as [number, number], b: [x, y + 3.5] as [number, number] } : { a: [x - 3.5, y] as [number, number], b: [x + 3.5, y] as [number, number] };
  }

  private sideLabel(label: string, x: number, y: number, side: 'left' | 'right' | 'top' | 'bottom', off: number) {
    const lines = label.split('\n');
    lines.forEach((ln, i) => {
      const dy = (i - (lines.length - 1) / 2) * 13;
      if (side === 'right') this.text(ln, [x + off, y + dy], { anchor: 'start', size: 11, class: i ? 'dim' : '' });
      else if (side === 'left') this.text(ln, [x - off, y + dy], { anchor: 'end', size: 11, class: i ? 'dim' : '' });
      else if (side === 'top') this.text(ln, [x, y - off - 4 - (lines.length - 1 - i) * 13], { size: 11, class: i ? 'dim' : '' });
      else this.text(ln, [x, y + off + 4 + i * 13], { size: 11, class: i ? 'dim' : '' });
    });
  }

  ground(x: number, y: number) {
    this.over.appendChild(s('path', { d: `M${x},${y} v6 M${x - 8},${y + 6} h16 M${x - 5},${y + 9.5} h10 M${x - 2},${y + 13} h4`, class: 'part' }));
  }

  vcc(x: number, y: number, label = '+5V') {
    this.over.appendChild(s('path', { d: `M${x},${y} v-8 M${x - 7},${y - 8} h14`, class: 'part' }));
    this.text(label, [x, y - 16], { size: 10, class: 'dim' });
  }

  /** LED pointing down (anode at y-12, cathode at y+12). */
  led(x: number, y: number, color: 'red' | 'blue' | 'green' | 'yellow' = 'red') {
    const g = s('g', { class: 'led-g', style: `--c: var(--led-${color})` });
    g.append(
      s('path', { d: `M${x - 9},${y - 7} L${x + 9},${y - 7} L${x},${y + 7} Z`, class: 'led-body' }),
      s('path', { d: `M${x - 9},${y + 7} h18`, class: 'part' }),
      s('path', { d: `M${x + 11},${y - 4} l8,-6 M${x + 13},${y + 3} l8,-6 M${x + 19},${y - 10} l-4,0 M${x + 19},${y - 10} l0,4 M${x + 21},${y - 3} l-4,0 M${x + 21},${y - 3} l0,4`, class: 'led-ray' }),
    );
    this.over.appendChild(g);
    let on = false, op = -1;
    return {
      a: [x, y - 12] as [number, number],
      b: [x, y + 12] as [number, number],
      set(v: boolean, brightness = 1) {
        if (v !== on) setClass(g, 'on', (on = v));
        const o = v ? Math.max(0.35, brightness) : 1;
        if (Math.abs(o - op) > 0.02) g.style.opacity = String((op = o));
      },
    };
  }

  /** NPN transistor with its base on the right, collector up-left, emitter down-left. */
  npn(x: number, y: number) {
    const g = s('g', { class: 'npn' });
    g.append(
      s('line', { x1: x, y1: y - 12, x2: x, y2: y + 12, class: 'part' }),
      s('line', { x1: x, y1: y, x2: x + 18, y2: y, class: 'part' }),
      s('line', { x1: x, y1: y - 6, x2: x - 15, y2: y - 18, class: 'part' }),
      s('line', { x1: x, y1: y + 6, x2: x - 15, y2: y + 18, class: 'part' }),
      s('path', { d: `M${x - 15},${y + 18} l2,-7 M${x - 15},${y + 18} l7,-1`, class: 'part' }),
    );
    this.over.appendChild(g);
    return {
      el: g,
      base: [x + 18, y] as [number, number],
      collector: [x - 15, y - 18] as [number, number],
      emitter: [x - 15, y + 18] as [number, number],
      set(on: boolean) {
        setClass(g, 'on', on);
      },
    };
  }

  /** Comparator triangle; left edge at x, centred on y, tip at x+45. */
  comparator(x: number, y: number, top: '+' | '−') {
    const el = s('polygon', { points: `${x},${y - 25} ${x + 45},${y} ${x},${y + 25}`, class: 'cmp' });
    this.over.appendChild(el);
    this.text(top, [x + 7, y - 10], { size: 13 });
    this.text(top === '+' ? '−' : '+', [x + 7, y + 10], { size: 13 });
    return { el, inTop: [x, y - 15] as [number, number], inBot: [x, y + 15] as [number, number], out: [x + 45, y] as [number, number] };
  }

  block(x: number, y: number, w: number, hgt: number) {
    const el = s('rect', { x, y, width: w, height: hgt, rx: 5, class: 'blk' });
    this.over.appendChild(el);
    return el;
  }

  outline(x: number, y: number, w: number, hgt: number) {
    const el = s('rect', { x, y, width: w, height: hgt, rx: 8, class: 'chip-outline' });
    this.under.insertBefore(el, this.under.firstChild);
    return el;
  }

  /** Two-contact momentary push button between (x, y1) and (x, y2), vertical. */
  pushButton(x: number, y1: number, y2: number) {
    const bar = s('line', { x1: x - 9, y1: y1 + 2, x2: x - 9, y2: y2 - 2, class: 'lever' });
    const stem = s('path', { d: `M${x - 9},${(y1 + y2) / 2} h-12 M${x - 21},${(y1 + y2) / 2 - 7} v14`, class: 'part' });
    // invisible hit area around the drawing, so the button is easy to tap
    const hit = s('rect', { x: x - 30, y: y1 - 4, width: 38, height: y2 - y1 + 8, fill: 'transparent', stroke: 'none' });
    const g = s('g', { class: 'pushbutton' }, hit, bar, stem);
    g.append(s('circle', { cx: x, cy: y1, r: 3.5, class: 'contact' }), s('circle', { cx: x, cy: y2, r: 3.5, class: 'contact' }));
    this.over.appendChild(g);
    let closed = false;
    return {
      el: g,
      set(v: boolean) {
        if (v === closed) return;
        closed = v;
        const dx = v ? 9 : 0;
        bar.setAttribute('transform', `translate(${dx},0)`);
        stem.setAttribute('transform', `translate(${dx},0)`);
      },
    };
  }

  /** SPDT lever: common at `pivot`, throws at `a` and `c`. */
  spdt(pivot: [number, number], a: [number, number], c: [number, number]) {
    const lever = s('line', { x1: pivot[0], y1: pivot[1], x2: a[0], y2: a[1], class: 'lever' });
    const g = s('g', { class: 'spdt clickable', role: 'button', tabindex: 0, 'aria-label': 'Mode switch' }, s('rect', { x: Math.min(a[0], c[0]) - 14, y: Math.min(a[1], c[1]) - 12, width: Math.abs(c[0] - a[0]) + 28, height: pivot[1] - Math.min(a[1], c[1]) + 22, fill: 'transparent', stroke: 'none' }), lever);
    for (const p of [pivot, a, c]) g.appendChild(s('circle', { cx: p[0], cy: p[1], r: 4, class: 'contact' }));
    this.over.appendChild(g);
    return {
      el: g,
      /** pos: 0 = on A, 1 = on C, in between = travelling; `touch` = actually touching. */
      set(pos: number, touch: boolean) {
        const t = Math.max(0, Math.min(1, pos));
        let x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t;
        if (!touch && (t === 0 || t === 1)) {
          // bounced off: shorten the lever a little
          x = pivot[0] + (x - pivot[0]) * 0.8;
          y = pivot[1] + (y - pivot[1]) * 0.8;
        }
        lever.setAttribute('x2', String(x));
        lever.setAttribute('y2', String(y));
      },
    };
  }
}

// ---------------------------------------------------------------------------
// The 555 internals

export const CHIP_W = 370;
export const CHIP_H = 300;

export interface Diagram555 {
  /** Outer ends of the pin stubs (absolute coordinates). */
  pin: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, [number, number]>;
  thrCmp: SVGPolygonElement;
  trigCmp: SVGPolygonElement;
  ff: SVGRectElement;
  /** Live voltage labels next to the divider nodes and pins. */
  refHi: SVGTextElement;
  refLo: SVGTextElement;
  update(st: State555): void;
}

export interface State555 {
  /** Comparator outputs (true = firing). */
  trig: boolean;
  thr: boolean;
  /** Which comparator is "armed" (the one the capacitor is heading for). */
  armed?: 'trig' | 'thr' | null;
  /** Pin 4 level (true = high, i.e. not resetting). */
  resetHigh: boolean;
  /** Output (pin 3). The discharge transistor is on when it is low. */
  q: 0 | 1;
  /** Flash a comparator that fired recently even if it is no longer active. */
  flash?: 'trig' | 'thr' | null;
  /** Discharge transistor drawn as unused (bistable: DIS not connected). */
  hiRefV?: number;
  loRefV?: number;
}

/**
 * Draw an LM555's insides with its top-left corner at (ox, oy):
 * the 5k-5k-5k divider, the threshold and trigger comparators, the SR
 * flip-flop, the discharge transistor and the output stage. Pins: 7 DIS,
 * 5 CV, 6 THR and 2 TRIG on the left; 8 VCC and 1 GND top/bottom left;
 * 4 RESET at the bottom; 3 OUT on the right.
 */
export function draw555(kit: Kit, ox: number, oy: number, opts: { thrDead?: boolean; disUnused?: boolean; trigNet?: string; thrNet?: string } = {}): Diagram555 {
  const P = (x: number, y: number): [number, number] => [ox + x, oy + y];
  const W = CHIP_W, H = CHIP_H;
  kit.outline(ox, oy, W, H);
  kit.text('LM555', P(W - 10, 16), { anchor: 'end', size: 14, class: 'title' });
  kit.net('vcc', 1);
  kit.net('gnd', 0);

  // pins
  const pinStub = (n: number, from: [number, number], to: [number, number], name: string, nameAt: [number, number], anchor: 'start' | 'end' | 'middle', numAt: [number, number]) => {
    kit.over.appendChild(s('line', { x1: from[0], y1: from[1], x2: to[0], y2: to[1], class: 'part' }));
    kit.text(String(n), numAt, { size: 10, class: 'faint' });
    kit.text(name, nameAt, { anchor, size: 10, class: 'dim' });
  };
  const leftPin = (n: number, y: number, name: string) => pinStub(n, P(-14, y), P(0, y), name, P(5, y - 8), 'start', P(-7, y - 8));
  leftPin(7, 30, 'DIS');
  leftPin(5, 100, 'CV');
  leftPin(6, 130, 'THR');
  leftPin(2, 230, 'TRIG');
  pinStub(8, P(40, -14), P(40, 0), 'VCC', P(46, 10), 'start', P(48, -8));
  pinStub(1, P(40, H), P(40, H + 14), 'GND', P(46, H - 9), 'start', P(48, H + 8));
  pinStub(4, P(255, H), P(255, H + 14), 'RESET', P(261, H - 9), 'start', P(263, H + 8));
  pinStub(3, P(W, 165), P(W + 14, 165), 'OUT', P(W - 5, 155), 'end', P(W + 7, 157));

  // divider
  kit.wire('vcc', P(40, 0), P(40, 50));
  kit.resistor(ox + 40, oy + 65, 'v', '5k');
  kit.ana('ref', P(40, 80), P(40, 150));
  kit.resistor(ox + 40, oy + 165, 'v', '5k');
  kit.ana('ref', P(40, 180), P(40, 245));
  kit.resistor(ox + 40, oy + 260, 'v', '5k');
  kit.wire('gnd', P(40, 275), P(40, H));
  kit.ana('ref', P(0, 100), P(150, 100));
  kit.anaDot('ref', P(40, 100));
  kit.ana('ref', P(40, 200), P(150, 200));
  kit.anaDot('ref', P(40, 200));
  const refHi = kit.text('3.33 V', P(48, 91), { anchor: 'start', size: 10, class: 'ref-text' });
  const refLo = kit.text('1.67 V', P(48, 191), { anchor: 'start', size: 10, class: 'ref-text' });

  // comparators: inputs are drawn by the caller-independent pin wires
  const thr = kit.comparator(ox + 150, oy + 115, '−');
  const trig = kit.comparator(ox + 150, oy + 215, '+');
  if (opts.thrNet) kit.wire(opts.thrNet, P(0, 130), P(150, 130));
  else kit.ana('ana', P(0, 130), P(150, 130));
  if (opts.trigNet) kit.wire(opts.trigNet, P(0, 230), P(150, 230));
  else kit.ana('ana', P(0, 230), P(150, 230));
  kit.text('threshold', P(172, 82), { size: 10, class: 'dim' });
  if (opts.thrDead) kit.text('never fires', P(172, 150), { size: 10, class: 'faint' });
  kit.text('trigger', P(172, 251), { size: 10, class: 'dim' });

  // flip-flop
  kit.wire('thr', thr.out, P(225, 115));
  kit.wire('trig', trig.out, P(225, 215));
  const ff = kit.block(ox + 225, oy + 105, 55, 125);
  kit.text('SR', P(252, 158), { size: 12, class: 'title' });
  kit.text('flip-flop', P(252, 173), { size: 9, class: 'dim' });
  kit.text('R', P(231, 115), { anchor: 'start', size: 11 });
  kit.text('S', P(231, 215), { anchor: 'start', size: 11 });
  kit.text('Q̅', P(275, 150), { anchor: 'end', size: 11 });
  kit.text('rst', P(255, 220), { size: 9, class: 'dim' });
  kit.wire('reset', P(255, 230), P(255, H));
  kit.wire('qn', P(280, 165), P(300, 165));
  kit.dot('qn', P(292, 165));

  // output stage (inverts Q̅ so pin 3 = Q)
  kit.sch.gate('NOT', P(310, 165), { output: kit.net('out') });
  kit.wire('out', P(360, 165), P(W, 165));
  kit.text('output', P(330, 186), { size: 9, class: 'dim' });

  // discharge transistor
  const tr = kit.npn(ox + 125, oy + 48);
  kit.wire('qn', P(292, 165), P(292, 48), tr.base);
  kit.ana(opts.disUnused ? 'plain' : 'ana', P(0, 30), tr.collector);
  kit.wire('gnd', tr.emitter, P(110, 72));
  kit.ground(ox + 110, oy + 72);
  kit.text('discharge', P(148, 22), { anchor: 'start', size: 9, class: 'dim' });

  const pin = {
    1: P(40, H + 14), 2: P(-14, 230), 3: P(W + 14, 165), 4: P(255, H + 14),
    5: P(-14, 100), 6: P(-14, 130), 7: P(-14, 30), 8: P(40, -14),
  } as Diagram555['pin'];

  if (opts.thrDead) setClass(thr.el, 'dead', true);
  let lastHi = '', lastLo = '';
  return {
    pin,
    thrCmp: thr.el,
    trigCmp: trig.el,
    ff,
    refHi,
    refLo,
    update(st) {
      kit.level('trig', st.trig);
      kit.level('thr', st.thr);
      kit.level('reset', st.resetHigh);
      kit.level('qn', st.q ? 0 : 1);
      kit.level('out', st.q);
      setClass(thr.el, 'fired', st.thr || st.flash === 'thr');
      setClass(trig.el, 'fired', st.trig || st.flash === 'trig');
      setClass(thr.el, 'armed', st.armed === 'thr');
      setClass(trig.el, 'armed', st.armed === 'trig');
      setClass(ff, 'hi', st.q === 1);
      tr.set(st.q === 0 && !opts.disUnused);
      const hi = `${(st.hiRefV ?? 10 / 3).toFixed(2)} V`, lo = `${(st.loRefV ?? 5 / 3).toFixed(2)} V`;
      if (hi !== lastHi) setText(refHi, (lastHi = hi));
      if (lo !== lastLo) setText(refLo, (lastLo = lo));
      kit.sch.update();
    },
  };
}

/**
 * Parts every 555 in the clock module has: 0.01 µF on CV (pin 5), VCC and
 * GND, the 0.1 µF decoupling capacitor, optionally RESET tied to VCC, and
 * an LED with 330 Ω on the output.
 */
export function drawSupport(kit: Kit, chip: Diagram555, ox: number, oy: number, opts: { resetToVcc?: boolean; led?: 'red' | 'blue' | 'green' | 'yellow'; outLabel?: string } = {}) {
  const at = (x: number, y: number): [number, number] => [ox + x, oy + y];
  const cv = kit.group(() => {
    kit.ana('ref', chip.pin[5], at(-26.5, 100));
    kit.cap(ox - 30, oy + 100, 'h');
    kit.wire('gnd', at(-33.5, 100), at(-46, 100));
    kit.ground(ox - 46, oy + 100);
    kit.text('0.01 µF', at(-30, 84), { size: 10, class: 'dim' });
  });
  const cvOpen = kit.group(() => kit.text('CV open', at(-18, 100), { anchor: 'end', size: 10, class: 'faint' }));
  cvOpen.show(false);
  kit.vcc(...chip.pin[8]);
  kit.ground(...chip.pin[1]);
  if (opts.resetToVcc) {
    kit.wire('vcc', chip.pin[4], at(255, CHIP_H + 26), at(290, CHIP_H + 26));
    kit.vcc(ox + 290, oy + CHIP_H + 26);
    kit.text('RESET tied to VCC', at(302, CHIP_H + 21), { anchor: 'start', size: 10, class: 'dim' });
  }
  const dec = kit.group(() => {
    kit.vcc(ox + 262, oy - 28);
    kit.wire('vcc', at(262, -28), at(286.5, -28));
    kit.cap(ox + 290, oy - 28, 'h');
    kit.wire('gnd', at(293.5, -28), at(312, -28));
    kit.ground(ox + 312, oy - 28);
    kit.text('0.1 µF decoupling', at(326, -24), { anchor: 'start', size: 10, class: 'dim' });
  });
  const lx = CHIP_W + 28;
  kit.wire('out', chip.pin[3], at(lx, 165), at(lx, 182));
  const led = kit.led(ox + lx, oy + 194, opts.led ?? 'red');
  kit.ana('plain', at(lx, 206), at(lx, 222));
  kit.resistor(ox + lx, oy + 237, 'v', '330 Ω');
  kit.ana('plain', at(lx, 252), at(lx, 262));
  kit.ground(ox + lx, oy + 262);
  if (opts.outLabel) kit.text(opts.outLabel, at(lx + 10, 154), { anchor: 'start', size: 11 });
  return { cv, cvOpen, dec, led };
}
