import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemble } from '../src/sim/assembler';
import { Computer } from '../src/sim/computer';
import { buildMicrocode, buildMicrocodeVersion, microcodeEepromImage, MICROCODE_VERSIONS, UCODE_TEMPLATE_ARDUINO, UCODE_TEMPLATE_FLAGS } from '../src/sim/microcode';
import { PROGRAM_BY_ID } from '../src/sim/programs';
import { AI, AO, BI, CE, CO, EO, FI, HLT, II, IO, J, MI, OI, RO, SU } from '../src/sim/signals';
import {
  busLevels,
  DEFAULT_RAIL,
  describeTransfer,
  explainMicrostepMistake,
  feedPositions,
  microstepGoal,
  railVoltages,
  referenceSequence,
  resetEffects,
  ttlRead,
  vccAfterEdge,
} from '../src/labs/control/_models';
import { buildClockGate, buildResetLogic, buildStepCounter } from '../src/labs/control/_circuits';
import {
  arduinoSketch,
  benWord,
  decodeEepromAddress,
  diffBytes,
  eepromAddress,
  gaps,
  INCREMENTER,
  minusOne,
  multiplyNoBranchSource,
  multiplySource,
  opcodesSettingFlags,
  printContents,
  quadrantDiffs,
  runProgram,
  tapeValue,
  tmInit,
  tmStep,
  zeroDetect,
} from '../src/labs/programming/_models';
import { buildFlagsCircuit } from '../src/labs/programming/_circuits';

const ADD_SRC = PROGRAM_BY_ID.get('add')!.source;

describe('describeTransfer', () => {
  it('names the fetch and execute steps', () => {
    expect(describeTransfer(MI | CO)).toBe('PC → MAR');
    expect(describeTransfer(RO | II | CE)).toBe('RAM → IR · PC + 1');
    expect(describeTransfer(IO | MI)).toBe('IR operand → MAR');
    expect(describeTransfer(EO | AI | SU | FI)).toBe('Σ (A − B) → A · flags ← carry, zero');
    expect(describeTransfer(AO | OI)).toBe('A → OUT');
    expect(describeTransfer(HLT)).toBe('halt the clock');
    expect(describeTransfer(0)).toMatch(/nothing/);
  });
  it('flags contention', () => {
    expect(describeTransfer(RO | CO | MI)).toMatch(/contention/);
  });
});

describe('explainMicrostepMistake', () => {
  it('accepts the right word', () => {
    expect(explainMicrostepMistake(MI | CO, MI | CO)).toEqual({ ok: true, messages: [] });
  });
  it('explains two bus drivers', () => {
    const r = explainMicrostepMistake(MI | CO | RO, MI | CO);
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toMatch(/Two modules drive the bus/);
  });
  it('explains forgetting CE', () => {
    const r = explainMicrostepMistake(RO | II, RO | II | CE);
    expect(r.messages.join(' ')).toMatch(/forgot CE/);
  });
  it('explains an undriven bus and pull-downs', () => {
    const r = explainMicrostepMistake(MI, MI | CO);
    expect(r.messages[0]).toMatch(/pull-downs/);
  });
  it('explains the wrong driver and an extra loader', () => {
    const r = explainMicrostepMistake(AO | AI, RO | AI);
    expect(r.messages[0]).toMatch(/A register drives the bus/);
    const r2 = explainMicrostepMistake(RO | AI | BI, RO | AI);
    expect(r2.messages.join(' ')).toMatch(/BI is on/);
  });
});

describe('referenceSequence / microstepGoal', () => {
  it('lists the 28+14 program microsteps from reset until HLT', () => {
    const seq = referenceSequence(assemble(ADD_SRC).bytes, 'control-logic');
    expect(seq.length).toBe(18);
    expect(seq.slice(0, 5).map((s) => s.word)).toEqual([MI | CO, RO | II | CE, IO | MI, RO | AI, 0]);
    expect(seq.slice(5, 10).map((s) => s.word)).toEqual([MI | CO, RO | II | CE, IO | MI, RO | BI, EO | AI]);
    expect(seq[12].word).toBe(AO | OI);
    expect(seq[17]).toMatchObject({ step: 2, word: HLT, fetchAddr: 3 });
    expect(seq[5].fetchAddr).toBe(1);
    expect(seq[5].opcode).toBe(0b0010); // ADD is being fetched
  });
  it('describes goals with live values', () => {
    const ram = assemble(ADD_SRC).bytes;
    const s = { fetchAddr: 0, operand: 14, ram, a: 0, b: 0 };
    expect(microstepGoal(1, 0, MI | CO, s)).toMatch(/address 0/);
    expect(microstepGoal(1, 3, RO | AI, s)).toMatch(/\(28\)/);
    expect(microstepGoal(2, 4, EO | AI, { ...s, a: 28, b: 14 })).toMatch(/= 42/);
    expect(microstepGoal(1, 4, 0, s)).toMatch(/Nothing to do/);
  });
});

describe('bus pull-downs', () => {
  it('PC only drives the low nibble', () => {
    expect(busLevels('pc', 3, true)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
    expect(busLevels('pc', 3, false)).toEqual(['Z', 'Z', 'Z', 'Z', 0, 0, 1, 1]);
    expect(ttlRead(busLevels('pc', 3, false))).toBe(0xf3);
    expect(ttlRead(busLevels('pc', 3, true))).toBe(3);
  });
  it('an undriven bus floats high without pull-downs', () => {
    expect(ttlRead(busLevels('none', 0, false))).toBe(255);
    expect(ttlRead(busLevels('none', 0, true))).toBe(0);
  });
  it('IR out drives the high nibble low', () => {
    expect(ttlRead(busLevels('ir', 0x1e, false))).toBe(14);
  });
});

describe('step counter circuit (74LS161 + 74LS138)', () => {
  const pulse = (sc: ReturnType<typeof buildStepCounter>, half = 20) => {
    sc.c.set(sc.clk, 1);
    sc.c.run(half);
    const afterRise = sc.count();
    sc.c.set(sc.clk, 0);
    sc.c.run(half);
    return { afterRise, afterFall: sc.count() };
  };
  it('counts T0..T4 on the falling edge and resets at O5', () => {
    const sc = buildStepCounter([MI], [MI, 0, MI, 0, 0]);
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = pulse(sc);
      expect(r.afterRise).toBe(i % 5); // unchanged on the rising edge
      seen.push(r.afterFall);
    }
    expect(seen).toEqual([1, 2, 3, 4, 0, 1, 2, 3, 4, 0]);
    expect(sc.t[0].value).toBe(1);
    expect(sc.o[0].value).toBe(0);
  });
  it('O5 exists only for a few gate delays', () => {
    const sc = buildStepCounter([MI], [0, 0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) pulse(sc);
    expect(sc.count()).toBe(4);
    sc.c.set(sc.clk, 1);
    sc.c.run(20);
    sc.c.set(sc.clk, 0);
    let fiveFor = 0;
    for (let i = 0; i < 20; i++) {
      sc.c.step();
      if (sc.count() === 5) fiveFor++;
    }
    expect(fiveFor).toBeGreaterThan(0);
    expect(fiveFor).toBeLessThan(10);
    expect(sc.count()).toBe(0);
  });
  it('6-step version resets at O6', () => {
    const sc = buildStepCounter([MI], [0, 0, 0, 0, 0, 0]);
    sc.c.set(sc.resetAt6, 1);
    sc.c.settle();
    const seen = Array.from({ length: 7 }, () => pulse(sc).afterFall);
    expect(seen).toEqual([1, 2, 3, 4, 5, 0, 1]);
  });
  it('on CLK (not inverted) the step changes on the rising edge', () => {
    const sc = buildStepCounter([MI], [MI, 0, 0, 0, 0]);
    sc.c.set(sc.useInverted, 0);
    sc.c.settle();
    const r = pulse(sc);
    expect(r.afterRise).toBe(1);
    expect(r.afterFall).toBe(1);
  });
  it('the EEPROM lines follow the step after its delay', () => {
    const sc = buildStepCounter([MI, CO], [MI | CO, RO, 0, 0, 0]);
    expect(sc.lines.map((n) => n.value)).toEqual([1, 1]);
    pulse(sc);
    expect(sc.lines.map((n) => n.value)).toEqual([0, 0]);
    sc.setWords([CO, CO, CO, CO, CO]);
    sc.c.settle();
    expect(sc.lines.map((n) => n.value)).toEqual([0, 1]);
  });
  it('CLR̅ holds the counter at 0', () => {
    const sc = buildStepCounter([MI], [0, 0, 0, 0, 0]);
    pulse(sc);
    pulse(sc);
    sc.c.set(sc.clrn, 0);
    sc.c.settle();
    expect(sc.count()).toBe(0);
    pulse(sc);
    expect(sc.count()).toBe(0);
  });
});

describe('reset logic (74LS00)', () => {
  it('makes CLR and CLR̅ and resets the step counter', () => {
    const r = buildResetLogic();
    expect([r.clr.value, r.clrn.value, r.stepMrn.value]).toEqual([0, 1, 1]);
    r.c.set(r.button, 1);
    r.c.settle();
    expect([r.clr.value, r.clrn.value, r.stepMrn.value]).toEqual([1, 0, 0]);
    r.c.set(r.button, 0);
    r.c.set(r.o5n, 0);
    r.c.settle();
    expect([r.clr.value, r.clrn.value, r.stepMrn.value]).toEqual([0, 1, 0]);
  });
});

describe('output register clock gating', () => {
  it('latches on CLK rising while OI, and on OI rising while CLK is high', () => {
    const g = buildClockGate();
    g.setBus(42);
    g.c.set(g.oi, 1);
    g.c.settle();
    g.c.set(g.clk, 1);
    g.c.settle();
    expect(g.latched()).toEqual({ value: 42, count: 1 });
    g.c.set(g.oi, 0);
    g.c.settle();
    expect(g.latched().count).toBe(1);
    g.setBus(7);
    g.c.set(g.oi, 1); // OI changes while CLK is high: spurious latch
    g.c.settle();
    expect(g.latched()).toEqual({ value: 7, count: 2 });
  });
});

describe('resetEffects', () => {
  it('reports cleared registers and kept RAM', () => {
    const ram = [1, 2, 3];
    const rows = resetEffects(
      { a: 28, b: 14, ir: 0x2f, mar: 15, pc: 2, out: 0, step: 3, flagC: 0, flagZ: 0, ram },
      { a: 0, b: 0, ir: 0, mar: 0, pc: 0, out: 0, step: 0, flagC: 0, flagZ: 0, ram },
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.a.changed).toBe(true);
    expect(by.a.line).toBe('CLR');
    expect(by.pc.line).toBe('CLR̅');
    expect(by.out.changed).toBe(false);
    expect(by.ram.changed).toBe(false);
    expect(by.ir.before).toBe('ADD 15');
  });
});

describe('rail voltage drop', () => {
  it('matches the closed form for a simple chain', () => {
    const p = { ...DEFAULT_RAIL, boards: 12, currentPerBoard: 0.08, railOhms: 0.1, leadOhms: 1e-9, groundToo: false };
    const r = railVoltages(p);
    expect(r.volts[0]).toBeCloseTo(5, 4);
    // far end: R·I·N(N−1)/2
    expect(5 - r.volts[11]).toBeCloseTo(0.1 * 0.08 * 66, 4);
    expect(r.totalCurrent).toBeCloseTo(0.96, 9);
    for (let k = 1; k < 12; k++) expect(r.volts[k]).toBeLessThan(r.volts[k - 1]);
  });
  it('doubles the drop when the ground rail drops too', () => {
    const p = { ...DEFAULT_RAIL, leadOhms: 1e-9 };
    const one = railVoltages({ ...p, groundToo: false });
    const two = railVoltages({ ...p, groundToo: true });
    expect(5 - two.minVolts).toBeCloseTo(2 * (5 - one.minVolts), 6);
  });
  it('extra feed wires raise the minimum voltage above the TTL limit', () => {
    const base = railVoltages(DEFAULT_RAIL);
    expect(base.minVolts).toBeLessThan(4.75);
    const fed = railVoltages({ ...DEFAULT_RAIL, feeds: 3 });
    expect(fed.minVolts).toBeGreaterThan(base.minVolts);
    expect(fed.minVolts).toBeGreaterThan(4.75);
    expect(fed.fed).toEqual(feedPositions(12, 3));
  });
  it('places feed wires spread out with the last at the far end', () => {
    expect(feedPositions(12, 1)).toEqual([11]);
    expect(feedPositions(12, 2)).toEqual([6, 11]);
    expect(feedPositions(5, 0)).toEqual([]);
  });
  it('a single board drops by I·R_lead per rail', () => {
    const r = railVoltages({ ...DEFAULT_RAIL, boards: 1, currentPerBoard: 0.5, leadOhms: 0.2, groundToo: true });
    expect(r.volts[0]).toBeCloseTo(5 - 2 * 0.1, 9);
  });
  it('decoupling capacitors shrink the dip after a clock edge', () => {
    expect(vccAfterEdge(0, false)).toBeLessThan(4.2);
    expect(vccAfterEdge(0, true)).toBeGreaterThan(4.9);
    expect(vccAfterEdge(50, false)).toBeCloseTo(5, 2);
    expect(vccAfterEdge(-1, false)).toBe(5);
  });
});

describe('EEPROM dump (video 40)', () => {
  const img = microcodeEepromImage(buildMicrocodeVersion('arduino'));
  it('prints in Ben’s printContents format', () => {
    const lines = printContents(img, 0, 256);
    expect(lines.length).toBe(16);
    expect(lines[0]).toBe('000:  40 14 00 00 00 00 00 00   40 14 48 12 00 00 00 00');
    expect(lines[8]).toBe('080:  04 08 00 00 00 00 00 00   04 08 00 00 00 00 00 00');
  });
  it('generates the sketch table with Ben’s spelling', () => {
    expect(benWord(IO | MI)).toBe('IO|MI');
    expect(benWord(0)).toBe('0');
    const src = arduinoSketch(UCODE_TEMPLATE_ARDUINO);
    expect(src).toContain('#define HLT 0b1000000000000000  // Halt clock');
    expect(src).not.toContain('#define FI');
    expect(src).toMatch(/MI\|CO, +RO\|II\|CE, +IO\|MI, +RO\|BI, +EO\|AI\|SU,/);
    expect(src).toContain('// 0011 - SUB');
    expect(src).toContain('// 0100\n');
    const flags = arduinoSketch(UCODE_TEMPLATE_FLAGS, { flags: true });
    expect(flags).toContain('#define FI  0b0000000000000001  // Flags in');
    expect(flags).toContain('// 0111 - JC');
  });
  it('diffs images after an edit', () => {
    const t = MICROCODE_VERSIONS.arduino.template.map((r) => [...r]);
    t[1][1] = RO | II; // remove CE from LDA T1
    const img2 = microcodeEepromImage(buildMicrocode(t, false));
    const d = diffBytes(img, img2);
    expect(d.filter((a) => a < 256)).toEqual([0x80 | 0x09]); // only the low byte of LDA T1 changes
  });
});

describe('EEPROM address layout and quadrants', () => {
  it('encodes and decodes', () => {
    const a = eepromAddress(0b11, 1, 0b0111, 2);
    expect(a).toBe(0x3ba);
    expect(decodeEepromAddress(a)).toMatchObject({ zf: 1, cf: 1, byteSel: 1, opcode: 7, step: 2 });
  });
  it('the four flag copies differ only at T2 of JC and JZ', () => {
    const img = microcodeEepromImage(buildMicrocodeVersion('flags'));
    expect(quadrantDiffs(img)).toEqual([0x3a, 0x42, 0xba, 0xc2]);
    expect(img[0x100 + 0x3a]).toBe(IO >> 8); // CF=1 copy: JC T2 high byte = IO
    expect(img[0x100 + 0xba]).toBe(J); //       low byte = J
    expect(img[0x3a]).toBe(0);
    expect(quadrantDiffs(microcodeEepromImage(buildMicrocodeVersion('more-instructions')))).toEqual([]);
  });
});

describe('programs', () => {
  it('5 + 6 − 7 = 4 with the Arduino microcode', () => {
    const r = runProgram(PROGRAM_BY_ID.get('add-sub')!.source, 'arduino');
    expect(r.outputs).toEqual([4]);
    expect(r.halted).toBe(true);
  });
  it('removing CE from T1 breaks the fetch', () => {
    const t = MICROCODE_VERSIONS.arduino.template.map((row) => row.map((w, s) => (s === 1 ? w & ~CE : w)));
    const asm = assemble(PROGRAM_BY_ID.get('add-sub')!.source);
    const comp = new Computer({ microcode: buildMicrocode(t, false), ram: asm.bytes });
    for (let i = 0; i < 100; i++) comp.tick();
    expect(comp.pc).toBe(0);
    expect(comp.out).toBe(0);
    expect(comp.a).toBe(5); // LDA 15 over and over
  });
  it('multiples of 3: 15 clocks per loop', () => {
    const r = runProgram(PROGRAM_BY_ID.get('count-by-3')!.source, 'more-instructions', 2000, 10);
    expect(r.outputs).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
    expect(new Set(gaps(r.outputEdges))).toEqual(new Set([15]));
  });
  it('multiply never stops without JC, and halts with it', () => {
    const forever = runProgram(multiplyNoBranchSource(3, 5), 'more-instructions', 3000, 60);
    expect(forever.halted).toBe(false);
    expect(forever.outputs.slice(0, 4)).toEqual([5, 10, 15, 20]);
    expect(forever.outputs[51]).toBe(4); // 255 + 5 wraps around to 4
    expect(forever.computer.ram[14]).toBe(200); // 3 − 59 wraps around to 200 // x has wrapped past 0
    // Ben's JC program on the old microcode: JC is a NOP, so it falls through at once
    const fallThrough = runProgram(multiplySource(3, 5), 'more-instructions', 3000);
    expect(fallThrough.outputs).toEqual([0]);
    expect(fallThrough.halted).toBe(true);
    const ok = runProgram(multiplySource(3, 5), 'flags', 3000);
    expect(ok.outputs).toEqual([15]);
    expect(ok.halted).toBe(true);
    expect(runProgram(multiplySource(7, 8), 'flags', 5000).outputs).toEqual([56]);
  });
  it('x − 1 sets carry unless x is 0', () => {
    expect(minusOne(0)).toMatchObject({ value: 255, carry: 0 });
    expect(minusOne(1)).toMatchObject({ value: 0, carry: 1, zero: 1 });
    expect(minusOne(200)).toMatchObject({ value: 199, carry: 1 });
  });
  it('count up and down turns around at 255,255 and 0,0', () => {
    const r = runProgram(PROGRAM_BY_ID.get('up-down')!.source, 'flags', 30000, 520);
    expect(r.outputs.slice(254, 258)).toEqual([254, 255, 255, 254]);
    expect(r.outputs.slice(510, 514)).toEqual([1, 0, 0, 1]);
  });
});

describe('flags hardware (video 43)', () => {
  it('zero detector: NOR pairs + three ANDs', () => {
    expect(zeroDetect(0)).toEqual({ nors: [1, 1, 1, 1], and1: 1, and2: 1, zero: 1 });
    expect(zeroDetect(0x10).nors).toEqual([1, 1, 0, 1]);
    expect(zeroDetect(0x10).zero).toBe(0);
    for (let v = 1; v < 256; v++) expect(zeroDetect(v).zero).toBe(0);
  });
  it('only ADD and SUB assert FI', () => {
    expect(opcodesSettingFlags(UCODE_TEMPLATE_FLAGS)).toEqual([0b0010, 0b0011]);
    expect(UCODE_TEMPLATE_FLAGS[2][4]).toBe(EO | AI | FI);
  });
  it('the 74LS173 latches CF and ZF only on CLK with FI', () => {
    const f = buildFlagsCircuit();
    f.setSum(0, 1);
    f.c.settle();
    expect(f.zero.value).toBe(1);
    f.c.set(f.clk, 1);
    f.c.settle();
    expect([f.cf.value, f.zf.value]).toEqual([0, 0]); // FI was off
    f.c.set(f.clk, 0);
    f.c.set(f.fi, 1);
    f.c.settle();
    expect(f.fin.value).toBe(0);
    f.c.set(f.clk, 1);
    f.c.settle();
    expect([f.cf.value, f.zf.value]).toEqual([1, 1]);
    expect([f.a8.value, f.a9.value]).toEqual([1, 1]);
    f.c.set(f.rewired, 0);
    f.c.settle();
    expect([f.a8.value, f.a9.value]).toEqual([0, 0]);
    f.setSum(5, 0); // ALU output changes; latched flags hold
    f.c.settle();
    expect([f.cf.value, f.zf.value, f.zero.value]).toEqual([1, 1, 0]);
    f.c.set(f.clr, 1);
    f.c.settle();
    expect([f.cf.value, f.zf.value]).toEqual([0, 0]);
  });
});

describe('Turing machine incrementer', () => {
  it('adds one with carry', () => {
    for (const [inp, out] of [['1011', 12], ['111', 8], ['0', 1], ['1001', 10]] as const) {
      const s = tmInit(inp);
      let n = 0;
      while (s.state !== 'halt' && n++ < 100) tmStep(INCREMENTER, s);
      expect(s.state).toBe('halt');
      expect(tapeValue(s.tape)).toBe(out);
    }
  });
  it('the rule depends on the symbol read', () => {
    const s = tmInit('1');
    expect(tmStep(INCREMENTER, s)).toMatchObject({ state: 'right', read: '1' });
    expect(tmStep(INCREMENTER, s)).toMatchObject({ state: 'right', read: '_', next: 'carry' });
    expect(tmStep(INCREMENTER, s)).toMatchObject({ state: 'carry', read: '1', write: '0' });
    expect(tmStep(INCREMENTER, s)).toMatchObject({ state: 'carry', read: '_', write: '1', next: 'halt' });
    expect(tmStep(INCREMENTER, s)).toBeNull();
  });
});

// ===========================================================================
// Smoke tests: mount every lab in a tiny fake DOM (the test environment is
// node, without jsdom), drive animation frames, poke every control, and check
// that the cleanup function stops every loop and window listener.

type Listener = (e: FakeEvent) => void;
interface FakeEvent {
  type: string;
  target: unknown;
  key?: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

let fakeDocRoot: FakeElement | null = null;

class FakeNode {
  parentNode: FakeElement | null = null;
  nodeType = 1;
  get textContent(): string {
    return '';
  }
  set textContent(_v: string) {}
  remove() {
    this.parentNode?.removeChild(this);
  }
  get isConnected(): boolean {
    let n: FakeNode = this;
    while (n.parentNode) n = n.parentNode;
    return n === fakeDocRoot;
  }
}

class FakeText extends FakeNode {
  constructor(public data: string) {
    super();
    this.nodeType = 3;
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = String(v);
  }
}

class FakeClassList {
  constructor(private el: FakeElement) {}
  private get list() {
    return (this.el.attributes.class ?? '').split(/\s+/).filter(Boolean);
  }
  private set list(v: string[]) {
    this.el.attributes.class = v.join(' ');
  }
  add(...c: string[]) {
    const l = this.list;
    for (const x of c) if (!l.includes(x)) l.push(x);
    this.list = l;
  }
  remove(...c: string[]) {
    this.list = this.list.filter((x) => !c.includes(x));
  }
  contains(c: string) {
    return this.list.includes(c);
  }
  toggle(c: string, force?: boolean) {
    const on = force ?? !this.contains(c);
    if (on) this.add(c);
    else this.remove(c);
    return on;
  }
}

class FakeElement extends FakeNode {
  childNodes: FakeNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  classList = new FakeClassList(this);
  private _value = '';
  get value(): string {
    return this._value;
  }
  set value(v: string) {
    this._value = String(v);
  }
  checked = false;
  disabled = false;
  type = '';
  selected = false;
  title = '';
  width = 0;
  height = 0;
  offsetWidth = 0;
  constructor(public tagName: string) {
    super();
  }
  get className() {
    return this.attributes.class ?? '';
  }
  set className(v: string) {
    this.attributes.class = v;
  }
  get children() {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastElementChild() {
    const c = this.children;
    return c[c.length - 1] ?? null;
  }
  get childElementCount() {
    return this.children.length;
  }
  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  override set textContent(v: string) {
    this.replaceChildren(String(v));
  }
  setAttribute(k: string, v: string) {
    this.attributes[k] = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v);
  }
  getAttribute(k: string) {
    return this.attributes[k] ?? null;
  }
  removeAttribute(k: string) {
    delete this.attributes[k];
  }
  private adopt(n: FakeNode | string): FakeNode {
    const node = typeof n === 'string' ? new FakeText(n) : n;
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    return node;
  }
  appendChild<T extends FakeNode>(n: T): T {
    this.childNodes.push(this.adopt(n));
    return n;
  }
  append(...ns: (FakeNode | string)[]) {
    for (const n of ns) this.childNodes.push(this.adopt(n));
  }
  replaceChildren(...ns: (FakeNode | string)[]) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...ns);
  }
  removeChild<T extends FakeNode>(n: T): T {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  addEventListener(t: string, f: Listener) {
    (this.listeners[t] ??= []).push(f);
  }
  removeEventListener(t: string, f: Listener) {
    this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== f);
  }
  dispatchEvent(e: FakeEvent) {
    let stop = false;
    e.stopPropagation = () => (stop = true);
    for (let n: FakeElement | null = this; n && !stop; n = n.parentNode) for (const f of [...(n.listeners[e.type] ?? [])]) f(e);
    return !e.defaultPrevented;
  }
  focus() {}
  select() {}
  getContext() {
    return null;
  }
  matches(sel: string): boolean {
    return sel.split(',').some((part) => matchesComplex(this, part.trim()));
  }
  closest(sel: string): FakeElement | null {
    for (let n: FakeElement | null = this; n; n = n.parentNode) if (n.matches(sel)) return n;
    return null;
  }
  querySelectorAll(sel: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const c of el.children) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

class FakeSVGElement extends FakeElement {}

class FakeSelect extends FakeElement {
  override get value(): string {
    const opts = this.querySelectorAll('option');
    return (opts.find((o) => o.selected) ?? opts[0])?.value ?? '';
  }
  override set value(v: string) {
    for (const o of this.querySelectorAll('option')) o.selected = o.value === v;
  }
}

function matchesCompound(el: FakeElement, comp: string): boolean {
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

function matchesComplex(el: FakeElement, sel: string): boolean {
  const parts = sel.split(/\s+/).filter(Boolean);
  if (!parts.length || !matchesCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let n = el.parentNode; n && i >= 0; n = n.parentNode) if (matchesCompound(n, parts[i])) i--;
  return i < 0;
}

const raf = new Map<number, (t: number) => void>();
let rafId = 0;
let fakeNow = 0;
const windowListeners: Record<string, Listener[]> = {};
const G = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const GLOBALS = ['document', 'window', 'Node', 'SVGElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'location', 'getComputedStyle'];

function installFakeDom() {
  for (const k of GLOBALS) saved[k] = G[k];
  fakeDocRoot = new FakeElement('html');
  G.Node = FakeNode;
  G.SVGElement = FakeSVGElement;
  G.document = {
    createElement: (t: string) => (t === 'select' ? new FakeSelect(t) : new FakeElement(t)),
    createElementNS: (_ns: string, t: string) => new FakeSVGElement(t),
    createTextNode: (s: string) => new FakeText(s),
    activeElement: null,
    documentElement: fakeDocRoot,
  };
  G.window = {
    addEventListener: (t: string, f: Listener) => (windowListeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: Listener) => (windowListeners[t] = (windowListeners[t] ?? []).filter((x) => x !== f)),
  };
  G.requestAnimationFrame = (cb: (t: number) => void) => {
    raf.set(++rafId, cb);
    return rafId;
  };
  G.cancelAnimationFrame = (id: number) => raf.delete(id);
  G.location = { hash: '' };
  G.getComputedStyle = () => ({ getPropertyValue: () => '' });
  fakeNow = performance.now();
}

function uninstallFakeDom() {
  for (const k of GLOBALS) {
    if (saved[k] === undefined) delete G[k];
    else G[k] = saved[k];
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

const ev = (type: string, target: unknown, key?: string): FakeEvent => ({
  type,
  target,
  key,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopPropagation() {},
});
const fire = (el: FakeElement, type: string, key?: string) => el.dispatchEvent(ev(type, el, key));
const windowListenerCount = () => Object.values(windowListeners).reduce((n, l) => n + l.length, 0);
const byText = (root: FakeElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.trim().startsWith(text));

/** Click every button, flip every switch and checkbox, try every select option. */
function pokeEverything(root: FakeElement, skip: (el: FakeElement) => boolean = () => false) {
  for (const b of root.querySelectorAll('button')) {
    if (skip(b) || !b.isConnected) continue;
    fire(b, 'pointerdown');
    frames(1);
    fire(b, 'pointerup');
    fire(b, 'click');
    frames(2);
  }
  for (const sw of root.querySelectorAll('.sch-switch')) {
    fire(sw, 'pointerdown');
    fire(sw, 'pointerup');
    fire(sw, 'click');
    frames(1);
  }
  for (const inp of root.querySelectorAll('input')) {
    const type = inp.attributes.type ?? inp.type;
    if (type === 'checkbox') {
      inp.checked = !inp.checked;
      fire(inp, 'change');
      frames(2);
    } else if (type === 'range') {
      inp.value = '700';
      fire(inp, 'input');
    }
  }
  for (const sel of root.querySelectorAll('select')) {
    for (const o of sel.querySelectorAll('option')) {
      sel.value = o.value;
      fire(sel, 'change');
      frames(1);
    }
  }
  for (const cell of root.querySelectorAll('.b').slice(0, 3)) fire(cell, 'click');
  for (const r of root.querySelectorAll('rect').slice(0, 3)) fire(r, 'click');
  for (const td of root.querySelectorAll('td.uc-cell').slice(0, 1)) {
    fire(td, 'click');
    const input = td.querySelector('input');
    if (input) {
      input.value = 'IO|MI';
      fire(input, 'keydown', 'Enter');
    }
  }
  for (const l of [...(windowListeners.keydown ?? [])]) l(ev('keydown', root, ' '));
  frames(20, 100);
}

const LAB_FILES = {
  'connecting-bus': () => import('../src/labs/control/connecting-bus.lab'),
  'control-signals': () => import('../src/labs/control/control-signals.lab'),
  'control-logic': () => import('../src/labs/control/control-logic.lab'),
  'reset-circuit': () => import('../src/labs/control/reset-circuit.lab'),
  'microcode-programmer': () => import('../src/labs/programming/microcode-programmer.lab'),
  'more-instructions': () => import('../src/labs/programming/more-instructions.lab'),
  'turing-complete': () => import('../src/labs/programming/turing-complete.lab'),
  'flags-register': () => import('../src/labs/programming/flags-register.lab'),
  'conditional-jumps': () => import('../src/labs/programming/conditional-jumps.lab'),
} as const;

async function mountLab(id: keyof typeof LAB_FILES) {
  const lab = (await LAB_FILES[id]()).default;
  const root = new FakeElement('div');
  fakeDocRoot!.appendChild(root);
  const cleanup = lab.mount(root as unknown as HTMLElement);
  return { lab, root, cleanup: cleanup as () => void };
}

describe('lab smoke tests (fake DOM)', () => {
  beforeAll(installFakeDom);
  afterAll(uninstallFakeDom);

  for (const id of Object.keys(LAB_FILES) as (keyof typeof LAB_FILES)[]) {
    it(`${id}: mounts, runs, reacts to every control and cleans up`, async () => {
      const { lab, root, cleanup } = await mountLab(id);
      expect(lab.id).toBe(id);
      expect(typeof cleanup).toBe('function');
      frames(60);
      const tabs = root.querySelectorAll('.lab-tabs button');
      if (tabs.length) {
        for (const t of tabs) {
          fire(t, 'click');
          frames(30);
          pokeEverything(root, (el) => !!el.closest('.lab-tabs'));
        }
      } else pokeEverything(root);
      cleanup();
      frames(3);
      expect(raf.size).toBe(0);
      expect(windowListenerCount()).toBe(0);
      root.remove();
    });
  }

  it('connecting-bus: being the control unit runs 28 + 14 = 42', async () => {
    const { root, cleanup } = await mountLab('connecting-bus');
    const ex = root.querySelector('.cu-ex')!;
    const pulse = byText(ex, 'Pulse clock')!;
    // a deliberate mistake first: all switches off at T0
    fire(pulse, 'click');
    expect(ex.querySelector('.cu-feedback')!.textContent).toMatch(/pull-downs/);
    fire(byText(ex, 'Undo last pulse')!, 'click');
    for (let i = 0; i < 18; i++) {
      fire(byText(ex, 'Set them for me')!, 'click');
      fire(pulse, 'click');
    }
    expect(ex.textContent).toMatch(/Done! The clock is halted and the display shows 42/);
    expect(ex.textContent).toMatch(/17 correct · 1 mistakes/);
    cleanup();
    root.remove();
  });

  it('connecting-bus: forgetting CE is explained', async () => {
    const { root, cleanup } = await mountLab('connecting-bus');
    const ex = root.querySelector('.cu-ex')!;
    const sw = (sig: string) => ex.querySelectorAll('.cu-switches button').find((b) => b.textContent === sig)!;
    fire(sw('MI'), 'click');
    fire(sw('CO'), 'click');
    fire(byText(ex, 'Pulse clock')!, 'click'); // T0 correct
    fire(sw('MI'), 'click');
    fire(sw('CO'), 'click');
    fire(sw('RO'), 'click');
    fire(sw('II'), 'click');
    fire(byText(ex, 'Pulse clock')!, 'click'); // T1 without CE
    expect(ex.querySelector('.cu-feedback')!.textContent).toMatch(/forgot CE/);
    cleanup();
    root.remove();
  });

  it('control-logic part 1: the guided walkthrough runs 28 + 14 = 42', async () => {
    const { root, cleanup } = await mountLab('control-logic');
    const ex = root.querySelector('.cu-ex')!;
    for (let i = 0; i < 20; i++) fire(byText(ex, 'Pulse clock')!, 'click');
    expect(ex.textContent).toMatch(/display shows 42/);
    cleanup();
    expect(raf.size).toBe(0);
    root.remove();
  });

  it('reset-circuit: reset clears registers, keeps RAM and the program restarts', async () => {
    const { root, cleanup } = await mountLab('reset-circuit');
    frames(40, 100); // 4 s at 4 Hz: mid-program or halted
    const big = byText(root, 'RESET')!;
    fire(big, 'pointerdown');
    frames(3);
    const table = root.querySelector('table.truth-table')!.textContent;
    expect(table).toMatch(/still there/);
    expect(root.textContent).toMatch(/RAM has no reset input/);
    fire(big, 'pointerup');
    frames(60, 100);
    expect(root.textContent).toMatch(/HALTED/);
    cleanup();
    root.remove();
  });

  it('microcode-programmer: removing CE from T1 breaks the fetch', async () => {
    const { root, cleanup } = await mountLab('microcode-programmer');
    expect(root.querySelector('.hexdump')!.textContent).toContain('000:  40 14 00 00 00 00 00 00   40 14 48 12 00 00 00 00');
    fire(byText(root, 'Experiment: remove CE')!, 'click');
    frames(30, 100);
    expect(root.textContent).toMatch(/CE is gone from T1/);
    expect(root.querySelector('.hexdump')!.textContent).toContain('080:  04 00 00 00 00 00 00 00   04 00 00 00 00 00 00 00');
    expect(root.querySelector('pre.sketch')!.textContent).toMatch(/MI\|CO, +RO\|II, /);
    cleanup();
    root.remove();
  });

  it('control-logic part 2: clocking the counter on CLK shows the race, CLK̅ does not', async () => {
    const { root, cleanup } = await mountLab('control-logic');
    fire(root.querySelectorAll('.lab-tabs button')[1], 'click');
    frames(200, 100); // ~20 s of simulated time at 60 gate delays/s
    const status = () => root.querySelectorAll('.callout').map((c) => c.textContent).join(' ');
    expect(status()).toMatch(/clocked by CLK̅/);
    const raceToggle = root.querySelectorAll('label.toggle').find((l) => l.textContent.includes('the race'))!;
    const input = raceToggle.querySelector('input')!;
    input.checked = true;
    fire(input, 'change');
    frames(200, 100);
    const m = status().match(/\((\d+) so far\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(2);
    cleanup();
    root.remove();
  });

  it('flags-register: the demo program runs to HLT and the flags remember the ADD', async () => {
    const { root, cleanup } = await mountLab('flags-register');
    const panelEl = root.querySelectorAll('section.panel').find((x) => x.textContent.includes('Why latch?'))!;
    fire(byText(panelEl, 'Run')!, 'click');
    frames(120, 100); // 12 s at 4 Hz
    expect(panelEl.textContent).toMatch(/HALTED/);
    expect(panelEl.textContent).toMatch(/flags C = 1, Z = 1/);
    cleanup();
    root.remove();
  });

  it('turing-complete: without JC the loop never ends, with JC it halts at 15', async () => {
    const { root, cleanup } = await mountLab('turing-complete');
    const seg = (label: string) => root.querySelectorAll('.seg button').find((b) => b.textContent.startsWith(label))!;
    fire(seg('No conditional'), 'click');
    fire(byText(root, 'Turbo')!, 'click');
    frames(30, 100);
    expect(root.textContent).toMatch(/wrapped to 255/);
    expect(root.textContent).not.toMatch(/HALTED/);
    fire(seg('With JC'), 'click');
    frames(30, 100);
    expect(root.textContent).toMatch(/Halted with 15 on the display/);
    fire(seg('JC on the old'), 'click');
    frames(30, 100);
    expect(root.textContent).toMatch(/The display shows 0, not 15/);
    cleanup();
    root.remove();
  });

  it('conditional-jumps: the multiply buttons give 15 and 56', async () => {
    const { root, cleanup } = await mountLab('conditional-jumps');
    fire(byText(root, 'Multiply 3')!, 'click');
    frames(100, 100);
    expect(root.textContent).toMatch(/Halted\. Output: 15/);
    fire(byText(root, 'Multiply 7')!, 'click');
    frames(100, 100);
    expect(root.textContent).toMatch(/Halted\. Output: 56/);
    expect(root.textContent).toMatch(/JC 6 at address 2/);
    cleanup();
    root.remove();
  });

  it('more-instructions: 15 clocks between outputs', async () => {
    const { root, cleanup } = await mountLab('more-instructions');
    fire(root.querySelectorAll('.toolbar button').find((b) => b.textContent === 'Run')!, 'click');
    frames(100, 100); // 10 s at 10 Hz
    expect(root.querySelector('.loopclocks')!.textContent).toBe('15');
    cleanup();
    root.remove();
  });
});
