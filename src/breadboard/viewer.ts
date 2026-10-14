import { h } from '../ui/dom';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pan/zoom container for an SVG scene. Wheel (or pinch) zooms around the
 * pointer, dragging the background pans, buttons zoom in/out/fit. Works on
 * the SVG viewBox, so everything stays crisp.
 */
export class PanZoom {
  readonly el: HTMLDivElement;
  svg: SVGSVGElement;
  private view: Rect;
  /** Whether the last pointer gesture moved far enough to count as a drag (not a click). */
  private moved = false;
  private downAt: { x: number; y: number } | null = null;
  private drag: { x: number; y: number; view: Rect; id: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; view: Rect; cx: number; cy: number } | null = null;
  private ro: ResizeObserver | null = null;

  constructor(
    svg: SVGSVGElement,
    public content: Rect,
    opts: { height?: string; hint?: string } = {},
  ) {
    this.svg = svg;
    this.view = { ...content };
    const btn = (label: string, title: string, fn: () => void) => h('button', { type: 'button', class: 'btn', title, onClick: fn }, label);
    this.el = h(
      'div',
      { class: 'bb-viewport' },
      svg,
      h('div', { class: 'bb-zoom' }, btn('−', 'Zoom out', () => this.zoomBy(1.4)), btn('+', 'Zoom in', () => this.zoomBy(1 / 1.4)), btn('Fit', 'Show everything', () => this.fit())),
      opts.hint ? h('div', { class: 'bb-hint' }, opts.hint) : null,
    );
    if (opts.height) this.el.style.height = opts.height;
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(Math.sign(e.deltaY) * Math.min(0.25, Math.abs(e.deltaY) / 400));
      this.zoomAt(this.toScene(e.clientX, e.clientY), f);
    }, { passive: false });
    this.el.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
      this.moved = false;
      const t = e.target as Element;
      if (t.closest('.interactive, .bb-zoom, button, .no-pan')) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const c = this.toScene((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { ...this.view }, cx: c.x, cy: c.y };
        this.drag = null;
      } else {
        this.drag = { x: e.clientX, y: e.clientY, view: { ...this.view }, id: e.pointerId };
        this.el.classList.add('dragging');
      }
      this.el.setPointerCapture?.(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) this.moved = true;
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const f = this.pinch.d / Math.max(10, d);
        const v = this.pinch.view;
        this.setView({ x: this.pinch.cx - (this.pinch.cx - v.x) * f, y: this.pinch.cy - (this.pinch.cy - v.y) * f, w: v.w * f, h: v.h * f });
        return;
      }
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const scale = this.unitsPerPixel();
      this.setView({ ...this.drag.view, x: this.drag.view.x - (e.clientX - this.drag.x) * scale, y: this.drag.view.y - (e.clientY - this.drag.y) * scale });
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.drag?.id === e.pointerId) this.drag = null;
      this.el.classList.remove('dragging');
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.apply());
      this.ro.observe(this.el);
    }
    this.apply();
  }

  dispose() {
    this.ro?.disconnect();
  }

  /** True if the pointer gesture that just ended was a drag/pan rather than a click. */
  wasDrag(): boolean {
    return this.moved;
  }

  /** Swap in a re-rendered SVG, keeping the current zoom/pan. */
  replaceSvg(svg: SVGSVGElement, content?: Rect) {
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svg.replaceWith(svg);
    this.svg = svg;
    if (content) this.content = content;
    this.apply();
  }

  /** Scene units per screen pixel at the current zoom. */
  unitsPerPixel(): number {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return 1;
    return Math.max(this.view.w / r.width, this.view.h / r.height);
  }

  toScene(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const k = this.unitsPerPixel();
    // preserveAspectRatio meet: the view is centred in the element
    const cx = this.view.x + this.view.w / 2, cy = this.view.y + this.view.h / 2;
    return { x: cx + (clientX - r.left - r.width / 2) * k, y: cy + (clientY - r.top - r.height / 2) * k };
  }

  zoomAt(p: { x: number; y: number }, f: number) {
    const min = 6, max = Math.max(this.content.w, this.content.h) * 3;
    const nw = Math.min(max, Math.max(min, this.view.w * f));
    const k = nw / this.view.w;
    this.setView({ x: p.x - (p.x - this.view.x) * k, y: p.y - (p.y - this.view.y) * k, w: this.view.w * k, h: this.view.h * k });
  }

  zoomBy(f: number) {
    this.zoomAt({ x: this.view.x + this.view.w / 2, y: this.view.y + this.view.h / 2 }, f);
  }

  fit() {
    this.setView({ ...this.content });
  }

  /** Show a scene rectangle (with a little margin). */
  zoomTo(r: Rect, margin = 2) {
    this.setView({ x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + 2 * margin });
  }

  setView(v: Rect) {
    this.view = v;
    this.apply();
  }

  getView(): Rect {
    return { ...this.view };
  }

  private apply() {
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }
}
