import type { Level } from '../logic/circuit';
import { h, s, setClass, setText } from './dom';

/**
 * Reusable front-panel widgets. Every widget exposes `.el` (mount it
 * anywhere) and a `.set(...)` that is cheap to call every animation frame.
 */

export type LedColor = 'red' | 'green' | 'yellow' | 'blue' | 'white' | 'orange';

const levelOn = (v: boolean | Level | number) => v === true || v === 1;

// ---------------------------------------------------------------------------
// LEDs

export class Led {
  readonly el: HTMLSpanElement;
  private on = false;
  private state: string = '';
  constructor(
    public color: LedColor = 'red',
    title?: string,
  ) {
    this.el = h('span', { class: `led led-${color}`, title, role: 'img', 'aria-label': title ?? 'LED' });
  }
  /** true/1 = lit; 'Z' shows as floating, 'X' as contention. */
  set(v: boolean | Level | number) {
    const on = levelOn(v);
    const state = v === 'Z' ? 'z' : v === 'X' ? 'x' : '';
    if (on !== this.on) {
      this.on = on;
      setClass(this.el, 'on', on);
    }
    if (state !== this.state) {
      setClass(this.el, 'z', state === 'z');
      setClass(this.el, 'x', state === 'x');
      this.state = state;
    }
  }
}

export type NumberFormat = 'bin' | 'dec' | 'hex' | 'sdec';

export interface LedBarOptions {
  bits: number;
  /** One colour for all LEDs, or per LED (MSB first). */
  color?: LedColor | LedColor[];
  label?: string;
  /** Number readouts shown next to the LEDs. */
  formats?: NumberFormat[];
  /** Small captions under each LED (MSB first), e.g. control signal names. */
  captions?: string[];
  title?: string;
}

export function formatNumber(v: number, f: NumberFormat, bits: number): string {
  switch (f) {
    case 'bin': return v.toString(2).padStart(bits, '0');
    case 'hex': return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0');
    case 'dec': return String(v);
    case 'sdec': {
      const sign = 1 << (bits - 1);
      return String(v & sign ? v - (1 << bits) : v);
    }
  }
}

export class LedBar {
  readonly el: HTMLDivElement;
  readonly leds: Led[];
  private readouts: HTMLSpanElement[] = [];
  private value = -1;
  constructor(readonly opts: LedBarOptions) {
    const colors = Array.isArray(opts.color) ? opts.color : new Array<LedColor>(opts.bits).fill(opts.color ?? 'red');
    this.leds = colors.map((c, i) => new Led(c, opts.captions?.[i]));
    const cells = this.leds.map((l, i) =>
      opts.captions ? h('span', { class: 'led-cell' }, l.el, h('span', { class: 'led-caption' }, opts.captions[i])) : l.el,
    );
    this.readouts = (opts.formats ?? []).map((f) => h('span', { class: `readout readout-${f}` }));
    this.el = h(
      'div',
      { class: 'ledbar', title: opts.title },
      opts.label ? h('span', { class: 'ledbar-label' }, opts.label) : null,
      h('span', { class: 'ledbar-leds' }, cells),
      this.readouts.length ? h('span', { class: 'readouts' }, this.readouts) : null,
    );
    this.set(0);
  }
  set(value: number) {
    if (value === this.value) return;
    this.value = value;
    const n = this.opts.bits;
    for (let i = 0; i < n; i++) this.leds[i].set(((value >> (n - 1 - i)) & 1) === 1);
    (this.opts.formats ?? []).forEach((f, i) => setText(this.readouts[i], formatNumber(value, f, n)));
  }
  /**
   * Drive LEDs from per-bit levels (MSB first) — useful for floating/contended
   * buses. Pass `readout` to also update the number readouts.
   */
  setLevels(levels: Level[], readout?: number) {
    this.value = -1;
    levels.forEach((l, i) => this.leds[i]?.set(l));
    if (readout !== undefined) (this.opts.formats ?? []).forEach((f, i) => setText(this.readouts[i], formatNumber(readout, f, this.opts.bits)));
  }
}

// ---------------------------------------------------------------------------
// Switches & buttons

export interface ToggleOptions {
  label?: string;
  value?: boolean;
  onLabel?: string;
  offLabel?: string;
  title?: string;
  onChange?: (v: boolean) => void;
}

export class Toggle {
  readonly el: HTMLLabelElement;
  private input: HTMLInputElement;
  private stateText: HTMLSpanElement | null = null;
  constructor(private opts: ToggleOptions = {}) {
    this.input = h('input', { type: 'checkbox', checked: !!opts.value });
    this.input.addEventListener('change', () => {
      this.sync();
      opts.onChange?.(this.input.checked);
    });
    if (opts.onLabel || opts.offLabel) this.stateText = h('span', { class: 'toggle-state' });
    this.el = h('label', { class: 'toggle', title: opts.title }, this.input, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-knob' })), opts.label ? h('span', { class: 'toggle-label' }, opts.label) : null, this.stateText);
    this.sync();
  }
  get value() {
    return this.input.checked;
  }
  set(v: boolean) {
    if (this.input.checked !== v) {
      this.input.checked = v;
      this.sync();
    }
  }
  private sync() {
    if (this.stateText) setText(this.stateText, this.input.checked ? (this.opts.onLabel ?? '') : (this.opts.offLabel ?? ''));
  }
}

export interface ButtonOptions {
  label: string;
  /** Shown instead of `label` on narrow screens (e.g. "Pulse" for "Clock pulse"). */
  shortLabel?: string;
  /**
   * Every label `setLabel` will show (["Run", "Stop"]): the button stays as wide as the widest,
   * so the buttons after it don't move when it changes.
   */
  labels?: string[];
  title?: string;
  kind?: 'default' | 'primary' | 'danger' | 'ghost';
  onClick?: () => void;
  /** Momentary push button: fires on press and release (mouse, touch, keyboard). */
  onPress?: () => void;
  onRelease?: () => void;
  disabled?: boolean;
}

export class Button {
  readonly el: HTMLButtonElement;
  constructor(opts: ButtonOptions) {
    const label = opts.labels
      ? h('span', { class: 'btn-labels' }, opts.labels.map((t) => h('span', { class: t === opts.label ? 'shown' : '' }, t)))
      : opts.shortLabel
        ? [h('span', { class: 'btn-label-long' }, opts.label), h('span', { class: 'btn-label-short' }, opts.shortLabel)]
        : opts.label;
    this.el = h('button', { class: `btn btn-${opts.kind ?? 'default'}`, title: opts.title, type: 'button', disabled: opts.disabled }, label);
    if (opts.onClick) this.el.addEventListener('click', opts.onClick);
    if (opts.onPress || opts.onRelease) {
      let down = false;
      const press = (e: Event) => {
        if (down) return;
        down = true;
        this.el.classList.add('pressed');
        opts.onPress?.();
        e.preventDefault();
      };
      const release = () => {
        if (!down) return;
        down = false;
        this.el.classList.remove('pressed');
        opts.onRelease?.();
      };
      this.el.addEventListener('pointerdown', press);
      this.el.addEventListener('pointerup', release);
      this.el.addEventListener('pointerleave', release);
      this.el.addEventListener('keydown', (e) => (e.key === ' ' || e.key === 'Enter') && press(e));
      this.el.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && release());
    }
  }
  /** Replaces the label (and any short label), or shows another of `labels`. */
  setLabel(text: string) {
    const labels = this.el.querySelector(':scope > .btn-labels');
    if (labels && [...labels.children].some((l) => l.textContent === text)) {
      for (const l of labels.children) setClass(l, 'shown', l.textContent === text);
    } else setText(this.el, text);
  }
  setDisabled(d: boolean) {
    this.el.disabled = d;
  }
}

export interface DipSwitchOptions {
  bits: number;
  value?: number;
  label?: string;
  /** Captions under each switch, MSB first. */
  captions?: string[];
  onChange?: (v: number) => void;
}

/** A bank of DIP switches; MSB on the left. Click a switch to flip it. */
export class DipSwitch {
  readonly el: HTMLDivElement;
  private switches: HTMLButtonElement[];
  value: number;
  constructor(private opts: DipSwitchOptions) {
    this.value = opts.value ?? 0;
    this.switches = Array.from({ length: opts.bits }, (_, i) => {
      const bit = opts.bits - 1 - i;
      const b = h('button', { type: 'button', class: 'dip', title: `bit ${bit}`, 'aria-label': `bit ${bit}` }, h('span', { class: 'dip-knob' }));
      b.addEventListener('click', () => {
        this.value ^= 1 << bit;
        this.render();
        opts.onChange?.(this.value);
      });
      return opts.captions ? h('span', { class: 'led-cell' }, b, h('span', { class: 'led-caption' }, opts.captions[i])) : b;
    }) as HTMLButtonElement[];
    this.el = h('div', { class: 'dipswitch' }, opts.label ? h('span', { class: 'ledbar-label' }, opts.label) : null, h('span', { class: 'dip-bank' }, this.switches));
    this.render();
  }
  set(v: number) {
    this.value = v;
    this.render();
  }
  private render() {
    this.el.querySelectorAll('.dip').forEach((d, i) => {
      const on = ((this.value >> (this.opts.bits - 1 - i)) & 1) === 1;
      setClass(d, 'on', on);
      d.setAttribute('aria-pressed', String(on)); // a toggle: screen readers say on or off
    });
  }
}

export interface SliderOptions {
  label?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  /** Logarithmic scale (min must be > 0). */
  log?: boolean;
  format?: (v: number) => string;
  onInput?: (v: number) => void;
}

export class Slider {
  readonly el: HTMLLabelElement;
  private input: HTMLInputElement;
  private out: HTMLSpanElement;
  value: number;
  constructor(private opts: SliderOptions) {
    this.value = opts.value;
    this.input = h('input', { type: 'range', min: 0, max: 1000, step: 1 });
    this.out = h('span', { class: 'slider-value' });
    this.input.addEventListener('input', () => {
      this.value = this.fromPos(Number(this.input.value));
      setText(this.out, this.fmt(this.value));
      opts.onInput?.(this.value);
    });
    this.el = h('label', { class: 'slider' }, opts.label ? h('span', { class: 'slider-label' }, opts.label) : null, this.input, this.out);
    this.set(opts.value);
  }
  private fmt(v: number) {
    return this.opts.format ? this.opts.format(v) : String(+v.toPrecision(4));
  }
  private toPos(v: number) {
    const { min, max, log } = this.opts;
    const t = log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
    return Math.round(Math.max(0, Math.min(1, t)) * 1000);
  }
  private fromPos(p: number) {
    const { min, max, log, step } = this.opts;
    const t = p / 1000;
    let v = log ? min * Math.pow(max / min, t) : min + (max - min) * t;
    if (step) v = Math.round(v / step) * step;
    return Math.max(min, Math.min(max, v));
  }
  set(v: number) {
    this.value = v;
    this.input.value = String(this.toPos(v));
    setText(this.out, this.fmt(v));
  }
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/** The `<label>` returned by `select()`, with a handle on its `<select>`. */
export type SelectControl<T extends string> = HTMLLabelElement & {
  /** The `<select>` element itself. */
  readonly selectEl: HTMLSelectElement;
  /** Current value. */
  getValue(): T;
  /** Change the value from code (does not call `onChange`). */
  setValue(v: T): void;
};

export function select<T extends string>(options: SelectOption<T>[], value: T, onChange: (v: T) => void, label?: string): SelectControl<T> {
  const sel = h('select', null, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value as T));
  const el = h('label', { class: 'select' }, label ? h('span', { class: 'slider-label' }, label) : null, sel) as SelectControl<T>;
  Object.defineProperty(el, 'selectEl', { value: sel });
  el.getValue = () => sel.value as T;
  el.setValue = (v: T) => {
    if (sel.value !== v) sel.value = v;
  };
  return el;
}

// ---------------------------------------------------------------------------
// 7-segment display

/**
 * One 7-segment digit. Segment byte layout matches Ben's EEPROM code:
 * bit 7 = dp, 6 = a, 5 = b, 4 = c, 3 = d, 2 = e, 1 = f, 0 = g.
 */
export class SevenSegment {
  readonly el: SVGSVGElement;
  private segs: SVGElement[];
  private value = -1;
  private dimmed = false;
  constructor(opts: { height?: number; color?: 'red' | 'green' | 'blue' } = {}) {
    const H = opts.height ?? 64;
    // segment polygons in a 60x100 box (slanted slightly)
    const seg = (pts: string, name: string) => s('polygon', { points: pts, class: `seg seg-${name}` });
    const shapes: [string, string][] = [
      ['a', '14,4 50,4 44,10 20,10'],
      ['b', '51,6 51,46 46,42 45,12'],
      ['c', '51,54 51,94 45,88 46,58'],
      ['d', '14,96 50,96 44,90 20,90'],
      ['e', '13,54 13,94 19,88 18,58'],
      ['f', '13,6 13,46 18,42 19,12'],
      ['g', '16,50 22,45 42,45 48,50 42,55 22,55'],
    ];
    this.segs = shapes.map(([n, p]) => seg(p, n));
    const dp = s('circle', { cx: 57, cy: 94, r: 3.5, class: 'seg seg-dp' });
    this.segs.push(dp);
    this.el = s('svg', { viewBox: '0 0 64 100', width: (H * 64) / 100, height: H, class: `sevenseg sevenseg-${opts.color ?? 'red'}`, role: 'img', 'aria-label': segmentName(0) }, this.segs);
    this.set(0);
  }
  /**
   * Segment byte (dp a b c d e f g). `brightness` (0..1) dims lit segments,
   * either all of them or per segment in the order a b c d e f g dp, e.g.
   * for persistence-of-vision demos. A brightness of 0 turns a segment off.
   */
  set(byte: number, brightness?: number | ArrayLike<number>) {
    if (byte === this.value && brightness === undefined && !this.dimmed) return;
    this.value = byte;
    const bits = [0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01, 0x80];
    let lit = 0;
    this.segs.forEach((el, i) => {
      const b = brightness === undefined ? 1 : typeof brightness === 'number' ? brightness : (brightness[i] ?? 1);
      const on = (byte & bits[i]) !== 0 && b > 0;
      if (on) lit |= bits[i];
      setClass(el, 'on', on);
      const op = on && b < 1 ? String(Math.round(Math.max(0.05, b) * 1000) / 1000) : '';
      if (el.style.opacity !== op) el.style.opacity = op;
    });
    const name = segmentName(lit);
    if (this.el.getAttribute('aria-label') !== name) this.el.setAttribute('aria-label', name);
    this.dimmed = brightness !== undefined;
  }
}

/** The characters a 7-segment digit shows, by its lit segments (dp a b c d e f g, a = 0x40): both forms of 6, 7 and 9. */
const SEGMENT_CHARS: Record<number, string> = {
  0x7e: '0', 0x30: '1', 0x6d: '2', 0x79: '3', 0x33: '4', 0x5b: '5', 0x5f: '6', 0x1f: 'b', 0x70: '7', 0x72: '7', 0x7f: '8', 0x7b: '9', 0x73: '9',
  0x77: 'A', 0x4e: 'C', 0x3d: 'd', 0x4f: 'E', 0x47: 'F', 0x37: 'H', 0x0e: 'L', 0x67: 'P', 0x3e: 'U', 0x01: 'minus',
};

/** A 7-segment digit's name for screen readers: the character it shows, else its lit segments. */
export function segmentName(byte: number): string {
  const dp = byte & 0x80 ? ' and its point' : '';
  const ch = SEGMENT_CHARS[byte & 0x7f];
  if ((byte & 0x7f) === 0) return dp ? '7-segment digit: only its point' : '7-segment digit: blank';
  if (ch) return `7-segment digit: ${ch}${dp}`;
  const names = 'abcdefg'.split('').filter((_, i) => byte & (0x40 >> i));
  return `7-segment digit: segments ${names.join(' ')}${dp}`;
}

// ---------------------------------------------------------------------------
// Layout helpers

export interface PanelOptions {
  /** Accent colour of the module (matches LED colour). */
  accent?: LedColor | 'gray';
  subtitle?: string;
  class?: string;
  /** Chip list shown in small print, e.g. "74LS173 ×2, 74LS245". */
  chips?: string;
}

/** A breadboard-style module card. */
export function panel(title: string, opts: PanelOptions = {}, ...children: (Node | null | undefined | false)[]): HTMLElement {
  return h(
    'section',
    { class: `panel accent-${opts.accent ?? 'gray'} ${opts.class ?? ''}` },
    h('header', { class: 'panel-head' }, h('h2', null, title), opts.subtitle ? h('span', { class: 'panel-sub' }, opts.subtitle) : null),
    h('div', { class: 'panel-body' }, children.filter(Boolean) as Node[]),
    opts.chips ? h('footer', { class: 'panel-chips' }, opts.chips) : null,
  );
}

export function row(...children: (Node | string | null | undefined | false)[]): HTMLDivElement {
  return h('div', { class: 'row' }, children.filter((c) => c !== null && c !== undefined && c !== false) as (Node | string)[]);
}

export function note(...children: (Node | string)[]): HTMLParagraphElement {
  return h('p', { class: 'note' }, children);
}

/** Key/value readout list. Returns the element and a setter per key. */
export function readouts(keys: string[]): { el: HTMLDListElement; set: (key: string, value: string) => void } {
  const vals = new Map<string, HTMLElement>();
  const el = h(
    'dl',
    { class: 'kv' },
    keys.flatMap((k) => {
      const dd = h('dd');
      vals.set(k, dd);
      return [h('dt', null, k), dd];
    }),
  );
  return { el, set: (k, v) => vals.get(k) && setText(vals.get(k)!, v) };
}

// ---------------------------------------------------------------------------
// Oscilloscope / logic analyser

/** A vertical line across all scope lanes, at a sample position (0 = left edge). */
export interface ScopeMarker {
  at: number;
  color?: string;
  label?: string;
  dashed?: boolean;
}

export interface ScopeChannel {
  label: string;
  color?: string;
  /** 'digital' channels take Level values; 'analog' take numbers in [min, max]. */
  kind?: 'digital' | 'analog';
  min?: number;
  max?: number;
  /** Optional horizontal guide lines for analog channels (e.g. 1/3 and 2/3 Vcc). */
  guides?: number[];
  /** Colour of a second, dashed trace in an analog lane (`draw`'s `overlays`), e.g. a moving threshold. */
  overlayColor?: string;
}

export class Scope {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  constructor(
    readonly channels: ScopeChannel[],
    opts: { width?: number; laneHeight?: number } = {},
  ) {
    const w = opts.width ?? 640;
    const lh = opts.laneHeight ?? 44;
    this.canvas = h('canvas', { width: w * 2, height: channels.length * lh * 2, class: 'scope-canvas' });
    this.canvas.style.width = '100%';
    this.canvas.style.maxWidth = `${w}px`;
    this.canvas.style.aspectRatio = `${w} / ${channels.length * lh}`;
    this.ctx = this.canvas.getContext?.('2d') ?? null;
    this.el = h('div', { class: 'scope' }, this.canvas);
  }

  /**
   * samples[channel][i]; all channels same length; newest last. `cursor`
   * (and any `markers`) draw vertical lines at a sample position in window
   * coordinates: 0 is the left edge, `window - 1` the right edge. `overlays[c]` adds a dashed
   * second trace to analog channel c, in its `overlayColor`.
   */
  draw(samples: (Level | number)[][], opts: { window?: number; cursor?: number | null; markers?: ScopeMarker[]; overlays?: (number[] | undefined)[] } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.canvas.width;
    const lh = this.canvas.height / this.channels.length;
    ctx.clearRect(0, 0, W, this.canvas.height);
    const n = opts.window ?? Math.max(...samples.map((s) => s.length), 2);
    const dx = W / Math.max(1, n - 1);
    const labelW = 0;
    const styles = getComputedStyle(this.canvas);
    const fg = styles.getPropertyValue('--fg-dim').trim() || '#888';
    const grid = styles.getPropertyValue('--grid').trim() || '#333';
    this.channels.forEach((ch, c) => {
      const top = c * lh;
      const pad = lh * 0.2;
      const yHi = top + pad + 10;
      const yLo = top + lh - pad;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, top + lh - 0.5);
      ctx.lineTo(W, top + lh - 0.5);
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.font = `${Math.round(lh * 0.22)}px ui-monospace, monospace`;
      ctx.fillText(ch.label, 6, top + Math.round(lh * 0.24));
      const data = samples[c] ?? [];
      const offset = n - data.length;
      ctx.strokeStyle = ch.color ?? '#4ade80';
      ctx.lineWidth = 3;
      if (ch.kind === 'analog') {
        const min = ch.min ?? 0, max = ch.max ?? 1;
        const y = (v: number) => yLo - ((v - min) / (max - min)) * (yLo - yHi);
        for (const g of ch.guides ?? []) {
          ctx.save();
          ctx.setLineDash([8, 8]);
          ctx.strokeStyle = grid;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, y(g));
          ctx.lineTo(W, y(g));
          ctx.stroke();
          ctx.restore();
        }
        const trace = (vals: readonly (Level | number)[]) => {
          const off = n - vals.length;
          ctx.beginPath();
          vals.forEach((v, i) => {
            const px = labelW + (i + off) * dx;
            const py = y(typeof v === 'number' ? v : 0);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.stroke();
        };
        trace(data);
        const over = opts.overlays?.[c];
        if (over?.length) {
          ctx.save();
          ctx.setLineDash([10, 6]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = ch.overlayColor ?? fg;
          trace(over);
          ctx.restore();
        }
        return;
      }
      // digital
      let prevY: number | null = null;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        const x0 = labelW + (i + offset) * dx;
        const x1 = x0 + dx;
        if (v === 'X') {
          ctx.fillStyle = 'rgba(248,113,113,0.35)';
          ctx.fillRect(x0, yHi, dx, yLo - yHi);
          prevY = null;
          continue;
        }
        const yy = v === 1 ? yHi : v === 0 ? yLo : (yHi + yLo) / 2;
        ctx.save();
        if (v === 'Z') {
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = fg;
        }
        ctx.beginPath();
        if (prevY !== null && prevY !== yy) {
          ctx.moveTo(x0, prevY);
          ctx.lineTo(x0, yy);
        } else ctx.moveTo(x0, yy);
        ctx.lineTo(x1, yy);
        ctx.stroke();
        ctx.restore();
        prevY = yy;
      }
    });
    const marks: ScopeMarker[] = [...(opts.markers ?? [])];
    if (opts.cursor !== undefined && opts.cursor !== null) marks.push({ at: opts.cursor, color: '#fbbf24', dashed: true });
    for (const m of marks) {
      const x = Math.round(labelW + m.at * dx) + 0.5;
      ctx.save();
      ctx.strokeStyle = m.color ?? '#fbbf24';
      ctx.lineWidth = 2;
      if (m.dashed) ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
      if (m.label) {
        ctx.setLineDash([]);
        ctx.fillStyle = m.color ?? '#fbbf24';
        ctx.font = `${Math.round(lh * 0.2)}px ui-monospace, monospace`;
        const tw = ctx.measureText(m.label).width;
        ctx.fillText(m.label, x + 6 + tw > W ? x - 6 - tw : x + 6, Math.round(lh * 0.24));
      }
      ctx.restore();
    }
  }
}
