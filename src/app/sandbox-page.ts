import { CHIPS, CHIP_IDS, prettyPin } from '../breadboard/catalog';
import { holeXY, parseHole, toScene } from '../breadboard/geometry';
import { layoutBounds, partPins, validateLayout, type Layout, type LedColor, type Part, type PartSpec, type WireColor } from '../breadboard/layout';
import { LayoutView, LED_COLORS, WIRE_COLORS, formatOhms, type PartEvent } from '../breadboard/render';
import { endAt, movedPart, type At } from '../breadboard/move';
import { decodeLayout, encodeLayout } from '../breadboard/share';
import type { BoardSimulator, SimProblem } from '../breadboard/sim/types';
import { PanZoom } from '../breadboard/viewer';
import type { Level } from '../logic/circuit';
import { Button, Slider, select } from '../ui/components';
import { Disposer, animate, h, media, s, setText } from '../ui/dom';

/**
 * Breadboard sandbox: place chips and parts on a BB830, wire them, and the
 * chip-level engine (src/breadboard/sim) simulates the result live.
 */

type SimCtor = new (layout: Layout) => BoardSimulator;
interface ExampleDef { id: string; title: string; description: string; build(): Layout }

// Lazy so the sandbox (and the engine) only load on this page.
const engineModules = import.meta.glob<{ BreadboardSim: SimCtor }>('../breadboard/sim/engine.ts');
const exampleModules = import.meta.glob<{ EXAMPLES: ExampleDef[] }>('../breadboard/examples/index.ts');

type Tool =
  | { kind: 'select' }
  | { kind: 'move' }
  | { kind: 'delete' }
  | { kind: 'probe' }
  | { kind: 'wire'; color: WireColor }
  | { kind: 'chip'; chip: string }
  | { kind: 'led'; color: LedColor }
  | { kind: 'resistor'; ohms: number }
  | { kind: 'capacitor'; farads: number }
  | { kind: 'button' }
  | { kind: 'slide' }
  | { kind: 'dip'; positions: number }
  | { kind: 'seg7'; common: 'cathode' | 'anode' };

const STORAGE_KEY = 'breadboard-sandbox-v1';
const BOARD = 'bb1';

const emptyLayout = (): Layout => ({ boards: [{ id: BOARD, place: { x: 0, y: 0 }, title: 'Sandbox' }], parts: [] });

function loadSaved(): Layout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const l = JSON.parse(raw) as Layout;
    return Array.isArray(l?.boards) && Array.isArray(l?.parts) ? l : null;
  } catch {
    return null;
  }
}

function save(layout: Layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable: the sandbox still works, it just won't persist */
  }
}

const levelText = (l: Level) => (l === 1 ? 'HIGH (1)' : l === 0 ? 'LOW (0)' : l === 'Z' ? 'floating (Z)' : 'contention / unknown (X)');

export function mountSandboxPage(root: HTMLElement): () => void {
  const d = new Disposer();
  let layout: Layout = loadSaved() ?? emptyLayout();
  const history: string[] = [];
  let tool: Tool = { kind: 'select' };
  let pending: { board: string; hole: string } | null = null; // first click of a two-point part
  let rotated = false;
  let nextId = 1 + layout.parts.length;
  let Sim: SimCtor | null = null;
  let sim: BoardSimulator | null = null;
  let simError = '';
  let examples: ExampleDef[] = [];
  let speed = 40; // gate delays per animation frame
  let running = true;

  // ---- view -------------------------------------------------------------------
  let view = new LayoutView(layout, { onEvent: (id, ev) => onPartEvent(id, ev), padding: 3 });
  const content = () => {
    const b = layoutBounds(layout);
    return { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 };
  };
  const pz = new PanZoom(view.el, content(), {
    height: '58vh',
    hint: 'Pick a part, then click holes · drag to pan · wheel to zoom',
    touchHint: 'Pick a part, tap to zoom in, then tap holes · drag to pan · pinch to zoom',
    tapZoom: true,
  });
  d.add(() => pz.dispose());
  const ghost = s('g', { class: 'sb-ghost' });

  const rerender = () => {
    moving = null; // what was in hand is part of the new layout, or gone (undo)
    press = null;
    dragging = false;
    view = new LayoutView(layout, { onEvent: (id, ev) => onPartEvent(id, ev), padding: 3 });
    view.layerOverlay.appendChild(ghost);
    pz.replaceSvg(view.el, content());
    bindPointer();
    refreshSim();
    renderParts();
  };

  const commit = (next: Layout) => {
    history.push(JSON.stringify(layout));
    if (history.length > 100) history.shift();
    layout = next;
    save(layout);
    rerender();
  };

  const undo = () => {
    const prev = history.pop();
    if (!prev) return;
    layout = JSON.parse(prev);
    save(layout);
    rerender();
  };

  // ---- simulation -------------------------------------------------------------
  const refreshSim = () => {
    if (!Sim) return;
    try {
      sim = new Sim(layout);
      simError = '';
      // the switches stay where they were set: on the new board and in the new simulator
      for (const [id, v] of [...switchState]) {
        const part = layout.parts.find((p) => p.id === id);
        if (part?.kind === 'slide') {
          sim.setSlide(id, v as 0 | 1);
          view.setSlide(id, v as 0 | 1);
        } else if (part?.kind === 'dip') {
          sim.setDip(id, v);
          view.setDip(id, v);
        } else switchState.delete(id);
      }
      sim.settle(5000);
    } catch (e) {
      sim = null;
      simError = (e as Error).message;
    }
    updateOutputs();
    renderProblems();
  };

  const timeEl = h('span', { class: 'mono dim small sb-time', title: 'Time in the simulation, in gate delays' });
  const updateOutputs = () => {
    if (!sim) return;
    for (const p of layout.parts) {
      if (p.kind === 'led') view.setLed(p.id, sim.ledLit(p.id));
      else if (p.kind === 'seg7') view.setSeg7(p.id, sim.seg7(p.id));
    }
    setText(timeEl, `t = ${sim.time.toLocaleString('en-US')}`);
  };

  const switchState = new Map<string, number>(); // slide position / DIP value (per part)

  const onPartEvent = (id: string, ev: PartEvent) => {
    if (tool.kind === 'delete' || tool.kind === 'move') return; // they take the click themselves
    if (!sim) return;
    const part = layout.parts.find((p) => p.id === id);
    if (!part) return;
    if (ev.type === 'press') sim.press(id);
    else if (ev.type === 'release') sim.release(id);
    else if (ev.type === 'toggle' && part.kind === 'slide') {
      const pos = (switchState.get(id) ?? part.initial ?? 0) ? 0 : 1;
      switchState.set(id, pos);
      sim.setSlide(id, pos as 0 | 1);
      view.setSlide(id, pos as 0 | 1);
    } else if (ev.type === 'dip' && part.kind === 'dip') {
      const v = (switchState.get(id) ?? 0) ^ (1 << ev.bit);
      switchState.set(id, v);
      sim.setDip(id, v);
      view.setDip(id, v);
    }
    // running, the circuit settles at once; paused, Step shows the change spread
    if (running) sim.settle(2000);
    else setStatus('Paused: Step shows what that changes, a gate delay at a time.');
    updateOutputs();
  };

  d.add(
    animate(() => {
      if (!sim || !running) return;
      sim.step(speed);
      updateOutputs();
    }),
  );

  // ---- placement --------------------------------------------------------------
  const id = (prefix: string) => {
    let n = nextId++;
    while (layout.parts.some((p) => p.id === `${prefix}${n}`)) n = nextId++;
    return `${prefix}${n}`;
  };

  /** Parts the current tool would place given its anchor/second hole. */
  const candidate = (a: { board: string; hole: string }, b?: { board: string; hole: string }): Part | null => {
    const hole = parseHole(a.hole);
    const base = { board: a.board };
    switch (tool.kind) {
      case 'chip':
        return { ...base, id: id('U'), kind: 'chip', chip: tool.chip, col: hole.col, rotated } as Part;
      case 'dip':
        return { ...base, id: id('SW'), kind: 'dip', positions: tool.positions, col: hole.col } as Part;
      case 'seg7':
        return { ...base, id: id('DS'), kind: 'seg7', col: hole.col, common: tool.common } as Part;
      case 'slide': {
        if (hole.row.length > 1) return null;
        return { ...base, id: id('SW'), kind: 'slide', a: `${hole.row}${hole.col}`, common: `${hole.row}${hole.col + 1}`, b: `${hole.row}${hole.col + 2}` } as Part;
      }
      default: {
        if (!b) return null;
        if (b.board !== a.board) return null;
        const spec: PartSpec | null =
          tool.kind === 'wire' ? { kind: 'wire', color: tool.color, a: a.hole, b: b.hole }
          : tool.kind === 'led' ? { kind: 'led', color: tool.color, anode: a.hole, cathode: b.hole }
          : tool.kind === 'resistor' ? { kind: 'resistor', ohms: tool.ohms, a: a.hole, b: b.hole }
          : tool.kind === 'capacitor' ? { kind: 'capacitor', farads: tool.farads, a: a.hole, b: b.hole }
          : tool.kind === 'button' ? { kind: 'button', a: a.hole, b: b.hole }
          : null;
        if (!spec) return null;
        const prefix = spec.kind === 'wire' ? 'W' : spec.kind === 'led' ? 'D' : spec.kind === 'resistor' ? 'R' : spec.kind === 'capacitor' ? 'C' : 'SW';
        return { ...base, id: id(prefix), ...spec } as Part;
      }
    }
  };

  const twoPoint = () => tool.kind === 'wire' || tool.kind === 'led' || tool.kind === 'resistor' || tool.kind === 'capacitor' || tool.kind === 'button';

  /** Why `p` can't go where it is, among the other parts (a moved part keeps its id). */
  const fits = (p: Part): string | null => {
    const problems = validateLayout({ boards: layout.boards, parts: [...layout.parts.filter((x) => x.id !== p.id), p] }).filter((x) => x.part === p.id);
    return problems.length ? problems[0].message : null;
  };

  const drawGhost = (p: Part | null, firstHole?: At, bad?: At) => {
    ghost.replaceChildren();
    const mark = (board: string, hole: string, cls: string) => {
      try {
        const b = view.boardOf(board);
        if (!b) return;
        const c = toScene(b.place, holeXY(hole));
        ghost.appendChild(s('rect', { x: c.x - 0.45, y: c.y - 0.45, width: 0.9, height: 0.9, rx: 0.15, class: cls }));
      } catch {
        /* off-board */
      }
    };
    if (firstHole) mark(firstHole.board, firstHole.hole, 'sb-mark first');
    if (bad) mark(bad.board, bad.hole, 'sb-mark bad');
    if (!p) return;
    let ok = true;
    try {
      ok = fits(p) === null;
    } catch {
      ok = false;
    }
    try {
      for (const pin of partPins(p)) mark(p.board, pin.hole, ok ? 'sb-mark ok' : 'sb-mark bad');
    } catch {
      /* part runs off the board */
    }
  };

  const status = h('div', { class: 'sb-status mono' });
  const setStatus = (t: string) => setText(status, t);

  const holeInfo = (board: string, hole: string): string => {
    const lvl = sim ? sim.level(board, hole) : null;
    const on = layout.parts.flatMap((p) => {
      try {
        return partPins(p).filter((x) => x.hole === hole && p.board === board).map((x) => `${p.label ?? p.id}${p.kind === 'chip' ? ` pin ${x.number} ${prettyPin(x.name)}` : p.kind === 'wire' ? '' : ` ${x.name}`}`);
      } catch {
        return [];
      }
    });
    return `${hole}${on.length ? ` · ${on.join(', ')}` : ''}${lvl !== null ? ` · ${levelText(lvl)}` : ''}`;
  };

  const bindPointer = () => {
    const svg = view.el;
    // Move: a press on a part, taken before the part (a switch would flip) and the panning. It
    // becomes a drag once the pointer moves; else the click that follows picks the part up.
    svg.addEventListener('pointerdown', (e) => {
      afterDrag = false;
      if (tool.kind !== 'move' || moving || e.button !== 0) return;
      const part = partOf(e), from = part && grabbedAt(e);
      if (!part || !from) return;
      e.stopPropagation();
      press = { part, from, at: view.scenePoint(e.clientX, e.clientY), x: e.clientX, y: e.clientY, slop: e.pointerType === 'touch' ? 10 : 4 };
    }, true);
    svg.addEventListener('pointerup', (e) => {
      const was = dragging;
      press = null;
      dragging = false;
      if (!was) return;
      afterDrag = true;
      const err = putDown(targetOf(e));
      if (err) putBack(`${err} It went back.`);
    });
    svg.addEventListener('pointercancel', () => {
      if (dragging) putBack();
      press = null;
      dragging = false;
    });
    svg.addEventListener('pointermove', (e) => {
      if (press && !dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > press.slop) {
        dragging = true;
        try {
          svg.setPointerCapture(e.pointerId); // keep the drag when the pointer leaves the board
        } catch {
          /* the pointer is gone */
        }
        pickUp(press.part, press.from, press.at);
      }
      if (tool.kind === 'move' && moving) {
        const to = targetOf(e);
        const p = to && movedPart(moving.part, moving.from, to);
        return p ? drawGhost(p) : drawGhost(null, undefined, to ?? undefined);
      }
      const hit = view.holeAt(view.scenePoint(e.clientX, e.clientY));
      if (!hit) {
        drawGhost(null, pending ?? undefined);
        return;
      }
      setStatus(holeInfo(hit.board, hit.hole));
      if (tool.kind === 'select' || tool.kind === 'delete' || tool.kind === 'probe' || tool.kind === 'move') return drawGhost(null);
      if (twoPoint()) drawGhost(pending ? candidate(pending, hit) : null, pending ?? hit);
      else drawGhost(candidate(hit));
    });
    svg.addEventListener('pointerleave', () => drawGhost(null, pending ?? undefined));
    // Delete takes the click before the part does (capture): a switch's own click handler would
    // flip it and keep the click to itself.
    svg.addEventListener('click', (e) => {
      if (tool.kind !== 'delete' || pz.wasDrag()) return;
      e.stopPropagation();
      const target = (e.target as Element).closest('[data-part]') as SVGGElement | null;
      if (target?.dataset.part) commit({ ...layout, parts: layout.parts.filter((p) => p.id !== target.dataset.part) });
    }, true);
    // Move: a click picks a part up, the next puts it down (also before the part: capture)
    svg.addEventListener('click', (e) => {
      if (tool.kind !== 'move') return;
      e.stopPropagation();
      if (afterDrag) return void (afterDrag = false); // the end of a drag, already put down
      const part = partOf(e);
      if (!part && pz.wasDrag()) return; // panned
      if (moving) {
        const err = putDown(targetOf(e));
        if (err) setStatus(err);
        return;
      }
      const from = part && grabbedAt(e);
      if (part && from) pickUp(part, from, view.scenePoint(e.clientX, e.clientY));
    }, true);
    svg.addEventListener('click', (e) => {
      if (pz.wasDrag() || tool.kind === 'delete' || tool.kind === 'move') return;
      const hit = view.holeAt(view.scenePoint(e.clientX, e.clientY));
      if (hit) setStatus(holeInfo(hit.board, hit.hole)); // touch screens have no hover
      if (!hit || tool.kind === 'select' || tool.kind === 'probe') return;
      if (twoPoint()) {
        if (!pending) {
          pending = hit;
          drawGhost(null, hit);
          return;
        }
        const p = candidate(pending, hit);
        pending = null;
        if (p) place(p);
        return;
      }
      const p = candidate(hit);
      if (p) place(p);
    });
  };

  const place = (p: Part) => {
    const err = (() => {
      try {
        return fits(p);
      } catch (e) {
        return (e as Error).message;
      }
    })();
    if (err) {
      setStatus(`Can't place here: ${err}`);
      return;
    }
    commit({ ...layout, parts: [...layout.parts, p] });
  };

  // ---- moving -----------------------------------------------------------------------
  // The Move tool: a click on a part picks it up and a click on a hole puts it there, or a drag
  // does both. Picked up by an end, a wire or a two-legged part moves only that end (move.ts).
  /** The part in hand, the hole it was picked up at, and where the pointer was then (scene). */
  let moving: { part: Part; from: At; at: { x: number; y: number } } | null = null;
  /** A press on a part, which becomes a drag once the pointer moves further than `slop` px. */
  let press: { part: Part; from: At; at: { x: number; y: number }; x: number; y: number; slop: number } | null = null;
  let dragging = false;
  let afterDrag = false; // the click a drag ends with

  const partOf = (e: Event): Part | null => {
    const el = (e.target as Element).closest('[data-part]') as SVGGElement | null;
    return (el && layout.parts.find((p) => p.id === el.dataset.part)) ?? null;
  };
  /** The hole a part is picked up at: under the pointer, or the nearest (a chip's body is over the channel). */
  const grabbedAt = (e: MouseEvent): At | null => {
    const pt = view.scenePoint(e.clientX, e.clientY);
    return view.holeAt(pt) ?? view.holeAt(pt, 2);
  };
  const nameOf = (p: Part) => p.label ?? p.id;
  const liftedEl = () => (moving ? view.el.querySelector(`[data-part="${CSS.escape(moving.part.id)}"]`) : null);
  /** Where the part in hand goes for the pointer at `e`: the hole it was picked up at, moved as far as the pointer has. */
  const targetOf = (e: MouseEvent): At | null => {
    if (!moving) return null;
    const p = view.scenePoint(e.clientX, e.clientY), h = view.holeScene(moving.from.board, moving.from.hole);
    return view.holeAt({ x: h.x + p.x - moving.at.x, y: h.y + p.y - moving.at.y }, 2);
  };
  const pickUp = (part: Part, from: At, at: { x: number; y: number }) => {
    moving = { part, from, at };
    liftedEl()?.classList.add('sb-lifted');
    const what = endAt(part, from) ? `The end of ${nameOf(part)} at ${from.hole}` : nameOf(part);
    setStatus(`${what} in hand: ${dragging ? 'let go' : 'click'} over the hole to put it in · Esc puts it back.`);
  };
  const putBack = (why?: string) => {
    if (!moving) return;
    liftedEl()?.classList.remove('sb-lifted');
    moving = null;
    drawGhost(null);
    setStatus(why ?? hintFor(tool));
  };
  /** Put the part in hand down over `to`: null when done, else why it can't go there. */
  const putDown = (to: At | null): string | null => {
    if (!moving) return null;
    const p = to && movedPart(moving.part, moving.from, to);
    if (!p) return `${nameOf(moving.part)} can't go there: off the board.`;
    if (JSON.stringify(p) === JSON.stringify(moving.part)) {
      putBack(); // put down where it was
      return null;
    }
    let err: string | null;
    try {
      err = fits(p);
    } catch (e) {
      err = (e as Error).message;
    }
    if (err) return `${nameOf(p)} can't go there: ${err}`;
    moving = null;
    commit({ ...layout, parts: layout.parts.map((x) => (x.id === p.id ? p : x)) });
    setStatus(`Moved ${nameOf(p)}.`);
    return null;
  };

  // ---- palette ----------------------------------------------------------------
  // On narrow screens the palette is a drawer above the board, closed once you pick a part,
  // so the board isn't pushed off the screen. Its summary names the part in hand.
  const narrow = media('(max-width: 860px)');
  const toolName = h('span', { class: 'sb-drawer-tool mono' }, 'Use');
  const toolButtons: { el: HTMLButtonElement; matches: (t: Tool) => boolean }[] = [];
  const toolBtn = (label: string, t: Tool, title: string, swatch?: string) => {
    const el = h('button', { type: 'button', class: 'sb-tool', title }, swatch ? h('i', { style: `background:${swatch}` }) : null, label);
    el.addEventListener('click', () => {
      putBack();
      tool = t;
      pending = null;
      pz.el.classList.toggle('sb-move-tool', t.kind === 'move');
      drawGhost(null);
      toolButtons.forEach((b) => b.el.classList.toggle('active', b.matches(tool)));
      setStatus(hintFor(t));
      setText(toolName, t.kind === 'chip' ? t.chip : label && t.kind !== 'led' ? label : title.replace(' (anode first)', ''));
      if (narrow?.matches) drawer.open = false;
    });
    toolButtons.push({ el, matches: (x) => JSON.stringify(x) === JSON.stringify(t) });
    return el;
  };
  const hintFor = (t: Tool) =>
    t.kind === 'select' ? 'Select: click buttons, switches and DIP switches to operate them.'
    : t.kind === 'move' ? 'Move: click a part, then the hole to put it in, or drag it there. Pick a wire or a leg up by its end to move just that end.'
    : t.kind === 'delete' ? 'Delete: click a part or wire to remove it.'
    : t.kind === 'probe' ? 'Probe: hover any hole to see its logic level.'
    : t.kind === 'chip' && rotated ? `Click the hole for pin 1 (row e, chip turned round: notch on the right). ↻ 180° or R turns it back. ${CHIPS[t.chip].title}.`
    : t.kind === 'chip' ? `Click the hole for pin 1 (row f, notch on the left). ↻ 180° or R turns it round. ${CHIPS[t.chip].title}.`
    : t.kind === 'dip' || t.kind === 'seg7' ? 'Click the hole for pin 1.'
    : t.kind === 'slide' ? 'Click the leftmost of three holes in a row.'
    : 'Click the first hole, then the second.';

  // Chips can be turned round with the R key or this button (touch screens have no keyboard).
  const rotateBtn = h('button', { type: 'button', class: 'sb-tool', title: 'Place chips turned 180° (pin 1 top right). Key: R', 'aria-pressed': 'false' }, '↻ 180°');
  const setRotated = (r: boolean) => {
    rotated = r;
    rotateBtn.setAttribute('aria-pressed', String(r));
    setStatus(tool.kind === 'chip' ? hintFor(tool) : `Chips are placed ${r ? 'turned 180° (pin 1 top right)' : 'notch left (pin 1 bottom left)'}.`);
  };
  rotateBtn.addEventListener('click', () => setRotated(!rotated));

  const group =(title: string, ...items: HTMLElement[]) => h('div', { class: 'sb-group' }, h('div', { class: 'sb-group-title' }, title), h('div', { class: 'sb-tools' }, items));
  const palette = h(
    'div',
    { class: 'sb-palette' },
    group(
      'Tools',
      toolBtn('Use', { kind: 'select' }, 'Operate switches and buttons'),
      toolBtn('Move', { kind: 'move' }, 'Move parts and wires, or one end of a wire'),
      toolBtn('Probe', { kind: 'probe' }, 'Hover holes to read levels'),
      toolBtn('Delete', { kind: 'delete' }, 'Remove parts'),
    ),
    group('Wires', ...(['red', 'black', 'blue', 'yellow', 'green', 'white', 'orange', 'purple'] as WireColor[]).map((c) => toolBtn('', { kind: 'wire', color: c }, `${c} wire`, WIRE_COLORS[c]))),
    group('Chips', rotateBtn, ...CHIP_IDS.map((c) => toolBtn(c.replace('74LS', ''), { kind: 'chip', chip: c }, `${c}: ${CHIPS[c].title}`))),
    group(
      'Parts',
      ...(['red', 'green', 'yellow', 'blue'] as LedColor[]).map((c) => toolBtn('LED', { kind: 'led', color: c }, `${c} LED (anode first)`, LED_COLORS[c])),
      ...[220, 1000, 10000].map((r) => toolBtn(formatOhms(r), { kind: 'resistor', ohms: r }, `${formatOhms(r)} resistor`)),
      toolBtn('Cap', { kind: 'capacitor', farads: 1e-7 }, '0.1 µF capacitor (ignored by the logic simulator)'),
      toolBtn('Button', { kind: 'button' }, 'Momentary push button'),
      toolBtn('Switch', { kind: 'slide' }, 'Slide switch (SPDT)'),
      toolBtn('DIP 4', { kind: 'dip', positions: 4 }, '4-position DIP switch'),
      toolBtn('DIP 8', { kind: 'dip', positions: 8 }, '8-position DIP switch'),
      toolBtn('7-seg', { kind: 'seg7', common: 'cathode' }, 'Common-cathode 7-segment display'),
    ),
  );
  toolButtons[0].el.classList.add('active');
  const drawer = h('details', { class: 'sb-drawer' }, h('summary', null, h('span', null, 'Parts'), toolName), palette);
  drawer.open = !narrow?.matches;
  if (narrow) d.listen(narrow, 'change', () => (drawer.open = !narrow.matches));

  // ---- toolbar ----------------------------------------------------------------
  const setRunning = (on: boolean) => {
    running = on;
    runBtn.setLabel(on ? 'Pause' : 'Run');
  };
  const runBtn = new Button({ label: 'Pause', labels: ['Pause', 'Run'], onClick: () => setRunning(!running) });
  /**
   * Pause, then on to the next change: a gate delay at a time while one spreads through the
   * gates, or as far as the 555's next edge when nothing else is coming.
   */
  const step = () => {
    if (!sim) return;
    setRunning(false);
    const { steps, changed } = sim.stepToChange();
    updateOutputs();
    setStatus(
      changed
        ? `Step: ${changed} net${changed === 1 ? '' : 's'} changed, ${steps === 1 ? '1 gate delay' : `${steps.toLocaleString('en-US')} gate delays`} on.`
        : 'Step: nothing more is going to change. Press a button or flip a switch, then Step again.',
    );
  };
  const stepBtn = new Button({ label: 'Step', title: 'Pause, then on to the next change: a gate delay at a time while one spreads (key S)', onClick: step });
  const speedSlider = new Slider({ label: 'Speed', min: 1, max: 5000, value: speed, log: true, format: (v) => `${Math.round(v)} gate delays/frame`, onInput: (v) => (speed = Math.round(v)) });
  const exampleHost = h('span');
  const toolbar = h(
    'div',
    { class: 'toolbar' },
    exampleHost,
    new Button({ label: 'Undo', title: 'Ctrl+Z', onClick: undo }).el,
    new Button({ label: 'Clear', kind: 'danger', onClick: () => commit(emptyLayout()) }).el,
    new Button({ label: 'Add board', title: 'Add another breadboard below', onClick: () => {
      const n = layout.boards.length;
      commit({ ...layout, boards: [...layout.boards, { id: `bb${n + 1}`, place: { x: 0, y: n * 25 }, title: `Board ${n + 1}` }] });
    } }).el,
    new Button({ label: 'Export', title: 'Copy the layout as JSON', onClick: () => {
      const json = JSON.stringify(layout, null, 1);
      void navigator.clipboard?.writeText(json).then(() => setStatus('Layout JSON copied to the clipboard.'), () => setStatus('Clipboard unavailable.'));
    } }).el,
    new Button({ label: 'Import', title: 'Paste layout JSON', onClick: () => {
      const json = prompt('Paste layout JSON');
      if (!json) return;
      try {
        const l = JSON.parse(json) as Layout;
        if (!Array.isArray(l.boards) || !Array.isArray(l.parts)) throw new Error('not a layout');
        commit(l);
      } catch (e) {
        setStatus(`Import failed: ${(e as Error).message}`);
      }
    } }).el,
    new Button({ label: 'Share link', title: 'A link that opens this circuit in anyone’s sandbox', onClick: () => void shareLink() }).el,
    new Button({ label: '◈ View in VR', shortLabel: '◈ VR', title: 'This circuit in 3D on a table, in a VR headset or on this screen', onClick: () => void viewInVR() }).el,
    h('span', { class: 'sb-run' }, runBtn.el, stepBtn.el, timeEl, speedSlider.el),
  );

  // ---- problems & parts list -------------------------------------------------------
  const problemsEl = h('ul', { class: 'sb-problems' });
  const renderProblems = () => {
    const items: string[] = [];
    if (!Sim) items.push('Loading the simulator…');
    if (simError) items.push(`Simulator error: ${simError}`);
    let probs: SimProblem[] = [];
    try {
      probs = sim?.problems() ?? [];
    } catch {
      probs = [];
    }
    for (const p of probs) items.push(p.message);
    problemsEl.replaceChildren(...(items.length ? items.map((t) => h('li', null, t)) : [h('li', { class: 'ok' }, 'No problems found.')]));
  };
  const partsEl = h('div', { class: 'sb-parts dim small' });
  const renderParts = () => {
    const counts = new Map<string, number>();
    for (const p of layout.parts) {
      const k = p.kind === 'chip' ? p.chip : p.kind;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    setText(partsEl, counts.size ? [...counts].map(([k, n]) => `${n}× ${k}`).join(' · ') : 'Empty board: pick a part on the left.');
  };

  d.listen(window, 'keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === 'r' || e.key === 'R') {
      setRotated(!rotated);
    } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      step();
    } else if (e.key === 'Escape') {
      pending = null;
      putBack();
      drawGhost(null);
    }
  });

  root.append(
    toolbar,
    h('div', { class: 'sb-layout' }, drawer, h('div', { class: 'sb-main' }, pz.el, status, partsEl)),
    h('div', { class: 'sb-side' }, h('h4', null, 'Checks'), problemsEl),
  );
  view.layerOverlay.appendChild(ghost);
  bindPointer();
  renderParts();
  renderProblems();
  setStatus(hintFor(tool));

  // ---- circuit links (#/sandbox/c1.…) ----------------------------------------------
  let disposed = false;
  d.add(() => (disposed = true));
  /** Share a link to this circuit: the share sheet on phones, else the clipboard. */
  async function shareLink() {
    const url = `${location.origin}${location.pathname}#/sandbox/${await encodeLayout(layout)}`;
    if (navigator.share && media('(pointer: coarse)')?.matches) {
      try {
        await navigator.share({ title: 'Breadboard circuit', url });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus(`Link copied to the clipboard (${url.length} characters). It opens this circuit in anyone’s sandbox.`);
    } catch {
      prompt('Copy this link:', url);
    }
  }
  /** This circuit in the VR view: vr.html with the circuit in its link. The board stays saved here. */
  async function viewInVR() {
    location.assign(new URL(`vr.html#${await encodeLayout(layout)}`, location.href).href);
  }
  // Opening a link replaces the board as one change, so Undo brings back the circuit you had.
  const code = location.hash.replace(/^#\/?/, '').split('/')[1];
  if (code) {
    window.history.replaceState(null, '', '#/sandbox'); // so a reload doesn't load it again over your edits
    void decodeLayout(code).then((shared) => {
      if (disposed) return;
      switchState.clear();
      commit(shared);
      setStatus('Loaded the circuit from the link. Undo brings back the one you had.');
      pz.fit();
    }, () => !disposed && setStatus('That link does not hold a circuit.'));
  }

  // ---- lazy engine + examples ---------------------------------------------------
  const engineLoader = engineModules['../breadboard/sim/engine.ts'];
  if (engineLoader)
    void engineLoader().then((m) => {
      Sim = m.BreadboardSim;
      refreshSim();
    }, (e) => {
      simError = `could not load the engine (${(e as Error).message})`;
      renderProblems();
    });
  else {
    simError = 'the chip-level engine is not available yet';
    renderProblems();
  }
  const exLoader = exampleModules['../breadboard/examples/index.ts'];
  if (exLoader)
    void exLoader().then((m) => {
      examples = m.EXAMPLES ?? [];
      exampleHost.replaceChildren(
        select([{ value: '', label: 'Load an example…' }, ...examples.map((x) => ({ value: x.id, label: x.title }))], '', (v) => {
          const ex = examples.find((x) => x.id === v);
          if (!ex) return;
          switchState.clear();
          commit(ex.build());
          setStatus(ex.description);
          pz.fit();
        }),
      );
    });

  return d.dispose;
}
