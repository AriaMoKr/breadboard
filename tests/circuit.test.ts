import { describe, expect, it } from 'vitest';
import { Circuit, Trace, and, or, resolve } from '../src/logic/circuit';

describe('logic circuit', () => {
  it('SR latch (NOR) sets, holds and resets', () => {
    const c = new Circuit();
    const S = c.input('S', 0);
    const R = c.input('R', 0);
    const Q = c.net('Q', 0);
    const Qn = c.net('Qn', 1);
    c.nor([R, Qn], Q);
    c.nor([S, Q], Qn);
    expect(c.settle().stable).toBe(true);
    expect([Q.value, Qn.value]).toEqual([0, 1]);
    c.set(S, 1); c.settle();
    expect([Q.value, Qn.value]).toEqual([1, 0]);
    c.set(S, 0); c.settle();
    expect([Q.value, Qn.value]).toEqual([1, 0]);
    c.set(R, 1); c.settle();
    expect([Q.value, Qn.value]).toEqual([0, 1]);
    // S=R=1 -> both outputs low (the "invalid" state)
    c.set(S, 1); c.settle();
    expect([Q.value, Qn.value]).toEqual([0, 0]);
    // releasing both at once with symmetric delays oscillates
    c.set(S, 0); c.set(R, 0);
    expect(c.settle(200).stable).toBe(false);
  });

  it('level-triggered JK with J=K=1 races while clock is high', () => {
    const c = new Circuit();
    const J = c.input('J', 1), K = c.input('K', 1), CLK = c.input('CLK', 0);
    const Q = c.net('Q', 0), Qn = c.net('Qn', 1);
    const s = c.net('s', 1), r = c.net('r', 1);
    c.add({ kind: 'NAND3', inputs: [J, CLK, Qn], outputs: [s], evaluate: ([a, b, d]) => [a === 1 && b === 1 && d === 1 ? 0 : 1] });
    c.add({ kind: 'NAND3', inputs: [K, CLK, Q], outputs: [r], evaluate: ([a, b, d]) => [a === 1 && b === 1 && d === 1 ? 0 : 1] });
    c.nand([s, Qn], Q);
    c.nand([r, Q], Qn);
    c.settle();
    c.set(CLK, 1);
    expect(c.settle(500).stable).toBe(false); // keeps toggling
  });

  it('tri-state bus: floating, single driver, contention', () => {
    const c = new Circuit();
    const a = c.input('a', 1), b = c.input('b', 0);
    const ea = c.input('ea', 0), eb = c.input('eb', 0);
    const bus = c.net('bus', 'Z');
    c.tri(a, ea, bus);
    c.tri(b, eb, bus);
    c.settle();
    expect(bus.value).toBe('Z');
    expect(c.read(bus)).toBe(1); // TTL input floats high
    c.set(ea, 1); c.settle();
    expect(bus.value).toBe(1);
    c.set(eb, 1); c.settle();
    expect(bus.value).toBe('X');
    bus.pull = 0;
    c.set(ea, 0); c.set(eb, 0); c.settle();
    expect(bus.value).toBe(0);
  });

  it('edge detector emits a short pulse on rising edges only', () => {
    const c = new Circuit();
    const clk = c.input('clk', 0);
    const p = c.net('p', 0);
    c.edgeDetector(clk, p, { width: 3 });
    c.set(clk, 1);
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) { c.step(); seen.push(p.value as number); }
    expect(seen).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    c.set(clk, 0);
    c.run(5);
    expect(p.value).toBe(0);
  });

  it('active-low tri-state (74LS245 G̅) and pull-down nets', () => {
    const c = new Circuit();
    const d = c.input('d', 1), oe = c.input('oe', 1);
    const bus = c.net('bus', 'Z');
    bus.pull = 0; // 10 kΩ pull-down
    c.tri(d, oe, bus, { activeLow: true });
    c.settle();
    expect(bus.value).toBe(0);
    c.set(oe, 0); c.settle();
    expect(bus.value).toBe(1);
  });

  it('floating inputs read as the configured level (TTL high by default)', () => {
    const ttl = new Circuit();
    const z = ttl.net('z', 'Z');
    const o = ttl.net('o', 0);
    ttl.not(z, o);
    ttl.settle();
    expect(o.value).toBe(0);
    const cmos = new Circuit({ floatingInput: 0 });
    const z2 = cmos.net('z', 'Z');
    const o2 = cmos.net('o', 0);
    cmos.not(z2, o2);
    cmos.settle();
    expect(o2.value).toBe(1);
  });

  it('unknowns: a 0 still forces AND low, a 1 forces OR high, disagreeing drivers give X', () => {
    expect(and([0, 'X'])).toBe(0);
    expect(and([1, 'Z'])).toBe('X');
    expect(or([1, 'X'])).toBe(1);
    expect(resolve([1, 0], 'Z')).toBe('X');
    expect(resolve(['Z', 'Z'], 0)).toBe(0);
  });

  it('gate delays add up along a chain (transport delay)', () => {
    const c = new Circuit();
    const a = c.input('a', 0);
    const n1 = c.net('n1', 1), n2 = c.net('n2', 0), n3 = c.net('n3', 1);
    c.not(a, n1);
    c.not(n1, n2);
    c.not(n2, n3, 3);
    c.settle();
    c.set(a, 1);
    const t0 = c.time;
    const r = c.settle();
    expect(r.stable).toBe(true);
    expect(c.time - t0).toBe(5);
    expect(n3.value).toBe(0);
  });

  it('Trace records levels and replaces the sample when an input changes without time passing', () => {
    const c = new Circuit();
    const a = c.input('a', 0);
    const q = c.net('q', 1);
    c.not(a, q);
    c.settle();
    const tr = new Trace([a, q], 4);
    const off = tr.attach(c);
    c.set(a, 1);
    expect(tr.samples[0]).toEqual([1]);
    c.run(2);
    expect(tr.samples).toEqual([[1, 1, 1], [1, 0, 0]]);
    c.run(5);
    expect(tr.samples[0].length).toBe(4); // capped at maxLength
    off();
    tr.clear();
    expect(tr.times.length).toBe(0);
  });
});
