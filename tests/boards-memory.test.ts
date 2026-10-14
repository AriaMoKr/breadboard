import { describe, expect, it } from 'vitest';
import bus from '../src/breadboard/boards/bus.board';
import ir from '../src/breadboard/boards/ir.board';
import mar from '../src/breadboard/boards/mar.board';
import ram from '../src/breadboard/boards/ram.board';
import { ROW, composeComputer } from '../src/breadboard/computer-layout';
import { BOARD_H, BOARD_W, boardSize, holeXY } from '../src/breadboard/geometry';
import { partPins, placeLayout, validateLayout, type Layout, type ModuleBoardDef } from '../src/breadboard/layout';
import { GND_NET, VCC_NET, buildNets, pinNet, unpoweredChips, type ClosedSwitches, type Netlist } from '../src/breadboard/nets';
import { BreadboardSim } from '../src/breadboard/sim/engine';
import type { Level } from '../src/logic/circuit';
import { Machine } from '../src/sim/machine';

// ---------------------------------------------------------------------------
// helpers

const range = (prefix: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => `${prefix}${from + i}`);
const portNames = (L: Layout) => [...new Set(L.parts.flatMap((p) => (p.kind === 'port' ? [p.name] : [])))].sort();
const internal = (net: string) => net !== VCC_NET && net !== GND_NET && !net.startsWith('port:');

/**
 * Chip pins on an internal net that no other part reaches. Wires only extend
 * nets; another chip pin, a resistor, capacitor, LED or switch leg on the net
 * is a connection (e.g. the RAM's edge node U31.1A is C7 + R58 in pin 1's own
 * strip, with no wire at all).
 */
function unconnectedPins(L: Layout, nets: Netlist): string[] {
  const legs = new Map<string, number>();
  for (const p of L.parts) {
    if (p.kind === 'wire' || p.kind === 'port' || p.kind === 'text') continue;
    for (const pin of partPins(p)) {
      const net = nets.netOf(p.board, pin.hole);
      legs.set(net, (legs.get(net) ?? 0) + 1);
    }
  }
  const out: string[] = [];
  for (const p of L.parts) {
    if (p.kind !== 'chip') continue;
    for (const pin of partPins(p)) {
      const net = nets.netOf(p.board, pin.hole);
      if (internal(net) && (legs.get(net) ?? 0) < 2) out.push(`${p.id}.${pin.name}`);
    }
  }
  return out.sort();
}

/** Static checks every module board must pass (docs/BREADBOARD.md, "Verifying a board"). */
function checkBoard(def: ModuleBoardDef, opts: { boards: number; ports: string[]; leds: number; controls: string[]; floating?: string[] }) {
  const L = def.layout;
  const nets = buildNets(L);
  expect(validateLayout(L)).toEqual([]);
  expect(unpoweredChips(L, nets)).toEqual([]);
  expect(nets.shorted).toBe(false);
  expect(portNames(L)).toEqual([...opts.ports].sort());
  expect(unconnectedPins(L, nets)).toEqual([...(opts.floating ?? [])].sort());
  // every LED bound, every switch/button bound
  const leds = L.parts.filter((p) => p.kind === 'led').map((p) => p.id).sort();
  expect(leds).toHaveLength(opts.leds);
  expect(Object.keys(def.live.leds).sort()).toEqual(leds);
  const controls = L.parts.filter((p) => p.kind === 'dip' || p.kind === 'button' || p.kind === 'slide' || p.kind === 'pot').map((p) => p.id).sort();
  expect(controls).toEqual([...opts.controls].sort());
  expect(Object.keys(def.live.controls).sort()).toEqual(controls);
  // boards stacked at the module origin, y = 0, ROW, 2 ROW ...
  expect(L.boards.map((b) => [b.place.x, b.place.y, b.place.rotate ?? 0])).toEqual(L.boards.map((_, i) => [0, i * ROW, 0]));
  expect(L.boards).toHaveLength(opts.boards);
  for (const b of L.boards) expect(b.title).toBeTruthy();
  // nothing leaves its board: wire bends stay inside the 65 x 18 outline
  for (const p of L.parts) {
    if (p.kind !== 'wire') continue;
    for (const [x, y] of p.via ?? []) {
      expect(x, p.id).toBeGreaterThan(0);
      expect(x, p.id).toBeLessThan(BOARD_W);
      expect(y, p.id).toBeGreaterThan(0);
      expect(y, p.id).toBeLessThan(BOARD_H);
    }
  }
}

/** Lanes (horizontal wire runs) never share a y over overlapping x on one board. */
function overlappingLanes(L: Layout): string[] {
  const segs: { board: string; id: string; y: number; x0: number; x1: number }[] = [];
  for (const p of L.parts) {
    if (p.kind !== 'wire' || !p.via?.length) continue;
    const pts = [holeXY(p.a), ...p.via.map(([x, y]) => ({ x, y })), holeXY(p.b)];
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      if (a.y === b.y && a.x !== b.x) segs.push({ board: p.board, id: p.id, y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
    }
  }
  const bad: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [s, t] = [segs[i], segs[j]];
      if (s.board === t.board && s.id !== t.id && s.y === t.y && Math.min(s.x1, t.x1) - Math.max(s.x0, t.x0) > 0.01) bad.push(`${s.id}/${t.id}@${s.y}`);
    }
  }
  return bad;
}

const value = (bits: boolean[]) => bits.reduce((v, on, i) => v | ((on ? 1 : 0) << i), 0);

/** A board under test in the chip-level engine. */
function bench(L: Layout) {
  const s = new BreadboardSim(L);
  const settle = () => expect(s.settle(20_000).stable).toBe(true);
  const t = {
    s,
    settle,
    set(levels: Record<string, Level | null>) {
      for (const [k, v] of Object.entries(levels)) s.setPort(k, v);
      settle();
      return t;
    },
    /** Drive (or release) `n` ports `prefix0..` with the bits of `v`. */
    word(prefix: string, n: number, v: number | null) {
      for (let i = 0; i < n; i++) s.setPort(`${prefix}${i}`, v === null ? null : (((v >> i) & 1) as 0 | 1));
      settle();
      return t;
    },
    /** Read ports `prefix0..` as a number, or the raw levels if any is not 0/1. */
    read(prefix: string, n: number): number | string {
      const ls = range(prefix, n).map((p) => s.portLevel(p));
      return ls.every((l) => l === 0 || l === 1) ? ls.reduce<number>((v, l, i) => v | ((l as number) << i), 0) : ls.join(',');
    },
    /** One clock pulse: rising edge, high, falling edge, low. */
    clock() {
      s.pulse('CLK', 30, 1);
      settle();
      return t;
    },
    leds: (ids: string[]) => value(ids.map((id) => s.ledLit(id))),
  };
  return t;
}

// ===========================================================================
// Instruction register

describe('IR board', () => {
  const L = ir.layout;
  const nets = buildNets(L);
  const net = (u: string, p: string) => pinNet(L, nets, u, p);

  it('is a valid, powered board with the contract ports and bound LEDs', () => {
    checkBoard(ir, { boards: 1, ports: [...range('BUS', 8), ...range('IR', 4, 4), '~II', '~IO', 'CLK', 'CLR'], leds: 8, controls: [] });
    expect(overlappingLanes(L)).toEqual([]);
  });

  it('is wired like Ben’s ir.png', () => {
    for (const u of ['U14', 'U15']) {
      expect(net(u, '~M')).toBe(GND_NET);
      expect(net(u, '~N')).toBe(GND_NET);
      expect(net(u, '~G1')).toBe('port:~II');
      expect(net(u, '~G2')).toBe('port:~II');
      expect(net(u, 'CP')).toBe('port:CLK');
      expect(net(u, 'MR')).toBe('port:CLR');
    }
    for (let k = 0; k < 4; k++) {
      expect(net('U14', `D${k}`)).toBe(`port:BUS${7 - k}`);
      expect(net('U15', `D${k}`)).toBe(`port:BUS${3 - k}`);
      expect(net('U14', `Q${k}`)).toBe(`port:IR${7 - k}`);
      expect(net('U15', `Q${k}`)).toBe(net('U13', `A${k + 5}`));
      expect(internal(net('U15', `Q${k}`))).toBe(true);
      expect(net('U13', `A${k + 1}`)).toBe(GND_NET);
    }
    expect(net('U13', 'DIR')).toBe(VCC_NET);
    expect(net('U13', '~OE')).toBe('port:~IO');
    for (let k = 1; k <= 8; k++) expect(net('U13', `B${k}`)).toBe(`port:BUS${8 - k}`);
  });

  it('has Ben’s LEDs: D26-D29 blue on IR7-4, D30-D33 yellow on IR3-0, 220 Ω to GND', () => {
    for (let k = 0; k < 4; k++) {
      const hi = L.parts.find((p) => p.id === `D${26 + k}`)!;
      const lo = L.parts.find((p) => p.id === `D${30 + k}`)!;
      expect(hi.kind === 'led' && hi.color).toBe('blue');
      expect(lo.kind === 'led' && lo.color).toBe('yellow');
      expect(pinNet(L, nets, `D${26 + k}`, 'anode')).toBe(`port:IR${7 - k}`);
      expect(pinNet(L, nets, `D${30 + k}`, 'anode')).toBe(net('U15', `Q${k}`));
      for (const [d, r] of [[26 + k, 40 + k], [30 + k, 44 + k]]) {
        const res = L.parts.find((p) => p.id === `R${r}`)!;
        expect(res.kind === 'resistor' && res.ohms).toBe(220);
        const legs = [pinNet(L, nets, `R${r}`, 'a'), pinNet(L, nets, `R${r}`, 'b')];
        expect(legs).toContain(GND_NET);
        expect(legs).toContain(pinNet(L, nets, `D${d}`, 'cathode'));
      }
    }
  });

  it('binds the LEDs to c.ir', () => {
    const m = new Machine();
    m.computer.ir = 0xa5;
    const lit = (id: string) => ir.live.leds[id](m.computer, m);
    expect([26, 27, 28, 29, 30, 31, 32, 33].map((d) => lit(`D${d}`))).toEqual([true, false, true, false, false, true, false, true]);
  });

  it('latches the bus on II and puts the operand back on IO (chip-level engine)', () => {
    const t = bench(L);
    const LEDS = range('D', 8, 26).reverse(); // bit 0 = D33 ... bit 7 = D26
    t.set({ CLK: 0, CLR: 0, '~II': 1, '~IO': 1 });
    t.word('BUS', 8, 0xa5).set({ '~II': 0 }).clock().set({ '~II': 1 }).word('BUS', 8, null);
    expect(t.leds(LEDS)).toBe(0xa5);
    // the opcode leaves on IR4-IR7 (IR0-IR3 stay on the board: they are not contract ports)
    expect([4, 5, 6, 7].map((k) => t.s.portLevel(`IR${k}`))).toEqual([0, 1, 0, 1]);
    expect(t.s.ports().filter((p) => p.startsWith('IR')).sort()).toEqual(range('IR', 4, 4));
    // the low nibble is on the 245's A5-A8 (U15 Q0 = IR3 ... Q3 = IR0)
    expect([0, 1, 2, 3].map((k) => t.s.pinLevel('U13', `A${k + 5}`))).toEqual([0, 1, 0, 1]);
    // nothing on the bus until IO
    expect(t.read('BUS', 8)).toBe('Z,Z,Z,Z,Z,Z,Z,Z');
    t.set({ '~IO': 0 });
    expect(t.read('BUS', 8)).toBe(0x05); // operand on BUS3-0, BUS7-4 actively 0
    t.set({ '~IO': 1 });
    // II high: the clock does not load
    t.word('BUS', 8, 0x3c).clock();
    expect(t.leds(LEDS)).toBe(0xa5);
    t.set({ '~II': 0 }).clock().set({ '~II': 1 });
    expect(t.leds(LEDS)).toBe(0x3c);
    t.set({ CLR: 1 }).set({ CLR: 0 });
    expect(t.leds(LEDS)).toBe(0);
    expect(t.s.problems({ floatingInputs: true })).toEqual([]);
  });
});

// ===========================================================================
// Memory address register

describe('MAR board', () => {
  const L = mar.layout;
  const nets = buildNets(L);
  const net = (u: string, p: string) => pinNet(L, nets, u, p);
  const ADDR_LEDS = ['D47', 'D46', 'D45', 'D44']; // RA0..RA3

  it('is a valid, powered board with the contract ports, bound LEDs and controls', () => {
    checkBoard(mar, { boards: 1, ports: [...range('BUS', 4), ...range('RA', 4), '~MI', 'CLK', 'CLR', 'PROG'], leds: 6, controls: ['SW5', 'SW6'] });
    expect(overlappingLanes(L)).toEqual([]);
  });

  it('is wired like Ben’s mar.png', () => {
    expect(net('U34', '~M')).toBe(GND_NET);
    expect(net('U34', '~N')).toBe(GND_NET);
    expect(net('U34', '~G1')).toBe('port:~MI');
    expect(net('U34', '~G2')).toBe('port:~MI');
    expect(net('U34', 'CP')).toBe('port:CLK');
    expect(net('U34', 'MR')).toBe('port:CLR');
    for (let k = 0; k < 4; k++) expect(net('U34', `D${k}`)).toBe(`port:BUS${3 - k}`);
    expect(net('U33', 'S')).toBe('port:PROG');
    expect(net('U33', '~E')).toBe(GND_NET);
    // [section, MAR output, DIP switch, address bit]
    for (const [s, q, sw, bit] of [[1, 'Q0', 4, 3], [2, 'Q1', 3, 2], [4, 'Q2', 2, 1], [3, 'Q3', 1, 0]] as const) {
      expect(net('U33', `${s}I1`)).toBe(net('U34', q));
      expect(internal(net('U34', q))).toBe(true);
      expect(net('U33', `${s}Y`)).toBe(`port:RA${bit}`);
      // the DIP switch: one leg on the I0 input, the other on GND
      const legs = [pinNet(L, nets, 'SW5', `${sw}a`), pinNet(L, nets, 'SW5', `${sw}b`)];
      expect(legs.sort()).toEqual([net('U33', `${s}I0`), GND_NET].sort());
      expect(internal(net('U33', `${s}I0`))).toBe(true);
    }
  });

  it('has the address LEDs and Ben’s program/run circuit', () => {
    for (let i = 0; i < 4; i++) {
      const d = `D${44 + i}`, r = `R${59 + i}`;
      const led = L.parts.find((p) => p.id === d)!;
      expect(led.kind === 'led' && led.color).toBe('yellow');
      expect(pinNet(L, nets, d, 'anode')).toBe(`port:RA${3 - i}`);
      const res = L.parts.find((p) => p.id === r)!;
      expect(res.kind === 'resistor' && res.ohms).toBe(220);
      expect([pinNet(L, nets, r, 'a'), pinNet(L, nets, r, 'b')].sort()).toEqual([pinNet(L, nets, d, 'cathode'), GND_NET].sort());
    }
    // D48 red: VCC - R63 - D48 - PROG; D49 green: VCC - R64 - D49 - SW6 run throw; SW6 common = GND
    const parts = Object.fromEntries(L.parts.map((p) => [p.id, p]));
    expect(parts.D48.kind === 'led' && parts.D48.color).toBe('red');
    expect(parts.D49.kind === 'led' && parts.D49.color).toBe('green');
    for (const r of ['R63', 'R64']) expect(parts[r].kind === 'resistor' && parts[r].ohms).toBe(1000);
    expect([pinNet(L, nets, 'R63', 'a'), pinNet(L, nets, 'R63', 'b')].sort()).toEqual([pinNet(L, nets, 'D48', 'anode'), VCC_NET].sort());
    expect([pinNet(L, nets, 'R64', 'a'), pinNet(L, nets, 'R64', 'b')].sort()).toEqual([pinNet(L, nets, 'D49', 'anode'), VCC_NET].sort());
    expect(pinNet(L, nets, 'D48', 'cathode')).toBe('port:PROG');
    expect(pinNet(L, nets, 'SW6', 'common')).toBe(GND_NET);
    expect(pinNet(L, nets, 'SW6', 'a')).toBe('port:PROG');
    expect(pinNet(L, nets, 'SW6', 'b')).toBe(pinNet(L, nets, 'D49', 'cathode'));
    // starts in run; the program position grounds PROG
    expect(parts.SW6.kind === 'slide' && parts.SW6.initial).toBe(1);
    const prog: ClosedSwitches = { slides: new Map([['SW6', 0]]) };
    const pn = buildNets(L, prog);
    expect(pinNet(L, pn, 'U33', 'S')).toBe(GND_NET);
    expect(pinNet(L, pn, 'D49', 'cathode')).not.toBe(GND_NET);
  });

  it('binds LEDs and controls to the Computer', () => {
    const m = new Machine();
    const c = m.computer;
    const lit = (id: string) => mar.live.leds[id](c, m);
    c.programMode = false;
    c.mar = 0b1010;
    expect(ADDR_LEDS.map(lit)).toEqual([false, true, false, true]);
    expect([lit('D48'), lit('D49')]).toEqual([false, true]);
    const sw5 = mar.live.controls.SW5, sw6 = mar.live.controls.SW6;
    if (sw5.kind !== 'dip' || sw6.kind !== 'slide') throw new Error('wrong control kinds');
    expect(sw6.get(m)).toBe(1);
    sw6.set(m, 0);
    expect(c.programMode).toBe(true);
    expect(sw6.get(m)).toBe(0);
    expect([lit('D48'), lit('D49')]).toEqual([true, false]);
    sw5.set(m, 0b0101); // switches 1 and 3 ON: bits 0 and 2 read 0
    expect(c.dipAddress).toBe(0b1010);
    expect(sw5.get(m)).toBe(0b0101);
    expect(ADDR_LEDS.map(lit)).toEqual([false, true, false, true]);
    sw6.set(m, 1);
    expect(c.programMode).toBe(false);
  });

  it('loads the MAR on MI and muxes MAR / DIP switches onto RA0-3 (chip-level engine)', () => {
    const t = bench(L);
    t.set({ CLK: 0, CLR: 0, '~MI': 1 });
    // run mode: SW6 starts in run, PROG floats high through R63 + D48
    expect([t.s.ledLit('D48'), t.s.ledLit('D49')]).toEqual([false, true]);
    t.word('BUS', 4, 0b1011).set({ '~MI': 0 }).clock().set({ '~MI': 1 }).word('BUS', 4, null);
    expect(t.read('RA', 4)).toBe(0b1011);
    expect(t.leds(ADDR_LEDS)).toBe(0b1011);
    // MI high: no load
    t.word('BUS', 4, 0b0110).clock().word('BUS', 4, null);
    expect(t.read('RA', 4)).toBe(0b1011);
    // program mode: the DIP switches (ON = 0) give the address
    t.s.setSlide('SW6', 0);
    t.settle();
    expect(t.s.portLevel('PROG')).toBe(0);
    expect([t.s.ledLit('D48'), t.s.ledLit('D49')]).toEqual([true, false]);
    expect(t.read('RA', 4)).toBe(0b1111); // all switches off
    t.s.setDip('SW5', 0b0101);
    t.settle();
    expect(t.read('RA', 4)).toBe(0b1010);
    expect(t.leds(ADDR_LEDS)).toBe(0b1010);
    // back to run: the MAR again; CLR clears it
    t.s.setSlide('SW6', 1);
    t.settle();
    expect(t.read('RA', 4)).toBe(0b1011);
    t.set({ CLR: 1 }).set({ CLR: 0 });
    expect(t.read('RA', 4)).toBe(0);
    expect(t.s.problems()).toEqual([]);
  });
});

// ===========================================================================
// RAM

describe('RAM boards', () => {
  const L = ram.layout;
  const nets = buildNets(L);
  const net = (u: string, p: string) => pinNet(L, nets, u, p);
  const DATA_LEDS = range('D', 8, 36).reverse(); // bit 0 = D43 ... bit 7 = D36
  const FLOATING = [
    // spare gates Ben leaves unconnected
    ...['5A', '5Y', '6A', '6Y'].map((p) => `U28.${p}`),
    ...['4A', '4Y', '5A', '5Y'].map((p) => `U29.${p}`),
    ...['2A', '2B', '2Y', '3A', '3B', '3Y', '4A', '4B', '4Y'].map((p) => `U31.${p}`),
    ...['1I0', '1I1', '1Y', '2I0', '2I1', '2Y', '3I0', '3I1', '3Y'].map((p) => `U32.${p}`),
  ];

  it('is two valid, powered boards with the contract ports, bound LEDs and controls', () => {
    checkBoard(ram, {
      boards: 2,
      ports: [...range('BUS', 8), ...range('RA', 4), 'PROG', 'RI', '~RO', 'CLK', ...range('RAM.D', 8), 'RAM.~WE'],
      leds: 8,
      controls: ['SW3', 'SW4'],
      floating: FLOATING,
    });
    expect(overlappingLanes(L)).toEqual([]);
    // the module-local tags join the two boards
    for (const name of [...range('RAM.D', 8), 'RAM.~WE']) {
      const boards = new Set(L.parts.flatMap((p) => (p.kind === 'port' && p.name === name ? [p.board] : [])));
      expect([...boards].sort()).toEqual(['ram', 'ram2']);
    }
  });

  it('feeds the 74189s like Ben’s ram.png', () => {
    for (const u of ['U24', 'U25']) {
      for (let a = 0; a < 4; a++) expect(net(u, `A${a}`)).toBe(`port:RA${a}`);
      expect(net(u, '~CS')).toBe(GND_NET);
      expect(net(u, '~WE')).toBe('port:RAM.~WE');
    }
    for (const u of ['U26', 'U27', 'U32']) {
      expect(net(u, 'S')).toBe('port:PROG');
      expect(net(u, '~E')).toBe(GND_NET);
    }
    // [mux, section, data bit, 74189, D pin]
    const DATA = [
      ['U27', 1, 3, 'U25', 'D4'], ['U27', 2, 2, 'U25', 'D3'], ['U27', 4, 1, 'U25', 'D2'], ['U27', 3, 0, 'U25', 'D1'],
      ['U26', 1, 7, 'U24', 'D1'], ['U26', 2, 6, 'U24', 'D2'], ['U26', 4, 5, 'U24', 'D3'], ['U26', 3, 4, 'U24', 'D4'],
    ] as const;
    for (const [mux, s, bit, chip, d] of DATA) {
      expect(net(mux, `${s}I1`)).toBe(`port:BUS${bit}`);
      expect(net(mux, `${s}Y`)).toBe(`port:RAM.D${bit}`);
      expect(net(chip, d)).toBe(`port:RAM.D${bit}`);
      // SW3 switch bit+1: one leg on the I0 input, the other on GND
      const legs = [pinNet(L, nets, 'SW3', `${bit + 1}a`), pinNet(L, nets, 'SW3', `${bit + 1}b`)];
      expect(legs.sort()).toEqual([net(mux, `${s}I0`), GND_NET].sort());
      expect(internal(net(mux, `${s}I0`))).toBe(true);
    }
  });

  it('builds ~WE like Ben: U32 section c picks SW4 (program) or NAND(RI, CLK edge) (run)', () => {
    expect(net('U32', '4Y')).toBe('port:RAM.~WE');
    expect(net('U32', '4I1')).toBe(net('U31', '1Y'));
    expect(internal(net('U31', '1Y'))).toBe(true);
    expect(net('U31', '1B')).toBe('port:RI');
    const edge = net('U31', '1A');
    expect(internal(edge)).toBe(true);
    const parts = Object.fromEntries(L.parts.map((p) => [p.id, p]));
    expect(parts.C7.kind === 'capacitor' && parts.C7.farads).toBe(1e-8);
    expect([pinNet(L, nets, 'C7', 'a'), pinNet(L, nets, 'C7', 'b')].sort()).toEqual(['port:CLK', edge].sort());
    expect(parts.R58.kind === 'resistor' && parts.R58.ohms).toBe(1000);
    expect([pinNet(L, nets, 'R58', 'a'), pinNet(L, nets, 'R58', 'b')].sort()).toEqual([GND_NET, edge].sort());
    // write button to GND, plus the pull-up added on this board
    const i0 = net('U32', '4I0');
    expect(internal(i0)).toBe(true);
    expect([pinNet(L, nets, 'SW4', 'a'), pinNet(L, nets, 'SW4', 'b')].sort()).toEqual([GND_NET, i0].sort());
    expect([pinNet(L, nets, 'R_SW4', 'a'), pinNet(L, nets, 'R_SW4', 'b')].sort()).toEqual([VCC_NET, i0].sort());
    expect(pinNet(L, buildNets(L, { buttons: new Set(['SW4']) }), 'U32', '4I0')).toBe(GND_NET);
  });

  it('inverts the outputs into the LEDs and the 245 like Ben’s ram.png', () => {
    // [74189 output, inverter, input, output, data bit]
    const OUT = [
      ['U24', '~O1', 'U28', '1A', '1Y', 7], ['U24', '~O2', 'U28', '2A', '2Y', 6], ['U24', '~O3', 'U28', '3A', '3Y', 5], ['U24', '~O4', 'U28', '4A', '4Y', 4],
      ['U25', '~O4', 'U29', '6A', '6Y', 3], ['U25', '~O3', 'U29', '1A', '1Y', 2], ['U25', '~O2', 'U29', '2A', '2Y', 1], ['U25', '~O1', 'U29', '3A', '3Y', 0],
    ] as const;
    for (const [chip, o, inv, a, y, bit] of OUT) {
      expect(net(chip, o)).toBe(net(inv, a));
      expect(internal(net(chip, o))).toBe(true);
      expect(net(inv, y)).toBe(net('U30', `A${8 - bit}`));
      expect(internal(net(inv, y))).toBe(true);
      const d = `D${43 - bit}`, r = `R${57 - bit}`;
      const led = L.parts.find((p) => p.id === d)!;
      expect(led.kind === 'led' && led.color).toBe('red');
      expect(pinNet(L, nets, d, 'anode')).toBe(net(inv, y));
      const res = L.parts.find((p) => p.id === r)!;
      expect(res.kind === 'resistor' && res.ohms).toBe(220);
      expect([pinNet(L, nets, r, 'a'), pinNet(L, nets, r, 'b')].sort()).toEqual([pinNet(L, nets, d, 'cathode'), GND_NET].sort());
    }
    expect(net('U30', 'DIR')).toBe(VCC_NET);
    expect(net('U30', '~OE')).toBe('port:~RO');
    for (let k = 1; k <= 8; k++) expect(net('U30', `B${k}`)).toBe(`port:BUS${8 - k}`);
  });

  it('binds LEDs and controls to the Computer', () => {
    const m = new Machine();
    const c = m.computer;
    c.programMode = false;
    c.mar = 5;
    c.ram[5] = 0x96;
    expect(DATA_LEDS.map((id) => ram.live.leds[id](c, m))).toEqual([false, true, true, false, true, false, false, true]);
    const sw3 = ram.live.controls.SW3, sw4 = ram.live.controls.SW4;
    if (sw3.kind !== 'dip' || sw4.kind !== 'button') throw new Error('wrong control kinds');
    sw3.set(m, 0x0f); // switches 1-4 ON: data bits 0-3 read 0
    expect(c.dipData).toBe(0xf0);
    expect(sw3.get(m)).toBe(0x0f);
    // the write button only works in program mode
    c.dipAddress = 2;
    sw4.press(m);
    expect(c.ram[2]).not.toBe(0xf0);
    c.programMode = true;
    let changes = 0;
    m.onChange(() => changes++);
    sw4.press(m);
    expect(c.ram[2]).toBe(0xf0);
    expect(changes).toBeGreaterThan(0);
  });

  it('writes on the clock edge with RI, reads on RO, and writes from the switches in program mode (chip-level engine)', () => {
    const t = bench(L);
    const ramLeds = () => t.leds(DATA_LEDS);
    t.set({ CLK: 0, RI: 0, '~RO': 1, PROG: 1 });
    // run mode: write 0x5A at address 3
    t.word('RA', 4, 3).word('BUS', 8, 0x5a).set({ RI: 1 }).clock().set({ RI: 0 }).word('BUS', 8, null);
    expect(ramLeds()).toBe(0x5a);
    // write 0xC3 at address 7, then address 3 still holds 0x5A
    t.word('RA', 4, 7).word('BUS', 8, 0xc3).set({ RI: 1 }).clock().set({ RI: 0 }).word('BUS', 8, null);
    expect(ramLeds()).toBe(0xc3);
    t.word('RA', 4, 3);
    expect(ramLeds()).toBe(0x5a);
    // RO puts it on the bus, otherwise the 245 lets go
    expect(t.read('BUS', 8)).toBe('Z,Z,Z,Z,Z,Z,Z,Z');
    t.set({ '~RO': 0 });
    expect(t.read('BUS', 8)).toBe(0x5a);
    t.set({ '~RO': 1 });
    // no RI: the clock does not write
    t.word('BUS', 8, 0xff).clock().word('BUS', 8, null);
    expect(ramLeds()).toBe(0x5a);
    // the write is a short pulse after the rising edge: a bus change while CLK stays high is not stored
    t.word('BUS', 8, 0x11).set({ RI: 1, CLK: 1 });
    t.s.step(50);
    t.word('BUS', 8, 0x22);
    t.s.step(50);
    t.set({ CLK: 0, RI: 0 }).word('BUS', 8, null);
    expect(ramLeds()).toBe(0x11);
    // program mode: SW3 gives the data (ON = 0), SW4 writes while held; RI and CLK do nothing
    t.set({ PROG: 0 });
    t.s.setDip('SW3', ~0x81 & 0xff);
    t.settle();
    t.word('BUS', 8, 0x00).set({ RI: 1 }).clock().set({ RI: 0 }).word('BUS', 8, null);
    expect(ramLeds()).toBe(0x11);
    t.s.press('SW4');
    t.settle();
    t.s.release('SW4');
    t.settle();
    expect(ramLeds()).toBe(0x81);
    t.set({ PROG: 1 });
    t.word('RA', 4, 7);
    expect(ramLeds()).toBe(0xc3);
    expect(t.s.problems()).toEqual([]);
  });
});

// ===========================================================================
// MAR + RAM together (the PROG and RA0-3 tags join the boards)

describe('MAR and RAM boards together', () => {
  it('programs the RAM from the switches, then reads it back through the MAR in run mode', () => {
    const a = placeLayout(mar.layout, 0, 0, 'mar');
    const r = placeLayout(ram.layout, 0, ROW, 'ram');
    const L: Layout = { boards: [...a.boards, ...r.boards], parts: [...a.parts, ...r.parts] };
    expect(validateLayout(L)).toEqual([]);
    const t = bench(L);
    const ramLeds = () => t.leds(range('ram/D', 8, 36).reverse());
    t.set({ CLK: 0, CLR: 0, '~MI': 1, RI: 0, '~RO': 1 });
    // program mode: address 9 on SW5, data 0x3C on SW3, press write
    t.s.setSlide('mar/SW6', 0);
    t.s.setDip('mar/SW5', ~9 & 0x0f);
    t.s.setDip('ram/SW3', ~0x3c & 0xff);
    t.settle();
    expect(t.read('RA', 4)).toBe(9);
    t.s.press('ram/SW4');
    t.settle();
    t.s.release('ram/SW4');
    t.settle();
    expect(ramLeds()).toBe(0x3c);
    // run mode: MAR <- 9 from the bus, then RO
    t.s.setSlide('mar/SW6', 1);
    t.settle();
    t.word('BUS', 4, 9).set({ '~MI': 0 }).clock().set({ '~MI': 1 }).word('BUS', 4, null);
    expect(t.read('RA', 4)).toBe(9);
    expect(t.s.ledLit('mar/D49')).toBe(true);
    t.set({ '~RO': 0 });
    expect(t.read('BUS', 8)).toBe(0x3c);
    t.set({ '~RO': 1 });
    // run-mode write at the same address (STA's AO|RI step)
    t.word('BUS', 8, 0xe7).set({ RI: 1 }).clock().set({ RI: 0 }).word('BUS', 8, null);
    expect(ramLeds()).toBe(0xe7);
    expect(t.s.problems()).toEqual([]);
  });
});

// ===========================================================================
// The memory modules in the computer scene, on Ben's bus

describe('MAR, RAM and IR on the bus (composed scene)', () => {
  const scene = composeComputer([mar, ram, ir, bus]);
  const L = scene.layout;

  it('is valid, its boards do not overlap, and RA0-3 / PROG / BUS0-7 have both ends', () => {
    expect(validateLayout(L)).toEqual([]);
    const nets = buildNets(L);
    expect(unpoweredChips(L, nets)).toEqual([]);
    expect(nets.shorted).toBe(false);
    const boxes = L.boards.map((b) => ({ id: b.id, ...b.place, ...boardSize(b.place) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]];
        const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
        expect(apart, `${p.id} overlaps ${q.id}`).toBe(true);
      }
    }
    const modulesOf = new Map<string, Set<string>>();
    for (const p of L.parts) if (p.kind === 'port') modulesOf.set(p.name, (modulesOf.get(p.name) ?? new Set()).add(p.id.split('/')[0]));
    for (const name of [...range('RA', 4), 'PROG']) expect([...modulesOf.get(name)!].sort(), name).toEqual(['mar', 'ram']);
    for (const name of range('BUS', 8)) expect(modulesOf.get(name)?.has('bus'), name).toBe(true);
    for (const name of range('BUS', 4)) expect([...modulesOf.get(name)!].sort(), name).toEqual(['bus', 'ir', 'mar', 'ram']);
  });

  it('runs LDA 14 through fetch and decode at chip level (T0 MI|CO, T1 RO|II, T2 IO|MI, T3 RO)', () => {
    const t = bench(L);
    const busLeds = () => t.leds(range('bus/D', 8, 74));
    const irLeds = () => t.leds(range('ir/D', 8, 26).reverse());
    const ramLeds = () => t.leds(range('ram/D', 8, 36).reverse());
    t.set({ CLK: 0, CLR: 0, '~MI': 1, RI: 0, '~RO': 1, '~II': 1, '~IO': 1 });
    // program mode: RAM[0] = LDA 14 (0001 1110), RAM[14] = 42
    t.s.setSlide('mar/SW6', 0);
    for (const [addr, data] of [[0, 0x1e], [14, 42]]) {
      t.s.setDip('mar/SW5', ~addr & 0x0f);
      t.s.setDip('ram/SW3', ~data & 0xff);
      t.settle();
      t.s.press('ram/SW4');
      t.settle();
      t.s.release('ram/SW4');
      t.settle();
      expect(ramLeds()).toBe(data);
    }
    // run mode, reset: MAR and IR clear, the bus pull-downs read 0
    t.s.setSlide('mar/SW6', 1);
    t.settle();
    t.set({ CLR: 1 }).set({ CLR: 0 });
    expect([t.read('RA', 4), irLeds(), t.read('BUS', 8), busLeds()]).toEqual([0, 0, 0, 0]);
    // T0: MI | CO (the PC is not in this scene: drive its 0 onto BUS0-3)
    t.word('BUS', 4, 0).set({ '~MI': 0 }).clock().set({ '~MI': 1 }).word('BUS', 4, null);
    expect(t.read('RA', 4)).toBe(0);
    expect(ramLeds()).toBe(0x1e);
    // T1: RO | II
    t.set({ '~RO': 0, '~II': 0 });
    expect(busLeds()).toBe(0x1e);
    t.clock().set({ '~RO': 1, '~II': 1 });
    expect(irLeds()).toBe(0x1e);
    expect([4, 5, 6, 7].map((k) => t.s.portLevel(`IR${k}`))).toEqual([1, 0, 0, 0]); // opcode 0001
    expect(busLeds()).toBe(0);
    // T2: IO | MI: only the operand goes on the bus
    t.set({ '~IO': 0, '~MI': 0 });
    expect([t.read('BUS', 8), busLeds()]).toEqual([0x0e, 0x0e]);
    t.clock().set({ '~IO': 1, '~MI': 1 });
    expect(t.read('RA', 4)).toBe(14);
    expect(t.leds(['mar/D47', 'mar/D46', 'mar/D45', 'mar/D44'])).toBe(14);
    // T3: RO (| AI): RAM[14] on the bus
    t.set({ '~RO': 0 });
    expect([t.read('BUS', 8), busLeds(), ramLeds()]).toEqual([42, 42, 42]);
    t.set({ '~RO': 1 });
    expect(busLeds()).toBe(0);
    expect(t.s.problems()).toEqual([]);
  });
});
