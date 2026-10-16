import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row } from '../../ui/components';
import { Disposer, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { MetastabilityGuard, callout, countToggles, edgePulse, netRecorder, stepLoop } from '../latches/_shared';
import { defineLab } from '../types';
import { drawEdgeJK, edgeJK } from './_shared';

const RATE = 200;
const TAIL = 30;
const GATE_NS = 10; // a 74LS gate delay is about 10 ns

interface Shot {
  width: number;
  toggles: number;
  final: number;
  metastable: boolean;
}

export default defineLab({
  id: 'jk-racing',
  title: 'JK flip-flop racing',
  summary:
    'Ben builds the edge-triggered JK flip-flop and sets J = K = 1. It should toggle once per clock, but his RC pulse (1 nF and 1 kΩ, about 1 µs) is far longer than the few nanoseconds the feedback takes to get round the loop. While the pulse is high, Q toggles, feeds back and toggles again, many times, and the final state is anyone’s guess. Change the pulse width (in gate delays) and count the toggles per pulse.',
  mount(root) {
    const d = new Disposer();
    const c = new Circuit();
    const J = c.input('J', 1);
    const K = c.input('K', 1);
    const CLK = c.input('CLK', 0);
    const P = c.net('P', 0);
    let width = 10;
    let used = width;
    edgePulse(c, CLK, P, () => used, 'RC');
    const jk = edgeJK(c, J, K, P);
    const { Q, Qn } = jk.latch;
    c.settle();
    const guard = new MetastabilityGuard(c, jk.latch, jk.S, jk.R);

    let jitter = 0;
    let slow = false;
    let autoFire = false;
    let capturing = false;
    let left = 0;
    let idleFrames = 0;
    let resolved = false;
    const shots: Shot[] = [];
    const tally = [0, 0];

    // ---- schematic ----
    const sch = new Schematic(c, { width: 560, height: 262 });
    drawEdgeJK(sch, { J, K, CLK, P, S: jk.S, R: jk.R, Q, Qn }, { rcLabel: '1nF + R' });
    sch.switch(K, [60, 70], { label: 'K', onToggle: () => setK(K.value !== 1) });
    sch.switch(J, [60, 200], { label: 'J', onToggle: () => setJ(J.value !== 1) });
    sch.switch(CLK, [60, 135], { label: 'CLK', onToggle: () => fire() });
    d.add(sch.autoUpdate());

    // ---- widgets ----
    const rec = netRecorder([CLK, P, jk.S, jk.R, Q], 400);
    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'P (RC pulse)', color: '#94a3b8' },
        { label: 'S = J·P·Q̅', color: '#4ade80' },
        { label: 'R = K·P·Q', color: '#c084fc' },
        { label: 'Q', color: '#f87171' },
      ],
      { width: 640, laneHeight: 40 },
    );
    const status = callout();
    const big = h('div', { class: 'mono', style: 'font-size:1.6rem;font-weight:700' }, '–');
    const kv = readouts(['pulse width', 'final Q over all pulses', 'last pulses']);
    const setJ = (v: boolean) => { c.set(J, v ? 1 : 0); jToggle.set(v); };
    const setK = (v: boolean) => { c.set(K, v ? 1 : 0); kToggle.set(v); };
    const jToggle = new Toggle({ label: 'J', value: true, onChange: setJ });
    const kToggle = new Toggle({ label: 'K', value: true, onChange: setK });
    const fmtW = (w: number) => `${w} gate delays ≈ ${w * GATE_NS} ns`;
    const widthSlider = new Slider({ label: 'Pulse', min: 1, max: 120, step: 1, value: width, format: (v) => `${v} delays`, onInput: (v) => (width = v) });
    const jitterSlider = new Slider({ label: 'Stray C', min: 0, max: 0.4, step: 0.05, value: 0, format: (v) => (v ? `±${Math.round(v * 100)} %` : 'none'), onInput: (v) => (jitter = v) });
    const preset = (label: string, w: number) => new Button({ label, onClick: () => { width = w; widthSlider.set(w); } }).el;
    const fireBtn = new Button({ label: 'Fire one clock pulse', kind: 'primary', onClick: () => fire() });
    const autoToggle = new Toggle({ label: 'Keep firing', onChange: (v) => (autoFire = v) });
    const slowToggle = new Toggle({ label: 'Slow motion', onChange: (v) => (slow = v) });
    const resetBtn = new Button({ label: 'Clear statistics', onClick: () => { shots.length = 0; tally[0] = tally[1] = 0; } });

    const fire = () => {
      if (capturing) return;
      used = Math.max(1, Math.round(width * (1 + jitter * (Math.random() * 2 - 1))));
      rec.clear();
      rec.sample();
      resolved = false;
      c.set(CLK, 1);
      capturing = true;
      left = used + TAIL;
    };

    const finish = () => {
      c.set(CLK, 0);
      capturing = false;
      idleFrames = 0;
      const q = rec.samples[4];
      const toggles = countToggles(q);
      const shot: Shot = { width: used, toggles, final: Q.value === 1 ? 1 : 0, metastable: resolved };
      shots.unshift(shot);
      if (shots.length > 8) shots.pop();
      tally[shot.final]++;
    };

    const update = () => {
      const last = shots[0];
      kv.set('pulse width', fmtW(capturing ? used : width) + (jitter && !capturing ? ` (±${Math.round(jitter * 100)} % per pulse)` : ''));
      kv.set('final Q over all pulses', `Q = 0: ${tally[0]}×, Q = 1: ${tally[1]}×`);
      kv.set('last pulses', shots.length ? shots.map((s) => `${s.width}→${s.toggles}`).join(', ') : '—');
      if (capturing) {
        const n = countToggles(rec.samples[4]);
        setText(big, `${n} toggle${n === 1 ? '' : 's'} so far`);
      } else setText(big, last ? `${last.toggles} toggle${last.toggles === 1 ? '' : 's'} → Q = ${last.final}` : '–');
      let msg: string;
      if (J.value !== 1 || K.value !== 1) msg = 'Racing needs J = K = 1. With only J or only K high, the gate that fires is blocked as soon as Q changes, so nothing races. Set both back to 1.';
      else if (capturing && P.value === 1) msg = `The clock pulse is still high. Every time Q flips, the new Q and Q̅ reach the AND gates a couple of gate delays later and open the other gate, so Q flips again. Q has toggled ${countToggles(rec.samples[4])} times so far.`;
      else if (capturing) msg = 'The pulse is over: both AND gates are blocked again and the latch keeps whatever state it was in when the pulse ended.';
      else if (!last) msg = 'Choose a pulse width and fire a clock pulse. Ben’s first edge detector (1 nF with 1 kΩ, τ = 1 µs) is about 100 gate delays long.';
      else if (last.metastable) msg = `The pulse ended in the middle of a transition, so the latch was left half-way and settled randomly at Q = ${last.final}. Q toggled ${last.toggles} times during the ${last.width}-delay pulse.`;
      else if (last.toggles === 1) msg = `Exactly one toggle: the ${last.width}-gate-delay pulse ended before the new Q could get back round the feedback loop (about 3 gate delays). This is the behaviour we want, but the window is tiny.`;
      else msg = `Q toggled ${last.toggles} times during the ${last.width}-gate-delay pulse and ended at Q = ${last.final}. One trip round the loop (AND, NOR, NOR) takes about 3 gate delays, so a long pulse gives many toggles. The final state depends on the exact pulse length.`;
      setText(status, msg);
    };

    d.add(
      stepLoop({
        rate: () => RATE,
        slow: () => slow,
        slowMs: 220,
        running: () => capturing || !c.idle || guard.busy,
        step: () => {
          c.step();
          if (guard.check()) resolved = true;
          if (capturing) {
            rec.sample();
            if (--left <= 0) finish();
          }
        },
        frame: () => {
          if (!capturing && autoFire && ++idleFrames > 50) fire();
          scope.draw(rec.samples, { window: Math.max(40, (capturing ? used : shots[0]?.width ?? width) + TAIL + 1) });
          update();
        },
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Edge-triggered JK with J = K = 1',
          { accent: 'red', chips: '74LS02 · 74LS11 · edge detector 1 nF (0.001 µF) + 1 kΩ, then 100 Ω' },
          sch.el,
          row(fireBtn.el, autoToggle.el, slowToggle.el),
          row(widthSlider.el, jitterSlider.el),
          row(h('span', { class: 'dim small' }, 'Presets:'), preset('ideal: 2', 2), preset('1 nF + 100 Ω ≈ 10', 10), preset('1 nF + 1 kΩ ≈ 100', 100)),
          row(jToggle.el, kToggle.el),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('One clock pulse on the scope', { accent: 'gray', subtitle: 'single shot' }, scope.el, big, status),
          panel('Statistics', { accent: 'gray' }, kv.el, row(resetBtn.el), note('Turn on “Keep firing” and add some stray capacitance: the pulse length wobbles by a few gate delays, and the final state becomes unpredictable, just as Ben found when he moved his hand near the breadboard.')),
          panel(
            'Why the RC edge detector is a marginal fix',
            { accent: 'gray' },
            note('With 1 nF and 1 kΩ the pulse is about 1 µs, roughly 100 gate delays: dozens of toggles. Ben swaps in 100 Ω (100 ns, about 10 gate delays) and it still races. To toggle exactly once the pulse has to be at least about 2 gate delays, so the latch can flip, but shorter than one trip round the feedback loop, about 3 gate delays. That is a window of roughly 10 ns, smaller than what stray breadboard capacitance changes.'),
            note('The next video fixes this properly with a master-slave flip-flop, where the feedback can never get back to the input while the clock is high.'),
          ),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
