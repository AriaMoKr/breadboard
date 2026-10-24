import { BOARD_H, BOARD_W } from './geometry';
import { placeLayout, type Layout, type LiveBindings, type ModuleBoardDef } from './layout';

/**
 * Where each module's boards sit in the full-computer scene, following Ben's
 * build: modules on the left and right of the bus, control logic at the
 * bottom left. Units are pitch (0.1"). A module's own layout starts at its
 * local (0, 0); multi-board modules stack their boards downwards (every
 * extra board at local y = n · ROW).
 */

export const ROW = BOARD_H + 7; // board height + room for titles and port tags
export const LEFT_X = 0;
export const BUS_X = BOARD_W + 6;
export const BUS_W = 38; // two boards turned 90° side by side
export const RIGHT_X = BUS_X + BUS_W + 6;

/** Module id -> scene origin. Unknown modules are appended at the bottom. */
export const MODULE_SLOTS: Record<string, { x: number; y: number }> = {
  clock: { x: LEFT_X, y: 0 },
  mar: { x: LEFT_X, y: ROW },
  ram: { x: LEFT_X, y: 2 * ROW },
  ir: { x: LEFT_X, y: 4 * ROW },
  control: { x: LEFT_X, y: 5 * ROW },
  bus: { x: BUS_X, y: 0 },
  pc: { x: RIGHT_X, y: 0 },
  'a-register': { x: RIGHT_X, y: ROW },
  alu: { x: RIGHT_X, y: 2 * ROW },
  'b-register': { x: RIGHT_X, y: 3 * ROW },
  output: { x: RIGHT_X, y: 4 * ROW },
  flags: { x: RIGHT_X, y: 6 * ROW },
};

export interface ComposedScene {
  layout: Layout;
  /** Live bindings with ids prefixed by module ("a-register/D1"). */
  live: LiveBindings;
  /** Module id -> scene bounds (for zoom-to-module). */
  modules: Map<string, { def: ModuleBoardDef; x: number; y: number }>;
}

/** Merge module boards into one scene, namespacing every id as "<module>/<id>". */
export function composeComputer(defs: Iterable<ModuleBoardDef>): ComposedScene {
  const layout: Layout = { boards: [], parts: [] };
  const live: LiveBindings = { leds: {}, seg7: {}, controls: {} };
  const modules = new Map<string, { def: ModuleBoardDef; x: number; y: number }>();
  let extraY = 7 * ROW;
  for (const def of defs) {
    const slot = MODULE_SLOTS[def.id] ?? { x: LEFT_X, y: (extraY += ROW) - ROW };
    const placed = placeLayout(def.layout, slot.x, slot.y, def.id);
    layout.boards.push(...placed.boards);
    layout.parts.push(...placed.parts);
    for (const [k, v] of Object.entries(def.live.leds)) live.leds[`${def.id}/${k}`] = v;
    for (const [k, v] of Object.entries(def.live.seg7)) live.seg7[`${def.id}/${k}`] = v;
    for (const [k, v] of Object.entries(def.live.controls)) live.controls[`${def.id}/${k}`] = v;
    modules.set(def.id, { def, x: slot.x, y: slot.y });
  }
  return { layout, live, modules };
}

// ---------------------------------------------------------------------------
// Wires between modules

export type LinkKind = 'bus' | 'control' | 'clock' | 'data';

/** The wires' colours, in the breadboard view and the VR view: the bus blue, control lines purple, the clock white, data yellow. */
export const LINK_COLORS: Record<LinkKind, string> = { bus: '#2563d4', control: '#8146c9', clock: '#f4f4f2', data: '#e8c516' };

export interface ModuleLink {
  name: string;
  kind: LinkKind;
  from: { board: string; hole: string; module: string };
  to: { board: string; hole: string; module: string };
}

/** Which module produces each port (the other end of every link). */
export function producerOf(name: string): string | null {
  if (/^BUS\d$/.test(name)) return 'bus';
  if (/^(~?CLK)$/.test(name)) return 'clock';
  if (/^(~?CLR|HLT|RI|SU|OI|CE|~MI|~RO|~IO|~II|~AI|~AO|~EO|~BI|~CO|~J|~FI)$/.test(name)) return 'control';
  if (/^A\d$/.test(name)) return 'a-register';
  if (/^B\d$/.test(name)) return 'b-register';
  if (/^(SUM\d|CARRY)$/.test(name)) return 'alu';
  if (/^(CF|ZF)$/.test(name)) return 'flags';
  if (/^IR\d$/.test(name)) return 'ir';
  if (/^(RA\d|PROG)$/.test(name)) return 'mar';
  return null;
}

export function linkKind(name: string): LinkKind {
  if (/^BUS\d$/.test(name)) return 'bus';
  if (/^~?CLK$/.test(name)) return 'clock';
  return producerOf(name) === 'control' ? 'control' : 'data';
}

/**
 * One link per consuming port: from the nearest same-named port on the
 * producing module (the bus for BUSn) to the port. Needs scene positions,
 * passed in by the caller (the renderer knows board placements).
 */
export function moduleLinks(scene: ComposedScene, pos: (board: string, hole: string) => { x: number; y: number }): ModuleLink[] {
  type P = { name: string; board: string; hole: string; module: string; x: number; y: number };
  const ports: P[] = [];
  for (const p of scene.layout.parts) {
    if (p.kind !== 'port') continue;
    const module = p.board.split('/')[0];
    const { x, y } = pos(p.board, p.hole);
    ports.push({ name: p.name, board: p.board, hole: p.hole, module, x, y });
  }
  const links: ModuleLink[] = [];
  for (const q of ports) {
    const producer = producerOf(q.name);
    if (!producer || producer === q.module) continue;
    let best: P | null = null;
    let bd = Infinity;
    for (const p of ports) {
      if (p.name !== q.name || p.module !== producer) continue;
      const dd = Math.hypot(p.x - q.x, p.y - q.y);
      if (dd < bd) { bd = dd; best = p; }
    }
    if (!best) continue;
    links.push({
      name: q.name,
      kind: linkKind(q.name),
      from: { board: best.board, hole: best.hole, module: best.module },
      to: { board: q.board, hole: q.hole, module: q.module },
    });
  }
  return links;
}
