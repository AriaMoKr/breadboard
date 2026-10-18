/**
 * Event-driven, gate-level digital logic simulator used by the chapter labs
 * (SR/D latches, flip-flops, JK racing, tri-state buses, decoders, ...).
 *
 * Time is measured in abstract "gate delays". Every component has a
 * propagation delay (>= 1). A net carries one of four levels:
 *   0 / 1  - driven low / high
 *   'Z'    - floating (no enabled driver)
 *   'X'    - unknown, or contention (two drivers disagree)
 *
 * Delays are transport delays: every scheduled change is applied, so a
 * level-triggered JK flip-flop with J=K=1 really does race/oscillate while
 * its clock is high, exactly like in the video.
 */

export type Level = 0 | 1 | 'Z' | 'X';
export type Bit = 0 | 1;

export class Net {
  readonly drivers: Driver[] = [];
  readonly readers: Component[] = [];
  private _pull: Level = 'Z';
  constructor(
    readonly id: number,
    readonly name: string,
    public value: Level,
    private onPullChange?: (net: Net) => void,
  ) {}
  /**
   * Value seen when no driver is enabled (e.g. a pull-down resistor: 0).
   * Changing it re-resolves the net right away, even if no driver changes.
   */
  get pull(): Level {
    return this._pull;
  }
  set pull(level: Level) {
    if (level === this._pull) return;
    this._pull = level;
    this.onPullChange?.(this);
  }
}

export interface Driver {
  readonly net: Net;
  /** Level currently being driven onto the net. */
  value: Level;
  /** Last level scheduled for this driver (used to drop no-op events). */
  pending: Level;
  readonly owner: Component | null;
}

export interface EvalContext {
  readonly time: number;
  /** Resolved input levels at the previous evaluation (for edge detection). */
  readonly prevInputs: readonly Level[];
  /**
   * Schedule output `index` to become `level` after `delay` time units
   * (defaults to the component delay). Use for pulse generators etc.
   */
  schedule(index: number, level: Level, delay?: number): void;
  /** Free-form per-component state (e.g. a flip-flop's stored bit). */
  state: Record<string, unknown>;
}

export interface ComponentSpec {
  kind: string;
  name?: string;
  inputs: Net[];
  outputs: Net[];
  delay?: number;
  /**
   * Compute output levels from (resolved, gate-view) input levels. Return an
   * array to drive every output after `delay`, or void if you scheduled
   * outputs yourself via ctx.schedule.
   */
  evaluate(inputs: Level[], ctx: EvalContext): Level[] | void;
}

export interface Component {
  readonly id: number;
  readonly kind: string;
  readonly name: string;
  readonly inputs: Net[];
  readonly outputs: Net[];
  readonly drivers: Driver[];
  readonly delay: number;
  readonly state: Record<string, unknown>;
  prevInputs: Level[];
  readonly spec: ComponentSpec;
}

interface PendingEvent {
  driver: Driver;
  value: Level;
}

export interface SettleResult {
  stable: boolean;
  /** Time units advanced during this call. */
  steps: number;
}

export interface CircuitOptions {
  /** How a gate input reads a floating ('Z') net. TTL (74LS) inputs float high. */
  floatingInput?: Level;
}

export type GateKind = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR' | 'XNOR' | 'BUF';

// ---------------------------------------------------------------------------
// Level helpers

export const isKnown = (l: Level): l is Bit => l === 0 || l === 1;

export function and(levels: readonly Level[]): Level {
  let unknown = false;
  for (const l of levels) {
    if (l === 0) return 0;
    if (l !== 1) unknown = true;
  }
  return unknown ? 'X' : 1;
}

export function or(levels: readonly Level[]): Level {
  let unknown = false;
  for (const l of levels) {
    if (l === 1) return 1;
    if (l !== 0) unknown = true;
  }
  return unknown ? 'X' : 0;
}

export function not(l: Level): Level {
  return l === 0 ? 1 : l === 1 ? 0 : 'X';
}

export function xor(levels: readonly Level[]): Level {
  let acc = 0;
  for (const l of levels) {
    if (!isKnown(l)) return 'X';
    acc ^= l;
  }
  return acc as Bit;
}

export function evalGate(kind: GateKind, ins: readonly Level[]): Level {
  switch (kind) {
    case 'AND': return and(ins);
    case 'OR': return or(ins);
    case 'NOT': return not(ins[0]);
    case 'NAND': return not(and(ins));
    case 'NOR': return not(or(ins));
    case 'XOR': return xor(ins);
    case 'XNOR': return not(xor(ins));
    case 'BUF': return isKnown(ins[0]) ? ins[0] : 'X';
  }
}

/** Resolve several driver levels onto one net. */
export function resolve(values: readonly Level[], pull: Level): Level {
  let result: Level | null = null;
  for (const v of values) {
    if (v === 'Z') continue;
    if (v === 'X') return 'X';
    if (result === null) result = v;
    else if (result !== v) return 'X';
  }
  return result ?? pull;
}

// ---------------------------------------------------------------------------

export class Circuit {
  readonly nets: Net[] = [];
  readonly components: Component[] = [];
  time = 0;
  readonly floatingInput: Level;

  private queue = new Map<number, PendingEvent[]>();
  private times: number[] = []; // sorted, unique keys of `queue`
  private inputDrivers = new Map<Net, Driver>();
  private listeners = new Set<(c: Circuit) => void>();

  constructor(opts: CircuitOptions = {}) {
    this.floatingInput = opts.floatingInput ?? 1;
  }

  // ---- construction -------------------------------------------------------

  /** Create an internal net. `initial` is its power-up level (default 0). */
  net(name: string, initial: Level = 0): Net {
    const n = new Net(this.nets.length, name, initial, (net) => {
      if (this.updateNet(net)) this.evaluateReaders([net]);
      this.emit();
    });
    this.nets.push(n);
    return n;
  }

  /** Create a net driven by an external source (switch, button, generator). */
  input(name: string, initial: Level = 0): Net {
    const n = this.net(name, initial);
    const d: Driver = { net: n, value: initial, pending: initial, owner: null };
    n.drivers.push(d);
    this.inputDrivers.set(n, d);
    return n;
  }

  add(spec: ComponentSpec): Component {
    const delay = Math.max(1, Math.round(spec.delay ?? 1));
    const comp: Component = {
      id: this.components.length,
      kind: spec.kind,
      name: spec.name ?? `${spec.kind}${this.components.length}`,
      inputs: spec.inputs,
      outputs: spec.outputs,
      drivers: [],
      delay,
      state: {},
      prevInputs: spec.inputs.map(() => 'X' as Level),
      spec,
    };
    for (const out of spec.outputs) {
      const d: Driver = { net: out, value: out.value, pending: out.value, owner: comp };
      out.drivers.push(d);
      comp.drivers.push(d);
    }
    for (const inp of spec.inputs) if (!inp.readers.includes(comp)) inp.readers.push(comp);
    this.components.push(comp);
    // Initial evaluation so the component settles against current inputs.
    comp.prevInputs = this.readInputs(comp);
    this.evaluate(comp);
    return comp;
  }

  gate(kind: GateKind, inputs: Net[] | Net, output: Net, opts: { delay?: number; name?: string } = {}): Component {
    const ins = Array.isArray(inputs) ? inputs : [inputs];
    return this.add({ kind, name: opts.name, inputs: ins, outputs: [output], delay: opts.delay, evaluate: (l) => [evalGate(kind, l)] });
  }

  and(ins: Net[], out: Net, delay?: number) { return this.gate('AND', ins, out, { delay }); }
  or(ins: Net[], out: Net, delay?: number) { return this.gate('OR', ins, out, { delay }); }
  nand(ins: Net[], out: Net, delay?: number) { return this.gate('NAND', ins, out, { delay }); }
  nor(ins: Net[], out: Net, delay?: number) { return this.gate('NOR', ins, out, { delay }); }
  xor(ins: Net[], out: Net, delay?: number) { return this.gate('XOR', ins, out, { delay }); }
  not(inp: Net, out: Net, delay?: number) { return this.gate('NOT', [inp], out, { delay }); }
  buf(inp: Net, out: Net, delay?: number) { return this.gate('BUF', [inp], out, { delay }); }

  /** Tri-state buffer: out = data when enable is high (or low if activeLow), else 'Z'. */
  tri(data: Net, enable: Net, out: Net, opts: { activeLow?: boolean; delay?: number; name?: string } = {}): Component {
    return this.add({
      kind: 'TRI', name: opts.name, inputs: [data, enable], outputs: [out], delay: opts.delay,
      evaluate: ([d, e]) => {
        const en = opts.activeLow ? not(e) : e;
        if (en === 0) return ['Z'];
        if (en === 1) return [isKnown(d) ? d : 'X'];
        return ['X'];
      },
    });
  }

  /**
   * Edge detector (the RC differentiator from the "D flip-flop" video):
   * outputs a `width`-long high pulse after each rising edge of `inp`.
   */
  edgeDetector(inp: Net, out: Net, opts: { width?: number; delay?: number; name?: string } = {}): Component {
    const width = Math.max(1, opts.width ?? 2);
    return this.add({
      kind: 'EDGE', name: opts.name, inputs: [inp], outputs: [out], delay: opts.delay,
      evaluate: ([v], ctx) => {
        if (ctx.prevInputs[0] === 0 && v === 1) {
          ctx.schedule(0, 1);
          ctx.schedule(0, 0, (opts.delay ?? 1) + width);
        }
      },
    });
  }

  // ---- stimulus -----------------------------------------------------------

  /** Drive an input net (created with `input`) to a new level, immediately. */
  set(net: Net, level: Level): void {
    const d = this.inputDrivers.get(net);
    if (!d) throw new Error(`Net "${net.name}" is not an input`);
    if (d.value === level) return;
    d.value = level;
    d.pending = level;
    const changed = this.updateNet(net);
    if (changed) this.evaluateReaders([net]);
    this.emit();
  }

  toggle(net: Net): void {
    this.set(net, net.value === 1 ? 0 : 1);
  }

  get(net: Net): Level {
    return net.value;
  }

  /** Current value as a gate input would read it (floating -> floatingInput). */
  read(net: Net): Level {
    return net.value === 'Z' ? this.floatingInput : net.value;
  }

  // ---- time ---------------------------------------------------------------

  get idle(): boolean {
    return this.times.length === 0;
  }

  /** Advance exactly one time unit, applying any events scheduled for it. Returns how many nets changed level. */
  step(): number {
    this.time += 1;
    let changed = 0;
    if (this.times.length && this.times[0] <= this.time) {
      const t = this.times.shift()!;
      const events = this.queue.get(t)!;
      this.queue.delete(t);
      const changedNets = new Set<Net>();
      for (const ev of events) {
        if (ev.driver.value === ev.value) continue;
        ev.driver.value = ev.value;
        changedNets.add(ev.driver.net);
      }
      const really: Net[] = [];
      for (const n of changedNets) if (this.updateNet(n)) really.push(n);
      if (really.length) this.evaluateReaders(really);
      changed = really.length;
    }
    this.emit();
    return changed;
  }

  /** Advance `n` time units. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** Run until nothing is scheduled. `stable` is false if it never settles (oscillation). */
  settle(maxSteps = 10_000): SettleResult {
    let steps = 0;
    while (!this.idle && steps < maxSteps) {
      this.step();
      steps++;
    }
    return { stable: this.idle, steps };
  }

  onChange(cb: (c: Circuit) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- internals ----------------------------------------------------------

  private emit() {
    for (const l of this.listeners) l(this);
  }

  private updateNet(net: Net): boolean {
    const v = resolve(net.drivers.map((d) => d.value), net.pull);
    if (v === net.value) return false;
    net.value = v;
    return true;
  }

  private readInputs(comp: Component): Level[] {
    return comp.inputs.map((n) => this.read(n));
  }

  private evaluateReaders(nets: Net[]) {
    const comps = new Set<Component>();
    for (const n of nets) for (const c of n.readers) comps.add(c);
    for (const c of comps) this.evaluate(c);
  }

  private evaluate(comp: Component) {
    const inputs = this.readInputs(comp);
    const ctx: EvalContext = {
      time: this.time,
      prevInputs: comp.prevInputs,
      state: comp.state,
      schedule: (index, level, delay) => this.schedule(comp.drivers[index], level, delay ?? comp.delay, true),
    };
    const outs = comp.spec.evaluate(inputs, ctx);
    comp.prevInputs = inputs;
    if (outs) outs.forEach((l, i) => this.schedule(comp.drivers[i], l, comp.delay, false));
  }

  private schedule(driver: Driver, level: Level, delay: number, force: boolean) {
    if (!force && driver.pending === level) return;
    driver.pending = level;
    const t = this.time + Math.max(1, delay);
    let bucket = this.queue.get(t);
    if (!bucket) {
      bucket = [];
      this.queue.set(t, bucket);
      // insert t into sorted times
      let lo = 0, hi = this.times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.times[mid] < t) lo = mid + 1; else hi = mid;
      }
      this.times.splice(lo, 0, t);
    }
    bucket.push({ driver, value: level });
  }
}

/**
 * Records net levels over time for drawing timing diagrams / scope traces.
 * Call `sample()` after each circuit step (or attach with `attach()`).
 */
export class Trace {
  readonly samples: Level[][];
  readonly times: number[] = [];
  constructor(
    readonly nets: Net[],
    readonly maxLength = 400,
  ) {
    this.samples = nets.map(() => []);
  }

  sample(time: number) {
    this.times.push(time);
    this.nets.forEach((n, i) => this.samples[i].push(n.value));
    if (this.times.length > this.maxLength) {
      this.times.shift();
      for (const s of this.samples) s.shift();
    }
  }

  attach(circuit: Circuit): () => void {
    this.sample(circuit.time);
    return circuit.onChange((c) => {
      // replace the sample if time didn't advance (input toggled), else append
      if (this.times.length && this.times[this.times.length - 1] === c.time) {
        this.nets.forEach((n, i) => (this.samples[i][this.samples[i].length - 1] = n.value));
      } else this.sample(c.time);
    });
  }

  clear() {
    this.times.length = 0;
    for (const s of this.samples) s.length = 0;
  }
}
