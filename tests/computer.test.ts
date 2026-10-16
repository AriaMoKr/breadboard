import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAPTERS, LAB_IDS, VIDEOS } from '../src/app/chapters';
import { App } from '../src/app/app';
import { mountComputerWorkbench } from '../src/app/computer-page';
import { clearLabCache, hasLab, loadLab } from '../src/app/lab-loader';
import { LABS } from '../src/labs/registry';
import { assemble, disassemble } from '../src/sim/assembler';
import { Computer, computeAlu, type RisingEdgeEvent } from '../src/sim/computer';
import { DEC_DIGITS, displayEepromImage, displayText } from '../src/sim/display';
import { Machine } from '../src/sim/machine';
import {
  buildMicrocode, buildMicrocodeVersion, controlWordFromEeprom, MICROCODE_VERSIONS, microcodeEepromImage, microIndex, type MicrocodeVersionId,
} from '../src/sim/microcode';
import { PROGRAM_BY_ID, PROGRAMS } from '../src/sim/programs';
import { AI, AO, BI, CE, CO, EO, FI, HLT, II, IO, J, MI, OI, RI, RO, SIGNAL_BITS, SIGNAL_INFO, SIGNALS, SU, formatControlWord, parseControlWord } from '../src/sim/signals';
import { select, SevenSegment } from '../src/ui/components';
import { ComputerView } from '../src/ui/computer-view';
import { Circuit } from '../src/logic/circuit';
import { Schematic } from '../src/ui/schematic';

function runCollect(source: string, maxCycles = 20_000, version: MicrocodeVersionId = 'flags', maxOutputs = 64) {
  const asm = assemble(source);
  expect(asm.errors).toEqual([]);
  const c = new Computer({ microcode: buildMicrocodeVersion(version), ram: asm.bytes });
  const outputs: number[] = [];
  for (let i = 0; i < maxCycles && outputs.length < maxOutputs; i++) {
    if (!c.tick()) break;
    if (c.lastTransfers.some((t) => t.signal === 'OI')) outputs.push(c.out);
  }
  return { c, outputs };
}

const hex16 = (w: number) => w.toString(16).padStart(4, '0');

// ===========================================================================
// Control word & microcode (docs/research/computer-spec.md)

describe('control word', () => {
  it('bit order matches the #defines in microcode-eeprom-with-flags.ino', () => {
    expect([...SIGNALS]).toEqual(['HLT', 'MI', 'RI', 'RO', 'IO', 'II', 'AI', 'AO', 'EO', 'SU', 'BI', 'OI', 'CE', 'CO', 'J', 'FI']);
    SIGNALS.forEach((s, i) => {
      expect(SIGNAL_BITS[s]).toBe(1 << (15 - i));
      expect(SIGNAL_INFO[s].bit).toBe(15 - i);
    });
    expect([HLT, MI, RI, RO, IO, II, AI, AO, EO, SU, BI, OI, CE, CO, J, FI].map(hex16)).toEqual(
      ['8000', '4000', '2000', '1000', '0800', '0400', '0200', '0100', '0080', '0040', '0020', '0010', '0008', '0004', '0002', '0001'],
    );
  });
  it('active-low lines are the ones Ben inverts with the two 74LS04s', () => {
    const inverted = SIGNALS.filter((s) => SIGNAL_INFO[s].activeLowInHardware);
    expect(inverted).toEqual(['MI', 'RO', 'IO', 'II', 'AI', 'AO', 'EO', 'BI', 'CO', 'J', 'FI']);
  });
  it('formats and parses control words', () => {
    expect(formatControlWord(MI | CO)).toBe('MI|CO');
    expect(formatControlWord(0)).toBe('—');
    expect(parseControlWord('io|ai')).toBe(IO | AI);
    expect(parseControlWord('ΣO, ai')).toBe(EO | AI);
    expect(parseControlWord('—')).toBe(0);
    expect(() => parseControlWord('XX')).toThrow();
  });
});

/** Spec section 12: microcode words T0..T4 for the final (flags) version, flags = 0. */
const FINAL_WORDS: Record<number, number[]> = {
  0b0000: [0x4004, 0x1408, 0, 0, 0],
  0b0001: [0x4004, 0x1408, 0x4800, 0x1200, 0],
  0b0010: [0x4004, 0x1408, 0x4800, 0x1020, 0x0281],
  0b0011: [0x4004, 0x1408, 0x4800, 0x1020, 0x02c1],
  0b0100: [0x4004, 0x1408, 0x4800, 0x2100, 0],
  0b0101: [0x4004, 0x1408, 0x0a00, 0, 0],
  0b0110: [0x4004, 0x1408, 0x0802, 0, 0],
  0b0111: [0x4004, 0x1408, 0, 0, 0],
  0b1000: [0x4004, 0x1408, 0, 0, 0],
  0b1110: [0x4004, 0x1408, 0x0110, 0, 0],
  0b1111: [0x4004, 0x1408, 0x8000, 0, 0],
};
const FETCH_ONLY = [0x4004, 0x1408, 0, 0, 0];

function expectedWords(version: MicrocodeVersionId, op: number, flags: number): number[] {
  const has: Record<MicrocodeVersionId, number[]> = {
    'control-logic': [1, 2, 14, 15],
    arduino: [1, 2, 3, 14, 15],
    'more-instructions': [1, 2, 3, 4, 5, 6, 14, 15],
    flags: [1, 2, 3, 4, 5, 6, 7, 8, 14, 15],
  };
  if (!has[version].includes(op)) return FETCH_ONLY;
  let w = [...(FINAL_WORDS[op] ?? FETCH_ONLY)];
  if (version !== 'flags') w = w.map((x) => x & ~FI);
  if (version === 'flags' && op === 0b0111 && flags & 1) w[2] = IO | J;
  if (version === 'flags' && op === 0b1000 && flags & 2) w[2] = IO | J;
  return w;
}

describe('microcode', () => {
  for (const version of Object.keys(MICROCODE_VERSIONS) as MicrocodeVersionId[]) {
    it(`${version}: every (flags, opcode, step) word matches Ben's table`, () => {
      const mc = buildMicrocodeVersion(version);
      for (let f = 0; f < 4; f++)
        for (let op = 0; op < 16; op++) {
          const got = [0, 1, 2, 3, 4].map((s) => mc[microIndex(f, op, s)]);
          expect(got.map(hex16), `flags ${f} opcode ${op}`).toEqual(expectedWords(version, op, f).map(hex16));
          for (let s = 5; s < 8; s++) expect(mc[microIndex(f, op, s)]).toBe(0); // unreachable steps
        }
    });
  }
  it('versions map to the videos that introduce them', () => {
    expect(Object.values(MICROCODE_VERSIONS).map((v) => [v.id, v.video])).toEqual([['control-logic', 38], ['arduino', 40], ['more-instructions', 41], ['flags', 44]]);
  });
  it('EEPROM image matches the bytes Ben reads back (fetch steps 40 14 / 04 08)', () => {
    const img = microcodeEepromImage(buildMicrocode());
    expect(Array.from(img.slice(0x000, 0x010))).toEqual([0x40, 0x14, 0, 0, 0, 0, 0, 0, 0x40, 0x14, 0x48, 0x12, 0, 0, 0, 0]);
    expect(Array.from(img.slice(0x080, 0x090))).toEqual([0x04, 0x08, 0, 0, 0, 0, 0, 0, 0x04, 0x08, 0, 0, 0, 0, 0, 0]);
  });
  it('EEPROM image is byte-identical to microcode-eeprom-with-flags.ino (SHA-256 from the research notes)', async () => {
    const img = microcodeEepromImage(buildMicrocode());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', img.slice(0, 1024)));
    expect(Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')).toBe('e405e87f15b00258a7424222d490eda73c5e767ba17cb525cda72c901fbe6335');
    expect(img.slice(1024).every((b) => b === 0)).toBe(true); // A10 = GND: never addressed
  });
  it('EEPROM address = ZF<<9 | CF<<8 | bytesel<<7 | opcode<<3 | step', () => {
    const mc = buildMicrocode();
    const img = microcodeEepromImage(mc);
    // JC (0111) step 2 with CF=1: high byte at 0x13A = 0x08 (IO), low byte at 0x1BA = 0x02 (J)
    expect([img[(0 << 9) | (1 << 8) | (0 << 7) | (0b0111 << 3) | 2], img[(1 << 8) | (1 << 7) | (0b0111 << 3) | 2]]).toEqual([0x08, 0x02]);
    // ...and nothing with CF=0
    expect([img[(0b0111 << 3) | 2], img[(1 << 7) | (0b0111 << 3) | 2]]).toEqual([0, 0]);
    // JZ (1000) step 2 with ZF=1
    expect(img[(1 << 9) | (0b1000 << 3) | 2]).toBe(0x08);
    for (let f = 0; f < 4; f++) for (let op = 0; op < 16; op++) for (let s = 0; s < 8; s++)
      expect(controlWordFromEeprom(img, f, op, s)).toBe(mc[microIndex(f, op, s)]);
  });
  it('the pre-flags (Arduino) image has the high bytes at 0-127 and the low bytes at 128-255', () => {
    const mc = buildMicrocodeVersion('arduino');
    const img = microcodeEepromImage(mc);
    for (let a = 0; a < 128; a++) {
      const w = mc[microIndex(0, a >> 3, a & 7)];
      expect(img[a]).toBe(w >> 8);
      expect(img[a + 128]).toBe(w & 0xff);
    }
  });
  it('JC/JZ are 5-cycle NOPs when not taken', () => {
    const { c } = runCollect('JC 5\nJZ 5\nHLT\n5: OUT', 200);
    expect(c.halted).toBe(true);
    expect(c.pc).toBe(3);
    expect(c.risingEdges).toBe(12);
  });
});

// ===========================================================================
// Clock-level behaviour

describe('step counter and clock edges', () => {
  it('advances on the falling edge only, 0..4 then back to 0', () => {
    const c = new Computer();
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      c.halfCycle(); // rise
      expect(c.clk).toBe(1);
      seen.push(c.step); // unchanged by the rising edge
      c.halfCycle(); // fall
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
    expect(c.instructions).toBe(2);
  });
  it("Ben's first 6-step version (reset on O6) runs T0..T5", () => {
    const c = new Computer({ stepsPerInstruction: 6 });
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      seen.push(c.step);
      c.tick();
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 0]);
  });
  it('fetch takes two cycles and increments PC', () => {
    const c = new Computer({ ram: [0x1e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0] });
    c.tick(); // T0: MI|CO
    expect(c.mar).toBe(0);
    expect(c.step).toBe(1);
    c.tick(); // T1: RO|II|CE
    expect(c.ir).toBe(0x1e);
    expect(c.pc).toBe(1);
    c.tick(); // T2: IO|MI
    expect(c.mar).toBe(14);
    c.tick(); // T3: RO|AI
    expect(c.a).toBe(7);
    c.tick(); // T4
    expect(c.step).toBe(0);
    expect(c.instructions).toBe(1);
  });
  it('28+14: OUT on rising edge 13, halt after 17 rising edges at T2', () => {
    const c = new Computer({ microcode: buildMicrocodeVersion('control-logic'), ram: assemble(PROGRAM_BY_ID.get('add')!.source).bytes });
    let outEdge = 0;
    for (let i = 1; i <= 30; i++) {
      if (!c.tick()) break;
      if (c.lastTransfers.some((t) => t.signal === 'OI')) outEdge = i;
    }
    expect(outEdge).toBe(13);
    expect(c.risingEdges).toBe(17);
    expect(c.step).toBe(2);
    expect(c.ir).toBe(0xf0);
    expect([c.a, c.b, c.flagC, c.flagZ]).toEqual([42, 14, 0, 0]);
  });
  it('every register latches the pre-edge bus; the combinational ALU follows afterwards', () => {
    const c = new Computer();
    c.a = 10;
    c.b = 3;
    c.setManualControl(EO | AI | FI);
    c.tick();
    expect(c.a).toBe(13); // latched 10 + 3 once, no runaway
    expect(c.alu.value).toBe(16);
    c.tick();
    expect(c.a).toBe(16);
    c.setManualControl(EO | AI | SU | FI);
    c.a = 3;
    c.tick();
    expect([c.a, c.flagC, c.flagZ]).toEqual([0, 1, 1]); // flags from the pre-edge 3 - 3
  });
  it('the PC loads only BUS 0-3 and a load (J) wins over count (CE)', () => {
    const c = new Computer();
    c.busInput = 0xa7;
    c.setManualControl(J | CE | MI);
    c.tick();
    expect(c.pc).toBe(7);
    expect(c.mar).toBe(7);
    c.busInput = null;
    c.setManualControl(CE);
    c.pc = 15;
    c.tick();
    expect(c.pc).toBe(0); // wraps
  });
  it('OUT latches on OI, and only the rising edge matters', () => {
    const c = new Computer();
    c.a = 99;
    c.setManualControl(AO | OI);
    c.halfCycle();
    expect(c.out).toBe(99);
    c.a = 5;
    c.halfCycle(); // falling edge: nothing latches
    expect(c.out).toBe(99);
  });
});

describe('HLT', () => {
  it('halts and ignores clock pulses until reset', () => {
    const { c, outputs } = runCollect(PROGRAM_BY_ID.get('add')!.source, 1000, 'control-logic');
    expect(outputs).toEqual([42]);
    expect(c.halted).toBe(true);
    expect(c.clk).toBe(0);
    const cycles = c.cycles;
    expect(c.tick()).toBe(false);
    expect(c.halfCycle()).toBe(false);
    expect(c.cycles).toBe(cycles);
    c.reset();
    expect(c.halted).toBe(false);
    expect(c.controlWord).toBe(MI | CO);
    expect(c.pc).toBe(0);
  });
  it('re-burning the microcode with HLT on the current step while the clock is high drops the clock', () => {
    const m = new Machine();
    m.loadSource('NOP\nNOP');
    m.pulse();
    m.pulse(); // now at T2 of NOP
    m.halfPulse();
    expect(m.computer.clk).toBe(1);
    m.editMicrocode(0, 2, HLT);
    // the AND gate pulls CLK low; ~CLK rising clocks the step counter on to T3
    expect([m.computer.clk, m.computer.step, m.computer.halted]).toEqual([0, 3, false]);
  });
  it('a manual HLT while the clock is high drops the clock (AND gate)', () => {
    const c = new Computer();
    c.setManualControl(0);
    c.halfCycle();
    expect(c.clk).toBe(1);
    c.setManualControl(HLT);
    expect(c.clk).toBe(0);
    expect(c.halfCycle()).toBe(false);
  });
});

describe('reset', () => {
  it('clears A, B, IR, MAR, flags, PC, OUT and step but not RAM', () => {
    const c = new Computer({ ram: [1, 2, 3] });
    Object.assign(c, { a: 1, b: 2, ir: 3, mar: 4, pc: 5, out: 6, step: 3, flagC: 1, flagZ: 1 });
    c.reset();
    expect([c.a, c.b, c.ir, c.mar, c.pc, c.out, c.step, c.flagC, c.flagZ]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(c.ram.slice(0, 3))).toEqual([1, 2, 3]);
  });
  it('before the flags video the flags were not on the reset line', () => {
    const c = new Computer({ resetClears: ['a', 'b', 'ir', 'mar', 'pc', 'step', 'out'] });
    c.flagC = 1;
    c.reset();
    expect(c.flagC).toBe(1);
  });
  it('a running program restarts by itself after reset (auto clock keeps going)', () => {
    const m = new Machine();
    m.loadSource(PROGRAM_BY_ID.get('add')!.source);
    m.setHz(100);
    m.start();
    for (let i = 0; i < 30; i++) m.frame(100);
    expect(m.computer.halted).toBe(true);
    m.reset();
    expect(m.running).toBe(true);
    for (let i = 0; i < 30; i++) m.frame(100);
    expect(m.outputLog).toEqual([42]);
  });
  it('fires reset observers (Computer and Machine)', () => {
    const m = new Machine();
    let n = 0;
    const off = m.onReset(() => n++);
    m.reset();
    m.loadSource('HLT');
    m.computer.reset();
    off();
    m.reset();
    expect(n).toBe(3);
  });
});

describe('bus', () => {
  it('is pulled down to 0 when idle, and the PC only drives BUS 0-3', () => {
    const c = new Computer();
    c.setManualControl(0);
    expect(c.bus).toMatchObject({ value: 0, drivers: [], driven: 0, floating: 0 });
    c.pc = 9;
    c.setManualControl(CO);
    expect(c.bus).toMatchObject({ value: 9, driven: 0x0f, floating: 0 });
  });
  it('without the pull-downs (before video 34) undriven lines float high', () => {
    const c = new Computer({ pullDowns: false });
    c.setManualControl(0);
    expect(c.bus).toMatchObject({ value: 0xff, floating: 0xff });
    c.setManualControl(AI);
    c.tick();
    expect(c.a).toBe(0xff); // "loading from an undriven bus gives 11111111"
    c.pc = 3;
    c.setManualControl(CO);
    expect(c.bus.value).toBe(0xf3);
    c.ir = 0x5a;
    c.setManualControl(IO); // the IR's 245 actively drives BUS 4-7 low
    expect(c.bus).toMatchObject({ value: 0x0a, floating: 0 });
    c.setManualControl(0);
    c.busInput = 0;
    c.busInputMask = 0b0000_0110; // jumpers to GND on bits 1 and 2 only
    expect(c.bus.value).toBe(0b1111_1001);
  });
  it('the IR puts only its operand nibble on the bus', () => {
    const c = new Computer();
    c.ir = 0x5a;
    c.setManualControl(IO);
    expect(c.bus.value).toBe(0x0a);
  });
  it('reports contention; LS-TTL lows win where drivers overlap', () => {
    const c = new Computer();
    c.a = 0b1111_0000;
    c.pc = 0b0011;
    c.setManualControl(parseControlWord('AO CO'));
    expect(c.bus.contention).toBe(true);
    expect(c.bus.drivers).toEqual(['a', 'pc']);
    expect(c.bus.value).toBe(0b1111_0000); // low nibble: A's 0s win; high nibble only A drives
  });
});

describe('RAM', () => {
  it('STA writes A at the MAR address on the T3 edge', () => {
    const { c } = runCollect('LDI 9\nSTA 13\nHLT', 100);
    expect(c.ram[13]).toBe(9);
  });
  it('writes during the RC pulse after the edge: with MI|RI the byte lands at the new address', () => {
    const c = new Computer();
    c.mar = 2;
    c.busInput = 0x35;
    c.setManualControl(MI | RI);
    c.tick();
    expect(c.mar).toBe(5);
    expect(c.ram[5]).toBe(0x35);
    expect(c.ram[2]).toBe(0);
    expect(c.lastTransfers.map((t) => t.signal)).toEqual(['MI', 'RI']);
  });
  it('the 74189 outputs float while writing, so RO|RI stores 0', () => {
    const c = new Computer({ ram: [0, 0, 0, 0x77] });
    c.mar = 3;
    c.setManualControl(RO | RI);
    c.tick();
    expect(c.ram[3]).toBe(0);
  });
  it('program mode: DIP switches address the RAM, the button writes, RI does nothing', () => {
    const c = new Computer();
    c.programMode = true;
    c.dipAddress = 9;
    c.dipData = 0xaa;
    expect(c.programWrite()).toBe(true);
    expect(c.ram[9]).toBe(0xaa);
    expect(c.ramAddress).toBe(9);
    c.setManualControl(RO | BI);
    c.tick();
    expect(c.b).toBe(0xaa); // RO reads the switch-selected address
    c.mar = 1;
    c.busInput = 0x11;
    c.setManualControl(RI);
    c.tick();
    expect(c.ram[1]).toBe(0);
    c.programMode = false;
    expect(c.programWrite()).toBe(false);
  });
});

describe('ALU and flags', () => {
  it('adds with carry and zero', () => {
    expect(computeAlu(28, 14, false)).toMatchObject({ value: 42, carry: 0, zero: 0 });
    expect(computeAlu(200, 56, false)).toMatchObject({ value: 0, carry: 1, zero: 1 });
    expect(computeAlu(255, 1, false)).toMatchObject({ value: 0, carry: 1, zero: 1 });
  });
  it('subtracts as A + ~B + 1, so carry = no borrow', () => {
    expect(computeAlu(5, 3, true)).toMatchObject({ value: 2, carry: 1 });
    expect(computeAlu(5, 5, true)).toMatchObject({ value: 0, carry: 1, zero: 1 });
    expect(computeAlu(3, 5, true)).toMatchObject({ value: 254, carry: 0 });
    expect(computeAlu(0, 1, true)).toMatchObject({ value: 255, carry: 0, zero: 0 });
    for (let x = 1; x < 256; x++) expect(computeAlu(x, 1, true).carry).toBe(1); // "anything except 0"
  });
  it('flags latch only on FI (ADD/SUB T4), from the pre-edge ALU result', () => {
    const { c } = runCollect('LDA 15\nADD 15\nHLT\n15: 128', 100);
    expect(c.a).toBe(0);
    expect(c.flagC).toBe(1);
    expect(c.flagZ).toBe(1);
    const r = runCollect('LDA 15\nADD 15\nLDI 3\nLDA 14\nSTA 13\nOUT\nHLT\n14: 7\n15: 128', 200);
    expect([r.c.flagC, r.c.flagZ]).toEqual([1, 1]); // LDI/LDA/STA/OUT leave them alone
  });
  it('count by tens: the carry lights at the wrap and clears on the next ADD', () => {
    const c = new Computer({ ram: assemble(PROGRAM_BY_ID.get('count-by-10')!.source).bytes });
    const log: [number, number][] = [];
    while (log.length < 28) {
      c.tick();
      if (c.lastTransfers.some((t) => t.signal === 'OI')) log.push([c.out, c.flagC]);
    }
    expect(log[24]).toEqual([250, 0]);
    expect(log[25]).toEqual([4, 1]);
    expect(log[26]).toEqual([14, 0]);
  });
});

describe('edge observers', () => {
  it('onRisingEdge gets the pre-edge state and the transfers; onFallingEdge the step change', () => {
    const c = new Computer({ ram: assemble('LDA 15\nHLT\n15: 77').bytes });
    const rises: RisingEdgeEvent[] = [];
    const falls: number[] = [];
    const off1 = c.onRisingEdge((e) => rises.push(e));
    const off2 = c.onFallingEdge((e) => falls.push(e.step));
    c.run(100);
    off1();
    off2();
    expect(rises.length).toBe(c.risingEdges);
    const t3 = rises[3];
    expect(t3.pre).toMatchObject({ step: 3, controlWord: RO | AI, a: 0, ramAddress: 15, ramValue: 77 });
    expect(t3.pre.bus).toMatchObject({ value: 77, drivers: ['ram'] });
    expect(t3.transfers).toEqual([{ signal: 'AI', from: 'ram', to: 'a', value: 77 }]);
    expect(falls.slice(0, 6)).toEqual([1, 2, 3, 4, 0, 1]);
    c.reset();
    c.run(10);
    expect(rises.length).toBeLessThan(c.risingEdges);
  });
  it('Machine passes them through and logs every OUT even at high speed', () => {
    const m = new Machine();
    m.loadSource(PROGRAM_BY_ID.get('count-by-3')!.source);
    let outs = 0;
    const off = m.onRisingEdge((e) => (outs += e.transfers.some((t) => t.signal === 'OI') ? 1 : 0));
    m.setHz(10_000);
    m.start();
    m.frame(100); // 2000 half-cycles in one frame
    off();
    expect(outs).toBeGreaterThan(50);
    expect(m.outputLog.length).toBe(outs);
  });
});

// ===========================================================================
// Display EEPROM (multiplexed-display.ino)

describe('display EEPROM', () => {
  it('is byte-identical to the sketch (C truncating division)', () => {
    const d = [0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b];
    const ref = new Uint8Array(2048);
    for (let v = 0; v <= 255; v++) {
      ref[v] = d[v % 10];
      ref[v + 256] = d[Math.trunc(v / 10) % 10];
      ref[v + 512] = d[Math.trunc(v / 100) % 10];
      ref[v + 768] = 0;
    }
    for (let v = -128; v <= 127; v++) {
      const b = v & 0xff;
      ref[b + 1024] = d[Math.abs(v) % 10];
      ref[b + 1280] = d[Math.abs(Math.trunc(v / 10)) % 10];
      ref[b + 1536] = d[Math.abs(Math.trunc(v / 100)) % 10];
      ref[b + 1792] = v < 0 ? 0x01 : 0;
    }
    expect(Array.from(displayEepromImage())).toEqual(Array.from(ref));
    expect(Array.from(DEC_DIGITS)).toEqual(d);
  });
  it("shows Ben's values, with leading zeros and no blanking", () => {
    expect(displayText(42, false)).toBe(' 042');
    expect(displayText(0, false)).toBe(' 000');
    expect(displayText(255, false)).toBe(' 255');
    expect(displayText(255, true)).toBe('-001');
    expect(displayText(128, true)).toBe('-128');
    expect(displayText(127, true)).toBe(' 127');
    expect(displayText(0b11110011, true)).toBe('-013');
    expect(displayText(0b11000010, true)).toBe('-062');
    expect(displayText(0b11110011, false)).toBe(' 243');
  });
});

// ===========================================================================
// Assembler

describe('assembler', () => {
  it('assembles Ben-style listings', () => {
    const r = assemble('LDA 14\nADD 15\nOUT\nHLT\n14: 28\n15: 14');
    expect(r.errors).toEqual([]);
    expect(r.bytes.slice(0, 4)).toEqual([0x1e, 0x2f, 0xe0, 0xf0]);
    expect(r.bytes[14]).toBe(28);
    expect(r.bytes[15]).toBe(14);
  });
  it("understands the binary notation Ben uses on screen", () => {
    const r = assemble('0000: 0001 1110\n0001: 0010 1111\n0010: 1110 0000\n0011: 11110000\n1110: 0001 1100\n1111: 0000 1110');
    expect(r.errors).toEqual([]);
    expect(r.bytes).toEqual(assemble(PROGRAM_BY_ID.get('add')!.source).bytes);
    expect(assemble('LDA 1110\nJMP 0011').bytes.slice(0, 2)).toEqual([0x1e, 0x63]);
    expect(assemble('x: .db 0001 1100').bytes[0]).toBe(28);
  });
  it('supports labels, .org, .db and number formats', () => {
    const r = assemble('top: LDA x\nJMP top\n.org 14\nx: .db 0x1F\n15: -1');
    expect(r.errors).toEqual([]);
    expect(r.bytes[0]).toBe(0x1e);
    expect(r.bytes[1]).toBe(0x60);
    expect(r.bytes[14]).toBe(31);
    expect(r.bytes[15]).toBe(255);
    expect(assemble('OUT 0\nHLT 0').bytes.slice(0, 2)).toEqual([0xe0, 0xf0]);
  });
  it('reports errors with line numbers', () => {
    const r = assemble('LDA\nFOO 3\nLDA 16\nJMP nowhere');
    expect(r.errors.map((e) => e.line)).toEqual([2, 1, 3, 4]);
    expect(assemble('LDI 16').errors.length).toBe(1); // LDI can only load 0-15
    expect(assemble('.org 15\nNOP\nNOP').errors[0].message).toMatch(/16 bytes/);
    expect(assemble('3: NOP\n3: NOP').errors[0].message).toMatch(/already used/);
  });
  it('disassembles', () => {
    expect(disassemble(0x1e)).toBe('LDA 14');
    expect(disassemble(0xe0)).toBe('OUT');
    expect(disassemble(0x95)).toBe('??? 5');
  });
});

// ===========================================================================
// Example programs vs the listings in the research notes

/** Byte listings from docs/research/computer-spec.md ("Example programs"). */
const BEN_LISTINGS: Record<string, Record<number, number>> = {
  add: { 0: 0x1e, 1: 0x2f, 2: 0xe0, 3: 0xf0, 14: 0x1c, 15: 0x0e },
  'add-sub': { 0: 0x1f, 1: 0x2e, 2: 0x3d, 3: 0xe0, 4: 0xf0, 13: 0x07, 14: 0x06, 15: 0x05 },
  'count-by-3': { 0: 0x53, 1: 0x4f, 2: 0x50, 3: 0x2f, 4: 0xe0, 5: 0x63 },
  'count-by-10': { 0: 0x2f, 1: 0xe0, 2: 0x60, 15: 0x0a },
  'up-down': { 0: 0xe0, 1: 0x2f, 2: 0x74, 3: 0x60, 4: 0x3f, 5: 0xe0, 6: 0x80, 7: 0x64, 15: 0x01 },
  multiply: { 0: 0x1e, 1: 0x3c, 2: 0x76, 3: 0x1d, 4: 0xe0, 5: 0xf0, 6: 0x4e, 7: 0x1d, 8: 0x2f, 9: 0x4d, 10: 0x60, 12: 0x01, 13: 0x00, 14: 0x03, 15: 0x05 },
  'multiply-7x8': { 0: 0x1e, 1: 0x3c, 2: 0x76, 3: 0x1d, 4: 0xe0, 5: 0xf0, 6: 0x4e, 7: 0x1d, 8: 0x2f, 9: 0x4d, 10: 0x60, 12: 0x01, 13: 0x00, 14: 0x07, 15: 0x08 },
  'fibonacci-ben': { 0: 0x51, 1: 0x4e, 2: 0x50, 3: 0xe0, 4: 0x2e, 5: 0x4f, 6: 0x1e, 7: 0x4d, 8: 0x1f, 9: 0x4e, 10: 0x1d, 11: 0x70, 12: 0x63 },
};

describe('example programs', () => {
  for (const [id, listing] of Object.entries(BEN_LISTINGS)) {
    it(`${id} assembles to the bytes Ben entered`, () => {
      const p = PROGRAM_BY_ID.get(id);
      expect(p, id).toBeDefined();
      const r = assemble(p!.source);
      expect(r.errors).toEqual([]);
      for (const [addr, byte] of Object.entries(listing)) expect(r.bytes[Number(addr)], `${id} @${addr}`).toBe(byte);
    });
  }

  for (const p of PROGRAMS) {
    it(`${p.id} produces ${p.expectedOutputs?.join(',')}`, () => {
      const { c, outputs } = runCollect(p.source, 50_000, p.requires, p.expectedOutputs?.length ?? 1);
      expect(outputs.slice(0, p.expectedOutputs!.length)).toEqual(p.expectedOutputs);
      if (p.halts) {
        c.run(10_000);
        expect(c.halted).toBe(true);
      }
    });
  }

  it('programs are listed in playlist order and only use instructions their microcode has', () => {
    const order: MicrocodeVersionId[] = ['control-logic', 'arduino', 'more-instructions', 'flags'];
    const bens = PROGRAMS.filter((p) => p.id in BEN_LISTINGS);
    expect(bens.map((p) => p.video)).toEqual([...bens.map((p) => p.video)].sort((a, b) => a - b));
    // each program needs the microcode of (or before) the video it comes from
    for (const p of PROGRAMS) expect(MICROCODE_VERSIONS[p.requires].video, p.id).toBeLessThanOrEqual(p.video);
    expect(order.indexOf(PROGRAM_BY_ID.get('up-down')!.requires)).toBe(3);
    // the 28+14 program also runs on the very first microcode
    expect(runCollect(PROGRAM_BY_ID.get('add')!.source, 100, 'control-logic').outputs).toEqual([42]);
  });

  it("multiply leaves x = 0 and the product in RAM[13] (so Ben resets it by hand)", () => {
    const { outputs, c } = runCollect(PROGRAM_BY_ID.get('multiply-7x8')!.source, 20_000);
    expect(outputs).toEqual([56]);
    expect(c.ram[14]).toBe(0);
    expect(c.ram[13]).toBe(56);
  });

  it('up-down turns around twice: ..254,255,255,254.. and ..1,0,0,1..', () => {
    const { outputs } = runCollect(PROGRAM_BY_ID.get('up-down')!.source, 400_000, 'flags', 1030);
    const peak = outputs.indexOf(255);
    expect(peak).toBe(255);
    expect(outputs.slice(peak - 1, peak + 3)).toEqual([254, 255, 255, 254]);
    const trough = outputs.indexOf(0, peak);
    expect(outputs.slice(trough - 1, trough + 3)).toEqual([1, 0, 0, 1]);
  });

  it('older microcode versions do not have newer instructions', () => {
    const mc = buildMicrocodeVersion('control-logic');
    expect(mc[microIndex(0, 0b0101, 2)]).toBe(0); // no LDI yet
    const mc2 = buildMicrocodeVersion('more-instructions');
    expect(mc2[microIndex(0, 0b0101, 2)]).toBe(IO | AI);
    expect(mc2[microIndex(1, 0b0111, 2)]).toBe(0); // no JC yet
  });
});

// ===========================================================================
// Machine

describe('Machine', () => {
  it('logs each OUT once, whether pulsed whole or by halves', () => {
    const m = new Machine({ microcodeVersion: 'flags' });
    m.loadSource(PROGRAM_BY_ID.get('add')!.source);
    for (let i = 0; i < 40; i++) m.halfPulse();
    expect(m.outputLog).toEqual([42]);
    m.reset();
    for (let i = 0; i < 20; i++) m.pulse();
    expect(m.outputLog).toEqual([42]);
  });
  it('auto clock advances by wall-clock time and stops at HLT', () => {
    const m = new Machine();
    m.loadSource(PROGRAM_BY_ID.get('add')!.source);
    m.setHz(100);
    m.start();
    m.frame(100); // 10 cycles
    expect(m.computer.cycles).toBe(10);
    for (let i = 0; i < 20; i++) m.frame(100);
    expect(m.computer.halted).toBe(true);
    expect(m.outputLog).toEqual([42]);
  });
  it('remembers the last loaded source', () => {
    const m = new Machine();
    expect(m.lastSource).toBeNull();
    m.loadSource('LDI 3\nOUT\nHLT');
    expect([m.lastSource, m.sourceVersion]).toEqual(['LDI 3\nOUT\nHLT', 1]);
    m.loadSource('FOO');
    expect(m.sourceVersion).toBe(2);
    expect(m.lastAsm?.errors.length).toBe(1);
  });
  it('editMicrocode re-burns the EEPROM image (dropping CE from T1 breaks fetch)', () => {
    const m = new Machine();
    m.loadSource('LDI 1\nLDI 2\nOUT\nHLT');
    m.editMicrocode(0b0101, 1, RO | II); // LDI's fetch T1 without CE
    for (let i = 0; i < 40; i++) m.pulse();
    // the first fetch still uses the NOP row (IR = 0 after reset); after that the
    // PC never advances, so the computer keeps re-fetching "LDI 2" from address 1
    expect([m.computer.pc, m.computer.ir, m.computer.a]).toEqual([1, 0x52, 2]);
    expect(m.outputLog).toEqual([]);
  });
});

// ===========================================================================
// Integration: chapters ↔ labs, and every lab mounts and cleans up

describe('integration: chapter map', () => {
  const labFiles = Object.keys(import.meta.glob('../src/labs/**/*.lab.ts'));
  it('lists all 44 playlist videos in order, each with a lab id', () => {
    expect(VIDEOS.map((v) => v.index)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
    expect(new Set(VIDEOS.map((v) => v.youtubeId)).size).toBe(44);
    expect(CHAPTERS.flatMap((c) => c.videos).length).toBe(44);
  });
  it('every lab id in chapters.ts has a *.lab.ts that registers it, and vice versa', () => {
    const missing = LAB_IDS.filter((id) => !LABS.has(id));
    expect(missing, `labs without a *.lab.ts: ${missing.join(', ')}`).toEqual([]);
    const orphan = [...LABS.keys()].filter((id) => !LAB_IDS.includes(id));
    expect(orphan, `labs not referenced by chapters.ts: ${orphan.join(', ')}`).toEqual([]);
    expect(labFiles.length).toBe(LAB_IDS.length);
    for (const id of LAB_IDS) expect(labFiles.some((f) => f.endsWith(`/${id}.lab.ts`)), `file for ${id}`).toBe(true);
  });
  it("the app's lazy loader finds every lab by its file name", async () => {
    for (const id of LAB_IDS) {
      expect(hasLab(id), id).toBe(true);
      expect((await loadLab(id))?.id).toBe(id);
    }
    expect(hasLab('no-such-lab')).toBe(false);
    expect(await loadLab('no-such-lab')).toBeUndefined();
  });
  it('every lab has a title and a summary', () => {
    for (const lab of LABS.values()) {
      expect(lab.title.length, lab.id).toBeGreaterThan(2);
      expect(lab.summary.length, lab.id).toBeGreaterThan(40);
    }
  });
});

// ---- a tiny fake DOM (node environment, no jsdom) --------------------------

type FListener = (e: FEvent) => void;
interface FEvent { type: string; target: unknown; key?: string; defaultPrevented: boolean; preventDefault(): void; stopPropagation(): void; ctrlKey?: boolean; metaKey?: boolean }
let docRoot: FElement | null = null;

class FNode {
  parentNode: FElement | null = null;
  nodeType = 1;
  get parentElement() { return this.parentNode; }
  get textContent(): string { return ''; }
  set textContent(_v: string) {}
  remove() { this.parentNode?.removeChild(this); }
  get nextSibling(): FNode | null { const p = this.parentNode; return p ? (p.childNodes[p.childNodes.indexOf(this) + 1] ?? null) : null; }
  before(...ns: (FNode | string)[]) { this.parentNode?.insertNodes(this.parentNode.childNodes.indexOf(this), ns); }
  after(...ns: (FNode | string)[]) { this.parentNode?.insertNodes(this.parentNode.childNodes.indexOf(this) + 1, ns); }
  get isConnected(): boolean { let n: FNode = this; while (n.parentNode) n = n.parentNode; return n === docRoot; }
}
class FText extends FNode {
  constructor(public data: string) { super(); this.nodeType = 3; }
  override get textContent() { return this.data; }
  override set textContent(v: string) { this.data = String(v); }
}
class FClassList {
  constructor(private el: FElement) {}
  private get list() { return (this.el.attributes.class ?? '').split(/\s+/).filter(Boolean); }
  private set list(v: string[]) { this.el.attributes.class = v.join(' '); }
  add(...c: string[]) { const l = this.list; for (const x of c) if (!l.includes(x)) l.push(x); this.list = l; }
  remove(...c: string[]) { this.list = this.list.filter((x) => !c.includes(x)); }
  contains(c: string) { return this.list.includes(c); }
  toggle(c: string, force?: boolean) { const on = force ?? !this.contains(c); if (on) this.add(c); else this.remove(c); return on; }
}
function fakeContext(canvas: FElement) {
  const store: Record<string | symbol, unknown> = { canvas, lineWidth: 1, font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, textAlign: 'start', textBaseline: 'alphabetic' };
  return new Proxy(store, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s: string) => ({ width: String(s).length * 6 }) : () => undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
class FElement extends FNode {
  childNodes: FNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty(this: Record<string, string>, k: string, v: string) { this[k] = v; }, removeProperty(this: Record<string, string>, k: string) { delete this[k]; } };
  dataset: Record<string, string> = {};
  listeners: Record<string, FListener[]> = {};
  classList = new FClassList(this);
  private _value = '';
  get value(): string { return this._value; }
  set value(v: string) { this._value = String(v); }
  checked = false; disabled = false; type = ''; selected = false; title = ''; width = 300; height = 150;
  offsetWidth = 0; clientWidth = 320; clientHeight = 200; scrollTop = 0; spellcheck = false; rows = 2; tabIndex = 0;
  private ctx: unknown = null;
  constructor(public tagName: string) { super(); }
  get className() { return this.attributes.class ?? ''; }
  set className(v: string) { this.attributes.class = v; }
  get children() { return this.childNodes.filter((n): n is FElement => n instanceof FElement); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  get childElementCount() { return this.children.length; }
  override get textContent(): string { return this.childNodes.map((n) => n.textContent).join(''); }
  override set textContent(v: string) { this.replaceChildren(String(v)); }
  setAttribute(k: string, v: string) { this.attributes[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  getAttribute(k: string) { return this.attributes[k] ?? null; }
  hasAttribute(k: string) { return k in this.attributes; }
  removeAttribute(k: string) { delete this.attributes[k]; }
  private adopt(n: FNode | string): FNode { const node = typeof n === 'string' ? new FText(n) : n; node.parentNode?.removeChild(node); node.parentNode = this; return node; }
  insertNodes(at: number, ns: (FNode | string)[]) { const adopted = ns.map((n) => this.adopt(n)); this.childNodes.splice(Math.max(0, Math.min(at, this.childNodes.length)), 0, ...adopted); }
  appendChild<T extends FNode>(n: T): T { this.childNodes.push(this.adopt(n)); return n; }
  append(...ns: (FNode | string)[]) { for (const n of ns) this.childNodes.push(this.adopt(n)); }
  prepend(...ns: (FNode | string)[]) { this.insertNodes(0, ns); }
  insertBefore<T extends FNode>(n: T, ref: FNode | null): T {
    n.parentNode?.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    this.insertNodes(i < 0 ? this.childNodes.length : i, [n]);
    return n;
  }
  replaceChildren(...ns: (FNode | string)[]) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.append(...ns); }
  removeChild<T extends FNode>(n: T): T { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  addEventListener(t: string, f: FListener) { (this.listeners[t] ??= []).push(f); }
  removeEventListener(t: string, f: FListener) { this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== f); }
  dispatchEvent(e: FEvent) { let stop = false; e.stopPropagation = () => (stop = true); for (let n: FElement | null = this; n && !stop; n = n.parentNode) for (const f of [...(n.listeners[e.type] ?? [])]) f(e); return !e.defaultPrevented; }
  focus() {} blur() {} select() {} click() { fire(this, 'click'); }
  getContext() { return this.tagName === 'canvas' ? (this.ctx ??= fakeContext(this)) : null; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 320, height: 200, right: 320, bottom: 200 }; }
  matches(sel: string): boolean { return sel.split(',').some((part) => matchesComplex(this, part.trim())); }
  closest(sel: string): FElement | null { for (let n: FElement | null = this; n; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel: string): FElement[] { const out: FElement[] = []; const walk = (el: FElement) => { for (const c of el.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
}
class FSVGElement extends FElement {}
class FSelect extends FElement {
  override get value(): string { const opts = this.querySelectorAll('option'); return (opts.find((o) => o.selected) ?? opts[0])?.value ?? ''; }
  override set value(v: string) { for (const o of this.querySelectorAll('option')) o.selected = o.value === v; }
}
function matchesCompound(el: FElement, comp: string): boolean {
  const m = comp.match(/^([a-zA-Z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/);
  if (!m) return false;
  const [, tag, classes, attrs] = m;
  if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const c of classes.split('.').filter(Boolean)) if (!el.classList.contains(c)) return false;
  for (const a of attrs.match(/\[[^\]]+\]/g) ?? []) {
    const [k, v] = a.slice(1, -1).split('=');
    const val = k.startsWith('data-') ? el.dataset[k.slice(5)] : el.attributes[k];
    if (val === undefined || (v !== undefined && val !== v.replace(/["']/g, ''))) return false;
  }
  return true;
}
function matchesComplex(el: FElement, sel: string): boolean {
  const parts = sel.split(/\s+/).filter(Boolean);
  if (!parts.length || !matchesCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let n = el.parentNode; n && i >= 0; n = n.parentNode) if (matchesCompound(n, parts[i])) i--;
  return i < 0;
}

const raf = new Map<number, (t: number) => void>();
let rafId = 0;
let fakeNow = 0;
const windowListeners: Record<string, FListener[]> = {};
const G = globalThis as Record<string, unknown>;
const savedGlobals: Record<string, unknown> = {};
const FAKE_GLOBALS = ['document', 'window', 'Node', 'SVGElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'location', 'getComputedStyle'];

function installFakeDom() {
  for (const k of FAKE_GLOBALS) savedGlobals[k] = G[k];
  docRoot = new FElement('html');
  const body = new FElement('body');
  docRoot.appendChild(body);
  G.Node = FNode;
  G.SVGElement = FSVGElement;
  G.document = {
    createElement: (t: string) => (t === 'select' ? new FSelect(t) : new FElement(t)),
    createElementNS: (_ns: string, t: string) => new FSVGElement(t),
    createTextNode: (s: string) => new FText(s),
    activeElement: null, title: '', documentElement: docRoot, body,
  };
  G.window = {
    addEventListener: (t: string, f: FListener) => (windowListeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: FListener) => (windowListeners[t] = (windowListeners[t] ?? []).filter((x) => x !== f)),
    scrollTo: () => {},
  };
  G.requestAnimationFrame = (cb: (t: number) => void) => { raf.set(++rafId, cb); return rafId; };
  G.cancelAnimationFrame = (id: number) => raf.delete(id);
  G.location = { hash: '' };
  G.getComputedStyle = () => ({ getPropertyValue: () => '' });
  fakeNow = performance.now();
}
function uninstallFakeDom() {
  for (const k of FAKE_GLOBALS) {
    if (savedGlobals[k] === undefined) delete G[k];
    else G[k] = savedGlobals[k];
  }
}
function frames(n: number, dt = 16) {
  for (let i = 0; i < n; i++) {
    fakeNow += dt;
    const cbs = [...raf.values()];
    raf.clear();
    for (const cb of cbs) cb(fakeNow);
  }
}
function fire(el: FElement, type: string, key?: string) {
  const e: FEvent = { type, target: el, key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  return el.dispatchEvent(e);
}
const windowListenerCount = () => Object.values(windowListeners).reduce((n, l) => n + l.length, 0);
const asEl = (x: unknown) => x as unknown as FElement;

/** Click every button and switch, flip every checkbox, try every select option, move every slider. */
function pokeEverything(root: FElement) {
  for (const b of root.querySelectorAll('button')) {
    if (!b.isConnected || b.disabled) continue;
    fire(b, 'pointerdown');
    frames(1);
    fire(b, 'pointerup');
    fire(b, 'click');
    frames(2);
  }
  for (const sw of root.querySelectorAll('.sch-switch')) {
    if (!sw.isConnected) continue;
    fire(sw, 'pointerdown');
    fire(sw, 'pointerup');
    fire(sw, 'click');
    frames(1);
  }
  for (const inp of root.querySelectorAll('input')) {
    if (!inp.isConnected) continue;
    if (inp.type === 'checkbox') {
      inp.checked = !inp.checked;
      fire(inp, 'change');
      frames(2);
    } else if (inp.type === 'range') {
      inp.value = '700';
      fire(inp, 'input');
      frames(1);
    }
  }
  for (const sel of root.querySelectorAll('select')) {
    if (!sel.isConnected) continue;
    for (const o of sel.querySelectorAll('option')) {
      sel.value = o.value;
      fire(sel, 'change');
      frames(2);
    }
  }
}

describe('integration: every lab mounts, runs and cleans up (fake DOM)', () => {
  beforeAll(installFakeDom);
  afterAll(uninstallFakeDom);

  for (const id of LAB_IDS) {
    it(id, () => {
      raf.clear();
      const lab = LABS.get(id);
      expect(lab, id).toBeDefined();
      const root = new FElement('div');
      asEl((G.document as { body: unknown }).body).appendChild(root);
      const listenersBefore = windowListenerCount();
      const cleanup = lab!.mount(asEl(root) as unknown as HTMLElement);
      frames(30);
      expect(root.textContent.length, 'renders something').toBeGreaterThan(50);
      pokeEverything(root);
      frames(30);
      expect(root.textContent, 'no NaN / undefined in the text').not.toMatch(/\bNaN\b|\bundefined\b/);
      if (typeof cleanup === 'function') cleanup();
      root.remove();
      frames(2); // anything still scheduling frames after cleanup is a leak
      expect(raf.size, 'animation frames left after cleanup').toBe(0);
      expect(windowListenerCount(), 'window listeners left after cleanup').toBe(listenersBefore);
    });
  }
});

describe('shared UI pieces (fake DOM)', () => {
  beforeAll(installFakeDom);
  afterAll(uninstallFakeDom);

  it('Schematic: viewBox origin, layers, bus lines, flipped gates, pin numbers, exact autoUpdate cleanup', () => {
    raf.clear();
    const c = new Circuit();
    const a = c.input('a', 0);
    const sch = new Schematic(c, { width: 300, height: 100, x0: -20 });
    const svg = asEl(sch.el);
    expect(svg.attributes.viewBox).toBe('-20 0 300 100');
    expect(svg.children.map((g) => g.attributes.class)).toEqual(['sch-back', 'sch-buses', 'sch-wires', 'sch-parts', 'sch-top']);
    const g = sch.gate('NOT', { x: 100, y: 50 }, { flip: true, label: 'U1' });
    expect(g.output).toEqual({ x: 50, y: 50 });
    expect(g.inputs[0]).toEqual({ x: 110, y: 50 });
    const chip = sch.chip({ x: 150, y: 10 }, { label: '74LS173', left: [{ name: '1D', pin: 14, net: a }] });
    expect(asEl(chip.el).querySelector('.pin-num')?.textContent).toBe('14');
    const bus = sch.bus([[0, 90], [280, 90]], { label: [10, 80] });
    bus.set('floating', 'Z');
    expect(asEl(bus.el).classList.contains('floating')).toBe(true);
    expect(bus.text?.textContent).toBe('Z');
    bus.set('active', '42');
    expect(asEl(bus.el).attributes.class).toBe('sch-bus active');
    sch.box([140, 0], { width: 150, height: 90 }, { dashed: true, label: 'U8' });
    expect(asEl(sch.layer('back')).childElementCount).toBe(1);
    const p = sch.probe(a, [20, 20], { r: 4 });
    expect(asEl(p).querySelector('circle')?.attributes.r).toBe('4');
    const stop = sch.autoUpdate();
    c.set(a, 1);
    expect(raf.size).toBe(1);
    stop();
    expect(raf.size).toBe(0);
  });

  it('Schematic: switch hit areas are bigger than the switch but never reach into a neighbour', () => {
    const c = new Circuit();
    const sch = new Schematic(c, { width: 300, height: 200 });
    expect(asEl(sch.el).attributes.style).toContain('--sch-w: 300'); // touch screens keep it >= 3/4 size
    const hit = (g: Element) => asEl(g).querySelector('.switch-hit')!.attributes;
    const lone = sch.switch(c.input('x', 0), [200, 20]);
    const a = sch.switch(c.input('a', 0), [40, 100]);
    const b = sch.switch(c.input('b', 0), [40, 120]); // stacked 20 apart, as in the ALU labs
    const d = sch.switch(c.input('d', 0), [40, 150]); // 30 below b
    expect([hit(lone).y, hit(lone).height]).toEqual(['-18', '36']);
    expect([hit(a).y, hit(a).height]).toEqual(['-10', '20']);
    expect([hit(b).y, hit(b).height]).toEqual(['-10', '20']);
    expect([hit(d).y, hit(d).height]).toEqual(['-15', '30']);
  });

  it('select() exposes its <select>; SevenSegment dims segments', () => {
    let changed = 0;
    const sel = select([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'a', () => changed++, 'pick');
    expect(sel.getValue()).toBe('a');
    sel.setValue('b');
    expect([sel.getValue(), asEl(sel.selectEl).value, changed]).toEqual(['b', 'b', 0]);
    const seg = new SevenSegment();
    seg.set(0x7e, 0.5);
    const segs = asEl(seg.el).querySelectorAll('.seg');
    expect(segs[0].style.opacity).toBe('0.5');
    expect(segs[6].classList.contains('on')).toBe(false); // g is not in '0'
    seg.set(0x7e);
    expect(segs[0].style.opacity).toBe('');
    seg.set(0x7e, [1, 0, 1, 1, 1, 1, 1, 1]);
    expect(segs[1].classList.contains('on')).toBe(false); // brightness 0 = off
  });

  it('ComputerView: manualSignals shows only those switches, without the control module', () => {
    const m = new Machine();
    const view = new ComputerView(m, { modules: ['clock', 'bus', 'a', 'b'], manualSignals: ['AI', 'AO', 'BI'], driveClock: false });
    const el = asEl(view.el);
    const labels = el.querySelectorAll('.manual-switches .toggle-label').map((l) => l.textContent);
    expect(labels).toEqual(['AI', 'AO', 'BI']);
    expect(m.computer.manualControl).toBe(0);
    const inputs = el.querySelectorAll('.manual-switches input');
    inputs[1].checked = true;
    fire(inputs[1], 'change');
    expect(m.computer.manualControl).toBe(AO);
    view.setHighlight(['a']);
    expect(el.querySelector('.module-a')?.classList.contains('highlight')).toBe(true);
    view.setHighlight(['b']);
    expect(el.querySelector('.module-a')?.classList.contains('highlight')).toBe(false);
    view.dispose();
    expect(m.computer.manualControl).toBeNull();
  });

  it('App: routes to every lab (loaded lazily), cleans up the previous one, ignores stale loads', async () => {
    raf.clear();
    const host = new FElement('div');
    asEl((G.document as { body: unknown }).body).appendChild(host);
    const loc = G.location as { hash: string };
    const doc = G.document as { title: string };
    const settle = async () => {
      for (let i = 0; i < 50 && !host.querySelector('.lab-root') && !host.querySelector('.workbench'); i++) await new Promise((r) => setTimeout(r, 0));
    };
    loc.hash = '#/';
    const app = new App(asEl(host) as unknown as HTMLElement);
    expect(host.querySelector('.workbench')).not.toBeNull();
    // a lab that finishes loading after the user already navigated on must not mount
    clearLabCache();
    loc.hash = '#/lab/sr-latch';
    app.render();
    expect(host.querySelector('main')?.textContent).toContain('Loading');
    loc.hash = '#/video/44';
    app.render();
    await settle();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); // let the sr-latch load resolve too
    expect(host.querySelectorAll('.lab-root').length).toBe(1);
    expect(host.querySelector('main h1')?.textContent).toBe(LABS.get('conditional-jumps')!.title);
    expect(host.querySelector('.video-card.focused')?.textContent).toContain('Conditional jump');
    for (const id of LAB_IDS) {
      loc.hash = `#/lab/${id}`;
      app.render();
      await settle();
      frames(3);
      const main = host.querySelector('main')!;
      expect(main.querySelector('.lab-root'), id).not.toBeNull();
      expect(main.querySelector('h1')?.textContent).toBe(LABS.get(id)!.title);
      expect(doc.title).toContain(LABS.get(id)!.title);
    }
    loc.hash = '#/';
    app.render();
    frames(2);
    expect(host.querySelector('.lab-root')).toBeNull();
    expect(raf.size).toBe(1); // only the finished computer's own clock loop
    host.remove();
  });

  it('workbench: the program panel follows machine.loadSource and setSource', () => {
    raf.clear();
    const host = new FElement('div');
    const wb = mountComputerWorkbench(asEl(host) as unknown as HTMLElement, { program: 'add', keyboard: false });
    const ta = asEl(host.querySelector('textarea.asm-source'));
    const picker = asEl(host.querySelector('.asm-editor select'));
    expect(picker.value).toBe('add');
    // a lab loads a program straight into the machine
    wb.machine.loadSource(PROGRAM_BY_ID.get('up-down')!.source);
    expect(ta.value).toBe(PROGRAM_BY_ID.get('up-down')!.source);
    expect(picker.value).toBe('up-down');
    wb.programPanel!.setSource('LDI 7\nOUT\nHLT');
    expect(picker.value).toBe('__custom__');
    expect(Array.from(wb.machine.computer.ram.slice(0, 3))).toEqual([0x57, 0xe0, 0xf0]);
    wb.machine.loadSource('BAD 1');
    expect(host.querySelector('.asm-errors')?.textContent).toMatch(/line 1/);
    expect(wb.programPanel!.selectProgram('multiply')).toBe(true);
    expect(picker.value).toBe('multiply');
    wb.microcodePanel!.setHighlight([0b0100]);
    expect(wb.microcodePanel!.rowEl(0b0100)?.classList.contains('highlight')).toBe(true);
    wb.dispose();
    frames(2);
    expect(raf.size).toBe(0);
  });
});
