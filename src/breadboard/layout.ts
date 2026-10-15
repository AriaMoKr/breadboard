import type { Computer } from '../sim/computer';
import type { Machine } from '../sim/machine';
import { CHIPS, pinNumber, type ChipDef } from './catalog';
import {
  BOARD_H, BOARD_W, RAIL_COLUMNS, ROWS, dipPinHole, holeName, holeXY, isRail, parseHole, stripHoles, stripOf,
  type BoardPlacement, type Hole, type Rail,
} from './geometry';

/**
 * Breadboard layouts: boards, parts placed in their holes, and wires.
 * Layouts are plain data (JSON-serialisable) so the sandbox can save them;
 * live bindings to the simulator are kept separately (`LiveBindings`).
 */

export type LedColor = 'red' | 'green' | 'yellow' | 'blue' | 'white' | 'orange';
export type WireColor = 'red' | 'black' | 'blue' | 'yellow' | 'green' | 'white' | 'orange' | 'purple' | 'gray' | 'brown';
export type PortSide = 'left' | 'right' | 'top' | 'bottom';

interface PartCommon {
  id: string;
  /** Board the part sits on. */
  board: string;
  /** Optional reference designator / caption, e.g. "U9" or "D1". */
  label?: string;
}

export type PartSpec =
  /** DIP chip; pin 1 at column `col` (row f for 0.3", row h for 0.6"), notch left. `rotated` turns it 180°. */
  | { kind: 'chip'; chip: string; col: number; rotated?: boolean; params?: Record<string, unknown> }
  | { kind: 'led'; color: LedColor; anode: string; cathode: string }
  | { kind: 'resistor'; ohms: number; a: string; b: string }
  | { kind: 'capacitor'; farads: number; a: string; b: string; polarized?: boolean }
  /** Jumper wire. `via` are optional board-local bend points (pitch units). */
  | { kind: 'wire'; color: WireColor; a: string; b: string; via?: [number, number][] }
  /** DIP switch bank straddling the channel (rows e/f) starting at column `col`; switch k joins (f, col+k-1) and (e, col+k-1). */
  | { kind: 'dip'; positions: number; col: number }
  /** Momentary push button between two holes (normally open). */
  | { kind: 'button'; a: string; b: string }
  /** SPDT switch: position 0 joins common–a, position 1 joins common–b. */
  | { kind: 'slide'; a: string; common: string; b: string; initial?: 0 | 1 }
  | { kind: 'pot'; ohms: number; a: string; wiper: string; b: string }
  /** 10-pin 7-segment display (0.6" pin rows d/h) with pin 1 at column `col`. */
  | { kind: 'seg7'; col: number; common: 'cathode' | 'anode' }
  /** Named off-board connection (net label), e.g. "BUS3", "CLK", "~AI". Same name = same net. */
  | { kind: 'port'; name: string; hole: string; side: PortSide; hidden?: boolean }
  /** Silkscreen-style text on the board (board-local pitch units). */
  | { kind: 'text'; text: string; x: number; y: number; size?: number };

export type Part = PartCommon & PartSpec;
export type PartKind = PartSpec['kind'];

export interface BoardSpec {
  id: string;
  place: BoardPlacement;
  /** Caption printed on the board, e.g. "A register". */
  title?: string;
  /**
   * What the four rails carry: 'power' (default: tp/bp = +5 V, tn/bn = GND)
   * or 'signal' (each rail is an ordinary net, e.g. the 8 bus lines run on
   * the rails of two boards turned 90°).
   */
  rails?: 'power' | 'signal';
}

export interface Layout {
  boards: BoardSpec[];
  parts: Part[];
}

// ---------------------------------------------------------------------------
// Pins of parts

/** 10-pin common-cathode/anode 7-segment display (5161AS style), pin -> function. */
export const SEG7_PINS = ['e', 'd', 'com', 'c', 'dp', 'b', 'a', 'com', 'f', 'g'] as const;

export interface PartPin {
  /** Pin name ("1", "VCC", "anode", "a", "1Q", ...). */
  name: string;
  /** 1-based pin number for packaged parts, else index+1. */
  number: number;
  hole: string;
}

/** The holes a part's legs occupy (wires: both ends; ports: their hole). */
export function partPins(p: Part): PartPin[] {
  switch (p.kind) {
    case 'chip': {
      const def = CHIPS[p.chip];
      if (!def) throw new Error(`Unknown chip "${p.chip}" (part ${p.id})`);
      return def.pins.map((name, i) => ({ name, number: i + 1, hole: dipPinHole(p.col, def.pins.length, i + 1, def.spacing, p.rotated) }));
    }
    case 'dip': {
      const pins: PartPin[] = [];
      for (let k = 1; k <= p.positions; k++) {
        pins.push({ name: `${k}a`, number: k, hole: `f${p.col + k - 1}` });
        pins.push({ name: `${k}b`, number: 2 * p.positions + 1 - k, hole: `e${p.col + k - 1}` });
      }
      return pins;
    }
    case 'seg7':
      return SEG7_PINS.map((name, i) => ({ name, number: i + 1, hole: dipPinHole(p.col, 10, i + 1, 6) }));
    case 'led': return [{ name: 'anode', number: 1, hole: p.anode }, { name: 'cathode', number: 2, hole: p.cathode }];
    case 'resistor':
    case 'capacitor':
    case 'button':
    case 'wire': return [{ name: 'a', number: 1, hole: p.a }, { name: 'b', number: 2, hole: p.b }];
    case 'slide': return [{ name: 'a', number: 1, hole: p.a }, { name: 'common', number: 2, hole: p.common }, { name: 'b', number: 3, hole: p.b }];
    case 'pot': return [{ name: 'a', number: 1, hole: p.a }, { name: 'wiper', number: 2, hole: p.wiper }, { name: 'b', number: 3, hole: p.b }];
    case 'port': return [{ name: p.name, number: 1, hole: p.hole }];
    case 'text': return [];
  }
}

/** Holes a part's legs occupy. */
export const partHoles = (p: Part) => partPins(p).map((x) => x.hole);

// ---------------------------------------------------------------------------
// Validation

export interface LayoutProblem {
  part?: string;
  message: string;
}

/** Holes that don't exist, two legs in one hole, parts on unknown boards, duplicate ids. */
export function validateLayout(layout: Layout): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const boards = new Set(layout.boards.map((b) => b.id));
  if (boards.size !== layout.boards.length) problems.push({ message: 'Duplicate board id' });
  const ids = new Set<string>();
  const used = new Map<string, string>();
  for (const p of layout.parts) {
    if (ids.has(p.id)) problems.push({ part: p.id, message: `Duplicate part id "${p.id}"` });
    ids.add(p.id);
    if (!boards.has(p.board)) problems.push({ part: p.id, message: `Unknown board "${p.board}"` });
    let pins: PartPin[] = [];
    try {
      pins = partPins(p);
    } catch (e) {
      problems.push({ part: p.id, message: (e as Error).message });
      continue;
    }
    for (const pin of pins) {
      try {
        parseHole(pin.hole);
      } catch (e) {
        problems.push({ part: p.id, message: `${p.id}.${pin.name}: ${(e as Error).message}` });
        continue;
      }
      const key = `${p.board}:${pin.hole}`;
      const other = used.get(key);
      if (other && other !== p.id) problems.push({ part: p.id, message: `${p.id}.${pin.name} and ${other} both use hole ${key}` });
      used.set(key, p.id);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Live bindings (the breadboard view of the running computer)

export type LiveLed = (c: Computer, m: Machine) => boolean;
export type LiveSeg7 = (c: Computer, m: Machine) => number;

export type LiveControl =
  | { kind: 'button'; press: (m: Machine) => void; release?: (m: Machine) => void }
  | { kind: 'slide'; get: (m: Machine) => 0 | 1; set: (m: Machine, pos: 0 | 1) => void }
  | { kind: 'dip'; get: (m: Machine) => number; set: (m: Machine, value: number) => void }
  | { kind: 'pot'; get: (m: Machine) => number; set: (m: Machine, t: number) => void };

export interface LiveBindings {
  /** LED part id -> lit? */
  leds: Record<string, LiveLed>;
  /** 7-seg part id -> segment byte (dp a b c d e f g, like src/sim/display.ts). */
  seg7: Record<string, LiveSeg7>;
  /** Interactive part id -> what it does. DIP value: bit k-1 = switch k is ON. */
  controls: Record<string, LiveControl>;
}

export const emptyBindings = (): LiveBindings => ({ leds: {}, seg7: {}, controls: {} });

/** A module of the computer drawn on one or more boards. */
export interface ModuleBoardDef {
  id: string;
  title: string;
  /** Short description shown on hover / in the legend. */
  description: string;
  /** Video numbers (1-based playlist index) where this board is built. */
  videos: number[];
  layout: Layout;
  live: LiveBindings;
}

// ---------------------------------------------------------------------------
// Builder API

export interface ChipHandle {
  id: string;
  def: ChipDef;
  /** Hole of a pin, by number (1-based) or datasheet name ("VCC", "~OE", "Q3"). */
  pin(p: number | string): string;
  /**
   * A free hole in the same strip as pin `p`, nearest to the chip first; skip
   * `skip` free holes. Throws if the strip is full.
   */
  free(p: number | string, skip?: number): string;
}

export interface LedHandle {
  id: string;
  /** Bind to the simulator: lit when `fn` returns true. */
  live(fn: LiveLed): LedHandle;
}

/**
 * Programmatic layout builder with occupancy checking. Typical use:
 *
 *   const b = new LayoutBuilder();
 *   const bb = b.board('a', { x: 0, y: 0 }, 'A register');
 *   const u1 = bb.chip('U9', '74LS173', 10);
 *   bb.toVcc(u1.pin('VCC'));
 *   bb.toGnd(u1.pin('GND'));
 *   bb.led('D1', 'red', u1.free('Q3'), 'tn12')... // anode in Q3's strip
 */
export class LayoutBuilder {
  readonly boards: BoardSpec[] = [];
  readonly parts: Part[] = [];
  readonly live: LiveBindings = emptyBindings();
  private used = new Map<string, string>(); // "board:hole" -> part id
  private auto = 0;

  board(id: string, place: Partial<BoardPlacement> = {}, title?: string, opts: { rails?: 'power' | 'signal' } = {}): BoardBuilder {
    if (this.boards.some((b) => b.id === id)) throw new Error(`Duplicate board "${id}"`);
    this.boards.push({ id, place: { x: place.x ?? 0, y: place.y ?? 0, rotate: place.rotate ?? 0 }, title, rails: opts.rails });
    return new BoardBuilder(this, id);
  }

  /** Internal: add a part after checking that its holes are free. */
  add(part: Part): Part {
    if (this.parts.some((p) => p.id === part.id)) throw new Error(`Duplicate part id "${part.id}"`);
    for (const pin of partPins(part)) {
      parseHole(pin.hole); // throws on bad holes
      const key = `${part.board}:${pin.hole}`;
      const other = this.used.get(key);
      if (other) throw new Error(`${part.id}.${pin.name} -> hole ${pin.hole} on board "${part.board}" is already used by ${other}`);
    }
    for (const pin of partPins(part)) this.used.set(`${part.board}:${pin.hole}`, part.id);
    this.parts.push(part);
    return part;
  }

  isFree(board: string, hole: string): boolean {
    return !this.used.has(`${board}:${hole}`);
  }

  nextId(prefix: string): string {
    return `${prefix}${++this.auto}`;
  }

  build(): Layout {
    return { boards: this.boards.map((b) => ({ ...b, place: { ...b.place } })), parts: this.parts.map((p) => ({ ...p })) };
  }

  /** Build a module definition (layout + live bindings). */
  module(meta: Omit<ModuleBoardDef, 'layout' | 'live'>): ModuleBoardDef {
    return { ...meta, layout: this.build(), live: this.live };
  }
}

export class BoardBuilder {
  constructor(
    readonly b: LayoutBuilder,
    readonly id: string,
  ) {}

  private part<T extends PartSpec>(id: string, spec: T, label?: string): Part {
    return this.b.add({ id, board: this.id, label, ...spec } as Part);
  }

  isFree(hole: string): boolean {
    return this.b.isFree(this.id, hole);
  }

  /** Free holes of the strip containing `hole`, ordered away from the channel (or along the rail). */
  freeInStrip(hole: string): string[] {
    const h = parseHole(hole);
    let holes = stripHoles(stripOf(h));
    if (!isRail(h.row) && ROWS.indexOf(h.row) < 5) holes = [...holes].reverse(); // e,d,c,b,a for the top half
    if (isRail(h.row)) holes = [...holes].sort((x, y) => Math.abs(parseHole(x).col - h.col) - Math.abs(parseHole(y).col - h.col));
    return holes.filter((x) => x !== holeName(h) && this.isFree(x));
  }

  chip(id: string, chip: string, col: number, opts: { rotated?: boolean; label?: string; params?: Record<string, unknown> } = {}): ChipHandle {
    const def = CHIPS[chip];
    if (!def) throw new Error(`Unknown chip "${chip}"`);
    this.part(id, { kind: 'chip', chip, col, rotated: opts.rotated, params: opts.params }, opts.label ?? id);
    const pinHole = (p: number | string) => {
      const n = typeof p === 'number' ? p : pinNumber(def, p);
      if (n < 1 || n > def.pins.length) throw new Error(`${chip} has no pin ${n}`);
      return dipPinHole(col, def.pins.length, n, def.spacing, opts.rotated);
    };
    return {
      id,
      def,
      pin: pinHole,
      free: (p, skip = 0) => {
        const holes = this.freeInStrip(pinHole(p));
        if (holes.length <= skip) throw new Error(`No free hole next to ${id}.${p}`);
        return holes[skip];
      },
    };
  }

  led(id: string, color: LedColor, anode: string, cathode: string, label?: string): LedHandle {
    this.part(id, { kind: 'led', color, anode, cathode }, label);
    const h: LedHandle = {
      id,
      live: (fn) => {
        this.b.live.leds[id] = fn;
        return h;
      },
    };
    return h;
  }

  resistor(id: string, ohms: number, a: string, b: string, label?: string) {
    this.part(id, { kind: 'resistor', ohms, a, b }, label);
    return id;
  }

  capacitor(id: string, farads: number, a: string, b: string, polarized = false, label?: string) {
    this.part(id, { kind: 'capacitor', farads, a, b, polarized }, label);
    return id;
  }

  /** Jumper wire between two holes on this board. */
  wire(a: string, b: string, color: WireColor = 'blue', via?: [number, number][]): string {
    const id = this.b.nextId(`${this.id}.w`);
    this.part(id, { kind: 'wire', color, a, b, via });
    return id;
  }

  /**
   * Wire routed along a horizontal "lane" at board-local y (pitch units):
   * up/down from `a` to the lane, across, then to `b`. Keeps long parallel
   * runs from lying on top of each other. Lanes between hole rows (e.g.
   * 11.0, 12.0) look like wires lying flat between the rows.
   */
  wireLane(a: string, b: string, laneY: number, color: WireColor = 'blue'): string {
    const pa = holeXY(a), pb = holeXY(b);
    return this.wire(a, b, color, [[pa.x, laneY], [pb.x, laneY]]);
  }

  dip(id: string, positions: number, col: number, control?: Extract<LiveControl, { kind: 'dip' }>, label?: string) {
    this.part(id, { kind: 'dip', positions, col }, label);
    if (control) this.b.live.controls[id] = control;
    return {
      id,
      /** Hole of switch k's leg: 'bottom' = row f, 'top' = row e. */
      pin: (k: number, side: 'top' | 'bottom') => `${side === 'bottom' ? 'f' : 'e'}${col + k - 1}`,
    };
  }

  button(id: string, a: string, b: string, control?: Extract<LiveControl, { kind: 'button' }>, label?: string) {
    this.part(id, { kind: 'button', a, b }, label);
    if (control) this.b.live.controls[id] = control;
    return id;
  }

  slide(id: string, a: string, common: string, b: string, control?: Extract<LiveControl, { kind: 'slide' }>, label?: string) {
    this.part(id, { kind: 'slide', a, common, b }, label);
    if (control) this.b.live.controls[id] = control;
    return id;
  }

  pot(id: string, ohms: number, a: string, wiper: string, b: string, control?: Extract<LiveControl, { kind: 'pot' }>, label?: string) {
    this.part(id, { kind: 'pot', ohms, a, wiper, b }, label);
    if (control) this.b.live.controls[id] = control;
    return id;
  }

  seg7(id: string, col: number, common: 'cathode' | 'anode' = 'cathode', live?: LiveSeg7, label?: string) {
    this.part(id, { kind: 'seg7', col, common }, label);
    if (live) this.b.live.seg7[id] = live;
    return { id, pin: (n: number | (typeof SEG7_PINS)[number]) => dipPinHole(col, 10, typeof n === 'number' ? n : SEG7_PINS.indexOf(n) + 1, 6) };
  }

  /**
   * Off-board connection label at `hole` (e.g. "BUS3", "CLK", "~AI").
   * `hidden` draws only the connection dot, for ports that between-board
   * wires end on directly (the bus rails), where a tag would cross the board.
   */
  port(name: string, hole: string, side: PortSide = 'right', opts: { hidden?: boolean } = {}) {
    const id = this.b.nextId(`${this.id}.port.${name}.`);
    this.part(id, { kind: 'port', name, hole, side, hidden: opts.hidden || undefined });
    return id;
  }

  text(text: string, x: number, y: number, size = 1.1) {
    const id = this.b.nextId(`${this.id}.t`);
    this.part(id, { kind: 'text', text, x, y, size });
    return id;
  }

  // ---- power helpers ----------------------------------------------------------

  /** Nearest free hole on `rail` to column `col`. */
  railHole(rail: Rail, col: number): string {
    const cols = [...RAIL_COLUMNS].sort((x, y) => Math.abs(x - col) - Math.abs(y - col));
    for (const c of cols) if (this.isFree(`${rail}${c}`)) return `${rail}${c}`;
    throw new Error(`Rail ${rail} on board ${this.id} is full`);
  }

  /** Wire `hole` to +5 V (top rail for rows a-e, bottom rail for f-j). Red wire. */
  toVcc(hole: string, color: WireColor = 'red'): string {
    const h = parseHole(hole);
    const rail: Rail = isRail(h.row) ? 'tp' : ROWS.indexOf(h.row) < 5 ? 'tp' : 'bp';
    return this.wire(this.freeOr(hole), this.railHole(rail, h.col), color);
  }

  /** Wire `hole` to ground (top rail for rows a-e, bottom rail for f-j). Black wire. */
  toGnd(hole: string, color: WireColor = 'black'): string {
    const h = parseHole(hole);
    const rail: Rail = isRail(h.row) ? 'tn' : ROWS.indexOf(h.row) < 5 ? 'tn' : 'bn';
    return this.wire(this.freeOr(hole), this.railHole(rail, h.col), color);
  }

  /** `hole` itself if free, otherwise the nearest free hole in its strip. */
  freeOr(hole: string): string {
    if (this.isFree(hole)) return hole;
    const f = this.freeInStrip(hole);
    if (!f.length) throw new Error(`Strip of ${hole} on board ${this.id} is full`);
    return f[0];
  }
}

// ---------------------------------------------------------------------------

/** Scene bounding box of a layout (pitch units). */
export function layoutBounds(layout: Layout): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of layout.boards) {
    const w = b.place.rotate === 90 ? BOARD_H : BOARD_W;
    const hh = b.place.rotate === 90 ? BOARD_W : BOARD_H;
    x0 = Math.min(x0, b.place.x);
    y0 = Math.min(y0, b.place.y);
    x1 = Math.max(x1, b.place.x + w);
    y1 = Math.max(y1, b.place.y + hh);
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: BOARD_W, h: BOARD_H };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Offset a layout's boards (and namespace ids) to merge several into one scene. */
export function placeLayout(layout: Layout, dx: number, dy: number, prefix = ''): Layout {
  const pre = (s: string) => (prefix ? `${prefix}/${s}` : s);
  return {
    boards: layout.boards.map((b) => ({ ...b, id: pre(b.id), place: { ...b.place, x: b.place.x + dx, y: b.place.y + dy } })),
    parts: layout.parts.map((p) => ({ ...p, id: pre(p.id), board: pre(p.board) })),
  };
}

export type { Hole };
