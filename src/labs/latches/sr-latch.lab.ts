import { Circuit, Trace } from '../../logic/circuit';
import { Button, Scope, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, animate, h, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';

/**
 * Reference lab (gate level): two cross-coupled NOR gates.
 * Pattern used by the other gate-level labs:
 *   Circuit (logic) -> Schematic (live drawing) -> Trace + Scope (timing
 *   diagram) -> truth table highlighting the current row.
 * Time keeps flowing (a few gate delays per frame) so the timing diagram
 * scrolls like a logic analyser; "slow motion" shows one gate delay at a time.
 */
export default defineLab({
  id: 'sr-latch',
  title: 'SR latch',
  summary:
    'Feed the output of each NOR gate back into the other and you get a circuit that remembers one bit. S (set) makes Q high, R (reset) makes it low, and with both inputs low the latch holds its state. Turn on slow motion to watch the change travel through the gates one delay at a time.',
  mount(root) {
    const d = new Disposer();
    const c = new Circuit();
    const R = c.input('R', 0);
    const S = c.input('S', 0);
    const Q = c.net('Q', 0);
    const Qn = c.net('Q̅', 1);
    c.nor([R, Qn], Q, 1);
    c.nor([Q, S], Qn, 1);
    c.settle();

    // ---- schematic ----
    const sch = new Schematic(c, { width: 540, height: 250 });
    const g1 = sch.gate('NOR', { x: 220, y: 80 }, { label: 'NOR', output: Q });
    const g2 = sch.gate('NOR', { x: 220, y: 180 }, { label: 'NOR', output: Qn });
    sch.wire(R, [70, g1.inputs[0].y], g1.inputs[0]);
    sch.wire(S, [70, g2.inputs[1].y], g2.inputs[1]);
    sch.wire(Q, g1.output, [450, 80]);
    sch.wire(Qn, g2.output, [450, 180]);
    // cross-coupled feedback
    sch.wire(Q, [310, 80], [310, 110], [180, 150], [180, g2.inputs[0].y], g2.inputs[0]);
    sch.wire(Qn, [330, 180], [330, 150], [195, 110], [195, g1.inputs[1].y], g1.inputs[1]);
    sch.dot(Q, [310, 80]);
    sch.dot(Qn, [330, 180]);
    let slow = false;
    sch.switch(R, [70, g1.inputs[0].y], { label: 'R', onToggle: (n) => c.toggle(n) });
    sch.switch(S, [70, g2.inputs[1].y], { label: 'S', onToggle: (n) => c.toggle(n) });
    sch.probe(Q, [460, 80], { label: 'Q', color: 'red' });
    sch.probe(Qn, [460, 180], { label: 'Q̅', color: 'red' });
    d.add(sch.autoUpdate());

    // ---- timing diagram ----
    const trace = new Trace([S, R, Q, Qn], 240);
    const scope = new Scope(
      [
        { label: 'S', color: '#fbbf24' },
        { label: 'R', color: '#60a5fa' },
        { label: 'Q', color: '#f87171' },
        { label: 'Q̅', color: '#f472b6' },
      ],
      { width: 640, laneHeight: 40 },
    );

    // ---- truth table ----
    const rows: [string, string, string, string][] = [
      ['0', '0', 'Q', 'hold (remember)'],
      ['0', '1', '0', 'reset'],
      ['1', '0', '1', 'set'],
      ['1', '1', '0*', 'invalid: Q = Q̅ = 0'],
    ];
    const trs = rows.map((r) => h('tr', null, r.map((x) => h('td', null, x))));
    const table = h('table', { class: 'truth-table' }, h('thead', null, h('tr', null, ['S', 'R', 'Q', ''].map((x) => h('th', null, x)))), h('tbody', null, trs));

    const status = h('div', { class: 'callout' });
    const slowToggle = new Toggle({ label: 'Slow motion (one gate delay per step)', onChange: (v) => (slow = v) });
    const powerCycle = new Button({
      label: 'Power on randomly',
      title: 'On power-up Q starts in whatever state wins the race',
      onClick: () => {
        const q = Math.random() < 0.5 ? 0 : 1;
        Q.value = q;
        Qn.value = q ? 0 : 1;
        c.set(R, 0);
        c.set(S, 0);
        for (const comp of c.components) for (const drv of comp.drivers) drv.value = drv.pending = drv.net.value;
        sch.update();
      },
    });
    const bothOff = new Button({
      label: 'Release S and R together',
      title: 'From S=R=1, drop both inputs at the same instant',
      onClick: () => {
        c.set(S, 0);
        c.set(R, 0);
      },
    });

    const update = () => {
      const s = S.value, r = R.value;
      const idx = s === 0 && r === 0 ? 0 : s === 0 ? 1 : r === 0 ? 2 : 3;
      trs.forEach((tr, i) => setClass(tr, 'current', i === idx));
      const osc = !c.idle && recentChanges > 6;
      setText(
        status,
        osc
          ? 'Both gates keep switching each other. With identical gate delays the latch oscillates. Real gates are never exactly equal, so one of them wins the race and the result is unpredictable. That is why S = R = 1 is avoided.'
          : idx === 3
            ? 'S and R are both high, so both outputs are forced low. Q̅ is no longer the inverse of Q.'
            : `Q = ${Q.value}. ${idx === 0 ? 'Both inputs are low, so the latch remembers its last state.' : idx === 1 ? 'R pulls Q low.' : 'S pulls Q high.'}`,
      );
    };

    // ---- first try in the video: an OR gate fed back to itself (74LS32) ----
    const co = new Circuit();
    const BTN = co.input('button', 0);
    const OUT = co.net('OR out', 0);
    co.or([BTN, OUT], OUT, 1);
    co.settle();
    const orSch = new Schematic(co, { width: 300, height: 112 });
    const gOr = orSch.gate('OR', { x: 130, y: 50 }, { label: '74LS32', output: OUT });
    orSch.wire(BTN, [70, gOr.inputs[0].y], gOr.inputs[0]);
    orSch.wire(OUT, gOr.output, [250, 50]);
    orSch.wire(OUT, [212, 50], [212, 96], [104, 96], [104, gOr.inputs[1].y], gOr.inputs[1]);
    orSch.dot(OUT, [212, 50]);
    orSch.probe(OUT, [258, 50], { label: 'out', color: 'red' });
    const orStatus = h('div', { class: 'callout' });
    const renderOr = () =>
      setText(
        orStatus,
        OUT.value === 1
          ? BTN.value === 1
            ? 'The button makes one OR input high, so the output goes high, and the output is wired back to the other input.'
            : 'Button released, but the output stays high: its own output keeps one OR input at 1. Nothing can turn it off except removing power. That is why Ben switches to two NOR gates with separate set and reset inputs.'
          : 'Press the button: the OR gate output goes high and feeds itself.',
      );
    orSch.switch(BTN, [70, gOr.inputs[0].y], { label: 'press', momentary: true, onToggle: (n) => { co.toggle(n); co.settle(); renderOr(); } });
    d.add(orSch.autoUpdate());
    const orPower = new Button({
      label: 'Remove power',
      title: 'The only way to reset it',
      onClick: () => {
        OUT.value = 0;
        for (const comp of co.components) for (const drv of comp.drivers) drv.value = drv.pending = drv.net.value;
        co.settle();
        orSch.update();
        renderOr();
      },
    });
    renderOr();

    // ---- time ----
    let acc = 0;
    let recentChanges = 0;
    let lastQ = Q.value;
    d.add(
      animate((dt) => {
        acc += dt;
        const stepMs = slow ? 350 : 1000 / 240;
        let n = 0;
        while (acc >= stepMs && n < 8) {
          acc -= stepMs;
          c.step();
          trace.sample(c.time);
          if (Q.value !== lastQ) recentChanges++;
          else recentChanges = Math.max(0, recentChanges - 0.05);
          lastQ = Q.value;
          n++;
        }
        if (acc > stepMs * 8) acc = 0;
        scope.draw(trace.samples, { window: 240 });
        update();
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Circuit', { accent: 'red', chips: '74LS02 (quad NOR)' }, sch.el, row(slowToggle.el), row(powerCycle.el, bothOff.el), note('Click S or R to toggle them. Wire colours: red = high, blue = low.')),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Truth table', { accent: 'gray' }, table, status),
          panel('Timing diagram', { accent: 'gray' }, scope.el),
          panel('First try: an OR gate fed back to itself', { accent: 'gray', chips: '74LS32 (quad OR)' }, orSch.el, row(orPower.el), orStatus),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
