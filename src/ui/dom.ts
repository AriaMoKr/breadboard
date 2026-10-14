/** Minimal DOM helpers (no framework). */

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
};

function append(parent: Node, child: Child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) child.forEach((c) => append(parent, c));
  else if (child instanceof Node) parent.appendChild(child);
  else parent.appendChild(document.createTextNode(String(child)));
}

function applyProps(el: Element, props: Props | null | undefined) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign((el as HTMLElement).style, v);
    } else if (k === 'dataset') Object.assign((el as HTMLElement).dataset, v as Record<string, string>);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && !(el instanceof SVGElement)) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

/** Create an HTML element: h('button', { class: 'btn', onClick }, 'Go'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  children.forEach((c) => append(el, c));
  return el;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element: s('circle', { cx: 5, cy: 5, r: 3 }). */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, unknown> | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.setAttribute('class', String(v));
      else el.setAttribute(k, String(v));
    }
  children.forEach((c) => append(el, c));
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

/** Toggle a class only when it changes (cheap in hot render loops). */
export function setClass(el: Element, cls: string, on: boolean) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/**
 * requestAnimationFrame loop. `cb` gets the elapsed ms since the last frame.
 * Returns a stop function. Safe to call in non-browser environments (no-op).
 */
export function animate(cb: (dtMs: number, nowMs: number) => void): () => void {
  if (typeof requestAnimationFrame === 'undefined') return () => {};
  let last = performance.now();
  let id = 0;
  let stopped = false;
  const loop = (now: number) => {
    if (stopped) return;
    const dt = now - last;
    last = now;
    cb(dt, now);
    id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
  };
}

/** Collects cleanup callbacks; call `dispose()` once. */
export class Disposer {
  private fns: (() => void)[] = [];
  add(fn: (() => void) | void | undefined | null) {
    if (fn) this.fns.push(fn);
  }
  listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void): void;
  listen(target: EventTarget, type: string, fn: (e: Event) => void): void;
  listen(target: EventTarget, type: string, fn: (e: Event) => void) {
    target.addEventListener(type, fn);
    this.fns.push(() => target.removeEventListener(type, fn));
  }
  dispose = () => {
    const fns = this.fns.splice(0);
    for (let i = fns.length - 1; i >= 0; i--) fns[i]();
  };
}
