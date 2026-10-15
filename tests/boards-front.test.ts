import { describe, expect, it } from 'vitest';
import bus from '../src/breadboard/boards/bus.board';
import clock, { hzFromPot, potFromHz } from '../src/breadboard/boards/clock.board';
import ir from '../src/breadboard/boards/ir.board';
import mar from '../src/breadboard/boards/mar.board';
import pc from '../src/breadboard/boards/pc.board';
import ram from '../src/breadboard/boards/ram.board';
import { CHIPS } from '../src/breadboard/catalog';
import { BUS_W, ROW, composeComputer } from '../src/breadboard/computer-layout';
import { BOARD_H, BOARD_W, RAIL_COLUMNS, ROW_Y, colX, dipRows, holeXY, isRail, parseHole, toScene } from '../src/breadboard/geometry';
import { layoutBounds, partPins, validateLayout, type Layout, type ModuleBoardDef, type Part } from '../src/breadboard/layout';
import { GND_NET, VCC_NET, buildNets, pinNet, unpoweredChips, type Netlist } from '../src/breadboard/nets';
import { BreadboardSim } from '../src/breadboard/sim/engine';
import { Machine } from '../src/sim/machine';
import { SIGNAL_BITS } from '../src/sim/signals';

// ---------------------------------------------------------------------------
// helpers

const partsOf = <K extends Part['kind']>(L: Layout, kind: K) => L.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind);
const portNames = (L: Layout) => new Set(partsOf(L, 'port').map((p) => p.name));

/** Every part leg on the net of (part, pin), as "U3.7" / "R1.a" (wires and ports left out). */
function pinsOnNet(L: Layout, nets: Netlist, partId: string, pin: string | number): string[] {
  const id = pinNet(L, nets, partId, pin);
  const out: string[] = [];
  for (const p of L.parts) {
    if (p.kind === 'wire' || p.kind === 'port' || p.kind === 'text') continue;
    for (const pp of partPins(p)) if (nets.netOf(p.board, pp.hole) === id) out.push(`${p.id}.${p.kind === 'chip' ? pp.number : pp.name}`);
  }
  return out;
}

function staticChecks(def: ModuleBoardDef) {
  const L = def.layout;
  const nets = buildNets(L);
  expect(validateLayout(L)).toEqual([]);
  expect(unpoweredChips(L, nets)).toEqual([]);
  expect(nets.shorted).toBe(false);
  // every LED is bound to the simulator, every binding is to a real part
  const leds = partsOf(L, 'led').map((p) => p.id).sort();
  expect(Object.keys(def.live.leds).sort()).toEqual(leds);
  for (const id of Object.keys(def.live.controls)) expect(L.parts.some((p) => p.id === id && ['button', 'slide', 'dip', 'pot'].includes(p.kind))).toBe(true);
  // every interactive part has a binding
  for (const p of L.parts) if (['button', 'slide', 'dip', 'pot'].includes(p.kind)) expect(def.live.controls[p.id], p.id).toBeDefined();
  return nets;
}

const sceneY = (L: Layout, p: Part & { hole: string }) => toScene(L.boards.find((b) => b.id === p.board)!.place, holeXY(p.hole)).y;

// ---------------------------------------------------------------------------
// Routing: what the renderer draws (src/breadboard/render.ts). Wires are drawn
// under the parts and port tags over everything, so a wire across a chip
// vanishes under it and a tag can hide a wire end.

type Pt = { x: number; y: number };
type Box = { x0: number; x1: number; y0: number; y1: number };

/** Chip, DIP-switch and LED bodies as drawn (drawChip, drawDip, drawLed in render.ts), board-local. */
function bodies(L: Layout, board: string): { id: string; box: Box }[] {
  const out: { id: string; box: Box }[] = [];
  for (const p of L.parts) {
    if (p.board !== board) continue;
    if (p.kind === 'chip') {
      const def = CHIPS[p.chip];
      const n = def.pins.length / 2;
      const [top, bottom] = dipRows(def.spacing);
      const c0 = p.rotated ? p.col - n + 1 : p.col;
      out.push({ id: p.id, box: { x0: colX(c0) - 0.47, x1: colX(c0 + n - 1) + 0.47, y0: ROW_Y[top] + 0.22, y1: ROW_Y[bottom] - 0.22 } });
    } else if (p.kind === 'dip') {
      out.push({ id: p.id, box: { x0: colX(p.col) - 0.48, x1: colX(p.col + p.positions - 1) + 0.48, y0: ROW_Y.e - 0.2, y1: ROW_Y.f + 0.2 } });
    } else if (p.kind === 'led') {
      // the dome sits near the anode for long spans (legs bent), centred for short ones
      const a = holeXY(p.anode), k = holeXY(p.cathode);
      const dist = Math.hypot(k.x - a.x, k.y - a.y);
      const t = dist > 2.2 ? Math.min(0.5, 0.9 / dist) : 0.5;
      const x = a.x + (k.x - a.x) * t, y = a.y + (k.y - a.y) * t;
      out.push({ id: p.id, box: { x0: x - 0.42, x1: x + 0.42, y0: y - 0.42, y1: y + 0.42 } });
    }
  }
  return out;
}

/** A port tag's rectangle (stub + label), board-local, as drawPort lays it out. */
function tagBox(p: Extract<Part, { kind: 'port' }>): Box {
  const { x, y } = holeXY(p.hole);
  const w = p.name.replace(/^~/, '').length * 0.42 + 0.55;
  const h = 0.36;
  if (p.side === 'top') return { x0: x - h, x1: x + h, y0: y - 0.45 - w, y1: y - 0.3 };
  if (p.side === 'bottom') return { x0: x - h, x1: x + h, y0: y + 0.3, y1: y + 0.45 + w };
  if (p.side === 'right') return { x0: x + 0.3, x1: x + 0.45 + w, y0: y - h, y1: y + h };
  return { x0: x - 0.45 - w, x1: x - 0.3, y0: y - h, y1: y + h };
}

const inside = (p: Pt, b: Box, m = 0) => p.x > b.x0 - m && p.x < b.x1 + m && p.y > b.y0 - m && p.y < b.y1 + m;
const orient = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const properCross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const [d1, d2, d3, d4] = [orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)];
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
};
/**
 * Length over which two axis-parallel segments run along each other less
 * than 0.3 apart (drawn on top of each other), 0 otherwise.
 */
function parallelOverlap(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const horiz = (p: Pt, q: Pt) => Math.abs(p.y - q.y) < 1e-9 && Math.abs(p.x - q.x) > 1e-9;
  const vert = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) > 1e-9;
  const span = (u: number, v: number, s: number, t: number) => Math.min(Math.max(u, v), Math.max(s, t)) - Math.max(Math.min(u, v), Math.min(s, t));
  if (horiz(a, b) && horiz(c, d) && Math.abs(a.y - c.y) < 0.3) return span(a.x, b.x, c.x, d.x);
  if (vert(a, b) && vert(c, d) && Math.abs(a.x - c.x) < 0.3) return span(a.y, b.y, c.y, d.y);
  return 0;
}
/** Distance from point h to segment a-b. */
function distToSegment(h: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((h.x - a.x) * dx + (h.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - h.x, a.y + t * dy - h.y);
}
/** Does segment a-b pass into box `r` anywhere between its ends (sampled every 0.05)? */
function segmentInBox(a: Pt, b: Pt, r: Box, m = 0): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
  for (let i = 1; i < n; i++) if (inside({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, r, m)) return true;
  return false;
}

/**
 * Drawing problems of a layout, plus how many pairs of wire segments cross.
 * These are the "Tidiness rules" of docs/BREADBOARD.md (the same checks as
 * the datapath boards): no wire under a chip, DIP switch or LED, or over
 * another part's leg; no two runs on top of each other (less than 0.3
 * apart); no resistor or capacitor over a leg or a body; no bend off the
 * board; port tags on the outer row (a / j) pointing off the board, hiding
 * no leg and no wire. Tags on the rails of a signal-rail board are the one
 * exception: on the bus those rails are the bus lines themselves.
 */
function routing(L: Layout): { problems: string[]; crossings: number } {
  const problems: string[] = [];
  let crossings = 0;
  for (const board of L.boards) {
    const parts = L.parts.filter((p) => p.board === board.id);
    const wires = parts.filter((p): p is Extract<Part, { kind: 'wire' }> => p.kind === 'wire');
    const segs = wires.flatMap((w) => {
      const pts: Pt[] = [holeXY(w.a), ...(w.via ?? []).map(([x, y]) => ({ x, y })), holeXY(w.b)];
      return pts.slice(1).map((q, i) => ({ id: w.id, ends: [w.a, w.b], a: pts[i], b: q }));
    });
    const used = parts.flatMap((p) => partPins(p).map((pin) => ({ id: p.id, hole: pin.hole, at: holeXY(pin.hole) })));
    const bs = bodies(L, board.id);
    for (const w of wires) for (const [x, y] of w.via ?? []) if (x <= 0 || x >= BOARD_W || y <= 0 || y >= BOARD_H) problems.push(`${w.id} bends outside its board at (${x}, ${y})`);
    for (const s of segs) {
      for (const { id, box } of bs) if (segmentInBox(s.a, s.b, box, -0.02)) problems.push(`${s.id} runs under ${id}`);
      for (const u of used) if (u.id !== s.id && !s.ends.includes(u.hole) && distToSegment(u.at, s.a, s.b) < 0.3) problems.push(`${s.id} runs over ${u.hole} (${u.id})`);
    }
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const [s, t] = [segs[i], segs[j]];
        if (s.id === t.id) continue;
        if (parallelOverlap(s.a, s.b, t.a, t.b) > 0.05) problems.push(`${s.id} and ${t.id} lie on top of each other`);
        else if (properCross(s.a, s.b, t.a, t.b)) crossings++;
      }
    }
    for (const p of parts) {
      if (p.kind !== 'resistor' && p.kind !== 'capacitor') continue;
      const a = holeXY(p.a), b = holeXY(p.b);
      for (const u of used) if (u.id !== p.id && distToSegment(u.at, a, b) < 0.3) problems.push(`${p.id} lies over ${u.hole} (${u.id})`);
      for (const { id, box } of bs) if (segmentInBox(a, b, box)) problems.push(`${p.id} lies over ${id}`);
    }
    for (const p of parts) {
      if (p.kind !== 'port') continue;
      const row = parseHole(p.hole).row;
      const busLine = board.rails === 'signal' && isRail(row);
      if (!busLine && ((p.side === 'top' && row !== 'a') || (p.side === 'bottom' && row !== 'j'))) problems.push(`the ${p.name} tag at ${p.hole} points ${p.side} across the board`);
      const box = tagBox(p);
      for (const u of used) if (u.id !== p.id && u.hole !== p.hole && inside(u.at, box, 0.1)) problems.push(`the ${p.name} tag at ${p.hole} hides ${u.hole} (${u.id})`);
      const inner = { x0: box.x0 + 0.1, x1: box.x1 - 0.1, y0: box.y0 + 0.1, y1: box.y1 - 0.1 };
      for (const s of segs) if (segmentInBox(s.a, s.b, inner)) problems.push(`the ${p.name} tag at ${p.hole} hides ${s.id}`);
    }
  }
  return { problems: [...new Set(problems)], crossings };
}

/** Port names from docs/BREADBOARD.md ("Port names"), plus module-local "RAM.*" tags. */
const CONTRACT = new Set([
  ...Array.from({ length: 8 }, (_, k) => `BUS${k}`), 'CLK', '~CLK', 'CLR', '~CLR',
  'HLT', '~MI', 'RI', '~RO', '~IO', '~II', '~AI', '~AO', '~EO', 'SU', '~BI', 'OI', 'CE', '~CO', '~J', '~FI',
  ...['A', 'B', 'SUM'].flatMap((p) => Array.from({ length: 8 }, (_, k) => `${p}${k}`)),
  'CARRY', 'CF', 'ZF', 'IR4', 'IR5', 'IR6', 'IR7', 'RA0', 'RA1', 'RA2', 'RA3', 'PROG',
]);

// ---------------------------------------------------------------------------
// Clock

describe('clock board', () => {
  const L = clock.layout;
  const nets = staticChecks(clock);
  const net = (u: string, p: string | number) => pinNet(L, nets, u, p);

  it('has Ben’s chips, one board at the module origin, and exposes CLK, ~CLK and HLT', () => {
    const chips = Object.fromEntries(partsOf(L, 'chip').map((p) => [p.id, p.chip]));
    expect(chips).toEqual({ U1: 'NE555', U2: 'NE555', U3: 'NE555', U4: '74LS04', U5: '74LS08', U6: '74LS32' });
    expect(L.boards).toHaveLength(1);
    expect(L.boards[0].place).toMatchObject({ x: 0, y: 0 });
    expect([...portNames(L)].sort()).toEqual(['CLK', 'HLT', '~CLK']);
    expect(partsOf(L, 'chip').find((p) => p.id === 'U1')!.params).toEqual({ mode: 'astable', halfPeriod: 2000 });
    expect(partsOf(L, 'chip').find((p) => p.id === 'U2')!.params).toEqual({ mode: 'monostable', pulseWidth: 1500 });
    expect(partsOf(L, 'chip').find((p) => p.id === 'U3')!.params).toEqual({ mode: 'bistable' });
  });

  it('U1 astable: R1, R2 + RV1, C6, C5, RESET high', () => {
    const dis = net('U1', 'DIS'), thr = net('U1', 'THR');
    expect(net('U1', 'TRIG')).toBe(thr);
    expect(net('U1', '~RESET')).toBe(VCC_NET);
    expect([net('R1', 'a'), net('R1', 'b')].sort()).toEqual([VCC_NET, dis].sort());
    // R2 from DIS to the pot wiper; the pot's pin 1 on THR/TRIG, pin 3 open
    const wiper = net('RV1', 'wiper');
    expect([net('R2', 'a'), net('R2', 'b')].sort()).toEqual([dis, wiper].sort());
    expect(net('RV1', 'a')).toBe(thr);
    expect(pinsOnNet(L, nets, 'RV1', 'b')).toEqual(['RV1.b']); // pin 3 open
    expect([net('C6', 'a'), net('C6', 'b')]).toEqual([thr, GND_NET]); // + on the timing node
    expect(partsOf(L, 'capacitor').find((p) => p.id === 'C6')).toMatchObject({ farads: 1e-6, polarized: true });
    expect([net('C5', 'a'), net('C5', 'b')]).toEqual([net('U1', 'CV'), GND_NET]);
    expect(partsOf(L, 'pot')[0]).toMatchObject({ id: 'RV1', ohms: 1e6 });
  });

  it('U2 monostable: R3 pull-up, SW1 to GND, R4/C3 timing, C2 on CV', () => {
    const trig = net('U2', 'TRIG'), thr = net('U2', 'THR');
    expect(net('U2', 'DIS')).toBe(thr);
    expect(net('U2', '~RESET')).toBe(VCC_NET);
    expect([net('R3', 'a'), net('R3', 'b')]).toEqual([trig, VCC_NET]);
    expect([net('R4', 'a'), net('R4', 'b')]).toEqual([thr, VCC_NET]);
    expect([net('C3', 'a'), net('C3', 'b')]).toEqual([thr, GND_NET]);
    expect([net('C2', 'a'), net('C2', 'b')]).toEqual([net('U2', 'CV'), GND_NET]);
    expect([net('SW1', 'a'), net('SW1', 'b')].sort()).toEqual([GND_NET, trig].sort());
    // pressing the button grounds TRIG
    const pressed = buildNets(L, { buttons: new Set(['SW1']) });
    expect(pinNet(L, pressed, 'U2', 'TRIG')).toBe(GND_NET);
    const ohms = Object.fromEntries(partsOf(L, 'resistor').map((p) => [p.id, p.ohms]));
    expect(ohms).toMatchObject({ R1: 1000, R2: 1000, R3: 1000, R4: 1e6, R5: 1000, R6: 1000, R7: 220 });
    const farads = Object.fromEntries(partsOf(L, 'capacitor').map((p) => [p.id, p.farads]));
    expect(farads).toEqual({ C2: 1e-8, C3: 1e-7, C4: 1e-8, C5: 1e-8, C6: 1e-6 });
  });

  it('U3 bistable: R5/R6 pull-ups, SW2 common to GND, THR to GND, DIS open', () => {
    const trig = net('U3', 'TRIG'), reset = net('U3', '~RESET');
    expect([net('R5', 'a'), net('R5', 'b')]).toEqual([trig, VCC_NET]);
    expect([net('R6', 'a'), net('R6', 'b')]).toEqual([reset, VCC_NET]);
    expect(net('U3', 'THR')).toBe(GND_NET);
    expect([net('C4', 'a'), net('C4', 'b')]).toEqual([net('U3', 'CV'), GND_NET]);
    expect(pinsOnNet(L, nets, 'U3', 'DIS')).toEqual(['U3.7']);
    // SW2: a -> RESET (position 0, manual), b -> TRIG (position 1, auto), common -> GND
    expect(net('SW2', 'a')).toBe(reset);
    expect(net('SW2', 'b')).toBe(trig);
    expect(pinNet(L, nets, 'SW2', 'common')).toBe(GND_NET);
    expect(pinNet(L, buildNets(L, { slides: new Map([['SW2', 1]]) }), 'U3', 'TRIG')).toBe(GND_NET);
    expect(pinNet(L, buildNets(L, { slides: new Map([['SW2', 0]]) }), 'U3', '~RESET')).toBe(GND_NET);
  });

  it('clock logic: CLK = ((AST & SEL) | (MONO & !SEL)) & !HLT, ~CLK = !CLK', () => {
    expect(net('U5', '1A')).toBe(net('U1', 'OUT')); // U5A = AST & SEL
    expect(net('U5', '1B')).toBe(net('U3', 'OUT'));
    expect(net('U4', '1A')).toBe(net('U3', 'OUT')); // U4A = !SEL
    expect(net('U5', '2A')).toBe(net('U4', '1Y')); // U5B = !SEL & MONO
    expect(net('U5', '2B')).toBe(net('U2', 'OUT'));
    // pin numbers from the KiCad netlist: Net-(U2-Pad3) = U5.5, Net-(U4-Pad2) = U5.4, Net-(U1-Pad3) = U5.1, Net-(U3-Pad3) = U5.2
    expect([net('U5', 1), net('U5', 2), net('U5', 4), net('U5', 5)]).toEqual([net('U1', 3), net('U3', 3), net('U4', 2), net('U2', 3)]);
    expect([net('U5', 9), net('U5', 10), net('U4', 9), net('U4', 13), net('U4', 12)]).toEqual([net('U6', 3), net('U4', 8), 'port:HLT', 'port:CLK', 'port:~CLK']);
    expect(net('U6', '1A')).toBe(net('U5', '1Y')); // U6A = U5A | U5B
    expect(net('U6', '1B')).toBe(net('U5', '2Y'));
    expect(net('U4', '4A')).toBe('port:HLT'); // U4D = !HLT
    expect(net('U5', '3A')).toBe(net('U6', '1Y')); // U5C = U6A & U4D = CLK
    expect(net('U5', '3B')).toBe(net('U4', '4Y'));
    expect(net('U5', '3Y')).toBe('port:CLK');
    expect(net('U4', '6A')).toBe('port:CLK'); // U4F = ~CLK
    expect(net('U4', '6Y')).toBe('port:~CLK');
    // the internal nets really are distinct
    const internal = [net('U1', 'OUT'), net('U2', 'OUT'), net('U3', 'OUT'), net('U4', '1Y'), net('U5', '1Y'), net('U5', '2Y'), net('U6', '1Y'), net('U4', '4Y')];
    expect(new Set(internal).size).toBe(internal.length);
    for (const n of internal) expect([VCC_NET, GND_NET].includes(n) || n.startsWith('port:')).toBe(false);
  });

  it('unused gate inputs are tied to GND', () => {
    for (const [u, pins] of [['U4', ['2A', '3A', '5A']], ['U5', ['4A', '4B']], ['U6', ['2A', '2B', '3A', '3B', '4A', '4B']]] as const)
      for (const p of pins) expect(net(u, p), `${u}.${p}`).toBe(GND_NET);
  });

  it('one LED, as on Ben’s finished module: blue D1 on CLK with R7 220R from its cathode to GND (netlist)', () => {
    // Ben removes the debug LEDs on the 555 outputs at the end of part 4; the netlist has only D1
    const leds = partsOf(L, 'led');
    expect(leds.map((p) => [p.id, p.color, p.label])).toEqual([['D1', 'blue', 'CLK']]);
    // netlist: D1.A on CLK, Net-(D1-Pad1) = D1.K + R7.1, R7.2 on GND
    expect(net('D1', 'anode')).toBe('port:CLK');
    expect(pinsOnNet(L, nets, 'D1', 'cathode').sort()).toEqual(['D1.cathode', 'R7.a']);
    expect(net('R7', 'b')).toBe(GND_NET);
    for (const u of ['U1', 'U2', 'U3']) expect(pinsOnNet(L, nets, u, 'OUT').filter((p) => !/^U[456]\./.test(p)), `${u} OUT`).toEqual([`${u}.3`]);
    expect(partsOf(L, 'resistor').map((p) => p.id).sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']);
    expect(Object.keys(clock.live.leds)).toEqual(['D1']);
    expect(Object.keys(clock.live.controls).sort()).toEqual(['RV1', 'SW1', 'SW2']);
  });

  it('live bindings drive the Machine like Ben’s front panel', () => {
    const m = new Machine();
    const c = m.computer;
    const ctl = clock.live.controls;
    const sw1 = ctl.SW1 as Extract<typeof ctl.SW1, { kind: 'button' }>;
    const sw2 = ctl.SW2 as Extract<typeof ctl.SW2, { kind: 'slide' }>;
    const rv1 = ctl.RV1 as Extract<typeof ctl.RV1, { kind: 'pot' }>;
    const led = (id: string) => clock.live.leds[id](c, m);
    // manual mode: a press is a rising edge, the release the falling edge
    m.setMode('manual');
    expect(sw2.get(m)).toBe(0);
    sw1.press(m);
    expect(c.clk).toBe(1);
    expect(led('D1')).toBe(true);
    sw1.release!(m);
    expect(c.clk).toBe(0);
    expect(led('D1')).toBe(false);
    expect(c.step).toBe(1); // one full pulse: the step counter moved on the falling edge
    // HLT gates the clock: the button does nothing while the control word says HLT
    c.setManualControl(SIGNAL_BITS.HLT);
    sw1.press(m);
    expect([c.clk, led('D1')]).toEqual([0, false]);
    sw1.release!(m);
    c.setManualControl(null);
    // auto: the slide starts the astable, the button does nothing
    sw2.set(m, 1);
    expect(m.mode).toBe('auto');
    expect(m.running).toBe(true);
    expect(sw2.get(m)).toBe(1);
    sw1.press(m);
    expect(c.clk).toBe(0);
    sw1.release!(m);
    expect(c.clk).toBe(0);
    sw2.set(m, 0);
    expect(m.mode).toBe('manual');
    expect(sw2.get(m)).toBe(0);
    // speed pot: f = 1.44 / ((1k + 2(1k + t·1M)) · 1uF)
    expect(hzFromPot(0)).toBeCloseTo(480, 0);
    expect(hzFromPot(1)).toBeCloseTo(0.719, 3);
    rv1.set(m, 0.25);
    expect(m.hz).toBeCloseTo(hzFromPot(0.25), 6);
    expect(rv1.get(m)).toBeCloseTo(0.25, 6);
    m.setHz(2);
    expect(rv1.get(m)).toBeCloseTo(potFromHz(2), 9);
    m.setHz(1000);
    expect(rv1.get(m)).toBe(0); // clamped
    m.setHz(0.1);
    expect(rv1.get(m)).toBe(1);
  });

  it('simulates on the chip-level engine: step button, auto clock, HLT', () => {
    const sim = new BreadboardSim(L);
    sim.setPort('HLT', 0);
    sim.step(20);
    expect(sim.problems()).toEqual([]);
    // manual (SW2 at 0): the latch (U3) selects the one-shot; CLK low until the step button fires it
    expect(sim.pinLevel('U3', 'OUT')).toBe(0);
    expect(sim.portLevel('CLK')).toBe(0);
    expect(sim.portLevel('~CLK')).toBe(1);
    sim.press('SW1');
    sim.step(20);
    expect(sim.portLevel('CLK')).toBe(1);
    expect(sim.portLevel('~CLK')).toBe(0);
    expect(sim.ledLit('D1')).toBe(true);
    expect(sim.pinLevel('U2', 'OUT')).toBe(1);
    sim.release('SW1');
    sim.step(400);
    expect(sim.portLevel('CLK')).toBe(1); // the 1500-delay pulse is still running
    sim.step(1200);
    expect(sim.portLevel('CLK')).toBe(0);
    expect(sim.ledLit('D1')).toBe(false);
    // auto: CLK follows the astable (half period 2000)
    sim.setSlide('SW2', 1);
    sim.step(20);
    expect(sim.pinLevel('U3', 'OUT')).toBe(1);
    /** The astable's output now, after the three gates (U5A, U6A, U5C) it takes to reach CLK. */
    const astable = () => {
      const a = sim.pinLevel('U1', 'OUT');
      sim.step(3);
      return a;
    };
    const seen: number[] = [];
    let edges = 0;
    let last = sim.portLevel('CLK');
    for (let t = 0; t < 80; t++) {
      sim.step(97);
      const a = astable();
      const l = sim.portLevel('CLK');
      if (l !== last) edges++;
      last = l;
      seen.push(l === 1 ? 1 : 0);
      expect(l === 0 || l === 1).toBe(true);
      expect(l).toBe(a);
      expect(sim.portLevel('~CLK')).toBe(l === 1 ? 0 : 1);
      expect(sim.ledLit('D1')).toBe(l === 1);
    }
    expect(edges).toBeGreaterThanOrEqual(3); // 8000 delays = two periods
    expect(seen).toContain(0);
    expect(seen).toContain(1);
    // the step button does nothing in auto mode: CLK stays the astable, through and after the one-shot
    sim.press('SW1');
    for (let t = 0; t < 20; t++) {
      sim.step(97);
      expect(astable(), `pressed, t=${t}`).toBe(sim.portLevel('CLK'));
    }
    expect(sim.pinLevel('U2', 'OUT')).toBe(1); // the one-shot fired, the mux ignored it
    sim.release('SW1');
    for (let t = 0; t < 20; t++) {
      sim.step(97);
      expect(astable(), `released, t=${t}`).toBe(sim.portLevel('CLK'));
    }
    // HLT holds CLK low
    sim.setPort('HLT', 1);
    sim.step(20);
    for (let t = 0; t < 50; t++) {
      sim.step(100);
      expect(sim.portLevel('CLK')).toBe(0);
      expect(sim.portLevel('~CLK')).toBe(1);
    }
    sim.setPort('HLT', 0);
    edges = 0;
    last = sim.portLevel('CLK');
    for (let t = 0; t < 60; t++) {
      sim.step(100);
      if (sim.portLevel('CLK') !== last) edges++;
      last = sim.portLevel('CLK');
    }
    expect(edges).toBeGreaterThanOrEqual(2);
    // back to manual: the astable no longer reaches CLK
    sim.setSlide('SW2', 0);
    sim.step(20);
    for (let t = 0; t < 50; t++) {
      sim.step(100);
      expect(sim.portLevel('CLK')).toBe(0);
    }
    expect(sim.problems()).toEqual([]);
  });

  it('debounces the step button (one CLK pulse per bouncy press) and gates CLK with HLT at once (chip level)', () => {
    const sim = new BreadboardSim(L);
    sim.setPort('HLT', 0);
    sim.step(20);
    let rises = 0, last = sim.portLevel('CLK');
    const run = (n: number) => {
      for (let t = 0; t < n; t++) {
        sim.step(1);
        const l = sim.portLevel('CLK');
        if (l === 1 && last === 0) rises++;
        last = l;
      }
    };
    // a press that bounces: contact, open, contact, open within a few dozen gate delays
    for (let k = 0; k < 4; k++) {
      sim.press('SW1');
      run(7);
      sim.release('SW1');
      run(5);
    }
    run(2000); // the 1500-delay pulse ends
    expect([rises, sim.portLevel('CLK')]).toEqual([1, 0]);
    // a second press is a second pulse
    sim.pulse('SW1', 30);
    run(2000);
    expect(rises).toBe(2);
    // HLT while the one-shot holds CLK high: the AND gate drops CLK (and raises ~CLK) right away ...
    sim.press('SW1');
    run(50);
    sim.release('SW1');
    expect(sim.portLevel('CLK')).toBe(1);
    sim.setPort('HLT', 1);
    run(5);
    expect([sim.portLevel('CLK'), sim.portLevel('~CLK'), sim.ledLit('D1')]).toEqual([0, 1, false]);
    // ... and lets it through again if HLT goes away before the pulse is over
    sim.setPort('HLT', 0);
    run(5);
    expect(sim.portLevel('CLK')).toBe(1);
    run(2000);
    expect(sim.portLevel('CLK')).toBe(0);
    // halted, the step button does nothing
    sim.setPort('HLT', 1);
    const before = rises;
    sim.pulse('SW1', 30);
    run(2000);
    expect([rises, sim.portLevel('CLK')]).toEqual([before, 0]);
    expect(sim.problems()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Program counter

describe('program counter board', () => {
  const L = pc.layout;
  const nets = staticChecks(pc);
  const net = (u: string, p: string | number) => pinNet(L, nets, u, p);

  it('is wired like Ben’s schematic', () => {
    expect(L.boards).toHaveLength(1);
    expect(L.boards[0].place).toMatchObject({ x: 0, y: 0 });
    expect(Object.fromEntries(partsOf(L, 'chip').map((p) => [p.id, p.chip]))).toEqual({ U35: '74LS161', U36: '74LS245' });
    expect(net('U35', '~MR')).toBe('port:~CLR');
    expect(net('U35', 'CP')).toBe('port:CLK');
    expect(net('U35', 'CEP')).toBe('port:CE');
    expect(net('U35', 'CET')).toBe('port:CE');
    expect(net('U35', '~PE')).toBe('port:~J');
    expect(net('U36', 'DIR')).toBe(GND_NET); // B -> A
    expect(net('U36', '~OE')).toBe('port:~CO');
    for (let k = 0; k < 4; k++) {
      expect(net('U35', `P${k}`)).toBe(`port:BUS${k}`);
      expect(net('U36', `A${8 - k}`)).toBe(`port:BUS${k}`);
      const q = net('U35', `Q${k}`);
      expect(q.startsWith('port:') || q === VCC_NET || q === GND_NET).toBe(false);
      expect(net('U36', `B${8 - k}`)).toBe(q);
      expect(net(`D${85 - k}`, 'anode')).toBe(q); // netlist: D82 = Q3 ... D85 = Q0
      expect(net(`D${85 - k}`, 'cathode')).toBe(GND_NET);
      expect(net('U36', `B${k + 1}`)).toBe(GND_NET); // unused inputs
    }
    expect(new Set([0, 1, 2, 3].map((k) => net('U35', `Q${k}`))).size).toBe(4);
    expect(pinsOnNet(L, nets, 'U35', 'TC')).toEqual(['U35.15']); // unused
    expect([...portNames(L)].sort()).toEqual(['BUS0', 'BUS1', 'BUS2', 'BUS3', 'CE', 'CLK', '~CLR', '~CO', '~J'].sort());
  });

  it('has 4 green LEDs bound to the PC bits, numbered MSB first like the netlist (D82 = PC3 ... D85 = PC0)', () => {
    const leds = partsOf(L, 'led');
    expect(leds).toHaveLength(4);
    expect(leds.every((p) => p.color === 'green')).toBe(true);
    expect(Object.fromEntries(leds.map((p) => [p.id, p.label]))).toEqual({ D82: 'PC3', D83: 'PC2', D84: 'PC1', D85: 'PC0' });
    // MSB on the left, in designator order
    const x = (id: string) => holeXY(leds.find((p) => p.id === id)!.anode).x;
    expect(x('D82')).toBeLessThan(x('D83'));
    expect(x('D83')).toBeLessThan(x('D84'));
    expect(x('D84')).toBeLessThan(x('D85'));
    const m = new Machine();
    for (const v of [0, 1, 5, 8, 10, 15]) {
      m.computer.pc = v;
      for (let k = 0; k < 4; k++) expect(pc.live.leds[`D${85 - k}`](m.computer, m), `PC ${v} bit ${k}`).toBe(((v >> k) & 1) === 1);
    }
  });

  it('counts, loads, clears and drives the bus on the chip-level engine', () => {
    const sim = new BreadboardSim(L);
    const value = () => [0, 1, 2, 3].reduce((v, k) => v | ((sim.ledLit(`D${85 - k}`) ? 1 : 0) << k), 0);
    sim.setPort('CLK', 0);
    sim.setPort('~CLR', 0);
    sim.setPort('CE', 0);
    sim.setPort('~J', 1);
    sim.setPort('~CO', 1);
    sim.settle();
    expect(value()).toBe(0);
    sim.setPort('~CLR', 1);
    sim.pulse('CLK');
    expect(value()).toBe(0); // CE low: hold
    sim.setPort('CE', 1);
    for (let i = 1; i <= 17; i++) {
      sim.pulse('CLK');
      expect(value()).toBe(i & 15); // wraps 15 -> 0
    }
    // CO: the 245 puts the count on BUS0-3
    expect(sim.portLevel('BUS0')).toBe('Z');
    sim.setPort('~CO', 0);
    sim.settle();
    expect([0, 1, 2, 3].map((k) => sim.portLevel(`BUS${k}`))).toEqual([1, 0, 0, 0]); // 17 & 15 = 1
    sim.setPort('~CO', 1);
    sim.settle();
    expect(sim.portLevel('BUS0')).toBe('Z');
    // J: load BUS0-3 on the rising edge (load beats count)
    sim.setPort('~J', 0);
    [0, 1, 0, 1].forEach((bit, k) => sim.setPort(`BUS${k}`, bit as 0 | 1));
    sim.pulse('CLK');
    for (let k = 0; k < 4; k++) sim.setPort(`BUS${k}`, null);
    sim.setPort('~J', 1);
    expect(value()).toBe(10);
    // asynchronous clear
    sim.setPort('~CLR', 0);
    sim.settle();
    expect(value()).toBe(0);
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bus

describe('bus', () => {
  const L = bus.layout;
  const nets = staticChecks(bus);
  const signal = L.boards.filter((b) => b.rails === 'signal');

  it('is 8 rail lines on boards turned 90°, inside the bus slot', () => {
    expect(signal).toHaveLength(4);
    for (const b of L.boards) expect(b.place.rotate).toBe(90);
    const bounds = layoutBounds(L);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.w).toBeLessThanOrEqual(BUS_W);
    expect(bounds.h).toBeGreaterThanOrEqual(7 * ROW); // the full height of the scene
    const railBit: Record<string, number> = { 'hi:bn': 7, 'hi:bp': 6, 'hi:tp': 5, 'hi:tn': 4, 'lo:bn': 3, 'lo:bp': 2, 'lo:tp': 1, 'lo:tn': 0 };
    for (const b of signal) {
      const half = b.id.includes('hi') ? 'hi' : 'lo';
      for (const r of ['tn', 'tp', 'bp', 'bn']) expect(nets.netOf(b.id, `${r}${RAIL_COLUMNS[0]}`)).toBe(`port:BUS${railBit[`${half}:${r}`]}`);
    }
    // the two halves of the bus line up: BUS7 on the left ... BUS0 on the right
    const x = (bit: number) => {
      const p = partsOf(L, 'port').find((q) => q.name === `BUS${bit}` && q.board.startsWith('bus-'))!;
      return toScene(L.boards.find((b) => b.id === p.board)!.place, holeXY(p.hole)).x;
    };
    for (let bit = 7; bit > 0; bit--) expect(x(bit)).toBeLessThan(x(bit - 1));
  });

  it('exposes every bit to both module columns in each module row', () => {
    const ports = partsOf(L, 'port').filter((p) => signal.some((b) => b.id === p.board));
    expect(ports).toHaveLength(5 * 16);
    for (let row = 0; row < 5; row++) {
      const inRow = ports.filter((p) => {
        const y = sceneY(L, p);
        return y > row * ROW && y < row * ROW + 18;
      });
      for (const side of ['bottom', 'top'] as const) expect(inRow.filter((p) => p.side === side).map((p) => p.name).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((k) => `BUS${k}`));
      // tags at one height never point the same way from neighbouring rails
      const ys = new Map<number, number>();
      for (const p of inRow) ys.set(sceneY(L, p), (ys.get(sceneY(L, p)) ?? 0) + 1);
      expect([...ys.values()].every((n) => n === 2)).toBe(true);
    }
  });

  it('has the netlist’s 10k pull-downs R8 (BUS7) ... R15 (BUS0) and red LEDs D2 (BUS7) ... D9 (BUS0) with 220R R16-R23 to a real GND rail', () => {
    const leds = L.boards.find((b) => b.id === 'bus-leds')!;
    expect(leds.rails ?? 'power').toBe('power');
    for (let k = 0; k < 8; k++) {
      const r = partsOf(L, 'resistor').find((p) => p.id === `R${15 - k}`)!;
      expect(r.ohms).toBe(10_000);
      expect(r.board).toBe('bus-leds');
      expect([pinNet(L, nets, r.id, 'a'), pinNet(L, nets, r.id, 'b')]).toEqual([`port:BUS${k}`, GND_NET]);
      expect(r.b.startsWith('tn')).toBe(true); // in the GND rail itself
      // LED anode on the line, 220R from its cathode to GND (netlist: Dn.K -> R -> GND)
      const d = partsOf(L, 'led').find((p) => p.id === `D${9 - k}`)!;
      expect(d.color).toBe('red');
      expect(d.label).toBe(`BUS${k}`);
      expect(pinNet(L, nets, d.id, 'anode')).toBe(`port:BUS${k}`);
      const cathode = pinNet(L, nets, d.id, 'cathode');
      expect([VCC_NET, GND_NET].includes(cathode) || cathode.startsWith('port:')).toBe(false);
      const rl = partsOf(L, 'resistor').find((p) => p.id === `R${23 - k}`)!;
      expect(rl.ohms).toBe(220);
      expect(rl.b.startsWith('bn')).toBe(true);
      expect([pinNet(L, nets, rl.id, 'a'), pinNet(L, nets, rl.id, 'b')]).toEqual([cathode, GND_NET]);
    }
    expect(partsOf(L, 'led')).toHaveLength(8);
    expect(partsOf(L, 'resistor').map((p) => p.id).sort()).toEqual(Array.from({ length: 16 }, (_, i) => `R${8 + i}`).sort());
    expect(Object.keys(bus.live.leds)).toHaveLength(8);
    const m = new Machine();
    m.computer.setManualControl(0); // no module drives the bus ...
    m.computer.busInput = 0xa5; // ... except these test switches
    expect(m.computer.bus.value).toBe(0xa5);
    for (let k = 0; k < 8; k++) expect(bus.live.leds[`D${9 - k}`](m.computer, m)).toBe(((0xa5 >> k) & 1) === 1);
    m.computer.busInput = null; // undriven: the pull-downs make it 0
    for (let k = 0; k < 8; k++) expect(bus.live.leds[`D${9 - k}`](m.computer, m)).toBe(false);
  });

  it('pulls undriven lines low and lights the LED of a driven line (engine)', () => {
    const sim = new BreadboardSim(L);
    sim.settle();
    for (let k = 0; k < 8; k++) {
      expect(sim.portLevel(`BUS${k}`)).toBe(0);
      expect(sim.ledLit(`D${9 - k}`)).toBe(false);
    }
    sim.setPort('BUS5', 1);
    sim.settle();
    for (let k = 0; k < 8; k++) expect(sim.ledLit(`D${9 - k}`)).toBe(k === 5);
    sim.setPort('BUS5', null);
    sim.settle();
    expect(sim.ledLit('D4')).toBe(false);
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Together

describe('PC on the bus', () => {
  it('joins by port name: CO shows the count on the bus LEDs', () => {
    const scene = composeComputer([pc, bus]);
    expect(validateLayout(scene.layout)).toEqual([]);
    const sim = new BreadboardSim(scene.layout);
    sim.setPort('CLK', 0);
    sim.setPort('~CLR', 0);
    sim.setPort('CE', 1);
    sim.setPort('~J', 1);
    sim.setPort('~CO', 1);
    sim.step(20);
    sim.setPort('~CLR', 1);
    for (let i = 0; i < 6; i++) sim.pulse('CLK');
    sim.setPort('~CO', 0);
    sim.step(20);
    const busValue = () => [0, 1, 2, 3, 4, 5, 6, 7].reduce((v, k) => v | ((sim.ledLit(`bus/D${9 - k}`) ? 1 : 0) << k), 0);
    expect(busValue()).toBe(6);
    sim.setPort('~CO', 1);
    sim.step(20);
    expect(busValue()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Routing and port names of the front and memory boards

describe('routing of the clock, bus, PC, MAR, RAM and IR boards', () => {
  // Crossings left on each board. PC, clock and bus have none; the rest are
  // forced by the pinout (MAR, RAM: top half) or cross a short power/ground
  // jumper (MAR 1, RAM 1, IR 1). Lower is fine; higher means a routing regressed.
  const CROSSINGS: [ModuleBoardDef, number][] = [[clock, 0], [bus, 0], [pc, 0], [mar, 4], [ram, 3], [ir, 1]];

  for (const [def, budget] of CROSSINGS) {
    it(`${def.id}: no wire under a chip or LED, on another wire, over a used hole or outside its board; no resistor over a leg; tags on the outer rows hide nothing; ≤ ${budget} crossings`, () => {
      const r = routing(def.layout);
      expect(r.problems).toEqual([]);
      expect(r.crossings).toBeLessThanOrEqual(budget);
    });
  }

  it('the RAM address tags sit on the outer rows of both 74189s (U24 starts at column 3, below a rail hole)', () => {
    const L = ram.layout;
    const tags = partsOf(L, 'port').filter((p) => p.board === 'ram2' && /^RA\d$/.test(p.name));
    expect(tags).toHaveLength(8);
    for (const p of tags) expect(p.hole[0], `${p.name} at ${p.hole}`).toBe(p.side === 'top' ? 'a' : 'j');
    // U24's VCC jumper goes straight up into the + rail, no bend along it
    const vccWire = partsOf(L, 'wire').find((w) => w.board === 'ram2' && w.a === 'a3')!;
    expect([vccWire.b, vccWire.via]).toEqual(['tp3', undefined]);
  });

  it('the PC’s two bundles nest: Q0 (the widest) on the outer lane, BUS0 likewise', () => {
    const lanes = (from: (k: number) => string) =>
      [0, 1, 2, 3].map((k) => partsOf(pc.layout, 'wire').find((w) => w.a === from(k))!.via![0][1]);
    const q = lanes((k) => `d${24 + k}`); // Q0..Q3 strips, top half: smaller y = further out
    const p = lanes((k) => `g${41 - k}`); // A8..A5 = BUS0..BUS3, bottom half: larger y = further out
    for (let k = 1; k < 4; k++) {
      expect(q[k]).toBeGreaterThan(q[k - 1]);
      expect(p[k]).toBeLessThan(p[k - 1]);
    }
  });

  it('every port name is on the docs/BREADBOARD.md contract (or module-local RAM.*)', () => {
    for (const def of [clock, bus, pc, mar, ram, ir]) {
      for (const name of portNames(def.layout)) expect(CONTRACT.has(name) || /^RAM\.(D[0-7]|~WE)$/.test(name), `${def.id}: ${name}`).toBe(true);
    }
  });

  it('the checker sees what it should: a wire under a chip or an LED, stacked or crowded wires, hidden ends, tags across the board, a resistor over a leg', () => {
    const L: Layout = {
      boards: [{ id: 'x', place: { x: 0, y: 0 } }, { id: 'bus', place: { x: 0, y: 30, rotate: 90 }, rails: 'signal' }],
      parts: [
        { id: 'U1', board: 'x', kind: 'chip', chip: '74LS00', col: 10 },
        { id: 'w1', board: 'x', kind: 'wire', color: 'blue', a: 'd5', b: 'g20' }, // straight across U1
        { id: 'w2', board: 'x', kind: 'wire', color: 'blue', a: 'h30', b: 'h40' },
        { id: 'w3', board: 'x', kind: 'wire', color: 'blue', a: 'g35', b: 'g45', via: [[34.5, 12.5], [44.5, 12.5]] }, // along row h, over w2
        { id: 'w4', board: 'x', kind: 'wire', color: 'red', a: 'a50', b: 'tp51' },
        { id: 'p1', board: 'x', kind: 'port', name: 'BUS0', hole: 'a51', side: 'top' },
        { id: 'w5', board: 'x', kind: 'wire', color: 'blue', a: 'b2', b: 'b8', via: [[2.5, 5.0], [8.5, 5.0]] },
        { id: 'w6', board: 'x', kind: 'wire', color: 'blue', a: 'c3', b: 'c9', via: [[3.5, 5.2], [9.5, 5.2]] }, // 0.2 under w5
        { id: 'D1', board: 'x', kind: 'led', color: 'red', anode: 'f30', cathode: 'f32' },
        { id: 'w7', board: 'x', kind: 'wire', color: 'blue', a: 'a31', b: 'j31', via: [[31.5, 10.5]] }, // through D1's dome
        { id: 'p2', board: 'x', kind: 'port', name: 'CLK', hole: 'c55', side: 'top' }, // not on the outer row
        { id: 'R1', board: 'x', kind: 'resistor', ohms: 220, a: 'i58', b: 'i62' }, // lies over w8's end at i60
        { id: 'w8', board: 'x', kind: 'wire', color: 'blue', a: 'i60', b: 'i61' },
        { id: 'p3', board: 'bus', kind: 'port', name: 'BUS5', hole: 'tp9', side: 'bottom' }, // a bus line: allowed
      ],
    };
    const r = routing(L);
    const has = (what: string) => expect(r.problems.some((s) => s.includes(what)), `${what} in ${r.problems.join('; ')}`).toBe(true);
    has('w1 runs under U1');
    has('w2 and w3 lie on top of each other');
    has('w5 and w6 lie on top of each other');
    has('BUS0 tag at a51 hides tp51');
    has('w7 runs under D1');
    has('CLK tag at c55 points top across the board');
    has('R1 lies over i60 (w8)');
    expect(r.problems.some((s) => s.includes('BUS5'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The live bindings show what the chip-level boards show

describe('live bindings agree with the chip-level engine', () => {
  const agree = (def: ModuleBoardDef, sim: BreadboardSim, m: Machine, skip: string[] = []) => {
    const got = Object.entries(def.live.leds).filter(([id]) => !skip.includes(id)).map(([id, fn]) => [id, fn(m.computer, m)]);
    const want = got.map(([id]) => [id, sim.ledLit(id as string)]);
    expect(got).toEqual(want);
  };

  it('PC: every count', () => {
    const sim = new BreadboardSim(pc.layout);
    const m = new Machine();
    sim.setPort('CLK', 0);
    sim.setPort('~CLR', 0);
    sim.setPort('CE', 1);
    sim.setPort('~J', 1);
    sim.setPort('~CO', 1);
    sim.settle();
    sim.setPort('~CLR', 1);
    for (let v = 0; v < 18; v++) {
      m.computer.pc = v & 15;
      agree(pc, sim, m);
      sim.pulse('CLK');
    }
  });

  it('bus: each line', () => {
    const sim = new BreadboardSim(bus.layout);
    const m = new Machine();
    m.computer.setManualControl(0);
    for (const v of [0, 1, 2, 4, 8, 16, 32, 64, 128, 0xa5]) {
      for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, ((v >> k) & 1) as 0 | 1);
      sim.settle();
      m.computer.busInput = v;
      agree(bus, sim, m);
    }
  });

  it('clock: the CLK LED through a step-button press, and SW2’s mode (the astable free-runs on the board in manual mode too)', () => {
    const sim = new BreadboardSim(clock.layout);
    const m = new Machine();
    const sw1 = clock.live.controls.SW1 as Extract<(typeof clock.live.controls)[string], { kind: 'button' }>;
    const sw2 = clock.live.controls.SW2 as Extract<(typeof clock.live.controls)[string], { kind: 'slide' }>;
    sim.setPort('HLT', 0);
    sim.step(20);
    expect(sim.slidePos('SW2')).toBe(sw2.get(m)); // both start in manual
    agree(clock, sim, m);
    // the astable free-runs on the board, but the latch keeps it off CLK
    const seen = new Set<number>();
    for (let t = 0; t < 50; t++) {
      sim.step(100);
      seen.add(sim.pinLevel('U1', 'OUT') as number);
      expect(sim.portLevel('CLK')).toBe(0);
    }
    expect([...seen].sort()).toEqual([0, 1]);
    agree(clock, sim, m);
    sim.press('SW1');
    sw1.press(m);
    sim.step(20);
    agree(clock, sim, m);
    sim.release('SW1');
    sim.step(2000); // the one-shot ends
    sw1.release!(m);
    agree(clock, sim, m);
    sim.setSlide('SW2', 1);
    sw2.set(m, 1);
    sim.step(20);
    expect(sim.slidePos('SW2')).toBe(sw2.get(m));
    expect(sim.pinLevel('U3', 'OUT')).toBe(m.mode === 'auto' ? 1 : 0);
  });

  it('clock: SW2 shows the selected mode while the Run button pauses the astable', () => {
    const m = new Machine();
    const sw1 = clock.live.controls.SW1 as Extract<(typeof clock.live.controls)[string], { kind: 'button' }>;
    const sw2 = clock.live.controls.SW2 as Extract<(typeof clock.live.controls)[string], { kind: 'slide' }>;
    m.start();
    m.stop(); // breadboard page "Run" toggled off: still auto, astable paused
    expect(sw2.get(m)).toBe(1);
    sw1.press(m); // auto: the step button does nothing, as on the board
    expect(m.computer.clk).toBe(0);
    // a click on the slide (the page toggles from get) selects manual, and then the button steps
    sw2.set(m, sw2.get(m) ? 0 : 1);
    expect(m.mode).toBe('manual');
    sw1.press(m);
    expect(m.computer.clk).toBe(1);
  });
});
