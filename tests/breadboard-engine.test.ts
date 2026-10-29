import { describe, expect, it } from 'vitest';
import aRegister from '../src/breadboard/boards/a-register.board';
import { EXAMPLES, exampleById } from '../src/breadboard/examples';
import { COUNTER_HALF_PERIOD, buildCounter } from '../src/breadboard/examples/counter';
import { buildDLatch } from '../src/breadboard/examples/d-latch';
import { DIVIDE60_HALF_PERIOD, buildDivide60 } from '../src/breadboard/examples/divide60';
import { buildHexDisplay } from '../src/breadboard/examples/hex-display';
import { buildRegister } from '../src/breadboard/examples/register';
import { SECONDS_HALF_PERIOD, buildSeconds } from '../src/breadboard/examples/seconds';
import { buildSrLatch } from '../src/breadboard/examples/sr-latch';
import { RAILS, RAIL_COLUMNS, ROWS } from '../src/breadboard/geometry';
import { LayoutBuilder, SEG7_PINS, validateLayout, type BoardBuilder, type Layout, type Part } from '../src/breadboard/layout';
import { buildNets, unpoweredChips } from '../src/breadboard/nets';
import { BreadboardSim } from '../src/breadboard/sim/engine';
import type { ChipModel } from '../src/breadboard/sim/types';
import type { Level } from '../src/logic/circuit';
import { HEX_DIGITS } from '../src/sim/display';

// ---------------------------------------------------------------------------
// helpers

/** A one-board layout (board "t") built with the builder. */
function board(build: (bb: BoardBuilder) => void): Layout {
  const b = new LayoutBuilder();
  build(b.board('t', { x: 0, y: 0 }, 'test'));
  return b.build();
}

/** 74LS04 at column 10 (1A f10, 1Y f11, 2A f12, 2Y f13, GND f16, VCC e10), powered, port IN on 1A and OUT on 1Y. */
function inverter(extra: (bb: BoardBuilder) => void = () => {}): Layout {
  return board((bb) => {
    const U1 = bb.chip('U1', '74LS04', 10);
    bb.toVcc(U1.pin('VCC'));
    bb.toGnd(U1.pin('GND'));
    bb.port('IN', U1.free('1A'), 'left');
    bb.port('OUT', U1.free('1Y'), 'right');
    extra(bb);
  });
}

const settled = (sim: BreadboardSim, max = 5000) => expect(sim.settle(max).stable).toBe(true);
const kinds = (sim: BreadboardSim) => sim.problems().map((p) => p.kind);
const litLeds = (sim: BreadboardSim, L: Layout) => L.parts.filter((p) => p.kind === 'led' && sim.ledLit(p.id)).map((p) => p.id).sort();

/** Every hole of a BB830. */
const ALL_HOLES = [...ROWS.flatMap((r) => Array.from({ length: 63 }, (_, i) => `${r}${i + 1}`)), ...RAILS.flatMap((r) => RAIL_COLUMNS.map((c) => `${r}${c}`))];

/**
 * Everything the sandbox does with a simulator: settle, run, read every LED,
 * display and hole, list problems, and work every switch.
 */
function exercise(L: Layout) {
  const sim = new BreadboardSim(L);
  sim.settle(5000);
  sim.step(40);
  const read = () => {
    for (const p of L.parts) {
      if (p.kind === 'led') sim.ledLit(p.id);
      else if (p.kind === 'seg7' && !(sim.seg7(p.id) >= 0 && sim.seg7(p.id) <= 0xff)) throw new Error(`seg7(${p.id})`);
    }
    for (const b of L.boards) for (const h of ALL_HOLES) {
      const l = sim.level(b.id, h);
      if (l !== 0 && l !== 1 && l !== 'Z' && l !== 'X') throw new Error(`level(${b.id}, ${h}) = ${String(l)}`);
    }
    sim.problems();
    sim.problems({ floatingInputs: true });
  };
  read();
  for (const p of L.parts) {
    if (p.kind === 'button') {
      sim.press(p.id);
      sim.settle(2000);
      sim.step(10);
      sim.release(p.id);
    } else if (p.kind === 'slide') {
      sim.setSlide(p.id, 1);
      sim.settle(2000);
      sim.setSlide(p.id, 0);
    } else if (p.kind === 'dip') {
      sim.setDip(p.id, 0b0101);
      sim.settle(2000);
      sim.setDip(p.id, 0b1010);
    }
  }
  sim.settle(2000);
  sim.step(40);
  read();
  return sim;
}

/** Run `exercise` and say which layout broke it. */
function exerciseOrExplain(L: Layout, what: string) {
  try {
    exercise(L);
  } catch (e) {
    throw new Error(`${what}: ${(e as Error).stack ?? e}`);
  }
}

// ---------------------------------------------------------------------------

describe('BreadboardSim: nets and supplies', () => {
  it('gives the + rails 1 and the − rails 0, and a strip with nothing in it floats', () => {
    const sim = new BreadboardSim(board((bb) => bb.wire('a10', 'a20')));
    for (const h of ['tp3', 'tp61', 'bp30']) expect(sim.level('t', h)).toBe(1);
    for (const h of ['tn3', 'tn61', 'bn30']) expect(sim.level('t', h)).toBe(0);
    expect(sim.level('t', 'c40')).toBe('Z');
    expect(sim.level('t', 'e10')).toBe('Z');
    expect(sim.problems()).toEqual([]);
  });

  it('uses the nets of buildNets: strips, wires, ports', () => {
    const L = board((bb) => {
      bb.wire('a10', 'j20', 'blue');
      bb.wire('f20', 'tp21', 'red');
      bb.port('P', 'a30', 'top');
    });
    const sim = new BreadboardSim(L);
    const nets = buildNets(L);
    for (const h of ['a10', 'e10', 'f20', 'j20', 'a30', 'f10']) expect(sim.netOf('t', h)).toBe(nets.netOf('t', h));
    expect(sim.netOf('t', 'e10')).toBe('VCC'); // a10 strip -> j20 strip -> tp21
    expect(sim.level('t', 'b10')).toBe(1);
    expect(sim.netOf('t', 'd30')).toBe('port:P');
    expect(sim.level('t', 'f10')).toBe('Z'); // the other half of column 10
  });

  it('joins same-named ports across boards and powers every board', () => {
    const b = new LayoutBuilder();
    const one = b.board('one', { x: 0, y: 0 });
    const two = b.board('two', { x: 0, y: 25 });
    one.port('X', 'a10', 'right');
    two.port('X', 'a10', 'left');
    two.led('D1', 'red', 'c10', 'tn11');
    const sim = new BreadboardSim(b.build());
    expect(sim.ports()).toEqual(['X']);
    expect(sim.level('two', 'tp5')).toBe(1);
    expect(sim.ledLit('D1')).toBe(false);
    sim.setPort('X', 1);
    expect(sim.level('one', 'e10')).toBe(1);
    expect(sim.level('two', 'e10')).toBe(1);
    expect(sim.ledLit('D1')).toBe(true);
  });

  it('treats the rails of a signal-rail board as ordinary nets', () => {
    const b = new LayoutBuilder();
    const bb = b.board('sig', { x: 0, y: 0 }, 'bus', { rails: 'signal' });
    const U1 = bb.chip('U1', '74LS04', 10);
    bb.toVcc(U1.pin('VCC'));
    bb.toGnd(U1.pin('GND'));
    bb.port('BUS0', 'tp3', 'left');
    const sim = new BreadboardSim(b.build());
    expect(sim.level('sig', 'tp30')).toBe('Z');
    expect(sim.level('sig', 'tn30')).toBe('Z');
    expect(sim.problems().find((p) => p.kind === 'unpowered')?.part).toBe('U1');
    sim.setPort('BUS0', 1);
    expect(sim.level('sig', 'tp61')).toBe(1);
  });

  it('reports a short between +5 V and GND and powers nothing', () => {
    const L = inverter((bb) => bb.wire('tp30', 'tn30', 'red'));
    const sim = new BreadboardSim(L);
    settled(sim);
    const probs = sim.problems();
    expect(probs.filter((p) => p.kind === 'short')).toHaveLength(1);
    expect(probs.find((p) => p.kind === 'unpowered')?.message).toMatch(/shorted/);
    expect(sim.level('t', 'tp3')).toBe('X');
    expect(sim.level('t', 'bn3')).toBe('X');
    sim.setPort('IN', 0);
    sim.step(5);
    expect(sim.portLevel('OUT')).toBe('Z');
    expect(probs.filter((p) => p.kind === 'contention')).toEqual([]); // the short is reported once, as a short
  });

  it('level() of a hole that does not exist or a board that is not there is Z', () => {
    const sim = new BreadboardSim(inverter());
    expect(sim.level('t', 'tp8')).toBe('Z'); // gap between rail groups
    expect(sim.level('t', 'k3')).toBe('Z');
    expect(sim.level('nope', 'a1')).toBe('Z');
    expect(sim.level('nope', 'tp3')).toBe('Z');
  });
});

describe('BreadboardSim: chips and power', () => {
  it('runs a powered chip', () => {
    const sim = new BreadboardSim(inverter());
    expect(sim.problems()).toEqual([]);
    sim.setPort('IN', 0);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(1);
    sim.setPort('IN', 1);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(0);
    sim.setPort('IN', null); // floating input reads 1 (LS-TTL)
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(0);
    expect(sim.pinLevel('U1', '2Y')).toBe(0); // unconnected 2A reads 1 too
    expect(sim.pinLevel('U1', 14)).toBe(1);
    expect(sim.partLevels('U1')[6]).toBe(0); // pin 7 = GND
  });

  it('leaves out a chip without power: reported, outputs floating, no state', () => {
    for (const [what, power] of [
      ['nothing', () => {}],
      ['VCC only', (bb: BoardBuilder) => bb.toVcc('e10')],
      ['GND only', (bb: BoardBuilder) => bb.toGnd('f16')],
    ] as const) {
      const L = board((bb) => {
        bb.chip('U1', '74LS04', 10);
        bb.port('IN', 'g10', 'left');
        bb.port('OUT', 'g11', 'right');
        power(bb);
      });
      const sim = new BreadboardSim(L);
      sim.setPort('IN', 0);
      sim.settle(100);
      const p = sim.problems();
      expect(p.map((x) => x.kind), what).toEqual(['unpowered']);
      expect(p[0].part).toBe('U1');
      expect(p[0].message).toMatch(what === 'VCC only' ? /GND/ : /VCC/);
      expect(p[0].at).toMatch(/^t:[a-j]\d+$/);
      expect(sim.portLevel('OUT')).toBe('Z');
      expect(sim.chipState('U1')).toBeUndefined();
    }
  });

  it('powers a chip up and down through a switch', () => {
    const L = board((bb) => {
      const U1 = bb.chip('U1', '74LS04', 10);
      bb.toGnd(U1.pin('GND'));
      bb.slide('SW1', 'c3', 'c4', 'c5');
      bb.wire('a5', 'tp5', 'red');
      bb.wire('d4', 'd10', 'red'); // switch common -> VCC pin (e10)
      bb.port('IN', U1.free('1A'), 'left');
      bb.port('OUT', U1.free('1Y'), 'right');
    });
    const sim = new BreadboardSim(L);
    sim.setPort('IN', 0);
    settled(sim);
    expect(kinds(sim)).toEqual(['unpowered']);
    expect(sim.portLevel('OUT')).toBe('Z');
    sim.setSlide('SW1', 1);
    expect(kinds(sim)).toEqual([]);
    expect(sim.portLevel('OUT')).toBe(1); // powers up in zero time
    expect(sim.chipState('U1')).toBeDefined();
    sim.setSlide('SW1', 0);
    expect(kinds(sim)).toEqual(['unpowered']);
    expect(sim.portLevel('OUT')).toBe('Z');
    expect(sim.chipState('U1')).toBeUndefined();
  });

  it('reports a chip that is powered backwards', () => {
    const L = board((bb) => {
      bb.chip('U1', '74LS04', 10);
      bb.wire('a10', 'tn10', 'black'); // VCC pin on ground
      bb.wire('j16', 'bp16', 'red'); // GND pin on +5 V
    });
    const sim = new BreadboardSim(L);
    expect(sim.problems()).toMatchObject([{ kind: 'unpowered', part: 'U1' }]);
  });

  it('reports chips that are not in the catalog or have no model, and simulates the rest', () => {
    const L = inverter();
    L.parts.push({ id: 'U9', board: 't', kind: 'chip', chip: '74LS999', col: 40 } as Part);
    const sim = new BreadboardSim(L);
    expect(sim.problems()).toMatchObject([{ kind: 'unknown-chip', part: 'U9' }]);
    sim.setPort('IN', 0);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(1);

    const noModel = new BreadboardSim(inverter(), { models: { '74LS04': undefined as unknown as ChipModel } });
    expect(noModel.problems()).toMatchObject([{ kind: 'unknown-chip', part: 'U1' }]);
    expect(noModel.problems()[0].message).toMatch(/no simulation model/);
  });

  it('takes chip models from the options', () => {
    const buffer: ChipModel = { id: '74LS04', inputs: [1], outputs: [2], delay: 1, evaluate: ([a]) => [a === 'Z' ? 1 : a] };
    const sim = new BreadboardSim(inverter(), { models: { '74LS04': buffer } });
    sim.setPort('IN', 0);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(0);
  });

  it('reports floating inputs only when asked', () => {
    const sim = new BreadboardSim(inverter());
    expect(sim.problems()).toEqual([]);
    const floating = sim.problems({ floatingInputs: true });
    expect(floating.length).toBe(5); // 2A..6A; 1A is on a port, which is connected off the board
    expect(floating.every((p) => p.kind === 'floating-input' && p.part === 'U1')).toBe(true);
    const text = floating.map((p) => p.message).join('\n');
    expect(text).toMatch(/pin 3 \(2A\)/);
    expect(text).toMatch(/pin 13 \(6A\)/);
    expect(text).not.toMatch(/pin 1 \(1A\)/);
    expect(floating.find((p) => /2A/.test(p.message))!.at).toBe('t:f12');
  });

  it('reports two outputs fighting over one net', () => {
    const L = inverter((bb) => {
      bb.wire('h11', 'h13', 'yellow'); // 1Y and 2Y joined
      bb.port('IN2', 'g12', 'left');
    });
    const sim = new BreadboardSim(L);
    sim.setPort('IN', 1);
    sim.setPort('IN2', 1);
    settled(sim);
    expect(sim.problems()).toEqual([]); // both drive 0
    sim.setPort('IN', 0);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe('X');
    const p = sim.problems().filter((x) => x.kind === 'contention');
    expect(p).toHaveLength(1);
    expect(p[0].part).toBe('U1');
    expect(p[0].message).toMatch(/OUT.*U1 drives 1.*U1 drives 0|OUT.*U1 drives 0.*U1 drives 1/);
  });

  it('reports an output wired to a supply rail, and a port driven against one', () => {
    const L = inverter((bb) => {
      bb.wire('i11', 'bn11', 'black'); // 1Y straight to GND
      bb.port('RAIL', 'tp30', 'top'); // a port on the + rail
    });
    const sim = new BreadboardSim(L);
    sim.setPort('IN', 1);
    settled(sim);
    expect(sim.problems()).toEqual([]); // 1Y = 0 agrees with GND
    sim.setPort('IN', 0);
    settled(sim);
    expect(sim.problems()).toMatchObject([{ kind: 'contention', part: 'U1' }]);
    expect(sim.problems()[0].message).toMatch(/GND/);
    sim.setPort('IN', 1);
    settled(sim);
    sim.setPort('RAIL', 1);
    expect(sim.problems()).toEqual([]);
    sim.setPort('RAIL', 0);
    expect(sim.portLevel('RAIL')).toBe('X');
    const p = sim.problems();
    expect(p).toHaveLength(1);
    expect(p[0].kind).toBe('contention');
    expect(p[0].message).toMatch(/port RAIL drives 0/);
    expect(p[0].message).toMatch(/\+5 V supply drives 1/);
  });

  it('powers cross-coupled gates up in a valid state', () => {
    const sim = new BreadboardSim(buildSrLatch());
    expect(sim.settle(100)).toEqual({ stable: true, steps: 0 });
    expect(sim.ledLit('D1')).not.toBe(sim.ledLit('D2'));
    expect(sim.pinLevel('U1', '1Y')).not.toBe(sim.pinLevel('U1', '2Y'));
  });

  it('keeps a ring oscillator oscillating', () => {
    const L = board((bb) => {
      const U1 = bb.chip('U1', '74LS04', 10);
      bb.toVcc(U1.pin('VCC'));
      bb.toGnd(U1.pin('GND'));
      bb.wire('g11', 'g12', 'yellow'); // 1Y -> 2A
      bb.wire('g13', 'g14', 'yellow'); // 2Y -> 3A
      bb.wire('g15', 'g10', 'yellow'); // 3Y -> 1A
    });
    const sim = new BreadboardSim(L);
    expect(sim.settle(500)).toEqual({ stable: false, steps: 500 });
    let changes = 0;
    let last = sim.pinLevel('U1', '1Y');
    for (let t = 0; t < 60; t++) {
      sim.step(1);
      const l = sim.pinLevel('U1', '1Y');
      expect(l === 0 || l === 1).toBe(true);
      if (l !== last) changes++;
      last = l;
    }
    expect(changes).toBe(20); // period 6: three inverters, one gate delay each
  });
});

describe('BreadboardSim: switches', () => {
  it('rebuilds the nets when a switch moves and keeps every chip state', () => {
    const L = buildRegister();
    const sim = new BreadboardSim(L);
    const u1 = sim.chipState('U1');
    expect(u1).toBeDefined();
    const before = sim.rebuildCount;
    sim.setDip('SW1', 0b0110);
    expect(sim.rebuildCount).toBe(before + 1);
    sim.setDip('SW1', 0b0110); // no change, no rebuild
    expect(sim.rebuildCount).toBe(before + 1);
    expect(sim.dipValue('SW1')).toBe(0b0110);
    sim.pulse('SW2', 10);
    settled(sim);
    expect(litLeds(sim, L)).toEqual(['D2', 'D3']);
    sim.setDip('SW1', 0b1001); // a rebuild: the register keeps its value
    settled(sim);
    expect(sim.chipState('U1')).toBe(u1);
    expect(litLeds(sim, L)).toEqual(['D2', 'D3']);
  });

  it('detects a clock edge made by the switch that rebuilt the circuit', () => {
    const sim = new BreadboardSim(buildRegister());
    sim.setDip('SW1', 0b0001);
    settled(sim);
    sim.press('SW2'); // CP rises with this rebuild
    expect(sim.isPressed('SW2')).toBe(true);
    settled(sim);
    expect(sim.ledLit('D1')).toBe(true); // loaded on the press, not the release
    sim.release('SW2');
    sim.release('SW2'); // releasing twice is harmless
    settled(sim);
    expect(sim.ledLit('D1')).toBe(true);
  });

  it('keeps a 555 ticking through rebuilds', () => {
    const L = board((bb) => {
      const U1 = bb.chip('U1', 'NE555', 9, { params: { halfPeriod: 50 } });
      bb.toVcc(U1.pin('VCC'));
      bb.toGnd('j9');
      bb.toVcc('j12'); // ~RESET high
      bb.button('SW1', 'i50', 'i52'); // unrelated button: every press rebuilds
      bb.slide('SW2', 'c40', 'c41', 'c42');
    });
    const sim = new BreadboardSim(L);
    const edges: number[] = [];
    let last = sim.pinLevel('U1', 'OUT');
    for (let t = 0; t < 1200; t++) {
      if (t % 37 === 0) (sim.isPressed('SW1') ? sim.release('SW1') : sim.press('SW1'));
      if (t % 53 === 0) sim.setSlide('SW2', sim.slidePos('SW2') ? 0 : 1);
      sim.step(1);
      const l = sim.pinLevel('U1', 'OUT');
      if (l !== last) edges.push(sim.time);
      last = l;
    }
    expect(sim.rebuildCount).toBeGreaterThan(50);
    expect(edges.length).toBeGreaterThanOrEqual(22);
    for (let i = 1; i < edges.length; i++) expect(edges[i] - edges[i - 1]).toBe(50);
  });

  it('joins slide switch positions and DIP switches', () => {
    const L = board((bb) => {
      bb.slide('SW1', 'c10', 'c11', 'c12');
      bb.wire('a10', 'tn10', 'black');
      bb.wire('a12', 'tp12', 'red');
      bb.dip('SW2', 4, 33);
      for (let k = 0; k < 4; k++) bb.wire(`j${33 + k}`, `bp${33 + k}`, 'red');
    });
    (L.parts.find((p) => p.id === 'SW1') as Extract<Part, { kind: 'slide' }>).initial = 1;
    const sim = new BreadboardSim(L);
    expect(sim.slidePos('SW1')).toBe(1); // the layout's initial position
    expect(sim.level('t', 'e11')).toBe(1);
    sim.setSlide('SW1', 0);
    expect(sim.slidePos('SW1')).toBe(0);
    expect(sim.level('t', 'e11')).toBe(0);
    const tops = ['a33', 'a34', 'a35', 'a36'];
    expect(tops.map((h) => sim.level('t', h))).toEqual(['Z', 'Z', 'Z', 'Z']);
    sim.setDip('SW2', 0b1_0101); // bit 4 is not a switch of a 4-way DIP
    expect(sim.dipValue('SW2')).toBe(0b0101);
    expect(tops.map((h) => sim.level('t', h))).toEqual([1, 'Z', 1, 'Z']);
  });

  it('keeps chip state when the layout changes under it (setLayout)', () => {
    const L = buildRegister();
    const sim = new BreadboardSim(L);
    sim.setDip('SW1', 0b1100);
    sim.pulse('SW2', 10);
    settled(sim);
    const next: Layout = { ...L, parts: [...L.parts, { id: 'D9', board: 'reg', kind: 'led', color: 'green', anode: 'h31', cathode: 'bn31' } as Part] };
    sim.setLayout(next);
    settled(sim);
    expect(litLeds(sim, next)).toEqual(['D3', 'D4', 'D9']);
    expect(sim.dipValue('SW1')).toBe(0b1100);
  });

  it('refuses to work a part that is not that kind of switch', () => {
    const sim = new BreadboardSim(buildRegister());
    expect(() => sim.press('SW1')).toThrow(/dip, not a button/);
    expect(() => sim.setDip('NOPE', 1)).toThrow(/No part/);
  });
});

describe('BreadboardSim: resistors', () => {
  it('pulls an undriven net; a driver beats the pull', () => {
    const L = inverter((bb) => bb.resistor('R1', 10_000, 'i10', 'bn10'));
    const sim = new BreadboardSim(L);
    settled(sim);
    expect(sim.level('t', 'f10')).toBe(0);
    expect(sim.portLevel('OUT')).toBe(1);
    sim.setPort('IN', 1);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(0);
    sim.setPort('IN', null);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(1);
  });

  it('lets the smaller resistance win, and reports equal pulls both ways', () => {
    const stronger = new BreadboardSim(inverter((bb) => {
      bb.resistor('R1', 10_000, 'i10', 'bn10');
      bb.resistor('R2', 1000, 'j10', 'bp9');
    }));
    settled(stronger);
    expect(stronger.level('t', 'f10')).toBe(1);
    expect(stronger.portLevel('OUT')).toBe(0);

    const equal = new BreadboardSim(inverter((bb) => {
      bb.resistor('R1', 1000, 'i10', 'bn10');
      bb.resistor('R2', 1000, 'j10', 'bp9');
    }));
    expect(equal.level('t', 'f10')).toBe('X');
    expect(equal.problems()).toMatchObject([{ kind: 'contention' }]);
    expect(equal.problems()[0].message).toMatch(/pulled up and down equally hard/);
    equal.setPort('IN', 0);
    expect(equal.problems()).toEqual([]);
  });

  it('feeds a chip input through a series resistor', () => {
    const L = inverter((bb) => {
      bb.port('S', 'g30', 'left');
      bb.resistor('R1', 1000, 'h30', 'h12'); // S -> 2A
    });
    const sim = new BreadboardSim(L);
    sim.setPort('S', 0);
    settled(sim);
    expect(sim.level('t', 'f12')).toBe(0);
    expect(sim.pinLevel('U1', '2Y')).toBe(1);
    sim.setPort('S', 1);
    settled(sim);
    expect(sim.pinLevel('U1', '2Y')).toBe(0);
    sim.setPort('S', 0);
    settled(sim);
    sim.setPort('S', null); // the far side floats: so does the input
    settled(sim);
    expect(sim.level('t', 'f12')).toBe('Z');
    expect(sim.pinLevel('U1', '2Y')).toBe(0);
    expect(sim.problems()).toEqual([]);
  });

  it('a series resistor into a pulled net wins only if it is the smaller one', () => {
    const follows = new BreadboardSim(inverter((bb) => {
      bb.port('S', 'g30', 'left');
      bb.resistor('R1', 1000, 'h30', 'h12');
      bb.resistor('R2', 10_000, 'i12', 'bn12');
    }));
    follows.setPort('S', 1);
    settled(follows);
    expect(follows.pinLevel('U1', '2Y')).toBe(0);
    follows.setPort('S', null);
    settled(follows);
    expect(follows.level('t', 'f12')).toBe(0); // back to the pull
    expect(follows.pinLevel('U1', '2Y')).toBe(1);

    const pulled = new BreadboardSim(inverter((bb) => {
      bb.port('S', 'g30', 'left');
      bb.resistor('R1', 10_000, 'h30', 'h12');
      bb.resistor('R2', 1000, 'i12', 'bn12');
    }));
    pulled.setPort('S', 1);
    settled(pulled);
    expect(pulled.pinLevel('U1', '2Y')).toBe(1);
  });

  it('lights an LED through a series resistor on either leg, at once', () => {
    const L = board((bb) => {
      bb.port('A', 'a10', 'top');
      bb.resistor('R1', 220, 'b10', 'b14'); // resistor on the anode leg
      bb.led('D1', 'red', 'c14', 'tn15');
      bb.port('B', 'a20', 'top');
      bb.led('D2', 'red', 'b20', 'b24'); // resistor on the cathode leg
      bb.resistor('R2', 220, 'c24', 'tn25');
    });
    const sim = new BreadboardSim(L);
    expect([sim.ledLit('D1'), sim.ledLit('D2')]).toEqual([false, false]);
    sim.setPort('A', 1);
    sim.setPort('B', 1);
    expect([sim.ledLit('D1'), sim.ledLit('D2')]).toEqual([true, true]); // no step needed
    sim.setPort('A', 0);
    sim.setPort('B', 0);
    expect([sim.ledLit('D1'), sim.ledLit('D2')]).toEqual([false, false]);
    expect(sim.problems()).toEqual([]);
  });

  it('keeps both sides of a divider apart: an LED between them sees agreement only', () => {
    const L = board((bb) => {
      bb.port('A', 'a10', 'top');
      bb.port('B', 'a30', 'top');
      bb.resistor('R1', 1000, 'b10', 'b20');
      bb.resistor('R2', 1000, 'b30', 'c20');
      bb.led('D1', 'red', 'd20', 'tn21');
    });
    const sim = new BreadboardSim(L);
    sim.setPort('A', 1);
    sim.setPort('B', 1);
    settled(sim);
    expect(sim.ledLit('D1')).toBe(true);
    sim.setPort('B', 0);
    settled(sim);
    expect(sim.ledLit('D1')).toBe(false);
    expect(sim.level('t', 'e20')).toBe('Z');
    expect(sim.problems()).toEqual([]); // a divider is not contention
  });

  it('ignores resistors across the supply or within one net, and dangling legs', () => {
    const L = board((bb) => {
      bb.resistor('R1', 1000, 'tp3', 'tn3');
      bb.resistor('R2', 1000, 'a10', 'b10');
      bb.resistor('R3', 1000, 'a20', 'a21'); // nothing else on either strip
    });
    const sim = new BreadboardSim(L);
    settled(sim);
    expect(sim.problems()).toEqual([]);
    expect(sim.level('t', 'tp3')).toBe(1);
    expect(sim.level('t', 'c20')).toBe('Z');
  });

  it('makes an edge pulse from a capacitor into a pulled net (RC differentiator)', () => {
    const L = board((bb) => {
      bb.port('CLK', 'a10', 'top');
      bb.capacitor('C1', 0.01e-6, 'b10', 'b20');
      bb.resistor('R1', 1000, 'a20', 'tn21'); // pull-down: high pulse after a rising edge
      bb.led('D1', 'red', 'c20', 'tn19');
      bb.capacitor('C2', 0.01e-6, 'c10', 'b30');
      bb.resistor('R2', 1000, 'a30', 'tp31'); // pull-up: low pulse after a falling edge
      bb.led('D2', 'red', 'tp29', 'c30');
    });
    const sim = new BreadboardSim(L);
    sim.setPort('CLK', 0);
    settled(sim);
    expect([sim.ledLit('D1'), sim.ledLit('D2')]).toEqual([false, false]);
    sim.setPort('CLK', 1);
    sim.step(2);
    expect([sim.ledLit('D1'), sim.ledLit('D2')]).toEqual([true, false]);
    settled(sim);
    expect([sim.ledLit('D1'), sim.ledLit('D2')]).toEqual([false, false]);
    sim.setPort('CLK', 0);
    sim.step(2);
    expect([sim.ledLit('D1'), sim.ledLit('D2')]).toEqual([false, true]);
    const { steps } = sim.settle(100);
    expect(steps).toBe(3); // edgeWidth 4, from 1 to 5 after the edge
    expect(sim.problems()).toEqual([]);

    const wide = new BreadboardSim(L, { edgeWidth: 20 });
    wide.setPort('CLK', 0);
    settled(wide);
    wide.setPort('CLK', 1);
    wide.step(15);
    expect(wide.ledLit('D1')).toBe(true);
    wide.step(10);
    expect(wide.ledLit('D1')).toBe(false);
  });
});

describe('BreadboardSim: LEDs and 7-segment displays', () => {
  it('lights an LED iff its anode is 1 and its cathode 0', () => {
    const sim = new BreadboardSim(board((bb) => {
      bb.port('A', 'a10', 'top');
      bb.port('K', 'a12', 'top');
      bb.led('D1', 'red', 'c10', 'c12');
    }));
    const cases: [Level | null, Level | null, boolean][] = [
      [1, 0, true], [0, 0, false], [1, 1, false], [0, 1, false],
      [null, 0, false], [1, null, false], [null, null, false], ['X', 0, false],
    ];
    for (const [a, k, lit] of cases) {
      sim.setPort('A', a);
      sim.setPort('K', k);
      expect(sim.ledLit('D1'), `A=${a} K=${k}`).toBe(lit);
    }
    expect(sim.problems().filter((p) => p.kind === 'reversed-led')).toEqual([]);
  });

  it('reports LEDs that are in backwards, but not ones still waiting for their other leg', () => {
    const L = board((bb) => {
      bb.led('D1', 'red', 'tn5', 'tp5'); // across the rails, backwards
      bb.led('D2', 'green', 'tp21', 'tn21'); // across the rails, the right way
      bb.port('K', 'a12', 'top');
      bb.led('D3', 'red', 'c10', 'c12');
      bb.wire('a10', 'tn10', 'black'); // anode on ground, cathode on a signal
      bb.led('D4', 'red', 'tn30', 'c30'); // anode on ground, cathode not connected yet
      bb.port('A', 'a40', 'top');
      bb.led('D5', 'red', 'c40', 'tp41'); // cathode on +5 V
    });
    const sim = new BreadboardSim(L);
    expect(sim.ledLit('D1')).toBe(false);
    expect(sim.ledLit('D2')).toBe(true);
    const rev = sim.problems().filter((p) => p.kind === 'reversed-led');
    expect(rev.map((p) => p.part).sort()).toEqual(['D1', 'D3', 'D5']);
    expect(rev.find((p) => p.part === 'D3')!.message).toMatch(/anode is on ground/);
    expect(rev.find((p) => p.part === 'D5')!.message).toMatch(/cathode is on \+5 V/);
    expect(rev.find((p) => p.part === 'D3')!.at).toBe('t:c10');
  });

  /** A display at column 20: pins 1-5 in row h (cols 20-24), 6-10 in row d (cols 24-20); a port on every segment's strip. */
  function display(common: 'cathode' | 'anode', com: (bb: BoardBuilder) => void): Layout {
    return board((bb) => {
      const ds = bb.seg7('DS1', 20, common);
      SEG7_PINS.forEach((name, i) => {
        if (name === 'com') return;
        const hole = ds.pin(i + 1);
        bb.port(`SEG_${name}`, `${hole[0] === 'h' ? 'j' : 'a'}${hole.slice(1)}`, hole[0] === 'h' ? 'bottom' : 'top');
      });
      com(bb);
    });
  }
  const SEGS = ['dp', 'a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
  const drive = (sim: BreadboardSim, byte: number, litLevel: 0 | 1) =>
    SEGS.forEach((s, i) => sim.setPort(`SEG_${s}`, ((byte >> (7 - i)) & 1 ? litLevel : 1 - litLevel) as 0 | 1));

  it('reads a common-cathode display: segment 1 and common 0 is lit', () => {
    const sim = new BreadboardSim(display('cathode', (bb) => bb.wire('j22', 'bn22', 'black')));
    for (const byte of [0x00, 0xff, 0x7e, 0x30, 0x80, 0x01, ...HEX_DIGITS]) {
      drive(sim, byte, 1);
      expect(sim.seg7('DS1')).toBe(byte);
    }
    for (const s of SEGS) sim.setPort(`SEG_${s}`, null); // floating segments are dark
    expect(sim.seg7('DS1')).toBe(0);
    expect(sim.problems()).toEqual([]);
  });

  it('reads a common-anode display: segment 0 and common 1 (through its resistor) is lit', () => {
    const sim = new BreadboardSim(display('anode', (bb) => bb.resistor('R1', 100, 'a22', 'tp21')));
    for (const byte of [0x00, 0xff, 0x7e, 0x4f, 0x80]) {
      drive(sim, byte, 0);
      expect(sim.seg7('DS1')).toBe(byte);
    }
  });

  it('is dark while its common is not connected, or at the wrong level', () => {
    const open = new BreadboardSim(display('cathode', () => {}));
    drive(open, 0xff, 1);
    expect(open.seg7('DS1')).toBe(0);
    const driven = new BreadboardSim(display('cathode', (bb) => bb.port('COM', 'a22', 'top')));
    drive(driven, 0x7e, 1);
    driven.setPort('COM', 1);
    expect(driven.seg7('DS1')).toBe(0);
    driven.setPort('COM', 0);
    expect(driven.seg7('DS1')).toBe(0x7e);
  });
});

describe('BreadboardSim: ports and time', () => {
  it('drives, reads and releases ports', () => {
    const sim = new BreadboardSim(inverter());
    expect(sim.ports().sort()).toEqual(['IN', 'OUT']);
    expect(sim.portDriven('IN')).toBeNull();
    expect(sim.portLevel('IN')).toBe('Z');
    sim.setPort('IN', 0);
    expect(sim.portDriven('IN')).toBe(0);
    expect(sim.portLevel('IN')).toBe(0);
    expect(sim.level('t', 'j10')).toBe(0);
    sim.setPort('IN', null);
    expect(sim.portLevel('IN')).toBe('Z');
    expect(() => sim.setPort('NOPE', 1)).toThrow(/No port/);
    expect(() => sim.portLevel('NOPE')).toThrow(/No port/);
  });

  it('pulses a port and leaves it at the inactive level', () => {
    const sim = new BreadboardSim(inverter());
    const t0 = sim.time;
    sim.pulse('IN', 5, 0);
    expect(sim.time).toBe(t0 + 10);
    expect(sim.portDriven('IN')).toBe(1);
    expect(sim.portLevel('OUT')).toBe(0);
    expect(() => sim.pulse('NOPE')).toThrow();
  });

  it('counts time in gate delays', () => {
    const sim = new BreadboardSim(inverter());
    sim.setPort('IN', 1);
    settled(sim);
    const t0 = sim.time;
    sim.setPort('IN', 0);
    expect(sim.portLevel('OUT')).toBe(0); // not yet
    sim.step();
    expect(sim.time).toBe(t0 + 1);
    expect(sim.portLevel('OUT')).toBe(1); // a 74LS04 takes one gate delay
    sim.step(0);
    sim.step(-4);
    expect(sim.time).toBe(t0 + 1);
    sim.step(2.9);
    expect(sim.time).toBe(t0 + 3);
    sim.run(5);
    expect(sim.time).toBe(t0 + 8);
    expect(sim.settle()).toEqual({ stable: true, steps: 0 });
  });

  it('uses params.delay from the layout and from setParams', () => {
    const L = inverter();
    (L.parts.find((p) => p.id === 'U1') as Extract<Part, { kind: 'chip' }>).params = { delay: 5 };
    const sim = new BreadboardSim(L);
    sim.setPort('IN', 1);
    settled(sim);
    sim.setPort('IN', 0);
    sim.step(4);
    expect(sim.portLevel('OUT')).toBe(0);
    sim.step(1);
    expect(sim.portLevel('OUT')).toBe(1);
    sim.setParams('U1', { delay: 2 });
    sim.setPort('IN', 1);
    sim.step(2);
    expect(sim.portLevel('OUT')).toBe(0);
  });

  it('steps to the next change: a gate delay at a time as it spreads, none once it has settled', () => {
    const sim = new BreadboardSim(buildSrLatch());
    sim.settle(100);
    expect(sim.stepToChange()).toEqual({ steps: 0, changed: 0 }); // nothing is coming
    const q = sim.ledLit('D1');
    sim.press(q ? 'SW2' : 'SW1'); // the button that flips the latch
    const steps: number[] = [];
    for (let r = sim.stepToChange(); r.changed; r = sim.stepToChange()) steps.push(r.steps);
    expect(steps.length).toBeGreaterThan(1); // the gates one after the other
    expect(Math.max(...steps)).toBe(1);
    expect(sim.ledLit('D1')).toBe(!q);
    // a 555 is always about to change: a step goes as far as its next edge
    const counter = new BreadboardSim(buildCounter());
    counter.settle(1000);
    let out = counter.pinLevel('U1', 'OUT'), waited = 0;
    while (counter.pinLevel('U1', 'OUT') === out) {
      const r = counter.stepToChange();
      expect(r.changed).toBeGreaterThan(0);
      waited += r.steps;
    }
    expect(waited).toBeLessThanOrEqual(COUNTER_HALF_PERIOD);
    out = counter.pinLevel('U1', 'OUT');
    const t0 = counter.time;
    while (counter.pinLevel('U1', 'OUT') === out) counter.stepToChange();
    expect(counter.time - t0).toBe(COUNTER_HALF_PERIOD);
  });

  it('settle() gives up on a free-running 555 and setParams changes its speed', () => {
    const sim = new BreadboardSim(buildCounter());
    expect(sim.settle(1000)).toEqual({ stable: false, steps: 1000 });
    sim.setParams('U1', { halfPeriod: 30 });
    sim.step(500); // let the current half period run out
    const edges: number[] = [];
    let last = sim.pinLevel('U1', 'OUT');
    for (let t = 0; t < 300; t++) {
      sim.step(1);
      const l = sim.pinLevel('U1', 'OUT');
      if (l !== last) edges.push(sim.time);
      last = l;
    }
    expect(edges.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < edges.length; i++) expect(edges[i] - edges[i - 1]).toBe(30);
  });

  it('tells listeners about every change', () => {
    const sim = new BreadboardSim(buildRegister());
    let n = 0;
    const off = sim.onChange(() => n++);
    sim.setDip('SW1', 1);
    sim.step(3);
    expect(n).toBeGreaterThanOrEqual(4);
    off();
    const was = n;
    sim.step(3);
    expect(n).toBe(was);
  });
});

// ---------------------------------------------------------------------------

describe('examples', () => {
  it('are valid, powered layouts that simulate without problems', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(['sr-latch', 'd-latch', 'counter', 'register', 'hex-display', 'divide-60', 'seconds']);
    for (const ex of EXAMPLES) {
      expect(exampleById(ex.id)).toBe(ex);
      expect(ex.title.length).toBeGreaterThan(0);
      expect(ex.description.length).toBeGreaterThan(20);
      const L = ex.build();
      expect(validateLayout(L), ex.id).toEqual([]);
      expect(unpoweredChips(L), ex.id).toEqual([]);
      expect(buildNets(L).shorted).toBe(false);
      const sim = new BreadboardSim(L);
      sim.settle(2000);
      expect(sim.problems(), ex.id).toEqual([]);
      expect(ex.build()).toEqual(L); // a fresh copy every time
    }
    expect(exampleById('nope')).toBeUndefined();
  });

  it('divide-60: each stage of the 74LS90 and 74LS92 halves or thirds the last, 60 in to 1 out', () => {
    const sim = new BreadboardSim(buildDivide60());
    const nets: [string, number | string][] = [['U1', 'OUT'], ['U2', 'Q0'], ['U2', 'Q3'], ['U3', 'Q0'], ['U3', 'Q2']];
    const falls = nets.map(() => 0);
    let last = nets.map(([u, pin]) => sim.pinLevel(u, pin));
    for (let t = 0; t < 120 * 2 * DIVIDE60_HALF_PERIOD; t++) {
      sim.step(1);
      const now = nets.map(([u, pin]) => sim.pinLevel(u, pin));
      now.forEach((l, i) => l === 0 && last[i] === 1 && falls[i]++);
      last = now;
    }
    // 120 pulses: 60, 30, 6, 3 and 1 Hz make 120, 60, 12, 6 and 2 falling edges (give or take the first)
    expect(falls[0]).toBeGreaterThanOrEqual(119);
    expect(falls.slice(1)).toEqual([Math.floor(falls[0] / 2), Math.floor(falls[0] / 10), Math.floor(falls[0] / 20), Math.floor(falls[0] / 60)]);
    expect(sim.problems()).toEqual([]);
  });

  it('seconds: the displays count 00 to 59 and wrap, ZERO resets them', () => {
    const sim = new BreadboardSim(buildSeconds());
    // the CD4511's digits as dp a b c d e f g bytes (6 and 9 without tails)
    const SEG = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '0011111', '1110000', '1111111', '1110011'].map((a2g) => parseInt(a2g, 2));
    const shown = () => {
      const [t, u] = [sim.seg7('DS1'), sim.seg7('DS2')].map((byte) => SEG.indexOf(byte));
      return t < 0 || u < 0 ? -1 : 10 * t + u;
    };
    expect(shown()).toBe(0);
    let pulses = 0;
    let out = sim.pinLevel('U1', 'OUT');
    const seen: number[] = [];
    while (pulses < 65) {
      sim.step(1);
      const now = sim.pinLevel('U1', 'OUT');
      if (out === 1 && now === 0) {
        pulses++;
        sim.step(20); // let the ripple through the counters settle
        seen.push(shown());
      }
      out = now;
    }
    expect(seen).toEqual(Array.from({ length: 65 }, (_, k) => (k + 1) % 60));
    sim.press('S1');
    sim.step(20);
    expect(shown()).toBe(0);
    sim.step(4 * SECONDS_HALF_PERIOD);
    expect(shown(), 'held at 00 while ZERO is down').toBe(0);
    sim.release('S1');
    sim.step(4 * SECONDS_HALF_PERIOD);
    expect(shown()).toBe(2);
    expect(sim.problems()).toEqual([]);
  });

  it('sr-latch: S sets, R resets, released holds, both pressed turns both outputs off', () => {
    const L = buildSrLatch();
    const sim = new BreadboardSim(L);
    const q = () => [sim.ledLit('D1'), sim.ledLit('D2')]; // Q, Q̅
    sim.press('SW1');
    settled(sim);
    expect(q()).toEqual([true, false]);
    sim.release('SW1');
    settled(sim);
    expect(q()).toEqual([true, false]);
    sim.press('SW2');
    settled(sim);
    expect(q()).toEqual([false, true]);
    sim.release('SW2');
    settled(sim);
    expect(q()).toEqual([false, true]);
    sim.press('SW1');
    sim.press('SW2');
    settled(sim);
    expect(q()).toEqual([false, false]); // the "invalid" state
    sim.release('SW2');
    settled(sim);
    expect(q()).toEqual([true, false]); // S still held
    sim.release('SW1');
    settled(sim);
    expect(q()).toEqual([true, false]);
    expect(sim.problems()).toEqual([]);
  });

  it('d-latch: Q follows D while E is on, and holds while E is off', () => {
    const sim = new BreadboardSim(buildDLatch());
    const set = (sw: string, v: 0 | 1) => {
      sim.setSlide(sw, v);
      settled(sim);
    };
    const leds = () => ({ d: sim.ledLit('D1'), e: sim.ledLit('D2'), q: sim.ledLit('D3'), nq: sim.ledLit('D4') });
    set('SW2', 1); // E on: transparent
    for (const d of [1, 0, 1, 0, 1] as const) {
      set('SW1', d);
      expect(leds()).toEqual({ d: d === 1, e: true, q: d === 1, nq: d === 0 });
    }
    set('SW2', 0); // E off: hold the 1
    for (const d of [0, 1, 0] as const) {
      set('SW1', d);
      expect(leds()).toEqual({ d: d === 1, e: false, q: true, nq: false });
    }
    set('SW2', 1); // E on with D = 0: Q = 0
    expect(leds().q).toBe(false);
    set('SW2', 0);
    set('SW1', 1);
    expect(leds()).toEqual({ d: true, e: false, q: false, nq: true });
    expect(sim.problems()).toEqual([]);
  });

  it('counter: the 555 clocks the 74LS161, which counts up on every rising edge', () => {
    const sim = new BreadboardSim(buildCounter());
    const count = () => [0, 1, 2, 3].reduce((v, k) => v | ((sim.ledLit(`D${2 + k}`) ? 1 : 0) << k), 0);
    expect(count()).toBe(0);
    const rises: number[] = [];
    const counts: number[] = [];
    let last = sim.pinLevel('U1', 'OUT');
    for (let t = 0; t < 21 * 2 * COUNTER_HALF_PERIOD; t++) {
      sim.step(1);
      const out = sim.pinLevel('U1', 'OUT');
      expect(sim.ledLit('D1')).toBe(out === 1); // the clock LED
      if (last === 0 && out === 1) rises.push(sim.time);
      if (rises.length && sim.time === rises[rises.length - 1] + 10) counts.push(count());
      last = out;
    }
    expect(counts.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) % 16));
    for (let i = 1; i < rises.length; i++) expect(rises[i] - rises[i - 1]).toBe(2 * COUNTER_HALF_PERIOD);
    expect(sim.pinLevel('U2', 'TC')).toBe(count() === 15 ? 1 : 0);
    expect(sim.problems()).toEqual([]);
  });

  it('register: loads the DIP switches on LOAD and holds them until the next press', () => {
    const L = buildRegister();
    const sim = new BreadboardSim(L);
    const value = () => [0, 1, 2, 3].reduce((v, k) => v | ((sim.ledLit(`D${k + 1}`) ? 1 : 0) << k), 0);
    expect(value()).toBe(0);
    for (const v of [0b1010, 0b0101, 0b1111, 0b0000, 0b1001]) {
      const before = value();
      sim.setDip('SW1', v);
      settled(sim);
      expect(value()).toBe(before); // switches alone change nothing
      sim.press('SW2');
      settled(sim);
      expect(value()).toBe(v);
      sim.release('SW2');
      settled(sim);
      expect(value()).toBe(v);
    }
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });

  it('register: uses pull-downs a 74LS input can actually pull low (1 kΩ)', () => {
    const L = buildRegister();
    for (const k of [1, 2, 3, 4]) expect((L.parts.find((p) => p.id === `R${k}`) as Extract<Part, { kind: 'resistor' }>).ohms).toBeLessThanOrEqual(2000);
  });

  it('hex-display: shows the hex digit of the DIP switch value', () => {
    const sim = new BreadboardSim(buildHexDisplay());
    settled(sim);
    expect(sim.seg7('DS1')).toBe(HEX_DIGITS[0]);
    for (const v of [1, 2, 7, 8, 0xa, 0xb, 0xe, 0xf, 3, 0]) {
      sim.setDip('SW1', v);
      settled(sim);
      expect(sim.seg7('DS1'), `0x${v.toString(16)}`).toBe(HEX_DIGITS[v]);
    }
    for (let v = 0; v < 16; v++) {
      sim.setDip('SW1', v);
      settled(sim);
      expect(sim.seg7('DS1')).toBe(HEX_DIGITS[v]);
    }
    expect(sim.problems()).toEqual([]);
  });
});

describe('A register board on the engine', () => {
  const L = aRegister.layout;
  const setup = () => {
    const sim = new BreadboardSim(L);
    for (const [k, v] of [['CLR', 0], ['CLK', 0], ['~AI', 1], ['~AO', 1]] as const) sim.setPort(k, v);
    settled(sim);
    return sim;
  };
  const setBus = (sim: BreadboardSim, v: number | null) => {
    for (let i = 0; i < 8; i++) sim.setPort(`BUS${i}`, v === null ? null : (((v >> i) & 1) as 0 | 1));
  };
  const read = (sim: BreadboardSim, prefix: string): number | Level[] => {
    const levels = Array.from({ length: 8 }, (_, i) => sim.portLevel(`${prefix}${i}`));
    return levels.every((l) => l === 0 || l === 1) ? levels.reduce<number>((v, l, i) => v | ((l as number) << i), 0) : levels;
  };
  /** D8 = bit 0 ... D1 = bit 7. */
  const ledByte = (sim: BreadboardSim) => Array.from({ length: 8 }, (_, bit) => (sim.ledLit(`D${17 - bit}`) ? 1 << bit : 0)).reduce((a, b) => a | b, 0);
  const load = (sim: BreadboardSim, v: number) => {
    setBus(sim, v);
    sim.setPort('~AI', 0);
    settled(sim);
    sim.pulse('CLK', 20, 1);
    sim.setPort('~AI', 1);
    setBus(sim, null);
    settled(sim);
  };

  it('powers up empty, with nothing to complain about', () => {
    const sim = setup();
    expect(ledByte(sim)).toBe(0);
    expect(read(sim, 'A')).toBe(0);
    expect(sim.problems()).toEqual([]);
  });

  it('loads 0x2A from the bus on the clock edge while ~AI is low, lighting exactly those LEDs', () => {
    const sim = setup();
    setBus(sim, 0x2a);
    sim.setPort('~AI', 0);
    settled(sim);
    expect(ledByte(sim)).toBe(0); // nothing before the edge
    sim.setPort('CLK', 1);
    settled(sim);
    expect(ledByte(sim)).toBe(0x2a);
    expect(litLeds(sim, L)).toEqual(['D12', 'D14', 'D16']);
    expect(read(sim, 'A')).toBe(0x2a); // to the ALU
    sim.setPort('CLK', 0);
    sim.setPort('~AI', 1);
    setBus(sim, null);
    settled(sim);
    expect(ledByte(sim)).toBe(0x2a);
    expect(read(sim, 'BUS')).toEqual(Array(8).fill('Z')); // ~AO high: the 245 is off the bus
  });

  it('ignores the clock while ~AI is high', () => {
    const sim = setup();
    load(sim, 0x2a);
    setBus(sim, 0xff);
    settled(sim);
    sim.pulse('CLK', 20, 1);
    settled(sim);
    expect(ledByte(sim)).toBe(0x2a);
  });

  it('puts the value on the bus while ~AO is low', () => {
    const sim = setup();
    load(sim, 0x2a);
    sim.setPort('~AO', 0);
    settled(sim);
    expect(read(sim, 'BUS')).toBe(0x2a);
    expect(sim.problems()).toEqual([]);
    sim.setPort('BUS0', 1); // someone else drives bit 0 high: contention
    expect(sim.portLevel('BUS0')).toBe('X');
    expect(sim.problems()).toMatchObject([{ kind: 'contention', part: 'U7' }]);
    expect(sim.problems()[0].message).toMatch(/BUS0/);
    sim.setPort('BUS0', null);
    sim.setPort('~AO', 1);
    settled(sim);
    expect(read(sim, 'BUS')).toEqual(Array(8).fill('Z'));
    expect(sim.problems()).toEqual([]);
  });

  it('clears on CLR and loads again afterwards', () => {
    const sim = setup();
    load(sim, 0xff);
    expect(litLeds(sim, L)).toHaveLength(8);
    sim.setPort('CLR', 1);
    settled(sim);
    expect(ledByte(sim)).toBe(0);
    expect(read(sim, 'A')).toBe(0);
    load(sim, 0xc3); // CLR still high: the 173s stay clear
    expect(ledByte(sim)).toBe(0);
    sim.setPort('CLR', 0);
    settled(sim);
    load(sim, 0xc3);
    expect(ledByte(sim)).toBe(0xc3);
    expect(litLeds(sim, L)).toEqual(['D10', 'D11', 'D16', 'D17']);
  });

  it('loads every value bit by bit', () => {
    const sim = setup();
    for (const v of [0x01, 0x80, 0x55, 0xaa, 0x7f, 0x00, 0x2a]) {
      load(sim, v);
      expect(ledByte(sim)).toBe(v);
      expect(read(sim, 'A')).toBe(v);
    }
  });
});

// ---------------------------------------------------------------------------

describe('layouts built one part at a time (the sandbox)', () => {
  const layouts: [string, Layout][] = [...EXAMPLES.map((e) => [e.id, e.build()] as [string, Layout]), ['a-register', aRegister.layout]];

  it('simulates every prefix of the examples and of the A register without throwing', () => {
    for (const [id, L] of layouts) {
      for (let k = 0; k <= L.parts.length; k++) exerciseOrExplain({ boards: L.boards, parts: L.parts.slice(0, k) }, `${id}, first ${k} parts`);
    }
  });

  it('simulates the examples with any one part missing', () => {
    for (const [id, L] of layouts.slice(0, EXAMPLES.length)) {
      for (let k = 0; k < L.parts.length; k++) exerciseOrExplain({ boards: L.boards, parts: L.parts.filter((_, i) => i !== k) }, `${id} without ${L.parts[k].id}`);
    }
  });

  it('builds a circuit step by step like a user would', () => {
    const parts: Part[] = [];
    const stage = (p: Part, check: (sim: BreadboardSim) => void) => {
      parts.push(p);
      const sim = exercise({ boards: [{ id: 'bb1', place: { x: 0, y: 0 }, title: 'Sandbox' }], parts: [...parts] });
      check(sim);
    };
    const kind = (sim: BreadboardSim) => sim.problems().map((p) => `${p.kind}:${p.part}`);
    stage({ id: 'U1', board: 'bb1', kind: 'chip', chip: '74LS00', col: 20 }, (s) => {
      expect(kind(s)).toEqual(['unpowered:U1']);
      expect(s.pinLevel('U1', '1Y')).toBe('Z');
    });
    // 74LS00 at column 20: 1A f20, 1B f21, 1Y f22, GND f26, VCC e20
    stage({ id: 'D2', board: 'bb1', kind: 'led', color: 'red', anode: 'i22', cathode: 'i30' }, (s) => expect(s.ledLit('D2')).toBe(false));
    stage({ id: 'W3', board: 'bb1', kind: 'wire', color: 'red', a: 'a20', b: 'tp21' }, (s) => expect(kind(s)).toEqual(['unpowered:U1']));
    stage({ id: 'W4', board: 'bb1', kind: 'wire', color: 'black', a: 'j26', b: 'bn27' }, (s) => {
      expect(kind(s)).toEqual([]); // powered: 1A, 1B float high, so 1Y = 0
      expect(s.pinLevel('U1', '1Y')).toBe(0);
      expect(s.ledLit('D2')).toBe(false); // cathode still in the air
    });
    stage({ id: 'R5', board: 'bb1', kind: 'resistor', ohms: 220, a: 'j30', b: 'bn30' }, (s) => expect(s.ledLit('D2')).toBe(false));
    stage({ id: 'SW6', board: 'bb1', kind: 'button', a: 'i10', b: 'i12' }, (s) => expect(s.ledLit('D2')).toBe(false));
    stage({ id: 'W7', board: 'bb1', kind: 'wire', color: 'black', a: 'j10', b: 'bn10' }, () => {});
    stage({ id: 'W8', board: 'bb1', kind: 'wire', color: 'white', a: 'j12', b: 'j20' }, (s) => {
      expect(s.ledLit('D2')).toBe(false);
      s.press('SW6'); // 1A to ground: 1Y = 1
      s.settle(100);
      expect(s.ledLit('D2')).toBe(true);
      s.release('SW6');
      s.settle(100);
      expect(s.ledLit('D2')).toBe(false);
      expect(kind(s)).toEqual([]);
    });
    // display at column 40: segment a is pin 7 (d43), the commons pins 3 and 8 (h42, d42)
    stage({ id: 'DS9', board: 'bb1', kind: 'seg7', col: 40, common: 'cathode' }, (s) => expect(s.seg7('DS9')).toBe(0));
    stage({ id: 'W10', board: 'bb1', kind: 'wire', color: 'red', a: 'a43', b: 'tp43' }, (s) => expect(s.seg7('DS9')).toBe(0)); // segment a high, common open
    stage({ id: 'W11', board: 'bb1', kind: 'wire', color: 'black', a: 'j42', b: 'bn43' }, (s) => {
      expect(s.seg7('DS9')).toBe(0x40);
      expect(kind(s)).toEqual([]);
    });
  });

  it('copes with layouts that are not valid: legs off the board, unknown boards, repeated ids, unknown chips', () => {
    const L = inverter((bb) => {
      bb.led('D1', 'red', 'h11', 'bn12');
    });
    const extra: Part[] = [
      { id: 'U2', board: 't', kind: 'chip', chip: '74LS04', col: 60 }, // pins 5-10 run off the end of the board
      { id: 'W2', board: 't', kind: 'wire', color: 'red', a: 'a60', b: 'tp61' }, // its VCC is wired
      { id: 'W1', board: 't', kind: 'wire', color: 'red', a: 'tp8', b: 'a50' }, // no rail hole at column 8
      { id: 'D2', board: 'elsewhere', kind: 'led', color: 'green', anode: 'tp3', cathode: 'tn3' },
      { id: 'D1', board: 't', kind: 'led', color: 'green', anode: 'tp21', cathode: 'tn21' }, // a second "D1"
      { id: 'U3', board: 't', kind: 'chip', chip: '74HC595', col: 40 },
      { id: 'DS1', board: 't', kind: 'seg7', col: 61, common: 'anode' }, // half off the board
      { id: 'SW1', board: 't', kind: 'dip', positions: 8, col: 58 }, // runs off the end
      { id: 'SW2', board: 'elsewhere', kind: 'button', a: 'a1', b: 'a3' },
      { id: 'SW3', board: 't', kind: 'slide', a: 'c62', common: 'c63', b: 'c64' },
      { id: 'P1', board: 't', kind: 'port', name: 'LOST', hole: 'k3', side: 'left' },
    ];
    const bad: Layout = { boards: L.boards, parts: [...L.parts, ...extra] };
    expect(validateLayout(bad).length).toBeGreaterThan(5);
    const sim = exercise(bad);
    sim.setPort('IN', 0);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(1);
    expect(sim.ledLit('D1')).toBe(true); // the first D1
    expect(sim.ledLit('D2')).toBe(false); // on a board that isn't there
    expect(sim.seg7('DS1')).toBe(0);
    expect(sim.level('t', 'a50')).toBe('Z'); // the wire from a missing hole connects nothing
    expect(sim.ports()).not.toContain('LOST');
    const p = sim.problems();
    expect(p.find((x) => x.part === 'U2')).toMatchObject({ kind: 'unpowered' });
    expect(p.find((x) => x.part === 'U2')!.message).toMatch(/pin 7 \(GND\) is not in a hole/);
    expect(p.find((x) => x.part === 'U3')).toMatchObject({ kind: 'unknown-chip' });
    for (const x of p) if (x.at) expect(x.at).toMatch(/^t:([a-j]|tp|tn|bp|bn)\d+$/);
    sim.setSlide('SW3', 1);
    sim.setDip('SW1', 0xff);
    sim.press('SW2');
    sim.settle(100);
    expect(sim.portLevel('OUT')).toBe(1);
  });

  it('copes with malformed parts from imported JSON', () => {
    const L = inverter();
    const weird = [
      { id: 'X1', board: 't', kind: 'flux-capacitor' },
      { id: 'W9', board: 't', kind: 'wire', color: 'red', a: 'a40' }, // no second end
      { id: 'D9', board: 't', kind: 'led', color: 'red', cathode: 'tn40' }, // no anode
      { id: 'U9', board: 't', kind: 'chip', chip: '74LS04' }, // no column
      { id: 'SW9', board: 't', kind: 'dip', col: 45 }, // no size
      { id: 'T1', board: 't', kind: 'text', text: 'hello', x: 3, y: 3 },
    ] as unknown as Part[];
    const sim = new BreadboardSim({ boards: L.boards, parts: [...L.parts, ...weird] });
    sim.setPort('IN', 0);
    settled(sim);
    expect(sim.portLevel('OUT')).toBe(1);
    expect(sim.ledLit('D9')).toBe(false);
    sim.setDip('SW9', 3);
    expect(sim.problems()).toMatchObject([{ kind: 'unpowered', part: 'U9' }]);
    for (const h of ALL_HOLES) sim.level('t', h);
  });

  it('simulates an empty layout and one without boards', () => {
    const empty = exercise({ boards: [{ id: 'bb1', place: { x: 0, y: 0 } }], parts: [] });
    expect(empty.problems()).toEqual([]);
    expect(empty.settle(10)).toEqual({ stable: true, steps: 0 });
    const none = new BreadboardSim({ boards: [], parts: [] });
    expect(none.level('bb1', 'a1')).toBe('Z');
    expect(none.problems()).toEqual([]);
    none.step(10);
    expect(none.time).toBe(10);
  });
});

describe("BreadboardSim: the TV Typewriter's MOS chips on +5 V and ground", () => {
  it('runs a 2513: the character on A4-A9 and the row on A1-A3 give its dots', () => {
    const L = board((bb) => {
      const U1 = bb.chip('U1', '2513', 10);
      bb.toVcc(U1.pin('VCC'));
      bb.toGnd(U1.pin('GND'));
      bb.toGnd(U1.pin('~CE'));
      // "A" (1), row 1: A1 and A4 high
      for (const a of ['A1', 'A4']) bb.toVcc(U1.pin(a));
      for (const a of ['A2', 'A3', 'A5', 'A6', 'A7', 'A8', 'A9']) bb.toGnd(U1.pin(a));
    });
    const sim = new BreadboardSim(L);
    expect(sim.problems()).toEqual([]);
    settled(sim);
    expect(['O5', 'O4', 'O3', 'O2', 'O1'].map((p) => sim.pinLevel('U1', p))).toEqual([0, 0, 1, 0, 0]);
  });
  it('powers a 2518 with its VGG pin on ground, for want of a ground pin, and sends 32 words round', () => {
    const L = board((bb) => {
      const U1 = bb.chip('U1', '2518', 10);
      bb.toVcc(U1.pin('VCC'));
      bb.toGnd(U1.pin('VGG'));
      bb.port('CLK', U1.free('CLK'), 'left');
      bb.port('REC', U1.free('REC'), 'left');
      bb.port('IN1', U1.free('IN1'), 'right');
      bb.port('OUT1', U1.free('OUT1'), 'right');
    });
    const sim = new BreadboardSim(L);
    expect(sim.problems()).toEqual([]);
    const pulse = () => {
      sim.setPort('CLK', 1);
      settled(sim);
      sim.setPort('CLK', 0);
      settled(sim);
    };
    sim.setPort('CLK', 0);
    sim.setPort('REC', 0);
    settled(sim);
    const bits = Array.from({ length: 32 }, (_, k) => ((k * 5) % 3 === 0 ? 1 : 0) as Level);
    for (const b of bits) {
      sim.setPort('IN1', b);
      pulse();
    }
    sim.setPort('REC', 1);
    sim.setPort('IN1', 0);
    const seen: Level[] = [];
    for (let k = 0; k < 64; k++) {
      seen.push(sim.portLevel('OUT1'));
      pulse();
    }
    expect(seen).toEqual([...bits, ...bits]);
  });
});
