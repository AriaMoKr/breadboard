import { CHIPS } from './catalog';
import { isRail, parseHole, stripOf } from './geometry';
import { partPins, type Layout, type Part } from './layout';

/**
 * Static connectivity of a layout: which holes are electrically the same
 * node. Strips (a-e / f-j of a column) and rails join holes on a board;
 * wires join their two ends; ports with the same name are one net across
 * boards; every board's + rails (tp, bp) are the 5 V supply and − rails
 * (tn, bn) ground, as on Ben's computer where all boards share power.
 *
 * Switches are open unless listed in `closed` (part id -> which legs are
 * joined: buttons/DIP positions/slide positions), so the engine can rebuild
 * nets as switches move.
 */

export const VCC_NET = 'VCC';
export const GND_NET = 'GND';

export interface ClosedSwitches {
  /** Pressed buttons. */
  buttons?: Set<string>;
  /** Slide switch positions (default: part.initial ?? 0). */
  slides?: Map<string, 0 | 1>;
  /** DIP switch values (bit k-1 = switch k on). */
  dips?: Map<string, number>;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    for (let c = x; c !== r; ) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    // keep readable names as roots: supplies first, then ports ("port:BUS3")
    const rank = (x: string) => (x === VCC_NET || x === GND_NET ? 2 : x.startsWith('port:') ? 1 : 0);
    if (rank(rb) > rank(ra)) this.parent.set(ra, rb);
    else this.parent.set(rb, ra);
  }
}

export interface Netlist {
  /** Net id of a hole ("VCC", "GND", "port:BUS3" or an internal id). */
  netOf(board: string, hole: string): string;
  /** Every node key ("board:hole" / "port:NAME") grouped by net id. */
  members(): Map<string, string[]>;
  /** True if VCC and GND ended up joined (a short). */
  shorted: boolean;
}

const nodeKey = (board: string, hole: string) => {
  const h = parseHole(hole);
  return isRail(h.row) ? `${board}:${h.row}` : `${board}:${stripOf(h)}`;
};

export function buildNets(layout: Layout, closed: ClosedSwitches = {}): Netlist {
  const uf = new UnionFind();
  uf.find(VCC_NET);
  uf.find(GND_NET);
  for (const b of layout.boards) {
    if (b.rails === 'signal') continue;
    uf.union(`${b.id}:tp`, VCC_NET);
    uf.union(`${b.id}:bp`, VCC_NET);
    uf.union(`${b.id}:tn`, GND_NET);
    uf.union(`${b.id}:bn`, GND_NET);
  }
  const join = (p: Part, a: string, b: string) => uf.union(nodeKey(p.board, a), nodeKey(p.board, b));
  for (const p of layout.parts) {
    switch (p.kind) {
      case 'wire':
        join(p, p.a, p.b);
        break;
      case 'port':
        uf.union(nodeKey(p.board, p.hole), `port:${p.name}`);
        break;
      case 'button':
        if (closed.buttons?.has(p.id)) join(p, p.a, p.b);
        break;
      case 'slide': {
        const pos = closed.slides?.get(p.id) ?? p.initial ?? 0;
        join(p, p.common, pos ? p.b : p.a);
        break;
      }
      case 'dip': {
        const v = closed.dips?.get(p.id) ?? 0;
        for (let k = 1; k <= p.positions; k++) if ((v >> (k - 1)) & 1) join(p, `f${p.col + k - 1}`, `e${p.col + k - 1}`);
        break;
      }
      default:
        for (const pin of partPins(p)) uf.find(nodeKey(p.board, pin.hole));
    }
  }
  const shorted = uf.find(VCC_NET) === uf.find(GND_NET);
  return {
    shorted,
    netOf: (board, hole) => uf.find(nodeKey(board, hole)),
    members: () => {
      const m = new Map<string, string[]>();
      // walk every node we have seen
      const seen = new Set<string>();
      const add = (k: string) => {
        if (seen.has(k)) return;
        seen.add(k);
        const r = uf.find(k);
        const list = m.get(r) ?? [];
        list.push(k);
        m.set(r, list);
      };
      for (const b of layout.boards) for (const r of ['tp', 'bp', 'tn', 'bn']) add(`${b.id}:${r}`);
      for (const p of layout.parts) {
        if (p.kind === 'port') add(`port:${p.name}`);
        for (const pin of partPins(p)) add(nodeKey(p.board, pin.hole));
      }
      return m;
    },
  };
}

/** For tests: the net a chip pin is on, e.g. pinNet(layout, nets, 'U9', 'VCC') === 'VCC'. */
export function pinNet(layout: Layout, nets: Netlist, partId: string, pin: string | number): string {
  const p = layout.parts.find((x) => x.id === partId);
  if (!p) throw new Error(`No part ${partId}`);
  const pins = partPins(p);
  const hit = typeof pin === 'number' ? pins.find((x) => x.number === pin) : pins.find((x) => x.name === pin) ?? pins.find((x) => x.name.toLowerCase() === pin.toLowerCase());
  if (!hit) throw new Error(`${partId} has no pin ${pin}`);
  return nets.netOf(p.board, hit.hole);
}

/** Chips whose VCC/GND pins aren't on the supply nets. */
export function unpoweredChips(layout: Layout, nets = buildNets(layout)): string[] {
  const bad: string[] = [];
  for (const p of layout.parts) {
    if (p.kind !== 'chip') continue;
    const def = CHIPS[p.chip];
    if (!def) continue;
    if (pinNet(layout, nets, p.id, def.vcc) !== VCC_NET || pinNet(layout, nets, p.id, def.gnd) !== GND_NET) bad.push(p.id);
  }
  return bad;
}
