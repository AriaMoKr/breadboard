import { Circuit, resolve, type Component, type EvalContext, type Level, type Net } from '../../logic/circuit';
import { CHIPS } from '../catalog';
import { parseHole } from '../geometry';
import { SEG7_PINS, partPins, type Layout, type Part, type PartPin } from '../layout';
import { GND_NET, VCC_NET, buildNets, type Netlist } from '../nets';
import { CHIP_MODELS } from './chips';
import type { BoardSimulator, ChipModel, ChipParams, SimProblem } from './types';

/**
 * Chip-level simulation of a breadboard layout.
 *
 * `new BreadboardSim(layout)` compiles the layout into a `Circuit`
 * (src/logic/circuit.ts) and keeps it running as switches move:
 *
 * NETS. `buildNets` (src/breadboard/nets.ts) joins strips, rails, wires,
 * closed switches and same-named ports. VCC (+5 V rails) and GND get strong
 * drivers (1 / 0). Every net that carries a port also gets an external
 * driver, released ('Z') until `setPort` drives it. A floating net reads 1
 * at a chip input (LS-TTL).
 *
 * LEGS THAT AREN'T IN A HOLE (a hole that doesn't exist, e.g. a chip
 * hanging off the end of the board, or a board that isn't in the layout)
 * are unconnected: such a leg gets a private floating net, and a wire,
 * button, slide or DIP switch with a leg in the air connects nothing. A
 * part whose id repeats an earlier one is ignored. So an imported or
 * half-finished layout always simulates; `validateLayout` says what's wrong
 * with it.
 *
 * CHIPS. One `Component` per chip, behaviour from `CHIP_MODELS`
 * (src/breadboard/sim/chips.ts). A chip is powered only if its VCC pin is
 * on +5 V and its GND pin on ground; otherwise it is left out (its outputs
 * float) and reported. A chip without a model is reported as unknown.
 *
 * SWITCHES (push buttons, slide switches, DIP switches) change
 * connectivity. Moving one rebuilds the nets and the circuit at the current
 * time, carrying over every chip's internal state (`ctx.state`), its output
 * levels, its last inputs (so edges are detected across the rebuild) and
 * every output change it has scheduled but that has not happened yet (so a
 * 555 keeps ticking). Only chips whose inputs changed are evaluated, with
 * their normal delay. A press costs one `buildNets` plus one pass over the
 * parts.
 *
 * POWER-UP. Chips that have just been powered start with their outputs
 * released and are relaxed in zero time, one output change at a time
 * (Gauss-Seidel), until they agree with each other. This settles
 * cross-coupled latches into a valid state, like real gates that are never
 * exactly matched, instead of oscillating forever as perfectly symmetric
 * transport-delay gates would. Then the clock starts. (A circuit that never
 * agrees with itself, like a ring oscillator, runs out of relaxation budget
 * and carries on oscillating in real time.)
 *
 * RESISTORS.
 * - One end on VCC or GND, the other on a signal net: a weak pull on that
 *   net (`Net.pull`): the level it has when nothing drives it. Several
 *   pulls on one net: the lowest resistance wins; equal resistances pulling
 *   opposite ways give 'X'.
 * - Between two signal nets (a series resistor): if exactly one side has a
 *   level of its own (a driver, or a pull) and the other side has no driver
 *   and no stronger pull, the other side follows it: chips read it one gate
 *   delay later, LEDs and display segments see it at once. So "output,
 *   series resistor, LED" works with the resistor on either leg, and an
 *   input fed through a resistor reads what is on the far side. Otherwise
 *   (both sides driven, a voltage divider) each side keeps its own level,
 *   and an LED on a floating side looks through the resistor. The engine
 *   doesn't model LS-TTL input current, so a large series or pull-down
 *   resistor passes a 0 here even where the real chip would read 1.
 * - Both ends on supplies (or on one net): ignored.
 *
 * CAPACITORS and POTS have no DC path and are ignored, with one exception:
 * an RC differentiator, i.e. a capacitor from a driven net A to a net B that
 * nothing drives but that is pulled to one level by a resistor. B then
 * pulses away from its pull for `edgeWidth` gate delays after each edge of A
 * in that direction (pull-down: high pulse after A rises; pull-up: low pulse
 * after A falls). That is the RAM write edge detector (C7 + R58) of Ben's
 * computer and the clock edge detector of the D flip-flop video. The other
 * edge's spike is clamped and ignored.
 *
 * LEDs. Lit iff the anode side is at 1 and the cathode side at 0, each seen
 * through at most one series resistor. An LED whose anode is tied low, or
 * whose cathode is tied high (to the supply, or by a pull with nothing else
 * driving it), while its other leg can take the opposite level, is
 * reported as reversed.
 * 7-SEGMENT displays: for common cathode a segment is lit iff its pin is 1
 * and the common is 0; for common anode iff its pin is 0 and the common is
 * 1 (both seen through at most one resistor; either common pin counts).
 * `seg7()` returns the lit segments as dp a b c d e f g (bit 7 .. bit 0),
 * like src/sim/display.ts.
 *
 * PORTS. `setPort(name, level)` drives a named port's net from outside,
 * `setPort(name, null)` releases it; this is how a module board is tested
 * on its own.
 *
 * TIME is counted in gate delays: `step(n)`, `run(n)`, `settle(max)` and
 * `pulse(portOrButton, units)`. A chip's delay is its model's `delay`, or
 * `params.delay` when the layout (or `setParams`) gives one.
 */

export interface BreadboardSimOptions {
  /** Chip models used instead of (or in addition to) CHIP_MODELS, by catalog id. */
  models?: Record<string, ChipModel>;
  /** Pulse width of an RC differentiator, in gate delays (default 4). */
  edgeWidth?: number;
}

export interface ProblemOptions {
  /** Also report chip inputs on nets that nothing drives or pulls (they read 1, like LS-TTL). Off by default: Ben relies on it. */
  floatingInputs?: boolean;
}

interface FutureEvent {
  at: number;
  i: number;
  level: Level;
}

/**
 * Something with behaviour (a chip, an RC differentiator, a series
 * resistor feeding an undriven net). Lives across rebuilds, keyed by part
 * id, so its state and scheduled outputs survive.
 */
interface Active {
  key: string;
  partId: string;
  model: ChipModel;
  params: ChipParams;
  delay: number;
  /** Reads raw net levels ('Z' stays 'Z') instead of LS-TTL input levels. */
  raw: boolean;
  state: Record<string, unknown>;
  /** Inputs at the last evaluation (read levels, 'Z' already read as 1 unless raw). */
  prev?: Level[];
  /** Outputs returned by the last evaluation. */
  lastOuts?: readonly (Level | undefined)[];
  /** Level each output driver is driving now. */
  out: Level[];
  /** Last level scheduled per output (Circuit's dedupe key). */
  pending: Level[];
  /** Output changes scheduled for the future (absolute times). */
  events: FutureEvent[];
  // ---- per build
  inputs: Net[];
  outputs: Net[];
  comp?: Component;
}

interface ExtInfo {
  supply: Level[];
  ports: string[];
}

/** A part of the layout as the engine places it. */
interface Entry {
  part: Part;
  pins: PartPin[];
  /** Per leg: is it in a hole that exists, on a board of the layout? */
  inHole: boolean[];
  /** Every leg is in a hole: the part takes part in `buildNets`. */
  complete: boolean;
}

interface Build {
  nl: Netlist;
  circuit: Circuit;
  shorted: boolean;
  /** Net id -> Net. */
  nets: Map<string, Net>;
  vcc?: Net;
  gnd?: Net;
  ext: Map<Net, ExtInfo>;
  portNet: Map<string, Net>;
  /** Weak links (resistors between signal nets). */
  links: Map<Net, Net[]>;
  /** Nets that follow another net through a series resistor -> that net. */
  linkSrc: Map<Net, Net>;
  /** Nets something can drive (supplies, ports, chip outputs, RC pulses, series resistors). */
  drivable: Set<Net>;
  /** A hole on each net, "board:hole", for problem highlighting. */
  holeOf: Map<Net, string>;
  /** Part id -> net of each leg (partPins order). */
  partNets: Map<string, Net[]>;
  actives: Active[];
  /** Problems known when the circuit was built (power, unknown chips, reversed LEDs, short). */
  staticProblems: SimProblem[];
}

const SEG_BITS: Record<string, number> = { dp: 0x80, a: 0x40, b: 0x20, c: 0x10, d: 0x08, e: 0x04, f: 0x02, g: 0x01 };

const sameLevels = (a: readonly Level[], b: readonly Level[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const readLevel = (l: Level): Level => (l === 'Z' ? 1 : l);
const known = (l: Level): l is 0 | 1 => l === 0 || l === 1;
const holeExists = (hole: string) => {
  try {
    parseHole(hole);
    return true;
  } catch {
    return false;
  }
};

/** Zero-time power-up relaxation budget: evaluations per chip output, plus a floor. */
const RELAX_PER_OUTPUT = 64;
const RELAX_MIN = 256;

/** A capacitor into a pulled, undriven net: pulses away from the pull after each edge of the source. */
function rcModel(pull: 0 | 1, width: number): ChipModel {
  return {
    id: 'RC',
    inputs: [],
    outputs: [],
    delay: 1,
    evaluate([cur], ctx) {
      const prev = ctx.prevInputs[0];
      const edge = pull === 0 ? prev === 0 && cur === 1 : prev === 1 && cur === 0;
      if (!edge) return;
      ctx.schedule(0, pull === 0 ? 1 : 0, 1);
      ctx.schedule(0, 'Z', 1 + width);
    },
  };
}

/** A series resistor into an undriven net: that net follows the far side (raw levels, so floating stays floating). */
const LINK_MODEL: ChipModel = { id: 'R', inputs: [], outputs: [], delay: 1, evaluate: ([v]) => [v] };

export class BreadboardSim implements BoardSimulator {
  private layoutData: Layout;
  private readonly models: Record<string, ChipModel>;
  private readonly rc: Record<0 | 1, ChipModel>;
  private parts = new Map<string, Part>();
  private entries: Entry[] = [];
  private layoutProblems: SimProblem[] = [];
  private buttons = new Set<string>();
  private slides = new Map<string, 0 | 1>();
  private dips = new Map<string, number>();
  private portDrive = new Map<string, Level>();
  private pots = new Map<string, number>();
  private paramOverrides = new Map<string, ChipParams>();
  private actives = new Map<string, Active>();
  private b!: Build;
  private adding = false;
  private listeners = new Set<(sim: BreadboardSim) => void>();
  private rebuilds = 0;

  constructor(layout: Layout, opts: BreadboardSimOptions = {}) {
    this.models = { ...CHIP_MODELS, ...opts.models };
    const width = Math.max(1, Math.round(opts.edgeWidth ?? 4));
    this.rc = { 0: rcModel(0, width), 1: rcModel(1, width) };
    this.layoutData = layout;
    this.index();
    this.rebuild();
  }

  // ---- inspection ----------------------------------------------------------

  get layout(): Layout {
    return this.layoutData;
  }

  /** The circuit currently simulated (replaced when a switch moves). */
  get circuit(): Circuit {
    return this.b.circuit;
  }

  /** Current connectivity. */
  get netlist(): Netlist {
    return this.b.nl;
  }

  /** Simulation time in gate delays. */
  get time(): number {
    return this.b.circuit.time;
  }

  /** How many times the circuit was rebuilt (switch moves, layout changes). */
  get rebuildCount(): number {
    return this.rebuilds;
  }

  /** Net id of a hole ("VCC", "GND", "port:BUS3" or an internal id). */
  netOf(board: string, hole: string): string {
    return this.b.nl.netOf(board, hole);
  }

  /** Level of the net at a hole. Holes with nothing in their strip, and holes that don't exist, are 'Z'. */
  level(board: string, hole: string): Level {
    if (!holeExists(hole)) return 'Z';
    return this.b.nets.get(this.b.nl.netOf(board, hole))?.value ?? 'Z';
  }

  /** Levels of every leg of a part, in `partPins` order (chips: pin 1 first). */
  partLevels(partId: string): Level[] {
    return this.legs(partId).map((n) => n.value);
  }

  /** Level of one chip pin, by number or datasheet name. */
  pinLevel(partId: string, pin: number | string): Level {
    const pins = this.entry(partId).pins;
    const i = typeof pin === 'number' ? pins.findIndex((x) => x.number === pin) : pins.findIndex((x) => x.name.toLowerCase() === pin.toLowerCase());
    if (i < 0) throw new Error(`${partId} has no pin ${pin}`);
    return this.legs(partId)[i].value;
  }

  /** Internal state of a chip (`ctx.state` of its model), or undefined if it is not running. */
  chipState(partId: string): Record<string, unknown> | undefined {
    return this.actives.get(`chip:${partId}`)?.state;
  }

  portLevel(name: string): Level {
    return this.portNetOf(name).value;
  }

  /** Port names in the layout. */
  ports(): string[] {
    return [...this.b.portNet.keys()];
  }

  onChange(cb: (sim: BreadboardSim) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- outside world -------------------------------------------------------

  setPort(name: string, level: Level | null): void {
    const net = this.portNetOf(name);
    if (level === null) this.portDrive.delete(name);
    else this.portDrive.set(name, level);
    this.b.circuit.set(net, this.extLevel(this.b.ext.get(net)!));
  }

  /** Level a port is driven to from outside, or null if released. */
  portDriven(name: string): Level | null {
    return this.portDrive.get(name) ?? null;
  }

  press(partId: string): void {
    this.expect(partId, 'button');
    if (this.buttons.has(partId)) return;
    this.buttons.add(partId);
    this.rebuild();
  }

  release(partId: string): void {
    this.expect(partId, 'button');
    if (!this.buttons.delete(partId)) return;
    this.rebuild();
  }

  isPressed(partId: string): boolean {
    return this.buttons.has(partId);
  }

  setSlide(partId: string, pos: 0 | 1): void {
    this.expect(partId, 'slide');
    const p = pos ? 1 : 0;
    if (this.slides.get(partId) === p) return;
    this.slides.set(partId, p);
    this.rebuild();
  }

  slidePos(partId: string): 0 | 1 {
    this.expect(partId, 'slide');
    return this.slides.get(partId) ?? 0;
  }

  setDip(partId: string, value: number): void {
    const p = this.expect(partId, 'dip');
    const v = value & ((1 << p.positions) - 1);
    if ((this.dips.get(partId) ?? 0) === v) return;
    this.dips.set(partId, v);
    this.rebuild();
  }

  /** DIP value: bit k-1 = switch k ON. */
  dipValue(partId: string): number {
    this.expect(partId, 'dip');
    return this.dips.get(partId) ?? 0;
  }

  /**
   * Remember a pot's position (0..1) for the UI. Pots have no electrical
   * effect here; to change a 555's speed, use `setParams` (e.g. halfPeriod).
   */
  setPot(partId: string, t: number): void {
    this.expect(partId, 'pot');
    this.pots.set(partId, Math.max(0, Math.min(1, t)));
  }

  potValue(partId: string): number {
    this.expect(partId, 'pot');
    return this.pots.get(partId) ?? 0.5;
  }

  /**
   * Change a chip's model parameters while it runs (they override the
   * layout's `params` and survive rebuilds), e.g. a 555's halfPeriod. The
   * chip sees them at its next evaluation; a 28C16 reads `image` only at
   * power-up.
   */
  setParams(partId: string, patch: ChipParams): void {
    this.expect(partId, 'chip');
    this.paramOverrides.set(partId, { ...this.paramOverrides.get(partId), ...patch });
    const a = this.actives.get(`chip:${partId}`);
    if (a) {
      Object.assign(a.params, patch);
      if (typeof patch.delay === 'number') a.delay = Math.max(1, Math.round(patch.delay));
    }
  }

  /**
   * Replace the layout (sandbox edits) without a power cycle: chips that
   * keep their id and type keep their state, switches and port drives that
   * still exist keep their positions.
   */
  setLayout(layout: Layout): void {
    this.layoutData = layout;
    const keep = new Map(this.parts);
    this.index();
    for (const id of [...this.buttons]) if (this.parts.get(id)?.kind !== 'button') this.buttons.delete(id);
    for (const id of [...this.slides.keys()]) if (this.parts.get(id)?.kind !== 'slide') this.slides.delete(id);
    for (const id of [...this.dips.keys()]) if (this.parts.get(id)?.kind !== 'dip') this.dips.delete(id);
    for (const [key, a] of [...this.actives]) {
      const before = keep.get(a.partId), now = this.parts.get(a.partId);
      if (!now || !before || now.kind !== before.kind || (now.kind === 'chip' && before.kind === 'chip' && now.chip !== before.chip)) this.actives.delete(key);
    }
    const names = new Set(layout.parts.filter((p) => p.kind === 'port').map((p) => (p as Extract<Part, { kind: 'port' }>).name));
    for (const n of [...this.portDrive.keys()]) if (!names.has(n)) this.portDrive.delete(n);
    for (const id of [...this.pots.keys()]) if (this.parts.get(id)?.kind !== 'pot') this.pots.delete(id);
    for (const id of [...this.paramOverrides.keys()]) if (this.parts.get(id)?.kind !== 'chip') this.paramOverrides.delete(id);
    this.rebuild();
  }

  // ---- reading the display parts --------------------------------------------

  ledLit(partId: string): boolean {
    this.expect(partId, 'led');
    const nets = this.b.partNets.get(partId);
    if (!nets) return false;
    const [anode, cathode] = nets;
    return this.seen(anode) === 1 && this.seen(cathode) === 0;
  }

  seg7(partId: string): number {
    const p = this.expect(partId, 'seg7');
    const nets = this.b.partNets.get(partId);
    if (!nets) return 0;
    // the two common pins are joined inside the display: either one counts
    let com: Level = 'Z';
    for (let i = 0; i < SEG7_PINS.length; i++) {
      if (SEG7_PINS[i] !== 'com') continue;
      const l = this.seen(nets[i]);
      if (known(l)) com = com === 'Z' || com === l ? l : 'X';
    }
    const on: 0 | 1 = p.common === 'cathode' ? 1 : 0;
    if (com !== 1 - on) return 0;
    let byte = 0;
    for (let i = 0; i < SEG7_PINS.length; i++) {
      const name = SEG7_PINS[i];
      if (name !== 'com' && this.seen(nets[i]) === on) byte |= SEG_BITS[name];
    }
    return byte;
  }

  // ---- time -----------------------------------------------------------------

  step(n = 1): void {
    this.b.circuit.run(Math.max(0, Math.floor(n)));
  }

  stepToChange(max = 100_000): { steps: number; changed: number } {
    const c = this.b.circuit;
    let steps = 0;
    while (steps < max && !c.idle) {
      steps++;
      const changed = c.step();
      if (changed) return { steps, changed };
    }
    return { steps, changed: 0 };
  }

  /** Same as `step(n)`. */
  run(n: number): void {
    this.step(n);
  }

  settle(max = 10_000): { stable: boolean; steps: number } {
    return this.b.circuit.settle(max);
  }

  /**
   * Test helper: for a button, press it, wait `units`, release it, wait
   * `units`. For a port, drive it to `active` (default 1), wait, drive it to
   * the opposite level, wait. The port stays driven afterwards.
   */
  pulse(target: string, units = 10, active: 0 | 1 = 1): void {
    if (this.parts.get(target)?.kind === 'button') {
      this.press(target);
      this.step(units);
      this.release(target);
      this.step(units);
      return;
    }
    if (!this.b.portNet.has(target)) throw new Error(`No button or port named "${target}"`);
    this.setPort(target, active);
    this.step(units);
    this.setPort(target, active ? 0 : 1);
    this.step(units);
  }

  // ---- problems -------------------------------------------------------------

  problems(opts: ProblemOptions = {}): SimProblem[] {
    const out = [...this.b.staticProblems];
    const b = this.b;
    for (const n of b.circuit.nets) {
      if (n.value !== 'X') continue;
      const ext = b.ext.get(n);
      if (b.shorted && ext?.supply.length) continue; // reported as a short
      // who drives what, with the outside world (supplies, ports) split up
      const drives: { who: string; part?: string; level: Level }[] = [];
      for (const d of n.drivers) {
        if (d.value === 'Z') continue;
        if (d.owner) drives.push({ who: d.owner.name, part: d.owner.name, level: d.value });
        else if (ext) {
          for (const l of ext.supply) drives.push({ who: l === 1 ? 'the +5 V supply' : 'ground', level: l });
          for (const name of ext.ports) {
            const l = this.portDrive.get(name);
            if (l !== undefined && l !== 'Z') drives.push({ who: `port ${name}`, level: l });
          }
        }
      }
      const levels = new Set(drives.map((d) => d.level));
      if (levels.has(0) && levels.has(1)) {
        out.push({
          kind: 'contention',
          message: `Contention on ${this.netLabel(n)}: ${drives.map((d) => `${d.who} drives ${d.level}`).join(', ')}`,
          part: drives.find((d) => d.part)?.part,
          at: b.holeOf.get(n),
        });
      } else if (!drives.length && n.pull === 'X') {
        out.push({ kind: 'contention', message: `${this.netLabel(n)} is pulled up and down equally hard`, at: b.holeOf.get(n) });
      }
    }
    if (opts.floatingInputs) {
      for (const a of b.actives) {
        if (!a.key.startsWith('chip:')) continue;
        const p = this.parts.get(a.partId) as Extract<Part, { kind: 'chip' }>;
        a.inputs.forEach((n, i) => {
          if (n.value !== 'Z' || b.drivable.has(n)) return;
          const pin = a.model.inputs[i];
          out.push({ kind: 'floating-input', part: a.partId, message: `${a.partId} pin ${pin} (${CHIPS[p.chip].pins[pin - 1]}) is not connected to anything that drives it`, at: b.holeOf.get(n) });
        });
      }
    }
    return out;
  }

  // ---- internals: compiling --------------------------------------------------

  /** Index the layout: parts by id (the first of a repeated id wins), legs and which of them are in a hole. */
  private index() {
    this.parts.clear();
    this.entries = [];
    this.layoutProblems = [];
    const boards = new Set(this.layoutData.boards.map((b) => b.id));
    for (const p of this.layoutData.parts) {
      if (this.parts.has(p.id)) continue;
      this.parts.set(p.id, p);
      if (p.kind === 'slide' && !this.slides.has(p.id)) this.slides.set(p.id, p.initial ?? 0);
      if (p.kind === 'chip' && !CHIPS[p.chip]) {
        this.layoutProblems.push({ kind: 'unknown-chip', part: p.id, message: `${p.id}: "${p.chip}" is not in the chip catalog` });
        continue;
      }
      let pins: PartPin[] | undefined;
      try {
        pins = partPins(p);
      } catch {
        pins = undefined;
      }
      if (!Array.isArray(pins)) continue; // not a part kind this engine knows (imported JSON)
      const onBoard = boards.has(p.board);
      const inHole = pins.map((pin) => onBoard && holeExists(pin.hole));
      this.entries.push({ part: p, pins, inHole, complete: inHole.every(Boolean) });
    }
  }

  private part(id: string): Part {
    const p = this.parts.get(id);
    if (!p) throw new Error(`No part "${id}"`);
    return p;
  }

  private entry(id: string): Entry {
    this.part(id);
    const e = this.entries.find((x) => x.part.id === id);
    if (!e) throw new Error(`Part "${id}" is not simulated (unknown chip?)`);
    return e;
  }

  /** Nets of a part's legs. */
  private legs(id: string): Net[] {
    this.part(id);
    const nets = this.b.partNets.get(id);
    if (!nets) throw new Error(`Part "${id}" is not simulated (unknown chip?)`);
    return nets;
  }

  private expect<K extends Part['kind']>(id: string, kind: K): Extract<Part, { kind: K }> {
    const p = this.part(id);
    if (p.kind !== kind) throw new Error(`Part "${id}" is a ${p.kind}, not a ${kind}`);
    return p as Extract<Part, { kind: K }>;
  }

  private portNetOf(name: string): Net {
    const n = this.b.portNet.get(name);
    if (!n) throw new Error(`No port named "${name}"`);
    return n;
  }

  private extLevel(e: ExtInfo): Level {
    const levels: Level[] = [...e.supply];
    for (const name of e.ports) {
      const l = this.portDrive.get(name);
      if (l !== undefined) levels.push(l);
    }
    return resolve(levels, 'Z');
  }

  private netLabel(n: Net): string {
    if (n.name === VCC_NET) return '+5 V';
    if (n.name === GND_NET) return 'GND';
    if (n.name.startsWith('port:')) return n.name.slice(5);
    return `the net at ${this.b.holeOf.get(n) ?? n.name}`;
  }

  private emit() {
    for (const l of this.listeners) l(this);
  }

  /** Rebuild nets and circuit at the current time, carrying over all chip state. */
  private rebuild() {
    const old = this.b?.circuit;
    const T = old?.time ?? 0;
    if (old) {
      for (const a of this.actives.values()) {
        if (a.comp) {
          a.out = a.comp.drivers.map((d) => d.value);
          a.pending = a.comp.drivers.map((d) => d.pending);
          a.comp = undefined;
        }
        a.events = a.events.filter((e) => e.at > T);
      }
    }
    this.b = this.compile(T);
    this.rebuilds++;
    this.b.circuit.onChange(() => this.emit());
    this.emit();
  }

  private compile(T: number): Build {
    const problems: SimProblem[] = [...this.layoutProblems];
    const entries = this.entries;
    const nl = buildNets(
      { boards: this.layoutData.boards, parts: entries.filter((e) => e.complete).map((e) => e.part) },
      { buttons: this.buttons, slides: this.slides, dips: this.dips },
    );
    const members = nl.members();
    const shorted = nl.shorted;
    const vccId = shorted ? (members.has(VCC_NET) ? VCC_NET : GND_NET) : VCC_NET;
    const gndId = shorted ? vccId : GND_NET;
    const c = new Circuit({ floatingInput: 1 });
    c.time = T;

    // ---- external drivers: supplies and ports
    const extById = new Map<string, ExtInfo>();
    const extFor = (id: string) => {
      let e = extById.get(id);
      if (!e) extById.set(id, (e = { supply: [], ports: [] }));
      return e;
    };
    if (members.has(vccId)) extFor(vccId).supply.push(1);
    if (members.has(gndId)) extFor(gndId).supply.push(0);
    const portIds = new Map<string, string>();
    for (const { part: p, complete } of entries) {
      if (p.kind !== 'port' || !complete) continue;
      const id = nl.netOf(p.board, p.hole);
      portIds.set(p.name, id);
      const e = extFor(id);
      if (!e.ports.includes(p.name)) e.ports.push(p.name);
    }

    const nets = new Map<string, Net>();
    const ext = new Map<Net, ExtInfo>();
    const net = (id: string): Net => {
      let n = nets.get(id);
      if (n) return n;
      const e = extById.get(id);
      if (e) {
        n = c.input(id, this.extLevel(e));
        ext.set(n, e);
      } else n = c.net(id, 'Z');
      nets.set(id, n);
      return n;
    };
    for (const id of members.keys()) net(id);
    const portNet = new Map<string, Net>();
    for (const [name, id] of portIds) portNet.set(name, net(id));
    const vcc = nets.get(vccId), gnd = nets.get(gndId);
    const supplyLevel = (n: Net): 0 | 1 | null => (shorted ? null : n === vcc ? 1 : n === gnd ? 0 : null);

    // ---- where each part's legs are (a leg in the air gets a net of its own)
    const holeOf = new Map<Net, string>();
    const partNets = new Map<string, Net[]>();
    const dangling = new Set<Net>();
    for (const { part: p, pins, inHole } of entries) {
      const legs = pins.map((pin, i) => {
        if (!inHole[i]) {
          const n = c.net(`${p.id}.${pin.name}`, 'Z');
          dangling.add(n);
          return n;
        }
        const n = net(nl.netOf(p.board, pin.hole));
        if (!holeOf.has(n)) holeOf.set(n, `${p.board}:${pin.hole}`);
        return n;
      });
      partNets.set(p.id, legs);
    }
    const attached = (legs: Net[]) => legs.every((n) => !dangling.has(n));
    if (shorted) {
      const at = vcc ? holeOf.get(vcc) : undefined;
      problems.push({ kind: 'short', message: '+5 V and GND are shorted together', at });
    }

    // ---- resistors: pulls and series links
    const pullsOf = new Map<Net, { level: 0 | 1; ohms: number }[]>();
    const links = new Map<Net, Net[]>();
    /** Series resistors at each signal net: the net on the other side and the smallest resistance to it. */
    const series = new Map<Net, Map<Net, { ohms: number; id: string }>>();
    const link = (x: Net, y: Net, ohms: number, id: string) => {
      const l = links.get(x) ?? [];
      if (!l.includes(y)) l.push(y);
      links.set(x, l);
      const s = series.get(x) ?? new Map<Net, { ohms: number; id: string }>();
      const had = s.get(y);
      if (!had || ohms < had.ohms) s.set(y, { ohms, id });
      series.set(x, s);
    };
    for (const { part: p } of entries) {
      if (p.kind !== 'resistor') continue;
      const legs = partNets.get(p.id)!;
      if (!attached(legs)) continue;
      const [na, nb] = legs;
      if (na === nb) continue;
      const sa = supplyLevel(na), sb = supplyLevel(nb);
      if (sa !== null && sb !== null) continue;
      const ohms = Number.isFinite(p.ohms) && p.ohms > 0 ? p.ohms : 1;
      const pull = (n: Net, level: 0 | 1) => {
        const l = pullsOf.get(n) ?? [];
        l.push({ level, ohms });
        pullsOf.set(n, l);
      };
      if (sa !== null) pull(nb, sa);
      else if (sb !== null) pull(na, sb);
      else {
        link(na, nb, ohms, p.id);
        link(nb, na, ohms, p.id);
      }
    }
    const pullOhms = new Map<Net, number>();
    for (const [n, list] of pullsOf) {
      const best = (lv: 0 | 1) => Math.min(...list.filter((x) => x.level === lv).map((x) => x.ohms));
      const up = best(1), down = best(0);
      n.pull = up < down ? 1 : down < up ? 0 : 'X';
      pullOhms.set(n, Math.min(up, down));
    }

    // ---- chips
    const used = new Set<string>();
    const fresh: Active[] = [];
    const built: Active[] = [];
    const activate = (key: string, partId: string, model: ChipModel, params: ChipParams, inputs: Net[], outputs: Net[], raw = false) => {
      let a = this.actives.get(key);
      if (!a || a.model !== model || a.outputs.length !== outputs.length) {
        a = { key, partId, model, params, delay: 1, raw, state: {}, out: [], pending: [], events: [], inputs: [], outputs: [] };
        a.out = outputs.map(() => 'Z' as Level);
        a.pending = outputs.map(() => 'Z' as Level);
        this.actives.set(key, a);
        fresh.push(a);
      }
      a.model = model;
      a.params = params;
      a.raw = raw;
      a.delay = Math.max(1, Math.round(typeof params.delay === 'number' ? params.delay : (model.delay ?? 1)));
      a.inputs = inputs;
      a.outputs = outputs;
      used.add(key);
      built.push(a);
    };
    const holeAt = (e: Entry, pin: number) => (e.inHole[pin - 1] ? `${e.part.board}:${e.pins[pin - 1].hole}` : undefined);
    for (const e of entries) {
      const p = e.part;
      if (p.kind !== 'chip') continue;
      const def = CHIPS[p.chip];
      const legs = partNets.get(p.id)!;
      const firstHole = e.inHole.indexOf(true);
      const anyHole = firstHole >= 0 ? holeAt(e, firstHole + 1) : undefined;
      const model = this.models[p.chip];
      if (!model) {
        problems.push({ kind: 'unknown-chip', part: p.id, message: `${p.id}: no simulation model for the ${p.chip} yet`, at: anyHole });
        continue;
      }
      const badPin = [...model.inputs, ...model.outputs].find((n) => !Number.isInteger(n) || n < 1 || n > legs.length);
      if (badPin !== undefined) {
        problems.push({ kind: 'unknown-chip', part: p.id, message: `${p.id}: the ${p.chip} model uses pin ${badPin}, which the package does not have`, at: anyHole });
        continue;
      }
      const vccNet = legs[def.vcc - 1], gndNet = legs[def.gnd - 1];
      if (shorted || vccNet !== vcc || gndNet !== gnd) {
        const pin = vccNet !== vcc ? def.vcc : def.gnd;
        const what = shorted
          ? 'the supply is shorted'
          : !e.inHole[pin - 1]
            ? `pin ${pin} (${pin === def.vcc ? 'VCC' : 'GND'}) is not in a hole`
            : vccNet !== vcc
              ? `pin ${def.vcc} (VCC) is not on +5 V`
              : `pin ${def.gnd} (GND) is not on ground`;
        problems.push({ kind: 'unpowered', part: p.id, message: `${p.id} (${p.chip}) is not powered: ${what}`, at: holeAt(e, pin) ?? anyHole });
        continue;
      }
      const params: ChipParams = { ...(p.params as ChipParams | undefined), ...this.paramOverrides.get(p.id) };
      activate(`chip:${p.id}`, p.id, model, params, model.inputs.map((n) => legs[n - 1]), model.outputs.map((n) => legs[n - 1]), model.raw);
    }

    const drivable = new Set<Net>(ext.keys());
    for (const a of built) for (const n of a.outputs) drivable.add(n);

    // ---- RC differentiators
    const rcOutputs: Net[] = [];
    for (const { part: p } of entries) {
      if (p.kind !== 'capacitor') continue;
      const legs = partNets.get(p.id)!;
      if (!attached(legs)) continue;
      const [na, nb] = legs;
      if (na === nb) continue;
      for (const [src, dst, dir] of [[na, nb, 'ab'], [nb, na, 'ba']] as const) {
        if (supplyLevel(src) !== null || !drivable.has(src) || drivable.has(dst)) continue;
        const pull = dst.pull;
        if (pull !== 0 && pull !== 1) continue;
        activate(`rc:${p.id}:${dir}`, p.id, this.rc[pull], {}, [src], [dst]);
        rcOutputs.push(dst);
        break;
      }
    }
    for (const n of rcOutputs) drivable.add(n);

    // ---- series resistors into nets that nothing drives: they follow the far side
    const hasLevel = (n: Net) => drivable.has(n) || n.pull === 0 || n.pull === 1;
    const linkSrc = new Map<Net, Net>();
    for (const [dst, sides] of series) {
      if (drivable.has(dst)) continue;
      const sources = [...sides].filter(([src]) => hasLevel(src));
      if (sources.length !== 1) continue; // nothing to follow, or a divider between two levels
      const [src, { ohms, id }] = sources[0];
      // a net with a pull of its own follows only a driver through a smaller resistance
      if (dst.pull !== 'Z' && !(drivable.has(src) && ohms < (pullOhms.get(dst) ?? Infinity))) continue;
      activate(`link:${id}:${dst.name}`, id, LINK_MODEL, {}, [src], [dst], true);
      linkSrc.set(dst, src);
    }
    for (const n of linkSrc.keys()) drivable.add(n);

    // ---- LEDs that are in the wrong way round
    const tied = (n: Net, level: 0 | 1) => supplyLevel(n) === level || (!drivable.has(n) && n.pull === level);
    const canBe = (n: Net, level: 0 | 1) => drivable.has(n) || n.pull === level || (links.get(n)?.length ?? 0) > 0;
    for (const { part: p } of entries) {
      if (p.kind !== 'led') continue;
      const legs = partNets.get(p.id)!;
      if (!attached(legs)) continue;
      const [an, ca] = legs;
      if (an === ca) continue;
      const reason = tied(an, 0) && canBe(ca, 1) ? 'its anode is on ground' : tied(ca, 1) && canBe(an, 0) ? 'its cathode is on +5 V' : null;
      if (reason) problems.push({ kind: 'reversed-led', part: p.id, message: `${p.id} is in backwards: ${reason}, so it can never light (turn it around)`, at: `${p.board}:${p.anode}` });
    }

    for (const key of [...this.actives.keys()]) if (!used.has(key)) this.actives.delete(key);

    // ---- levels: who drives what, before the components exist
    const outSlots = new Map<Net, [Active, number][]>();
    for (const a of built) a.outputs.forEach((n, i) => {
      const l = outSlots.get(n) ?? [];
      l.push([a, i]);
      outSlots.set(n, l);
    });
    const levelOf = (n: Net): Level => {
      const vals: Level[] = [];
      const e = ext.get(n);
      if (e) vals.push(this.extLevel(e));
      for (const [a, i] of outSlots.get(n) ?? []) vals.push(a.out[i]);
      return resolve(vals, n.pull);
    };

    if (fresh.length) this.relax(fresh, T, levelOf);
    for (const n of c.nets) n.value = levelOf(n);

    // ---- components (their first evaluation replays scheduled events and reacts to changed inputs)
    this.adding = true;
    try {
      for (const a of built) {
        a.comp = c.add({ kind: a.model.id, name: a.partId, inputs: a.inputs, outputs: a.outputs, delay: a.delay, evaluate: (ins, ctx) => this.evaluate(a, ins, ctx) });
      }
    } finally {
      this.adding = false;
    }
    for (const a of built) {
      a.comp!.drivers.forEach((d, i) => {
        d.value = a.out[i];
        d.pending = a.pending[i];
      });
    }
    for (const n of c.nets) n.value = resolve(n.drivers.map((d) => d.value), n.pull);

    return { nl, circuit: c, shorted, nets, vcc, gnd, ext, portNet, links, linkSrc, drivable, holeOf, partNets, actives: built, staticProblems: problems };
  }

  /**
   * Power-up in zero time: evaluate freshly powered chips and apply one
   * output change at a time until nothing changes (or the budget runs out,
   * e.g. a ring oscillator, which then keeps oscillating in real time).
   * Scheduled outputs (555s) are kept and replayed when the circuit starts.
   */
  private relax(fresh: Active[], T: number, levelOf: (n: Net) => Level) {
    const readers = new Map<Net, Active[]>();
    for (const a of fresh) for (const n of a.inputs) {
      const l = readers.get(n) ?? [];
      if (!l.includes(a)) l.push(a);
      readers.set(n, l);
    }
    const queue = [...fresh];
    const queued = new Set(fresh);
    const enqueue = (a: Active) => {
      if (queued.has(a)) return;
      queued.add(a);
      queue.push(a);
    };
    let budget = RELAX_MIN + RELAX_PER_OUTPUT * fresh.reduce((s, a) => s + a.outputs.length, 0);
    while (queue.length && budget-- > 0) {
      const a = queue.shift()!;
      queued.delete(a);
      const inputs = a.inputs.map((n) => (a.raw ? levelOf(n) : readLevel(levelOf(n))));
      const outs =
        a.prev && sameLevels(a.prev, inputs)
          ? a.lastOuts
          : this.invoke(a, inputs, T, (i, level, delay) => {
              if (!Number.isInteger(i) || i < 0 || i >= a.outputs.length) return;
              a.pending[i] = level;
              a.events.push({ at: T + Math.max(1, Math.round(delay ?? a.delay)), i, level });
            });
      if (!outs) continue;
      for (let i = 0; i < a.outputs.length; i++) {
        const l = outs[i];
        if (l === undefined || l === a.out[i]) continue;
        const n = a.outputs[i];
        const before = levelOf(n);
        a.out[i] = l;
        a.pending[i] = l;
        if (levelOf(n) !== before) for (const r of readers.get(n) ?? []) enqueue(r);
        enqueue(a); // its other outputs next time round
        break;
      }
    }
  }

  // ---- internals: running ------------------------------------------------------

  private evaluate(a: Active, circuitInputs: Level[], ctx: EvalContext): void {
    if (this.adding) {
      // first evaluation in a fresh circuit: put back what was in flight
      const evs = a.events;
      a.events = [];
      for (const e of evs) if (e.at > ctx.time) this.push(a, ctx, e.i, e.level, e.at - ctx.time, false);
    }
    const inputs = a.raw ? a.inputs.map((n) => n.value) : circuitInputs;
    // Nothing the chip can see has changed (e.g. a floating net became 1): it
    // keeps its last answer; only outputs that never got it (power-up
    // relaxation that ran out of budget) are scheduled.
    const outs = a.prev && sameLevels(a.prev, inputs) ? a.lastOuts : this.invoke(a, inputs, ctx.time, (i, level, delay) => this.push(a, ctx, i, level, delay ?? a.delay, true));
    if (!outs) return;
    for (let i = 0; i < a.outputs.length; i++) {
      const l = outs[i];
      if (l === undefined || l === a.pending[i]) continue;
      this.push(a, ctx, i, l, a.delay, true);
    }
  }

  private invoke(a: Active, inputs: Level[], time: number, schedule: EvalContext['schedule']): readonly (Level | undefined)[] | undefined {
    const ctx: EvalContext = { time, prevInputs: a.prev ?? inputs, state: a.state, schedule };
    const outs = a.model.evaluate(inputs, ctx, a.params);
    a.prev = inputs;
    a.lastOuts = outs ?? undefined;
    return outs ?? undefined;
  }

  /** Schedule output `i` of `a` and remember it, so a rebuild can replay it. */
  private push(a: Active, ctx: EvalContext, i: number, level: Level, delay: number, setPending: boolean) {
    if (!Number.isInteger(i) || i < 0 || i >= a.outputs.length) return;
    const d = Math.max(1, Math.round(delay));
    ctx.schedule(i, level, d);
    if (setPending) a.pending[i] = level;
    a.events.push({ at: ctx.time + d, i, level });
    if (a.events.length > 48) a.events = a.events.filter((e) => e.at > ctx.time);
  }

  /**
   * Level an LED or segment sees on a net: the level of the net it follows
   * through a series resistor (no delay), its own level, or, if it floats,
   * the level on the far side of a resistor.
   */
  private seen(n: Net): Level {
    const src = this.b.linkSrc.get(n);
    if (src) return src.value !== 'Z' ? src.value : n.pull;
    const v = n.value;
    if (v !== 'Z') return v;
    let got: Level = 'Z';
    for (const m of this.b.links.get(n) ?? []) {
      const l = m.value;
      if (!known(l)) continue;
      if (got === 'Z') got = l;
      else if (got !== l) return 'X';
    }
    return got;
  }
}
