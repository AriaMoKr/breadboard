import { describe, expect, it } from 'vitest';
import { DOT_HZ, charTime, frameCount, period, scanLine, timingBoard, type TestPoint, type TimingBoard, type VJumper } from '../src/labs/tvt/_timing';
import { HOLD, TV_H, TV_W, TvScan } from '../src/labs/tvt/_tv';
import { hz } from '../src/labs/tvt/tvt-timing.lab';

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
