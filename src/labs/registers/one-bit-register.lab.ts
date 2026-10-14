import { Trace } from '../../logic/circuit';
import { Button, Scope, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, s, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { buildOneBitRegister } from './_model';
import { labFrame, levelLegend, mirrorGate, runCircuit, truthTable } from './_shared';

/**
 * Video 11 — "Designing and building a 1-bit register".
 * D = (BUS AND LOAD) OR (Q AND NOT LOAD) into a 74LS74 D flip-flop, and Q back
 * to the bus through a tri-state buffer controlled by ENABLE.
 */
export default defineLab({
  id: 'one-bit-register',
  title: 'A 1-bit register',
  summary:
    'A D flip-flop stores whatever is on D at every rising clock edge. The computer’s clock never stops, so to make it remember, Ben puts a 2:1 multiplexer in front of D built from AND, OR and NOT gates: with LOAD high, D comes from the bus; with LOAD low, D comes from the flip-flop’s own Q, so each clock edge just stores the same bit again. A tri-state buffer with ENABLE puts Q back on the bus. Try clocking with LOAD off and see that Q never changes.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d);

    // ---- circuit ----
    const { c, BUSIN, BUSDRV, LOAD, EN, CLK, BUS, NLOAD, AND1, AND2, D, Q, QN } = buildOneBitRegister();

    // ---- schematic ----
    const sch = new Schematic(c, { width: 620, height: 322 });
    sch.el.querySelector('.sch-wires')!.before(s('rect', { x: 186, y: 64, width: 240, height: 152, rx: 8, style: 'fill:none;stroke:var(--fg-faint);stroke-dasharray:5 5' }));
    // the other module on the bus
    const tOther = sch.gate('TRI', { x: 70, y: 60 }, { output: BUS });
    sch.wire(BUSIN, [60, 60], tOther.inputs[0]);
    sch.wire(BUSDRV, [60, 26], [tOther.enable!.x, 26], tOther.enable!);
    sch.wire(BUS, tOther.output, [120, 60]);
    // bus line
    sch.wire(BUS, [120, 60], [120, 292]);
    sch.probe(BUS, [120, 304], { label: 'bus bit', color: 'red' });
    // mux
    const and1 = sch.gate('AND', { x: 230, y: 90 }, { label: '74LS08', output: AND1 });
    const not1 = sch.gate('NOT', { x: 205, y: 190 }, { label: '74LS04', output: NLOAD });
    const and2 = sch.gate('AND', { x: 280, y: 175 }, { label: '74LS08', output: AND2 });
    const or1 = sch.gate('OR', { x: 360, y: 130 }, { label: '74LS32', output: D });
    sch.wire(BUS, [120, and1.inputs[0].y], and1.inputs[0]);
    sch.dot(BUS, [120, and1.inputs[0].y]);
    sch.wire(LOAD, [182, 125], [190, 125], [190, and1.inputs[1].y], and1.inputs[1]);
    sch.wire(LOAD, [190, 125], [190, 190], not1.inputs[0]);
    sch.dot(LOAD, [190, 125]);
    sch.wire(NLOAD, not1.output, [262, 190], [262, and2.inputs[1].y], and2.inputs[1]);
    sch.wire(AND1, and1.output, [315, 90], [315, or1.inputs[0].y], or1.inputs[0]);
    sch.wire(AND2, and2.output, [340, 175], [340, or1.inputs[1].y], or1.inputs[1]);
    // flip-flop
    const ff = sch.chip({ x: 460, y: 100 }, { label: '74LS74', sublabel: 'D flip-flop', width: 80, height: 90, left: [{ name: 'D', net: D }, { name: 'CLK ▷', net: CLK }], right: [{ name: 'Q', net: Q }, { name: 'Q̅', net: QN }] });
    sch.wire(D, or1.output, ff.left[0]);
    sch.wire(CLK, [440, 236], [440, ff.left[1].y], ff.left[1]);
    // Q: LED, feedback into the mux, and the output buffer
    sch.wire(Q, ff.right[0], [598, 130]);
    sch.dot(Q, [572, 130]);
    sch.probe(Q, [598, 130], { label: 'Q', color: 'red', labelSide: 'top' });
    // feedback into the hold AND gate: down between the two AND gates, not through AND1
    sch.wire(Q, [572, 130], [572, 48], [300, 48], [300, 152], [265, 152], [265, and2.inputs[0].y], and2.inputs[0]);
    sch.wire(Q, [572, 130], [572, 282], [260, 282]);
    const tOut = mirrorGate(sch.gate('TRI', { x: 250, y: 282 }, { output: BUS }), { x: 250, y: 282 });
    sch.wire(BUS, tOut.output, [120, 282]);
    sch.dot(BUS, [120, 282]);
    sch.wire(EN, [205, 252], [tOut.enable!.x, 252], tOut.enable!);
    sch.text('tri-state buffer', [232, 306], { size: 10, class: 'gate-label' });
    sch.text('another module', [68, 88], { size: 10, class: 'gate-label' });
    sch.text('BUS', [134, 72], { size: 11, anchor: 'start' });
    const muxText = sch.text('', [304, 228], { size: 11 });
    // switches
    sch.switch(BUSIN, [60, 60], { label: 'in', onToggle: (n) => c.toggle(n) });
    sch.switch(BUSDRV, [60, 26], { label: 'en', onToggle: (n) => c.toggle(n) });
    sch.switch(LOAD, [182, 125], { label: 'LOAD', onToggle: (n) => c.toggle(n) });
    sch.switch(EN, [205, 252], { label: 'ENABLE', onToggle: (n) => c.toggle(n) });
    sch.switch(CLK, [440, 236], { label: 'CLK', momentary: true, onToggle: (n) => c.toggle(n) });
    d.add(sch.autoUpdate());

    // ---- timing ----
    const WINDOW = 320;
    const trace = new Trace([CLK, LOAD, BUS, D, Q, EN], WINDOW);
    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'LOAD', color: '#fbbf24' },
        { label: 'BUS', color: '#f87171' },
        { label: 'D', color: '#a78bfa' },
        { label: 'Q', color: '#f472b6' },
        { label: 'ENABLE', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 32 },
    );

    // ---- truth table for the mux ----
    const tt = truthTable(['LOAD', 'D comes from', 'on the clock edge'], [
      ['0', 'Q (feedback)', 'hold: store Q again'],
      ['1', 'BUS', 'load the bus bit'],
    ]);

    // ---- controls ----
    let slow = false;
    let auto = false;
    let autoCount = 0;
    const slowT = new Toggle({ label: 'Slow motion (one gate delay per step)', onChange: (v) => (slow = v) });
    const autoT = new Toggle({ label: 'Clock running (like Ben’s clock module)', onChange: (v) => { auto = v; autoCount = 0; if (!v && CLK.value === 1) c.set(CLK, 0); } });
    const pulseBtn = new Button({ label: 'Clock pulse', kind: 'primary', title: 'Hold for a long pulse', onPress: () => c.set(CLK, 1), onRelease: () => c.set(CLK, 0) });
    const status = h('div', { class: 'callout' });
    const holdText = h('div', { class: 'mono small dim' });

    let lastClk = CLK.value;
    let edges = 0;
    let heldEdges = 0;

    const update = () => {
      const load = LOAD.value === 1;
      tt.highlight(load ? 1 : 0);
      setText(muxText, load ? 'mux: D ← BUS (load)' : 'mux: D ← Q (hold)');
      const busX = BUS.value === 'X';
      const floating = BUSDRV.value === 0 && EN.value === 0;
      setClass(status, 'warn', busX);
      const parts: string[] = [];
      if (busX) parts.push('Contention! The other module and this register’s buffer are both driving the bus with different values. Turn off the other module (en) or ENABLE.');
      if (load) parts.push(`LOAD is high: the top AND gate passes the bus bit to D and the bottom one is blocked, so D = ${D.value}. The next rising clock edge stores it in the flip-flop.`);
      else parts.push(`LOAD is low: the bottom AND gate feeds Q back into D, so every clock edge stores the same bit again. Q = ${Q.value} is held.`);
      if (floating && load) parts.push('Nothing is driving the bus, so the AND gate’s input floats, and a floating LS-TTL input reads 1.');
      if (EN.value === 1 && !busX) parts.push(`ENABLE is high: the tri-state buffer drives Q (${Q.value}) onto the bus${BUSDRV.value === 1 ? '' : ' for other modules to read'}.`);
      setText(status, parts.join(' '));
      setText(holdText, `rising clock edges: ${edges} · since the last load: ${heldEdges}${!load && heldEdges > 0 ? ` (Q kept its value through all ${heldEdges})` : ''}`);
    };
    d.add(c.onChange(update));

    d.add(
      runCircuit(c, {
        slow: () => slow,
        onStep: () => {
          if (auto) {
            autoCount++;
            if (autoCount >= 40) {
              autoCount = 0;
              c.set(CLK, CLK.value === 1 ? 0 : 1);
            }
          }
          if (lastClk !== 1 && CLK.value === 1) {
            edges++;
            heldEdges = LOAD.value === 1 ? 0 : heldEdges + 1;
          }
          lastClk = CLK.value;
          trace.sample(c.time);
        },
        onFrame: () => scope.draw(trace.samples, { window: WINDOW }),
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          '1-bit register',
          { accent: 'red', chips: '74LS74 (D flip-flop), 74LS08 (AND), 74LS32 (OR), 74LS04 (NOT), tri-state buffer' },
          sch.el,
          levelLegend(),
          row(pulseBtn.el, autoT.el),
          slowT.el,
          note('Click LOAD, ENABLE and the other module’s in/en switches to flip them; hold CLK (or the Clock pulse button) for a clock pulse.'),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('What is happening', { accent: 'gray' }, status, holdText),
          panel('The multiplexer', { accent: 'gray' }, tt.el, note('D = (BUS AND LOAD) OR (Q AND NOT LOAD). The NOT gate makes sure exactly one of the two AND gates is open.')),
          panel('Timing diagram', { accent: 'gray' }, scope.el, note('D follows the bus only while LOAD is high, but Q changes only on a rising CLK edge.')),
          panel(
            'From 1 bit to 4: the 74LS173',
            { accent: 'blue' },
            note('Building 8 of these from gates would take a lot of chips. The 74LS173 has four D flip-flops with this exact load logic built in (its data-enable pins G1 and G2 act as LOAD, active low) and tri-state outputs (pins M and N act as ENABLE, active low). Two of them make an 8-bit register in the next video.'),
          ),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
