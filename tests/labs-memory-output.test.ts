import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Lab } from '../src/labs/types';
import { ArduinoProgrammer, CODE_LINES, LINE_INDEX, runAll } from '../src/labs/output/_programmer';
import { HEX_DIGITS, displayText } from '../src/sim/display';
import { ls161Async, ls161Mode, ls161Rise, ls161Tc, pcBusLevels, rippleStates, ttlReadNibble, type Ls161Inputs } from '../src/labs/pc/_shared';
import {
  Ls189, RamModule, TTL_THRESHOLD, busRead, cellAt, faultyStore, ls189Outputs, rcNode, rcPulseWidth, reinvert, simulateWrite, walkingOnes, wireDestination,
  writeWaveforms, type RamModuleInputs, type WriteScenario,
} from '../src/labs/ram/_shared';
import {
  Cascade595, DIGIT_NAMES, DISPLAY_555, DISPLAY_IMAGE, Eeprom28C16, HEX_CA, Ls76Counter, SEGS, SLOW_DEMO_C, Sr595, advanceMux, astable555, canonical, capForFreq,
  checkWritePulse, decoderCost, decoderCostPairs, digitAddress, evalSop, formatContentsLine, formatSop, formatTerm, gateCount, literals, ls139, minimise, minterms, newMuxState,
  persist, primeImplicants, rcPulseNs, segLit, segOutput, setAddressBytes, shiftOutBits,
} from '../src/labs/output/_shared';

// ---------------------------------------------------------------------------
describe('74LS189 RAM chip', () => {
  it('reads back the complement of what was written', () => {
    const r = new Ls189();
    r.apply(5, 0b0110, 0, 0); // write
    expect(r.cells[5]).toBe(0b0110);
    const out = r.apply(5, 0, 0, 1); // read
    expect(out).toEqual([1, 0, 0, 1]); // bit0..bit3 of ~0110 = 1001
    expect(reinvert(out)).toBe(0b0110);
  });
  it('floats its outputs while writing or when deselected', () => {
    expect(ls189Outputs(0b1010, 0, 0)).toEqual(['Z', 'Z', 'Z', 'Z']);
    expect(ls189Outputs(0b1010, 1, 1)).toEqual(['Z', 'Z', 'Z', 'Z']);
    // the 74LS04 sees floating inputs as high -> its outputs read 0
    expect(reinvert(['Z', 'Z', 'Z', 'Z'])).toBe(0);
  });
  it('does not write while C̅S̅ is high, and writes are level-sensitive', () => {
    const r = new Ls189([0, 0, 0, 0]);
    r.apply(2, 0b1111, 1, 0);
    expect(r.cells[2]).toBe(0);
    r.apply(2, 0b0001, 0, 0);
    r.apply(2, 0b0011, 0, 0); // data changes while W̅E̅ is still low
    expect(r.cells[2]).toBe(0b0011);
  });
});

describe('RAM module', () => {
  const base = (o: Partial<RamModuleInputs> = {}): RamModuleInputs => ({ prog: true, dipAddr: 0, dipData: 0, writeBtn: false, bus: null, mi: false, ri: false, ro: false, clkToNand: 0, ...o });
  it('program mode: DIP address/data, write while the button is held', () => {
    const m = new RamModule();
    m.mar = 9;
    const i = base({ dipAddr: 3, dipData: 0x2a, writeBtn: true });
    expect(m.signals(i).addr).toBe(3);
    expect(m.signals(i).weN).toBe(0);
    expect(m.signals(i).leds).toBe(0); // outputs float during the write
    m.settle(i);
    expect(m.ram[3]).toBe(0x2a);
    const r = m.signals(base({ dipAddr: 3 }));
    expect(r.leds).toBe(0x2a);
    // RI and the clock do nothing in program mode
    expect(m.signals(base({ ri: true, clkToNand: 1 })).weN).toBe(1);
  });
  it('run mode: MI loads the MAR from the bus, RI writes on the clock, RO drives the bus', () => {
    const m = new RamModule();
    const run = (o: Partial<RamModuleInputs>) => base({ prog: false, ...o });
    expect(m.clockEdge(run({ bus: 0b11100101, mi: true }))).toBe(true);
    expect(m.mar).toBe(0b0101);
    expect(m.signals(run({})).addr).toBe(5);
    const w = run({ bus: 0x99, ri: true, clkToNand: 1 });
    expect(m.signals(w).nand).toBe(0);
    m.settle(w);
    expect(m.ram[5]).toBe(0x99);
    const r = m.signals(run({ ro: true }));
    expect(r.busOut).toBe(0x99);
    expect(r.busLevel).toBe(0x99);
    expect(m.signals(run({ ro: true, bus: 0x0f })).contention).toBe(true);
  });
  it('a floating bus reads as all ones', () => {
    expect(busRead(null)).toBe(0xff);
    const m = new RamModule();
    m.clockEdge({ ...base({ prog: false }), mi: true });
    expect(m.mar).toBe(15);
  });
});

describe('RAM write timing (RC edge detector)', () => {
  const sc: WriteScenario = { tHigh: 100e-6, tChange: 50e-6, before: 0x2a, after: 0x55, r: 1000, c: 10e-9 };
  it('0.01 µF and 1 kΩ give a pulse of roughly 10 µs', () => {
    const pw = rcPulseWidth(1000, 10e-9);
    expect(pw).toBeGreaterThan(10e-6);
    expect(pw).toBeLessThan(15e-6);
    expect(rcNode(0, 100e-6, 10e-6)).toBeCloseTo(5);
    expect(rcNode(pw, 100e-6, 10e-6)).toBeCloseTo(TTL_THRESHOLD, 5);
    expect(rcNode(150e-6, 100e-6, 10e-6)).toBeLessThanOrEqual(0);
  });
  it('the level version stores the byte that arrived late, the edge version the right one', () => {
    expect(simulateWrite(sc, 'level')).toMatchObject({ stored: 0x55, correct: false });
    expect(simulateWrite(sc, 'edge')).toMatchObject({ stored: 0x2a, correct: true });
    // a change inside the RC pulse fools the edge version too
    expect(simulateWrite({ ...sc, tChange: 5e-6 }, 'edge').stored).toBe(0x55);
    // a change after the clock fell fools neither
    expect(simulateWrite({ ...sc, tChange: 120e-6 }, 'level').stored).toBe(0x2a);
  });
  it('cell contents over time and the scope traces agree', () => {
    expect(cellAt(sc, 'level', -1e-6, 0)).toBe(0);
    expect(cellAt(sc, 'level', 60e-6, 0)).toBe(0x55);
    expect(cellAt(sc, 'edge', 60e-6, 0)).toBe(0x2a);
    const wf = writeWaveforms(sc, 200, -10e-6, 130e-6);
    const lowLevel = wf.weLevel.filter((x) => x === 0).length;
    const lowEdge = wf.weEdge.filter((x) => x === 0).length;
    expect(lowEdge).toBeGreaterThan(0);
    expect(lowEdge).toBeLessThan(lowLevel);
  });
});

describe('off-by-one wiring fault', () => {
  it('shifts the bits above the fault and the empty input reads 1', () => {
    const f = { from: 3 };
    expect(faultyStore(0, f)).toBe(0b00001000);
    expect(faultyStore(0b00000001, f)).toBe(0b00001001);
    expect(faultyStore(0b00001000, f)).toBe(0b00011000);
    expect(faultyStore(0b10000000, f)).toBe(0b00001000); // bit 7 lost
    expect(faultyStore(0xa5, null)).toBe(0xa5);
    expect(wireDestination(2, f)).toBe(2);
    expect(wireDestination(3, f)).toBe(4);
    expect(wireDestination(7, f)).toBeNull();
  });
  it('walking a 1 through reveals the fault position', () => {
    const w = walkingOnes({ from: 5 });
    expect(w.map((x) => x.read)).toEqual([0x21, 0x22, 0x24, 0x28, 0x30, 0x60, 0xa0, 0x20]);
    expect(walkingOnes(null).every((x) => x.read === x.wrote)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('74LS161 program counter', () => {
  const inp = (o: Partial<Ls161Inputs> = {}): Ls161Inputs => ({ mrN: 1, peN: 1, cep: 1, cet: 1, p: 0, ...o });
  it('counts on the rising edge when CEP = CET = 1 and wraps 15 -> 0', () => {
    expect(ls161Rise(4, inp())).toBe(5);
    expect(ls161Rise(15, inp())).toBe(0);
    let q = 0;
    for (let i = 0; i < 16; i++) q = ls161Rise(q, inp());
    expect(q).toBe(0);
  });
  it('holds when either enable is low', () => {
    expect(ls161Rise(7, inp({ cep: 0 }))).toBe(7);
    expect(ls161Rise(7, inp({ cet: 0 }))).toBe(7);
    expect(ls161Mode(inp({ cep: 0 }))).toBe('hold');
  });
  it('load (P̅E̅ low) beats count', () => {
    expect(ls161Mode(inp({ peN: 0, p: 9 }))).toBe('load');
    expect(ls161Rise(3, inp({ peN: 0, p: 9 }))).toBe(9);
    expect(ls161Rise(3, inp({ peN: 0, p: 0x1c }))).toBe(0xc); // only P0-P3
  });
  it('clear is asynchronous and beats everything', () => {
    expect(ls161Async(11, inp({ mrN: 0 }))).toBe(0);
    expect(ls161Async(11, inp())).toBe(11);
    expect(ls161Mode(inp({ mrN: 0, peN: 0 }))).toBe('clear');
    expect(ls161Rise(11, inp({ mrN: 0, peN: 0, p: 5 }))).toBe(0);
  });
  it('terminal count = CET AND Q = 15', () => {
    expect(ls161Tc(15, 1)).toBe(1);
    expect(ls161Tc(15, 0)).toBe(0);
    expect(ls161Tc(14, 1)).toBe(0);
  });
  it('bus bits 0-3: floating reads 1, contention reads the low output', () => {
    // nothing drives the bus: every line floats and the P inputs read 1111
    expect(pcBusLevels(5, false, false, 0)).toEqual(['Z', 'Z', 'Z', 'Z']);
    expect(ttlReadNibble(pcBusLevels(5, false, false, 0))).toBe(0b1111);
    // CO alone puts the count on the bus
    expect(ttlReadNibble(pcBusLevels(0b0110, true, false, 0))).toBe(0b0110);
    // CO and the switches disagree on bits 0 and 3: those lines fight, and low wins
    const lv = pcBusLevels(0b0110, true, true, 0b1111);
    expect(lv).toEqual(['X', 1, 1, 'X']);
    expect(ttlReadNibble(lv)).toBe(0b0110);
    // J from a contended bus loads the AND of the two drivers
    expect(ls161Rise(0, { mrN: 1, peN: 0, cep: 0, cet: 0, p: ttlReadNibble(pcBusLevels(0b1010, true, true, 0b0011)) })).toBe(0b0010);
  });
  it('a ripple counter passes through intermediate states', () => {
    expect(rippleStates(0b0111)).toEqual([0b0110, 0b0100, 0b0000, 0b1000]);
    expect(rippleStates(0b0100)).toEqual([0b0101]);
    expect(rippleStates(0b1111)).toEqual([0b1110, 0b1100, 0b1000, 0b0000]);
    for (let q = 0; q < 16; q++) expect(rippleStates(q).at(-1)).toBe((q + 1) & 15);
  });
});

// ---------------------------------------------------------------------------
describe('hex decoder logic', () => {
  it('uses Ben’s segment patterns', () => {
    expect(segLit(0, 'g')).toBe(0);
    expect(segLit(8, 'g')).toBe(1);
    expect(SEGS.filter((s) => segLit(1, s))).toEqual(['b', 'c']);
    expect(minterms('a', 'ca')).toEqual([1, 4, 0xb, 0xd]); // segment a is off for 1, 4, b, d
    expect(minterms('g', 'ca')).toEqual([0, 1, 7, 0xc]);
  });
  it('derived expressions match the truth table for all 16 inputs', () => {
    for (const pol of ['cc', 'ca'] as const)
      for (const s of SEGS) {
        const ms = minterms(s, pol);
        const min = minimise(ms);
        const can = canonical(ms);
        for (let x = 0; x < 16; x++) {
          expect(evalSop(min, x)).toBe(segOutput(x, s, pol));
          expect(evalSop(can, x)).toBe(segOutput(x, s, pol));
        }
        // the minimised form is never bigger
        expect(gateCount(min).and2 + gateCount(min).or2).toBeLessThanOrEqual(gateCount(can).and2 + gateCount(can).or2);
        // every chosen term is a prime implicant
        const pis = primeImplicants(ms).map((p) => `${p.value}/${p.mask}`);
        for (const t of min) expect(pis).toContain(`${t.value}/${t.mask}`);
      }
  });
  it('formats terms with overbars, A = MSB', () => {
    expect(formatTerm({ value: 0b0001, mask: 0 })).toBe('A̅B̅C̅D');
    expect(formatTerm({ value: 0b1000, mask: 0b0111 })).toBe('A');
    expect(literals({ value: 0b0100, mask: 0b0011 })).toEqual([{ v: 0, neg: true }, { v: 1, neg: false }]);
    expect(formatSop([])).toBe('0');
  });
  it('counts gates for the whole decoder', () => {
    const can = decoderCost('canonical', 'cc');
    const min = decoderCost('minimal', 'cc');
    const shared = decoderCost('minimal', 'cc', true);
    expect(can.and2).toBe(3 * SEGS.reduce((n, s) => n + minterms(s, 'cc').length, 0));
    expect(min.and2).toBeLessThan(can.and2);
    expect(shared.and2).toBeLessThanOrEqual(min.and2);
    expect(min.not).toBe(4);
    expect(min.chips.ls04).toBe(1);
  });
  it('common anode: OFF rows, and sharing pairs fits Ben’s 9 × 74LS08 + 5 × 74LS32 + 1 × 74LS04', () => {
    // one OR input per OFF row: 34 OFF cells over 7 segments
    expect(decoderCost('canonical', 'ca').or2).toBe(34 - 7);
    const min = decoderCost('minimal', 'ca');
    expect(min.or2).toBe(18);
    expect(min.chips.ls32).toBe(5);
    const pairs = decoderCostPairs('ca');
    expect(pairs.or2).toBe(min.or2);
    expect(pairs.and2).toBeLessThan(decoderCost('minimal', 'ca', true).and2);
    expect(pairs.and2).toBeLessThanOrEqual(9 * 4);
    expect(pairs.chips.ls08).toBeLessThanOrEqual(9);
    expect(pairs.chips.total).toBeLessThanOrEqual(15);
    // the pair-sharing count is a valid circuit cost for the same minimised terms
    expect(decoderCostPairs('cc').and2).toBeLessThanOrEqual(decoderCost('minimal', 'cc', true).and2);
  });
});

// ---------------------------------------------------------------------------
describe('28C16 EEPROM', () => {
  it('Ben’s common-anode table is the inverse of the common-cathode one', () => {
    expect(HEX_CA).toEqual([0x81, 0xcf, 0x92, 0x86, 0xcc, 0xa4, 0xa0, 0x8f, 0x80, 0x84, 0x88, 0xe0, 0xb1, 0xc2, 0xb0, 0xb8]);
  });
  it('reads only with C̅E̅ and O̅E̅ low and W̅E̅ high', () => {
    const e = new Eeprom28C16();
    expect(e.output(0, 0, 0, 1)).toBe(0xff); // erased
    expect(e.output(0, 1, 0, 1)).toBeNull();
    expect(e.output(0, 0, 1, 1)).toBeNull();
    expect(e.output(0, 0, 0, 0)).toBeNull();
  });
  it('writes with a valid W̅E̅ pulse, and inhibits writes as the datasheet says', () => {
    const e = new Eeprom28C16();
    expect(e.write(0x7ff, 0x81, { ceN: 0, oeN: 1, pulseNs: 500 })).toMatchObject({ stored: true, check: 'ok' });
    expect(e.mem[0x7ff]).toBe(0x81);
    expect(e.write(1, 0x12, { ceN: 0, oeN: 0, pulseNs: 500 }).stored).toBe(false);
    expect(e.write(1, 0x12, { ceN: 1, oeN: 1, pulseNs: 500 }).stored).toBe(false);
    expect(e.write(1, 0x12, { ceN: 0, oeN: 1, pulseNs: 50 }).check).toBe('too-short');
    expect(e.mem[1]).toBe(0xff);
    expect(e.write(1, 0x12, { ceN: 0, oeN: 1, pulseNs: 1e8 })).toMatchObject({ stored: true, check: 'too-long' });
    expect(checkWritePulse(100)).toBe('ok');
    expect(checkWritePulse(1000)).toBe('ok');
    expect(rcPulseNs(680, 1e-9)).toBeGreaterThan(100);
    expect(rcPulseNs(680, 1e-9)).toBeLessThan(1000);
  });
});

describe('74HC595 shift registers', () => {
  it('shifts QA <- SER and only updates the outputs on RCLK', () => {
    const s = new Sr595();
    for (const b of [1, 0, 1, 1]) s.clock(b as 0 | 1);
    expect(s.shift).toBe(0b1011);
    expect(s.latch).toBe(0);
    s.rclk();
    expect(s.latch).toBe(0b1011);
  });
  it('cascades through QH′ into the second chip', () => {
    const c = new Cascade595();
    for (let i = 0; i < 8; i++) c.clock(1);
    expect(c.u1.shift).toBe(0xff);
    expect(c.u2.shift).toBe(0);
    c.clock(0);
    expect(c.u2.shift).toBe(1);
    expect(c.u1.shift).toBe(0xfe);
  });
  it('setAddress(): two shiftOut(MSBFIRST) calls put the address on A0-A10 and the OE bit on #2 QH', () => {
    for (const [addr, oe] of [[0x123, true], [0x7ff, false], [0x0a5, true], [0, false]] as [number, boolean][]) {
      const c = new Cascade595();
      for (const byte of setAddressBytes(addr, oe)) for (const b of shiftOutBits(byte)) c.clock(b);
      c.rclk();
      expect(c.address).toBe(addr);
      expect(c.oeN).toBe(oe ? 0 : 1);
    }
    expect(shiftOutBits(0x80)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(shiftOutBits(0x01, false)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('formats printContents() lines like Ben’s sketch', () => {
    expect(formatContentsLine(0, HEX_CA)).toBe('000:  81 cf 92 86 cc a4 a0 8f   80 84 88 e0 b1 c2 b0 b8');
    expect(formatContentsLine(0xf0, new Array(16).fill(255))).toBe('0f0:  ff ff ff ff ff ff ff ff   ff ff ff ff ff ff ff ff');
  });
});

// ---------------------------------------------------------------------------
describe('multiplexed decimal display', () => {
  it('the display 555 runs at about 716 Hz, the 2 µF demo at a few Hz', () => {
    const t = astable555(DISPLAY_555.r1, DISPLAY_555.r2, DISPLAY_555.c);
    expect(t.freq).toBeGreaterThan(700);
    expect(t.freq).toBeLessThan(730);
    expect(astable555(DISPLAY_555.r1, DISPLAY_555.r2, SLOW_DEMO_C).freq).toBeCloseTo(3.59, 1);
    expect(capForFreq(t.freq)).toBeCloseTo(DISPLAY_555.c, 12);
  });
  it('the 74LS76 counter (Q̅ outputs) counts 0, 1, 2, 3 and the 139 enables one digit', () => {
    const c = new Ls76Counter();
    const seq: number[] = [];
    for (let i = 0; i < 8; i++) {
      c.clockFall();
      seq.push(c.select);
    }
    expect(seq).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(ls139(2)).toEqual([1, 1, 0, 1]);
    expect(ls139(2, 1)).toEqual([1, 1, 1, 1]);
  });
  it('EEPROM addresses and Ben’s examples', () => {
    expect(digitAddress(42, 1, false)).toBe(256 + 42);
    expect(digitAddress(0b11110011, 3, true)).toBe(1024 + 768 + 243);
    expect(DISPLAY_IMAGE[digitAddress(243, 3, true)]).toBe(0x01); // minus: segment g only
    expect(displayText(0b11110011, true)).toBe('-013');
    expect(displayText(0b11000010, true)).toBe('-062');
    expect(displayText(42, false)).toBe(' 042');
    expect(displayText(243, false)).toBe(' 243');
    expect(DIGIT_NAMES[0]).toBe('ones');
    expect(DISPLAY_IMAGE[digitAddress(7, 0, false)]).toBe(HEX_DIGITS[7]);
  });
  it('slow multiplexing lights one digit at a time; fast multiplexing looks steady', () => {
    const slow = newMuxState();
    const tSlow = astable555(1000, 100_000, SLOW_DEMO_C);
    let frac = [0, 0, 0, 0];
    for (let i = 0; i < 5; i++) frac = advanceMux(slow, 16, tSlow);
    expect(frac.filter((f) => f > 0.99).length).toBe(1);
    const fast = newMuxState();
    const tFast = astable555(1000, 100_000, 10e-9);
    for (let i = 0; i < 60; i++) advanceMux(fast, 16, tFast);
    for (const g of fast.glow) expect(g).toBeGreaterThan(0.2);
    for (const g of fast.glow) expect(g).toBeLessThan(0.3);
    expect(persist(1, 0, 30, 30)).toBeCloseTo(Math.exp(-1));
  });
  it('speeding the 555 up takes effect at once (no leftover slow half-period)', () => {
    const st = newMuxState();
    const slow = astable555(1000, 100_000, SLOW_DEMO_C); // half-period ≈ 0.14 s
    advanceMux(st, 16, slow);
    expect(st.untilToggle).toBeGreaterThan(0.1);
    const fast = astable555(1000, 100_000, 10e-9);
    const before = st.counter.select;
    const frac = advanceMux(st, 16, fast); // 16 ms at ~716 Hz: about 11 digit changes
    expect(st.untilToggle).toBeLessThanOrEqual(fast.tHigh + 1e-12);
    expect(frac.filter((f) => f > 0).length).toBe(4);
    expect(st.counter.select === before && frac[before] > 0.99).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Arduino EEPROM programmer simulation', () => {
  it('every highlighted line id exists in the listing', () => {
    for (const id of ['sa1', 'sa2', 'sa3', 'sa4', 'sa5', 'rd1', 'rd2', 'rd3', 'rd4', 'wr1', 'wr2', 'wr3', 'wr4', 'wr5', 'wr6', 'wr7', 'pc1', 'pc2', 'pc3', 'pc4', 'su1', 'su2', 'su3', 'su4', 'su5', 'su6'])
      expect(LINE_INDEX.has(id)).toBe(true);
    expect(CODE_LINES.some((l) => l.text.includes('//@'))).toBe(false);
  });
  it('writeEEPROM then readEEPROM round-trips through the shift registers', () => {
    const p = new ArduinoProgrammer();
    const evs = runAll(p.writeEEPROM(0x2a5, 0x5c));
    expect(evs).toBeGreaterThan(48); // 16 bits x 3 events + the rest
    expect(p.rom.mem[0x2a5]).toBe(0x5c);
    expect(p.lastWrite).toEqual({ addr: 0x2a5, data: 0x5c, stored: true });
    expect(p.lastPulseUs).toBe(1);
    expect(p.sr.oeN).toBe(1);
    const g = p.readEEPROM(0x2a5);
    let r = g.next();
    while (!r.done) r = g.next();
    expect(r.value).toBe(0x5c);
    expect(p.sr.oeN).toBe(0);
    expect(p.ioLevels()).toEqual([0, 0, 1, 1, 1, 0, 1, 0]);
  });
  it('programs the hex table and prints it in Ben’s format', () => {
    const p = new ArduinoProgrammer();
    runAll(p.programTable());
    const lines = p.serial.split('\n');
    expect(lines[0]).toBe('Programming EEPROM. done');
    expect(lines[1]).toBe('Reading EEPROM');
    expect(lines[2]).toBe('000:  81 cf 92 86 cc a4 a0 8f   80 84 88 e0 b1 c2 b0 b8');
    expect(lines[3]).toBe('010:  ff ff ff ff ff ff ff ff   ff ff ff ff ff ff ff ff');
    expect(lines.filter((l) => /^[0-9a-f]{3}:/.test(l)).length).toBe(16);
    expect(p.us).toBeGreaterThan(160_000); // 16 x delay(10)
  });
  it('setup()’s erase loop writes FF to all 2048 bytes and takes over 20 s', () => {
    for (const id of ['er1', 'er2', 'er3', 'er4']) expect(LINE_INDEX.has(id)).toBe(true);
    const p = new ArduinoProgrammer();
    runAll(p.programTable(HEX_CA, false));
    p.rom.mem[0x7ff] = 0x12;
    runAll(p.eraseAll());
    expect([...p.rom.mem].every((b) => b === 0xff)).toBe(true);
    expect(p.serial.split('\n')[1]).toBe(`Erasing EEPROM${'.'.repeat(32)} done`);
    expect(p.us).toBeGreaterThan(2048 * 10_000);
  });
  it('forgetting pinMode(INPUT) makes the Arduino fight the EEPROM', () => {
    const p = new ArduinoProgrammer(() => 0);
    runAll(p.writeEEPROM(3, 0x0f));
    p.forgetInputMode = true;
    const g = p.readEEPROM(0x10); // erased: EEPROM drives 0xff, Arduino still drives 0x0f
    while (!g.next().done);
    expect(p.ioLevels().filter((l) => l === 'X').length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Smoke test for the RAM / program counter / output labs: mount each one in a
// tiny fake DOM (the test environment is node, without jsdom), drive every
// control, pump animation frames, and check that cleanup stops every loop.

type MoListener = (e: unknown) => void;
class MoNode {
  childNodes: MoNode[] = [];
  parentNode: MoNode | null = null;
  private ls = new Map<string, Set<MoListener>>();
  get firstChild() { return this.childNodes[0] ?? null; }
  get children(): MoEl[] { return this.childNodes.filter((c): c is MoEl => c instanceof MoEl); }
  get childElementCount() { return this.children.length; }
  get lastElementChild(): MoEl | null { return this.children.at(-1) ?? null; }
  appendChild<T extends MoNode>(c: T): T { return this.insertBefore(c, null); }
  insertBefore<T extends MoNode>(c: T, ref: MoNode | null): T {
    c.remove();
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c: MoNode) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { this.parentNode?.removeChild(this); }
  append(...ns: (MoNode | string)[]) { for (const n of ns) this.appendChild(typeof n === 'string' ? new MoText(n) : n); }
  prepend(...ns: (MoNode | string)[]) { const first = this.firstChild; for (const n of ns) this.insertBefore(typeof n === 'string' ? new MoText(n) : n, first); }
  replaceChildren(...ns: (MoNode | string)[]) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.replaceChildren(new MoText(String(v))); }
  addEventListener(t: string, f: MoListener) { if (!this.ls.has(t)) this.ls.set(t, new Set()); this.ls.get(t)!.add(f); }
  removeEventListener(t: string, f: MoListener) { this.ls.get(t)?.delete(f); }
  fire(t: string) { for (const f of [...(this.ls.get(t) ?? [])]) f({ type: t, target: this, key: ' ', preventDefault() {} }); }
}
class MoText extends MoNode {
  constructor(public data: string) { super(); }
  override get textContent() { return this.data; }
  override set textContent(v: string) { this.data = String(v); }
}
class MoEl extends MoNode {
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  private cls = new Set<string>();
  scrollTop = 0;
  constructor(public tagName: string) { super(); }
  classList = {
    add: (...c: string[]) => c.forEach((x) => this.cls.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.cls.delete(x)),
    contains: (c: string) => this.cls.has(c),
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !this.cls.has(c);
      if (on) this.cls.add(c);
      else this.cls.delete(c);
      return on;
    },
  };
  get className() { return [...this.cls].join(' '); }
  set className(v: string) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k: string, v: string) { if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return k === 'class' ? this.className : (this.attrs.get(k) ?? null); }
  get offsetTop() { return 0; }
  get offsetLeft() { return 0; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get scrollHeight() { return 0; }
  focus() {}
  private matches1(sel: string): boolean {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)$/i.exec(sel.trim());
    if (!m) return false;
    if (m[1] && m[1].toLowerCase() !== this.tagName.toLowerCase()) return false;
    return m[2].split('.').filter(Boolean).every((c) => this.cls.has(c));
  }
  matches(sel: string) { return sel.split(',').some((x) => this.matches1(x)); }
  querySelectorAll(sel: string): MoEl[] {
    const out: MoEl[] = [];
    const walk = (n: MoNode) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  closest(sel: string): MoEl | null {
    let n: MoNode | null = this;
    while (n instanceof MoEl) {
      if (n.matches(sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
}
class MoSvg extends MoEl {}

describe('RAM / PC / output lab smoke tests (fake DOM)', () => {
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const KEYS = ['document', 'Node', 'SVGElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'window'];
  let frameCbs = new Map<number, (t: number) => void>();
  let nextId = 1;
  let now = 0;
  const pump = (n: number, dt = 16) => {
    for (let i = 0; i < n; i++) {
      now += dt;
      const cbs = [...frameCbs.values()];
      frameCbs = new Map();
      for (const cb of cbs) cb(now);
    }
  };
  beforeAll(() => {
    for (const k of KEYS) saved[k] = g[k];
    g.document = {
      body: new MoEl('body'),
      createElement: (t: string) => new MoEl(t),
      createElementNS: (_ns: string, t: string) => new MoSvg(t),
      createTextNode: (t: string) => new MoText(t),
    };
    g.window = new MoEl('window');
    g.Node = MoNode;
    g.SVGElement = MoSvg;
    now = performance.now();
    g.requestAnimationFrame = (cb: (t: number) => void) => {
      const id = nextId++;
      frameCbs.set(id, cb);
      return id;
    };
    g.cancelAnimationFrame = (id: number) => frameCbs.delete(id);
  });
  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete g[k];
      else g[k] = saved[k];
    }
  });

  const labs: [string, () => Promise<{ default: Lab }>][] = [
    ['ram-intro', () => import('../src/labs/ram/ram-intro.lab')],
    ['ram-build', () => import('../src/labs/ram/ram-build.lab')],
    ['ram-test', () => import('../src/labs/ram/ram-test.lab')],
    ['program-counter', () => import('../src/labs/pc/program-counter.lab')],
    ['hex-decoder', () => import('../src/labs/output/hex-decoder.lab')],
    ['eeprom', () => import('../src/labs/output/eeprom.lab')],
    ['eeprom-programmer', () => import('../src/labs/output/eeprom-programmer.lab')],
    ['decimal-display', () => import('../src/labs/output/decimal-display.lab')],
  ];
  for (const [id, load] of labs) {
    it(`${id} mounts, reacts to every control and cleans up`, async () => {
      const lab = (await load()).default;
      expect(lab.id).toBe(id);
      const root = new MoEl('div');
      (g.document as { body: MoEl }).body.appendChild(root);
      const cleanup = lab.mount(root as unknown as HTMLElement);
      pump(10);
      expect(root.textContent.length).toBeGreaterThan(200);
      for (let round = 0; round < 2; round++) {
        for (const el of root.querySelectorAll('input')) {
          const inp = el as unknown as { checked: boolean; value: string };
          const type = el.getAttribute('type');
          if (type === 'checkbox') {
            inp.checked = !inp.checked;
            el.fire('change');
          }
          if (type === 'range') {
            inp.value = String(round ? 900 : 300);
            el.fire('input');
          }
          pump(2);
        }
        for (const el of root.querySelectorAll('select')) {
          const opts = el.querySelectorAll('option');
          (el as unknown as { value: string }).value = opts[(round + 1) % opts.length].getAttribute('value') ?? '';
          el.fire('change');
          pump(2);
        }
        for (const el of root.querySelectorAll('button, th, g.sch-switch, polygon.seg')) {
          el.fire('pointerdown');
          pump(1);
          el.fire('pointerup');
          el.fire('click');
          pump(3);
        }
        pump(60, 33);
      }
      expect(root.textContent).not.toMatch(/NaN|undefined|\[object/);
      expect(typeof cleanup).toBe('function');
      (cleanup as () => void)();
      pump(3); // flush one-shot schematic redraws
      expect(frameCbs.size).toBe(0);
      root.remove();
    }, 120_000);
  }
});
