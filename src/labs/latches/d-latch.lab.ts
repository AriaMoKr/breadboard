import { Circuit } from '../../logic/circuit';
import { Button, Scope, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { MetastabilityGuard, Timeline, callout, dLatch, dLatchRow, drawDLatch, netRecorder, stepLoop, truthTable } from './_shared';

const RATE = 150;
const WINDOW = 360;

export default defineLab({
  id: 'd-latch',
  title: 'D latch',
  summary:
    'Add two AND gates in front of an SR latch and it only listens while the enable input E is high. Then derive S and R from a single data input D (R through an inverter, a NOR gate with both inputs tied together), so S and R can never both be 1. While E is high, Q follows D (the latch is transparent). When E goes low, Q holds the last value.',
  mount(root) {
    const d = new Disposer();
    const c = new Circuit();
    const D = c.input('D', 0);
    const E = c.input('E', 0);
    const dl = dLatch(c, D, E);
    const { Q, Qn } = dl.latch;
    c.settle();
    const guard = new MetastabilityGuard(c, dl.latch, dl.S, dl.R);

    let slow = false;
    let resolvedAt = -1e9;
    const tl = new Timeline();

    // ---- schematic ----
    const sch = new Schematic(c, { width: 590, height: 270 });
    drawDLatch(sch, { D, E, Dn: dl.Dn, S: dl.S, R: dl.R, Q, Qn }, { eFromX: 60 });
    sch.switch(D, [60, 212.5], { label: 'D', onToggle: () => setD(D.value !== 1) });
    sch.switch(E, [60, 140], { label: 'E', onToggle: () => setE(E.value !== 1) });
    d.add(sch.autoUpdate());

    // ---- widgets ----
    const rec = netRecorder([D, E, dl.S, dl.R, Q], WINDOW);
    const scope = new Scope(
      [
        { label: 'D', color: '#fbbf24' },
        { label: 'E (enable)', color: '#60a5fa' },
        { label: 'S = D·E', color: '#4ade80' },
        { label: 'R = D̅·E', color: '#c084fc' },
        { label: 'Q', color: '#f87171' },
      ],
      { width: 640, laneHeight: 40 },
    );
    const tt = truthTable(
      ['E', 'D', 'Q', ''],
      [
        ['0', 'x', 'Q', 'hold: D is ignored'],
        ['1', '0', '0', 'transparent: Q = D'],
        ['1', '1', '1', 'transparent: Q = D'],
      ],
    );
    const status = callout();
    const setD = (v: boolean) => {
      c.set(D, v ? 1 : 0);
      dToggle.set(v);
    };
    const setE = (v: boolean) => {
      c.set(E, v ? 1 : 0);
      eToggle.set(v);
    };
    const dToggle = new Toggle({ label: 'D (data)', onChange: setD });
    const eToggle = new Toggle({ label: 'E (enable)', onChange: setE });
    const slowToggle = new Toggle({ label: 'Slow motion (one gate delay per step)', onChange: (v) => (slow = v) });
    const wiggle = new Button({
      label: 'Wiggle D while enabled',
      onClick: () => {
        tl.clear();
        const t = c.time;
        setE(true);
        for (let i = 1; i <= 4; i++) tl.at(t + i * 25, () => setD(D.value !== 1));
        tl.at(t + 125, () => setE(false));
        for (let i = 0; i < 4; i++) tl.at(t + 150 + i * 25, () => setD(D.value !== 1));
      },
    });

    const update = () => {
      const row_ = dLatchRow(D.value, E.value);
      tt.set(row_);
      const moving = !c.idle;
      let msg: string;
      if (guard.resolved && c.time - resolvedAt < 120) msg = 'S and R changed at the same instant and the latch hesitated before settling (metastability).';
      else if (moving) msg = 'The change is still travelling through the gates (turn on slow motion to follow it one gate delay at a time).';
      else if (row_ === 0) msg = `E is low, so both AND gates output 0: S = R = 0 and the latch holds Q = ${Q.value}. Flip D as much as you like: nothing happens.`;
      else if (row_ === 2) msg = 'E is high and D = 1: S = D·E = 1 sets the latch, so Q = 1. The latch is transparent: Q follows D.';
      else msg = 'E is high and D = 0: the inverter makes D̅ = 1, so R = D̅·E = 1 resets the latch and Q = 0. Because R comes from D through the inverter, S and R are never both 1.';
      if (tl.busy) msg = `Demo: ${E.value === 1 ? 'E is high, so Q follows every wiggle of D.' : 'E is low now, so the latch keeps the last value of D and ignores the wiggles.'}`;
      setText(status, msg);
    };

    d.add(
      stepLoop({
        rate: () => RATE,
        slow: () => slow,
        step: () => {
          tl.run(c.time + 1);
          c.step();
          if (guard.check()) resolvedAt = c.time;
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
          'Circuit',
          { accent: 'red', chips: '74LS02 (NOR latch and the NOR used as an inverter) · 74LS08 (AND)' },
          sch.el,
          row(dToggle.el, eToggle.el),
          row(wiggle.el, slowToggle.el),
          note('Click D or E in the drawing to flip them. Red wire = 1, blue wire = 0.'),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Truth table', { accent: 'gray' }, tt.el, status),
          panel('Timing diagram', { accent: 'gray' }, scope.el, note('Try “Wiggle D while enabled”: while E is high Q copies D; after E drops, Q stays put. The inverter is a NOR gate with both inputs tied together: NOR(D, D) = NOT D.')),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
