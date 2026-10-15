import { describe, expect, it } from 'vitest';
import aRegister from '../src/breadboard/boards/a-register.board';
import alu from '../src/breadboard/boards/alu.board';
import bRegister from '../src/breadboard/boards/b-register.board';
import control from '../src/breadboard/boards/control.board';
import flags from '../src/breadboard/boards/flags.board';
import output from '../src/breadboard/boards/output.board';
import { CHIPS } from '../src/breadboard/catalog';
import { composeComputer } from '../src/breadboard/computer-layout';
import { partPins, validateLayout, type Layout, type ModuleBoardDef } from '../src/breadboard/layout';
import { GND_NET, VCC_NET, buildNets, pinNet, unpoweredChips, type Netlist } from '../src/breadboard/nets';
import { BreadboardSim } from '../src/breadboard/sim/engine';
import type { Computer } from '../src/sim/computer';
import { Machine } from '../src/sim/machine';
import { SIGNAL_BITS } from '../src/sim/signals';
import { untidy } from './helpers/tidy';

// ---------------------------------------------------------------------------
// helpers

const range = (prefix: string, n = 8) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Port names of the contract in docs/BREADBOARD.md. */
const CONTRACT = new Set([
  ...range('BUS'), 'CLK', '~CLK', 'CLR', '~CLR',
  'HLT', '~MI', 'RI', '~RO', '~IO', '~II', '~AI', '~AO', '~EO', 'SU', '~BI', 'OI', 'CE', '~CO', '~J', '~FI',
  ...range('A'), ...range('B'), ...range('SUM'), 'CARRY', 'CF', 'ZF', ...range('IR', 8).slice(4), ...range('RA', 4), 'PROG',
]);

const portNames = (L: Layout) => new Set(L.parts.flatMap((p) => (p.kind === 'port' ? [p.name] : [])));
const isInternal = (net: string) => net !== VCC_NET && net !== GND_NET && !net.startsWith('port:');

/** Chip pins whose strip is joined to nothing else (no wire, port, rail or other part's net). */
function unconnectedPins(L: Layout, nets: Netlist): string[] {
  const size = new Map<string, number>();
  for (const [root, list] of nets.members()) size.set(root, list.length);
  const out: string[] = [];
  for (const p of L.parts) {
    if (p.kind !== 'chip') continue;
    for (const pin of partPins(p)) {
      const net = nets.netOf(p.board, pin.hole);
      if (isInternal(net) && (size.get(net) ?? 1) < 2) out.push(`${p.id}.${pin.name}`);
    }
  }
  return out.sort();
}

/** Nets of one gate of a quad 2-input gate chip (74LS02/08/86 pin names). */
const gate = (L: Layout, nets: Netlist, chip: string, g: number) => ({
  ins: [pinNet(L, nets, chip, `${g}A`), pinNet(L, nets, chip, `${g}B`)].sort(),
  out: pinNet(L, nets, chip, `${g}Y`),
});

/** The things every module board must satisfy (docs/BREADBOARD.md, "Verifying a board"). */
function checkBoard(def: ModuleBoardDef, ports: string[], leds: number, floatingOutputs: string[] = []) {
  const L = def.layout;
  const nets = buildNets(L);
  expect(validateLayout(L)).toEqual([]);
  expect(unpoweredChips(L, nets)).toEqual([]);
  expect(nets.shorted).toBe(false);
  // ports: exactly the expected ones, all from the contract
  const names = portNames(L);
  for (const n of names) expect(CONTRACT.has(n), `port ${n} is not in the contract`).toBe(true);
  expect([...names].sort()).toEqual([...ports].sort());
  // every chip pin is wired, except unused outputs
  expect(unconnectedPins(L, nets)).toEqual([...floatingOutputs].sort());
  // every LED is bound to the Computer; no controls on these boards
  const ledParts = L.parts.filter((p) => p.kind === 'led');
  expect(ledParts).toHaveLength(leds);
  expect(Object.keys(def.live.leds).sort()).toEqual(ledParts.map((p) => p.id).sort());
  expect(Object.keys(def.live.controls)).toEqual([]);
  // everything sits on its own BB830s, stacked at y = 0, 25, ...
  for (const b of L.boards) expect(b.place.x).toBe(0);
}

/** A stand-in Computer for the live bindings. */
const fakeComputer = (state: Partial<{ b: number; alu: number; flagC: 0 | 1; flagZ: 0 | 1 }>) =>
  ({ b: state.b ?? 0, alu: { value: state.alu ?? 0, carry: 0, zero: 0, subtract: false }, flagC: state.flagC ?? 0, flagZ: state.flagZ ?? 0 }) as unknown as Computer;
const noMachine = {} as Machine;

// ---- engine helpers ---------------------------------------------------------

function sim(L: Layout) {
  const s = new BreadboardSim(L);
  const settle = () => expect(s.settle(5000).stable).toBe(true);
  return {
    s,
    settle,
    set(levels: Record<string, 0 | 1 | null>) {
      for (const [k, v] of Object.entries(levels)) s.setPort(k, v);
      settle();
      return this;
    },
    byte(prefix: string, v: number | null) {
      for (let i = 0; i < 8; i++) s.setPort(`${prefix}${i}`, v === null ? null : (((v >> i) & 1) as 0 | 1));
      settle();
      return this;
    },
    read(prefix: string): number | string {
      let v = 0;
      const levels: string[] = [];
      for (let i = 0; i < 8; i++) {
        const l = s.portLevel(`${prefix}${i}`);
        levels.push(String(l));
        if (l === 1) v |= 1 << i;
        else if (l !== 0) return levels.join(',');
      }
      return v;
    },
    /** The LEDs of a register, read as a byte: Ben numbers them from bit 7 up, so bit k is D(top - k). */
    ledByte(top: number, prefix = '') {
      let v = 0;
      for (let bit = 0; bit < 8; bit++) if (s.ledLit(`${prefix}D${top - bit}`)) v |= 1 << bit;
      return v;
    },
    /** Rising then falling edge on CLK. */
    clock(port = 'CLK') {
      s.pulse(port, 20, 1);
      settle();
      return this;
    },
    problems: () => s.problems({ floatingInputs: true }),
  };
}

// ---------------------------------------------------------------------------
// B register

describe('B register board', () => {
  const L = bRegister.layout;
  const nets = buildNets(L);
  it('is a valid, powered board with the contract ports and bound LEDs', () => checkBoard(bRegister, [...range('BUS'), ...range('B'), '~BI', 'CLK', 'CLR'], 8));
  const net = (u: string, p: string) => pinNet(L, nets, u, p);

  it('is wired like Ben’s B register', () => {
    for (const u of ['U11', 'U12']) {
      expect(net(u, '~M')).toBe(GND_NET);
      expect(net(u, '~N')).toBe(GND_NET);
      expect(net(u, '~G1')).toBe('port:~BI');
      expect(net(u, '~G2')).toBe('port:~BI');
      expect(net(u, 'CP')).toBe('port:CLK');
      expect(net(u, 'MR')).toBe('port:CLR');
    }
    // U10 is wired like the A register's 245 but never enabled
    expect(net('U10', 'DIR')).toBe(VCC_NET);
    expect(net('U10', '~OE')).toBe(VCC_NET);
    for (let bit = 0; bit < 8; bit++) {
      const u = bit < 4 ? 'U12' : 'U11'; // U12 low nibble, U11 high nibble
      expect(net(u, `D${bit % 4}`)).toBe(`port:BUS${bit}`);
      expect(net('U10', `B${bit + 1}`)).toBe(`port:BUS${bit}`);
      expect(net(u, `Q${bit % 4}`)).toBe(`port:B${bit}`);
      expect(net('U10', `A${bit + 1}`)).toBe(`port:B${bit}`);
    }
  });

  it('has 8 red LEDs on the register outputs, bound to c.b', () => {
    for (let bit = 0; bit < 8; bit++) {
      const id = `D${25 - bit}`; // D18 (B7) ... D25 (B0), as in the netlist
      const led = L.parts.find((p) => p.id === id)!;
      expect(led.kind === 'led' && led.color).toBe('red');
      expect(pinNet(L, nets, id, 'anode')).toBe(`port:B${bit}`);
      expect(pinNet(L, nets, id, 'cathode')).toBe(GND_NET);
      for (const v of [0, 0xff, 0xa5, 1 << bit]) expect(bRegister.live.leds[id](fakeComputer({ b: v }), noMachine)).toBe(((v >> bit) & 1) === 1);
    }
  });

  it('loads the bus on CLK when ~BI is low, holds otherwise, clears on CLR, never drives the bus', () => {
    const t = sim(L).set({ CLK: 0, CLR: 0, '~BI': 1 }).byte('BUS', 0xa5);
    expect(t.read('B')).toBe(0);
    t.clock();
    expect(t.read('B')).toBe(0); // ~BI high: no load
    t.set({ '~BI': 0 }).clock();
    expect(t.read('B')).toBe(0xa5);
    expect(t.ledByte(25)).toBe(0xa5);
    t.byte('BUS', 0x3c);
    expect(t.read('B')).toBe(0xa5); // edge-triggered: no change without a clock edge
    t.clock();
    expect(t.read('B')).toBe(0x3c);
    t.set({ '~BI': 1 }).byte('BUS', 0xff).clock();
    expect(t.read('B')).toBe(0x3c);
    expect(t.problems()).toEqual([]);
    // the 245 stays off: a released bus floats
    t.byte('BUS', null);
    for (let bit = 0; bit < 8; bit++) expect(t.s.portLevel(`BUS${bit}`)).toBe('Z');
    t.set({ CLR: 1 }).set({ CLR: 0 });
    expect(t.read('B')).toBe(0);
    expect(t.ledByte(25)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ALU

describe('ALU board', () => {
  const ports = [...range('A'), ...range('B'), ...range('SUM'), ...range('BUS'), 'SU', '~EO', 'CARRY'];
  const L = alu.layout;
  const nets = buildNets(L);
  it('is a valid, powered board with the contract ports and bound LEDs', () => checkBoard(alu, ports, 8));
  const net = (u: string, p: string) => pinNet(L, nets, u, p);
  const adder = (bit: number) => (bit < 4 ? 'U21' : 'U20'); // U21 low nibble, U20 high nibble
  const n = (bit: number) => (bit % 4) + 1; // 283 pins S1..S4 / A1..A4 / B1..B4 = bits 0..3

  it('adds A to B XOR SU in two 74LS283s, carry chained', () => {
    for (let bit = 0; bit < 8; bit++) expect(net(adder(bit), `A${n(bit)}`)).toBe(`port:A${bit}`);
    expect(net('U21', 'C0')).toBe('port:SU');
    expect(isInternal(net('U21', 'C4'))).toBe(true);
    expect(net('U21', 'C4')).toBe(net('U20', 'C0'));
    expect(net('U20', 'C4')).toBe('port:CARRY');
  });

  it('passes each B bit through its own XOR gate with SU', () => {
    const used = new Set<string>();
    for (let bit = 0; bit < 8; bit++) {
      const into = net(adder(bit), `B${n(bit)}`);
      expect(isInternal(into)).toBe(true);
      const found: string[] = [];
      for (const chip of ['U16', 'U18']) {
        for (let g = 1; g <= 4; g++) {
          const { ins, out } = gate(L, nets, chip, g);
          if (out === into) {
            expect(ins).toEqual([`port:B${bit}`, 'port:SU'].sort());
            found.push(`${chip}.${g}`);
          }
        }
      }
      expect(found).toHaveLength(1);
      used.add(found[0]);
    }
    expect(used.size).toBe(8); // all eight gates, one per bit
  });

  it('drives the sum to the LEDs, the SUM ports and the bus through U17', () => {
    expect(net('U17', 'DIR')).toBe(VCC_NET);
    expect(net('U17', '~OE')).toBe('port:~EO');
    for (let bit = 0; bit < 8; bit++) {
      expect(net(adder(bit), `S${n(bit)}`)).toBe(`port:SUM${bit}`);
      expect(net('U17', `A${bit + 1}`)).toBe(`port:SUM${bit}`);
      expect(net('U17', `B${bit + 1}`)).toBe(`port:BUS${bit}`);
      const id = `D${81 - bit}`; // D74 (bit 7) ... D81 (bit 0), as in the netlist
      const led = L.parts.find((p) => p.id === id)!;
      expect(led.kind === 'led' && led.color).toBe('red');
      expect(pinNet(L, nets, id, 'anode')).toBe(`port:SUM${bit}`);
      expect(pinNet(L, nets, id, 'cathode')).toBe(GND_NET);
      for (const v of [0, 0xff, 0x5a, 1 << bit]) expect(alu.live.leds[id](fakeComputer({ alu: v }), noMachine)).toBe(((v >> bit) & 1) === 1);
    }
  });

  it('computes A + B and A − B (chip level)', () => {
    const t = sim(L).set({ '~EO': 1 });
    const cases: [number, number][] = [[0, 0], [2, 6], [6, 2], [0, 8], [255, 1], [1, 255], [200, 100], [42, 42], [0x0f, 0x01], [0x80, 0x80], [5, 7]];
    for (let k = 0; k < 12; k++) cases.push([(k * 73 + 11) & 0xff, (k * 151 + 3) & 0xff]);
    for (const [a, b] of cases) {
      for (const su of [0, 1] as const) {
        t.byte('A', a).byte('B', b).set({ SU: su });
        const full = a + (su ? b ^ 0xff : b) + su;
        expect(t.read('SUM'), `${a} ${su ? '-' : '+'} ${b}`).toBe(full & 0xff);
        expect(t.ledByte(81)).toBe(full & 0xff);
        expect(t.s.portLevel('CARRY')).toBe(full > 0xff ? 1 : 0);
      }
    }
    // subtraction carry = no borrow (A >= B), as Ben explains for JC
    t.byte('A', 0).byte('B', 1).set({ SU: 1 });
    expect(t.read('SUM')).toBe(255);
    expect(t.s.portLevel('CARRY')).toBe(0);
    expect(t.problems()).toEqual([]);
  });

  it('puts the sum on the bus only while ~EO is low', () => {
    const t = sim(L).set({ '~EO': 1, SU: 0 }).byte('A', 20).byte('B', 22);
    for (let bit = 0; bit < 8; bit++) expect(t.s.portLevel(`BUS${bit}`)).toBe('Z');
    t.set({ '~EO': 0 });
    expect(t.read('BUS')).toBe(42);
    t.set({ SU: 1 });
    expect(t.read('BUS')).toBe(254); // 20 - 22
    t.set({ '~EO': 1 });
    for (let bit = 0; bit < 8; bit++) expect(t.s.portLevel(`BUS${bit}`)).toBe('Z');
  });
});

// ---------------------------------------------------------------------------
// flags

describe('Flags board', () => {
  const ports = [...range('SUM'), 'CARRY', '~FI', 'CLK', 'CLR', 'CF', 'ZF'];
  // U19 Q2/Q3 and the spare AND gate's output are unused, as on Ben's board
  const L = flags.layout;
  const nets = buildNets(L);
  it('is a valid, powered board with the contract ports and bound LEDs', () => checkBoard(flags, ports, 2, ['U19.Q2', 'U19.Q3', 'U23.4Y']));
  const net = (u: string, p: string) => pinNet(L, nets, u, p);

  it('is wired like Ben’s flags register', () => {
    expect(net('U19', 'D0')).toBe('port:CARRY');
    expect(net('U19', 'D2')).toBe(GND_NET);
    expect(net('U19', 'D3')).toBe(GND_NET);
    for (const p of ['~M', '~N']) expect(net('U19', p)).toBe(GND_NET);
    for (const p of ['~G1', '~G2']) expect(net('U19', p)).toBe('port:~FI');
    expect(net('U19', 'CP')).toBe('port:CLK');
    expect(net('U19', 'MR')).toBe('port:CLR');
    expect(net('U19', 'Q0')).toBe('port:CF');
    expect(net('U19', 'Q1')).toBe('port:ZF');
  });

  it('detects zero with U22 NOR pairs and the U23A/U23C/U23B AND tree', () => {
    const nor = [1, 2, 3, 4].map((g) => gate(L, nets, 'U22', g));
    // netlist: gate 1 = (SUM7, SUM6), gate 2 = (SUM5, SUM4), gate 3 = (SUM3, SUM2), gate 4 = (SUM1, SUM0)
    nor.forEach((g, k) => expect(g.ins).toEqual([`port:SUM${7 - 2 * k}`, `port:SUM${6 - 2 * k}`].sort()));
    const [a, b, c, d] = [1, 2, 3, 4].map((g) => gate(L, nets, 'U23', g));
    expect(a.ins).toEqual([nor[0].out, nor[1].out].sort()); // U23A
    expect(c.ins).toEqual([nor[2].out, nor[3].out].sort()); // U23C
    expect(b.ins).toEqual([a.out, c.out].sort()); // U23B
    expect(b.out).toBe(net('U19', 'D1'));
    for (const x of [...nor.map((g) => g.out), a.out, b.out, c.out]) expect(isInternal(x)).toBe(true);
    expect(d.ins).toEqual([VCC_NET, VCC_NET]); // spare gate tied off
  });

  it('shows CF and ZF on green LEDs D34/D35 through 220 Ω', () => {
    for (const [id, flag] of [['D34', 'CF'], ['D35', 'ZF']] as const) {
      const led = L.parts.find((p) => p.id === id)!;
      expect(led.kind === 'led' && led.color).toBe('green');
      expect(pinNet(L, nets, id, 'cathode')).toBe(GND_NET);
      const r = L.parts.find((p) => p.kind === 'resistor' && [pinNet(L, nets, p.id, 'a'), pinNet(L, nets, p.id, 'b')].includes(`port:${flag}`))!;
      expect(r.kind === 'resistor' && r.ohms).toBe(220);
      const other = [pinNet(L, nets, r.id, 'a'), pinNet(L, nets, r.id, 'b')].find((x) => x !== `port:${flag}`);
      expect(pinNet(L, nets, id, 'anode')).toBe(other);
    }
    const lit = (c: Computer) => [flags.live.leds.D34(c, noMachine), flags.live.leds.D35(c, noMachine)];
    expect(lit(fakeComputer({ flagC: 0, flagZ: 0 }))).toEqual([false, false]);
    expect(lit(fakeComputer({ flagC: 1, flagZ: 0 }))).toEqual([true, false]);
    expect(lit(fakeComputer({ flagC: 0, flagZ: 1 }))).toEqual([false, true]);
  });

  it('latches carry and zero on CLK while ~FI is low (chip level)', () => {
    const t = sim(L).set({ CLK: 0, CLR: 0, '~FI': 1, CARRY: 1 }).byte('SUM', 0);
    const flagsNow = () => [t.s.portLevel('CF'), t.s.portLevel('ZF'), t.s.ledLit('D34'), t.s.ledLit('D35')];
    expect(flagsNow()).toEqual([0, 0, false, false]);
    t.clock();
    expect(flagsNow()).toEqual([0, 0, false, false]); // ~FI high: no load
    t.set({ '~FI': 0 }).clock();
    expect(flagsNow()).toEqual([1, 1, true, true]);
    for (let bit = 0; bit < 8; bit++) {
      t.byte('SUM', 1 << bit).set({ CARRY: 0 }).clock();
      expect(flagsNow()).toEqual([0, 0, false, false]);
      t.byte('SUM', 0).clock();
      expect(flagsNow()).toEqual([0, 1, false, true]);
    }
    t.set({ '~FI': 1, CARRY: 1 }).byte('SUM', 0x80).clock();
    expect(flagsNow()).toEqual([0, 1, false, true]); // held
    t.set({ CLR: 1 }).set({ CLR: 0 });
    expect(flagsNow()).toEqual([0, 0, false, false]);
    expect(t.problems()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the boards together: ports join by name across modules

describe('A register + ALU + B register + flags, joined by port name', () => {
  const scene = composeComputer([aRegister, alu, bRegister, flags]);

  it('is valid and every inter-module port has both ends', () => {
    expect(validateLayout(scene.layout)).toEqual([]);
    const nets = buildNets(scene.layout);
    expect(unpoweredChips(scene.layout, nets)).toEqual([]);
    expect(nets.shorted).toBe(false);
    const count = new Map<string, Set<string>>();
    for (const p of scene.layout.parts) if (p.kind === 'port') count.set(p.name, (count.get(p.name) ?? new Set()).add(p.id.split('/')[0]));
    for (const name of [...range('A'), ...range('B'), ...range('SUM'), 'CARRY']) expect(count.get(name)?.size, name).toBe(2);
  });

  it('runs ADD and SUB like the microcode does (chip level)', () => {
    const t = sim(scene.layout).set({ CLK: 0, CLR: 0, '~AI': 1, '~AO': 1, '~BI': 1, '~EO': 1, SU: 0, '~FI': 1 });
    const A = () => t.ledByte(17, 'a-register/');
    const B = () => t.ledByte(25, 'b-register/');
    const SUM = () => t.ledByte(81, 'alu/');
    const CZ = () => [t.s.ledLit('flags/D34'), t.s.ledLit('flags/D35')];
    // bus -> A, bus -> B
    t.byte('BUS', 200).set({ '~AI': 0 }).clock().set({ '~AI': 1 });
    t.byte('BUS', 100).set({ '~BI': 0 }).clock().set({ '~BI': 1 });
    expect([A(), B(), SUM()]).toEqual([200, 100, 44]);
    // ADD's T4: EO | AI | FI, the ALU drives the bus
    t.byte('BUS', null).set({ '~EO': 0, '~AI': 0, '~FI': 0 }).clock().set({ '~EO': 1, '~AI': 1, '~FI': 1 });
    expect(A()).toBe(44); // 300 mod 256
    expect(CZ()).toEqual([true, false]);
    // SUB: A = 44 - 44
    t.byte('BUS', 44).set({ '~BI': 0 }).clock().set({ '~BI': 1 }).byte('BUS', null);
    t.set({ SU: 1, '~EO': 0, '~AI': 0, '~FI': 0 }).clock().set({ '~EO': 1, '~AI': 1, '~FI': 1, SU: 0 });
    expect(A()).toBe(0);
    expect(CZ()).toEqual([true, true]); // no borrow, zero
    expect(t.problems()).toEqual([]);
  });
});

// the catalog chips used here all have models
it('datapath boards only use catalog chips', () => {
  for (const def of [alu, bRegister, flags]) for (const p of def.layout.parts) if (p.kind === 'chip') expect(CHIPS[p.chip]).toBeDefined();
});

// ---------------------------------------------------------------------------
// the LEDs a board shows at chip level are the ones its live bindings light

describe('chip-level LEDs agree with the live bindings', () => {
  it('A register, B register, ALU and flags, for sums and differences', () => {
    const scene = composeComputer([aRegister, alu, bRegister, flags]);
    const ids = Object.keys(scene.live.leds).sort();
    expect(ids).toEqual(scene.layout.parts.filter((p) => p.kind === 'led').map((p) => p.id).sort());
    expect(ids).toHaveLength(26);
    const t = sim(scene.layout).set({ CLK: 0, CLR: 0, '~AI': 1, '~AO': 1, '~BI': 1, '~EO': 1, SU: 0, '~FI': 1 });
    const m = new Machine();
    const c = m.computer;
    const cases: [number, number, 0 | 1][] = [[28, 14, 0], [0, 0, 0], [255, 1, 0], [5, 7, 1], [7, 7, 1], [0x80, 0x7f, 0], [0xa5, 0x5a, 1]];
    for (let k = 0; k < 10; k++) cases.push([(k * 97 + 13) & 0xff, (k * 59 + 200) & 0xff, (k & 1) as 0 | 1]);
    for (const [a, b, su] of cases) {
      t.byte('BUS', a).set({ '~AI': 0 }).clock().set({ '~AI': 1 });
      t.byte('BUS', b).set({ '~BI': 0 }).clock().set({ '~BI': 1 }).byte('BUS', null);
      t.set({ SU: su, '~FI': 0 }).clock().set({ '~FI': 1 }); // the flags of A ± B
      c.a = a;
      c.b = b;
      c.setManualControl(su ? SIGNAL_BITS.SU : 0);
      c.flagC = c.alu.carry;
      c.flagZ = c.alu.zero;
      const want = ids.filter((id) => scene.live.leds[id](c, m));
      const got = ids.filter((id) => t.s.ledLit(id));
      expect(got, `${a} ${su ? '-' : '+'} ${b}`).toEqual(want);
    }
    expect(t.problems()).toEqual([]);
  });
});

describe('layout tidiness: no wire under a chip or over another leg, no hidden ends', () => {
  for (const def of [aRegister, bRegister, alu, flags, output, control]) {
    it(def.id, () => expect(untidy(def)).toEqual([]));
  }
  it('the checker catches the problems it looks for', () => {
    const bad: ModuleBoardDef = {
      id: 'bad', title: 'bad', description: '', videos: [], live: { leds: {}, seg7: {}, controls: {} },
      layout: {
        boards: [{ id: 'x', place: { x: 0, y: 0 } }],
        parts: [
          { id: 'U1', board: 'x', kind: 'chip', chip: '74LS00', col: 10 },
          { id: 'w1', board: 'x', kind: 'wire', color: 'blue', a: 'd8', b: 'g20' }, // diagonally under U1
          { id: 'w2', board: 'x', kind: 'wire', color: 'blue', a: 'b30', b: 'b34' }, // along row b, over the end of w3
          { id: 'w3', board: 'x', kind: 'wire', color: 'blue', a: 'b32', b: 'b40', via: [[32.5, 5.0], [39.5, 5.0]] },
          { id: 'w4', board: 'x', kind: 'wire', color: 'blue', a: 'd33', b: 'd41', via: [[33.5, 5.0], [40.5, 5.0]] }, // same lane as w3
          { id: 'p1', board: 'x', kind: 'port', name: 'CLK', hole: 'c50', side: 'top' }, // across the board, over a50
          { id: 'R1', board: 'x', kind: 'resistor', ohms: 220, a: 'a50', b: 'tn51' },
        ],
      },
    };
    const found = untidy(bad);
    for (const what of ['w1 (d8-g20) runs under U1', 'w2 (b30-b34) runs over w3 at b32', 'w3 and w4 overlap at y = 5', 'tag CLK at c50 points top across the board', 'tag CLK at c50 hides R1 at a50']) {
      expect(found.some((f) => f.startsWith(what)), `${what} in ${found.join('; ')}`).toBe(true);
    }
  });
});
