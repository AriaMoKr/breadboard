import { and, not, or, xor, type Bit, type Circuit, type Component, type EvalContext, type Level, type Net } from '../../logic/circuit';
import { HEX_DIGITS, displayEepromImage } from '../../sim/display';
import { MICROCODE_VERSIONS, buildMicrocode, buildMicrocodeVersion, microcodeEepromImage, type MicrocodeVersionId } from '../../sim/microcode';
import { CHIPS, pinNumber } from '../catalog';
import type { ChipModel, ChipParams } from './types';

/**
 * Logic-level behaviour of every chip in src/breadboard/catalog.ts, after the
 * TI / Fairchild / Atmel datasheets Ben links on eater.net.
 *
 * Conventions
 * - Inputs arrive as resolved net levels. A floating ('Z') input reads 1, like
 *   an LS-TTL input.
 * - Unknown ('X') inputs are handled exactly: a chip is evaluated for every
 *   0/1 combination of the unknown inputs it actually looks at (and of
 *   unknown stored bits it reads), and an output or stored bit that differs
 *   between those "worlds" becomes 'X'. So an unknown clock edge makes a
 *   flip-flop unknown only if D differs from Q, a decoder with an unknown
 *   address bit still drives the outputs it can rule out, and a RAM write to
 *   an unknown address leaves only the candidate words uncertain.
 * - Registers, flip-flops and RAM power up at 0 (a real chip powers up at
 *   random; a known state keeps the simulation deterministic and matches the
 *   control-signal simulator in src/sim). EEPROMs power up with their image.
 * - 3-state outputs return 'Z'. Bidirectional pins (74LS245 A/B, 28C16 IO)
 *   are listed both as inputs and as outputs.
 * - Delays are in gate delays: gates 1, flip-flops / decoders / muxes /
 *   transceivers / 283 / 273 2, 161 / 173 / 189 3, 28C16 5 (an EEPROM is much
 *   slower than TTL; 5 keeps the full computer fast), 555 1.
 */

// ---------------------------------------------------------------------------
// Level helpers

/** LS-TTL reading of a level: floating reads 1. */
const ttl = (l: Level | undefined): Bit | 'X' => (l === 'Z' || l === undefined ? 1 : l);

/** Little-endian number from levels, or null if any is not 0/1. */
export function levelsToNumber(levels: readonly Level[]): number | null {
  let v = 0;
  for (let k = 0; k < levels.length; k++) {
    const l = levels[k];
    if (l !== 0 && l !== 1) return null;
    v |= l << k;
  }
  return v;
}

/** `n` little-endian bits of `v`. */
export const numberToBits = (v: number, n: number): Bit[] => Array.from({ length: n }, (_, k) => ((v >> k) & 1) as Bit);

const Z4: Level[] = ['Z', 'Z', 'Z', 'Z'];
const Z8: Level[] = ['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'];
const merge = (a: Level, b: Level): Level => (a === b ? a : 'X');

// ---------------------------------------------------------------------------
// Possible-worlds evaluation of MSI chips

/** What a chip's bit-level logic sees: inputs, clock edges and stored bits, always 0/1. */
export interface UnitPins {
  /** Input k of the unit. */
  i(k: number): Bit;
  /** Input k went 0 -> 1 since the previous evaluation. */
  rose(k: number): boolean;
  /** Input k went 1 -> 0 since the previous evaluation. */
  fell(k: number): boolean;
  /** Stored bit k, as it was before this evaluation. */
  s(k: number): Bit;
  /** Store bit k. */
  w(k: number, v: Level): void;
}

/** Per-instance memory of a unit (flip-flop bits, RAM words, EEPROM bytes). */
export interface BitStore {
  get(k: number): Level;
  set(k: number, v: Level): void;
}

class ArrayStore implements BitStore {
  readonly bits: Level[];
  constructor(n: number) {
    this.bits = new Array<Level>(n).fill(0);
  }
  get(k: number): Level {
    return this.bits[k] ?? 0;
  }
  set(k: number, v: Level) {
    this.bits[k] = v === 'Z' ? 'X' : v;
  }
}

/** Byte memory (28C16): bit k is bit (k & 7) of byte (k >> 3). Unknown bits are tracked separately. */
class ByteStore implements BitStore {
  readonly unknown: Uint8Array;
  constructor(readonly bytes: Uint8Array) {
    this.unknown = new Uint8Array(bytes.length);
  }
  get(k: number): Level {
    const byte = k >> 3, m = 1 << (k & 7);
    if (this.unknown[byte] & m) return 'X';
    return this.bytes[byte] & m ? 1 : 0;
  }
  set(k: number, v: Level) {
    const byte = k >> 3, m = 1 << (k & 7);
    if (v === 0 || v === 1) {
      this.unknown[byte] &= ~m;
      if (v) this.bytes[byte] |= m; else this.bytes[byte] &= ~m;
    } else this.unknown[byte] |= m;
  }
}

/** More worlds than this (more than 12 unknowns read at once) gives up: all outputs and touched bits become X. */
const MAX_WORLDS = 4096;

/**
 * Run `fn` once per 0/1 assignment of the unknown inputs / edges / stored bits
 * it reads (a decision tree, so unread unknowns cost nothing) and merge the
 * results. With no unknowns this is a single call.
 */
function explore(cur: readonly Level[], prev: readonly Level[], store: BitStore, fn: (u: UnitPins) => Level[]): { out: Level[]; writes: Map<number, Level> } {
  const n = cur.length;
  const keys: number[] = [];
  const vals: Bit[] = [];
  const pick = (key: number): Bit => {
    for (let j = 0; j < keys.length; j++) if (keys[j] === key) return vals[j];
    keys.push(key);
    vals.push(0);
    return 0;
  };
  let leaf = new Map<number, Level>();
  const edge = (k: number): number => {
    const c = u.i(k);
    const pl = ttl(prev[k]);
    // Unknown before and after: the net did not change as far as we know.
    const p: Bit = pl !== 'X' ? pl : ttl(cur[k]) === 'X' ? c : pick(n + k);
    return c - p;
  };
  const u: UnitPins = {
    i: (k) => {
      const l = ttl(cur[k]);
      return l === 'X' ? pick(k) : l;
    },
    rose: (k) => edge(k) > 0,
    fell: (k) => edge(k) < 0,
    s: (k) => {
      const l = store.get(k);
      return l === 0 || l === 1 ? l : pick(2 * n + k);
    },
    w: (k, v) => {
      leaf.set(k, v);
    },
  };

  let out: Level[] | null = null;
  const writes = new Map<number, Level>();
  for (let worlds = 1; ; worlds++) {
    leaf = new Map();
    const o = fn(u);
    if (!out) out = o.slice();
    else for (let j = 0; j < o.length; j++) out[j] = merge(out[j], o[j]);
    for (const [k, v] of leaf) {
      const had = writes.get(k);
      writes.set(k, had !== undefined ? merge(had, v) : worlds === 1 ? v : merge(v, store.get(k)));
    }
    if (worlds > 1) for (const [k, v] of writes) if (!leaf.has(k)) writes.set(k, merge(v, store.get(k)));
    // next world: flip the deepest 0 choice
    while (vals.length && vals[vals.length - 1] === 1) {
      vals.pop();
      keys.pop();
    }
    if (!vals.length) break;
    vals[vals.length - 1] = 1;
    if (worlds >= MAX_WORLDS) {
      out = out.map(() => 'X');
      for (const k of writes.keys()) writes.set(k, 'X');
      break;
    }
  }
  return { out: out!, writes };
}

/** One independent section of a chip (a gate, a flip-flop, a register). Pins by catalog name. */
interface UnitDef {
  ins: string[];
  outs: string[];
  /** Stored bits, powering up as 0. */
  bits?: number;
  /** Custom memory instead of `bits`. */
  store?: (params: ChipParams) => BitStore;
  fn(u: UnitPins): Level[];
}

/** A chip model built from units evaluated with `explore`. */
function unitChip(id: string, delay: number, units: UnitDef[]): ChipModel {
  const chip = CHIPS[id];
  if (!chip) throw new Error(`unknown chip ${id}`);
  const inputs: number[] = [];
  const outputs: number[] = [];
  const unitIns = units.map((u) =>
    u.ins.map((name) => {
      const p = pinNumber(chip, name);
      let k = inputs.indexOf(p);
      if (k < 0) k = inputs.push(p) - 1;
      return k;
    }),
  );
  const unitOuts = units.map((u) => u.outs.map((name) => outputs.push(pinNumber(chip, name)) - 1));
  return {
    id,
    inputs,
    outputs,
    delay,
    evaluate(levels, ctx, params) {
      const stores = (ctx.state.units ??= units.map((u) => (u.store ? u.store(params) : new ArrayStore(u.bits ?? 0)))) as BitStore[];
      const out = new Array<Level>(outputs.length);
      for (let ui = 0; ui < units.length; ui++) {
        const idx = unitIns[ui];
        const cur = idx.map((k) => levels[k]);
        const prev = idx.map((k) => ctx.prevInputs[k] ?? levels[k]);
        const r = explore(cur, prev, stores[ui], units[ui].fn);
        for (const [k, v] of r.writes) stores[ui].set(k, v);
        unitOuts[ui].forEach((o, j) => (out[o] = r.out[j]));
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Gates (direct three-valued logic)

type Fn2 = (a: Level, b: Level) => Level;

function gates2(id: string, f: Fn2, names: [string, string, string][]): ChipModel {
  const chip = CHIPS[id];
  const groups = names.map((g) => g.map((nm) => pinNumber(chip, nm)));
  return {
    id,
    inputs: groups.flatMap(([a, b]) => [a, b]),
    outputs: groups.map(([, , y]) => y),
    delay: 1,
    evaluate: (l) => groups.map((_, i) => f(ttl(l[2 * i]), ttl(l[2 * i + 1]))),
  };
}

const QUAD = [1, 2, 3, 4].map((k): [string, string, string] => [`${k}A`, `${k}B`, `${k}Y`]);

// ---------------------------------------------------------------------------
// Flip-flops

/** Store bit 0 and return `out`. */
function store1(u: UnitPins, v: Bit, out: Level[]): Level[] {
  u.w(0, v);
  return out;
}

/** 74LS74 half: positive-edge D flip-flop, async ~PRE / ~CLR (both low: Q = ~Q = 1). */
const dff74 = (k: number): UnitDef => ({
  ins: [`~${k}CLR`, `${k}D`, `${k}CLK`, `~${k}PRE`],
  outs: [`${k}Q`, `~${k}Q`],
  bits: 1,
  fn(u) {
    const clr = u.i(0), pre = u.i(3);
    if (!pre && !clr) {
      u.w(0, 'X'); // the datasheet's "nonstable" state once both are released together
      return [1, 1];
    }
    if (!pre) return store1(u, 1, [1, 0]);
    if (!clr) return store1(u, 0, [0, 1]);
    if (u.rose(2)) {
      const d = u.i(1);
      u.w(0, d);
      return [d, (1 - d) as Bit];
    }
    const q = u.s(0);
    return [q, (1 - q) as Bit];
  },
});

/** Negative-edge JK flip-flop (74LS76 / 74LS107 halves). `pre` absent on the 107. */
function jkUnit(clk: string, pre: string | null, clr: string, j: string, k: string, q: string, nq: string): UnitDef {
  const ins = pre ? [clk, clr, j, k, pre] : [clk, clr, j, k];
  return {
    ins,
    outs: [q, nq],
    bits: 1,
    fn(u) {
      const c = u.i(1);
      const p = pre ? u.i(4) : 1;
      if (!p && !c) {
        u.w(0, 'X');
        return [1, 1];
      }
      if (!p) return store1(u, 1, [1, 0]);
      if (!c) return store1(u, 0, [0, 1]);
      let v: Bit;
      if (u.fell(0)) {
        const jj = u.i(2), kk = u.i(3);
        v = jj && kk ? ((1 - u.s(0)) as Bit) : jj ? 1 : kk ? 0 : u.s(0);
        u.w(0, v);
      } else v = u.s(0);
      return [v, (1 - v) as Bit];
    },
  };
}

// ---------------------------------------------------------------------------
// 28C16 images

const eepromCache = new Map<string, Uint8Array>();

/**
 * Contents of a 28C16 (2048 bytes) for `params.image`:
 * - "microcode": Ben's final microcode (flags + conditional jumps), as
 *   microcode-eeprom-with-flags.ino burns it into both control EEPROMs.
 *   "microcode:<version>" picks an earlier version (src/sim/microcode.ts).
 * - "display": the multiplexed decimal display image (multiplexed-display.ino).
 * - "hex": Ben's common-anode hex digits (eeprom-programmer.ino) at 0x00-0x0F,
 *   the rest erased (0xFF).
 * - "blank" (default): erased, all 0xFF.
 * - bytes: copied from address 0, the rest 0xFF.
 */
export function eepromImage(image: ChipParams['image'] = 'blank'): Uint8Array {
  if (typeof image !== 'string') {
    const img = new Uint8Array(2048).fill(0xff);
    for (let a = 0; a < Math.min(2048, image.length); a++) img[a] = image[a] & 0xff;
    return img;
  }
  let img = eepromCache.get(image);
  if (!img) {
    if (image === 'microcode') img = microcodeEepromImage(buildMicrocode());
    else if (image.startsWith('microcode:') && image.slice(10) in MICROCODE_VERSIONS)
      img = microcodeEepromImage(buildMicrocodeVersion(image.slice(10) as MicrocodeVersionId));
    else if (image === 'display') img = displayEepromImage();
    else if (image === 'hex') {
      img = new Uint8Array(2048).fill(0xff);
      HEX_DIGITS.forEach((seg, d) => (img![d] = ~seg & 0xff));
    } else if (image === 'blank') img = new Uint8Array(2048).fill(0xff);
    else throw new Error(`28C16: unknown image "${image}" (microcode, microcode:<version>, display, hex, blank or bytes)`);
    eepromCache.set(image, img);
  }
  return img.slice();
}

const A28 = Array.from({ length: 11 }, (_, k) => `A${k}`);
const IO8 = Array.from({ length: 8 }, (_, k) => `IO${k}`);

// ---------------------------------------------------------------------------
// NE555 (digital approximation)

/** Future events this chip has scheduled on one output, so a new plan can override them. */
interface Timeline {
  cur: Level;
  ev: [number, Level][];
}

/**
 * Make output `idx` follow `events` ([delay, level], relative to now) from now
 * on, replacing whatever was scheduled before (the circuit applies events of
 * one time step in order, so a later event at the same time wins).
 */
function plan(ctx: EvalContext, tl: Timeline, idx: number, events: [number, Level][]) {
  const now = ctx.time;
  const future: [number, Level][] = [];
  for (const e of tl.ev) {
    if (e[0] <= now) tl.cur = e[1];
    else future.push(e);
  }
  const abs = events.map(([d, l]): [number, Level] => [now + Math.max(1, Math.round(d)), l]).sort((a, b) => a[0] - b[0]);
  const at = (t: number) => {
    let l = tl.cur;
    for (const [tt, ll] of abs) if (tt <= t) l = ll;
    return l;
  };
  const old = new Map(future);
  const times = [...new Set([...future.map((e) => e[0]), ...abs.map((e) => e[0])])].sort((a, b) => a - b);
  tl.ev = times.map((t): [number, Level] => {
    const l = at(t);
    if (old.get(t) !== l || abs.some((e) => e[0] === t)) ctx.schedule(idx, l, t - now);
    return [t, l];
  });
}

interface Timer555 {
  out: Timeline;
  dis: Timeline;
  /** astable */
  running: boolean;
  lastT: number;
  lastL: Bit;
  /** monostable */
  firing: boolean;
  timerEnd: number;
  endAt: number | null;
  /** bistable */
  q: Level;
}

const disFor = (l: Level): Level => (l === 1 ? 'Z' : l === 0 ? 0 : 'X');
const posInt = (v: unknown, dflt: number) => (typeof v === 'number' && v >= 1 ? Math.round(v) : dflt);

function drive555(ctx: EvalContext, st: Timer555, events: [number, Level][]) {
  plan(ctx, st.out, 0, events);
  plan(ctx, st.dis, 1, events.map(([d, l]): [number, Level] => [d, disFor(l)]));
}

const ne555Pins = (name: string) => pinNumber(CHIPS.NE555, name);

/**
 * NE555 timer. Modes (params.mode):
 * - "astable" (default): free-running, OUT high for params.highTime and low
 *   for params.lowTime gate delays (both default to params.halfPeriod, default
 *   32). Starts high, like a 555 whose capacitor starts empty. TRIG is
 *   ignored. The engine may change these params at run time (Ben's speed
 *   pot); the next half period uses the new value.
 * - "monostable": TRIG low starts a params.pulseWidth (default 64) high pulse.
 *   Not retriggerable; if TRIG is still low when the time is up, OUT stays
 *   high until TRIG is released (TRIG beats THR in the datasheet table).
 * - "bistable": TRIG low sets OUT, ~RESET low resets it (reset wins).
 * THR and CV are never read: the RC network is not simulated, timing comes
 * from the params instead.
 * In every mode ~RESET low forces OUT low. DIS is the open-collector
 * discharge transistor: 0 while OUT is low, released (Z) while OUT is high.
 * OUT is also read as an input: its own transitions wake the model up to
 * schedule the next one.
 */
const NE555: ChipModel = {
  id: 'NE555',
  inputs: [ne555Pins('TRIG'), ne555Pins('~RESET'), ne555Pins('OUT')],
  outputs: [ne555Pins('OUT'), ne555Pins('DIS')],
  delay: 1,
  evaluate(levels, ctx, params) {
    const trig = ttl(levels[0]), reset = ttl(levels[1]);
    const st = (ctx.state.t555 ??= {
      out: { cur: 'X', ev: [] }, dis: { cur: 'X', ev: [] },
      running: false, lastT: 0, lastL: 0, firing: false, timerEnd: 0, endAt: null, q: 0,
    } satisfies Timer555) as Timer555;
    const now = ctx.time;
    const mode = params.mode ?? 'astable';

    if (reset !== 1) {
      st.running = false;
      st.firing = false;
      st.endAt = null;
      // an unknown ~RESET leaves a bistable that is reset (and not being set) at 0
      st.q = reset === 0 || (st.q === 0 && trig === 1) ? 0 : 'X';
      drive555(ctx, st, [[1, reset === 0 ? 0 : mode === 'bistable' ? st.q : 'X']]);
      return;
    }

    if (mode === 'monostable') {
      if (st.firing && st.endAt !== null && now >= st.endAt) {
        st.firing = false;
        st.endAt = null;
      }
      const width = posInt(params.pulseWidth, 64);
      if (trig === 0) {
        if (!st.firing) {
          st.firing = true;
          st.timerEnd = now + 1 + width;
        }
        st.endAt = null;
        drive555(ctx, st, [[1, 1]]);
      } else if (trig === 1) {
        if (st.firing && now + 1 < st.timerEnd) {
          st.endAt = st.timerEnd;
          drive555(ctx, st, [[1, 1], [st.timerEnd - now, 0]]);
        } else {
          st.firing = false;
          st.endAt = null;
          drive555(ctx, st, [[1, 0]]);
        }
      } else drive555(ctx, st, [[1, 'X']]);
      return;
    }

    if (mode === 'bistable') {
      if (trig === 0) st.q = 1;
      else if (trig === 'X') st.q = st.q === 1 ? 1 : 'X';
      drive555(ctx, st, [[1, st.q]]);
      return;
    }

    // astable
    const high = posInt(params.highTime ?? params.halfPeriod, 32);
    const low = posInt(params.lowTime ?? params.halfPeriod, 32);
    if (!st.running) {
      st.running = true;
      st.lastT = now + 1 + high;
      st.lastL = 0;
      // two events ahead, so the chain starts even if OUT already sat high
      drive555(ctx, st, [[1, 1], [1 + high, 0]]);
    } else if (st.lastT <= now) {
      const t = Math.max(st.lastT + (st.lastL === 1 ? high : low), now + 1);
      st.lastL = st.lastL === 1 ? 0 : 1;
      st.lastT = t;
      drive555(ctx, st, [[t - now, st.lastL]]);
    }
  },
};

// ---------------------------------------------------------------------------
// The catalog

export const CHIP_MODELS: Record<string, ChipModel> = {
  '74LS00': gates2('74LS00', (a, b) => not(and([a, b])), QUAD),
  '74LS02': gates2('74LS02', (a, b) => not(or([a, b])), QUAD),
  '74LS04': {
    id: '74LS04',
    inputs: [1, 2, 3, 4, 5, 6].map((k) => pinNumber(CHIPS['74LS04'], `${k}A`)),
    outputs: [1, 2, 3, 4, 5, 6].map((k) => pinNumber(CHIPS['74LS04'], `${k}Y`)),
    delay: 1,
    evaluate: (l) => l.map((x) => not(ttl(x))),
  },
  '74LS08': gates2('74LS08', (a, b) => and([a, b]), QUAD),
  '74LS32': gates2('74LS32', (a, b) => or([a, b]), QUAD),
  '74LS86': gates2('74LS86', (a, b) => xor([a, b]), QUAD),

  '74LS74': unitChip('74LS74', 2, [dff74(1), dff74(2)]),
  '74LS76': unitChip('74LS76', 2, [1, 2].map((k) => jkUnit(`~${k}CLK`, `~${k}PRE`, `~${k}CLR`, `${k}J`, `${k}K`, `${k}Q`, `~${k}Q`))),
  '74LS107': unitChip('74LS107', 2, [1, 2].map((k) => jkUnit(`~${k}CLK`, null, `~${k}CLR`, `${k}J`, `${k}K`, `${k}Q`, `~${k}Q`))),

  /** 3-to-8 decoder: enabled when ~E1 = ~E2 = 0 and E3 = 1; the selected output goes low. */
  '74LS138': unitChip('74LS138', 2, [{
    ins: ['A0', 'A1', 'A2', '~E1', '~E2', 'E3'],
    outs: Array.from({ length: 8 }, (_, k) => `~Y${k}`),
    fn(u) {
      if (u.i(3) || u.i(4) || !u.i(5)) return [1, 1, 1, 1, 1, 1, 1, 1];
      const a = u.i(0) | (u.i(1) << 1) | (u.i(2) << 2);
      return Array.from({ length: 8 }, (_, k): Level => (k === a ? 0 : 1));
    },
  }]),

  /** Dual 2-to-4 decoder, active-low enables and outputs. */
  '74LS139': unitChip('74LS139', 2, [1, 2].map((h): UnitDef => ({
    ins: [`~${h}E`, `${h}A0`, `${h}A1`],
    outs: [0, 1, 2, 3].map((k) => `~${h}Y${k}`),
    fn(u) {
      if (u.i(0)) return [1, 1, 1, 1];
      const a = u.i(1) | (u.i(2) << 1);
      return [0, 1, 2, 3].map((k): Level => (k === a ? 0 : 1));
    },
  }))),

  /** Quad 2-to-1 mux: S low selects I0, S high I1; ~E high forces every output low. */
  '74LS157': unitChip('74LS157', 2, [1, 2, 3, 4].map((k): UnitDef => ({
    ins: ['S', '~E', `${k}I0`, `${k}I1`],
    outs: [`${k}Y`],
    fn: (u) => [u.i(1) ? 0 : u.i(0) ? u.i(3) : u.i(2)],
  }))),

  /**
   * Synchronous 4-bit counter. ~MR low clears at once. On a rising CP: ~PE low
   * loads P0-P3 (beats counting), else CEP = CET = 1 counts, else holds.
   * TC = CET and Q0..Q3 all 1.
   */
  '74LS161': unitChip('74LS161', 3, [{
    ins: ['~MR', 'CP', 'P0', 'P1', 'P2', 'P3', 'CEP', '~PE', 'CET'],
    outs: ['Q0', 'Q1', 'Q2', 'Q3', 'TC'],
    bits: 4,
    fn(u) {
      let q: Bit[] | null = null;
      if (!u.i(0)) q = [0, 0, 0, 0];
      else if (u.rose(1)) {
        if (!u.i(7)) q = [u.i(2), u.i(3), u.i(4), u.i(5)];
        else if (u.i(6) && u.i(8)) q = numberToBits((u.s(0) | (u.s(1) << 1) | (u.s(2) << 2) | (u.s(3) << 3)) + 1, 4);
      }
      if (q) q.forEach((b, k) => u.w(k, b));
      else q = [u.s(0), u.s(1), u.s(2), u.s(3)];
      const tc: Bit = q[0] && q[1] && q[2] && q[3] && u.i(8) ? 1 : 0;
      return [...q, tc];
    },
  }]),

  /**
   * 4-bit D register. MR high clears at once. A rising CP loads D0-D3 when
   * ~G1 = ~G2 = 0. Outputs are 3-state: released while ~M or ~N is high (the
   * register still loads).
   */
  '74LS173': unitChip('74LS173', 3, [{
    ins: ['MR', 'CP', '~G1', '~G2', 'D0', 'D1', 'D2', 'D3', '~M', '~N'],
    outs: ['Q0', 'Q1', 'Q2', 'Q3'],
    bits: 4,
    fn(u) {
      let q: Bit[] | null = null;
      if (u.i(0)) q = [0, 0, 0, 0];
      else if (u.rose(1) && !u.i(2) && !u.i(3)) q = [u.i(4), u.i(5), u.i(6), u.i(7)];
      if (q) q.forEach((b, k) => u.w(k, b));
      if (u.i(8) || u.i(9)) return Z4;
      return q ?? [u.s(0), u.s(1), u.s(2), u.s(3)];
    },
  }]),

  /**
   * 16 x 4 RAM. ~CS low and ~WE low writes D1-D4 into the addressed word
   * (level-sensitive, outputs released). ~CS low and ~WE high reads: ~O1-~O4
   * show the COMPLEMENT of the stored word. ~CS high: outputs released.
   * Word w bit b is stored bit 4w + b (bit 0 = D1).
   */
  '74LS189': unitChip('74LS189', 3, [{
    ins: ['A0', 'A1', 'A2', 'A3', '~CS', '~WE', 'D1', 'D2', 'D3', 'D4'],
    outs: ['~O1', '~O2', '~O3', '~O4'],
    bits: 64,
    fn(u) {
      if (u.i(4)) return Z4;
      const we = u.i(5);
      const w = 4 * (u.i(0) | (u.i(1) << 1) | (u.i(2) << 2) | (u.i(3) << 3));
      if (!we) {
        for (let b = 0; b < 4; b++) u.w(w + b, u.i(6 + b));
        return Z4;
      }
      return [0, 1, 2, 3].map((b): Level => (1 - u.s(w + b)) as Bit);
    },
  }]),

  /** Octal transceiver: ~OE high releases both sides; DIR high drives B from A, DIR low drives A from B. */
  '74LS245': unitChip('74LS245', 2, [1, 2, 3, 4, 5, 6, 7, 8].map((k): UnitDef => ({
    ins: ['~OE', 'DIR', `A${k}`, `B${k}`],
    outs: [`A${k}`, `B${k}`],
    fn: (u) => (u.i(0) ? ['Z', 'Z'] : u.i(1) ? ['Z', u.i(2)] : [u.i(3), 'Z']),
  }))),

  /** Octal D flip-flop: rising CP loads D0-D7, ~MR low clears at once. */
  '74LS273': unitChip('74LS273', 2, [0, 1, 2, 3, 4, 5, 6, 7].map((k): UnitDef => ({
    ins: ['~MR', 'CP', `D${k}`],
    outs: [`Q${k}`],
    bits: 1,
    fn(u) {
      if (!u.i(0)) return store1(u, 0, [0]);
      if (u.rose(1)) {
        const d = u.i(2);
        u.w(0, d);
        return [d];
      }
      return [u.s(0)];
    },
  }))),

  /** 4-bit full adder: S = A + B + C0 (A1/B1/S1 least significant), C4 carry out. */
  '74LS283': unitChip('74LS283', 2, [{
    ins: ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C0'],
    outs: ['S1', 'S2', 'S3', 'S4', 'C4'],
    fn(u) {
      const a = u.i(0) | (u.i(1) << 1) | (u.i(2) << 2) | (u.i(3) << 3);
      const b = u.i(4) | (u.i(5) << 1) | (u.i(6) << 2) | (u.i(7) << 3);
      return numberToBits(a + b + u.i(8), 5);
    },
  }]),

  /**
   * 2K x 8 EEPROM. Read (~CE = ~OE = 0, ~WE = 1): IO0-IO7 = image[A10..A0].
   * Write (~CE = 0, ~OE = 1, ~WE = 0): the byte on IO0-IO7 is stored at the
   * address, from the moment ~WE goes low until it goes high again (the last
   * value wins, as when the datasheet latches data on the rising ~WE edge).
   * Otherwise the IO pins are released. ~OE low inhibits writes.
   */
  '28C16': unitChip('28C16', 5, [{
    ins: [...A28, '~CE', '~OE', '~WE', ...IO8],
    outs: IO8,
    store: (params) => new ByteStore(eepromImage(params.image)),
    fn(u) {
      if (u.i(11)) return Z8;
      const we = u.i(13), oe = u.i(12);
      if (we && oe) return Z8;
      if (!we && !oe) return Z8;
      let a = 0;
      for (let k = 0; k < 11; k++) a |= u.i(k) << k;
      if (we) return [0, 1, 2, 3, 4, 5, 6, 7].map((b) => u.s(8 * a + b));
      for (let b = 0; b < 8; b++) u.w(8 * a + b, u.i(14 + b));
      return Z8;
    },
  }]),

  NE555,
};

// ---------------------------------------------------------------------------
// Memory access (for viewers and tests)

/**
 * Stored word of a 74LS189 (4 bits, true data, not the inverted outputs) or a
 * 28C16 (8 bits) instance, from its component state. Bit 0 first.
 */
export function peekMemory(state: Record<string, unknown>, address: number): Level[] | null {
  const store = (state.units as BitStore[] | undefined)?.[0];
  if (store instanceof ByteStore) return Array.from({ length: 8 }, (_, b) => store.get(8 * (address & 0x7ff) + b));
  if (store instanceof ArrayStore && store.bits.length === 64) return Array.from({ length: 4 }, (_, b) => store.get(4 * (address & 15) + b));
  return null;
}

/** Overwrite a stored word (e.g. to preload RAM). Takes effect on the chip's next evaluation. */
export function pokeMemory(state: Record<string, unknown>, address: number, value: number): boolean {
  const store = (state.units as BitStore[] | undefined)?.[0];
  if (store instanceof ByteStore) {
    for (let b = 0; b < 8; b++) store.set(8 * (address & 0x7ff) + b, ((value >> b) & 1) as Bit);
    return true;
  }
  if (store instanceof ArrayStore && store.bits.length === 64) {
    for (let b = 0; b < 4; b++) store.set(4 * (address & 15) + b, ((value >> b) & 1) as Bit);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wiring a model into a Circuit

/** Nets for a chip's pins, keyed by 1-based pin number or catalog pin name. */
export type PinNets = Record<number | string, Net | undefined> | Map<number | string, Net>;

/**
 * Wire a chip model into a Circuit as one component, exactly as the
 * breadboard engine does. Pins without a net get a private floating net
 * (an open input reads 1). `params.delay` overrides the model's delay.
 */
export function instantiateChip(circuit: Circuit, model: ChipModel, pinNets: PinNets, params: ChipParams = {}, name?: string): Component {
  const def = CHIPS[model.id];
  const get = (key: number | string) => (pinNets instanceof Map ? pinNets.get(key) : pinNets[key]);
  const spare = new Map<number, Net>();
  const netFor = (pin: number): Net => {
    const n = get(pin) ?? (def ? get(def.pins[pin - 1]) : undefined);
    if (n) return n;
    let s = spare.get(pin);
    if (!s) spare.set(pin, (s = circuit.net(`${name ?? model.id}.${pin}`, 'Z')));
    return s;
  };
  return circuit.add({
    kind: model.id,
    name,
    inputs: model.inputs.map(netFor),
    outputs: model.outputs.map(netFor),
    delay: typeof params.delay === 'number' ? params.delay : model.delay,
    evaluate: (levels, ctx) => model.evaluate(levels, ctx, params),
  });
}
