import { describe, expect, it } from 'vitest';
import { CHIPS } from '../src/breadboard/catalog';
import { CHIP_MODELS, eepromImage, instantiateChip, levelsToNumber, peek2518, peekMemory, pokeMemory } from '../src/breadboard/sim/chips';
import { FONT_2513_CHART, code2513 } from '../src/breadboard/sim/font2513';
import type { ChipParams } from '../src/breadboard/sim/types';
import { Circuit, type Level, type Net } from '../src/logic/circuit';
import { DEC_DIGITS, displayEepromImage } from '../src/sim/display';
import { buildMicrocode, controlWordFromEeprom, microcodeEepromImage } from '../src/sim/microcode';
import { CO, MI } from '../src/sim/signals';

/**
 * A test bench: one chip in a real Circuit, every signal pin on its own net
 * that the test can drive (c.set) or release ('Z', the default).
 */
function bench(id: string, params: ChipParams = {}, opts: { free?: boolean } = {}) {
  const c = new Circuit();
  const nets: Record<string, Net> = {};
  for (const name of CHIPS[id].pins) if (name !== 'VCC' && name !== 'GND') nets[name] = c.input(`${id}.${name}`, 'Z');
  const comp = instantiateChip(c, CHIP_MODELS[id], nets, params);
  /** Free-running parts (an astable 555) never settle: `free` skips settling. */
  const settle = () => {
    if (opts.free) return;
    const r = c.settle(1000);
    expect(r.stable).toBe(true);
  };
  settle();
  const b = {
    c,
    comp,
    nets,
    /** Drive pins (Z releases) and settle. */
    set(levels: Record<string, Level>) {
      for (const [k, v] of Object.entries(levels)) {
        if (!nets[k]) throw new Error(`no pin ${k}`);
        c.set(nets[k], v);
      }
      settle();
      return b;
    },
    /** Drive pins names[0..] with the bits of value (LSB first). */
    bus(names: string[], value: number) {
      const l: Record<string, Level> = {};
      names.forEach((n, k) => (l[n] = ((value >> k) & 1) as Level));
      return b.set(l);
    },
    get: (name: string): Level => nets[name].value,
    gets: (names: string[]) => names.map((n) => nets[n].value),
    num: (names: string[]) => levelsToNumber(names.map((n) => nets[n].value)),
    /** Rising then falling edge. */
    pulse(name: string) {
      b.set({ [name]: 1 });
      b.set({ [name]: 0 });
      return b;
    },
  };
  return b;
}

/** Record every level change of a net, as [time, level]. */
function watch(c: Circuit, net: Net): [number, Level][] {
  const ev: [number, Level][] = [[c.time, net.value]];
  c.onChange(() => {
    if (net.value !== ev[ev.length - 1][1]) ev.push([c.time, net.value]);
  });
  return ev;
}

const names = (fmt: (k: number) => string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => fmt(from + k));

describe('chip models: catalog coverage', () => {
  it('every catalog chip has a model whose pins are real signal pins', () => {
    for (const chip of Object.values(CHIPS)) {
      const m = CHIP_MODELS[chip.id];
      expect(m, chip.id).toBeDefined();
      expect(m.id).toBe(chip.id);
      for (const p of [...m.inputs, ...m.outputs]) {
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(chip.pins.length);
        expect([chip.vcc, chip.gnd]).not.toContain(p);
      }
      expect(new Set(m.inputs).size).toBe(m.inputs.length);
      expect(new Set(m.outputs).size).toBe(m.outputs.length);
    }
  });
  it('MSI chips are slower than gates', () => {
    expect(CHIP_MODELS['74LS00'].delay).toBe(1);
    for (const id of ['74LS74', '74LS138', '74LS161', '74LS173', '74LS189', '74LS245', '74LS283', '28C16']) expect(CHIP_MODELS[id].delay).toBeGreaterThanOrEqual(2);
    expect(CHIP_MODELS['74LS161'].delay).toBe(3);
  });
});

describe('gates', () => {
  const tables: Record<string, (a: number, b: number) => number> = {
    '74LS00': (a, b) => 1 - (a & b),
    '74LS02': (a, b) => 1 - (a | b),
    '74LS08': (a, b) => a & b,
    '74LS32': (a, b) => a | b,
    '74LS86': (a, b) => a ^ b,
  };
  for (const [id, f] of Object.entries(tables)) {
    it(`${id} truth table, all four gates`, () => {
      const t = bench(id);
      for (let g = 1; g <= 4; g++)
        for (let a = 0; a < 2; a++)
          for (let bb = 0; bb < 2; bb++) {
            t.set({ [`${g}A`]: a as Level, [`${g}B`]: bb as Level });
            expect(t.get(`${g}Y`), `${id} gate ${g}: ${a},${bb}`).toBe(f(a, bb));
          }
    });
  }
  it('74LS04 inverts all six', () => {
    const t = bench('74LS04');
    for (let k = 1; k <= 6; k++) {
      t.set({ [`${k}A`]: 0 });
      expect(t.get(`${k}Y`)).toBe(1);
      t.set({ [`${k}A`]: 1 });
      expect(t.get(`${k}Y`)).toBe(0);
    }
  });
  it('floating inputs read high (LS-TTL), unknown propagates only where it matters', () => {
    const t = bench('74LS00');
    expect(t.get('1Y')).toBe(0); // both inputs float high
    t.set({ '1A': 'X' });
    expect(t.get('1Y')).toBe('X');
    t.set({ '1B': 0 });
    expect(t.get('1Y')).toBe(1); // a 0 decides a NAND
  });
  it('one gate delay', () => {
    const t = bench('74LS08');
    t.set({ '1A': 1, '1B': 1 });
    t.c.set(t.nets['1A'], 0);
    expect(t.get('1Y')).toBe(1);
    t.c.step();
    expect(t.get('1Y')).toBe(0);
  });
});

describe('74LS74 D flip-flop', () => {
  it('loads D on the rising edge only', () => {
    const t = bench('74LS74', {});
    t.set({ '1CLK': 0, '1D': 1 });
    expect(t.gets(['1Q', '~1Q'])).toEqual([0, 1]); // power-up 0
    t.set({ '1CLK': 1 });
    expect(t.gets(['1Q', '~1Q'])).toEqual([1, 0]);
    t.set({ '1D': 0 }); // D changes while CLK high: no effect
    expect(t.get('1Q')).toBe(1);
    t.set({ '1CLK': 0 }); // falling edge: no effect
    expect(t.get('1Q')).toBe(1);
    t.set({ '1CLK': 1 });
    expect(t.get('1Q')).toBe(0);
    expect(t.get('2Q')).toBe(0); // the other flip-flop is independent
  });
  it('async preset and clear; both low gives Q = ~Q = 1', () => {
    const t = bench('74LS74');
    t.set({ '~2PRE': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([1, 0]);
    t.set({ '~2PRE': 1, '~2CLR': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([0, 1]);
    t.set({ '2D': 1, '2CLK': 0 });
    t.set({ '2CLK': 1 }); // clear beats the clock
    expect(t.get('2Q')).toBe(0);
    t.set({ '~2PRE': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([1, 1]);
    t.set({ '~2CLR': 1 }); // preset still held
    expect(t.gets(['2Q', '~2Q'])).toEqual([1, 0]);
  });
  it('an unknown clock edge makes Q unknown only if D differs from Q', () => {
    const t = bench('74LS74');
    t.set({ '1CLK': 0, '1D': 0 });
    t.set({ '1CLK': 'X' });
    expect(t.get('1Q')).toBe(0); // D == Q: either way Q stays 0
    t.set({ '1CLK': 0, '1D': 1 });
    t.set({ '1CLK': 'X' });
    expect(t.gets(['1Q', '~1Q'])).toEqual(['X', 'X']);
    t.set({ '1CLK': 0 });
    t.set({ '1CLK': 1 }); // a real edge recovers
    expect(t.gets(['1Q', '~1Q'])).toEqual([1, 0]);
  });
});

describe('74LS76 / 74LS107 JK flip-flops', () => {
  it('74LS76: negative-edge JK truth table', () => {
    const t = bench('74LS76');
    t.set({ '~1CLK': 1, '1J': 1, '1K': 0 });
    expect(t.get('1Q')).toBe(0);
    t.set({ '~1CLK': 0 }); // falling edge: set
    expect(t.gets(['1Q', '~1Q'])).toEqual([1, 0]);
    t.set({ '~1CLK': 1, '1J': 0, '1K': 1 }); // rising edge: nothing
    expect(t.get('1Q')).toBe(1);
    t.set({ '~1CLK': 0 }); // reset
    expect(t.get('1Q')).toBe(0);
    t.set({ '~1CLK': 1, '1J': 0, '1K': 0 });
    t.set({ '~1CLK': 0 }); // hold
    expect(t.get('1Q')).toBe(0);
    t.set({ '1J': 1, '1K': 1 });
    const seq: Level[] = [];
    for (let k = 0; k < 4; k++) {
      t.pulse('~1CLK');
      seq.push(t.get('1Q'));
    }
    // pulse() is rise-then-fall, so each pulse is one falling edge: toggles
    expect(seq).toEqual([1, 0, 1, 0]);
  });
  it('74LS76: async preset / clear, both low gives Q = ~Q = 1', () => {
    const t = bench('74LS76');
    t.set({ '~2PRE': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([1, 0]);
    t.set({ '~2PRE': 1, '~2CLR': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([0, 1]);
    t.set({ '~2PRE': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([1, 1]);
  });
  it("74LS76 as Ben's display digit counter: ~Q outputs count 0,1,2,3 on falling clock edges", () => {
    // J=K=PRE=CLR=1 (floating = high), FF1 ~Q drives FF2's clock (pin 14 -> pin 6)
    const c = new Circuit();
    const clk = c.input('555', 1);
    const q1n = c.net('~1Q', 'Z');
    const q2n = c.net('~2Q', 'Z');
    instantiateChip(c, CHIP_MODELS['74LS76'], { '~1CLK': clk, '~1Q': q1n, '~2CLK': q1n, '~2Q': q2n });
    c.settle();
    const count = () => (q1n.value === 1 ? 1 : 0) | ((q2n.value === 1 ? 1 : 0) << 1);
    // power-up Q = 0, so ~Q = 1,1 = 3; each falling edge counts up
    const seen = [count()];
    for (let k = 0; k < 8; k++) {
      c.set(clk, 0);
      c.settle();
      seen.push(count());
      c.set(clk, 1);
      c.settle();
    }
    expect(seen).toEqual([3, 0, 1, 2, 3, 0, 1, 2, 3]);
  });
  it('74LS107: negative-edge JK with clear', () => {
    const t = bench('74LS107');
    t.set({ '~2CLK': 1, '2J': 1, '2K': 1 });
    t.set({ '~2CLK': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([1, 0]);
    t.set({ '~2CLK': 1 });
    expect(t.get('2Q')).toBe(1);
    t.set({ '~2CLK': 0 });
    expect(t.get('2Q')).toBe(0);
    t.set({ '1J': 1, '1K': 0, '~1CLK': 1 });
    t.set({ '~1CLK': 0 });
    expect(t.get('1Q')).toBe(1);
    t.set({ '~1CLR': 0 });
    expect(t.gets(['1Q', '~1Q'])).toEqual([0, 1]);
    t.set({ '~1CLK': 1 });
    t.set({ '~1CLK': 0 }); // clear held: no set
    expect(t.get('1Q')).toBe(0);
  });
});

describe('decoders and mux', () => {
  const Y = names((k) => `~Y${k}`, 0, 7);
  it('74LS138: one active-low output when enabled', () => {
    const t = bench('74LS138');
    t.set({ '~E1': 0, '~E2': 0, E3: 1 });
    for (let a = 0; a < 8; a++) {
      t.bus(['A0', 'A1', 'A2'], a);
      expect(t.num(Y)).toBe(0xff & ~(1 << a));
    }
    for (const dis of [{ '~E1': 1 }, { '~E2': 1 }, { E3: 0 }] as Record<string, Level>[]) {
      t.set({ '~E1': 0, '~E2': 0, E3: 1, ...dis });
      expect(t.num(Y)).toBe(0xff);
    }
  });
  it('74LS138: an unknown address bit leaves only the candidate outputs unknown', () => {
    const t = bench('74LS138');
    t.set({ '~E1': 0, '~E2': 0, E3: 1, A0: 'X', A1: 0, A2: 0 });
    expect(t.gets(Y)).toEqual(['X', 'X', 1, 1, 1, 1, 1, 1]);
  });
  it('74LS139: two independent 2-to-4 decoders', () => {
    const t = bench('74LS139');
    for (let a = 0; a < 4; a++) {
      t.set({ '~1E': 0, '~2E': 1 });
      t.bus(['1A0', '1A1'], a);
      expect(t.num(names((k) => `~1Y${k}`, 0, 3))).toBe(0xf & ~(1 << a));
      expect(t.num(names((k) => `~2Y${k}`, 0, 3))).toBe(0xf);
      t.set({ '~1E': 1, '~2E': 0 });
      t.bus(['2A0', '2A1'], 3 - a);
      expect(t.num(names((k) => `~1Y${k}`, 0, 3))).toBe(0xf);
      expect(t.num(names((k) => `~2Y${k}`, 0, 3))).toBe(0xf & ~(1 << (3 - a)));
    }
  });
  it('74LS157: S low selects I0, S high I1, ~E high forces low', () => {
    const t = bench('74LS157');
    const I0 = names((k) => `${k}I0`, 1, 4), I1 = names((k) => `${k}I1`, 1, 4), Yq = names((k) => `${k}Y`, 1, 4);
    t.bus(I0, 0b1010).bus(I1, 0b0110).set({ '~E': 0, S: 0 });
    expect(t.num(Yq)).toBe(0b1010);
    t.set({ S: 1 });
    expect(t.num(Yq)).toBe(0b0110);
    t.set({ '~E': 1 });
    expect(t.num(Yq)).toBe(0);
    t.set({ '~E': 0, S: 'X' }); // unknown select: only bits where I0 != I1 are unknown
    expect(t.gets(Yq)).toEqual([0, 1, 'X', 'X']);
  });
});

describe('74LS161 counter', () => {
  const Q = ['Q0', 'Q1', 'Q2', 'Q3'];
  const P = ['P0', 'P1', 'P2', 'P3'];
  it('counts on rising CP with CEP = CET = 1, wraps, TC at 15', () => {
    const t = bench('74LS161');
    t.set({ CP: 0, '~MR': 1, '~PE': 1, CEP: 1, CET: 1 });
    expect(t.num(Q)).toBe(0);
    for (let k = 1; k <= 17; k++) {
      t.set({ CP: 1 });
      expect(t.num(Q)).toBe(k & 15);
      expect(t.get('TC')).toBe((k & 15) === 15 ? 1 : 0);
      t.set({ CP: 0 });
      expect(t.num(Q)).toBe(k & 15); // falling edge does nothing
    }
  });
  it('TC needs CET; CEP or CET low holds', () => {
    const t = bench('74LS161');
    t.set({ CP: 0, '~PE': 0 }).bus(P, 15).pulse('CP').set({ '~PE': 1, CEP: 1, CET: 1 });
    expect(t.num(Q)).toBe(15);
    expect(t.get('TC')).toBe(1);
    t.set({ CET: 0 });
    expect(t.get('TC')).toBe(0);
    t.pulse('CP');
    expect(t.num(Q)).toBe(15);
    t.set({ CET: 1, CEP: 0 });
    expect(t.get('TC')).toBe(1); // TC ignores CEP
    t.pulse('CP');
    expect(t.num(Q)).toBe(15);
  });
  it('~PE load is synchronous and beats counting', () => {
    const t = bench('74LS161');
    t.set({ CP: 0, CEP: 1, CET: 1, '~PE': 0 }).bus(P, 9);
    expect(t.num(Q)).toBe(0); // no clock yet: synchronous
    t.set({ CP: 1 });
    expect(t.num(Q)).toBe(9); // loaded, not counted
    t.set({ CP: 0, '~PE': 1 }).set({ CP: 1 });
    expect(t.num(Q)).toBe(10);
  });
  it('~MR clears at once, without a clock, and holds the counter at 0', () => {
    const t = bench('74LS161');
    t.set({ CP: 0, CEP: 1, CET: 1, '~PE': 1 }).pulse('CP').pulse('CP').pulse('CP');
    expect(t.num(Q)).toBe(3);
    t.set({ '~MR': 0 });
    expect(t.num(Q)).toBe(0);
    t.pulse('CP');
    expect(t.num(Q)).toBe(0);
    t.set({ '~MR': 1 }).pulse('CP');
    expect(t.num(Q)).toBe(1);
  });
  it('an unknown clock edge makes the count unknown; ~MR recovers it', () => {
    const t = bench('74LS161');
    t.set({ CP: 0, CEP: 1, CET: 1, '~PE': 1 }).set({ CP: 'X' });
    expect(t.gets(Q)).toEqual(['X', 0, 0, 0]); // 0 or 1
    t.set({ CP: 0 }).set({ CP: 1 });
    expect(t.gets(Q)).toEqual(['X', 'X', 0, 0]); // 1 or 2
    t.set({ '~MR': 0 });
    expect(t.num(Q)).toBe(0);
  });
  it('three gate delays from CP to Q', () => {
    const t = bench('74LS161');
    t.set({ CP: 0, CEP: 1, CET: 1, '~PE': 1 });
    t.c.set(t.nets.CP, 1);
    t.c.run(2);
    expect(t.get('Q0')).toBe(0);
    t.c.step();
    expect(t.get('Q0')).toBe(1);
  });
});

describe('74LS173 register', () => {
  const Q = ['Q0', 'Q1', 'Q2', 'Q3'];
  const D = ['D0', 'D1', 'D2', 'D3'];
  it('loads on rising CP only when ~G1 = ~G2 = 0', () => {
    const t = bench('74LS173');
    t.set({ CP: 0, MR: 0, '~M': 0, '~N': 0, '~G1': 0, '~G2': 1 }).bus(D, 0b1011);
    t.pulse('CP');
    expect(t.num(Q)).toBe(0);
    t.set({ '~G1': 1, '~G2': 0 }).pulse('CP');
    expect(t.num(Q)).toBe(0);
    t.set({ '~G1': 0, '~G2': 0 });
    expect(t.num(Q)).toBe(0);
    t.set({ CP: 1 });
    expect(t.num(Q)).toBe(0b1011);
    t.bus(D, 0b0100).set({ CP: 0 });
    expect(t.num(Q)).toBe(0b1011);
  });
  it('MR (active high) clears at once', () => {
    const t = bench('74LS173');
    t.set({ CP: 0, MR: 0, '~M': 0, '~N': 0, '~G1': 0, '~G2': 0 }).bus(D, 15).pulse('CP');
    expect(t.num(Q)).toBe(15);
    t.set({ MR: 1 });
    expect(t.num(Q)).toBe(0);
    t.pulse('CP');
    expect(t.num(Q)).toBe(0);
  });
  it('3-state outputs: ~M or ~N high releases them, the register still loads', () => {
    const t = bench('74LS173');
    t.set({ CP: 0, MR: 0, '~M': 0, '~N': 0, '~G1': 0, '~G2': 0 }).bus(D, 0b0110).pulse('CP');
    expect(t.num(Q)).toBe(0b0110);
    t.set({ '~M': 1 });
    expect(t.gets(Q)).toEqual(['Z', 'Z', 'Z', 'Z']);
    t.set({ '~M': 0, '~N': 1 });
    expect(t.gets(Q)).toEqual(['Z', 'Z', 'Z', 'Z']);
    t.bus(D, 0b1001).pulse('CP');
    t.set({ '~N': 0 });
    expect(t.num(Q)).toBe(0b1001);
  });
});

describe('74LS189 RAM', () => {
  const A = ['A0', 'A1', 'A2', 'A3'];
  const D = ['D1', 'D2', 'D3', 'D4'];
  const O = ['~O1', '~O2', '~O3', '~O4'];
  it('outputs show the complement of the stored word', () => {
    const t = bench('74LS189');
    t.set({ '~CS': 0, '~WE': 1 }).bus(A, 0);
    expect(t.num(O)).toBe(0b1111); // powered up as 0
    t.bus(D, 0b1001).set({ '~WE': 0 });
    expect(t.gets(O)).toEqual(['Z', 'Z', 'Z', 'Z']); // released during a write
    t.set({ '~WE': 1 });
    expect(t.num(O)).toBe(0b0110);
    expect(peekMemory(t.comp.state, 0)).toEqual([1, 0, 0, 1]);
  });
  it('16 independent words', () => {
    const t = bench('74LS189');
    t.set({ '~CS': 0, '~WE': 1 });
    for (let a = 0; a < 16; a++) {
      t.bus(A, a).bus(D, (a * 7) & 15).set({ '~WE': 0 }).set({ '~WE': 1 });
    }
    for (let a = 0; a < 16; a++) {
      t.bus(A, a);
      expect(t.num(O)).toBe(~(a * 7) & 15);
    }
  });
  it('writes are level-sensitive: the data present when ~WE rises is kept', () => {
    const t = bench('74LS189');
    t.set({ '~CS': 0, '~WE': 1 }).bus(A, 5).bus(D, 1).set({ '~WE': 0 }).bus(D, 12).set({ '~WE': 1 });
    expect(t.num(O)).toBe(~12 & 15);
  });
  it('~CS high releases the outputs and blocks writes', () => {
    const t = bench('74LS189');
    t.set({ '~CS': 1, '~WE': 1 }).bus(A, 3);
    expect(t.gets(O)).toEqual(['Z', 'Z', 'Z', 'Z']);
    t.bus(D, 0b1111).set({ '~WE': 0 }).set({ '~WE': 1, '~CS': 0 });
    expect(t.num(O)).toBe(0b1111); // still 0 stored
  });
  it('a write to an unknown address leaves only the candidate words uncertain', () => {
    const t = bench('74LS189');
    t.set({ '~CS': 0, '~WE': 1, A0: 'X', A1: 0, A2: 0, A3: 0 }).bus(D, 0b1010).set({ '~WE': 0 }).set({ '~WE': 1 });
    t.bus(A, 0);
    expect(t.gets(O)).toEqual([1, 'X', 1, 'X']);
    t.bus(A, 1);
    expect(t.gets(O)).toEqual([1, 'X', 1, 'X']);
    t.bus(A, 2);
    expect(t.num(O)).toBe(0b1111);
  });
  it('pokeMemory preloads a word', () => {
    const t = bench('74LS189');
    expect(pokeMemory(t.comp.state, 7, 0b0011)).toBe(true);
    t.set({ '~CS': 0, '~WE': 1 }).bus(A, 7);
    expect(t.num(O)).toBe(0b1100);
  });
});

describe('74LS245 transceiver', () => {
  const A = names((k) => `A${k}`, 1, 8);
  const B = names((k) => `B${k}`, 1, 8);
  it('DIR high drives B from A, DIR low drives A from B, ~OE high releases both', () => {
    const t = bench('74LS245');
    t.set({ '~OE': 0, DIR: 1 }).bus(A, 0xa5);
    expect(t.num(B)).toBe(0xa5);
    t.bus(A, 0x3c);
    expect(t.num(B)).toBe(0x3c);
    // turn around: release A, drive B
    t.set({ '~OE': 1 });
    expect(t.gets(B).every((l) => l === 'Z')).toBe(true);
    for (const n of A) t.set({ [n]: 'Z' });
    expect(t.gets(A).every((l) => l === 'Z')).toBe(true);
    t.bus(B, 0x81).set({ DIR: 0, '~OE': 0 });
    expect(t.num(A)).toBe(0x81);
    t.set({ '~OE': 1 });
    expect(t.gets(A).every((l) => l === 'Z')).toBe(true);
  });
  it('the input side is not driven (A side reads the external bus)', () => {
    const t = bench('74LS245');
    t.set({ '~OE': 0, DIR: 1 });
    // A pins float: read high by the chip (B = 0xFF) but the nets stay Z
    expect(t.gets(A).every((l) => l === 'Z')).toBe(true);
    expect(t.num(B)).toBe(0xff);
  });
  it('drives a shared bus: two 245s on one bus, one enabled at a time', () => {
    const c = new Circuit();
    const bus = names((k) => `BUS${k}`, 0, 7).map((n) => c.net(n, 'Z'));
    const reg1 = names((k) => `r1.${k}`, 0, 7).map((n) => c.input(n, 0));
    const reg2 = names((k) => `r2.${k}`, 0, 7).map((n) => c.input(n, 0));
    const oe1 = c.input('~AO', 1), oe2 = c.input('~EO', 1);
    const wire = (reg: Net[], oe: Net) => {
      const pins: Record<string, Net> = { '~OE': oe };
      reg.forEach((n, k) => (pins[`A${k + 1}`] = n));
      bus.forEach((n, k) => (pins[`B${k + 1}`] = n));
      instantiateChip(c, CHIP_MODELS['74LS245'], pins); // DIR floats high: A -> B
    };
    wire(reg1, oe1);
    wire(reg2, oe2);
    reg1.forEach((n, k) => c.set(n, ((0x42 >> k) & 1) as Level));
    reg2.forEach((n, k) => c.set(n, ((0x17 >> k) & 1) as Level));
    c.settle();
    expect(bus.every((n) => n.value === 'Z')).toBe(true);
    c.set(oe1, 0);
    c.settle();
    expect(levelsToNumber(bus.map((n) => n.value))).toBe(0x42);
    c.set(oe1, 1);
    c.set(oe2, 0);
    c.settle();
    expect(levelsToNumber(bus.map((n) => n.value))).toBe(0x17);
    c.set(oe1, 0); // both: contention where the values differ
    c.settle();
    const differ = 0x42 ^ 0x17;
    expect(bus.map((n) => n.value)).toEqual(Array.from({ length: 8 }, (_, k) => ((differ >> k) & 1 ? 'X' : (0x42 >> k) & 1)));
  });
});

describe('74LS273 octal register', () => {
  const D = names((k) => `D${k}`, 0, 7), Q = names((k) => `Q${k}`, 0, 7);
  it('loads on rising CP, ~MR clears at once', () => {
    const t = bench('74LS273');
    t.set({ CP: 0, '~MR': 1 }).bus(D, 0xc3);
    expect(t.num(Q)).toBe(0);
    t.set({ CP: 1 });
    expect(t.num(Q)).toBe(0xc3);
    t.bus(D, 0x11).set({ CP: 0 });
    expect(t.num(Q)).toBe(0xc3);
    t.pulse('CP');
    expect(t.num(Q)).toBe(0x11);
    t.set({ '~MR': 0 });
    expect(t.num(Q)).toBe(0);
    t.pulse('CP');
    expect(t.num(Q)).toBe(0);
  });
});

describe('74LS283 adder', () => {
  const A = names((k) => `A${k}`, 1, 4), B = names((k) => `B${k}`, 1, 4), S = names((k) => `S${k}`, 1, 4);
  it('exhaustive: S = A + B + C0, C4 carry', () => {
    const t = bench('74LS283');
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++)
        for (let c0 = 0; c0 < 2; c0++) {
          t.bus(A, a).bus(B, b).set({ C0: c0 as Level });
          const sum = a + b + c0;
          expect(t.num(S)).toBe(sum & 15);
          expect(t.get('C4')).toBe(sum >> 4);
        }
  });
  it("Ben's 8-bit ALU: two 283s (C4 -> C0) and XOR gates subtract", () => {
    const c = new Circuit();
    const a = names((k) => `A${k}`, 0, 7).map((n) => c.input(n, 0));
    const b = names((k) => `B${k}`, 0, 7).map((n) => c.input(n, 0));
    const su = c.input('SU', 0);
    const bx = names((k) => `BX${k}`, 0, 7).map((n) => c.net(n, 'Z'));
    const sum = names((k) => `S${k}`, 0, 7).map((n) => c.net(n, 'Z'));
    const mid = c.net('C', 'Z'), carry = c.net('CARRY', 'Z');
    for (let x = 0; x < 2; x++) {
      const pins: Record<string, Net> = {};
      for (let g = 0; g < 4; g++) Object.assign(pins, { [`${g + 1}A`]: b[4 * x + g], [`${g + 1}B`]: su, [`${g + 1}Y`]: bx[4 * x + g] });
      instantiateChip(c, CHIP_MODELS['74LS86'], pins);
      const add: Record<string, Net> = { C0: x ? mid : su, C4: x ? carry : mid };
      for (let k = 0; k < 4; k++) Object.assign(add, { [`A${k + 1}`]: a[4 * x + k], [`B${k + 1}`]: bx[4 * x + k], [`S${k + 1}`]: sum[4 * x + k] });
      instantiateChip(c, CHIP_MODELS['74LS283'], add);
    }
    const run = (va: number, vb: number, sub: 0 | 1) => {
      a.forEach((n, k) => c.set(n, ((va >> k) & 1) as Level));
      b.forEach((n, k) => c.set(n, ((vb >> k) & 1) as Level));
      c.set(su, sub);
      expect(c.settle().stable).toBe(true);
      return [levelsToNumber(sum.map((n) => n.value)), carry.value];
    };
    expect(run(28, 14, 0)).toEqual([42, 0]);
    expect(run(250, 10, 0)).toEqual([4, 1]);
    expect(run(42, 14, 1)).toEqual([28, 1]); // no borrow = carry
    expect(run(14, 42, 1)).toEqual([(256 + 14 - 42) & 255, 0]);
  });
});

describe('28C16 EEPROM', () => {
  const A = names((k) => `A${k}`, 0, 10);
  const IO = names((k) => `IO${k}`, 0, 7);
  const read = (t: ReturnType<typeof bench>, addr: number) => t.set({ '~CE': 0, '~OE': 0, '~WE': 1 }).bus(A, addr).num(IO);

  it('microcode image: the bytes Ben reads at 0x000 and 0x080', () => {
    const t = bench('28C16', { image: 'microcode' });
    expect(read(t, 0x000)).toBe(0x40); // MI (high byte of MI|CO)
    expect(read(t, 0x080)).toBe(0x04); // CO (low byte)
    // every address matches src/sim/microcode.ts
    const img = microcodeEepromImage(buildMicrocode());
    for (const addr of [0x001, 0x009, 0x00a, 0x0f2, 0x172, 0x38a, 0x3ff]) expect(read(t, addr)).toBe(img[addr]);
    expect(controlWordFromEeprom(img, 0, 0, 0)).toBe(MI | CO);
  });
  it('display image: ones / tens / hundreds digits and the sign', () => {
    const t = bench('28C16', { image: 'display' });
    const img = displayEepromImage();
    expect(read(t, 123)).toBe(DEC_DIGITS[3]);
    expect(read(t, 256 + 123)).toBe(DEC_DIGITS[2]);
    expect(read(t, 512 + 123)).toBe(DEC_DIGITS[1]);
    expect(read(t, 1792 + 0xff)).toBe(img[1792 + 0xff]); // -1: minus sign
  });
  it("hex image: Ben's common-anode table in the low 16 bytes, the rest erased", () => {
    const t = bench('28C16', { image: 'hex' });
    const ben = [0x81, 0xcf, 0x92, 0x86, 0xcc, 0xa4, 0xa0, 0x8f, 0x80, 0x84, 0x88, 0xe0, 0xb1, 0xc2, 0xb0, 0xb8];
    for (let d = 0; d < 16; d++) expect(read(t, d)).toBe(ben[d]);
    expect(read(t, 16)).toBe(0xff);
    expect(read(t, 0x7ff)).toBe(0xff);
  });
  it('blank and explicit images', () => {
    expect(read(bench('28C16'), 0x123)).toBe(0xff);
    expect(read(bench('28C16', { image: 'blank' }), 0)).toBe(0xff);
    const t = bench('28C16', { image: [1, 2, 3] });
    expect([read(t, 0), read(t, 1), read(t, 2), read(t, 3)]).toEqual([1, 2, 3, 0xff]);
    expect(() => eepromImage('nope')).toThrow(/unknown image/);
  });
  it('outputs only while ~CE and ~OE are low and ~WE is high', () => {
    const t = bench('28C16', { image: 'hex' });
    expect(read(t, 0)).toBe(0x81);
    t.set({ '~OE': 1 });
    expect(t.gets(IO).every((l) => l === 'Z')).toBe(true);
    t.set({ '~OE': 0, '~CE': 1 });
    expect(t.gets(IO).every((l) => l === 'Z')).toBe(true);
    t.set({ '~CE': 0, '~WE': 0 });
    expect(t.gets(IO).every((l) => l === 'Z')).toBe(true);
  });
  it('writes the IO byte while ~WE is low (~CE low, ~OE high); each part keeps its own contents', () => {
    const c = new Circuit();
    const shared: Record<string, Net> = {};
    for (const name of CHIPS['28C16'].pins) if (name !== 'VCC' && name !== 'GND') shared[name] = c.input(name, 'Z');
    const u1 = instantiateChip(c, CHIP_MODELS['28C16'], shared, { image: 'hex' });
    const io2 = IO.map((n) => c.net(`u2.${n}`, 'Z'));
    const u2pins: Record<string, Net> = { ...shared };
    IO.forEach((n, k) => (u2pins[n] = io2[k]));
    const u2 = instantiateChip(c, CHIP_MODELS['28C16'], u2pins, { image: 'hex' });
    const set = (l: Record<string, Level>) => {
      for (const [k, v] of Object.entries(l)) c.set(shared[k], v);
      c.settle();
    };
    A.forEach((n, k) => set({ [n]: ((0x005 >> k) & 1) as Level }));
    set({ '~CE': 0, '~OE': 1, '~WE': 1 });
    IO.forEach((n, k) => set({ [n]: ((0x5a >> k) & 1) as Level }));
    set({ '~WE': 0 });
    set({ '~WE': 1 });
    IO.forEach((n) => set({ [n]: 'Z' }));
    // u1 saw the data on its IO pins; u2's IO pins are on their own nets (floating = 0xFF)
    expect(peekMemory(u1.state, 5)).toEqual([0, 1, 0, 1, 1, 0, 1, 0]);
    expect(levelsToNumber(peekMemory(u2.state, 5)!)).toBe(0xff);
    set({ '~OE': 0 });
    expect(levelsToNumber(IO.map((n) => shared[n].value))).toBe(0x5a);
    expect(levelsToNumber(io2.map((n) => n.value))).toBe(0xff);
    // the preset image itself is untouched
    expect(eepromImage('hex')[5]).toBe(0xa4);
  });
  it('~OE low inhibits writes', () => {
    const t = bench('28C16', { image: 'blank' });
    t.set({ '~CE': 0, '~OE': 0, '~WE': 1 }).bus(A, 9);
    t.set({ '~WE': 0 }).bus(IO, 0x00).set({ '~WE': 1 });
    for (const n of IO) t.set({ [n]: 'Z' });
    expect(read(t, 9)).toBe(0xff);
  });
  it('a fully unknown address still reads a known byte when every candidate agrees', () => {
    const t = bench('28C16', { image: 'blank' });
    t.set({ '~CE': 0, '~OE': 0, '~WE': 1 });
    for (const n of A) t.set({ [n]: 'X' });
    expect(t.num(IO)).toBe(0xff); // 2048 worlds, all 0xFF
  });
  it('an unknown address bit gives unknown data bits only where the candidates differ', () => {
    const t = bench('28C16', { image: [0b1100, 0b1010] });
    t.set({ '~CE': 0, '~OE': 0, '~WE': 1 }).bus(A, 0).set({ A0: 'X' });
    expect(t.gets(IO.slice(0, 4))).toEqual([0, 'X', 'X', 1]);
  });
});

describe('NE555 timer', () => {
  it('astable: toggles every halfPeriod gate delays, DIS follows the inverted output', () => {
    const t = bench('NE555', { mode: 'astable', halfPeriod: 10 }, { free: true });
    const ev = watch(t.c, t.nets.OUT);
    const dis: Level[] = [];
    t.c.onChange(() => dis.push(t.nets.OUT.value === 1 ? (t.nets.DIS.value === 'Z' ? 1 : 0) : t.nets.DIS.value === 0 ? 1 : 0));
    t.c.run(200);
    const rises = ev.filter(([, l]) => l === 1).map(([tm]) => tm);
    const falls = ev.filter(([, l]) => l === 0).map(([tm]) => tm);
    expect(rises.length).toBeGreaterThan(5);
    for (let k = 1; k < rises.length; k++) expect(rises[k] - rises[k - 1]).toBe(20);
    const r = rises[2];
    expect(falls.find((f) => f > r)! - r).toBe(10);
    expect(dis.every((ok) => ok === 1)).toBe(true);
  });
  it('astable: separate high and low times', () => {
    const t = bench('NE555', { highTime: 14, lowTime: 6 }, { free: true });
    const ev = watch(t.c, t.nets.OUT);
    t.c.run(200);
    const edges = ev.slice(3);
    for (let k = 1; k < edges.length; k++) expect(edges[k][0] - edges[k - 1][0]).toBe(edges[k - 1][1] === 1 ? 14 : 6);
  });
  it('astable: changing params.halfPeriod at run time changes the next half periods (speed pot)', () => {
    const params: ChipParams = { halfPeriod: 10 };
    const t = bench('NE555', params, { free: true });
    t.c.run(50);
    params.halfPeriod = 25;
    const ev = watch(t.c, t.nets.OUT);
    t.c.run(200);
    const gaps = ev.slice(2).map(([tm], k) => tm - ev[k + 1][0]);
    expect(gaps.every((g) => g === 25)).toBe(true);
    expect(gaps.length).toBeGreaterThan(4);
  });
  it('~RESET low forces OUT low with no glitches, release restarts high', () => {
    const t = bench('NE555', { halfPeriod: 10 }, { free: true });
    t.c.run(15); // low phase, with the next rise pending at 21
    t.c.set(t.nets['~RESET'], 0);
    t.c.step();
    for (let k = 0; k < 60; k++) {
      expect(t.get('OUT')).toBe(0);
      expect(t.get('DIS')).toBe(0);
      t.c.step();
    }
    t.c.set(t.nets['~RESET'], 1);
    const ev = watch(t.c, t.nets.OUT);
    t.c.run(45);
    expect(ev.map(([tm, l]) => [tm - ev[0][0], l])).toEqual([[0, 0], [1, 1], [11, 0], [21, 1], [31, 0], [41, 1]]);
  });
  it('monostable: a short trigger gives one pulseWidth-long pulse', () => {
    const t = bench('NE555', { mode: 'monostable', pulseWidth: 30 });
    t.set({ TRIG: 1 });
    expect(t.get('OUT')).toBe(0);
    const ev = watch(t.c, t.nets.OUT);
    t.c.set(t.nets.TRIG, 0);
    t.c.run(3);
    t.c.set(t.nets.TRIG, 1);
    t.c.run(100);
    expect(ev.map(([tm, l]) => [tm - ev[0][0], l])).toEqual([[0, 0], [1, 1], [31, 0]]);
  });
  it('monostable: not retriggerable, and a held trigger keeps OUT high until released', () => {
    const t = bench('NE555', { mode: 'monostable', pulseWidth: 30 });
    t.set({ TRIG: 1 });
    const ev = watch(t.c, t.nets.OUT);
    t.c.set(t.nets.TRIG, 0);
    t.c.run(2);
    t.c.set(t.nets.TRIG, 1);
    t.c.run(10);
    t.c.set(t.nets.TRIG, 0); // second press during the pulse
    t.c.run(2);
    t.c.set(t.nets.TRIG, 1);
    t.c.run(60);
    expect(ev.map(([tm, l]) => [tm - ev[0][0], l])).toEqual([[0, 0], [1, 1], [31, 0]]);
    // held for 80: high until released
    const t0 = t.c.time;
    t.c.set(t.nets.TRIG, 0);
    t.c.run(80);
    expect(t.get('OUT')).toBe(1);
    t.c.set(t.nets.TRIG, 1);
    t.c.run(5);
    expect(t.get('OUT')).toBe(0);
    expect(ev.slice(3).map(([tm, l]) => [tm - t0, l])).toEqual([[1, 1], [81, 0]]);
  });
  it('monostable: ~RESET ends a pulse', () => {
    const t = bench('NE555', { mode: 'monostable', pulseWidth: 30 });
    t.set({ TRIG: 1 }).set({ TRIG: 0 });
    t.c.set(t.nets.TRIG, 1); // released: the pulse end is now pending
    t.c.run(5);
    expect(t.get('OUT')).toBe(1);
    t.set({ '~RESET': 0 });
    expect(t.get('OUT')).toBe(0);
    t.set({ '~RESET': 1 });
    t.c.run(60);
    expect(t.get('OUT')).toBe(0);
  });
  it("bistable (Ben's mode switch): TRIG low sets, ~RESET low resets, reset wins", () => {
    const t = bench('NE555', { mode: 'bistable' });
    t.set({ TRIG: 1, '~RESET': 1 });
    expect(t.get('OUT')).toBe(0);
    t.set({ TRIG: 0 });
    expect(t.get('OUT')).toBe(1);
    expect(t.get('DIS')).toBe('Z');
    t.set({ TRIG: 1 });
    expect(t.get('OUT')).toBe(1);
    t.set({ '~RESET': 0 });
    expect(t.get('OUT')).toBe(0);
    expect(t.get('DIS')).toBe(0);
    t.set({ TRIG: 0 });
    expect(t.get('OUT')).toBe(0); // reset wins
    t.set({ '~RESET': 1 });
    expect(t.get('OUT')).toBe(1); // trigger still low
    t.set({ TRIG: 1 });
    expect(t.get('OUT')).toBe(1);
  });
});

/** A 74LS90 or 74LS92 with Q0 wired to ~CP1, as Ben uses them, clocked on ~CP0. */
function rippleCounter(id: '74LS90' | '74LS92') {
  const c = new Circuit();
  const clk = c.input('clk', 1), mr = c.input('mr', 0), ms = c.input('ms', 0);
  const q = [0, 1, 2, 3].map((k) => c.net(`Q${k}`, 'Z'));
  const pins: Record<string, Net> = { '~CP0': clk, '~CP1': q[0], Q0: q[0], Q1: q[1], Q2: q[2], Q3: q[3], MR1: mr, MR2: mr };
  if (id === '74LS90') Object.assign(pins, { MS1: ms, MS2: ms });
  instantiateChip(c, CHIP_MODELS[id], pins);
  c.settle();
  const set = (n: Net, v: Level) => {
    c.set(n, v);
    c.settle();
  };
  return {
    c, clk, mr, ms, q, set,
    count: () => levelsToNumber(q.map((n) => n.value)),
    /** Clock low then high again: one count. */
    tick: () => (set(clk, 0), set(clk, 1)),
  };
}

describe('clock counters: 74LS90 and 74LS92', () => {
  it('74LS90 counts BCD 0..9 on falling edges and wraps, Q3 falling as 9 goes to 0', () => {
    const t = rippleCounter('74LS90');
    const seen: (number | null)[] = [];
    let q3Falls = 0;
    for (let k = 0; k < 12; k++) {
      t.set(t.clk, 0);
      const before = t.count();
      t.set(t.clk, 1);
      expect(t.count(), 'the rising edge does nothing').toBe(before);
      seen.push(before);
      if (before === 0) q3Falls++;
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]);
    expect(q3Falls).toBe(1);
  });
  it('74LS90: MR1 = MR2 = 1 clears at once and holds; MS1 = MS2 = 1 sets 9 and beats MR', () => {
    const t = rippleCounter('74LS90');
    for (let k = 0; k < 6; k++) t.tick();
    expect(t.count()).toBe(6);
    t.set(t.mr, 1);
    expect(t.count()).toBe(0);
    t.tick();
    expect(t.count(), 'held at 0 while MR is high').toBe(0);
    t.set(t.ms, 1);
    expect(t.count()).toBe(9);
    t.set(t.ms, 0);
    expect(t.count(), 'MS released with MR still high: cleared').toBe(0);
    t.set(t.mr, 0);
    t.tick();
    expect(t.count()).toBe(1);
  });
  it('74LS90 sections on their own: ÷2 on Q0, ÷5 on Q1-Q3', () => {
    const t = bench('74LS90');
    expect(t.num(['Q0', 'Q1', 'Q2', 'Q3']), 'MS1 and MS2 float high: set to 9').toBe(9);
    t.set({ MS1: 0, MS2: 0, MR1: 1, MR2: 1, '~CP0': 1, '~CP1': 1 }).set({ MR1: 0, MR2: 0 });
    const five: (number | null)[] = [];
    for (let k = 0; k < 6; k++) {
      t.pulse('~CP1').set({ '~CP1': 1 });
      five.push(t.num(['Q1', 'Q2', 'Q3']));
    }
    expect(five).toEqual([1, 2, 3, 4, 0, 1]);
    expect(t.get('Q0')).toBe(0);
    t.pulse('~CP0').set({ '~CP0': 1 });
    expect(t.get('Q0')).toBe(1);
  });
  it("74LS92 counts the datasheet's divide-by-12 sequence: Q0-Q2 go 0..5 twice, Q3 is ÷12", () => {
    const t = rippleCounter('74LS92');
    const seen: (number | null)[] = [];
    for (let k = 0; k < 13; k++) {
      t.tick();
      seen.push(t.count());
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 0, 1]);
    expect(seen.map((n) => n! & 7)).toEqual([1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1]);
    t.set(t.mr, 1);
    expect(t.count()).toBe(0);
  });
  it('the 60 Hz divider of clock part 3: 74LS90 (÷10) into a 74LS92 (÷6), one pulse on Q2 per 60', () => {
    const c = new Circuit();
    const hz60 = c.input('60hz', 1), gnd = c.input('gnd', 0);
    const a = [0, 1, 2, 3].map((k) => c.net(`a${k}`, 'Z')), b = [0, 1, 2, 3].map((k) => c.net(`b${k}`, 'Z'));
    instantiateChip(c, CHIP_MODELS['74LS90'], { '~CP0': hz60, '~CP1': a[0], Q0: a[0], Q1: a[1], Q2: a[2], Q3: a[3], MR1: gnd, MR2: gnd, MS1: gnd, MS2: gnd });
    instantiateChip(c, CHIP_MODELS['74LS92'], { '~CP0': a[3], '~CP1': b[0], Q0: b[0], Q1: b[1], Q2: b[2], Q3: b[3], MR1: gnd, MR2: gnd });
    c.settle();
    let falls = 0;
    for (let k = 0; k < 180; k++) {
      const was = b[2].value;
      c.set(hz60, 0);
      c.settle();
      c.set(hz60, 1);
      c.settle();
      if (was === 1 && b[2].value === 0) falls++;
    }
    expect(falls, '3 seconds of 60 Hz: 3 falling edges of the 1 Hz output').toBe(3);
  });
});

describe('74LS85 comparator', () => {
  const A = ['A0', 'A1', 'A2', 'A3'], B = ['B0', 'B1', 'B2', 'B3'];
  it('compares every pair of 4-bit numbers (cascading inputs at A = B)', () => {
    const t = bench('74LS85');
    t.set({ 'IA>B': 0, 'IA<B': 0, 'IA=B': 1 });
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        t.bus(A, a).bus(B, b);
        expect(t.gets(['A>B', 'A<B', 'A=B']), `${a} vs ${b}`).toEqual([a > b ? 1 : 0, a < b ? 1 : 0, a === b ? 1 : 0]);
      }
  });
  it("equal words pass the cascading inputs on, as in the datasheet's function table", () => {
    const t = bench('74LS85');
    t.bus(A, 9).bus(B, 9);
    const row = (gt: Level, lt: Level, eq: Level) => t.set({ 'IA>B': gt, 'IA<B': lt, 'IA=B': eq }).gets(['A>B', 'A<B', 'A=B']);
    expect(row(1, 0, 0)).toEqual([1, 0, 0]);
    expect(row(0, 1, 0)).toEqual([0, 1, 0]);
    expect(row(1, 1, 1)).toEqual([0, 0, 1]);
    expect(row(1, 1, 0)).toEqual([0, 0, 0]);
    expect(row(0, 0, 0)).toEqual([1, 1, 0]);
  });
});

describe('CD4511 BCD to 7-segment decoder', () => {
  const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  // the datasheet's truth table, a..g
  const TABLE = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '0011111', '1110000', '1111111', '1110011'];
  it("decodes 0-9 like the datasheet (6 and 9 without tails) and blanks 10-15", () => {
    const t = bench('CD4511');
    t.set({ '~LT': 1, '~BI': 1, LE: 0 });
    for (let v = 0; v < 16; v++) expect(t.bus(['A', 'B', 'C', 'D'], v).gets(SEGS).join(''), String(v)).toBe(TABLE[v] ?? '0000000');
  });
  it('~LT lights every segment, ~BI blanks, LE high holds the code it had', () => {
    const t = bench('CD4511');
    t.set({ '~LT': 1, '~BI': 1, LE: 0 }).bus(['A', 'B', 'C', 'D'], 4);
    t.set({ LE: 1 }).bus(['A', 'B', 'C', 'D'], 7);
    expect(t.gets(SEGS).join(''), 'still 4 while latched').toBe(TABLE[4]);
    t.set({ LE: 0 });
    expect(t.gets(SEGS).join('')).toBe(TABLE[7]);
    t.set({ '~BI': 0 });
    expect(t.gets(SEGS).join('')).toBe('0000000');
    t.set({ '~LT': 0 });
    expect(t.gets(SEGS).join(''), 'lamp test beats blanking').toBe('1111111');
  });
});

describe('instantiateChip', () => {
  it('accepts pin numbers or names, Maps, and leaves missing pins floating', () => {
    const c = new Circuit();
    const a = c.input('a', 1), y = c.net('y', 'Z'), y2 = c.net('y2', 'Z');
    instantiateChip(c, CHIP_MODELS['74LS04'], new Map<number | string, Net>([[1, a], ['1Y', y]]));
    instantiateChip(c, CHIP_MODELS['74LS04'], { 1: a, 2: y2 });
    c.settle();
    expect(y.value).toBe(0);
    expect(y2.value).toBe(0);
    const z = c.net('z', 'Z');
    instantiateChip(c, CHIP_MODELS['74LS00'], { '1Y': z }); // inputs float high -> NAND low
    c.settle();
    expect(z.value).toBe(0);
  });
  it('params.delay overrides the model delay', () => {
    const c = new Circuit();
    const a = c.input('a', 0), y = c.net('y', 'Z');
    instantiateChip(c, CHIP_MODELS['74LS04'], { '1A': a, '1Y': y }, { delay: 4 });
    c.settle();
    c.set(a, 1);
    c.run(3);
    expect(y.value).toBe(1);
    c.step();
    expect(y.value).toBe(0);
  });
});

describe("the TV Typewriter's chips: 7410, 7473, 8288, MC4024", () => {
  it('7410: each of its three gates is a 3-input NAND, an open input reading high', () => {
    const t = bench('7410');
    for (const k of [1, 2, 3]) {
      const ins = [`${k}A`, `${k}B`, `${k}C`];
      for (let v = 0; v < 8; v++) {
        t.bus(ins, v);
        expect(t.get(`${k}Y`), `${k}: ${v}`).toBe(v === 7 ? 0 : 1);
      }
      t.set(Object.fromEntries(ins.map((n) => [n, 'Z'])));
      expect(t.get(`${k}Y`)).toBe(0);
    }
  });
  it('7473: toggles as each clock pulse ends with J and K open, and ~CLR clears', () => {
    const t = bench('7473');
    // the bench's open clock reads high, so setting it low is a pulse: clear first
    t.set({ '1CLK': 0, '~1CLR': 0 }).set({ '~1CLR': 1 });
    const seen: Level[] = [];
    for (let k = 0; k < 4; k++) {
      t.set({ '1CLK': 1 });
      seen.push(t.get('1Q'));
      t.set({ '1CLK': 0 });
      seen.push(t.get('1Q'));
    }
    expect(seen, 'Q changes only as the clock falls').toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
    t.pulse('1CLK');
    expect(t.gets(['1Q', '~1Q'])).toEqual([1, 0]);
    t.set({ '~1CLR': 0 });
    expect(t.gets(['1Q', '~1Q'])).toEqual([0, 1]);
    t.pulse('1CLK');
    expect(t.get('1Q'), 'held clear').toBe(0);
  });
  it('7473: master-slave, so a J pulse while the clock is high still sets it (ones catching)', () => {
    const t = bench('7473');
    t.set({ '2J': 0, '2K': 0, '2CLK': 0, '~2CLR': 0 }).set({ '~2CLR': 1 });
    t.set({ '2CLK': 1 }).set({ '2J': 1 }).set({ '2J': 0 });
    expect(t.get('2Q'), 'not yet: the slave waits for the clock to fall').toBe(0);
    t.set({ '2CLK': 0 });
    expect(t.gets(['2Q', '~2Q'])).toEqual([1, 0]);
    // J held before the clock rises and dropped before it falls: still caught; K alone resets
    t.set({ '2K': 1 }).pulse('2CLK');
    expect(t.get('2Q')).toBe(0);
    t.set({ '2K': 0, '2J': 0 }).pulse('2CLK');
    expect(t.get('2Q'), 'J = K = 0 holds').toBe(0);
  });
  it('8288: with QA into ~CLK2 it counts 0..11 in binary on falling edges; the ÷3 has QC then QD', () => {
    const c = new Circuit();
    const clk = c.input('clk', 1), reset = c.input('reset', 1), strobe = c.input('strobe', 1);
    const q = ['QA', 'QB', 'QC', 'QD'].map((n) => c.net(n, 'Z'));
    const data = ['A', 'B', 'C', 'D'].map((n) => c.input(n, 0));
    instantiateChip(c, CHIP_MODELS['8288'], { '~CLK1': clk, '~CLK2': q[0], QA: q[0], QB: q[1], QC: q[2], QD: q[3], '~RESET': reset, '~STROBE': strobe, A: data[0], B: data[1], C: data[2], D: data[3] });
    c.settle();
    const set = (n: Net, v: Level) => (c.set(n, v), c.settle());
    const count = () => levelsToNumber(q.map((n) => n.value));
    expect(count()).toBe(0);
    const seen: (number | null)[] = [];
    for (let k = 0; k < 13; k++) {
      set(clk, 0);
      set(clk, 1);
      seen.push(count());
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1]);
    set(reset, 0);
    expect(count()).toBe(0);
    set(clk, 0);
    expect(count(), 'reset low holds it at 0').toBe(0);
    set(clk, 1);
    data.forEach((n, k) => set(n, ((9 >> k) & 1) as Level));
    set(strobe, 0);
    expect(count(), 'reset beats the strobe').toBe(0);
    set(reset, 1);
    expect(count(), 'the strobe loads A-D').toBe(9);
    set(strobe, 1);
    set(clk, 0);
    expect(count()).toBe(10);
  });
  it('8288: the ÷2 and ÷6 sections count on their own', () => {
    const t = bench('8288');
    t.set({ '~RESET': 1, '~STROBE': 1, '~CLK1': 1, '~CLK2': 1 });
    const six: (number | null)[] = [];
    for (let k = 0; k < 7; k++) {
      t.pulse('~CLK2').set({ '~CLK2': 1 });
      six.push(t.num(['QB', 'QC', 'QD']));
    }
    expect(six, 'QB + 2 QC + 4 QD').toEqual([1, 2, 3, 4, 5, 0, 1]);
    expect(t.get('QA')).toBe(0);
    t.pulse('~CLK1').set({ '~CLK1': 1 });
    expect(t.get('QA')).toBe(1);
  });
  it('MC4024: two free-running square waves of params.halfPeriod1 and halfPeriod2', () => {
    const t = bench('MC4024', { halfPeriod1: 5, halfPeriod2: 20 }, { free: true });
    const one = watch(t.c, t.nets.OUT1), two = watch(t.c, t.nets.OUT2);
    t.c.run(300);
    const rises = (ev: [number, Level][]) => ev.filter(([, l]) => l === 1).map(([tm]) => tm);
    const r1 = rises(one), r2 = rises(two);
    expect(r1.length).toBeGreaterThan(20);
    for (let k = 1; k < r1.length; k++) expect(r1[k] - r1[k - 1]).toBe(10);
    for (let k = 1; k < r2.length; k++) expect(r2[k] - r2[k - 1]).toBe(40);
    const f1 = one.find(([tm, l]) => l === 0 && tm > r1[1])!;
    expect(f1[0] - r1[1]).toBe(5);
  });
});

describe("the TV Typewriter's page A chips: 7401, 74165, 2513, 2518", () => {
  it('7401: four NANDs with open-collector outputs: low, or let go', () => {
    const t = bench('7401');
    for (const k of [1, 2, 3, 4])
      for (let v = 0; v < 4; v++) {
        t.bus([`${k}A`, `${k}B`], v);
        expect(t.get(`${k}Y`), `${k}: ${v}`).toBe(v === 3 ? 0 : 'Z');
      }
  });
  it('74165: SH/~LD low loads A-H at once; each rising clock shifts toward QH, SER coming in', () => {
    const t = bench('74165');
    const data = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    t.set({ CLK: 0, 'CLK INH': 0, SER: 0 }).bus(data, 0b1011_0010).set({ 'SH/~LD': 0 });
    expect(t.gets(['QH', '~QH']), 'H on QH').toEqual([1, 0]);
    t.pulse('CLK');
    expect(t.get('QH'), 'held while loading').toBe(1);
    t.set({ 'SH/~LD': 1, SER: 1 });
    const seen: Level[] = [];
    for (let k = 0; k < 9; k++) {
      t.pulse('CLK');
      seen.push(t.get('QH'));
    }
    expect(seen, 'G down to A, then SER').toEqual([0, 1, 1, 0, 0, 1, 0, 1, 1]);
  });
  it('74165: CLK INH high holds it; it shifts on a rising edge of CLK OR CLK INH', () => {
    const t = bench('74165');
    const data = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    t.set({ CLK: 0, 'CLK INH': 1, SER: 0 }).bus(data, 0b0100_0000).set({ 'SH/~LD': 0 }).set({ 'SH/~LD': 1 });
    expect(t.get('QH')).toBe(0);
    t.pulse('CLK').pulse('CLK');
    expect(t.get('QH'), 'inhibited').toBe(0);
    t.set({ CLK: 1 }).set({ 'CLK INH': 0 });
    expect(t.get('QH'), 'INH falling with CLK high: no edge').toBe(0);
    t.set({ CLK: 0 }).set({ 'CLK INH': 1 });
    expect(t.get('QH'), 'INH rising with CLK low is an edge').toBe(1);
  });
  it('2513: the character on A4-A9 and the row on A1-A3 give five dots, O5 the leftmost', () => {
    const t = bench('2513');
    const addr = names((k) => `A${k}`, 1, 9), outs = ['O5', 'O4', 'O3', 'O2', 'O1'];
    t.set({ '~CE': 0 });
    const dots = (code: number, r: number) => {
      t.bus(addr, (code << 3) | r);
      return t.gets(outs).map((l) => (l === 1 ? '#' : '.')).join('');
    };
    expect([1, 2, 3, 4, 5, 6, 7].map((r) => dots(code2513('A')!, r))).toEqual(['..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#']);
    for (let code = 0; code < 64; code++) {
      expect(dots(code, 0), `row 0 of ${code}`).toBe('.....');
      for (let r = 0; r < 8; r++) expect(dots(code, r)).toBe(FONT_2513_CHART[(code >> 3) * 8 + r].split(' ')[code & 7]);
    }
    t.set({ '~CE': 1 });
    expect(t.gets(outs), 'disabled: open').toEqual(['Z', 'Z', 'Z', 'Z', 'Z']);
  });
  it('2513: 450 ns from a new address to its dots (45 gate delays)', () => {
    const t = bench('2513');
    t.set({ '~CE': 0 }).bus(names((k) => `A${k}`, 1, 9), (code2513('A')! << 3) | 1);
    const o3 = watch(t.c, t.nets.O3), from = t.c.time;
    t.bus(names((k) => `A${k}`, 1, 9), (code2513('A')! << 3) | 2);
    expect(o3.slice(1)).toEqual([[from + 45, 0]]);
  });
  it('2518: REC low writes the inputs, high sends the outputs round: 32 words a turn', () => {
    const t = bench('2518');
    const ins = names((k) => `IN${k}`, 1, 6), outs = names((k) => `OUT${k}`, 1, 6);
    const words = Array.from({ length: 32 }, (_, w) => (w * 7 + 3) & 63);
    t.set({ CLK: 0, REC: 0 });
    for (const w of words) t.bus(ins, w).pulse('CLK');
    t.set({ REC: 1 }).bus(ins, 0);
    for (let turn = 0; turn < 2; turn++) {
      const seen: (number | null)[] = [];
      for (let k = 0; k < 32; k++) {
        seen.push(t.num(outs));
        t.pulse('CLK');
      }
      expect(seen, `turn ${turn}`).toEqual(words);
    }
    expect(peek2518(t.comp.state)).toEqual(words);
  });
  it('2518: it takes the inputs as the clock rises and moves on as it falls, 300 ns later', () => {
    const t = bench('2518');
    const ins = names((k) => `IN${k}`, 1, 6), outs = names((k) => `OUT${k}`, 1, 6);
    t.set({ CLK: 0, REC: 0 });
    for (let k = 0; k < 32; k++) t.bus(ins, 0).pulse('CLK');
    t.bus(ins, 5).set({ CLK: 1 }).bus(ins, 9);
    expect(t.num(outs), 'nothing moves while the clock is high').toBe(0);
    for (let k = 0; k < 31; k++) t.set({ CLK: 0 }).bus(ins, 0).set({ CLK: 1 });
    const ev = watch(t.c, t.nets.OUT1), from = t.c.time;
    t.set({ CLK: 0 });
    expect(t.num(outs), 'the word as the clock rose, not after').toBe(5);
    expect(ev.slice(1)).toEqual([[from + 30, 1]]);
  });
});
