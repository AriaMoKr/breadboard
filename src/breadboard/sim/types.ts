import type { EvalContext, Level } from '../../logic/circuit';

/**
 * Chip-level simulation of breadboard layouts.
 *
 * - `CHIP_MODELS` (src/breadboard/sim/chips.ts) gives every catalog chip a
 *   logic-level behaviour.
 * - `BreadboardSim` (src/breadboard/sim/engine.ts) turns a `Layout` into a
 *   `Circuit` (src/logic/circuit.ts): breadboard strips, rails, wires,
 *   switches and same-named ports become nets, chips become components, and
 *   LEDs/7-segment displays are evaluated from net levels.
 */

export type ChipParams = Record<string, unknown> & {
  /** 28C16 contents: a preset name ("microcode", "display", "hex", "blank") or raw bytes. */
  image?: string | ArrayLike<number>;
  /** NE555: "astable" (default), "monostable" or "bistable". */
  mode?: string;
  /** NE555 astable: half period in gate delays (the engine's time unit). */
  halfPeriod?: number;
  /** NE555 monostable: pulse width in gate delays. */
  pulseWidth?: number;
};

/** Logic-level behaviour of one catalog chip. */
export interface ChipModel {
  /** Catalog id (src/breadboard/catalog.ts). */
  id: string;
  /** 1-based pins read as inputs, in the order `evaluate` receives them. Bidirectional pins appear in both lists. */
  inputs: number[];
  /** 1-based pins the chip can drive, in the order `evaluate` returns levels for them. Return 'Z' to release a pin (3-state). */
  outputs: number[];
  /** Propagation delay in gate delays (default 1). */
  delay?: number;
  /** Inputs arrive as raw net levels: a floating input is 'Z' (the model reads it as 1 itself). */
  raw?: boolean;
  /**
   * Compute output levels. Inputs are resolved net levels (a floating input
   * reads 1, like LS-TTL). Keep state in `ctx.state`, detect edges with
   * `ctx.prevInputs`; free-running chips (555) may schedule their own
   * future outputs with `ctx.schedule` and return void.
   */
  evaluate(inputs: Level[], ctx: EvalContext, params: ChipParams): Level[] | void;
}

export type SimProblemKind = 'unpowered' | 'short' | 'contention' | 'unknown-chip' | 'reversed-led' | 'floating-input';

export interface SimProblem {
  kind: SimProblemKind;
  message: string;
  part?: string;
  /** "board:hole" of a hole on the affected net, for highlighting. */
  at?: string;
}

/** What a simulator built from a layout must offer (implemented by BreadboardSim). */
export interface BoardSimulator {
  /** Net level at a hole ('Z' floating, 'X' contention). */
  level(board: string, hole: string): Level;
  /** Level of the net a named port is on. */
  portLevel(name: string): Level;
  /** Drive a named port from outside the layout (testing a module on its own); null releases it. */
  setPort(name: string, level: Level | null): void;
  press(partId: string): void;
  release(partId: string): void;
  setSlide(partId: string, pos: 0 | 1): void;
  setDip(partId: string, value: number): void;
  ledLit(partId: string): boolean;
  /** Lit segments of a 7-segment display (dp a b c d e f g byte). */
  seg7(partId: string): number;
  /** Advance `n` gate delays. */
  step(n?: number): void;
  /**
   * Advance to the next gate delay in which a net changes level, at most `max` gate delays: how
   * far it went and how many nets changed (0 when nothing was going to change).
   */
  stepToChange(max?: number): { steps: number; changed: number };
  /** Simulation time in gate delays. */
  readonly time: number;
  /** Run until nothing changes (or `max` gate delays). */
  settle(max?: number): { stable: boolean; steps: number };
  problems(): SimProblem[];
}
