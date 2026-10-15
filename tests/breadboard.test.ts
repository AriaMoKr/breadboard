import { describe, expect, it } from 'vitest';
import aRegister from '../src/breadboard/boards/a-register.board';
import { CHIPS } from '../src/breadboard/catalog';
import { dipPinHole, holeXY, parseHole, stripOf, RAIL_COLUMNS } from '../src/breadboard/geometry';
import { LayoutBuilder, validateLayout } from '../src/breadboard/layout';
import { GND_NET, VCC_NET, buildNets, pinNet, unpoweredChips } from '../src/breadboard/nets';
import { BreadboardSim } from '../src/breadboard/sim/engine';
import type { Level } from '../src/logic/circuit';
import type { Computer } from '../src/sim/computer';
import type { Machine } from '../src/sim/machine';

describe('breadboard geometry', () => {
  it('parses holes and knows which exist', () => {
    expect(parseHole('e12')).toEqual({ row: 'e', col: 12 });
    expect(() => parseHole('k3')).toThrow();
    expect(() => parseHole('tp8')).toThrow(); // gap between rail groups
    expect(parseHole('tp9')).toEqual({ row: 'tp', col: 9 });
    expect(RAIL_COLUMNS.length).toBe(50);
  });
  it('strips: a-e and f-j of a column, rails whole', () => {
    expect(stripOf('a5')).toBe(stripOf('e5'));
    expect(stripOf('e5')).not.toBe(stripOf('f5'));
    expect(stripOf('tp3')).toBe(stripOf('tp61'));
  });
  it('DIP pins straddle the channel, pin 1 bottom-left, anticlockwise', () => {
    expect(dipPinHole(10, 16, 1)).toBe('f10');
    expect(dipPinHole(10, 16, 8)).toBe('f17');
    expect(dipPinHole(10, 16, 9)).toBe('e17');
    expect(dipPinHole(10, 16, 16)).toBe('e10');
    // rotated 180°: pin 1 top-right
    expect(dipPinHole(17, 16, 1, 3, true)).toBe('e17');
    expect(dipPinHole(17, 16, 9, 3, true)).toBe('f10');
    // 0.6" EEPROM
    expect(dipPinHole(5, 24, 1, 6)).toBe('h5');
    expect(dipPinHole(5, 24, 24, 6)).toBe('d5');
    expect(holeXY('f1')).toEqual({ x: 1.5, y: 10.5 });
  });
  it('catalog pin lists match pin counts and power pins', () => {
    for (const c of Object.values(CHIPS)) {
      expect(c.pins.length % 2).toBe(0);
      expect(c.pins[c.vcc - 1]).toBe('VCC');
      expect(c.pins[c.gnd - 1]).toBe('GND');
    }
  });
});

describe('layout builder', () => {
  it('rejects two legs in one hole', () => {
    const b = new LayoutBuilder();
    const bb = b.board('x');
    bb.chip('U1', '74LS00', 10);
    expect(() => bb.wire('f10', 'tp9')).toThrow(/already used/);
  });
  it('free() walks away from the channel', () => {
    const b = new LayoutBuilder();
    const bb = b.board('x');
    const u = bb.chip('U1', '74LS00', 10);
    expect(u.free(1)).toBe('g10');
    expect(u.free(14)).toBe('d10');
    bb.wire('g10', 'g20');
    expect(u.free(1)).toBe('h10');
  });
});

describe('A register board (reference)', () => {
  const L = aRegister.layout;
  const nets = buildNets(L);
  const net = (u: string, p: string | number) => pinNet(L, nets, u, p);
  it('is a valid layout with every chip powered', () => {
    expect(validateLayout(L)).toEqual([]);
    expect(unpoweredChips(L, nets)).toEqual([]);
    expect(nets.shorted).toBe(false);
  });
  it('is wired like Ben’s schematic', () => {
    for (const u of ['U8', 'U9']) {
      expect(net(u, '~M')).toBe(GND_NET);
      expect(net(u, '~N')).toBe(GND_NET);
      expect(net(u, '~G1')).toBe('port:~AI');
      expect(net(u, '~G2')).toBe('port:~AI');
      expect(net(u, 'CP')).toBe('port:CLK');
      expect(net(u, 'MR')).toBe('port:CLR');
    }
    expect(net('U7', 'DIR')).toBe(VCC_NET);
    expect(net('U7', '~OE')).toBe('port:~AO');
  });
  it('runs the bits like the KiCad netlist: the high bit of each chip on its lowest pin', () => {
    // U8 = bits 7-4 (D0/Q0 = bit 7), U9 = bits 3-0 (D0/Q0 = bit 3), U7 A1/B1 = bit 7 ... A8/B8 = bit 0
    for (let bit = 0; bit < 8; bit++) {
      const u = bit < 4 ? 'U9' : 'U8';
      const k = 3 - (bit % 4);
      expect(net(u, `D${k}`)).toBe(`port:BUS${bit}`);
      expect(net(u, `Q${k}`)).toBe(`port:A${bit}`);
      expect(net('U7', `B${8 - bit}`)).toBe(`port:BUS${bit}`);
      expect(net('U7', `A${8 - bit}`)).toBe(`port:A${bit}`);
    }
    expect(net('U9', 6)).toBe('port:A0'); // netlist: A_0 = U9 pin 6 (Q3)
    expect(net('U8', 3)).toBe('port:A7'); // A_7 = U8 pin 3 (Q0)
    expect(net('U9', 11)).toBe('port:BUS0'); // BUS_0 = U9 pin 11 (D3)
    expect(net('U7', 9)).toBe('port:A0'); // A_0 = U7 pin 9
    expect(net('U7', 11)).toBe('port:BUS0'); // BUS_0 = U7 pin 11
  });
  it('has 8 red LEDs D10 (A7) ... D17 (A0) on the register outputs, bound to c.a, bit 7 on the left', () => {
    const leds = L.parts.filter((p) => p.kind === 'led');
    expect(leds.map((p) => p.id).sort()).toEqual(['D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17']);
    expect(Object.keys(aRegister.live.leds).sort()).toEqual(leds.map((p) => p.id).sort());
    const xs: number[] = [];
    for (let bit = 7; bit >= 0; bit--) {
      const id = `D${17 - bit}`; // D10 (A7) ... D17 (A0), as in the netlist
      const led = leds.find((p) => p.id === id)!;
      expect(led.kind === 'led' && led.color).toBe('red');
      expect(pinNet(L, nets, id, 'anode')).toBe(`port:A${bit}`);
      expect(pinNet(L, nets, id, 'cathode')).toBe(GND_NET);
      if (led.kind === 'led') xs.push(holeXY(led.anode).x);
      for (const v of [0, 0xff, 0xa5, 0x5a, 1 << bit]) {
        expect(aRegister.live.leds[id]({ a: v } as Computer, {} as Machine), `${id} ${v}`).toBe(((v >> bit) & 1) === 1);
      }
    }
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
  });
  it('points the A0-A7 and CLK tags down (the ALU sits below), the rest up', () => {
    for (const p of L.parts) {
      if (p.kind !== 'port') continue;
      expect(p.side, p.name).toBe(/^A\d$/.test(p.name) || p.name === 'CLK' ? 'bottom' : 'top');
    }
  });

  // ---- chip level ----------------------------------------------------------

  function bench() {
    const sim = new BreadboardSim(L);
    const settle = () => expect(sim.settle(5000).stable).toBe(true);
    const set = (levels: Record<string, Level | null>) => {
      for (const [k, v] of Object.entries(levels)) sim.setPort(k, v);
      settle();
    };
    const bus = (v: number | null) => {
      for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, v === null ? null : (((v >> k) & 1) as Level));
      settle();
    };
    const read = (prefix: string): number | string => {
      let v = 0;
      for (let k = 0; k < 8; k++) {
        const l = sim.portLevel(`${prefix}${k}`);
        if (l !== 0 && l !== 1) return `${prefix}${k}=${l}`;
        v |= l << k;
      }
      return v;
    };
    const leds = () => [0, 1, 2, 3, 4, 5, 6, 7].reduce((v, bit) => v | ((sim.ledLit(`D${17 - bit}`) ? 1 : 0) << bit), 0);
    const clock = () => {
      sim.pulse('CLK', 20, 1);
      settle();
    };
    // the rest of the computer at rest: no load, no output, no reset, clock low
    set({ CLK: 0, CLR: 0, '~AI': 1, '~AO': 1 });
    return { sim, set, bus, read, leds, clock };
  }

  it('loads the bus on a rising CLK edge while ~AI is low, holds otherwise (chip level)', () => {
    const t = bench();
    t.bus(0x2c);
    expect(t.read('A')).toBe(0);
    t.clock();
    expect(t.read('A')).toBe(0); // ~AI high: no load
    t.set({ '~AI': 0 });
    expect(t.read('A')).toBe(0); // nothing before the edge
    t.clock();
    expect(t.read('A')).toBe(0x2c);
    expect(t.leds()).toBe(0x2c);
    t.bus(0xd3);
    expect(t.read('A')).toBe(0x2c); // edge-triggered
    t.set({ CLK: 1 });
    expect(t.read('A')).toBe(0xd3);
    t.bus(0x11);
    t.set({ CLK: 0 }); // the falling edge does nothing
    expect(t.read('A')).toBe(0xd3);
    t.set({ '~AI': 1 });
    t.clock();
    expect(t.read('A')).toBe(0xd3);
    for (let bit = 0; bit < 8; bit++) {
      t.bus(1 << bit);
      t.set({ '~AI': 0 });
      t.clock();
      t.set({ '~AI': 1 });
      expect(t.read('A')).toBe(1 << bit);
      expect(t.leds(), `LED of bit ${bit}`).toBe(1 << bit);
    }
    expect(t.sim.problems({ floatingInputs: true })).toEqual([]);
  });

  it('drives the bus only while ~AO is low (chip level)', () => {
    const t = bench();
    t.bus(0x9b);
    t.set({ '~AI': 0 });
    t.clock();
    t.set({ '~AI': 1 });
    t.bus(null);
    for (let k = 0; k < 8; k++) expect(t.sim.portLevel(`BUS${k}`)).toBe('Z'); // ~AO high: the 245 is off
    t.set({ '~AO': 0 });
    expect(t.read('BUS')).toBe(0x9b);
    t.set({ '~AO': 1 });
    for (let k = 0; k < 8; k++) expect(t.sim.portLevel(`BUS${k}`)).toBe('Z');
    // AI and AO at once (never in Ben's microcode): the register reloads what it drives
    t.set({ '~AO': 0, '~AI': 0 });
    t.clock();
    t.set({ '~AO': 1, '~AI': 1 });
    expect(t.read('A')).toBe(0x9b);
    expect(t.sim.problems()).toEqual([]);
  });

  it('clears asynchronously while CLR is high (chip level)', () => {
    const t = bench();
    t.bus(0xff);
    t.set({ '~AI': 0 });
    t.clock();
    expect(t.read('A')).toBe(0xff);
    t.set({ CLR: 1 });
    expect(t.read('A')).toBe(0); // no clock needed
    expect(t.leds()).toBe(0);
    t.clock(); // held in reset: the edge loads nothing
    expect(t.read('A')).toBe(0);
    t.set({ CLR: 0 });
    t.clock();
    expect(t.read('A')).toBe(0xff);
  });
});
