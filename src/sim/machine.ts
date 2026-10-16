import { assemble, type AsmResult } from './assembler';
import { Computer, type ComputerOptions, type FallingEdgeEvent, type RisingEdgeEvent } from './computer';
import { buildMicrocode, MICROCODE_VERSIONS, type MicrocodeVersionId } from './microcode';

export type ClockMode = 'auto' | 'manual';

/**
 * Wraps a Computer with the clock module's front panel (the 555 astable in
 * "auto", the push button in "manual", the HLT gate) and turns wall-clock
 * time into clock half-cycles. UI code subscribes with `onChange`, which
 * fires at most once per `frame()`.
 */
export class Machine {
  readonly computer: Computer;
  mode: ClockMode = 'manual';
  /** Astable clock frequency in Hz. */
  hz = 2;
  /** Whether the astable clock is free-running (auto mode only). */
  running = false;
  microcodeVersion: MicrocodeVersionId = 'flags';
  /** Editable microcode template [opcode][step] (what the Arduino burns into the EEPROMs). */
  template: number[][];
  /** Patch JC/JZ step 2 with IO|J when their flag is set (the flags-aware EEPROM layout). */
  conditionalJumps = true;
  /** Output values written by OUT, most recent last (capped). */
  readonly outputLog: number[] = [];
  lastAsm: AsmResult | null = null;
  /** Source text of the last `loadSource` call (null until one happens). */
  lastSource: string | null = null;
  /** Incremented by every `loadSource` call, so views can notice a lab loading a program. */
  sourceVersion = 0;

  private phase = 0; // accumulated half-cycles
  private listeners = new Set<() => void>();
  private dirty = false;
  private seenEdges = 0;

  constructor(opts: ComputerOptions & { microcodeVersion?: MicrocodeVersionId } = {}) {
    if (opts.microcodeVersion) this.microcodeVersion = opts.microcodeVersion;
    const v = MICROCODE_VERSIONS[this.microcodeVersion];
    this.template = v.template.map((r) => [...r]);
    this.conditionalJumps = v.conditionalJumps;
    this.computer = new Computer({ ...opts, microcode: opts.microcode ?? buildMicrocode(this.template, this.conditionalJumps) });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Called after every rising clock edge (pre-edge state + transfers). See Computer.onRisingEdge. */
  onRisingEdge(cb: (e: RisingEdgeEvent) => void): () => void {
    return this.computer.onRisingEdge(cb);
  }

  /** Called after every falling clock edge (step counter advanced). */
  onFallingEdge(cb: (e: FallingEdgeEvent) => void): () => void {
    return this.computer.onFallingEdge(cb);
  }

  /**
   * Called whenever the reset button clears the registers (Machine.reset,
   * Computer.reset, loading a program). Fires before listeners of onChange.
   */
  onReset(cb: () => void): () => void {
    return this.computer.onReset(cb);
  }

  /** Notify listeners now. */
  changed() {
    this.dirty = false;
    for (const l of this.listeners) l();
  }

  private touch() {
    this.dirty = true;
  }

  private trackOutput() {
    const c = this.computer;
    if (c.risingEdges === this.seenEdges) return;
    this.seenEdges = c.risingEdges;
    if (c.lastTransfers.some((t) => t.signal === 'OI')) {
      this.outputLog.push(c.out);
      if (this.outputLog.length > 256) this.outputLog.shift();
    }
  }

  // ---- front panel ------------------------------------------------------------

  setMode(mode: ClockMode) {
    this.mode = mode;
    if (mode === 'manual') this.running = false;
    this.changed();
  }

  setHz(hz: number) {
    this.hz = Math.max(0.1, Math.min(hz, 2_000_000));
    this.changed();
  }

  start() {
    this.mode = 'auto';
    this.running = true;
    this.changed();
  }

  stop() {
    this.running = false;
    this.changed();
  }

  /** Manual push-button: one full clock pulse. */
  pulse(): boolean {
    const ok = this.computer.tick();
    this.trackOutput();
    this.changed();
    return ok;
  }

  /** Half a clock pulse (lets labs show the rising and falling edges separately). */
  halfPulse(): boolean {
    const ok = this.computer.halfCycle();
    this.trackOutput();
    this.changed();
    return ok;
  }

  stepInstruction() {
    const c = this.computer;
    let n = 0;
    do {
      if (!c.tick()) break;
      this.trackOutput();
      n++;
    } while (c.step !== 0 && n < 64);
    this.changed();
  }

  reset() {
    this.outputLog.length = 0;
    this.phase = 0;
    this.computer.reset();
    this.seenEdges = this.computer.risingEdges;
    this.changed();
  }

  /** Assemble and load a program (also resets). Returns the assembler result. */
  loadSource(source: string): AsmResult {
    const res = assemble(source);
    this.lastAsm = res;
    this.lastSource = source;
    this.sourceVersion++;
    if (res.errors.length === 0) {
      this.computer.load(res.bytes);
      this.reset();
    } else this.changed();
    return res;
  }

  loadBytes(bytes: ArrayLike<number>) {
    this.computer.load(bytes);
    this.reset();
  }

  setMicrocodeVersion(id: MicrocodeVersionId) {
    const v = MICROCODE_VERSIONS[id];
    this.microcodeVersion = id;
    this.template = v.template.map((r) => [...r]);
    this.conditionalJumps = v.conditionalJumps;
    this.rebuildMicrocode();
  }

  /** Change one microinstruction (opcode, step) in the template and re-"burn" the EEPROMs. */
  editMicrocode(opcode: number, step: number, word: number) {
    this.template[opcode & 15][step & 7] = word & 0xffff;
    this.rebuildMicrocode();
  }

  rebuildMicrocode() {
    this.computer.setMicrocode(buildMicrocode(this.template, this.conditionalJumps));
    this.changed();
  }

  // ---- time -------------------------------------------------------------------

  /**
   * Advance by `dtMs` of wall-clock time. Call from requestAnimationFrame.
   * Runs at most `maxHalfCycles` half-cycles per call to stay responsive.
   */
  frame(dtMs: number, maxHalfCycles = 400_000) {
    if (this.mode === 'auto' && this.running) {
      const c = this.computer;
      this.phase += (Math.min(dtMs, 250) / 1000) * this.hz * 2;
      let n = Math.floor(this.phase);
      if (n > maxHalfCycles) {
        n = maxHalfCycles;
        this.phase = 0;
      } else this.phase -= n;
      for (let i = 0; i < n; i++) {
        if (!c.halfCycle()) {
          this.phase = 0;
          break;
        }
        this.trackOutput();
        this.touch();
      }
    }
    if (this.dirty) this.changed();
  }
}
