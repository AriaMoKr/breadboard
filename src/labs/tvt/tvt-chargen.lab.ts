import { prettyPin } from '../../breadboard/catalog';
import { FONT_2513, char2513 } from '../../breadboard/sim/font2513';
import type { Level } from '../../logic/circuit';
import { Button, LedBar, Scope, Slider, Toggle, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { VIDEO_VOLTS, charGen, type VideoLevel } from './_chargen';
import { DOT_HZ, charTime, hz, scanLine, type TGate } from './_timing';
import { HOLD, TvScan, TvScreen } from './_tv';

type Speed = 'fast' | 'line' | 'char' | 'pause';

/** The vertical hold here: below the 55 Hz the board makes as drawn (part 1), so the TV holds it. */
const HOLD_HERE = 54;

/**
 * How much of a line the scope shows: character times 1 to 11. J falls two dots before the first
 * begins (as D rises, in the last character time's third third), so it starts two dots in.
 */
const SCOPE_FROM = 2, SCOPE_DOTS = 66;

/** What the memory holds to begin with. */
export const SAMPLE_TEXT = [
  'THE TV TYPEWRITER',
  'RADIO-ELECTRONICS, SEPT. 1973',
  '',
  '16 LINES OF 32 CHARACTERS, FROM',
  'THE 64 OF A 2513:',
  '',
  ' !"#$%&\'()*+,-./0123456789:;<=>?',
  '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_',
].join('\n');

/** Every place on the screen filled: the 64 characters in order, over and over. */
const FULL_TEXT = Array.from({ length: 16 }, (_, r) => Array.from({ length: 32 }, (_, col) => char2513((r * 32 + col + 32) & 63)).join('')).join('\n');

/** The 2513's chart: a dot is D pixels; a character is 5 dots and a gap across, 8 rows and a gap down. */
const D = 10, CHART_W = 8 * 6 * D, CHART_H = 8 * 9 * D;

const CSS = `
.tvt-lab .tvt-tv { background: #2a2622; border-radius: 22px; padding: 14px; max-width: 640px; box-sizing: border-box; forced-color-adjust: none; }
.tvt-lab .tvt-screen { display: block; width: 100%; aspect-ratio: 4 / 3; border-radius: 18px / 14px; background: #0e1210; }
.tvt-lab .tvt-memory { display: grid; gap: 4px; max-width: 100%; }
.tvt-lab .tvt-memory textarea { font-family: var(--mono); line-height: 1.35; width: 100%; max-width: calc(32ch + 20px); box-sizing: border-box; resize: none; text-transform: uppercase; overflow-x: auto; white-space: pre; }
.tvt-lab .tvt-chart { display: block; width: 100%; max-width: 240px; aspect-ratio: ${CHART_W} / ${CHART_H}; border-radius: 6px; background: #0e1210; forced-color-adjust: none; }
.tvt-lab .tvt-reg { font-family: var(--mono); white-space: pre; overflow-wrap: anywhere; }
.tvt-lab .tvt-reg b { text-decoration: underline; }
`;

export default defineLab({
  id: 'tvt-chargen',
  title: 'The character generator',
  summary:
    'The TV Typewriter’s characters come from a Signetics 2513, a MOS read-only memory with 64 characters of 5 × 7 dots. On the first line of each character row a 2518, six 32-bit shift registers in one package, takes the row’s 32 characters from the memory; on each of the row’s other lines it sends them round again to the 2513, which gives that line’s five dots of each character. A 74165 shifts the dots out on the dot clock, and a 7401 mixes them with the sync into the TV’s video. Here they run chip by chip on the timing board of part 1, a dot at a time, with a stand-in for the memory board, which comes next: type into it and watch the TV draw what you typed.',
  mount(root) {
    const d = new Disposer();
    root.classList.add('tvt-lab');
    d.add(injectStyle(root, CSS));
    d.add(() => root.classList.remove('tvt-lab'));

    const g = charGen();
    const { board } = g;
    const { tp } = board;
    g.setText(SAMPLE_TEXT);
    const scan = new TvScan();
    scan.hold = HOLD_HERE;
    const screen = new TvScreen(scan, 'The TV');
    let speed: Speed = 'fast';

    // ---- what the loop measures
    let loadedNow = false;
    const lanes: [string, () => Level][] = [
      ['C', () => tp.C.value],
      ['D', () => tp.D.value],
      ['LINE CLOCK', () => board.lineClock.value],
      ['NOR(C, D)', () => board.norCD.value],
      ['OUTPUT LOAD', () => board.outputLoad.value],
      [`${prettyPin('SH/~LD')}: a load`, () => (loadedNow ? 0 : 1)],
      ['QH: the dots', () => g.qh.value],
    ];
    /** The first SCOPE_DOTS dots of the line going on, and of the last line that had a dot in them. */
    let cur: Level[][] = lanes.map(() => []), shown: Level[][] = lanes.map(() => []), curDots = false;
    let dotInLine = 0, lineInFrame = 0, frames = 0;
    const count = { dots: 0, reads: 0, loads: 0, white: 0, black: 0, sync: 0 };
    let from = { ...count }, last: typeof count | null = null;
    const sim = { from: 0, ms: 0, rate: 0 };

    const oneDot = () => {
      const jWas = tp.J.value, sWas = tp.S.value, loads = g.loads;
      board.dot();
      loadedNow = g.loads !== loads;
      const v = g.video();
      scan.feed(v === 'white', v === 'sync', 1 / DOT_HZ);
      count.dots++;
      count[v]++;
      // a new frame as S falls, a new line as J falls
      if (sWas === 1 && tp.S.value === 0) {
        if (frames++) last = { ...count, dots: count.dots - from.dots, reads: g.reads - from.reads, loads: g.loads - from.loads, white: count.white - from.white, black: count.black - from.black, sync: count.sync - from.sync };
        from = { ...count, reads: g.reads, loads: g.loads };
        lineInFrame = 0;
      } else if (jWas === 1 && tp.J.value === 0) lineInFrame++;
      if (jWas === 1 && tp.J.value === 0) {
        if (curDots) shown = cur;
        cur = lanes.map(() => []);
        curDots = false;
        dotInLine = 0;
      }
      if (dotInLine >= SCOPE_FROM && dotInLine < SCOPE_FROM + SCOPE_DOTS) {
        for (let i = 0; i < lanes.length; i++) cur[i].push(lanes[i][1]());
        if (g.qh.value === 1) curDots = true;
      }
      dotInLine++;
    };

    // ---- the TV
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
    const tSel = select<TGate>([{ value: 'R', label: 'R, as drawn (55 Hz)' }, { value: 'Q', label: 'Q (60 Hz)' }], board.jumpers.t, (v) => board.setJumper('t', v), 'Timing board IC10 pin 11 to');
    const hold = new Slider({ label: 'Vertical hold', min: HOLD.min, max: HOLD.max, value: HOLD_HERE, step: 0.5, format: (v) => `${v.toFixed(1)} Hz`, onInput: (v) => (scan.hold = v) });
    const tvKv = readouts(['frame rate (S)', 'text row', 'scan line', 'character time', 'the TV']);
    const tvText = callout();

    // ---- the memory, for now
    const ta = h('textarea', { rows: 16, cols: 32, spellcheck: false, autocapitalize: 'characters', autocomplete: 'off', wrap: 'off', id: 'tvt-memory-text' });
    ta.value = SAMPLE_TEXT;
    const typed = () => g.setText(ta.value);
    ta.addEventListener('input', typed);
    const fill = (text: string) => () => {
      ta.value = text;
      typed();
    };
    const memory = h('div', { class: 'tvt-memory' }, h('label', { for: 'tvt-memory-text' }, 'The memory: 16 lines of 32 characters'), ta);
    const memKv = readouts(['reads a frame']);

    // ---- IC8 2518
    const regHead = h('b'), regRest = h('span');
    const reg = h('code', { class: 'tvt-reg' }, regHead, regRest);
    const regKv = readouts(['REC (pin 4)', 'on its outputs']);

    // ---- IC9 2513
    const chart = h('canvas', { width: CHART_W, height: CHART_H, class: 'tvt-chart', role: 'img', 'aria-label': 'The 2513’s 64 characters' });
    const chartCtx = chart.getContext?.('2d') ?? null;
    let charted = '';
    const drawChart = (code: number | null, r: number | null) => {
      const key = `${code} ${r}`;
      if (!chartCtx || key === charted) return;
      charted = key;
      chartCtx.fillStyle = '#0e1210';
      chartCtx.fillRect(0, 0, CHART_W, CHART_H);
      for (let k = 0; k < 64; k++) {
        const cx = (k & 7) * 6 * D + D / 2, cy = (k >> 3) * 9 * D + D / 2, here = k === code;
        if (here) {
          chartCtx.fillStyle = '#3a3420';
          chartCtx.fillRect(cx - D / 2, cy - D / 2, 6 * D, 9 * D);
        }
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 5; x++) {
            const on = (FONT_2513[k][y] >> (4 - x)) & 1;
            chartCtx.fillStyle = here && y === r ? (on ? '#fde047' : '#6b5d1f') : on ? (here ? '#deece2' : '#9fb3a6') : '#1f2a24';
            chartCtx.fillRect(cx + x * D + 1, cy + y * D + 1, D - 2, D - 2);
          }
      }
      chart.setAttribute('aria-label', code === null ? 'The 2513’s 64 characters, in 8 rows of 8' : `The 2513’s 64 characters, in 8 rows of 8: the one on A4-A9 is “${char2513(code)}”, its row ${r ?? '?'} lit`);
    };
    const romKv = readouts(['A4-A9, the character', 'A1-A3, the row', 'O5-O1, the dots']);
    const dotsBar = new LedBar({ bits: 5, color: 'green', label: 'O5 to O1' });
    const cursorTgl = new Toggle({ label: 'CURSOR (28) high', onChange: (v) => g.setCursor(v) });

    // ---- IC10 74165, IC11 7401
    const scope = new Scope(lanes.map(([label]) => ({ label, color: label.startsWith('QH') ? '#fbbf24' : '#4ade80' })), { width: 640, laneHeight: 26 });
    const selfTgl = new Toggle({ label: 'SELF TEST (19) to ground', onChange: (v) => g.setSelfTest(v) });
    const flashTgl = new Toggle({ label: 'FLASH (43) to ground', onChange: (v) => g.setFlash(v) });
    const videoKv = readouts(['VIDEO OUT (20)', 'the last frame', 'loads']);
    const volts = (v: VideoLevel) => `${VIDEO_VOLTS[v].toFixed(2)} V`;

    let described = '';
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
          sim.rate = (count.dots - sim.from) / (sim.ms / 1000);
          sim.from = count.dots;
          sim.ms = 0;
        }
        screen.draw(speed !== 'fast');

        const f = last ? DOT_HZ / last.dots : 0, locked = scan.locked;
        tvKv.set('frame rate (S)', f ? `${hz(f)}${sim.rate ? `; here a frame takes ${(last!.dots / sim.rate).toFixed(1)} s` : ''}` : 'measuring…');
        const textRow = Math.floor(lineInFrame / 12) + 1;
        tvKv.set('text row', textRow <= 16 ? `${textRow} of 16` : 'below the text');
        tvKv.set('scan line', `${scanLine(board) + 1} of 12`);
        tvKv.set('character time', `${charTime(board) + 1} of 48`);
        tvKv.set('the TV', !last ? 'warming up…' : locked ? 'holding the picture still' : 'rolling: its fields don’t start on the sync pulses');
        setText(
          tvText,
          !last
            ? 'The first frame is on its way. Each dot is the crystal’s clock going high and low, with every chip then settling: about a second a frame here.'
            : locked
              ? `${board.jumpers.t === 'R' ? `${hz(f)}, as the board is drawn (part 1), with the vertical hold below it at ${scan.hold.toFixed(1)} Hz.` : `${hz(f)}, with IC10’s pin 11 on Q.`} Each character row is 12 lines: the 2513’s blank top row, its seven rows of dots, and four lines that 9-12 BLANK keeps dark.`
              : `The frames come ${hz(f)}, and the TV’s field oscillator runs at ${scan.hold.toFixed(1)} Hz by itself, so it starts each field before the sync pulse comes and the picture rolls. Turn the hold below ${hz(f)}.`,
        );
        const label = `The TV, showing the memory’s text, ${locked ? 'holding still' : 'rolling'}`;
        if (label !== described) screen.describe((described = label));
        memKv.set('reads a frame', last ? `${last.reads}: 32 on the first line of each of the 16 rows` : 'measuring…');

        const regWords = g.lineRegister().map((v) => (v === null ? '?' : v === 32 ? '·' : char2513(v)));
        setText(regHead, regWords[0]);
        setText(regRest, regWords.slice(1).join(''));
        const rec = board.line1.value;
        regKv.set('REC (pin 4)', rec === 0 ? 'low: taking a new row' : 'high: sending it round');
        const code = g.romCharacter(), r = g.romRow();
        regKv.set('on its outputs', code === null ? 'not settled' : `“${char2513(code)}” (${code})`);

        drawChart(code, r);
        const dots = g.romDots();
        romKv.set('A4-A9, the character', code === null ? 'not settled' : `${code.toString(2).padStart(6, '0')}: “${char2513(code)}”`);
        romKv.set('A1-A3, the row', r === null ? 'not settled' : `${r.toString(2).padStart(3, '0')}: row ${r}`);
        romKv.set('O5-O1, the dots', dots.map((b) => (b ? '●' : '○')).join(' '));
        dotsBar.set(dots.reduce<number>((v, b) => (v << 1) | b, 0));

        scope.draw(shown, { window: SCOPE_DOTS });
        const v = g.video();
        videoKv.set('VIDEO OUT (20)', `now ${v}, ${volts(v)}`);
        videoKv.set('the last frame', last ? `${last.white.toLocaleString('en-US')} dots white, ${last.black.toLocaleString('en-US')} black, ${last.sync.toLocaleString('en-US')} sync, of ${last.dots.toLocaleString('en-US')}` : 'measuring…');
        videoKv.set('loads', last ? `${last.loads.toLocaleString('en-US')} a frame: 32 a line, on every line` : 'measuring…');
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'On the TV',
          { accent: 'blue', chips: 'page A, Fig. 5: IC8 2518 · IC9 2513 · IC10 74165 · IC11 7401 · on the timing board (part 1, Fig. 7): IC9 7402, OUTPUT LOAD · IC10 7410, stack 15 and 16' },
          screen.el,
          row(speedSel, dotBtn.el),
          row(tSel, hold.el),
          tvKv.el,
          tvText,
        ),
        panel(
          'The memory, for now',
          { accent: 'gray', chips: 'a stand-in for the memory board (Fig. 4, six 2524s): on B1-B6 (stack 9-14), the next character each time stack 16 goes low' },
          memory,
          row(new Button({ label: 'As it began', onClick: fill(SAMPLE_TEXT) }).el, new Button({ label: 'Fill the screen', onClick: fill(FULL_TEXT) }).el, new Button({ label: 'Clear', onClick: fill('') }).el),
          memKv.el,
          note('The 2513 has 64 characters: capitals, digits and punctuation, ASCII’s codes 32 to 95 in six bits. Small letters show as capitals here, anything else as a space, and a line past 32 characters is cut. The memory board, the next part, holds 512 characters in six 2524 shift registers going round once a frame; this stand-in gives them out as the timing board asks, one each time stack 16 (the 2524s’ output clock) goes low, 32 on the first line of each row.'),
        ),
        panel(
          'The line register: IC8 2518',
          { accent: 'yellow', chips: 'IC8 2518: IN1-IN6 from B1-B6 · REC (4) from LINE 1 TRANSFER (17) · CLK (6) from LINE CLOCK (18) · OUT1-OUT6 to the 2513’s A4-A9' },
          h('div', { class: 'dim small' }, 'Its 32 characters, the one on its outputs first (· a space):'),
          reg,
          regKv.el,
          note('LINE CLOCK pulses 32 times a line, once in each character time the screen shows, and each pulse moves all six of the 2518’s 32-bit registers on a place. On line 1 of each row LINE 1 TRANSFER is low and REC takes the inputs, the row’s 32 characters from the memory, in place of what comes out; on lines 2 to 12 REC is high and they go round again, so the memory is read once a row, not once a line. A character goes in at one end and comes out 32 pulses later, so on line 1 the 2513 still gets the old row, while the new one goes in behind it; the 2513’s top row is blank in every character, so that line shows nothing, and from line 2 on the new row comes out.'),
        ),
        panel(
          'The character generator: IC9 2513',
          { accent: 'orange', chips: 'IC9 2513: A1-A3 from L1, L2, L4 (K, L, M) · A4-A9 from the 2518 · enable (11) from CURSOR (28), R37 to −12 V · O1-O5 to the 74165' },
          row(chart, h('div', null, romKv.el, row(dotsBar.el), row(cursorTgl.el))),
          note('The 2513 is a read-only memory of 64 × 8 × 5 bits: six address lines pick the character and three the row, and five outputs give that row’s dots, O5 the leftmost. The scan line’s count picks the row, so lines 1 to 8 of a character row are the 2513’s rows 0 to 7; on lines 9 to 12 A1-A3 give rows 0 to 3 again, but 9-12 BLANK keeps them dark. The enable is low (R37 pulls it to −12 V) for the characters; driven high, the outputs are left open, which the 74165 reads as all high: a white block. That is how the cursor shows, one place at a time, in a later part: here the switch raises it everywhere.'),
        ),
        panel(
          'Dots out: IC10 74165 and IC11 7401',
          { accent: 'red', chips: 'IC10 74165: C-G from O1-O5, A, B, H and SER grounded · SH/LD̅ (1) from OUTPUT LOAD through C13 · CLK (2) VIDEO CLOCK (47) · CLK INH (15) 9-12 BLANK (21) · IC11 7401: VIDEO OUT (20) with R36 and R51' },
          h('div', { class: 'dim small' }, 'Character times 1 to 11 of the last line that had dots in them, a sample a dot:'),
          scope.el,
          row(selfTgl.el, flashTgl.el),
          videoKv.el,
          note('The latch on the timing board (IC9, OUTPUT LOAD) goes high as LINE CLOCK rises and falls as the next character time begins: by then the 2518 has moved on and the 2513 has had most of a character time to settle. C13 turns the fall into a 40 ns load. The 74165 takes the five dots with a grounded bit after them, and shifts out the ground first, then O5 to O1: six dots a character, the first one a gap. So a character time’s dots come out a character later than the 2518 gave its character.'),
          note('IC11, a 7401, has open-collector outputs, so VIDEO OUT has three levels: a dot leaves it at 5 V (white), no dot pulls it through R51 to about 2 V (black, R51 against R36), and a sync pulse pulls it to ground. Grounding SELF TEST holds it white, all but the sync: a white raster, to set the TV up with. Grounding FLASH blanks the characters; the cursor’s blinker will drive it.'),
          note('Look just left of the first column, on the top line of a row under a row that is full to its 32nd place: a dot or two no character put there (Fill the screen shows it under every row that ends in ?). On lines 9 to 12, 9-12 BLANK holds the 74165’s clock, but its load still works, so the register ends line 12 holding the dots of the row’s last character for that line, its row 3. When the clock starts again on line 1 of the next row, it shifts them out ahead of the first character. That is the circuit as drawn, and the TV shows it.'),
        ),
        panel(
          'Inside the chips',
          { accent: 'gray' },
          note('The 2513 (Signetics, 1972) is a MOS read-only memory, made with its characters in it: here the standard one, CM2140, from Signetics’ chart. It runs on +5 V, −5 V and −12 V, takes about 450 ns from a new address to its dots, and its outputs are TTL’s.'),
          note('The 2518 (Signetics) is six 32-bit shift registers in one package, sharing a clock and a REC (recirculate) input, on +5 V and −12 V. Its clock is MOS-level: R34, R35 and C12 bring LINE CLOCK to it. Here it takes its inputs as the clock rises and moves them on as it falls, in about 300 ns.'),
          note('The 74165 is an 8-bit parallel-in, serial-out shift register: a low on SH/LD̅ (pin 1) loads it at once, without the clock; otherwise each rising edge of CLK moves it on a place, toward QH, while CLK INH is low. The 7401 is four two-input NAND gates with open-collector outputs: each can pull its output low, and something else has to pull it up.'),
        ),
      ),
    );
    return d.dispose;
  },
});
