import { describe, expect, it } from 'vitest';
import control from '../src/breadboard/boards/control.board';
import { MODULE_BOARDS } from '../src/breadboard/boards/index';
import output from '../src/breadboard/boards/output.board';
import { ROW, composeComputer } from '../src/breadboard/computer-layout';
import { BOARD_H, BOARD_W, holeXY } from '../src/breadboard/geometry';
import { partPins, validateLayout, type Layout, type ModuleBoardDef, type Part } from '../src/breadboard/layout';
import { GND_NET, VCC_NET, buildNets, pinNet, unpoweredChips, type Netlist } from '../src/breadboard/nets';
import { BreadboardSim } from '../src/breadboard/sim/engine';
import type { Level } from '../src/logic/circuit';
import { BLANK, DEC_DIGITS, MINUS, displaySegments } from '../src/sim/display';
import { Machine } from '../src/sim/machine';
import { buildMicrocode, microIndex } from '../src/sim/microcode';
import { SIGNALS, SIGNAL_BITS } from '../src/sim/signals';

// ---------------------------------------------------------------------------
// helpers

const range = (prefix: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => `${prefix}${from + i}`);

/** Shared port names of docs/BREADBOARD.md. Module-local tags carry a "<MODULE>." prefix. */
const CONTRACT = new Set([
  ...range('BUS', 8), 'CLK', '~CLK', 'CLR', '~CLR',
  'HLT', '~MI', 'RI', '~RO', '~IO', '~II', '~AI', '~AO', '~EO', 'SU', '~BI', 'OI', 'CE', '~CO', '~J', '~FI',
  ...range('A', 8), ...range('B', 8), ...range('SUM', 8), 'CARRY', 'CF', 'ZF', ...range('IR', 4, 4), ...range('RA', 4), 'PROG',
]);

const partsOf = <K extends Part['kind']>(L: Layout, kind: K) => L.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind);
const portNames = (L: Layout) => new Set(partsOf(L, 'port').map((p) => p.name));
const isInternal = (net: string) => net !== VCC_NET && net !== GND_NET && !net.startsWith('port:');

/** Every part leg on the net of (part, pin), as "U3.7" / "R1.a" (wires and ports left out). */
function legsOnNet(L: Layout, nets: Netlist, net: string): string[] {
  const out: string[] = [];
  for (const p of L.parts) {
    if (p.kind === 'wire' || p.kind === 'port' || p.kind === 'text') continue;
    for (const pp of partPins(p)) if (nets.netOf(p.board, pp.hole) === net) out.push(`${p.id}.${p.kind === 'chip' ? pp.name : pp.name}`);
  }
  return out.sort();
}

/** Horizontal wire runs that share a y over overlapping x on one board. */
function overlappingLanes(L: Layout): string[] {
  const segs: { board: string; id: string; y: number; x0: number; x1: number }[] = [];
  for (const p of partsOf(L, 'wire')) {
    const pts = [holeXY(p.a), ...(p.via ?? []).map(([x, y]) => ({ x, y })), holeXY(p.b)];
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      if (Math.abs(a.y - b.y) < 1e-9 && a.x !== b.x) segs.push({ board: p.board, id: p.id, y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
    }
  }
  const bad: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [s, t] = [segs[i], segs[j]];
      if (s.board === t.board && s.id !== t.id && Math.abs(s.y - t.y) < 0.2 && Math.min(s.x1, t.x1) - Math.max(s.x0, t.x0) > 0.01) bad.push(`${s.id}/${t.id}@${s.y}`);
    }
  }
  return bad;
}

/** What every module board must satisfy (docs/BREADBOARD.md, "Verifying a board"). */
function checkBoard(def: ModuleBoardDef, opts: { boards: number; prefix: string; shared: string[]; local: string[]; leds: number; controls: string[] }) {
  const L = def.layout;
  const nets = buildNets(L);
  expect(validateLayout(L)).toEqual([]);
  expect(unpoweredChips(L, nets)).toEqual([]);
  expect(nets.shorted).toBe(false);
  // boards stacked at the module origin, y = 0, ROW, ...
  expect(L.boards.map((b) => [b.place.x, b.place.y, b.place.rotate ?? 0])).toEqual(L.boards.map((_, i) => [0, i * ROW, 0]));
  expect(L.boards).toHaveLength(opts.boards);
  for (const b of L.boards) expect(b.title).toBeTruthy();
  // ports: shared ones from the contract, the rest module-local
  const names = [...portNames(L)];
  for (const n of names) expect(CONTRACT.has(n) || n.startsWith(opts.prefix), `port ${n}`).toBe(true);
  expect(names.filter((n) => CONTRACT.has(n)).sort()).toEqual([...opts.shared].sort());
  expect(names.filter((n) => !CONTRACT.has(n)).sort()).toEqual([...opts.local].sort());
  // a local port joins the module's boards: it appears on more than one board, or more than once
  for (const n of opts.local) expect(partsOf(L, 'port').filter((p) => p.name === n).length, n).toBeGreaterThan(1);
  // LEDs and controls are bound to the simulator
  const leds = partsOf(L, 'led').map((p) => p.id).sort();
  expect(leds).toHaveLength(opts.leds);
  expect(Object.keys(def.live.leds).sort()).toEqual(leds);
  const controls = L.parts.filter((p) => ['button', 'slide', 'dip', 'pot'].includes(p.kind)).map((p) => p.id).sort();
  expect(controls).toEqual([...opts.controls].sort());
  expect(Object.keys(def.live.controls).sort()).toEqual(controls);
  // tidy: no two runs on one lane, bends inside the board
  expect(overlappingLanes(L)).toEqual([]);
  for (const p of partsOf(L, 'wire')) {
    for (const [x, y] of p.via ?? []) {
      expect(x > 0 && x < BOARD_W && y > 0 && y < BOARD_H, `${p.id} bends at ${x},${y}`).toBe(true);
    }
  }
  return nets;
}

const SEG_CHAR = (byte: number) => (byte === BLANK ? ' ' : byte === MINUS ? '-' : DEC_DIGITS.indexOf(byte as (typeof DEC_DIGITS)[number]) >= 0 ? String(DEC_DIGITS.indexOf(byte as (typeof DEC_DIGITS)[number])) : '?');
const text = (bytes: readonly number[]) => bytes.map(SEG_CHAR).join('');

// ===========================================================================
// Output register and display

describe('output board', () => {
  const L = output.layout;
  const nets = checkBoard(output, {
    boards: 2,
    prefix: 'OUT.',
    shared: [...range('BUS', 8), 'OI', 'CLK', '~CLR'],
    local: [...range('OUT.A', 10), ...range('OUT.~Y', 4)],
    leds: 0,
    controls: ['SW7'],
  });
  const net = (u: string, p: string | number) => pinNet(L, nets, u, p);
  const DIGITS = ['U40', 'U41', 'U42', 'U43']; // sign, hundreds, tens, ones

  it('has Ben’s parts', () => {
    const chips = Object.fromEntries(partsOf(L, 'chip').map((p) => [p.id, p.chip]));
    expect(chips).toEqual({ U37: '74LS76', U38: '74LS139', U39: 'NE555', U44: '74LS273', U45: '28C16', U46: '74LS08' });
    const params = (id: string) => partsOf(L, 'chip').find((p) => p.id === id)!.params;
    expect(params('U45')).toEqual({ image: 'display' });
    expect(params('U39')).toEqual({ mode: 'astable', halfPeriod: 400 });
    expect(partsOf(L, 'seg7').map((p) => [p.id, p.common])).toEqual(DIGITS.map((d) => [d, 'cathode']));
    // left to right: sign, hundreds, tens, ones
    const xs = DIGITS.map((d) => partsOf(L, 'seg7').find((p) => p.id === d)!.col);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(Object.fromEntries(partsOf(L, 'resistor').map((p) => [p.id, p.ohms]))).toEqual({ R65: 1000, R66: 100_000, R104: 10_000 });
    expect(Object.fromEntries(partsOf(L, 'capacitor').map((p) => [p.id, p.farads]))).toEqual({ C8: 1e-8, C9: 1e-8 });
  });

  it('output register: D = bus, CP = OI AND CLK, ~MR = ~CLR, Q -> EEPROM A0-A7', () => {
    for (let k = 0; k < 8; k++) {
      expect(net('U44', `D${k}`)).toBe(`port:BUS${k}`);
      expect(net('U44', `Q${k}`)).toBe(`port:OUT.A${k}`);
      expect(net('U45', `A${k}`)).toBe(`port:OUT.A${k}`);
    }
    expect(net('U44', '~MR')).toBe('port:~CLR');
    expect(net('U46', '1A')).toBe('port:OI');
    expect(net('U46', '1B')).toBe('port:CLK');
    expect(net('U44', 'CP')).toBe(net('U46', '1Y'));
    expect(isInternal(net('U46', '1Y'))).toBe(true);
    expect(legsOnNet(L, nets, net('U46', '1Y'))).toEqual(['U44.CP', 'U46.1Y']);
    for (const p of ['2A', '2B', '3A', '3B', '4A', '4B']) expect(net('U46', p), p).toBe(GND_NET);
  });

  it('display EEPROM: A8/A9 digit select, A10 = SW7 with R104 pull-down, always reading', () => {
    expect(net('U45', '~CE')).toBe(GND_NET);
    expect(net('U45', '~OE')).toBe(GND_NET);
    expect(net('U45', '~WE')).toBe(VCC_NET);
    expect(net('U45', 'A8')).toBe('port:OUT.A8');
    expect(net('U45', 'A9')).toBe('port:OUT.A9');
    const a10 = net('U45', 'A10');
    expect(isInternal(a10)).toBe(true);
    expect(net('SW7', 'common')).toBe(a10);
    expect([net('R104', 'a'), net('R104', 'b')].sort()).toEqual([GND_NET, a10].sort());
    expect(net('SW7', 'b')).toBe(VCC_NET);
    const signed = buildNets(L, { slides: new Map([['SW7', 1]]) });
    expect(pinNet(L, signed, 'U45', 'A10')).toBe(VCC_NET);
    expect(legsOnNet(L, signed, pinNet(L, signed, 'SW7', 'a'))).toEqual(['SW7.a']); // the other throw is open
    expect(pinNet(L, buildNets(L, { slides: new Map([['SW7', 0]]) }), 'U45', 'A10')).toBe(a10);
  });

  it('IO0-IO7 drive g f e d c b a dp of all four digits in parallel', () => {
    const SEGS = ['g', 'f', 'e', 'd', 'c', 'b', 'a', 'dp'];
    SEGS.forEach((seg, k) => {
      const n = net('U45', `IO${k}`);
      expect(isInternal(n)).toBe(true);
      expect(legsOnNet(L, nets, n)).toEqual([`U45.IO${k}`, ...DIGITS.map((d) => `${d}.${seg}`)].sort());
    });
  });

  it('multiplexer: 555 astable -> 74LS76 counter -> 74LS139 -> digit commons', () => {
    // 555: R65 VCC-DIS, R66 DIS-THR, THR = TRIG, C8 timing, C9 on CV, RESET high
    const dis = net('U39', 'DIS'), thr = net('U39', 'THR');
    expect([net('R65', 'a'), net('R65', 'b')].sort()).toEqual([VCC_NET, dis].sort());
    expect([net('R66', 'a'), net('R66', 'b')].sort()).toEqual([dis, thr].sort());
    expect(net('U39', 'TRIG')).toBe(thr);
    expect([net('C8', 'a'), net('C8', 'b')].sort()).toEqual([GND_NET, thr].sort());
    expect([net('C9', 'a'), net('C9', 'b')].sort()).toEqual([GND_NET, net('U39', 'CV')].sort());
    expect(net('U39', '~RESET')).toBe(VCC_NET);
    // 74LS76: both flip-flops toggle; FF1 on the 555, FF2 on FF1's ~Q
    for (const p of ['1J', '1K', '~1PRE', '~1CLR', '2J', '2K', '~2PRE', '~2CLR']) expect(net('U37', p), p).toBe(VCC_NET);
    expect(net('U37', '~1CLK')).toBe(net('U39', 'OUT'));
    const q1 = net('U37', '~1Q'), q2 = net('U37', '~2Q');
    expect(q1).toBe('port:OUT.A8');
    expect(q2).toBe('port:OUT.A9');
    expect(net('U37', '~2CLK')).toBe(q1);
    expect(net('U38', '1A0')).toBe(q1);
    expect(net('U38', '1A1')).toBe(q2);
    expect(legsOnNet(L, nets, q1)).toEqual(['U37.~1Q', 'U37.~2CLK', 'U38.1A0', 'U45.A8']);
    expect(legsOnNet(L, nets, q2)).toEqual(['U37.~2Q', 'U38.1A1', 'U45.A9']);
    // 74LS139 half 1 enabled, outputs sink the commons: Y0 = ones (right) ... Y3 = sign (left)
    expect(net('U38', '~1E')).toBe(GND_NET);
    [3, 2, 1, 0].forEach((y, i) => {
      expect(net('U38', `~1Y${y}`)).toBe(`port:OUT.~Y${y}`);
      const coms = partPins(partsOf(L, 'seg7').find((p) => p.id === DIGITS[i])!).filter((pp) => pp.name === 'com');
      expect(coms.some((pp) => nets.netOf('output2', pp.hole) === `port:OUT.~Y${y}`), DIGITS[i]).toBe(true);
    });
    // half 2 disabled
    expect(net('U38', '~2E')).toBe(VCC_NET);
    expect(net('U38', '2A0')).toBe(GND_NET);
    expect(net('U38', '2A1')).toBe(GND_NET);
  });

  it('live bindings: the digits show displaySegments, SW7 is the signed-mode switch', () => {
    const m = new Machine();
    const c = m.computer;
    const sw7 = output.live.controls.SW7 as Extract<(typeof output.live.controls)[string], { kind: 'slide' }>;
    const digits = () => DIGITS.map((d) => output.live.seg7[d](c, m));
    c.out = 42;
    expect(text(digits())).toBe(' 042');
    expect(sw7.get(m)).toBe(0);
    c.out = 0xf3;
    expect(text(digits())).toBe(' 243');
    sw7.set(m, 1);
    expect(c.signedDisplay).toBe(true);
    expect(sw7.get(m)).toBe(1);
    expect(text(digits())).toBe('-013');
    expect(digits()).toEqual(displaySegments(0xf3, true));
    sw7.set(m, 0);
    expect(c.signedDisplay).toBe(false);
  });

  // ---- chip level ----------------------------------------------------------

  /**
   * Run the multiplexer for `cycles` full rounds and return what each digit
   * showed while its common was low, sampled well after every change of the
   * digit select. Also checks that exactly one common is low at a time.
   */
  function watch(sim: BreadboardSim, cycles = 2): string[][] {
    const seen: Set<number>[] = DIGITS.map(() => new Set<number>());
    const sel = () => `${sim.pinLevel('U45', 'A8')}${sim.pinLevel('U45', 'A9')}`;
    let last = sel();
    let sampleAt = -1;
    let changes = 0;
    for (let t = 0; t < 3200 * cycles + 1200; t++) {
      sim.step(1);
      const s = sel();
      if (s !== last) {
        last = s;
        changes++;
        sampleAt = t + 60;
      }
      if (t === sampleAt) {
        const coms = [3, 2, 1, 0].map((y) => sim.portLevel(`OUT.~Y${y}`));
        expect(coms.filter((l) => l === 0), `commons ${coms.join('')}`).toHaveLength(1);
        DIGITS.forEach((d, i) => {
          const segs = sim.seg7(d);
          if (coms[i] === 0) seen[i].add(segs);
          else expect(segs).toBe(0);
        });
      }
    }
    expect(changes).toBeGreaterThanOrEqual(4 * cycles);
    return seen.map((s) => [...s].map(SEG_CHAR));
  }

  function bench() {
    const sim = new BreadboardSim(L);
    sim.setPort('CLK', 0);
    sim.setPort('OI', 0);
    sim.setPort('~CLR', 1);
    for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, 0);
    sim.step(50);
    const latch = (v: number) => {
      for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, ((v >> k) & 1) as Level);
      sim.setPort('OI', 1);
      sim.pulse('CLK', 20);
      sim.setPort('OI', 0);
      for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, null);
      sim.step(20);
    };
    const register = () => [...Array(8)].reduce((v: number, _, k) => v | ((sim.pinLevel('U44', `Q${k}`) === 1 ? 1 : 0) << k), 0);
    return { sim, latch, register };
  }

  it('latches the bus on OI + CLK and multiplexes " 042" across the four digits', () => {
    const { sim, latch, register } = bench();
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
    expect(watch(sim)).toEqual([[' '], ['0'], ['0'], ['0']]); // power-up: 000
    latch(42);
    expect(register()).toBe(42);
    expect(watch(sim)).toEqual([[' '], ['0'], ['4'], ['2']]);
    // without OI the clock does nothing
    for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, 1);
    sim.pulse('CLK', 20);
    expect(register()).toBe(42);
    for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, null);
    // ~CLR clears the register
    sim.setPort('~CLR', 0);
    sim.step(20);
    expect(register()).toBe(0);
    sim.setPort('~CLR', 1);
    expect(watch(sim, 1)).toEqual([[' '], ['0'], ['0'], ['0']]);
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });

  it('shows two’s complement with SW7: 0xF3 -> "-013" (and " 243" unsigned)', () => {
    const { sim, latch } = bench();
    latch(0xf3);
    expect(watch(sim, 1)).toEqual([[' '], ['2'], ['4'], ['3']]);
    sim.setSlide('SW7', 1);
    expect(sim.pinLevel('U45', 'A10')).toBe(1);
    expect(watch(sim)).toEqual([['-'], ['0'], ['1'], ['3']]);
    latch(0x80); // -128
    expect(watch(sim, 1)).toEqual([['-'], ['1'], ['2'], ['8']]);
    sim.setSlide('SW7', 0);
    expect(sim.pinLevel('U45', 'A10')).toBe(0);
    expect(watch(sim, 1)).toEqual([[' '], ['1'], ['2'], ['8']]);
  });

  it('agrees with displaySegments for a sweep of values', () => {
    const { sim, latch } = bench();
    for (const [v, signed] of [[7, false], [255, false], [0x9c, true], [127, true]] as const) {
      sim.setSlide('SW7', signed ? 1 : 0);
      latch(v);
      const want = displaySegments(v, signed).map((s) => [SEG_CHAR(s)]);
      expect(watch(sim, 1), `${v} ${signed}`).toEqual(want);
    }
  });
});

// ===========================================================================
// Control logic

describe('control board', () => {
  const L = control.layout;
  const DIRECT = ['HLT', 'RI', 'SU', 'OI', 'CE'];
  const INVERTED = ['MI', 'RO', 'IO', 'II', 'AI', 'AO', 'EO', 'BI', 'CO', 'J', 'FI'];
  const nets = checkBoard(control, {
    boards: 2,
    prefix: 'CTL.',
    shared: ['~CLK', ...range('IR', 4, 4), 'CF', 'ZF', 'CLR', '~CLR', ...DIRECT, ...INVERTED.map((s) => `~${s}`)],
    local: [...range('CTL.S', 3), ...INVERTED.map((s) => `CTL.${s}`)],
    leds: 24,
    controls: ['SW8'],
  });
  const net = (u: string, p: string | number) => pinNet(L, nets, u, p);
  /** Net of the far leg of a two-leg part whose other leg is on `n`. */
  const across = (id: string, n: string) => {
    const [a, b] = [net(id, 'a'), net(id, 'b')];
    expect([a, b], id).toContain(n);
    return a === n ? b : a;
  };
  /** The port a module listens on for a control signal (active low after the 74LS04s). */
  const portOf = (sig: string) => (DIRECT.includes(sig) ? sig : `~${sig}`);
  /** LED of control-word bit k (15 = HLT ... 0 = FI). */
  const LED = (bit: number) => `D${73 - bit}`;

  it('has Ben’s chips', () => {
    const chips = Object.fromEntries(partsOf(L, 'chip').map((p) => [p.id, p.chip]));
    expect(chips).toEqual({ U47: '28C16', U48: '74LS161', U49: '74LS04', U50: '74LS138', U51: '74LS00', U52: '28C16', U53: '74LS04' });
    for (const u of ['U47', 'U52']) expect(partsOf(L, 'chip').find((p) => p.id === u)!.params).toEqual({ image: 'microcode' });
    expect(partsOf(L, 'resistor').find((p) => p.id === 'R75')!.ohms).toBe(1000);
    for (const p of partsOf(L, 'resistor')) if (p.id !== 'R75') expect(p.ohms, p.id).toBe(220);
    expect(partsOf(L, 'resistor')).toHaveLength(25);
  });

  it('step counter: CP = ~CLK, always counting, reset by ~Y5 AND ~CLR', () => {
    expect(net('U48', 'CP')).toBe('port:~CLK');
    for (const p of ['~PE', 'CEP', 'CET']) expect(net('U48', p), p).toBe(VCC_NET);
    for (const p of ['P0', 'P1', 'P2', 'P3']) expect(net('U48', p), p).toBe(GND_NET);
    // ~MR = U51A(U51B): U51A is a NAND with tied inputs, U51B = NAND(~Y5, ~CLR)
    expect(net('U48', '~MR')).toBe(net('U51', '1Y'));
    expect(net('U51', '1A')).toBe(net('U51', '2Y'));
    expect(net('U51', '1B')).toBe(net('U51', '2Y'));
    expect([net('U51', '2A'), net('U51', '2B')].sort()).toEqual([net('U50', '~Y5'), 'port:~CLR'].sort());
    for (const n of [net('U51', '1Y'), net('U51', '2Y'), net('U50', '~Y5')]) expect(isInternal(n)).toBe(true);
    expect(legsOnNet(L, nets, net('U48', '~MR'))).toEqual(['U48.~MR', 'U51.1Y']);
    // Q0-Q2 -> 138 A0-A2, both EEPROMs' A0-A2 and the red LEDs; Q3 and TC unused
    for (let k = 0; k < 3; k++) {
      const q = net('U48', `Q${k}`);
      expect(q).toBe(`port:CTL.S${k}`);
      for (const u of ['U47', 'U52']) expect(net(u, `A${k}`)).toBe(q);
      expect(net('U50', `A${k}`)).toBe(q);
      expect(net(`D${50 + k}`, 'anode')).toBe(q);
      expect(across(`RD${50 + k}`, net(`D${50 + k}`, 'cathode'))).toBe(GND_NET);
      expect(partsOf(L, 'led').find((p) => p.id === `D${50 + k}`)!.color).toBe('red');
    }
    expect(legsOnNet(L, nets, net('U48', 'Q3'))).toEqual(['U48.Q3']);
    expect(legsOnNet(L, nets, net('U48', 'TC'))).toEqual(['U48.TC']);
    // 138: enabled; ~Y0-~Y4 sink the green T LEDs, whose anodes go through 220R to VCC
    expect(net('U50', '~E1')).toBe(GND_NET);
    expect(net('U50', '~E2')).toBe(GND_NET);
    expect(net('U50', 'E3')).toBe(VCC_NET);
    for (let k = 0; k < 5; k++) {
      const d = `D${53 + k}`;
      expect(net(d, 'cathode')).toBe(net('U50', `~Y${k}`));
      expect(across(`R${d}`, net(d, 'anode'))).toBe(VCC_NET);
      expect(partsOf(L, 'led').find((p) => p.id === d)!.color).toBe('green');
    }
  });

  it('microcode EEPROMs: step, opcode, byte select and flags on the address, always reading', () => {
    for (const u of ['U47', 'U52']) {
      for (let k = 0; k < 4; k++) expect(net(u, `A${3 + k}`)).toBe(`port:IR${4 + k}`);
      expect(net(u, 'A8')).toBe('port:CF');
      expect(net(u, 'A9')).toBe('port:ZF');
      expect(net(u, 'A10')).toBe(GND_NET);
      expect(net(u, '~CE')).toBe(GND_NET);
      expect(net(u, '~OE')).toBe(GND_NET);
      expect(net(u, '~WE')).toBe(VCC_NET);
    }
    expect(net('U47', 'A7')).toBe(GND_NET); // high byte
    expect(net('U52', 'A7')).toBe(VCC_NET); // low byte
  });

  it('outputs: 16 blue LEDs on the active-high lines, 74LS04s for the active-low ones', () => {
    const GATES: Record<string, [string, number]> = {
      MI: ['U49', 1], RO: ['U49', 2], IO: ['U49', 3], AO: ['U49', 4], AI: ['U49', 5], II: ['U49', 6],
      EO: ['U53', 1], BI: ['U53', 2], FI: ['U53', 3], J: ['U53', 5], CO: ['U53', 6],
    };
    SIGNALS.forEach((sig, i) => {
      const bit = 15 - i;
      const [u, io] = bit >= 8 ? ['U47', bit - 8] : ['U52', bit];
      const n = net(u, `IO${io}`);
      expect(n).toBe(DIRECT.includes(sig) ? `port:${sig}` : `port:CTL.${sig}`);
      expect(partsOf(L, 'led').find((p) => p.id === LED(bit))!.color).toBe('blue');
      expect(net(LED(bit), 'anode')).toBe(n);
      expect(across(`R${LED(bit)}`, net(LED(bit), 'cathode'))).toBe(GND_NET);
      if (!DIRECT.includes(sig)) {
        const [inv, g] = GATES[sig];
        expect(net(inv, `${g}A`), sig).toBe(n);
        expect(net(inv, `${g}Y`), sig).toBe(`port:~${sig}`);
      }
    });
    // the LEDs read HLT ... AO and EO ... FI from left to right
    const xOf = (id: string) => holeXY(partsOf(L, 'led').find((p) => p.id === id)!.anode).x;
    for (let bit = 15; bit > 8; bit--) expect(xOf(LED(bit))).toBeLessThan(xOf(LED(bit - 1)));
    for (let bit = 7; bit > 0; bit--) expect(xOf(LED(bit))).toBeLessThan(xOf(LED(bit - 1)));
    expect(net('U53', '4A')).toBe(GND_NET); // spare gate
  });

  it('reset: SW8 to VCC with R75 pull-down; U51C makes ~CLR, U51D makes CLR', () => {
    const node = net('U51', '3A');
    expect(isInternal(node)).toBe(true);
    expect(net('U51', '3B')).toBe(node);
    expect(across('R75', node)).toBe(GND_NET);
    expect([net('SW8', 'a'), net('SW8', 'b')].sort()).toEqual([VCC_NET, node].sort());
    expect(pinNet(L, buildNets(L, { buttons: new Set(['SW8']) }), 'U51', '3A')).toBe(VCC_NET);
    expect(net('U51', '3Y')).toBe('port:~CLR');
    expect(net('U51', '4A')).toBe('port:~CLR');
    expect(net('U51', '4B')).toBe('port:~CLR');
    expect(net('U51', '4Y')).toBe('port:CLR');
  });

  it('live bindings: control word, T0-T4, step bits and the reset button', () => {
    const m = new Machine();
    const c = m.computer;
    const lit = (id: string) => control.live.leds[id](c, m);
    for (const word of [0x4004, 0x1408, 0x0281, 0x8000, 0xffff, 0]) {
      c.setManualControl(word);
      for (let bit = 0; bit < 16; bit++) expect(lit(LED(bit)), `${word.toString(16)} bit ${bit}`).toBe(((word >> bit) & 1) === 1);
    }
    c.setManualControl(null);
    for (let s = 0; s < 5; s++) {
      c.step = s;
      for (let k = 0; k < 5; k++) expect(lit(`D${53 + k}`)).toBe(k === s);
      for (let k = 0; k < 3; k++) expect(lit(`D${50 + k}`)).toBe(((s >> k) & 1) === 1);
    }
    c.pc = 7;
    c.a = 42;
    c.step = 3;
    const sw8 = control.live.controls.SW8 as Extract<(typeof control.live.controls)[string], { kind: 'button' }>;
    sw8.press(m);
    expect([c.pc, c.a, c.step]).toEqual([0, 0, 0]);
  });

  // ---- chip level ----------------------------------------------------------

  function bench() {
    const sim = new BreadboardSim(L);
    sim.setPort('~CLK', 0);
    for (let k = 4; k < 8; k++) sim.setPort(`IR${k}`, 0);
    sim.setPort('CF', 0);
    sim.setPort('ZF', 0);
    expect(sim.settle().stable).toBe(true);
    /** The step, read from the T LEDs; the step LEDs and the EEPROM step lines must agree. */
    const step = () => {
      const t = [0, 1, 2, 3, 4].filter((k) => sim.ledLit(`D${53 + k}`));
      const bits = [0, 1, 2].reduce((v, k) => v | ((sim.ledLit(`D${50 + k}`) ? 1 : 0) << k), 0);
      const lines = [0, 1, 2].reduce((v, k) => v | ((sim.portLevel(`CTL.S${k}`) === 1 ? 1 : 0) << k), 0);
      expect(t, 'exactly one T LED').toHaveLength(1);
      expect(bits).toBe(t[0]);
      expect(lines).toBe(t[0]);
      return t[0];
    };
    /** A falling CLK edge, i.e. a rising ~CLK edge. */
    const tick = () => {
      sim.setPort('~CLK', 1);
      expect(sim.settle().stable).toBe(true);
      sim.setPort('~CLK', 0);
      expect(sim.settle().stable).toBe(true);
    };
    return { sim, step, tick };
  }

  it('steps T0 .. T4 on ~CLK edges and wraps at T5', () => {
    const { sim, step, tick } = bench();
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
    expect(step()).toBe(0);
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      tick();
      seen.push(step());
    }
    expect(seen).toEqual([1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2]);
    // the other edge (CLK rising) does not count
    sim.setPort('~CLK', 1);
    sim.settle();
    expect(step()).toBe(3);
    sim.setPort('~CLK', 0);
    sim.settle();
    expect(step()).toBe(3);
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });

  it('every control line follows buildMicrocode() for all flags, opcodes and steps T0-T4', () => {
    const { sim, step, tick } = bench();
    const mc = buildMicrocode();
    let checked = 0;
    for (let s = 0; s < 5; s++) {
      expect(step()).toBe(s);
      for (let flags = 0; flags < 4; flags++) {
        sim.setPort('CF', (flags & 1) as Level);
        sim.setPort('ZF', ((flags >> 1) & 1) as Level);
        for (let op = 0; op < 16; op++) {
          for (let k = 0; k < 4; k++) sim.setPort(`IR${4 + k}`, ((op >> k) & 1) as Level);
          expect(sim.settle().stable).toBe(true);
          const word = mc[microIndex(flags, op, s)];
          for (const sig of SIGNALS) {
            const on = (word & SIGNAL_BITS[sig]) !== 0;
            const want = DIRECT.includes(sig) ? (on ? 1 : 0) : on ? 0 : 1;
            expect(sim.portLevel(portOf(sig)), `flags ${flags} op ${op} T${s} ${portOf(sig)}`).toBe(want);
            expect(sim.ledLit(LED(15 - SIGNALS.indexOf(sig))), `LED ${sig}`).toBe(on);
          }
          checked++;
        }
      }
      tick();
    }
    expect(checked).toBe(5 * 4 * 16);
  });

  it('chip-level LEDs agree with the live bindings for every step, opcode and flag', () => {
    const { sim, step, tick } = bench();
    const m = new Machine();
    const c = m.computer;
    const ids = Object.keys(control.live.leds).sort();
    expect(ids).toHaveLength(24);
    for (let s = 0; s < 5; s++) {
      expect(step()).toBe(s);
      for (let flags = 0; flags < 4; flags++) {
        sim.setPort('CF', (flags & 1) as Level);
        sim.setPort('ZF', ((flags >> 1) & 1) as Level);
        for (let op = 0; op < 16; op++) {
          for (let k = 0; k < 4; k++) sim.setPort(`IR${4 + k}`, ((op >> k) & 1) as Level);
          expect(sim.settle().stable).toBe(true);
          c.ir = (op << 4) | 0x5;
          c.step = s;
          c.flagC = (flags & 1) as 0 | 1;
          c.flagZ = ((flags >> 1) & 1) as 0 | 1;
          const want = ids.filter((id) => control.live.leds[id](c, m));
          expect(ids.filter((id) => sim.ledLit(id)), `T${s} op ${op} flags ${flags}`).toEqual(want);
        }
      }
      tick();
    }
  });

  it('conditional jumps: JC / JZ assert IO|J at T2 only with their flag set', () => {
    const { sim, step, tick } = bench();
    tick();
    tick();
    expect(step()).toBe(2);
    const jumping = () => sim.portLevel('~IO') === 0 && sim.portLevel('~J') === 0;
    const set = (op: number, cf: Level, zf: Level) => {
      for (let k = 0; k < 4; k++) sim.setPort(`IR${4 + k}`, ((op >> k) & 1) as Level);
      sim.setPort('CF', cf);
      sim.setPort('ZF', zf);
      expect(sim.settle().stable).toBe(true);
      return jumping();
    };
    const JC = 0b0111, JZ = 0b1000, JMP = 0b0110;
    expect([set(JC, 0, 0), set(JC, 0, 1), set(JC, 1, 0), set(JC, 1, 1)]).toEqual([false, false, true, true]);
    expect([set(JZ, 0, 0), set(JZ, 1, 0), set(JZ, 0, 1), set(JZ, 1, 1)]).toEqual([false, false, true, true]);
    expect([set(JMP, 0, 0), set(JMP, 1, 1)]).toEqual([true, true]);
    tick(); // T3: nothing
    expect([set(JC, 1, 0), set(JZ, 0, 1)]).toEqual([false, false]);
  });

  it('SW8 asserts CLR / ~CLR and holds the step counter at T0', () => {
    const { sim, step, tick } = bench();
    tick();
    tick();
    tick();
    expect(step()).toBe(3);
    expect([sim.portLevel('CLR'), sim.portLevel('~CLR')]).toEqual([0, 1]);
    sim.press('SW8');
    expect(sim.settle().stable).toBe(true);
    expect([sim.portLevel('CLR'), sim.portLevel('~CLR')]).toEqual([1, 0]);
    expect(step()).toBe(0);
    tick(); // held in reset: no counting
    expect(step()).toBe(0);
    sim.release('SW8');
    expect(sim.settle().stable).toBe(true);
    expect([sim.portLevel('CLR'), sim.portLevel('~CLR')]).toEqual([0, 1]);
    expect(step()).toBe(0);
    // after reset the control word is the fetch step MI|CO
    expect(sim.portLevel('~MI')).toBe(0);
    expect(sim.portLevel('~CO')).toBe(0);
    expect(sim.portLevel('HLT')).toBe(0);
    tick();
    expect(step()).toBe(1);
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });
});

// ===========================================================================
// Both modules in one scene

describe('output and control together', () => {
  it('keep their local nets apart and share the contract ones', () => {
    const scene = composeComputer([control, output]);
    expect(validateLayout(scene.layout)).toEqual([]);
    const nets = buildNets(scene.layout);
    expect(nets.shorted).toBe(false);
    expect(unpoweredChips(scene.layout, nets)).toEqual([]);
    // the control board's OI line is the output register's OI, its ~CLR clears the 273
    expect(pinNet(scene.layout, nets, 'output/U46', '1A')).toBe(pinNet(scene.layout, nets, 'control/U52', 'IO4'));
    expect(pinNet(scene.layout, nets, 'output/U44', '~MR')).toBe(pinNet(scene.layout, nets, 'control/U51', '3Y'));
  });

  it('an OUT instruction latches the bus into the output register (chip level)', () => {
    const scene = composeComputer([control, output]);
    const sim = new BreadboardSim(scene.layout);
    sim.setPort('~CLK', 0);
    sim.setPort('CLK', 0);
    sim.setPort('CF', 0);
    sim.setPort('ZF', 0);
    [0, 1, 1, 1].forEach((bit, k) => sim.setPort(`IR${4 + k}`, bit as Level)); // OUT = 1110
    for (let k = 0; k < 8; k++) sim.setPort(`BUS${k}`, ((99 >> k) & 1) as Level);
    sim.step(100);
    const register = () => [...Array(8)].reduce((v: number, _, k) => v | ((sim.pinLevel('output/U44', `Q${k}`) === 1 ? 1 : 0) << k), 0);
    sim.pulse('CLK', 40); // T0: OI low, nothing latched
    expect(register()).toBe(0);
    sim.pulse('~CLK', 40);
    sim.pulse('~CLK', 40); // T2: AO|OI
    expect(sim.portLevel('OI')).toBe(1);
    expect(sim.portLevel('~AO')).toBe(0);
    sim.pulse('CLK', 40);
    expect(register()).toBe(99);
  });
});

// ===========================================================================
// The whole computer: every module board, simulated chip by chip

describe('the whole computer at chip level (every module board)', () => {
  const scene = composeComputer(MODULE_BOARDS.values());
  type Program = [number, number][];
  /** Ben's programs (docs/research/computer-spec.md, "Example programs"): [address, byte]. */
  const PROGRAMS: Record<string, Program> = {
    '28 + 14': [[0, 0x1e], [1, 0x2f], [2, 0xe0], [3, 0xf0], [14, 28], [15, 14]],
    '5 + 6 - 7': [[0, 0x1f], [1, 0x2e], [2, 0x3d], [3, 0xe0], [4, 0xf0], [13, 7], [14, 6], [15, 5]],
    'multiples of 3': [[0, 0x53], [1, 0x4f], [2, 0x50], [3, 0x2f], [4, 0xe0], [5, 0x63]],
    'multiply 7 × 8': [[0, 0x1e], [1, 0x3c], [2, 0x76], [3, 0x1d], [4, 0xe0], [5, 0xf0], [6, 0x4e], [7, 0x1d], [8, 0x2f], [9, 0x4d], [10, 0x60], [12, 1], [13, 0], [14, 7], [15, 8]],
  };

  it('is all twelve modules, valid and joined', () => {
    expect([...MODULE_BOARDS.keys()].sort()).toEqual(['a-register', 'alu', 'b-register', 'bus', 'clock', 'control', 'flags', 'ir', 'mar', 'output', 'pc', 'ram']);
    expect(validateLayout(scene.layout)).toEqual([]);
    const nets = buildNets(scene.layout);
    expect(nets.shorted).toBe(false);
    expect(unpoweredChips(scene.layout, nets)).toEqual([]);
  });

  /**
   * Power up, key the program in with the DIP switches and the write button
   * in program mode (a switch that is ON reads 0), go to run mode and press
   * reset. The clock is still in manual mode, so nothing has run yet.
   */
  function boot(program: Program, halfPeriod?: number) {
    const sim = new BreadboardSim(scene.layout);
    sim.step(300);
    expect(sim.problems()).toEqual([]);
    sim.setSlide('mar/SW6', 0);
    sim.step(100);
    for (const [addr, data] of program) {
      sim.setDip('mar/SW5', ~addr & 0x0f);
      sim.setDip('ram/SW3', ~data & 0xff);
      sim.step(100);
      sim.pulse('ram/SW4', 100);
    }
    sim.setSlide('mar/SW6', 1);
    sim.step(100);
    sim.pulse('control/SW8', 100);
    if (halfPeriod) sim.setParams('clock/U1', { halfPeriod });
    return sim;
  }
  const bits = (levels: Level[]) => levels.reduce<number>((v, l, k) => v | ((l === 1 ? 1 : 0) << k), 0);
  const port = (sim: BreadboardSim, prefix: string, n: number, from = 0) => bits(Array.from({ length: n }, (_, k) => sim.portLevel(`${prefix}${from + k}`)));
  const outReg = (sim: BreadboardSim) => bits(Array.from({ length: 8 }, (_, k) => sim.pinLevel('output/U44', `Q${k}`)));
  /** What the four digits show, each sampled while the 74LS139 enables it. */
  function display(sim: BreadboardSim): string {
    const seen = ['', '', '', ''];
    const digits = ['output/U40', 'output/U41', 'output/U42', 'output/U43'];
    for (let t = 0; t < 4000; t++) {
      sim.step(1);
      if (t % 50) continue;
      digits.forEach((d, i) => {
        if (sim.portLevel(`OUT.~Y${3 - i}`) !== 0) return;
        const ch = SEG_CHAR(sim.seg7(d));
        if (!seen[i].includes(ch)) seen[i] += ch;
      });
    }
    return seen.join('|');
  }

  it('runs 28 + 14 on the clock board’s own 555: OUT = 42 at rising edge 13, HLT after 17, " 042" on the display', () => {
    const sim = boot(PROGRAMS['28 + 14']);
    expect([port(sim, 'A', 8), outReg(sim), port(sim, 'CTL.S', 3), port(sim, 'IR', 4, 4), sim.portLevel('HLT'), sim.portLevel('CLK')]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(display(sim)).toBe(' |0|0|0');
    sim.setSlide('clock/SW2', 1); // auto
    let rises = 0, outAt = -1, last = sim.portLevel('CLK');
    for (let t = 0; t < 200_000 && sim.portLevel('HLT') !== 1; t++) {
      sim.step(1);
      const clk = sim.portLevel('CLK');
      if (clk === 1 && last === 0) rises++;
      last = clk;
      if (outAt < 0 && t % 50 === 0 && outReg(sim) === 42) outAt = rises; // edges are 2000 apart
    }
    expect(sim.portLevel('HLT')).toBe(1);
    expect(outAt).toBe(13);
    expect(rises).toBe(17);
    // halted: CLK stays low, nothing moves
    for (let t = 0; t < 20_000; t++) {
      sim.step(1);
      if (sim.portLevel('CLK') !== 0) throw new Error(`CLK rose ${t} gate delays after HLT`);
    }
    expect(port(sim, 'CTL.S', 3)).toBe(2); // T2 of HLT
    expect(port(sim, 'IR', 4, 4)).toBe(0xf);
    expect([port(sim, 'A', 8), port(sim, 'B', 8), outReg(sim), sim.portLevel('CF'), sim.portLevel('ZF')]).toEqual([42, 14, 42, 0, 0]);
    expect([sim.ledLit('control/D58'), sim.ledLit('clock/D1')]).toEqual([true, false]); // HLT on, CLK off
    expect(display(sim)).toBe(' |0|4|2');
    expect(sim.problems()).toEqual([]);
  });

  it('re-runs the program after reset, as Ben shows', () => {
    const sim = boot(PROGRAMS['28 + 14'], 300);
    sim.setSlide('clock/SW2', 1);
    sim.step(17 * 600 + 2000);
    expect([sim.portLevel('HLT'), outReg(sim)]).toEqual([1, 42]);
    sim.press('control/SW8');
    sim.step(200);
    expect([sim.portLevel('HLT'), outReg(sim), port(sim, 'A', 8), port(sim, 'CTL.S', 3)]).toEqual([0, 0, 0, 0]);
    sim.release('control/SW8');
    for (let t = 0; sim.portLevel('HLT') !== 1 && t < 40_000; t += 10) sim.step(10);
    expect([sim.portLevel('HLT'), outReg(sim)]).toEqual([1, 42]);
  });

  const EXPECTED: Record<string, { edges: number; outs: number[]; halts: boolean }> = {
    '28 + 14': { edges: 40, outs: [0, 42], halts: true },
    '5 + 6 - 7': { edges: 40, outs: [0, 4], halts: true },
    'multiples of 3': { edges: 120, outs: [0, 3, 6, 9, 12, 15, 18, 21], halts: false },
    'multiply 7 × 8': { edges: 400, outs: [0, 56], halts: true },
  };
  for (const [name, want] of Object.entries(EXPECTED)) {
    it(`agrees with the behavioural simulator on every LED and digit: ${name}`, () => {
      const HALF = 300;
      const program = PROGRAMS[name];
      const sim = boot(program, HALF);
      const m = new Machine();
      const c = m.computer;
      const ram = new Array<number>(16).fill(0);
      for (const [addr, data] of program) ram[addr] = data;
      c.load(ram);
      c.reset();
      // the clock board's 555 LEDs show the Machine's clock mode, which this test does not drive
      const ids = Object.keys(scene.live.leds).filter((id) => !/^clock\/D_/.test(id)).sort();
      const digits = Object.keys(scene.live.seg7);
      expect(digits).toHaveLength(4);
      const compare = (when: string) => {
        expect(ids.filter((id) => sim.ledLit(id)), when).toEqual(ids.filter((id) => scene.live.leds[id](c, m)));
        for (const d of digits) {
          const lit = sim.seg7(d);
          if (lit) expect(lit, `${when} ${d}`).toBe(scene.live.seg7[d](c, m));
        }
      };
      compare('after reset');
      sim.setSlide('clock/SW2', 1);
      let last = sim.portLevel('CLK'), rises = 0, sampleAt = -1;
      const outs: number[] = [];
      for (let t = 0; rises < want.edges && t < (want.edges + 4) * 2 * HALF && !(c.halted && t > sampleAt + 2 * HALF); t++) {
        sim.step(1);
        const clk = sim.portLevel('CLK');
        if (clk !== last) {
          if (clk === 1) rises++;
          c.halfCycle();
          last = clk;
          sampleAt = t + HALF - 40;
        }
        if (t === sampleAt) {
          compare(`rising edge ${rises}, CLK ${clk}, T${c.step}`);
          if (outs[outs.length - 1] !== c.out) outs.push(c.out);
        }
      }
      expect(outs).toEqual(want.outs);
      expect(c.halted).toBe(want.halts);
      expect(sim.portLevel('HLT')).toBe(want.halts ? 1 : 0);
      expect(sim.problems()).toEqual([]);
    });
  }
});
