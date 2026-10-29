import type { Level } from '../../logic/circuit';
import { Button, Led, LedBar, Scope, Slider, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { callout, injectStyle, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { DOT_HZ, TEST_POINTS, charTime, frameCount, hz, scanLine, timingBoard, type GJumper, type HJumper, type TGate, type TestPoint, type VJumper } from './_timing';
import { HOLD, TvScan, TvScreen } from './_tv';

type Probe = 'cells' | 'blank' | 'line1' | 'clock' | 'none';
type Speed = 'fast' | 'line' | 'char' | 'pause';

/** What each test point is, and the rate Lancaster's waveform page gives it (dots a cycle). */
const POINTS: Record<TestPoint, { from: string; dots?: number; what?: string }> = {
  A: { from: 'IC1, the crystal', dots: 1, what: 'the dot clock, VIDEO CLOCK (47)' },
  B: { from: 'IC2 ÷2 (QB)', dots: 2 },
  C: { from: 'IC2 ÷3 (QC)', dots: 6, what: 'the character rate' },
  D: { from: 'IC2 ÷3 (QD)', dots: 6 },
  E: { from: 'IC2 ÷2 (QA)', dots: 12, what: '24 a line' },
  F: { from: 'IC3 ÷2 (QA)', dots: 24 },
  G: { from: 'IC4 7473 (~Q1)', dots: 48 },
  H: { from: 'IC3 ÷2 (QB)', dots: 96 },
  I: { from: 'IC3 ÷3 (QC)', dots: 288 },
  J: { from: 'IC3 ÷3 (QD)', dots: 288, what: 'HORIZ OUT (53): the line rate' },
  K: { from: 'IC4 7473 (~Q2)', dots: 576, what: 'L1 (50)' },
  L: { from: 'IC5 ÷2 (QB)', dots: 1152, what: 'L2 (49)' },
  M: { from: 'IC5 ÷3 (QC)', dots: 3456, what: 'L4 (48)' },
  N: { from: 'IC5 ÷3 (QD)', dots: 3456, what: 'the character-row rate' },
  O: { from: 'IC5 ÷2 (QA)', dots: 6912 },
  P: { from: 'IC6 (QA)', what: 'CARRIAGE RETURN CLOCK (26)' },
  Q: { from: 'IC6 (QB)' },
  R: { from: 'IC6 (QC)' },
  S: { from: 'IC6 (QD)', what: 'V OUT (55): 60 Hz in Lancaster’s table' },
  T: { from: 'IC10 7410 (pin 8)', what: 'IC6’s reset' },
};

/** IC6's counts: which character rows each one covers (24 lines, 2 rows). */
const IC6_ROWS = ['text rows 1-2', 'rows 3-4', 'rows 5-6', 'rows 7-8', 'rows 9-10', 'rows 11-12', 'rows 13-14', 'rows 15-16', 'blank (S high)', 'blank', 'blank', 'blank: only if T never fires'];

const CSS = `
.tvt-lab .tvt-tv { background: #2a2622; border-radius: 22px; padding: 14px; max-width: 640px; box-sizing: border-box; forced-color-adjust: none; }
.tvt-lab .tvt-screen { display: block; width: 100%; aspect-ratio: 4 / 3; border-radius: 18px / 14px; background: #0e1210; }
.tvt-lab .tvt-points { border-collapse: collapse; font-size: 0.9em; }
.tvt-lab .tvt-points td, .tvt-lab .tvt-points th { padding: 2px 8px; text-align: left; vertical-align: middle; }
.tvt-lab .tvt-points td.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.tvt-lab .tvt-points .led { vertical-align: middle; }
.tvt-lab .led.tvt-flicker { opacity: 0.55; }
`;

export default defineLab({
  id: 'tvt-timing',
  title: 'The timing chain',
  summary:
    'Don Lancaster’s TV Typewriter puts 16 lines of 32 characters on a television, and its timing board keeps everything in step. A 4.561920 MHz crystal is the dot clock. Signetics 8288 divide-by-12 counters and a 7473 flip-flop divide it by 6 for each character, by 48 more for each line (15.840 kHz), by 12 for the lines of a character row and by 22 for a frame; a few gates make the TV’s sync pulses and the blanking. Here the board runs chip by chip, a dot at a time, many times slower than the real one, and a TV draws its picture as it goes. As drawn, one gate can never fire and the frames come 55 times a second, not 60: see what the TV makes of that, then move the gate’s wire.',
  mount(root) {
    const d = new Disposer();
    root.classList.add('tvt-lab');
    d.add(injectStyle(root, CSS));
    d.add(() => root.classList.remove('tvt-lab'));

    const board = timingBoard();
    const { tp } = board;
    const scan = new TvScan();
    const screen = new TvScreen(scan, 'The TV');
    let probe: Probe = 'cells', speed: Speed = 'fast';

    // ---- what the loop measures
    const lineLanes: [string, () => Level][] = [
      ...(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const).map((p): [string, () => Level] => [p, () => tp[p].value]),
      ['LINE CLOCK', () => board.lineClock.value],
      ['HS', () => (board.hs.value === 0 ? 1 : 0)],
    ];
    const frameLanes: [string, () => Level][] = [
      ...(['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'] as const).map((p): [string, () => Level] => [p, () => tp[p].value]),
      ['9-12 BLANK', () => board.blank.value],
      ['VS', () => (board.vs.value === 0 ? 1 : 0)],
    ];
    /** The scopes' samples in rings: the last 288 dots, and the last 288 lines. */
    const ring = (lanes: [string, () => Level][], n: number) => {
      const data: Level[][] = lanes.map(() => new Array<Level>(n).fill(0));
      let at = 0, filled = 0;
      return {
        push() {
          for (let i = 0; i < lanes.length; i++) data[i][at] = lanes[i][1]();
          at = (at + 1) % n;
          filled = Math.min(filled + 1, n);
        },
        /** Oldest first. */
        samples: () => data.map((d) => (filled < n ? d.slice(0, filled) : [...d.slice(at), ...d.slice(0, at)])),
      };
    };
    const lineRing = ring(lineLanes, 288), frameRing = ring(frameLanes, 288);
    const nets = TEST_POINTS.map((p) => tp[p]);
    const rises = nets.map(() => 0), was = nets.map((n) => n.value);
    /** Each test point's rises in the last whole frame, and that frame's dots, lines and top count of IC6. */
    let perFrame: number[] | null = null, frameStart = rises.slice();
    let frames = 0, frameDots = 0, lineInFrame = 0, maxCount = 0;
    let last = { dots: 0, lines: 0, maxCount: 0 };
    const hsAt = { start: -1, dots: 0, seen: 0, shown: { at: -1, dots: 0 } };
    /** Vertical sync pulses: the one going on, this frame's and the last whole frame's. */
    const vsAt = { start: -1, lines: 0, now: [] as { at: number; lines: number }[], shown: [] as { at: number; lines: number }[] };
    const sim = { from: 0, ms: 0, rate: 0 };
    const J_AT = TEST_POINTS.indexOf('J');

    const videoOf = (): boolean => {
      switch (probe) {
        case 'cells': return board.lineClock.value === 0 && board.blank.value === 0;
        case 'blank': return board.blank.value === 1;
        case 'line1': return board.line1.value === 0;
        case 'clock': return board.lineClock.value === 0;
        default: return false;
      }
    };

    const oneDot = () => {
      const jWas = tp.J.value, sWas = tp.S.value;
      board.dot();
      scan.feed(videoOf(), board.sync.value === 1, 1 / DOT_HZ);
      frameDots++;
      for (let i = 0; i < nets.length; i++) {
        const l = nets[i].value;
        if (l === 1 && was[i] !== 1) rises[i]++;
        was[i] = l;
      }
      lineRing.push();
      // HS: the character time it starts in, and how many dots it lasts (the first one may be cut short)
      if (board.hs.value === 0) {
        if (hsAt.start < 0) (hsAt.start = charTime(board)), (hsAt.dots = 0);
        hsAt.dots++;
      } else if (hsAt.start >= 0) {
        if (++hsAt.seen > 1) hsAt.shown = { at: hsAt.start, dots: hsAt.dots };
        hsAt.start = -1;
      }
      maxCount = Math.max(maxCount, frameCount(board));
      // a new frame as S falls: IC6 is back at 0, the first text row
      if (sWas === 1 && tp.S.value === 0) {
        if (vsAt.start >= 0) vsAt.now.push({ at: vsAt.start, lines: vsAt.lines });
        vsAt.start = -1;
        if (frames++) {
          last = { dots: frameDots, lines: lineInFrame, maxCount };
          perFrame = rises.map((n, i) => n - frameStart[i]);
          vsAt.shown = vsAt.now;
        }
        vsAt.now = [];
        frameStart = rises.slice();
        frameDots = lineInFrame = maxCount = 0;
      }
      // a new line as J falls: character time 0
      if (jWas === 1 && tp.J.value === 0) {
        lineInFrame++;
        frameRing.push();
        if (board.vs.value === 0) {
          if (vsAt.start < 0) (vsAt.start = lineInFrame), (vsAt.lines = 0);
          vsAt.lines++;
        } else if (vsAt.start >= 0) {
          vsAt.now.push({ at: vsAt.start, lines: vsAt.lines });
          vsAt.start = -1;
        }
      }
    };

    // ---- the TV
    const probeSel = select<Probe>(
      [
        { value: 'cells', label: 'Where the characters go (LINE CLOCK and 9-12 BLANK low)' },
        { value: 'blank', label: '9-12 BLANK (21)' },
        { value: 'line1', label: 'LINE 1 TRANSFER (17) low' },
        { value: 'clock', label: 'LINE CLOCK (18) low' },
        { value: 'none', label: 'Nothing: sync only' },
      ],
      probe,
      (v) => (probe = v),
      'Video in',
    );
    const speedSel = select<Speed>(
      [
        { value: 'fast', label: 'As fast as it goes' },
        { value: 'line', label: 'A line at a time (60 lines a second)' },
        { value: 'char', label: 'A character at a time (6 dots)' },
        { value: 'pause', label: 'Paused' },
      ],
      speed,
      (v) => (speed = v),
      'Speed',
    );
    const dotBtn = new Button({
      label: 'One dot',
      onPress: () => {
        speed = 'pause';
        speedSel.setValue('pause');
        oneDot();
      },
    });
    const hold = new Slider({ label: 'Vertical hold', min: HOLD.min, max: HOLD.max, value: HOLD.normal, step: 0.5, format: (v) => `${v.toFixed(1)} Hz`, onInput: (v) => (scan.hold = v) });
    const tvKv = readouts(['dot clock (A)', 'line rate (J)', 'frame rate (S)', 'lines a frame', 'the beam', 'the TV']);
    const tvText = callout();

    // ---- IC6 and T
    const tSel = select<TGate>([{ value: 'R', label: 'R, as drawn' }, { value: 'Q', label: 'Q' }], board.jumpers.t, (v) => board.setJumper('t', v), 'IC10 pin 11 to');
    const ic6Bar = new LedBar({ bits: 4, color: 'yellow', label: 'IC6: S R Q P', formats: ['dec'] });
    const tLed = new Led('red', 'T, IC6’s reset, low');
    const ic6Table = truthTable(['count', 'S', 'R', 'Q', 'P', 'lines'], IC6_ROWS.map((what, n) => [String(n), ...[3, 2, 1, 0].map((b) => String((n >> b) & 1)), what]));
    const ic6Kv = readouts(['IC6 counts', 'T has fired']);
    const ic6Text = callout();

    // ---- sync
    const hSel = select<HJumper>([{ value: 'H', label: 'H' }, { value: '~H', label: 'H̅ (IC12 pin 10)' }], board.jumpers.h, (v) => board.setJumper('h', v), 'IC11 pin 10 to');
    const gSel = select<GJumper>([{ value: 'G', label: 'G' }, { value: '~G', label: 'G̅ (IC4 pin 12)' }], board.jumpers.g, (v) => board.setJumper('g', v), 'IC11 pin 11 to');
    const vSel = select<VJumper>([{ value: 'P', label: 'P' }, { value: 'Q', label: 'Q' }, { value: 'NOR', label: 'NOR(P, Q) (IC12 pin 4)' }], board.jumpers.v, (v) => board.setJumper('v', v), 'IC11 pin 5 to');
    const syncKv = readouts(['horizontal sync', 'vertical sync']);

    // ---- the chain
    const leds = new Map<TestPoint, Led>();
    const measured = new Map<TestPoint, HTMLElement>();
    const pointRows = TEST_POINTS.map((p) => {
      const info = POINTS[p];
      const led = new Led(p === 'T' ? 'red' : 'green', `test point ${p}`);
      leds.set(p, led);
      const m = h('td', { class: 'num' }, '—');
      measured.set(p, m);
      return h('tr', null, h('td', null, led.el, ' ', h('b', null, p)), h('td', null, info.from, info.what ? h('span', { class: 'dim' }, ` · ${info.what}`) : null), h('td', { class: 'num' }, info.dots ? hz(DOT_HZ / info.dots) : p === 'S' ? '60 Hz' : '—'), m);
    });
    const pointsTable = h('div', { style: 'overflow-x:auto;max-width:100%' }, h('table', { class: 'tvt-points' }, h('thead', null, h('tr', null, h('th', null, 'point'), h('th', null, 'from'), h('th', null, 'Lancaster'), h('th', null, 'here'))), h('tbody', null, pointRows)));
    const lineScope = new Scope(lineLanes.map(([label]) => ({ label, color: label === 'HS' ? '#fbbf24' : '#4ade80' })), { width: 640, laneHeight: 26 });
    const frameScope = new Scope(frameLanes.map(([label]) => ({ label, color: label === 'VS' ? '#fbbf24' : label === 'S' ? '#f87171' : '#4ade80' })), { width: 640, laneHeight: 26 });

    let described = '';
    const lastRises = rises.slice();
    d.add(
      animate((dt) => {
        const t0 = performance.now();
        if (speed === 'fast') {
          do for (let k = 0; k < 256; k++) oneDot();
          while (performance.now() - t0 < 9);
        } else if (speed === 'line') for (let k = 0; k < 288; k++) oneDot();
        else if (speed === 'char') for (let k = 0; k < 6; k++) oneDot();
        sim.ms += Math.min(dt, 100);
        if (sim.ms >= 1000) {
          sim.rate = (board.dots - sim.from) / (sim.ms / 1000);
          sim.from = board.dots;
          sim.ms = 0;
        }
        screen.draw(speed !== 'fast');

        // the test points: lit, or flickering when they changed more than once this frame
        TEST_POINTS.forEach((p, i) => {
          const led = leds.get(p)!;
          const busy = rises[i] - lastRises[i] > 1;
          lastRises[i] = rises[i];
          led.set(busy || nets[i].value === 1);
          led.el.classList.toggle('tvt-flicker', busy);
          if (p !== 'T') setText(measured.get(p)!, perFrame && last.dots ? hz((perFrame[i] * DOT_HZ) / last.dots) : '—');
        });
        setText(measured.get('T')!, `${board.tFired} so far`);
        lineScope.draw(lineRing.samples(), { window: 288 });
        frameScope.draw(frameRing.samples(), { window: 288 });

        const f = last.dots ? DOT_HZ / last.dots : 0;
        tvKv.set('dot clock (A)', sim.rate ? `4.561920 MHz on the board; here ${hz(sim.rate)}, ${Math.round(DOT_HZ / sim.rate).toLocaleString('en-US')} times slower` : '4.561920 MHz on the board');
        tvKv.set('line rate (J)', hz(perFrame && last.dots ? (perFrame[J_AT] * DOT_HZ) / last.dots : 0));
        tvKv.set('frame rate (S)', f ? `${hz(f)}${Math.abs(f - 60) < 0.05 ? '' : ' (Lancaster: 60 Hz)'}` : 'measuring…');
        tvKv.set('lines a frame', last.lines ? `${last.lines} (${last.dots.toLocaleString('en-US')} dots)` : 'measuring…');
        tvKv.set('the beam', `line ${lineInFrame} of the frame, scan line ${scanLine(board) + 1} of its row, character time ${charTime(board) + 1} of 48`);
        const tvLocked = scan.locked;
        tvKv.set('the TV', !last.lines ? 'warming up…' : tvLocked ? 'holding the picture still' : 'rolling: its fields don’t start on the sync pulses');
        const fixed = board.jumpers.t === 'Q';
        setText(
          tvText,
          !last.lines
            ? 'The first frame is on its way. Each dot is the crystal’s clock going high and low, with every chip on the board then settling.'
            : tvLocked
              ? fixed
                ? `60 frames a second, as Lancaster’s table says: 264 lines, 22 character rows of 12. Sixteen rows hold text; in the other six, 9-12 BLANK holds the screen dark while the beam goes back to the top and the TV’s overscan hides the edge.${probe === 'cells' ? ' The blocks are the 32 × 16 places a character can go: the next part draws characters in them.' : ''}`
                : `Held still at ${hz(f)}, with the vertical hold turned down to ${scan.hold.toFixed(1)} Hz. A TV would do, but Lancaster’s building steps say to check that the chain ends at 60 Hz: move IC10’s pin 11 to Q, below, and turn the hold back up.`
              : f < scan.hold
                ? `The frames come ${hz(f)}, slower than the TV’s field oscillator runs on its own (the vertical hold, ${scan.hold.toFixed(1)} Hz). It starts each field before the sync pulse arrives, and the picture rolls. Turn the hold below ${hz(f)}${fixed ? '' : ', or end IC6’s count at 11'}.`
                : `The vertical hold (${scan.hold.toFixed(1)} Hz) is below the frame rate, so each sync pulse comes a little sooner in the TV’s field than the last: the picture rolls more and more slowly until a pulse comes in the second half of the field and fires the oscillator. From then on it holds.`,
        );
        const label = `The TV: ${probeSel.selectEl.selectedOptions?.[0]?.textContent ?? probe}, ${tvLocked ? 'holding still' : 'rolling'}`;
        if (label !== described) screen.describe((described = label));

        const count = frameCount(board);
        ic6Bar.set(count);
        ic6Table.set(count);
        tLed.set(false);
        ic6Kv.set('IC6 counts', last.maxCount ? `0 to ${last.maxCount}: ÷${last.maxCount + 1}, ${last.maxCount + 1} × 24 = ${(last.maxCount + 1) * 24} lines` : 'measuring…');
        ic6Kv.set('T has fired', `${board.tFired} times, each for a few gate delays`);
        setText(
          ic6Text,
          fixed
            ? 'T = NAND(Q, P, S) goes low the moment IC6 reaches 11 (binary 1011: P, Q and S high), and its reset clears IC6 straight back to 0, too quickly to see. So IC6 divides by 11 and the frame is 11 × 24 = 264 lines: 15,840 Hz ÷ 264 = 60 Hz.'
            : 'T = NAND(R, P, S) needs R and S high together, and in an 8288’s ÷3 they never are: R (QC) is high on its second count, S (QD) on its third. So T stays high, IC6 counts all 12, and the frame is 12 × 24 = 288 lines: 15,840 Hz ÷ 288 = 55 Hz. Ending the count at 11 (1011) needs P, Q and S, so the drawing’s R is most likely Q.',
        );
        syncKv.set('horizontal sync', hsAt.shown.at >= 0 ? `character times ${hsAt.shown.at + 1}-${hsAt.shown.at + hsAt.shown.dots / 6} of 48: ${hsAt.shown.dots} dots, ${((hsAt.shown.dots / DOT_HZ) * 1e6).toFixed(1)} µs` : 'measuring…');
        const vsList = vsAt.shown;
        syncKv.set(
          'vertical sync',
          vsList.length
            ? `lines ${vsList.map((v) => `${v.at}-${v.at + v.lines - 1}`).join(' and ')} of the frame: ${vsList[0].lines} lines${vsList.length > 1 ? ' each' : ''}, ${(((vsList[0].lines * 288) / DOT_HZ) * 1e3).toFixed(2)} ms${vsList.length > 1 ? `. Two a frame: count 11 has ${board.jumpers.v} and S high as well` : ''}`
            : 'measuring…',
        );
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'On the TV',
          { accent: 'blue', chips: 'the timing board, Figs. 6 and 7: IC1 MC4024 · IC2, IC3, IC5, IC6 8288 · IC4 7473 · IC7, IC8 7432 · IC9, IC12 7402 · IC10, IC11 7410' },
          screen.el,
          row(probeSel, speedSel, dotBtn.el),
          row(hold.el),
          tvKv.el,
          tvText,
          note('The timing board makes no picture by itself: the character generator, the next part, makes the video. Until then the TV’s video input takes one of the board’s own signals, as a scope would show it, to see where they land on the screen. The sync is the board’s own, IC11’s SYNC (38).'),
        ),
        panel(
          'IC6 and the gate that can’t fire',
          { accent: 'red', chips: 'IC6 8288: QA (P) to ~CLK2 · ~RESET (13) from T · IC10 7410: T (pin 8) = NAND(pins 9, 10, 11) = NAND(S, P, pin 11)' },
          row(tSel, tLed.el, ic6Bar.el),
          ic6Kv.el,
          ic6Text,
          ic6Table.el,
          note('Lancaster’s Fig. 6 has IC6 “cut to ÷11”, with S, its last output, at 60 Hz. Each of its counts is two character rows: O, its clock, is half the row rate.'),
        ),
        panel(
          'Where the sync pulses fall',
          { accent: 'yellow', chips: 'IC11 7410: H̅S̅ = NAND(J, pin 10, pin 11) · V̅S̅ = NAND(S, O, pin 5) · SYNC = NAND(H̅S̅, V̅S̅), high in either' },
          row(hSel, gSel, vSel),
          syncKv.el,
          note('Jumpers on IC11 pick where in the line the horizontal sync pulse falls (four places, 8 or 4 character times apart) and where in the frame the vertical one falls (three, 24 lines apart). The TV starts a line on each pulse and puts the picture a fixed time after it, so moving a pulse moves the picture the other way: on this TV, H̅ and G centre the 32 characters, and with H and G the first three fall off the left edge. Lancaster’s text says the vertical pulse is about 1.5 ms; by the gates as read here it is 12 lines, about 0.76 ms.'),
        ),
        panel(
          'The chain, test point by test point',
          { accent: 'green', chips: 'each 8288 is a ÷2 (~CLK1 to QA) and a ÷6 (~CLK2 to QB, then a ÷3 on QC and QD) · the 7473 halves toggle (J and K open)' },
          pointsTable,
          h('div', { class: 'dim small' }, 'One line, a sample a dot (HS is high in the sync pulse):'),
          lineScope.el,
          h('div', { class: 'dim small' }, 'One frame, a sample a line (VS likewise):'),
          frameScope.el,
          note('Lancaster’s numbers are from his waveform page: the rate at each test point, divided down from the crystal. The board’s own count, the one here, is measured over the last whole frame. A test point that changes more than once in an animation frame shows its LED dimmed, as a fast one looks.'),
        ),
        panel(
          'Inside the chips',
          { accent: 'gray' },
          note('The 8288 (Signetics) is a divide-by-12 counter with the 74197’s pinout: a ÷2 and a ÷6, counting on the falling edges of their clocks. Its ÷6 is a ÷2 then a ÷3, and in the ÷3 C is high on the second count and D on the third, never together. With QA wired to clock 2 it counts 0 to 11 in binary, and a low on reset (pin 13) clears it at once: wire a gate to reset it at 11 and it divides by 11.'),
          note('The 7473 is a master-slave JK flip-flop: it takes J and K while the clock is high and changes its outputs as the clock pulse ends. Here J and K are left open, which TTL reads as high, so each half toggles: a ÷2.'),
          note('IC1, an MC4024 (Motorola), is two oscillators: one runs on the 4.561920 MHz crystal and is the dot clock, test point A; the other, with C9, 33 µF, is the cursor’s blinker (U, about 4 Hz). Here the lab is the crystal, a dot at a time; the blinker comes with the cursor.'),
        ),
      ),
    );
    return d.dispose;
  },
});
