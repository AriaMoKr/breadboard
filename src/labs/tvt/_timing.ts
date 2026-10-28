import { CHIP_MODELS, instantiateChip } from '../../breadboard/sim/chips';
import { Circuit, type Level, type Net } from '../../logic/circuit';

/**
 * The TV Typewriter's timing board (Radio-Electronics, September 1973, Figs. 6 and 7) as a
 * chip-level circuit, from the same chip models as the breadboard sandbox, wired pin for pin as
 * docs/research/tv-typewriter.md transcribes it. The lab drives the dot clock (test point A, IC1's
 * crystal oscillator) itself, a dot at a time. IC7 and IC8 are 7432s and IC12 a 7402: the 74LS32's
 * and 74LS02's models, which have their pins and logic. IC9, the latch that loads the output
 * register, belongs to the character generator and isn't here; nor are C7 and R4 on ~HS.
 */

/** Lancaster's test points, fastest first (U, the blinker, is IC1's second oscillator). */
export const TEST_POINTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'] as const;
export type TestPoint = (typeof TEST_POINTS)[number];

/** The dot clock: a 4.561920 MHz crystal. */
export const DOT_HZ = 4_561_920;

/** What IC10's T gate (pins 9-11) reads: the drawing's R, or Q, which ends IC6's count at 11. */
export type TGate = 'R' | 'Q';
/** IC11's horizontal sync jumpers (pins 10 and 11). */
export type HJumper = 'H' | '~H';
export type GJumper = 'G' | '~G';
/** IC11's vertical sync jumper (pin 5). */
export type VJumper = 'P' | 'Q' | 'NOR';

export interface Jumpers {
  t: TGate;
  h: HJumper;
  g: GJumper;
  v: VJumper;
}

/** As drawn, with the sync jumpers where they centre the picture on a TV (see _tv.ts). */
export const DEFAULT_JUMPERS: Jumpers = { t: 'R', h: '~H', g: 'G', v: 'P' };

export interface TimingBoard {
  c: Circuit;
  /** Test points A-T. */
  tp: Record<TestPoint, Net>;
  /** ~G (IC4 pin 12) and ~H (IC12 pin 10), for the sync jumpers. */
  notG: Net;
  notH: Net;
  /** Stack signals. */
  blank: Net;
  line1: Net;
  lineClock: Net;
  /** IC12 pin 13: high in the shown character times of line 1 of each row (this note's name). */
  x: Net;
  /** IC11: ~HS (pin 8), ~VS (pin 6) and SYNC (pin 12, stack 38), high in either sync pulse. */
  hs: Net;
  vs: Net;
  sync: Net;
  /** Every dot clock so far. */
  dots: number;
  /** How many times T has gone low: a pulse of a few gate delays, shorter than a dot. */
  readonly tFired: number;
  /** One dot: A high, then low (the 8288s count as it falls), settled after each. */
  dot(): void;
  readonly jumpers: Jumpers;
  /** Move a jumper while it runs. */
  setJumper<K extends keyof Jumpers>(k: K, v: Jumpers[K]): void;
}

/**
 * A jumper: a wire from one of `choices` to `out`. `poke`, toggled, makes it look again when the
 * choice changes.
 */
function jumper(c: Circuit, name: string, choices: Net[], out: Net, get: () => number) {
  const poke = c.input(`${name}.poke`, 0);
  c.add({ kind: 'JUMPER', name, inputs: [...choices, poke], outputs: [out], delay: 1, evaluate: (l) => [l[get()]] });
  return () => {
    c.toggle(poke);
    c.settle(10_000);
  };
}

export function timingBoard(start: Partial<Jumpers> = {}): TimingBoard {
  const jumpers: Jumpers = { ...DEFAULT_JUMPERS, ...start };
  const c = new Circuit();
  const vcc = c.input('+5V', 1), gnd = c.input('GND', 0);
  // INTERLACE RESET (stack 54): R1, 330 Ω, to +5 V, not grounded here
  const interlace = c.input('INTERLACE RESET', 1);
  const net = (name: string) => c.net(name, 'Z');
  const tp = Object.fromEntries(TEST_POINTS.map((p) => [p, p === 'A' ? c.input('A', 0) : net(p)])) as Record<TestPoint, Net>;
  const { A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T } = tp;
  const notG = net('~G'), notH = net('~H');
  const counter = (name: string, clk1: Net, clk2: Net, q: [Net, Net, Net, Net], reset: Net, strobe: Net) =>
    instantiateChip(c, CHIP_MODELS['8288'], { '~CLK1': clk1, '~CLK2': clk2, QA: q[0], QB: q[1], QC: q[2], QD: q[3], '~RESET': reset, '~STROBE': strobe, A: vcc, B: vcc, C: vcc, D: vcc }, {}, name);

  // ---- Fig. 6, the main chain
  counter('IC2', C, A, [E, B, C, D], vcc, vcc); // A ÷2 = B, ÷3 = C, D (the character rate); C ÷2 = E
  counter('IC3', E, G, [F, H, I, J], vcc, vcc); // E ÷2 = F; G ÷2 = H, ÷3 = I, J (HORIZ OUT, the line rate)
  // IC4 7473: the first half toggles (J1 open, K1 and ~CLR1 high); the second has J2 and K2 open
  // and ~CLR2 on INTERLACE RESET; G is ~Q1 (pin 13), ~G is Q1 (pin 12), K is ~Q2 (pin 8)
  instantiateChip(c, CHIP_MODELS['7473'], { '1CLK': F, '1K': vcc, '~1CLR': vcc, '~1Q': G, '1Q': notG, '2CLK': J, '~2CLR': interlace, '~2Q': K }, {}, 'IC4');
  counter('IC5', N, K, [O, L, M, N], vcc, interlace); // K ÷2 = L (L2), ÷3 = M (L4), N; N ÷2 = O
  counter('IC6', O, P, [P, Q, R, S], T, interlace); // O ÷12, or ÷11 if T fires: P, Q, R, S (V OUT)

  // ---- Fig. 7, the derived timing
  const kl = net('K+L'), mn = net('M+N');
  instantiateChip(c, CHIP_MODELS['74LS32'], { '3A': K, '3B': L, '3Y': kl, '2A': M, '2B': N, '2Y': mn, '1A': kl, '1B': mn, '1Y': net('LINE 1 TRANSFER'), '4A': N, '4B': S, '4Y': net('9-12 BLANK') }, {}, 'IC7');
  const blank = c.nets.find((n) => n.name === '9-12 BLANK')!, line1 = c.nets.find((n) => n.name === 'LINE 1 TRANSFER')!;
  const lineClock = net('LINE CLOCK'), sj = net('S+J');
  instantiateChip(c, CHIP_MODELS['74LS32'], { '1A': J, '1B': D, '1Y': lineClock, '4A': S, '4B': J, '4Y': sj }, {}, 'IC8');
  const x = net('X'), norPQ = net('NOR(P,Q)');
  instantiateChip(c, CHIP_MODELS['74LS02'], { '4A': line1, '4B': sj, '4Y': x, '3A': H, '3B': gnd, '3Y': notH, '2A': P, '2B': Q, '2Y': norPQ }, {}, 'IC12');
  // IC10's gate 3: T = NAND(pin 11, P, S), pin 11 on R as drawn or on Q
  const t11 = net('IC10.11');
  const T_CHOICES: TGate[] = ['R', 'Q'];
  const pokeT = jumper(c, 'T jumper', [R, Q], t11, () => T_CHOICES.indexOf(jumpers.t));
  instantiateChip(c, CHIP_MODELS['7410'], { '3A': S, '3B': P, '3C': t11, '3Y': T }, {}, 'IC10');
  // IC11, sync: ~HS = NAND(J, H or ~H, G or ~G), ~VS = NAND(S, O, P, Q or NOR(P, Q)), SYNC = HS or VS
  const h10 = net('IC11.10'), g11 = net('IC11.11'), v5 = net('IC11.5');
  const H_CHOICES: HJumper[] = ['H', '~H'], G_CHOICES: GJumper[] = ['G', '~G'], V_CHOICES: VJumper[] = ['P', 'Q', 'NOR'];
  const pokeH = jumper(c, 'H jumper', [H, notH], h10, () => H_CHOICES.indexOf(jumpers.h));
  const pokeG = jumper(c, 'G jumper', [G, notG], g11, () => G_CHOICES.indexOf(jumpers.g));
  const pokeV = jumper(c, 'V jumper', [P, Q, norPQ], v5, () => V_CHOICES.indexOf(jumpers.v));
  const hs = net('~HS'), vs = net('~VS'), sync = net('SYNC');
  instantiateChip(c, CHIP_MODELS['7410'], { '3A': J, '3B': h10, '3C': g11, '3Y': hs, '2A': S, '2B': O, '2C': v5, '2Y': vs, '1A': vs, '1B': hs, '1C': vcc, '1Y': sync }, {}, 'IC11');
  // counts T's pulses as they happen
  let tFired = 0;
  c.add({ kind: 'PROBE', name: 'T probe', inputs: [T], outputs: [], evaluate: ([l], ctx) => void (ctx.prevInputs[0] === 1 && l === 0 && tFired++) });
  c.settle(10_000);
  // at power-up the counters' outputs float, reading high, until they drive them low: not a count
  tFired = 0;

  const pokes = { t: pokeT, h: pokeH, g: pokeG, v: pokeV };
  const board: TimingBoard = {
    c, tp, notG, notH, blank, line1, lineClock, x, hs, vs, sync,
    dots: 0,
    get tFired() {
      return tFired;
    },
    dot() {
      c.set(A, 1);
      c.settle(10_000);
      c.set(A, 0);
      c.settle(10_000);
      board.dots++;
    },
    jumpers,
    setJumper(k, v) {
      if (jumpers[k] === v) return;
      jumpers[k] = v;
      pokes[k]();
    },
  };
  return board;
}

/** A level as 0 or 1 (an unknown or floating one as 0). */
export const bit = (l: Level): 0 | 1 => (l === 1 ? 1 : 0);

/** IC6's count, P + 2Q + 4R + 8S. */
export const frameCount = (b: TimingBoard) => bit(b.tp.P.value) | (bit(b.tp.Q.value) << 1) | (bit(b.tp.R.value) << 2) | (bit(b.tp.S.value) << 3);

/** The scan line within a character row, L1 + 2·L2 + 4·L4 + 8·N (K, L, M, N): 0 to 11. */
export const scanLine = (b: TimingBoard) => bit(b.tp.K.value) | (bit(b.tp.L.value) << 1) | (bit(b.tp.M.value) << 2) | (bit(b.tp.N.value) << 3);

/** The character time within a line: 0 to 47, the first 32 shown (J low). */
export const charTime = (b: TimingBoard) => {
  const { E, F, G, H, I, J } = b.tp;
  // E and F count in binary, then G and H, then the ÷3 on I and J: 2 · 2 · 2 · 2 · 3 = 48
  const third = bit(I.value) ? 1 : bit(J.value) ? 2 : 0;
  return bit(E.value) | (bit(F.value) << 1) | (bit(G.value) << 2) | (bit(H.value) << 3) | (third << 4);
};

/**
 * Runs `b` from one rise of `edge` to the next (at most `max` dots): how many dots that took, and
 * how many times `count` rose in between.
 */
export function period(b: TimingBoard, edge: Net, count?: Net, max = 400_000): { dots: number; counted: number } {
  const rise = (n: Net, was: Level) => was !== 1 && n.value === 1;
  let seen = 0, dots = 0, counted = 0;
  while (dots < max) {
    const e = edge.value, k = count?.value;
    b.dot();
    if (seen) dots++;
    if (seen && count && rise(count, k!)) counted++;
    if (rise(edge, e) && ++seen === 2) break;
  }
  return { dots, counted };
}
