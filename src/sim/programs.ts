import type { MicrocodeVersionId } from './microcode';

export interface ExampleProgram {
  id: string;
  title: string;
  /** 1-based playlist index of the video that shows (or motivates) it. */
  video: number;
  description: string;
  source: string;
  /** Oldest microcode version that can run it. */
  requires: MicrocodeVersionId;
  /** First values written to the output register, for tests and the UI. */
  expectedOutputs?: number[];
  /** Whether the program ends in HLT. */
  halts: boolean;
}

/**
 * Programs Ben runs in the playlist (listings from docs/research/computer-spec.md),
 * in the order they appear, then Ben's Fibonacci (from a video outside the
 * playlist, same instruction set) and two extras that are marked as such.
 */
export const PROGRAMS: ExampleProgram[] = [
  {
    id: 'add',
    title: '28 + 14',
    video: 38,
    description: 'The first program Ben runs once the control logic works: load 28, add 14, show 42, halt.',
    requires: 'control-logic',
    halts: true,
    expectedOutputs: [42],
    source: `; 28 + 14 = 42
      LDA 14    ; A <- RAM[14]
      ADD 15    ; A <- A + RAM[15]
      OUT       ; display A
      HLT
14:   28
15:   14
`,
  },
  {
    id: 'add-sub',
    title: '5 + 6 − 7',
    video: 40,
    description: 'Ben’s test after adding SUB with the Arduino-programmed microcode.',
    requires: 'arduino',
    halts: true,
    expectedOutputs: [4],
    source: `; 5 + 6 - 7 = 4
      LDA 15
      ADD 14
      SUB 13
      OUT
      HLT
13:   7
14:   6
15:   5
`,
  },
  {
    id: 'count-by-3',
    title: 'Multiples of 3',
    video: 41,
    description: 'The first program with LDI, STA and JMP: keep adding 3 forever (wraps around at 256).',
    requires: 'more-instructions',
    halts: false,
    expectedOutputs: [3, 6, 9, 12, 15],
    source: `; count by 3 forever
        LDI 3
        STA 15    ; RAM[15] <- 3
        LDI 0
loop:   ADD 15
        OUT
        JMP loop
`,
  },
  {
    id: 'count-by-10',
    title: 'Count by tens',
    video: 44,
    description: 'Ben’s quick test after re-burning the flag-aware EEPROMs: ADD sets the carry flag every time the count wraps past 255.',
    requires: 'more-instructions',
    halts: false,
    expectedOutputs: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 4, 14],
    source: `; count by 10 (watch the carry flag at the wrap)
top:    ADD 15
        OUT
        JMP top
15:     10
`,
  },
  {
    id: 'up-down',
    title: 'Count up & down',
    video: 44,
    description: 'The first JC/JZ program: count up until ADD overflows (carry), then down until SUB reaches zero, forever.',
    requires: 'flags',
    halts: false,
    expectedOutputs: [0, 1, 2, 3, 4],
    source: `; count up to 255, then down to 0, repeat
up:     OUT
        ADD 15
        JC  down
        JMP up
down:   SUB 15
        OUT
        JZ  up
        JMP down
15:     1
`,
  },
  {
    id: 'multiply',
    title: 'Multiply 3 × 5',
    video: 44,
    description: 'Ben’s multiplication by repeated addition. x − 1 sets carry unless x was 0, so JC loops x times. Ben also runs it with x = 7, y = 8 → 56; reset “product” to 0 before re-running.',
    requires: 'flags',
    halts: true,
    expectedOutputs: [15],
    source: `; product = x * y
top:    LDA x
        SUB one
        JC  cont      ; carry set unless x was 0
        LDA product
        OUT
        HLT
cont:   STA x         ; x = x - 1
        LDA product
        ADD y
        STA product   ; product += y
        JMP top

12: one:     1
13: product: 0
14: x:       3
15: y:       5
`,
  },
  {
    id: 'multiply-7x8',
    title: 'Multiply 7 × 8',
    video: 44,
    description: 'Ben’s second multiplication run: he resets the product to 0, sets x = 7 and y = 8, and the computer outputs 56. Afterwards x is 0 and the product stays in RAM[13].',
    requires: 'flags',
    halts: true,
    expectedOutputs: [56],
    source: `; product = x * y  (Ben's second run)
top:    LDA x
        SUB one
        JC  cont      ; carry set unless x was 0
        LDA product
        OUT
        HLT
cont:   STA x         ; x = x - 1
        LDA product
        ADD y
        STA product   ; product += y
        JMP top

12: one:     1
13: product: 0
14: x:       7
15: y:       8
`,
  },
  {
    id: 'fibonacci-ben',
    title: 'Fibonacci (Ben’s)',
    video: 44,
    description: 'Ben’s Fibonacci program (from his earlier stand-alone video, same instruction set). It restarts on overflow, so 233 is never shown, which Ben points out himself.',
    requires: 'flags',
    halts: false,
    expectedOutputs: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 0, 1],
    source: `; Fibonacci: x in A, y at 14, z at 15, x saved at 13
start:  LDI 1
        STA 14     ; y = 1
        LDI 0      ; x = 0
loop:   OUT
        ADD 14     ; z = x + y
        STA 15
        LDA 14
        STA 13     ; x = y
        LDA 15
        STA 14     ; y = z
        LDA 13     ; A = x
        JC  start  ; overflowed? start again
        JMP loop
`,
  },
  {
    id: 'countdown',
    title: 'Countdown from 15',
    video: 44,
    description: 'Not from the videos: counts down with SUB and halts when JZ sees the zero flag.',
    requires: 'flags',
    halts: true,
    expectedOutputs: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    source: `; count down from 15 to 0, then halt
        LDI 15
loop:   OUT
        SUB one
        JZ  done
        JMP loop
done:   OUT
        HLT
15: one: 1
`,
  },
  {
    id: 'fibonacci',
    title: 'Fibonacci up to 233',
    video: 44,
    description: 'Not from the videos: a variant that leap-frogs two variables, so it reaches 233 before the 8-bit sum overflows.',
    requires: 'flags',
    halts: false,
    expectedOutputs: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 1, 1],
    source: `; Fibonacci 1 1 2 3 5 ... 233, then start again
start:  LDI 0
        STA y
        LDI 1
loop:   STA x
        OUT
        ADD y
        JC  start
        STA y
        OUT
        ADD x
        JC  start
        JMP loop
14: x: 0
15: y: 0
`,
  },
];

export const PROGRAM_BY_ID = new Map(PROGRAMS.map((p) => [p.id, p]));
