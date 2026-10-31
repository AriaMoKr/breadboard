import { RAIL_COLUMNS, ROW_Y, colX, holeXY, stripOf } from '../../breadboard/geometry';
import { partPins, type BoardSpec, type Layout, type Part, type PartSpec, type WireColor } from '../../breadboard/layout';
import { buildNets, type Netlist } from '../../breadboard/nets';
import { WIRE_COLORS } from '../../breadboard/render';
import { s } from '../../ui/dom';

/**
 * The breadboard of Moritz Klein's guide (docs/research/moritz-klein.md): his four circuits as he
 * plugs them in, one 830-hole board with two 9 V batteries. The bottom rails carry the first
 * battery, + on the inner rail and ground on the outer; the second battery's + goes into that
 * ground rail and its − into the top's outer rail, which becomes −9 V. The TL074 straddles the
 * channel with pin 1 in column 14, and its op amp 1 (pins 1-3) does the work. What plugs in from
 * off the board (the batteries' clips, circuit 2's long jumper and the jack's leads) is drawn over
 * it by `drawLeads`, and is in the nets (`guideNets`) as ports and a wire.
 */

export type Step = 1 | 2 | 3 | 4;
/** Where circuit 2's long jumper from the − input goes. */
export type Jumper = 'plus' | 'minus' | 'loose';
export interface Setup {
  step: Step;
  /** Circuit 1's LED turned round. */
  reversed?: boolean;
  jumper?: Jumper;
}

export const BOARD: BoardSpec = { id: 'bb', place: { x: 0, y: 0 } };

/** The TL074's pin 1: op amp 1's output is column 14, its − input 15, its + input 16, V+ (pin 4) 17. */
export const CHIP_COL = 14;

const part = (p: PartSpec & { id: string; label?: string }): Part => ({ board: 'bb', ...p });
const res = (id: string, ohms: number, a: string, b: string, label: string) => part({ id, kind: 'resistor', ohms, a, b, label });
const wire = (id: string, color: WireColor, a: string, b: string, label: string) => part({ id, kind: 'wire', color, a, b, label });

/** What is plugged into the board for a step. */
export function guideLayout(su: Setup): Layout {
  const parts: Part[] = [];
  if (su.step === 1) {
    const [anode, cathode] = su.reversed ? ['g11', 'g10'] : ['g10', 'g11'];
    parts.push(
      res('r1k', 1e3, 'bp10', 'h10', 'The 1k from the + rail'),
      part({ id: 'led', kind: 'led', color: 'red', anode, cathode, label: 'The LED (long leg: anode)' }),
      wire('gnd', 'black', 'j11', 'bn11', 'Jumper to ground'),
    );
    return { boards: [BOARD], parts };
  }
  parts.push(
    part({ id: 'TL074', kind: 'chip', chip: 'TL074', col: CHIP_COL }),
    wire('vplus', 'red', 'j17', 'bp17', 'Pin 4 (V+) to +9 V'),
    wire('vminus', 'blue', 'a17', 'tn17', 'Pin 11 (V−) to −9 V'),
  );
  if (su.step === 2) {
    parts.push(
      wire('plus-gnd', 'black', 'j16', 'bn16', 'The + input (pin 3) to ground'),
      res('r1k', 1e3, 'h14', 'h10', 'The 1k from the output (pin 1)'),
      part({ id: 'led', kind: 'led', color: 'red', anode: 'j10', cathode: 'bn10', label: 'The LED (long leg: anode)' }),
    );
    return { boards: [BOARD], parts };
  }
  parts.push(
    res('r-plus-gnd', 100e3, 'j16', 'bn16', '100k from the + input to ground'),
    res('r-plus-out', 100e3, 'i16', 'i14', '100k from the + input to the output'),
    wire('to-cap', 'green', 'g15', 'g7', 'The − input (pin 2) to the capacitor'),
    wire('cap-gnd', 'black', 'j6', 'bn6', 'The capacitor’s other row to ground'),
    part({ id: 'c1u', kind: 'capacitor', farads: 1e-6, a: 'h7', b: 'h6', film: true, label: '1 µF foil' }),
  );
  if (su.step === 3) {
    parts.push(
      res('rf', 100e3, 'j15', 'j14', '100k from the − input to the output'),
      res('r1k', 1e3, 'h14', 'h10', 'The 1k from the output'),
      part({ id: 'led', kind: 'led', color: 'red', anode: 'j10', cathode: 'bn10', label: 'The LED (long leg: anode)' }),
    );
  } else {
    parts.push(
      res('rf', 1e3, 'j15', 'j14', '1k from the − input to the output'),
      res('r10k', 10e3, 'h14', 'h10', '10k from the output'),
      res('r1k', 1e3, 'i10', 'bn9', '1k to ground'),
    );
  }
  return { boards: [BOARD], parts };
}

// ---------------------------------------------------------------------------
// From off the board

type Pt = { x: number; y: number };
const hole = (h: string): Pt => holeXY(h);

/** A lead from off the board into a hole: a battery clip's, circuit 2's long jumper, the jack's. */
interface Lead {
  /** In the nets: a port (`net`) or, for the long jumper, a wire from `from`. */
  net?: string;
  from?: string;
  color: WireColor;
  /** The hole, or for a loose end the point it hangs at. */
  to: string | Pt;
  /** Where it starts off the board, and the curve's two control points. */
  path: [Pt, Pt, Pt, Pt];
}

/** The long jumper's end in the − input's column. */
const JUMPER_HOLE = 'i15';

/** The batteries, left of the board (the first at the bottom), and the jack (circuit 4) below it. */
const B1 = { x: -8.6, y: 14.2, w: 6.2, h: 4 };
const B2 = { x: -8.6, y: 1.2, w: 6.2, h: 4 };
const JACK = { x: 12.6, y: 19.4, w: 6, h: 3.2 };

function leads(su: Setup): Lead[] {
  const out: Lead[] = [];
  const p = (x: number, y: number): Pt => ({ x, y });
  const bp3 = hole('bp3'), bn3 = hole('bn3');
  out.push(
    { net: '+9V', color: 'red', to: 'bp3', path: [p(-1.6, 15.2), p(0.6, 15.2), p(1.4, 16.1), bp3] },
    { net: 'GND', color: 'black', to: 'bn3', path: [p(-1.6, 17.2), p(0.6, 17.2), p(1.4, 17.1), bn3] },
  );
  if (su.step === 1) return out;
  // the second battery: its + into the ground rail, down across the board's end, its − into the top rail
  out.push(
    { net: '-9V', color: 'black', to: 'tn3', path: [p(-1.6, 2.2), p(0.8, 2.2), p(1.6, 0.9), hole('tn3')] },
    { net: 'GND', color: 'red', to: 'bn5', path: [p(-1.6, 4.2), p(3.4, 4.2), p(5.5, 11), hole('bn5')] },
  );
  if (su.step === 2) {
    const from = hole(JUMPER_HOLE);
    const jumper = su.jumper ?? 'plus';
    if (jumper === 'plus') out.push({ from: JUMPER_HOLE, color: 'yellow', to: 'bp13', path: [from, p(15.3, 15.2), p(13.6, 14.8), hole('bp13')] });
    else if (jumper === 'minus') out.push({ from: JUMPER_HOLE, color: 'yellow', to: 'tn13', path: [from, p(11.2, 13.6), p(11.4, 0.9), hole('tn13')] });
    else out.push({ color: 'yellow', to: p(12.2, 21.4), path: [from, p(16.4, 17.6), p(12.6, 18.4), p(12.2, 21.4)] });
  }
  if (su.step === 4) {
    out.push(
      { net: 'TIP', color: 'red', to: 'j10', path: [p(JACK.x + 1, JACK.y), p(JACK.x + 1, 17.8), p(10.5, 17), hole('j10')] },
      { net: 'GND', color: 'black', to: 'bn13', path: [p(JACK.x + 3, JACK.y), p(JACK.x + 3, 18.6), p(14.2, 17.6), hole('bn13')] },
    );
  }
  return out;
}

/** The board as wired: the layout plus the leads, its rails as plain nets (named by the batteries' ports). */
export function netLayout(su: Setup): Layout {
  const base = guideLayout(su);
  const parts = [...base.parts];
  leads(su).forEach((l, i) => {
    if (typeof l.to !== 'string') return;
    if (l.net) parts.push(part({ id: `lead${i}`, kind: 'port', name: l.net, hole: l.to, side: 'bottom' }));
    else if (l.from) parts.push(wire(`lead${i}`, l.color, l.from, l.to, 'The long jumper'));
  });
  return { boards: [{ ...BOARD, rails: 'signal' }], parts };
}

export interface GuideNets {
  layout: Layout;
  nets: Netlist;
  /** The net a hole is on: '+9V', 'GND', '-9V', 'TIP' (circuit 4) or another net's id. */
  at(h: string): string;
  /** The net of a part's pin (by name or number). */
  pin(id: string, pin: string | number): string;
}

export function guideNets(su: Setup): GuideNets {
  const layout = netLayout(su);
  const nets = buildNets(layout);
  // name each port's net after its port
  const names = new Map<string, string>();
  for (const p of layout.parts) if (p.kind === 'port') names.set(nets.netOf('bb', p.hole), p.name);
  const at = (h: string) => {
    const n = nets.netOf('bb', h);
    return names.get(n) ?? n;
  };
  return {
    layout,
    nets,
    at,
    pin(id, pin) {
      const p = layout.parts.find((x) => x.id === id);
      if (!p) throw new Error(`No part ${id}`);
      const pins = partPins(p);
      const hit = typeof pin === 'number' ? pins.find((x) => x.number === pin) : pins.find((x) => x.name === pin);
      if (!hit) throw new Error(`${id} has no pin ${pin}`);
      return at(hit.hole);
    },
  };
}

// ---------------------------------------------------------------------------
// Drawing over the board

/** What the view shows: the batteries, columns 1-22, and the jack below. */
export const VIEW = { x: -9.4, y: -1.2, w: 32.6, h: 24.8 };

const pathD = (pts: Pt[]) => `M ${pts[0].x} ${pts[0].y} C ${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y} ${pts[3].x} ${pts[3].y}`;

/** A 9 V battery lying left of the board, its clip on the right. */
function battery(b: { x: number; y: number; w: number; h: number }, label: string): SVGGElement {
  const g = s('g', { class: 'synth-battery' });
  g.append(
    s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 0.35, class: 'synth-battery-body' }),
    s('rect', { x: b.x + b.w - 1.4, y: b.y, width: 1.4, height: b.h, rx: 0.3, class: 'synth-battery-end' }),
    s('rect', { x: b.x + b.w, y: b.y + 0.4, width: 0.8, height: b.h - 0.8, rx: 0.2, class: 'synth-battery-clip' }),
    s('text', { x: b.x + b.w / 2 - 0.7, y: b.y + b.h / 2 + 0.45, 'text-anchor': 'middle', class: 'synth-battery-text' }, label),
  );
  return g;
}

/** The batteries, the leads into the board, and the jack: everything from off the board. */
export function drawLeads(su: Setup): SVGGElement {
  const g = s('g', { class: 'synth-leads' });
  g.appendChild(battery(B1, '9V'));
  if (su.step > 1) g.appendChild(battery(B2, '9V'));
  if (su.step === 4) {
    const j = s('g', { class: 'synth-jack' });
    // the body, and the threaded bush the plug goes into, facing away from the board
    j.append(
      s('rect', { x: JACK.x, y: JACK.y + 0.5, width: JACK.w, height: JACK.h - 0.5, rx: 0.4, class: 'synth-jack-body' }),
      s('rect', { x: JACK.x + JACK.w / 2 - 1.1, y: JACK.y + JACK.h, width: 2.2, height: 0.7, rx: 0.1, class: 'synth-jack-bush' }),
    );
    // three lugs: tip, sleeve, and the switch, left unused
    [1, 3, 5].forEach((dx, i) => {
      j.appendChild(s('rect', { x: JACK.x + dx - 0.3, y: JACK.y - 0.2, width: 0.6, height: 0.9, rx: 0.12, class: 'synth-jack-lug' }));
      j.appendChild(s('text', { x: JACK.x + dx, y: JACK.y + 1.9, 'text-anchor': 'middle', class: 'synth-jack-text' }, ['tip', 'sleeve', 'switch'][i]));
    });
    g.appendChild(j);
  }
  for (const l of leads(su)) {
    const d = pathD(l.path);
    g.append(s('path', { d, class: 'bb-wire-outline' }), s('path', { d, class: 'bb-wire-core', stroke: WIRE_COLORS[l.color] }));
    const end = l.path[3];
    if (typeof l.to === 'string') g.appendChild(s('circle', { cx: end.x, cy: end.y, r: 0.13, class: 'bb-wire-end' }));
    // a loose end: its bare metal pin
    else g.appendChild(s('path', { d: `M ${end.x} ${end.y} l -0.08 0.7`, class: 'synth-pin' }));
  }
  return g;
}

/** Colours of the supply nets in `drawStrips`; other nets take `NET_PALETTE`'s in turn. */
export const SUPPLY_COLORS: Record<string, string> = { '+9V': '#d9261c', GND: '#3a3a40', '-9V': '#2563d4' };
export const NET_PALETTE = ['#e8a10b', '#8b5cf6', '#10b981', '#ec4899', '#0891b2'];

/**
 * The metal under the holes: each five-hole strip and each rail, tinted with the net it is on when
 * something is plugged into it, so the board's own connections show.
 */
export function drawStrips(su: Setup, cols = 23): SVGGElement {
  const n = guideNets(su);
  const used = new Set<string>();
  for (const p of n.layout.parts) for (const pin of partPins(p)) used.add(stripOf(pin.hole));
  const colors = new Map<string, string>(Object.entries(SUPPLY_COLORS));
  let next = 0;
  const colorOf = (strip: string, h: string) => {
    if (!used.has(strip)) return null;
    const net = n.at(h);
    if (!colors.has(net)) colors.set(net, NET_PALETTE[next++ % NET_PALETTE.length]);
    return colors.get(net)!;
  };
  const g = s('g', { class: 'synth-strips' });
  const bar = (x: number, y: number, w: number, hh: number, color: string | null) =>
    g.appendChild(s('rect', { x, y, width: w, height: hh, rx: 0.3, class: color ? 'synth-strip used' : 'synth-strip', style: color ? `--net: ${color}` : undefined }));
  for (const rail of ['tn', 'tp', 'bp', 'bn'] as const) {
    const x0 = colX(RAIL_COLUMNS[0]) - 0.45;
    bar(x0, ROW_Y[rail] - 0.36, colX(cols) - x0 + 1.5, 0.72, colorOf(rail, `${rail}3`));
  }
  for (let c = 1; c <= cols; c++) {
    bar(colX(c) - 0.36, ROW_Y.a - 0.4, 0.72, ROW_Y.e - ROW_Y.a + 0.8, colorOf(`top${c}`, `a${c}`));
    bar(colX(c) - 0.36, ROW_Y.f - 0.4, 0.72, ROW_Y.j - ROW_Y.f + 0.8, colorOf(`bot${c}`, `f${c}`));
  }
  return g;
}
