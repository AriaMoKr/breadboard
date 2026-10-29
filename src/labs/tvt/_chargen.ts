import { CHIP_MODELS, instantiateChip, levelsToNumber, peek2518 } from '../../breadboard/sim/chips';
import { char2513, code2513 } from '../../breadboard/sim/font2513';
import type { Bit, Component, Net } from '../../logic/circuit';
import { timingBoard, type Jumpers, type TimingBoard } from './_timing';

/**
 * Page A's character generator and video (Radio-Electronics, September 1973, Fig. 5) on the timing
 * board, chip by chip, as docs/research/tv-typewriter.md transcribes them:
 * - IC8, a 2518, is the line register: on line 1 of each character row (LINE 1 TRANSFER low) it
 *   takes the row's 32 characters from the memory, one each LINE CLOCK, and on the other 11 lines
 *   it recirculates them.
 * - IC9, a 2513, turns each character (A4-A9, from the 2518) and scan line (A1-A3 from L1, L2 and
 *   L4) into a row of five dots. Its row 0 is blank in every character, so line 1, on which the
 *   2518 still gives the old row (a character comes out 32 clocks after it goes in), shows nothing.
 * - IC10, a 74165, loads the dots as OUTPUT LOAD falls (through C13, a pulse of 4 gate delays) and
 *   shifts them out on the dot clock: a blank dot, then O5 to O1. 9-12 BLANK holds its clock.
 * - IC11, a 7401, makes VIDEO OUT: ground in a sync pulse, black (about 2 V, R51 against R36) or
 *   white (5 V) otherwise. FLASH and SELF TEST are switches here.
 *
 * The memory board (Fig. 4, six 2524s) is the next part. Until then a stand-in drives the bus,
 * B1-B6, as the memory would: the next of its 512 characters each time stack 16 goes low (φ1, the
 * 2524s' output clock), which happens 32 times on line 1 of each of the 16 text rows. It starts
 * from its first character as each frame begins (S falls), so its rows are the screen's.
 */

export type VideoLevel = 'sync' | 'black' | 'white';

/** VIDEO OUT's three levels in volts: R36 (470 Ω) and R51 (330 Ω) make black 5 × 330 / 800. */
export const VIDEO_VOLTS: Record<VideoLevel, number> = { sync: 0, black: (5 * 330) / 800, white: 5 };

/** How long C13 holds the 74165's SH/~LD low after OUTPUT LOAD falls, in gate delays (about 40 ns). */
export const LOAD_PULSE = 4;

export interface CharGen {
  board: TimingBoard;
  /** The stand-in memory: 512 six-bit codes, 32 a row, the first the top left. */
  readonly memory: Uint8Array;
  /** B1-B6 (stack 9-14), from the memory. */
  bus: Net[];
  /** IC8 2518's OUT1-OUT6, the 2513's A4-A9. */
  line: Net[];
  /** IC9 2513's O1-O5. */
  dots: Net[];
  /** IC10 74165's SH/~LD (pin 1), after C13, and QH (pin 9), the dots. */
  load: Net;
  qh: Net;
  /** CURSOR (28), the 2513's enable: low (R37 to -12 V) gives the characters, high a white cell. */
  cursor: Net;
  ic8: Component;
  ic9: Component;
  /** VIDEO OUT (20). */
  video(): VideoLevel;
  /** The 2518's 32 characters, the one on its outputs first. */
  lineRegister(): (number | null)[];
  /** The character on the 2513's A4-A9, and the row on A1-A3. */
  romCharacter(): number | null;
  romRow(): number | null;
  /** The 2513's five outputs, O5 (the leftmost dot) first, as 0/1 (an open output reads 1). */
  romDots(): Bit[];
  /** Characters the memory has given, and how many times the 74165 has loaded. */
  readonly reads: number;
  readonly loads: number;
  /** Ground SELF TEST (J2): a white raster. Ground FLASH (43): no characters. */
  setSelfTest(grounded: boolean): void;
  setFlash(grounded: boolean): void;
  setCursor(high: boolean): void;
  /** Fill the memory from text, a line a row (up to 16 of 32), in the 2513's 64 characters. */
  setText(text: string): void;
  /** The memory as 16 lines of 32 characters. */
  text(): string[];
}

export function charGen(start: Partial<Jumpers> = {}): CharGen {
  const board = timingBoard(start);
  const { c, tp, vcc, gnd } = board;
  const memory = new Uint8Array(512).fill(code2513(' ')!);
  const bus = [1, 2, 3, 4, 5, 6].map((k) => c.net(`B${k}`, 0));
  const line = [1, 2, 3, 4, 5, 6].map((k) => c.net(`IC8.OUT${k}`, 'Z'));
  const dots = [1, 2, 3, 4, 5].map((k) => c.net(`IC9.O${k}`, 'Z'));

  // the memory, for now: the next character each time stack 16 falls, from the first as S falls
  // and a frame begins (a memory written through the typewriter lines up with the screen like that)
  let at = 0, reads = 0, loads = 0;
  c.add({
    kind: 'MEMORY', name: 'the memory (a stand-in)', inputs: [board.stack16, tp.S], outputs: bus, delay: 2,
    evaluate([l, s], ctx) {
      if (ctx.prevInputs[1] === 1 && s === 0) at = 0;
      if (ctx.prevInputs[0] !== 1 || l !== 0) return;
      const v = memory[at];
      at = (at + 1) % 512;
      reads++;
      return bus.map((_, b) => ((v >> b) & 1) as Bit);
    },
  });

  // IC8 2518, the line register: REC on LINE 1 TRANSFER (17), clock on LINE CLOCK (18)
  const ic8 = instantiateChip(c, CHIP_MODELS['2518'], { REC: board.line1, CLK: board.lineClock, ...Object.fromEntries(bus.map((n, k) => [`IN${k + 1}`, n])), ...Object.fromEntries(line.map((n, k) => [`OUT${k + 1}`, n])) }, {}, 'IC8 (page A)');

  // IC9 2513: A1-A3 from L1, L2, L4 (K, L, M), A4-A9 from the 2518, ~CE from CURSOR (28)
  const cursor = c.input('CURSOR (28)', 0);
  const ic9 = instantiateChip(c, CHIP_MODELS['2513'], { A1: tp.K, A2: tp.L, A3: tp.M, '~CE': cursor, ...Object.fromEntries(line.map((n, k) => [`A${k + 4}`, n])), ...Object.fromEntries(dots.map((n, k) => [`O${k + 1}`, n])) }, {}, 'IC9 (page A)');

  // C13 with R38 and R39: SH/~LD rests high and dips as OUTPUT LOAD (45) falls
  const load = c.net('IC10.1', 1);
  c.add({
    kind: 'RC', name: 'C13, R38, R39', inputs: [board.outputLoad], outputs: [load], delay: 1,
    evaluate([l], ctx) {
      if (ctx.prevInputs[0] !== 1 || l !== 0) return;
      loads++;
      ctx.schedule(0, 0, 1);
      ctx.schedule(0, 1, 1 + LOAD_PULSE);
    },
  });

  // IC10 74165: C-G from O1-O5; A, B, H and the serial input grounded; clock on VIDEO CLOCK (47)
  // and its inhibit on 9-12 BLANK (21)
  const qh = c.net('IC10.QH', 'Z');
  instantiateChip(c, CHIP_MODELS['74165'], { 'SH/~LD': load, CLK: tp.A, 'CLK INH': board.blank, SER: gnd, A: gnd, B: gnd, H: gnd, C: dots[0], D: dots[1], E: dots[2], F: dots[3], G: dots[4], QH: qh }, {}, 'IC10 (page A)');

  // IC11 7401, open collector: gate 3 = NAND(QH, FLASH) with R43 up; gate 4 = NAND(gate 3, SELF
  // TEST) pulls VIDEO OUT down through R51; gate 1 = NAND(+5 V, SYNC IN (38)) pulls it to ground
  const flash = c.input('FLASH (43)', 1), selfTest = c.input('SELF TEST (19)', 1);
  const g3 = c.net('IC11.10', 'Z'), g4 = c.net('IC11.13', 'Z'), videoOut = c.net('VIDEO OUT', 'Z');
  g3.pull = 1;
  g4.pull = 1;
  videoOut.pull = 1;
  instantiateChip(c, CHIP_MODELS['7401'], { '3A': qh, '3B': flash, '3Y': g3, '4A': g3, '4B': selfTest, '4Y': g4, '1A': vcc, '1B': board.sync, '1Y': videoOut }, {}, 'IC11 (page A)');
  c.settle(10_000);

  const bits = (nets: Net[]) => levelsToNumber(nets.map((n) => n.value));
  return {
    board, memory, bus, line, dots, load, qh, cursor, ic8, ic9,
    video: () => (videoOut.value === 0 ? 'sync' : g4.value === 0 ? 'black' : 'white'),
    lineRegister: () => peek2518(ic8.state),
    romCharacter: () => bits(line),
    romRow: () => bits([tp.K, tp.L, tp.M]),
    romDots: () => [4, 3, 2, 1, 0].map((k) => (dots[k].value === 0 ? 0 : 1)),
    get reads() {
      return reads;
    },
    get loads() {
      return loads;
    },
    setSelfTest(grounded) {
      c.set(selfTest, grounded ? 0 : 1);
      c.settle(10_000);
    },
    setFlash(grounded) {
      c.set(flash, grounded ? 0 : 1);
      c.settle(10_000);
    },
    setCursor(high) {
      c.set(cursor, high ? 1 : 0);
      c.settle(10_000);
    },
    setText(text) {
      const lines = text.split('\n');
      for (let r = 0; r < 16; r++)
        for (let col = 0; col < 32; col++) memory[r * 32 + col] = code2513(lines[r]?.[col] ?? ' ') ?? code2513(' ')!;
    },
    text: () => Array.from({ length: 16 }, (_, r) => Array.from(memory.subarray(r * 32, r * 32 + 32), char2513).join('')),
  };
}
