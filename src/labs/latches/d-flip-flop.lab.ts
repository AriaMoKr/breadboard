import { Circuit, type Level } from '../../logic/circuit';
import { Button, Led, Scope, Slider, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { MetastabilityGuard, Recorder, callout, dLatch, drawDLatch, edgePulse, gateDelayEdgeDetectors, rcEdgeVoltage, stepLoop } from './_shared';

const RATE = 150;
const WINDOW = 450;

export default defineLab({
  id: 'd-flip-flop',
  title: 'D flip-flop',
  summary:
    'A D latch is transparent the whole time its enable is high. To capture D only at one instant, Ben feeds the enable from an edge detector that turns each rising clock edge into a short pulse. He shows two: the clock ANDed with a delayed, inverted copy of itself, and the one he builds, a 0.1 µF capacitor in series with the clock and a 1 kΩ resistor to ground. The result is a D flip-flop that changes only on the rising edge of the clock. Compare it with a plain latch fed the same D and clock.',
  mount(root) {
    const d = new Disposer();
    const c = new Circuit();
    const D = c.input('D', 0);
    const CLK = c.input('CLK', 0);
    const P = c.net('pulse', 0);
    let width = 3;
    edgePulse(c, CLK, P, () => width, 'RC');
    const ff = dLatch(c, D, P, 'ff'); // edge-triggered
    const lat = dLatch(c, D, CLK, 'lat'); // level-sensitive, for comparison
    const gd = gateDelayEdgeDetectors(c, CLK, [1, 3, 5]); // the gate-delay edge detector, for comparison
    c.settle();
    const guard = new MetastabilityGuard(c, ff.latch, ff.S, ff.R);

    let slow = false;
    let auto = false;
    let half = 60;
    let phase = 0;
    let wiggle = false;
    let wigglePhase = 0;
    let vrc = 0;
    let prevClk = 0;
    let dChangedInPulseAt = -1e9;
    let resolvedAt = -1e9;
    let lastEdgeD: number | null = null;
    let lastEdgeAt = -1e9;

    // ---- schematic ----
    const sch = new Schematic(c, { width: 590, height: 270 });
    drawDLatch(sch, { D, E: P, Dn: ff.Dn, S: ff.S, R: ff.R, Q: ff.latch.Q, Qn: ff.latch.Qn }, { eFromX: 207, eLabel: 'P' });
    sch.chip([125, 122], { label: 'RC', sublabel: '0.1µF 1kΩ', width: 70, height: 36, left: [{ name: '', net: CLK }], right: [{ name: '', net: P }] });
    sch.wire(CLK, [60, 140], [113, 140]);
    sch.text('pulse P', [207, 128], { anchor: 'start', size: 10, class: 'gate-label' });
    sch.switch(D, [60, 212.5], { label: 'D', onToggle: () => setD(D.value !== 1) });
    sch.switch(CLK, [60, 140], { label: 'CLK', momentary: true });
    d.add(sch.autoUpdate());

    // ---- widgets ----
    const rec = new Recorder([() => D.value, () => CLK.value, () => P.value, () => lat.latch.Q.value, () => ff.latch.Q.value], WINDOW);
    const scope = new Scope(
      [
        { label: 'D', color: '#fbbf24' },
        { label: 'CLK', color: '#60a5fa' },
        { label: 'edge pulse P (flip-flop enable)', color: '#94a3b8' },
        { label: 'Q of a plain D latch (E = CLK)', color: '#f472b6' },
        { label: 'Q of the D flip-flop', color: '#f87171' },
      ],
      { width: 640, laneHeight: 40 },
    );
    const rcRec = new Recorder([() => CLK.value, () => vrc], WINDOW);

    // ---- the gate-delay edge detector: CLK AND (CLK through 1, 3 or 5 inverters) ----
    const GD_PRE = 4, GD_POST = 22;
    const gdRec = new Recorder([() => CLK.value, () => gd.chain[2].value, ...gd.pulses.map((p) => () => p.value)], GD_PRE + GD_POST);
    let gdShot: (Level | number)[][] | null = null;
    let gdCaptureAt = -1;
    const gdScope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'CLK after 3 inverters', color: '#c084fc' },
        { label: 'AND output, 1 inverter', color: '#4ade80' },
        { label: 'AND output, 3 inverters', color: '#4ade80' },
        { label: 'AND output, 5 inverters', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 32 },
    );
    const gdText = h('div', { class: 'mono small' }, 'Clock the flip-flop to capture a rising edge here.');
    const gsch = new Schematic(c, { width: 440, height: 118 });
    {
      const gAnd = gsch.gate('AND', [360, 47.5], { label: '74LS08', output: gd.pulses[1] });
      const inv = [100, 180, 260].map((x, i) => gsch.gate('NOT', [x, 85], { label: '74LS04', output: gd.chain[i] }));
      gsch.text('CLK', [34, 40], { anchor: 'end', size: 12 });
      gsch.wire(CLK, [40, 40], gAnd.inputs[0]);
      gsch.wire(CLK, [60, 40], [60, 85], inv[0].inputs[0]);
      gsch.dot(CLK, [60, 40]);
      gsch.wire(gd.chain[0], inv[0].output, inv[1].inputs[0]);
      gsch.wire(gd.chain[1], inv[1].output, inv[2].inputs[0]);
      gsch.wire(gd.chain[2], inv[2].output, [330, 85], [330, gAnd.inputs[1].y], gAnd.inputs[1]);
      gsch.wire(gd.pulses[1], gAnd.output, [414, 47.5]);
      gsch.probe(gd.pulses[1], [422, 47.5], { label: 'P', color: 'yellow', labelSide: 'top' });
      d.add(gsch.autoUpdate());
    }
    const rcScope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'V across the 1 kΩ (RC differentiator)', kind: 'analog', min: -5.5, max: 5.5, guides: [2, 0], color: '#f59e0b' },
      ],
      { width: 640, laneHeight: 56 },
    );
    const status = callout();
    const ledLatch = new Led('red', 'D latch Q');
    const ledFF = new Led('red', 'D flip-flop Q');

    const setD = (v: boolean) => {
      c.set(D, v ? 1 : 0);
      dToggle.set(v);
    };
    const dToggle = new Toggle({ label: 'D', onChange: setD });
    const clkBtn = new Button({ label: 'Clock pulse', kind: 'primary', onPress: () => c.set(CLK, 1), onRelease: () => c.set(CLK, 0) });
    const autoToggle = new Toggle({ label: 'Auto clock', onChange: (v) => { auto = v; if (!v) c.set(CLK, 0); } });
    const wiggleToggle = new Toggle({ label: 'Wiggle D', onChange: (v) => (wiggle = v) });
    const slowToggle = new Toggle({ label: 'Slow motion', onChange: (v) => (slow = v) });
    const widthSlider = new Slider({ label: 'Pulse width', min: 1, max: 60, step: 1, value: width, format: (v) => `${v} gate delays`, onInput: (v) => (width = v) });
    const speedSlider = new Slider({ label: 'Clock period', min: 40, max: 300, step: 10, value: half * 2, format: (v) => `${v} delays`, onInput: (v) => (half = Math.round(v / 2)) });

    const update = () => {
      ledLatch.set(lat.latch.Q.value);
      ledFF.set(ff.latch.Q.value);
      const q = ff.latch.Q.value;
      let msg: string;
      if (c.time - resolvedAt < 150) msg = `A ${width}-gate-delay pulse is shorter than the latch's own feedback loop (2 gate delays), so the latch could not settle and ended up in a random state (metastability). Real edge detectors must be short, but not that short.`;
      else if (c.time - dChangedInPulseAt < 200) msg = `D changed while the enable pulse was still high, and Q followed it. With a ${width}-delay pulse the flip-flop behaves like a latch again: the pulse must be short compared with how fast D can change.`;
      else if (auto) msg = `Auto clock: the flip-flop's Q (bottom lane) changes only just after rising clock edges, taking the value D had at that instant. The plain latch's Q copies D during every high half of the clock. Turn on Wiggle D to see the difference${width > 12 ? ', and note that this pulse is long enough for D to sneak through' : ''}.`;
      else if (c.time - lastEdgeAt < 70) msg = `Rising edge! The RC differentiator turned it into a pulse ${width} gate delays long. While it lasted, the latch inside was open and copied D = ${lastEdgeD}, so Q = ${q}.`;
      else if (CLK.value === 1) msg = `CLK is still high but the pulse is over, so the flip-flop ignores D and holds Q = ${q}. The plain latch (E = CLK) stays transparent the whole time CLK is high and follows D.`;
      else msg = `Between clock edges the flip-flop holds Q = ${q}${lastEdgeD !== null ? `, the value D had at the last rising edge` : ''}. It looks at D only at the instant CLK rises. The plain latch would follow D whenever CLK is high.`;
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
          if (wiggle && ++wigglePhase >= 17) {
            wigglePhase = 0;
            setD(D.value !== 1);
            if (P.value === 1) dChangedInPulseAt = c.time;
          }
          const clk = CLK.value === 1 ? 1 : 0;
          const rose = clk === 1 && prevClk === 0;
          if (rose) {
            lastEdgeD = D.value === 1 ? 1 : 0;
            lastEdgeAt = c.time;
          }
          vrc = rcEdgeVoltage(vrc, clk - prevClk, width);
          prevClk = clk;
          c.step();
          if (guard.check()) resolvedAt = c.time;
          rec.sample();
          rcRec.sample();
          gdRec.sample();
          if (rose) gdCaptureAt = c.time + GD_POST - 1;
          if (gdCaptureAt >= 0 && c.time >= gdCaptureAt) {
            gdCaptureAt = -1;
            gdShot = gdRec.samples.map((lane) => [...lane]);
            const widths = gdShot.slice(2).map((lane) => lane.filter((v) => v === 1).length);
            setText(gdText, `Last rising edge: pulses ${widths.join(', ')} gate delays long with 1, 3 and 5 inverters. The falling edge gives none.`);
          }
        },
        frame: () => {
          scope.draw(rec.samples, { window: WINDOW });
          rcScope.draw(rcRec.samples, { window: WINDOW });
          if (gdShot) gdScope.draw(gdShot, { window: GD_PRE + GD_POST });
          update();
        },
      }),
    );
    // D changed by hand during a pulse
    d.add(c.onChange(() => {
      if (P.value === 1 && D.value !== (lastEdgeD ?? D.value)) dChangedInPulseAt = c.time;
    }));

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'D flip-flop: D latch + RC edge detector',
          { accent: 'red', chips: '74LS02 · 74LS08 · 0.1 µF + 1 kΩ edge detector (τ = RC = 100 µs)' },
          sch.el,
          row(dToggle.el, clkBtn.el, autoToggle.el, wiggleToggle.el),
          row(widthSlider.el),
          row(speedSlider.el, slowToggle.el),
          row(ledLatch.el, h('span', { class: 'small' }, 'plain latch Q'), ledFF.el, h('span', { class: 'small' }, 'flip-flop Q')),
          note('Hold CLK in the drawing or use the Clock pulse button. On real chips the edge-triggered D flip-flop is the 74LS74; the computer’s registers will use the 74LS173, which has four of them plus enables.'),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('What is happening', { accent: 'gray' }, status),
          panel('Latch vs flip-flop, same D and CLK', { accent: 'gray' }, scope.el, note('Turn on Wiggle D and the auto clock: the latch output copies D during every high half of the clock, the flip-flop output only changes right after rising edges. Then widen the pulse to 30+ gate delays and the flip-flop starts following D during the pulse, like a latch.')),
          panel(
            'Gate-delay edge detector',
            { accent: 'gray', chips: '74LS04 inverters + 74LS08 AND', subtitle: 'single shot at each rising edge' },
            gsch.el,
            gdScope.el,
            gdText,
            note('The first edge detector Ben shows: AND the clock with an inverted copy of itself. The inverters are slightly slow, so for a moment after CLK rises both AND inputs are high and a pulse a few nanoseconds wide comes out. Chaining more inverters (an odd number) makes it longer. It is tiny and depends on the chips, so on the breadboard he uses the RC version below.'),
          ),
          panel('The RC differentiator', { accent: 'gray' }, rcScope.el, note('The capacitor passes changes, not levels: the voltage across the resistor jumps to +5 V on a rising edge and decays as the capacitor charges (V = 5·e^(−t/RC)), and it swings to −5 V on a falling edge. Only the part above about 2 V (dashed line, a TTL high) enables the latch. The negative spike is harmless. Sketch only: the time scale is gate delays, not microseconds.')),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
