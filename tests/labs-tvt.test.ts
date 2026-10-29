import { describe, expect, it } from 'vitest';
import { DOT_HZ, charTime, frameCount, hz, period, scanLine, timingBoard, type TestPoint, type TimingBoard, type VJumper } from '../src/labs/tvt/_timing';
import { HOLD, TV_H, TV_W, TvScan } from '../src/labs/tvt/_tv';
import { FONT_2513_CHART, code2513 } from '../src/breadboard/sim/font2513';
import type { Level } from '../src/logic/circuit';
import { VIDEO_VOLTS, charGen, type CharGen } from '../src/labs/tvt/_chargen';
import { SAMPLE_TEXT } from '../src/labs/tvt/tvt-chargen.lab';

/** Dots until `cond` holds after a dot (at most `max`). */
function until(b: TimingBoard, cond: () => boolean, max = 200_000) {
  for (let k = 0; k < max; k++) {
    b.dot();
    if (cond()) return k + 1;
  }
  throw new Error('never');
}

/** Each line of a frame, from the first text line: [scan line, LINE 1 TRANSFER, 9-12 BLANK, ~VS, IC6]. */
function frameLines(b: TimingBoard) {
  // to the start of a frame: S falls (IC6 back to 0) as J falls
  let s = b.tp.S.value;
  until(b, () => {
    const fell = s === 1 && b.tp.S.value === 0;
    s = b.tp.S.value;
    return fell;
  });
  const now = (): [number, number, number, number, number] => [scanLine(b), b.line1.value as number, b.blank.value as number, b.vs.value as number, frameCount(b)];
  const lines = [now()];
  let j = b.tp.J.value;
  s = b.tp.S.value;
  for (;;) {
    b.dot();
    if (s === 1 && b.tp.S.value === 0) break;
    s = b.tp.S.value;
    if (j === 1 && b.tp.J.value === 0) lines.push(now());
    j = b.tp.J.value;
  }
  return lines;
}

describe('TV Typewriter: the timing board (Figs. 6 and 7)', () => {
  it("divides the dot clock as Lancaster's waveform page has it", () => {
    const b = timingBoard({ t: 'Q' });
    const want: Partial<Record<TestPoint, number>> = { B: 2, C: 6, D: 6, E: 12, F: 24, G: 48, H: 96, I: 288, J: 288, K: 576, L: 1152, M: 3456, N: 3456, O: 6912 };
    for (const [p, dots] of Object.entries(want)) expect(period(b, b.tp[p as TestPoint]).dots, p).toBe(dots);
    expect(DOT_HZ / 6).toBe(760_320);
    expect(DOT_HZ / 288).toBe(15_840);
  });
  it('as drawn T never fires: IC6 counts all 12, 288 lines a frame, 55 Hz', () => {
    const b = timingBoard();
    const f = period(b, b.tp.S, b.tp.J);
    expect(f).toEqual({ dots: 82_944, counted: 288 });
    expect(DOT_HZ / f.dots).toBeCloseTo(55, 5);
    expect(b.tFired).toBe(0);
  });
  it('with Q in place of R, T resets IC6 at 11: 264 lines, 60 Hz, even moved while it runs', () => {
    const b = timingBoard();
    period(b, b.tp.S);
    b.setJumper('t', 'Q');
    period(b, b.tp.S); // the frame it was moved in
    const f = period(b, b.tp.S, b.tp.J);
    expect(f).toEqual({ dots: 76_032, counted: 264 });
    expect(DOT_HZ / f.dots).toBe(60);
    const fired = b.tFired;
    for (let k = 0; k < f.dots; k++) b.dot();
    expect(b.tFired - fired, 'once a frame').toBe(1);
  });
  it('a frame of 22 rows of 12 lines: 16 text rows, 9-12 BLANK on lines 9-12 of each and all through IC6 counts 8-10', () => {
    const lines = frameLines(timingBoard({ t: 'Q' }));
    expect(lines.length).toBe(264);
    lines.forEach(([scan, line1, blank, , ic6], n) => {
      expect(scan, `line ${n}`).toBe(n % 12);
      expect(ic6, `line ${n}`).toBe(Math.floor(n / 24));
      expect(line1, `line ${n}: LINE 1 TRANSFER low on the first line of each row`).toBe(scan === 0 ? 0 : 1);
      expect(blank, `line ${n}`).toBe(scan >= 8 || n >= 192 ? 1 : 0);
    });
  });
  it('vertical sync: 12 lines, in IC6 count 9, 10 or 8 by the jumper', () => {
    const at: Record<VJumper, number> = { P: 9, Q: 10, NOR: 8 };
    for (const v of ['P', 'Q', 'NOR'] as VJumper[]) {
      const lines = frameLines(timingBoard({ t: 'Q', v }));
      const vs = lines.flatMap(([, , , l], n) => (l === 0 ? [n] : []));
      expect(vs.length, v).toBe(12);
      expect(vs[0], v).toBe(at[v] * 24 + 12);
      expect(vs[11] - vs[0]).toBe(11);
    }
  });
  it('a line: 48 character times; LINE CLOCK low in each of the first 32; HS 4 character times in the other 16', () => {
    const b = timingBoard({ t: 'Q' });
    let j = b.tp.J.value;
    until(b, () => {
      const fell = j === 1 && b.tp.J.value === 0;
      j = b.tp.J.value;
      return fell;
    });
    const chars: number[] = [], clockLow: number[] = [], hs: number[] = [];
    for (let k = 0; k < 288; k++) {
      chars.push(charTime(b));
      if (b.lineClock.value === 0) clockLow.push(charTime(b));
      if (b.hs.value === 0) hs.push(k);
      b.dot();
    }
    expect([...new Set(chars)]).toEqual(Array.from({ length: 48 }, (_, k) => k));
    expect(new Set(clockLow).size, 'LINE CLOCK low in 32 character times').toBe(32);
    expect(Math.max(...clockLow)).toBe(31);
    expect(clockLow.length, '4 dots of each').toBe(32 * 4);
    expect(hs.length, 'HS: 24 dots, 5.3 µs').toBe(24);
    expect(hs[23] - hs[0]).toBe(23);
    expect(Math.min(...hs.map((k) => chars[k]))).toBeGreaterThanOrEqual(32);
  });
  it('the sync jumpers move HS 8 and 4 character times', () => {
    const start = (h: 'H' | '~H', g: 'G' | '~G') => {
      const b = timingBoard({ t: 'Q', h, g });
      until(b, () => b.hs.value === 0);
      until(b, () => b.hs.value === 1);
      until(b, () => b.hs.value === 0);
      return charTime(b);
    };
    const starts = [start('H', 'G'), start('H', '~G'), start('~H', 'G'), start('~H', '~G')];
    expect(new Set(starts).size).toBe(4);
    expect(starts.every((c) => c >= 32 && c <= 44)).toBe(true);
    expect(Math.abs(starts[0] - starts[1])).toBe(4);
    expect(Math.abs(starts[0] - starts[2])).toBe(8);
  });
  it('formats frequencies to 5 figures', () => {
    expect(hz(DOT_HZ)).toBe('4.5619 MHz');
    expect(hz(15_840)).toBe('15.84 kHz');
    expect(hz(60)).toBe('60 Hz');
    expect(hz(0)).toBe('—');
  });
});

/** A made-up TVT-like signal: `lines` lines of 288 dots, HS at character 36 for 24 dots, VS for 12 lines. */
function feed(scan: TvScan, lines: number, frames: number) {
  const dt = 1 / DOT_HZ;
  for (let f = 0; f < frames; f++)
    for (let l = 0; l < lines; l++)
      for (let d = 0; d < 288; d++) {
        const vs = l >= 228 && l < 240, hs = d >= 216 && d < 240;
        scan.feed(!vs && l % 12 < 8 && d < 192, vs || hs, dt);
      }
}

describe('TV Typewriter: the TV', () => {
  it('holds 60 Hz still with the vertical hold where a set leaves it', () => {
    const scan = new TvScan();
    feed(scan, 264, 4);
    expect(scan.locked).toBe(true);
    expect(scan.count.freeFields).toBeLessThanOrEqual(1);
    expect(scan.count.lines).toBeGreaterThan(4 * 264 - 4 * 15);
    expect(scan.pixels.some((p) => p === 255)).toBe(true);
    expect(scan.pixels.length).toBe(TV_W * TV_H);
  });
  it('rolls at 55 Hz until the hold is turned below it', () => {
    const scan = new TvScan();
    feed(scan, 288, 4);
    expect(scan.locked).toBe(false);
    expect(HOLD.normal).toBeGreaterThan(55);
    scan.hold = 54;
    feed(scan, 288, 30); // it pulls in as the pulses come a little sooner each field
    expect(scan.locked).toBe(true);
  });
  it('rolls at 60 Hz with the hold above 60', () => {
    const scan = new TvScan();
    scan.hold = 62;
    feed(scan, 264, 4);
    expect(scan.locked).toBe(false);
  });
  it("locks to the board's own sync once T resets IC6 at 11, and not as drawn", () => {
    for (const t of ['Q', 'R'] as const) {
      const b = timingBoard({ t });
      const scan = new TvScan();
      for (let k = 0; k < 4 * 82_944; k++) {
        b.dot();
        scan.feed(b.lineClock.value === 0 && b.blank.value === 0, b.sync.value === 1, 1 / DOT_HZ);
      }
      expect(scan.locked, t).toBe(t === 'Q');
    }
  });
});

/** From a frame's start (S falls), one frame of VIDEO OUT, a line a string from the dot J falls in: '#' white, '.' black, '_' sync. */
function frameArt(g: CharGen): string[] {
  const b = g.board;
  let s = b.tp.S.value;
  until(b, () => {
    const fell = s === 1 && b.tp.S.value === 0;
    s = b.tp.S.value;
    return fell;
  });
  const lines: string[] = [];
  let cur = '', j: Level = 0;
  const art = { white: '#', black: '.', sync: '_' } as const;
  for (;;) {
    j = b.tp.J.value;
    s = b.tp.S.value;
    if (lines.length || cur) cur += art[g.video()];
    else cur = art[g.video()];
    b.dot();
    if (s === 1 && b.tp.S.value === 0) break;
    if (j === 1 && b.tp.J.value === 0) {
      lines.push(cur);
      cur = '';
    }
  }
  lines.push(cur);
  return lines;
}

/** A row of dots as '#' and '.', O5 first. */
const glyphRow = (code: number, r: number) => FONT_2513_CHART[(code >> 3) * 8 + r].split(' ')[code & 7];

/** Where a column's five dots are in frameArt's lines: after the gap dot of character time col + 1. */
const COL0 = 9;

describe('TV Typewriter: the character generator (page A, Fig. 5)', () => {
  it('draws the memory: each column in the next character time, a gap dot and five dots, rows 1-7 of the 2513 on lines 2-8 of each row', () => {
    const g = charGen();
    g.setText(SAMPLE_TEXT);
    const art = frameArt(g);
    expect(art.length).toBe(288);
    const text = g.text();
    for (let r = 0; r < 16; r++)
      for (let l = 0; l < 12; l++) {
        const want = Array.from({ length: 32 }, (_, col) => '.' + (l >= 1 && l <= 7 ? glyphRow(code2513(text[r][col])!, l) : '.....')).join('');
        expect(art[12 * r + l].slice(COL0 - 1, COL0 - 1 + 192), `row ${r + 1}, line ${l + 1}`).toBe(want);
      }
    for (let line = 192; line < 288; line++) expect(art[line].replace(/_/g, ''), `line ${line}`).toMatch(/^\.*$/);
  });
  it('reads the memory 512 times a frame, on stack 16, and the 74165 loads 32 times a line', () => {
    const g = charGen();
    frameArt(g);
    const reads = g.reads, loads = g.loads;
    for (let k = 0; k < 82_944; k++) g.board.dot();
    expect(g.reads - reads).toBe(512);
    expect(g.loads - loads).toBe(288 * 32);
  });
  it('stack 15 and 16 go low for a dot each, 15 first, 32 pairs on line 1 of each text row', () => {
    const g = charGen(), b = g.board;
    frameArt(g);
    const lows: string[] = [];
    let lines = 0, j = b.tp.J.value;
    for (let k = 0; k < 82_944; k++) {
      b.dot();
      if (j === 1 && b.tp.J.value === 0) lines++;
      j = b.tp.J.value;
      if (b.stack15.value === 0) lows.push(`15@${lines}`);
      if (b.stack16.value === 0) lows.push(`16@${lines}`);
    }
    expect(lows.length).toBe(1024);
    for (let k = 0; k < 1024; k += 2) {
      expect(lows[k].startsWith('15@')).toBe(true);
      expect(lows[k + 1]).toBe(`16@${lows[k].slice(3)}`);
    }
    expect(new Set(lows.map((x) => x.slice(3)))).toEqual(new Set(Array.from({ length: 16 }, (_, r) => String(12 * r))));
  });
  it('OUTPUT LOAD falls once a character time while LINE CLOCK runs, a character time after it', () => {
    const g = charGen(), b = g.board;
    frameArt(g);
    let falls = 0, firstAt = -1, was = b.outputLoad.value, j = b.tp.J.value, dot = 0;
    until(b, () => {
      const fell = j === 1 && b.tp.J.value === 0;
      j = b.tp.J.value;
      return fell;
    });
    for (; dot < 288; dot++) {
      b.dot();
      if (was === 1 && b.outputLoad.value === 0 && falls++ === 0) firstAt = charTime(b);
      was = b.outputLoad.value;
    }
    expect(falls).toBe(32);
    expect(firstAt).toBe(1);
  });
  it('a row full to its 32nd place leaves its last character’s row 3 just left of the next row’s top line', () => {
    const g = charGen();
    g.setText(`${'A ROW FULL TO ITS END'.padEnd(31)}?\nNEXT`);
    const art = frameArt(g);
    const left = glyphRow(code2513('?')!, 3);
    expect(left).toContain('#');
    expect(art[12].slice(1, 6), 'line 1 of row 2: the leftover').toBe(left);
    expect(art[12].slice(6), 'and nothing else').not.toContain('#');
    g.setText('NOT FULL\nNEXT');
    expect(frameArt(g)[12]).not.toContain('#');
  });
  it('SELF TEST makes a white raster, FLASH blanks the characters, and CURSOR high makes every place a block', () => {
    const g = charGen();
    g.setText(SAMPLE_TEXT);
    g.setSelfTest(true);
    let art = frameArt(g);
    expect(art.every((l) => /^[#_]+$/.test(l))).toBe(true);
    g.setSelfTest(false);
    g.setFlash(true);
    art = frameArt(g);
    expect(art.some((l) => l.includes('#'))).toBe(false);
    g.setFlash(false);
    g.setCursor(true);
    art = frameArt(g);
    const block = '.#####'.repeat(32);
    for (let r = 0; r < 16; r++) for (let l = 0; l < 12; l++) expect(art[12 * r + l].slice(COL0 - 1, COL0 - 1 + 192), `row ${r + 1}, line ${l + 1}`).toBe(l < 8 ? block : '.'.repeat(192));
  });
  it('VIDEO OUT: 0 V in sync, about 2 V black, 5 V white', () => {
    expect(VIDEO_VOLTS.sync).toBe(0);
    expect(VIDEO_VOLTS.black).toBeCloseTo(2.06, 2);
    expect(VIDEO_VOLTS.white).toBe(5);
  });
  it('the TV holds the picture with the hold below 55 Hz, as the lab starts', () => {
    const g = charGen();
    g.setText(SAMPLE_TEXT);
    const scan = new TvScan();
    scan.hold = 54;
    for (let k = 0; k < 3 * 82_944; k++) {
      g.board.dot();
      const v = g.video();
      scan.feed(v === 'white', v === 'sync', 1 / DOT_HZ);
    }
    expect(scan.locked).toBe(true);
    expect(scan.pixels.some((p) => p === 255)).toBe(true);
  });
  it('the memory takes text a line a row, capitals for small letters and spaces for the rest', () => {
    const g = charGen();
    g.setText('hello {world}\n' + 'X'.repeat(40));
    expect(g.text()[0]).toBe('HELLO  WORLD '.padEnd(32));
    expect(g.text()[1]).toBe('X'.repeat(32));
    expect(g.text()[2]).toBe(' '.repeat(32));
  });
});
