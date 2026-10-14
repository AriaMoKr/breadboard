import { Circuit } from '../../logic/circuit';
import { Button, Scope, Toggle, note, panel, readouts, row } from '../../ui/components';
import { Disposer, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { MetastabilityGuard, callout, edgePulse, netRecorder, stepLoop, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { JK_ROWS, drawEdgeJK, edgeJK, jkRow } from './_shared';

const RATE = 150;
const WINDOW = 480;
/** An ideal short clock pulse: just long enough for the latch to flip. */
const PULSE = 2;

export default defineLab({
  id: 'jk-flip-flop',
  title: 'JK flip-flop',
  summary:
    'Start from an SR latch, gate S and R with a short pulse from an RC edge detector (an SR flip-flop), then feed Q and Q̅ back into the input AND gates: that is a JK flip-flop. J sets, K resets, and J = K = 1, which was the forbidden S = R = 1 state, now toggles Q on every clock edge. A toggling flip-flop divides the clock frequency by two, which is exactly what a counter needs.',
  mount(root) {
    const d = new Disposer();
    const c = new Circuit();
    const J = c.input('J', 0);
    const K = c.input('K', 0);
    const CLK = c.input('CLK', 0);
    const FB = c.input('feedback', 1);
    const P = c.net('P', 0);
    edgePulse(c, CLK, P, () => PULSE, 'RC');
    const jk = edgeJK(c, J, K, P, FB);
    const { Q, Qn } = jk.latch;
    c.settle();
    const guard = new MetastabilityGuard(c, jk.latch, jk.S, jk.R);

    let slow = false;
    let auto = false;
    let half = 40;
    let phase = 0;
    let resolvedAt = -1e9;
    let invalidAt = -1e9;
    let clkRises: number[] = [];
    let qRises: number[] = [];
    let prevClk = 0, prevQ = Q.value;

    // ---- schematic ----
    const sch = new Schematic(c, { width: 560, height: 262 });
    const drawing = drawEdgeJK(sch, { J, K, CLK, P, S: jk.S, R: jk.R, Q, Qn });
    sch.switch(K, [60, 70], { label: 'K', onToggle: () => setK(K.value !== 1) });
    sch.switch(J, [60, 200], { label: 'J', onToggle: () => setJ(J.value !== 1) });
    sch.switch(CLK, [60, 135], { label: 'CLK', momentary: true });
    d.add(sch.autoUpdate());

    // ---- widgets ----
    const rec = netRecorder([CLK, P, J, K, Q], WINDOW);
    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'P (edge pulse)', color: '#94a3b8' },
        { label: 'J', color: '#fbbf24' },
        { label: 'K', color: '#c084fc' },
        { label: 'Q', color: '#f87171' },
      ],
      { width: 640, laneHeight: 40 },
    );
    const tt = truthTable(['J', 'K', 'Q after the edge', ''], JK_ROWS);
    const status = callout();
    const kv = readouts(['clock edges', 'Q rising edges', 'Q frequency']);
    const setJ = (v: boolean) => { c.set(J, v ? 1 : 0); jToggle.set(v); };
    const setK = (v: boolean) => { c.set(K, v ? 1 : 0); kToggle.set(v); };
    const jToggle = new Toggle({ label: 'J', onChange: setJ });
    const kToggle = new Toggle({ label: 'K', onChange: setK });
    const clkBtn = new Button({ label: 'Clock pulse', kind: 'primary', onPress: () => c.set(CLK, 1), onRelease: () => c.set(CLK, 0) });
    const autoToggle = new Toggle({ label: 'Auto clock', onChange: (v) => { auto = v; if (!v) c.set(CLK, 0); } });
    const fbToggle = new Toggle({
      label: 'Feedback wires (JK)',
      value: true,
      onChange: (v) => {
        c.set(FB, v ? 1 : 0);
        for (const el of drawing.feedback) el.style.opacity = v ? '' : '0.15';
      },
    });
    const slowToggle = new Toggle({ label: 'Slow motion', onChange: (v) => (slow = v) });
    const toggleDemo = new Button({
      label: 'Toggle mode: divide by two',
      onClick: () => {
        setJ(true);
        setK(true);
        auto = true;
        autoToggle.set(true);
        clkRises = [];
        qRises = [];
      },
    });

    const update = () => {
      const r = jkRow(J.value, K.value);
      tt.set(r);
      const fb = FB.value === 1;
      const recent = (a: number[]) => a.filter((t) => c.time - t <= WINDOW).length;
      const nc = recent(clkRises), nq = recent(qRises);
      kv.set('clock edges', `${nc} in the window`);
      kv.set('Q rising edges', `${nq} in the window`);
      kv.set('Q frequency', nc >= 2 && r === 3 && fb ? `CLK ÷ ${(nc / Math.max(1, nq)).toFixed(1)}` : '—');
      let msg: string;
      if (!fb && c.time - invalidAt < 200) msg = 'Without the feedback wires this is just an SR flip-flop: J = K = 1 makes S = R = 1 during the pulse, which forces Q and Q̅ both low. When the pulse ends both inputs drop together and the latch falls into a random state. That is the invalid state the feedback removes.';
      else if (c.time - resolvedAt < 150) msg = 'The latch was left between states and settled randomly.';
      else if (clkRises.length && c.time - clkRises[clkRises.length - 1] < 40 && !auto) msg = `Clock edge: the RC edge detector made a pulse ${PULSE} gate delays long. During it only one AND gate can fire: S needs Q̅ = 1 and R needs Q = 1, so only the input that would change Q gets through. Now Q = ${Q.value}.`;
      else if (r === 0) msg = `J = K = 0: neither AND gate can fire, so Q stays ${Q.value} on every clock edge.`;
      else if (r === 1) msg = `K = 1: on the next clock edge R = K·P·Q resets Q to 0 (if it is already 0, the AND gate is blocked by Q = 0 and nothing happens). Q = ${Q.value}.`;
      else if (r === 2) msg = `J = 1: on the next clock edge S = J·P·Q̅ sets Q to 1 (if it is already 1, Q̅ = 0 blocks the gate). Q = ${Q.value}.`;
      else if (fb) msg = `J = K = 1: toggle mode. Q = ${Q.value}, so ${Q.value ? 'R' : 'S'} will fire on the next edge and Q becomes ${Q.value ? 0 : 1}. Q changes once per clock cycle, so it runs at half the clock frequency.`;
      else msg = 'J = K = 1 with the feedback removed: the next clock edge makes S = R = 1 (invalid).';
      setText(status, msg);
    };

    d.add(
      stepLoop({
        rate: () => RATE,
        slow: () => slow,
        step: () => {
          if (auto && ++phase >= half) {
            phase = 0;
            c.set(CLK, CLK.value === 1 ? 0 : 1);
          }
          c.step();
          if (guard.check()) resolvedAt = c.time;
          if (jk.S.value === 1 && jk.R.value === 1) invalidAt = c.time;
          const clk = CLK.value === 1 ? 1 : 0;
          if (clk && !prevClk) clkRises.push(c.time);
          if (Q.value === 1 && prevQ !== 1) qRises.push(c.time);
          prevClk = clk;
          prevQ = Q.value;
          if (clkRises.length > 64) clkRises.shift();
          if (qRises.length > 64) qRises.shift();
          rec.sample();
        },
        frame: () => {
          scope.draw(rec.samples, { window: WINDOW });
          update();
        },
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Edge-triggered JK flip-flop',
          { accent: 'red', chips: '74LS02 (NOR latch) · 74LS11 (3-input AND) · RC edge detector on the clock' },
          sch.el,
          row(jToggle.el, kToggle.el, clkBtn.el, autoToggle.el),
          row(toggleDemo.el, fbToggle.el, slowToggle.el),
          note('Hold CLK in the drawing or use Clock pulse. K is on top because R resets the top gate (Q), as in the SR latch lab. The edge pulse here is an ideal 2 gate delays; the next video shows what happens with a real RC pulse.'),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Truth table', { accent: 'gray' }, tt.el, status, note('Characteristic equation: Q⁺ = J·Q̅ + K̅·Q. J and K are just S and R renamed.')),
          panel('Timing diagram', { accent: 'gray' }, scope.el, kv.el),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
