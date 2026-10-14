import { buildMicrocode, microIndex, type Microcode } from './microcode';
import { AI, AO, BI, CE, CO, EO, FI, HLT, II, IO, J, MI, OI, RI, RO, SU, type ModuleId, type Signal } from './signals';

/**
 * Control-signal-level model of Ben Eater's 8-bit breadboard computer.
 *
 * Timing (as built in the playlist, see docs/research/computer-spec.md):
 *  - Rising clock edge: every register whose "in" signal is asserted latches
 *    the pre-edge bus (74LS173 A/B/IR/MAR/flags, 74LS273 output); the PC
 *    counts (CE) or loads (J, synchronous load of the 74LS161, which wins
 *    over CE).
 *  - RAM write: W̅E̅ = NAND(RI, RC-differentiated CLK) is a ~10 µs pulse right
 *    *after* the rising edge. The registers above settle within tens of
 *    nanoseconds, so the 74189 stores whatever the bus and the MAR hold once
 *    the edge has happened. For Ben's microcode (STA T3 = AO|RI) that is the
 *    same as the pre-edge value; with hand-set control words such as MI|RI it
 *    reproduces what Ben saw in "RAM module testing": the byte lands at the
 *    *new* address.
 *  - Falling clock edge: the microinstruction step counter (74LS161 clocked
 *    by inverted CLK) advances, so the new control word settles while the
 *    clock is low, before the next rising edge.
 *  - The 74LS138 step decoder resets the counter when it reaches
 *    `stepsPerInstruction` (5 -> steps T0..T4).
 *  - HLT gates the clock: while the current control word contains HLT, clock
 *    pulses are ignored (CLK = ... AND NOT HLT).
 *
 * Bus: 8 lines, each with a 10 kΩ pull-down from "Connecting the bus"
 * (video 34) on. The PC's 74LS245 only drives lines 0-3. Without the
 * pull-downs (`pullDowns: false`) undriven lines float and LS-TTL inputs
 * read them as 1, as in "Testing our computer's registers" (video 13).
 */

export interface AluResult {
  value: number;
  carry: 0 | 1;
  zero: 0 | 1;
  subtract: boolean;
}

export interface BusState {
  value: number;
  drivers: ModuleId[];
  /** More than one module is driving the bus (a bug in microcode / manual control). */
  contention: boolean;
  /** Bit mask of the lines some driver actively drives. */
  driven: number;
  /** Bit mask of undriven lines that float (no pull-downs); TTL inputs read them as 1. */
  floating: number;
}

export interface Transfer {
  signal: Signal;
  /** Module that drove the bus (or null when the change isn't a bus transfer, e.g. CE). */
  from: ModuleId | null;
  to: ModuleId;
  value: number;
}

export type ResettableModule = 'a' | 'b' | 'ir' | 'mar' | 'pc' | 'step' | 'flags' | 'out';

export interface ComputerOptions {
  microcode?: Microcode;
  stepsPerInstruction?: number;
  /** Which registers the reset button clears. */
  resetClears?: ResettableModule[];
  ram?: ArrayLike<number>;
  /**
   * 10 kΩ bus pull-downs (default true, added in video 34). With false an
   * undriven bus line floats and reads as 1, so an idle bus is 0xFF and the
   * PC (which only drives lines 0-3) puts 1111 on the high nibble.
   */
  pullDowns?: boolean;
}

export const DEFAULT_RESET_CLEARS: ResettableModule[] = ['a', 'b', 'ir', 'mar', 'pc', 'step', 'flags', 'out'];

/**
 * Bus lines each module's 74LS245 is wired to. The PC's 245 only has 4
 * channels connected (BUS 0-3); the IR's 245 drives all 8 lines, with its
 * A0-A3 inputs tied to GND so BUS 4-7 are actively driven low.
 */
export const BUS_DRIVER_MASK: Partial<Record<ModuleId, number>> = { ram: 0xff, ir: 0xff, a: 0xff, alu: 0xff, pc: 0x0f, input: 0xff };

/** Machine state just before a rising clock edge (for edge observers). */
export interface PreEdgeState {
  step: number;
  ir: number;
  pc: number;
  mar: number;
  a: number;
  b: number;
  out: number;
  flags: number;
  flagC: 0 | 1;
  flagZ: 0 | 1;
  /** Control word on the lines (manual override or microcode). */
  controlWord: number;
  /** What the microcode EEPROMs output (ignores a manual override). */
  microcodeWord: number;
  bus: BusState;
  alu: AluResult;
  ramAddress: number;
  ramValue: number;
}

export interface RisingEdgeEvent {
  /** `Computer.risingEdges` after this edge. */
  edge: number;
  pre: PreEdgeState;
  /** What the edge latched (same array as `lastTransfers`). */
  transfers: Transfer[];
}

export interface FallingEdgeEvent {
  prevStep: number;
  step: number;
  /** `Computer.cycles` after this edge. */
  cycles: number;
}

export interface ComputerSnapshot {
  clk: 0 | 1;
  a: number;
  b: number;
  ir: number;
  mar: number;
  pc: number;
  out: number;
  step: number;
  flagC: 0 | 1;
  flagZ: 0 | 1;
  ram: number[];
  controlWord: number;
  bus: BusState;
  alu: AluResult;
  halted: boolean;
  programMode: boolean;
  ramAddress: number;
  cycles: number;
  instructions: number;
}

export class Computer {
  // ---- architectural state --------------------------------------------------
  a = 0;
  b = 0;
  ir = 0;
  mar = 0;
  pc = 0;
  out = 0;
  step = 0;
  flagC: 0 | 1 = 0;
  flagZ: 0 | 1 = 0;
  readonly ram = new Uint8Array(16);
  clk: 0 | 1 = 0;

  // ---- front-panel switches --------------------------------------------------
  /** RAM module "program" mode: address and data come from the DIP switches. */
  programMode = false;
  dipAddress = 0;
  dipData = 0;
  /** Output display: show the value as two's complement. */
  signedDisplay = false;

  // ---- configuration --------------------------------------------------------
  microcode: Microcode;
  stepsPerInstruction: number;
  resetClears: ResettableModule[];
  /** 10 kΩ pull-downs on the bus lines (see ComputerOptions.pullDowns). */
  pullDowns: boolean;
  /**
   * When non-null, this control word replaces the microcode output, like the
   * DIP switches/jumper wires Ben uses before the control logic exists
   * ("Connecting the bus").
   */
  manualControl: number | null = null;
  /**
   * When non-null, this value is driven onto the bus as well (DIP switches /
   * jumper wires Ben uses to test modules before the whole computer exists).
   */
  busInput: number | null = null;
  /** Lines `busInput` drives (default all 8; e.g. only the bits jumpered to GND). */
  busInputMask = 0xff;

  // ---- statistics -------------------------------------------------------------
  cycles = 0;
  instructions = 0;
  /** Total rising edges seen (never reset; lets observers detect new edges). */
  risingEdges = 0;
  lastTransfers: Transfer[] = [];

  private riseListeners = new Set<(e: RisingEdgeEvent) => void>();
  private fallListeners = new Set<(e: FallingEdgeEvent) => void>();
  private resetListeners = new Set<() => void>();

  constructor(opts: ComputerOptions = {}) {
    this.microcode = opts.microcode ?? buildMicrocode();
    this.stepsPerInstruction = opts.stepsPerInstruction ?? 5;
    this.resetClears = opts.resetClears ?? DEFAULT_RESET_CLEARS;
    this.pullDowns = opts.pullDowns ?? true;
    if (opts.ram) this.load(opts.ram);
  }

  // ---- combinational logic ----------------------------------------------------

  get flags(): number {
    return (this.flagZ << 1) | this.flagC;
  }

  get opcode(): number {
    return this.ir >> 4;
  }

  get operand(): number {
    return this.ir & 0x0f;
  }

  /** Output of the control EEPROMs for the current flags/opcode/step. */
  get microcodeWord(): number {
    return this.microcode[microIndex(this.flags, this.opcode, this.step)];
  }

  get controlWord(): number {
    return this.manualControl ?? this.microcodeWord;
  }

  has(signal: number): boolean {
    return (this.controlWord & signal) !== 0;
  }

  get halted(): boolean {
    return this.has(HLT);
  }

  /** Address presented to the RAM chips (74LS157 mux: MAR or DIP switches). */
  get ramAddress(): number {
    return this.programMode ? this.dipAddress & 0x0f : this.mar & 0x0f;
  }

  get ramValue(): number {
    return this.ram[this.ramAddress];
  }

  get alu(): AluResult {
    return computeAlu(this.a, this.b, this.has(SU));
  }

  get bus(): BusState {
    return this.resolveBus(false);
  }

  /**
   * @param ramWriting the 74189s are being written: their outputs float, and
   * the 74LS04s that re-invert them turn the floating (high) inputs into 0s.
   */
  private resolveBus(ramWriting: boolean): BusState {
    const cw = this.controlWord;
    const drivers: ModuleId[] = [];
    let driven = 0;
    let low = 0; // lines some driver pulls low
    const drive = (m: ModuleId, value: number, mask = BUS_DRIVER_MASK[m] ?? 0xff) => {
      drivers.push(m);
      driven |= mask;
      low |= ~value & mask;
    };
    if (cw & RO) drive('ram', ramWriting ? 0 : this.ramValue);
    if (cw & IO) drive('ir', this.ir & 0x0f); // operand nibble; BUS 4-7 driven low
    if (cw & AO) drive('a', this.a);
    if (cw & EO) drive('alu', this.alu.value);
    if (cw & CO) drive('pc', this.pc & 0x0f);
    if (this.busInput !== null) drive('input', this.busInput & 0xff, this.busInputMask & 0xff);
    driven &= 0xff;
    // With contention, LS-TTL outputs driving low win, so the result is an AND.
    const undriven = ~driven & 0xff;
    const floating = this.pullDowns ? 0 : undriven;
    const value = (driven & ~low & 0xff) | floating;
    return { value, drivers, contention: drivers.length > 1, driven, floating };
  }

  // ---- clock ------------------------------------------------------------------

  /**
   * Toggle the clock line once (half a cycle). Returns false if the clock is
   * held low by HLT.
   */
  halfCycle(): boolean {
    if (this.clk === 0) {
      if (this.halted) return false;
      this.clk = 1;
      this.risingEdge();
    } else {
      this.clk = 0;
      this.fallingEdge();
    }
    return true;
  }

  /** One full clock pulse (rise + fall). Returns false if halted. */
  tick(): boolean {
    if (this.clk === 1) {
      // finish the current pulse first
      this.halfCycle();
      return true;
    }
    if (!this.halfCycle()) return false;
    this.halfCycle();
    return true;
  }

  /** Clock until the step counter wraps to T0 (one machine instruction). */
  stepInstruction(maxCycles = 64): number {
    let n = 0;
    do {
      if (!this.tick()) break;
      n++;
    } while (this.step !== 0 && n < maxCycles);
    return n;
  }

  /** Run until halted or `maxCycles` clock cycles have elapsed. Returns cycles run. */
  run(maxCycles = 100_000): number {
    let n = 0;
    while (n < maxCycles && this.tick()) n++;
    return n;
  }

  // ---- observers ----------------------------------------------------------------

  /** Call `cb` after every rising clock edge, with the pre-edge state and what was latched. */
  onRisingEdge(cb: (e: RisingEdgeEvent) => void): () => void {
    this.riseListeners.add(cb);
    return () => this.riseListeners.delete(cb);
  }

  /** Call `cb` after every falling clock edge (the step counter advanced). */
  onFallingEdge(cb: (e: FallingEdgeEvent) => void): () => void {
    this.fallListeners.add(cb);
    return () => this.fallListeners.delete(cb);
  }

  /** Call `cb` after the reset button cleared the registers. */
  onReset(cb: () => void): () => void {
    this.resetListeners.add(cb);
    return () => this.resetListeners.delete(cb);
  }

  /** Snapshot of everything an edge observer may want to know before the edge. */
  preEdgeState(): PreEdgeState {
    return {
      step: this.step, ir: this.ir, pc: this.pc, mar: this.mar, a: this.a, b: this.b, out: this.out,
      flags: this.flags, flagC: this.flagC, flagZ: this.flagZ,
      controlWord: this.controlWord, microcodeWord: this.microcodeWord,
      bus: this.bus, alu: this.alu, ramAddress: this.ramAddress, ramValue: this.ramValue,
    };
  }

  private risingEdge() {
    this.risingEdges++;
    const pre = this.riseListeners.size ? this.preEdgeState() : null;
    const cw = this.controlWord;
    const bus = this.bus;
    const alu = this.alu;
    const from = bus.drivers.length === 1 ? bus.drivers[0] : null;
    const v = bus.value;
    const t: Transfer[] = [];

    if (cw & MI) { this.mar = v & 0x0f; t.push({ signal: 'MI', from, to: 'mar', value: v & 0x0f }); }
    const riAt = t.length;
    if (cw & II) { this.ir = v; t.push({ signal: 'II', from, to: 'ir', value: v }); }
    if (cw & AI) { this.a = v; t.push({ signal: 'AI', from, to: 'a', value: v }); }
    if (cw & BI) { this.b = v; t.push({ signal: 'BI', from, to: 'b', value: v }); }
    if (cw & OI) { this.out = v; t.push({ signal: 'OI', from, to: 'out', value: v }); }
    if (cw & FI) {
      this.flagC = alu.carry;
      this.flagZ = alu.zero;
      t.push({ signal: 'FI', from: 'alu', to: 'flags', value: (alu.zero << 1) | alu.carry });
    }
    if (cw & J) {
      this.pc = v & 0x0f;
      t.push({ signal: 'J', from, to: 'pc', value: v & 0x0f });
    } else if (cw & CE) {
      this.pc = (this.pc + 1) & 0x0f;
      t.push({ signal: 'CE', from: null, to: 'pc', value: this.pc });
    }
    // RAM write: the ~10 µs W̅E̅ pulse starts just after the edge, so the 74189
    // sees the settled (post-edge) MAR and bus. In program mode the 74LS157
    // selects the write button instead, so RI does nothing.
    if (cw & RI && !this.programMode) {
      const value = this.resolveBus(true).value;
      this.ram[this.mar & 0x0f] = value;
      t.splice(riAt, 0, { signal: 'RI', from, to: 'ram', value });
    }
    this.lastTransfers = t;
    if (pre) {
      const e: RisingEdgeEvent = { edge: this.risingEdges, pre, transfers: t };
      for (const l of this.riseListeners) l(e);
    }
  }

  private fallingEdge() {
    const prevStep = this.step;
    this.cycles++;
    this.step = (this.step + 1) & 7;
    if (this.step >= this.stepsPerInstruction) this.step = 0;
    if (this.step === 0) this.instructions++;
    if (this.fallListeners.size) {
      const e: FallingEdgeEvent = { prevStep, step: this.step, cycles: this.cycles };
      for (const l of this.fallListeners) l(e);
    }
  }

  /**
   * Force the clock line low if HLT became active while it was high (can only
   * happen with manual control words). Real hardware: the AND gate drops CLK.
   */
  private enforceHalt() {
    if (this.clk === 1 && this.halted) {
      this.clk = 0;
      this.fallingEdge();
    }
  }

  // ---- front panel ------------------------------------------------------------

  /** The reset push button (CLR / CLR̅ lines). RAM and the clock are untouched. */
  reset() {
    for (const m of this.resetClears) {
      switch (m) {
        case 'a': this.a = 0; break;
        case 'b': this.b = 0; break;
        case 'ir': this.ir = 0; break;
        case 'mar': this.mar = 0; break;
        case 'pc': this.pc = 0; break;
        case 'step': this.step = 0; break;
        case 'out': this.out = 0; break;
        case 'flags': this.flagC = 0; this.flagZ = 0; break;
      }
    }
    this.lastTransfers = [];
    this.cycles = 0;
    this.instructions = 0;
    for (const l of this.resetListeners) l();
  }

  /** Load up to 16 bytes into RAM starting at address 0. */
  load(bytes: ArrayLike<number>) {
    this.ram.fill(0);
    for (let i = 0; i < Math.min(16, bytes.length); i++) this.ram[i] = bytes[i] & 0xff;
  }

  /** Press the RAM module's write button (only works in program mode). */
  programWrite(): boolean {
    if (!this.programMode) return false;
    this.ram[this.dipAddress & 0x0f] = this.dipData & 0xff;
    return true;
  }

  setManualControl(word: number | null) {
    this.manualControl = word;
    this.enforceHalt();
  }

  /** Swap in new microcode ("re-burn the EEPROMs"); if it now says HLT the clock drops, as with a manual HLT. */
  setMicrocode(mc: Microcode) {
    this.microcode = mc;
    this.enforceHalt();
  }

  snapshot(): ComputerSnapshot {
    return {
      clk: this.clk,
      a: this.a,
      b: this.b,
      ir: this.ir,
      mar: this.mar,
      pc: this.pc,
      out: this.out,
      step: this.step,
      flagC: this.flagC,
      flagZ: this.flagZ,
      ram: Array.from(this.ram),
      controlWord: this.controlWord,
      bus: this.bus,
      alu: this.alu,
      halted: this.halted,
      programMode: this.programMode,
      ramAddress: this.ramAddress,
      cycles: this.cycles,
      instructions: this.instructions,
    };
  }
}

/**
 * 74LS283 ×2 + 74LS86 ×2: Σ = A + (B XOR SU) + SU.
 * Carry out is the 8th-bit carry from the adders, so for subtraction carry=1
 * means "no borrow" (A >= B). Zero is detected on the ALU output.
 */
export function computeAlu(a: number, b: number, subtract: boolean): AluResult {
  const bb = subtract ? ~b & 0xff : b & 0xff;
  const sum = (a & 0xff) + bb + (subtract ? 1 : 0);
  const value = sum & 0xff;
  return { value, carry: sum > 0xff ? 1 : 0, zero: value === 0 ? 1 : 0, subtract };
}
