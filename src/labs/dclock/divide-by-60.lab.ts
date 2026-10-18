import { CHIP_MODELS, instantiateChip } from '../../breadboard/sim/chips';
import type { Level, Net } from '../../logic/circuit';
import { Button, Led, LedBar, Scope, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { callout, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { SquareSource, clockCircuit, timebase, value, type Mains, type Timebase } from './_circuits';

type FfClock = 'manual' | '2' | '100';
type Speed = '1' | '0.1' | '0.0167';

/** The 74LS92's count sequence from its datasheet (Q0 wired to ~CP1): count -> Q3 Q2 Q1 Q0. */
export const LS92_SEQUENCE = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13];

export default defineLab({
  id: 'divide-by-60',
  title: 'Dividing a signal by counting',
  summary:
    'The clock should tick once a second, not 60 times. A D flip-flop whose Q̅ feeds its own D toggles on every clock, halving the frequency, and a chain of them counts the pulses in binary: a frequency divider and a counter are the same thing. Ben uses two counter chips: the 74LS90 decade counter (a ÷2 and a ÷5 section) and the 74LS92 divide-by-12 counter (÷2, ÷3 and ÷2). Divide 60 Hz by 2, 5, 2 and 3 and you get one pulse a second; for 50 Hz mains a second 74LS90 divides by 5 again. Both count on the falling edge of their clocks.',
  mount(root) {
    const d = new Disposer();

    // ---- four D flip-flops (two 74LS74s), each Q̅ into its own D and the next one's clock ----
    const ff = clockCircuit();
    const clk = ff.c.input('CLK', 0);
    const q = [0, 1, 2, 3].map((k) => ff.c.net(`Q${k}`, 'Z'));
    const nq = [0, 1, 2, 3].map((k) => ff.c.net(`~Q${k}`, 'Z'));
    const half = (k: number, unit: 1 | 2, clock: Net) => ({ [`~${unit}CLR`]: ff.vcc, [`${unit}D`]: nq[k], [`${unit}CLK`]: clock, [`~${unit}PRE`]: ff.vcc, [`${unit}Q`]: q[k], [`~${unit}Q`]: nq[k] });
    instantiateChip(ff.c, CHIP_MODELS['74LS74'], { ...half(0, 1, clk), ...half(1, 2, nq[0]) }, {}, 'U1');
    instantiateChip(ff.c, CHIP_MODELS['74LS74'], { ...half(2, 1, nq[1]), ...half(3, 2, nq[2]) }, {}, 'U2');
    ff.c.settle(1000);
    let ffClock: FfClock = '2';
    let ffAcc = 0, ffPulses = 0;
    const ffScope = new Scope([{ label: 'clock', color: '#fbbf24' }, ...q.map((_, k) => ({ label: `Q${k}`, color: '#4ade80' }))], { width: 640, laneHeight: 30 });
    const ffHist: Level[][] = [[], [], [], [], []];
    const ffSample = () => {
      [clk, ...q].forEach((n, i) => {
        ffHist[i].push(n.value);
        if (ffHist[i].length > 64) ffHist[i].shift();
      });
    };
    const ffBar = new LedBar({ bits: 4, color: 'green', label: 'Q3 Q2 Q1 Q0', formats: ['dec'] });
    const ffText = callout();
    const ffHalf = () => {
      const was = clk.value;
      ff.c.set(clk, was === 1 ? 0 : 1);
      ff.c.settle(1000);
      if (was === 0) ffPulses++;
      ffSample();
    };
    const pulseBtn = new Button({ label: 'Clock pulse', onPress: () => ffClock === 'manual' && ffHalf(), onRelease: () => ffClock === 'manual' && ffHalf() });
    const ffSelect = select<FfClock>([{ value: '2', label: '2 Hz' }, { value: '100', label: '100 Hz (Ben’s simulation)' }, { value: 'manual', label: 'By hand' }], ffClock, (v) => {
      ffClock = v;
      if (clk.value === 1) ffHalf(); // leave it low
    }, 'Clock');

    // ---- the 60 Hz (or 50 Hz) divider: 74LS90 + 74LS92 (or 74LS90 ÷5) ----
    let mains: Mains = 60, speed: Speed = '1';
    let tb: { cc: ReturnType<typeof clockCircuit>; src: SquareSource; t: Timebase; u1: Net[]; u2: Net[] };
    const build = () => {
      const cc = clockCircuit();
      const hz = cc.c.input('MAINS', 1);
      const t = timebase(cc.c, mains, hz, cc.gnd, cc.gnd);
      const find = (name: string) => [0, 1, 2, 3].map((k) => cc.c.nets.find((n) => n.name === `${name}.Q${k}`)!);
      tb = { cc, src: new SquareSource(cc.c, hz, mains), t, u1: find('TB1'), u2: find('TB2') };
      hist.length = 0;
    };
    const hist: Level[][] = [];
    const tbScope = { el: h('div') as HTMLElement, scope: null as Scope | null };
    const leds = h('div', { class: 'row' });
    let tapLeds: { led: Led; freq: number; on: number; n: number }[] = [];
    const u1Bar = new LedBar({ bits: 4, color: 'yellow', label: 'first chip Q3-Q0', formats: ['dec'] });
    const u2Bar = new LedBar({ bits: 4, color: 'yellow', label: 'second chip Q3-Q0', formats: ['dec'] });
    const seq = truthTable(['count', 'Q3', 'Q2', 'Q1', 'Q0'], LS92_SEQUENCE.map((v, i) => [String(i), ...[3, 2, 1, 0].map((b) => String((v >> b) & 1))]));
    const seqPanelBody = h('div');
    const tbKv = readouts(['chain', 'second', 'pulses in']);
    const tbText = callout();
    const relayout = () => {
      build();
      const taps = tb.t.taps;
      tbScope.scope = new Scope(taps.map(([label]) => ({ label, color: label === '1 Hz' ? '#f87171' : '#4ade80' })), { width: 640, laneHeight: 30 });
      tbScope.el.replaceChildren(tbScope.scope.el);
      tapLeds = taps.map(([label]) => ({ led: new Led(label === '1 Hz' ? 'red' : 'green', label), freq: Number(label.split(' ')[0]), on: 0, n: 0 }));
      leds.replaceChildren(...tapLeds.map((x, i) => h('span', { class: 'led-cell' }, x.led.el, h('span', { class: 'led-caption' }, taps[i][0]))));
      for (let i = 0; i < taps.length; i++) hist.push([]);
      seqPanelBody.style.display = mains === 60 ? '' : 'none';
      tbKv.set('chain', mains === 60 ? '74LS90: ÷2 (30 Hz on Q0), ÷5 (6 Hz on Q3) → 74LS92: ÷2 (3 Hz on Q0), ÷3 (1 Hz on Q2)' : '74LS90: ÷2 (25 Hz on Q0), ÷5 (5 Hz on Q3) → second 74LS90, ÷5 section only (1 Hz on Q3)');
    };
    relayout();

    const sampleTb = () => {
      tb.t.taps.forEach(([, n], i) => {
        const a = hist[i];
        a.push(n.value);
        if (a.length > 600) a.shift();
        const x = tapLeds[i];
        x.on += n.value === 1 ? 1 : 0;
        x.n++;
      });
    };

    d.add(
      animate((dt) => {
        const s = Math.min(dt, 100) / 1000;
        // flip-flops
        if (ffClock !== 'manual') {
          ffAcc += s;
          const halfPeriod = 1 / (2 * Number(ffClock));
          while (ffAcc >= halfPeriod) {
            ffAcc -= halfPeriod;
            ffHalf();
          }
        }
        ffScope.draw(ffHist, { window: 64 });
        const count = value(q);
        ffBar.set(Math.max(0, count));
        setText(ffText, `${ffPulses} clock pulses so far; Q3-Q0 read ${count.toString(2).padStart(4, '0')} = ${count}, which is ${ffPulses} mod 16. Each flip-flop’s Q̅ goes back into its own D, so every rising clock edge loads the opposite of what it holds: it toggles at half the clock rate. Its Q̅ clocks the next one, which toggles at half that again${ffClock === '100' ? ': 100, 50, 25, 12.5 and 6.25 Hz, as in Ben’s simulation' : ''}.`);

        // divider, at the chosen speed; a scope point every 2 ms of real time
        const sp = Number(speed);
        for (const x of tapLeds) x.on = x.n = 0;
        tb.src.advance(s * sp, sampleTb, 0.002 * sp);
        tbScope.scope?.draw(hist, { window: 600 });
        tapLeds.forEach((x) => {
          const shown = x.freq * sp > 12 ? 0.5 : x.n ? (x.on / x.n >= 0.5 ? 1 : 0) : 0;
          x.led.set(shown > 0);
          x.led.el.style.opacity = shown === 0.5 ? '0.55' : '';
        });
        const v1 = value(tb.u1), v2 = value(tb.u2);
        u1Bar.set(Math.max(0, v1));
        u2Bar.set(Math.max(0, v2));
        seq.set(mains === 60 ? LS92_SEQUENCE.indexOf(v2) : -1);
        const secs = Math.floor(tb.src.t);
        tbKv.set('second', `${secs} (${tb.src.t.toFixed(1)} s of mains)`);
        tbKv.set('pulses in', `${Math.floor(tb.src.t * mains)}`);
        setText(tbText, sp === 1
          ? `Real time: the ${mains} Hz and ${mains / 2} Hz LEDs flicker too fast to see (they look half lit), the ${mains === 60 ? '6 and 3 Hz' : '5 Hz'} ones blink, and the red one blinks once a second. Slow it down to see each stage count.`
          : `Slowed down ${sp < 0.05 ? '60' : '10'} times: watch each counter section step on the falling edge of the stage before it. The ÷5 section steps through 0-4 on Q1-Q3, the ÷3 section through 0-2 on Q1-Q2.`);
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'A D flip-flop divides by two',
          { accent: 'green', chips: '74LS74 ×2 · each Q̅ to its own D and to the next clock' },
          row(ffSelect, pulseBtn.el),
          ffScope.el,
          row(ffBar.el),
          ffText,
        ),
        panel(
          '60 Hz (or 50 Hz) down to one pulse a second',
          { accent: 'red', chips: '74LS90 (Q0 pin 12 → ~CP1 pin 1) · 74LS92 (Q0 pin 12 → ~CP1 pin 1, 1 Hz out of pin 9) · all reset pins to ground · LED + 220 Ω' },
          row(
            select<'60' | '50'>([{ value: '60', label: '60 Hz (74LS90 + 74LS92)' }, { value: '50', label: '50 Hz (two 74LS90s)' }], '60', (v) => { mains = Number(v) as Mains; relayout(); }, 'Mains'),
            select<Speed>([{ value: '1', label: 'Real time' }, { value: '0.1', label: '10× slower' }, { value: '0.0167', label: '60× slower' }], speed, (v) => (speed = v), 'Speed'),
          ),
          leds,
          tbScope.el,
          row(u1Bar.el, u2Bar.el),
          tbKv.el,
          tbText,
          seqPanelBody,
        ),
        panel(
          'Inside the counter chips',
          { accent: 'gray' },
          note('The 74LS90 is a decade counter: a ÷2 section (clock ~CP0, output Q0) and a ÷5 section (clock ~CP1, outputs Q1-Q3 counting 0 to 4). Feed Q0 into ~CP1 and Q0-Q3 count 0 to 9 in binary. The 74LS92 is a divide-by-12 counter: a ÷2 section, then a ÷3 section (Q1, Q2 counting 0, 1, 2) and a last ÷2 (Q3) that toggles each time the ÷3 section starts over.'),
          note('“Divide-by-12 counter” sounds odd until you see that counting pulses and dividing a frequency are the same thing. For 60 Hz: ÷2 = 30 Hz, ÷5 = 6 Hz, ÷2 = 3 Hz, ÷3 = 1 Hz (the 74LS92’s last ÷2 isn’t used). For 50 Hz: ÷2 = 25 Hz, ÷5 = 5 Hz, then the ÷5 section of a second 74LS90 = 1 Hz. Ben’s kit has two 74LS90s and a 74LS92 so either can be built.'),
        ),
      ),
    );
    seqPanelBody.append(h('div', { class: 'dim small' }, '74LS92 count sequence (datasheet), Q0 wired to ~CP1:'), seq.el);
    return d.dispose;
  },
});
