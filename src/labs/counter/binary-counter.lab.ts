import { Circuit, type Net } from '../../logic/circuit';
import { DEC_DIGITS } from '../../sim/display';
import { Button, LedBar, Scope, SevenSegment, Slider, Toggle, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { callout, injectStyle, netRecorder, stepLoop } from '../latches/_shared';
import { defineLab } from '../types';
import { ls76, rippleSequence } from './_shared';

const HALF = 8; // clock half period in gate delays
const WINDOW = 17 * 2 * HALF;
const SCOPE = 'lab-ripple';

type Wiring = 'q' | 'qn';

export default defineLab({
  id: 'binary-counter',
  title: 'Binary counter',
  summary:
    'A JK flip-flop with J = K = 1 toggles on every clock, so its output runs at half the clock frequency. Chain four of them (74LS76, which toggle on the falling edge), each output clocking the next stage, and the four outputs count in binary from 0 to 15: a ripple counter. Run the clock, then slow the ripple down to see the brief wrong counts in between.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, `.${SCOPE} .seq span { display: inline-block; padding: 1px 6px; margin: 2px; border-radius: 5px; border: 1px solid var(--border); font-family: var(--mono); }
.${SCOPE} .seq span.transient { color: var(--fg-faint); text-decoration: line-through; }
.${SCOPE} .seq span.final { border-color: var(--accent); color: var(--fg); font-weight: 700; }
.${SCOPE} .seq i { color: var(--fg-faint); font-style: normal; }
.${SCOPE} .digits { display: inline-flex; gap: 4px; background: #0b0b0d; padding: 6px; border-radius: 6px; }`));

    const c = new Circuit();
    const HI = c.input('1', 1);
    const CLK = c.input('CLK', 0);
    const CLRn = c.input('CLR̅', 1);
    const SEL = c.input('wiring', 0);
    let ripple = 1;
    const Q: Net[] = [], Qn: Net[] = [], NEXT: Net[] = [];
    for (let i = 0; i < 4; i++) {
      Q.push(c.net(`Q${i}`, 0));
      Qn.push(c.net(`Q̅${i}`, 1));
      NEXT.push(c.net(`next${i}`, 0));
    }
    for (let i = 0; i < 4; i++) ls76(c, { J: HI, K: HI, CLK: i === 0 ? CLK : NEXT[i - 1], PRE: HI, CLR: CLRn, Q: Q[i], Qn: Qn[i], next: NEXT[i], sel: SEL }, () => ripple, `FF${i}`);
    c.settle();
    const count = () => Q.reduce((v, n, i) => v | ((n.value === 1 ? 1 : 0) << i), 0);

    let wiring: Wiring = 'q';
    let freq = 2;
    let auto = true;
    let slow = false;
    let phase = 0;
    let seq: number[] | null = null;
    let lastSeq: number[] = [];
    let stable = 0;

    // ---- schematic ----
    const sch = new Schematic(c, { width: 640, height: 226 });
    const pathQ: SVGElement[] = [], pathQn: SVGElement[] = [];
    for (let i = 0; i < 4; i++) {
      const x0 = 92 + i * 138;
      const ch = sch.chip([x0, 70], {
        label: '½ 74LS76',
        sublabel: `stage ${i}`,
        width: 86,
        height: 100,
        left: [{ name: 'J', net: HI }, { name: 'CLK', net: i === 0 ? CLK : NEXT[i - 1], bubble: true }, { name: 'K', net: HI }],
        right: [{ name: 'Q', net: Q[i] }, { name: 'Q̅', net: Qn[i] }],
        top: [{ name: 'PRE̅', net: HI }],
        bottom: [{ name: 'CLR̅', net: CLRn, bubble: true }],
      });
      sch.wire(HI, ch.left[0], [x0 - 22, ch.left[0].y]);
      sch.text('1', [x0 - 28, ch.left[0].y], { size: 12 });
      sch.wire(HI, ch.left[2], [x0 - 22, ch.left[2].y]);
      sch.text('1', [x0 - 28, ch.left[2].y], { size: 12 });
      sch.wire(HI, ch.top[0], [ch.top[0].x, 46]);
      sch.wire(CLRn, ch.bottom[0], [ch.bottom[0].x, 200]);
      const qx = ch.right[0].x, joinX = qx + 16;
      if (i < 3) {
        pathQ.push(sch.wire(Q[i], ch.right[0], [joinX, ch.right[0].y], [joinX, 120]));
        pathQn.push(sch.wire(Qn[i], ch.right[1], [joinX, ch.right[1].y], [joinX, 120]));
        sch.wire(NEXT[i], [joinX, 120], [x0 + 138 - 12, 120]);
      } else {
        sch.wire(Q[i], ch.right[0], [qx + 14, ch.right[0].y]);
        sch.wire(Qn[i], ch.right[1], [qx + 14, ch.right[1].y]);
      }
      sch.probe(Q[i], [x0 + 43, 22], { label: `Q${i}`, color: 'red' });
    }
    sch.wire(HI, [135, 46], [555, 46]);
    sch.text('PRE̅ = 1', [565, 46], { anchor: 'start', size: 11, class: 'gate-label' });
    sch.wire(CLRn, [135, 200], [555, 200]);
    sch.text('CLR̅', [565, 200], { anchor: 'start', size: 11, class: 'gate-label' });
    sch.wire(CLK, [56, 120], [80, 120]);
    sch.switch(CLK, [56, 120], { label: 'CLK', momentary: true });
    d.add(sch.autoUpdate());
    const showWiring = () => {
      for (const el of pathQ) el.style.opacity = wiring === 'q' ? '' : '0.15';
      for (const el of pathQn) el.style.opacity = wiring === 'qn' ? '' : '0.15';
    };
    showWiring();

    // ---- widgets ----
    const rec = netRecorder([CLK, Q[0], Q[1], Q[2], Q[3]], WINDOW);
    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'Q0 (÷2)', color: '#f87171' },
        { label: 'Q1 (÷4)', color: '#fb923c' },
        { label: 'Q2 (÷8)', color: '#fbbf24' },
        { label: 'Q3 (÷16)', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 40 },
    );
    const bar = new LedBar({ bits: 4, color: 'red', label: 'Q3 Q2 Q1 Q0', formats: ['bin', 'dec'] });
    const segs = [new SevenSegment({ height: 54 }), new SevenSegment({ height: 54 })];
    const seqEl = h('div', { class: 'seq' }, h('i', null, 'Clock the counter to see the states it passes through.'));
    const status = callout();
    const kv = readouts(['CLK', 'Q0', 'Q1', 'Q2', 'Q3']);

    const clkBtn = new Button({ label: 'Clock (falls on release)', kind: 'primary', onPress: () => { auto = false; autoToggle.set(false); c.set(CLK, 1); }, onRelease: () => c.set(CLK, 0) });
    const autoToggle = new Toggle({ label: 'Auto clock', value: true, onChange: (v) => { auto = v; if (!v) c.set(CLK, 0); } });
    const speed = new Slider({ label: 'Clock', min: 0.5, max: 20, log: true, value: freq, format: (v) => `${v.toFixed(1)} Hz`, onInput: (v) => (freq = v) });
    const rippleSlider = new Slider({ label: 'Delay/stage', min: 1, max: 6, step: 1, value: 1, format: (v) => `${v} gate delay${v > 1 ? 's' : ''}`, onInput: (v) => (ripple = v) });
    const slowToggle = new Toggle({ label: 'Ripple slow motion', onChange: (v) => (slow = v) });
    const clrBtn = new Button({ label: 'CLR̅ (clear)', onPress: () => c.set(CLRn, 0), onRelease: () => c.set(CLRn, 1) });
    const wiringSel = select<Wiring>(
      [
        { value: 'q', label: 'Q → next CLK (counts up)' },
        { value: 'qn', label: 'Q̅ → next CLK (counts down)' },
      ],
      wiring,
      (v) => { wiring = v; c.set(SEL, v === 'qn' ? 1 : 0); showWiring(); },
      'Wiring',
    );

    const renderSeq = (s: number[]) => {
      seqEl.replaceChildren(
        ...s.flatMap((v, i) => {
          const cls = i === 0 ? '' : i === s.length - 1 ? 'final' : 'transient';
          return [i ? h('i', null, ' → ') : null, h('span', { class: cls, title: v.toString(2).padStart(4, '0') }, String(v))].filter(Boolean) as HTMLElement[];
        }),
      );
    };

    const update = () => {
      const n = count();
      bar.set(n);
      segs[0].set(n >= 10 ? DEC_DIGITS[Math.floor(n / 10)] : 0);
      segs[1].set(DEC_DIGITS[n % 10]);
      const f = auto ? freq : 0;
      const fm = (div: number) => (f ? `${(f / div).toPrecision(3)} Hz` : `CLK ÷ ${div}`);
      kv.set('CLK', f ? `${f.toFixed(2)} Hz` : 'manual');
      kv.set('Q0', fm(2));
      kv.set('Q1', fm(4));
      kv.set('Q2', fm(8));
      kv.set('Q3', fm(16));
      let msg: string;
      if (CLRn.value === 0) msg = 'CLR̅ is low: the asynchronous clear forces every Q to 0 straight away, without waiting for a clock edge.';
      else if (slow && seq && seq.length > 1) msg = `Rippling: the change is travelling from stage to stage (${seq.join(' → ')}). The intermediate numbers are not valid counts; each stage only starts after the one before it has changed.`;
      else if (lastSeq.length > 2) msg = `On the last falling edge the counter went ${lastSeq.join(' → ')}. Only the last number is the real count: the ones in between existed for a gate delay or two each while the ripple travelled. Anything sampling the outputs at that moment would read a wrong value.`;
      else msg = `Each stage toggles when its clock input falls: stage 0 on the clock, stage 1 when Q0 falls, and so on. Count = ${n} (${n.toString(2).padStart(4, '0')}).`;
      setText(status, msg);
    };

    d.add(
      stepLoop({
        rate: () => (slow ? 4 : 2 * HALF * freq),
        slow: () => slow,
        slowMs: 260,
        maxPerFrame: 40,
        step: () => {
          if (auto && ++phase >= HALF) {
            phase = 0;
            c.set(CLK, CLK.value === 1 ? 0 : 1);
          }
          const before = count();
          const fell = CLK.value === 0 && rec.samples[0][rec.samples[0].length - 1] === 1;
          if (fell) {
            seq = [before];
            stable = 0;
          }
          c.step();
          const now = count();
          if (seq) {
            if (now !== seq[seq.length - 1]) {
              seq.push(now);
              stable = 0;
            } else if (++stable > 4 * ripple + 2) {
              lastSeq = seq;
              seq = null;
              renderSeq(lastSeq);
            }
          }
          rec.sample();
        },
        frame: () => {
          scope.draw(rec.samples, { window: WINDOW });
          update();
        },
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          '4-bit ripple counter',
          { accent: 'red', chips: '74LS76 (dual JK, falling edge) ×2 · J = K = 1 · PRE̅ and CLR̅ high' },
          sch.el,
          row(clkBtn.el, autoToggle.el, clrBtn.el),
          row(speed.el, wiringSel),
          row(rippleSlider.el, slowToggle.el),
          row(bar.el, h('span', { class: 'digits' }, segs.map((s) => s.el))),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('What is happening', { accent: 'gray' }, status, h('div', null, h('strong', { class: 'small' }, 'Last falling edge: '), seqEl)),
          panel('Divide by 2, 4, 8 and 16', { accent: 'gray' }, scope.el, kv.el, note('Each output has half the frequency of the one before it. Q0 changes on every falling clock edge, Q3 only once every 16 clocks.')),
          panel('Ripple vs synchronous', { accent: 'gray' }, note(`Going from 7 to 8 the counter passes through ${rippleSequence(7).slice(0, -1).join(', ')} before it reaches 8, because each flip-flop waits for the one before it. The program counter will use a 74LS161 instead: a synchronous counter where all four bits change on the same clock edge, with count-enable and load inputs.`)),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
