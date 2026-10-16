import { Trace, type Bit, type Level, type Net } from '../../logic/circuit';
import { Button, LedBar, Scope, Toggle, note, panel, row, select } from '../../ui/components';
import { Disposer, h, s, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { BitRow, labFrame, levelLegend, runCircuit, truthTable } from '../registers/_shared';
import { ALU_BUILD_STEPS, BEN_FAULTS, FULL_ADDER_ROWS, aluBuildState, applyFaults, buildRippleAdder4, correctWiring, netsValue, rippleWorstCaseDelays, toBinSpaced, type AluBuildStep } from './_model';

/**
 * Video 16 — "Building the ALU".
 * 1. Ben's build order, step by step: unwired LS-TTL inputs float high, so
 *    the half-built ALU gives strange answers, and the finished one (with
 *    his two jumper mistakes) shows 4 for 0 + 8.
 * 2. What is inside a 74LS283: four gate-level full adders (XOR, AND, OR)
 *    chained ripple-carry style.
 */
export default defineLab({
  id: 'alu-build',
  title: 'Building the ALU',
  summary:
    'Ben wires the ALU between the A and B registers in a fixed order: chips and power, A to the adders, adders to the 74LS245, the carry between the two 74LS283s, B through the 74LS86 XORs, SU, the 245 control pins and finally the LEDs. Wire it step by step and watch what a half-built ALU does (unconnected TTL inputs read as 1). When he powers up the finished board, 0 + 8 gives 4: something is miswired, which the next video tracks down. Below, see what is inside a 74LS283: four full adders whose carry ripples from bit to bit.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d);

    // =====================================================================
    // 1. Ben's build, step by step
    // =====================================================================
    const built = new Set<AluBuildStep>();
    let mistakes = true;
    let ba = 0, bb = 8, bsu = false, beo = false;
    const stepItems = ALU_BUILD_STEPS.map((st) => h('li', null, h('span', null, st.title), h('span', { class: 'dp-check-detail' }, st.detail)));
    const stepList = h('ol', { class: 'dp-check' }, stepItems);
    const nextBtn = new Button({
      label: 'Wire the next step',
      kind: 'primary',
      onClick: () => {
        const st = ALU_BUILD_STEPS.find((x) => !built.has(x.id));
        if (st) built.add(st.id);
        renderBuild();
      },
    });
    const undoBtn = new Button({
      label: 'Undo',
      onClick: () => {
        const st = [...ALU_BUILD_STEPS].reverse().find((x) => built.has(x.id));
        if (st) built.delete(st.id);
        renderBuild();
      },
    });
    const allBtn = new Button({ label: 'Wire everything', onClick: () => { ALU_BUILD_STEPS.forEach((x) => built.add(x.id)); renderBuild(); } });
    const restartBtn = new Button({ label: 'Start over', kind: 'ghost', onClick: () => { built.clear(); renderBuild(); } });
    const mistakesT = new Toggle({ label: 'Make Ben’s two jumper mistakes', value: true, onChange: (v) => { mistakes = v; renderBuild(); } });
    const W8 = [128, 64, 32, 16, 8, 4, 2, 1];
    const baRow = new BitRow({ bits: 8, value: ba, label: 'A', weights: W8, onChange: (v) => { ba = v; renderBuild(); } });
    const bbRow = new BitRow({ bits: 8, value: bb, label: 'B', weights: W8, onChange: (v) => { bb = v; renderBuild(); } });
    const bsuT = new Toggle({ label: 'SU', onChange: (v) => { bsu = v; renderBuild(); } });
    const beoT = new Toggle({ label: 'EO (Σ out)', onChange: (v) => { beo = v; renderBuild(); } });
    const firstTest = new Button({
      label: 'Ben’s first test: 0 + 8',
      kind: 'ghost',
      onClick: () => {
        ba = 0;
        bb = 8;
        bsu = false;
        baRow.set(ba);
        bbRow.set(bb);
        bsuT.set(false);
        renderBuild();
      },
    });
    const sumLeds = new LedBar({ bits: 8, color: 'red', label: 'Σ LEDs', formats: ['bin', 'dec'] });
    const carryLed = new LedBar({ bits: 1, color: 'yellow', label: 'carry' });
    const probeText = h('div', { class: 'mono small' });
    const busLeds = new LedBar({ bits: 8, color: 'red', label: 'bus (through the 245)' });
    const buildStatus = h('div', { class: 'callout' });

    function renderBuild() {
      const wiring = mistakes ? applyFaults(BEN_FAULTS) : correctWiring();
      const st = aluBuildState(ba, bb, bsu, beo, built, wiring);
      const cur = ALU_BUILD_STEPS.findIndex((x) => !built.has(x.id));
      stepItems.forEach((li, i) => {
        setClass(li, 'done', built.has(ALU_BUILD_STEPS[i].id));
        setClass(li, 'current', i === cur);
      });
      nextBtn.setDisabled(cur < 0);
      undoBtn.setDisabled(built.size === 0);
      const lit = st.powered && st.leds;
      if (lit) sumLeds.set(st.value);
      else sumLeds.setLevels(new Array<Level>(8).fill(0));
      carryLed.set(lit ? st.carry : 0);
      const bus = st.busOut;
      busLeds.setLevels(bus === null ? new Array<Level>(8).fill('Z') : Array.from({ length: 8 }, (_, k) => ((bus >> (7 - k)) & 1) as Level));
      setText(probeText, st.powered ? `logic probe on the Σ pins: ${toBinSpaced(st.value, 8)} = ${st.value}, carry ${st.carry} · a working ALU gives ${st.expected}` : 'logic probe on the Σ pins: nothing (no power)');
      const op = `${ba} ${bsu ? '−' : '+'} ${bb}`;
      const benTest = ba === 0 && bb === 8 && !bsu;
      let msg: string;
      let warn = false;
      if (!st.powered) msg = 'The chips are on the board but there is no power yet, so nothing happens. Wire the next step.';
      else if (st.floating.length) {
        msg = `Not connected yet: ${st.floating.join(', ')}. An LS-TTL input that is connected to nothing floats high and reads as 1, so the adders are working with ${toBinSpaced(st.adderA, 8)} and ${toBinSpaced(st.adderB, 8)}${!built.has('carry') ? ' plus a floating carry into U20 (worth 16)' : ''}. The Σ pins read ${st.value} instead of ${op} = ${st.expected}.`;
        if (!built.has('su') && built.has('b')) msg += ' A floating SU even inverts B, as if the ALU were subtracting.';
      } else if (!st.leds) msg = `Everything is connected except the LEDs, so you can’t see the result yet: a logic probe on the Σ pins reads ${st.value}${st.value === st.expected ? '' : `, although ${op} = ${st.expected}`}.`;
      else if (st.value !== st.expected) {
        warn = true;
        msg = `All wired up, but ${op} shows ${st.value}${benTest ? ' instead of 8: exactly the symptom Ben gets when he first powers up his ALU' : ` instead of ${st.expected}`}. Two jumpers are in the wrong place. The next video, Troubleshooting the ALU, finds them with simple test inputs.`;
      } else {
        const why = mistakes ? 'This one happens to come out right despite the two mistakes; try 0 + 8. ' : 'With every jumper where the schematic says, the ALU adds and subtracts correctly. ';
        msg = `${op} = ${st.value}. ${why}${bus === null ? 'The 245 keeps the result off the bus until EO is on.' : 'EO is on, so the 245 also puts it on the bus.'}`;
      }
      setClass(buildStatus, 'warn', warn);
      setText(buildStatus, msg);
    }

    // ---- circuit ----
    const { c, A, B, CIN, C, P, G, T, S } = buildRippleAdder4();

    // ---- schematic: one full adder per row, bit 0 on top, carry flows down ----
    const sch = new Schematic(c, { width: 440, height: 530 });
    const ROW = 118, TOP = 44;
    const CIN_X = 212;
    const flip = (n: Net) => { c.toggle(n); changed(); };
    for (let i = 0; i < 4; i++) {
      const y0 = TOP + i * ROW;
      sch.el.querySelector('.sch-wires')!.before(s('rect', { x: 100, y: y0 - 6, width: 290, height: 108, rx: 8, style: 'fill:none;stroke:var(--fg-faint);stroke-dasharray:4 4' }));
      sch.text(`full adder ${i}`, [384, y0 + 4], { size: 9, anchor: 'end', class: 'gate-label' });
      const x1 = sch.gate('XOR', { x: 120, y: y0 + 25 }, { output: P[i] });
      const a1 = sch.gate('AND', { x: 120, y: y0 + 85 }, { output: G[i] });
      const x2 = sch.gate('XOR', { x: 230, y: y0 + 21 }, { output: S[i] });
      const a2 = sch.gate('AND', { x: 230, y: y0 + 58 }, { output: T[i] });
      const o1 = sch.gate('OR', { x: 320, y: y0 + 80 }, { output: C[i + 1] });
      // A: switch → XOR1 top input, and down to AND1 bottom input
      sch.wire(A[i], [50, x1.inputs[0].y], x1.inputs[0]);
      sch.wire(A[i], [80, x1.inputs[0].y], [80, a1.inputs[1].y], a1.inputs[1]);
      sch.dot(A[i], [80, x1.inputs[0].y]);
      sch.switch(A[i], [50, x1.inputs[0].y], { label: `A${i}`, onToggle: flip });
      // B: switch below → AND1 top input and XOR1 bottom input
      const by = y0 + 102;
      sch.wire(B[i], [50, by], [92, by], [92, x1.inputs[1].y], x1.inputs[1]);
      sch.wire(B[i], [92, a1.inputs[0].y], a1.inputs[0]);
      sch.dot(B[i], [92, a1.inputs[0].y]);
      sch.switch(B[i], [50, by], { label: `B${i}`, onToggle: flip });
      // P = A xor B → XOR2 bottom, AND2 bottom
      sch.wire(P[i], x1.output, [200, x1.output.y], [200, a2.inputs[1].y], a2.inputs[1]);
      sch.wire(P[i], [200, x2.inputs[1].y], x2.inputs[1]);
      sch.dot(P[i], [200, x2.inputs[1].y]);
      // carry in → XOR2 top, AND2 top
      sch.wire(C[i], [CIN_X, y0 - 10], [CIN_X, a2.inputs[0].y], a2.inputs[0]);
      sch.wire(C[i], [CIN_X, x2.inputs[0].y], x2.inputs[0]);
      sch.dot(C[i], [CIN_X, x2.inputs[0].y]);
      // G and T → OR
      sch.wire(G[i], a1.output, [300, a1.output.y], [300, o1.inputs[1].y], o1.inputs[1]);
      sch.wire(T[i], a2.output, [292, a2.output.y], [292, o1.inputs[0].y], o1.inputs[0]);
      // sum
      sch.wire(S[i], x2.output, [298, x2.output.y]);
      sch.probe(S[i], [306, x2.output.y], { label: `S${i}`, color: 'red' });
      // carry out → next row's carry in (or the Cout LED)
      if (i < 3) {
        const ny = TOP + (i + 1) * ROW - 10;
        sch.wire(C[i + 1], o1.output, [400, o1.output.y], [400, ny], [CIN_X, ny]);
        sch.probe(C[i + 1], [400, o1.output.y + 18], { label: `C${i + 1}`, color: 'yellow' });
      } else {
        sch.wire(C[4], o1.output, [400, o1.output.y]);
        sch.probe(C[4], [408, o1.output.y], { label: '', color: 'yellow' });
        sch.text('Cout', [408, o1.output.y + 20], { size: 11 });
      }
    }
    sch.wire(CIN, [170, TOP - 26], [CIN_X, TOP - 26], [CIN_X, TOP - 10]);
    sch.switch(CIN, [170, TOP - 26], { label: 'Cin', onToggle: flip });
    d.add(sch.autoUpdate());

    // ---- timing ----
    const WINDOW = 90;
    const trace = new Trace([CIN, C[1], C[2], C[3], C[4], S[0], S[1], S[2], S[3]], WINDOW);
    const scope = new Scope(
      [
        { label: 'Cin', color: '#fbbf24' },
        { label: 'C1', color: '#fbbf24' },
        { label: 'C2', color: '#fbbf24' },
        { label: 'C3', color: '#fbbf24' },
        { label: 'Cout', color: '#fb923c' },
        { label: 'S0', color: '#f87171' },
        { label: 'S1', color: '#f87171' },
        { label: 'S2', color: '#f87171' },
        { label: 'S3', color: '#f87171' },
      ],
      { width: 640, laneHeight: 24 },
    );

    // ---- truth table ----
    const tt = truthTable(['A', 'B', 'Cin', 'S', 'Cout'], FULL_ADDER_ROWS.map((r) => [r.a, r.b, r.cin, r.s, r.cout]));
    let ttBit = 0;
    const bitSel = select<'0' | '1' | '2' | '3'>(['0', '1', '2', '3'].map((v) => ({ value: v as '0', label: `full adder ${v}` })), '0', (v) => { ttBit = Number(v); update(); }, 'Show');

    // ---- controls ----
    let slow = false;
    let since = 0; // gate delays since the last input change
    let settledAt: number | null = 0;
    const slowT = new Toggle({ label: 'Slow motion (one gate delay per step)', onChange: (v) => (slow = v) });
    const ripple = new Button({
      label: 'Ripple demo: 1111 + 0000, then Cin → 1',
      kind: 'primary',
      onClick: () => {
        [1, 1, 1, 1].forEach((v, i) => c.set(A[i], v as Bit));
        B.forEach((b) => c.set(b, 0));
        c.set(CIN, 0);
        c.settle();
        trace.clear();
        slow = true;
        slowT.set(true);
        c.set(CIN, 1);
        changed();
      },
    });
    const addVals = h('div', { class: 'dp-eq' });
    const delays = h('div', { class: 'mono small' });
    const status = h('div', { class: 'callout' });
    const sBar = new LedBar({ bits: 5, color: ['yellow', 'red', 'red', 'red', 'red'], label: 'Cout S3-S0', formats: ['dec'] });

    const num = netsValue;
    function changed() {
      since = 0;
      settledAt = null;
      update();
    }
    function update() {
      const a = num(A), b = num(B), cin = CIN.value === 1 ? 1 : 0;
      const sum = num(S) | (C[4].value === 1 ? 16 : 0);
      const right = a + b + cin;
      setText(addVals, `${a} + ${b}${cin ? ' + 1 (Cin)' : ''} = ${sum}${settledAt === null ? '…' : ''}`);
      const r = ((A[ttBit].value as number) << 2) | ((B[ttBit].value as number) << 1) | (C[ttBit].value as number);
      tt.highlight(Number.isInteger(r) ? r : -1);
      sBar.set(sum);
      setText(
        delays,
        settledAt === null
          ? `gate delays since the change: ${since} (still settling)`
          : settledAt === 0
            ? `settled · change an input to time how long the adder takes (worst case for 4 bits: ${rippleWorstCaseDelays(4)} gate delays)`
            : `settled after ${settledAt} gate delay${settledAt === 1 ? '' : 's'} (worst case for 4 bits: ${rippleWorstCaseDelays(4)})`,
      );
      const carryBits = [1, 2, 3, 4].filter((k) => C[k].value === 1).map((k) => (k === 4 ? 'Cout' : `C${k}`));
      if (settledAt === null) setText(status, `Signals are still on their way: each gate needs one delay, so each carry needs two (AND then OR) before the next full adder can use it. Wrong sums appear for a moment until the ripple reaches the end.`);
      else if (sum !== right) setText(status, 'Still settling.');
      else setText(status, `Settled: ${a} + ${b}${cin ? ' + 1' : ''} = ${right}. ${carryBits.length ? `Carries: ${carryBits.join(', ')}.` : 'No carries.'} In full adder ${ttBit}, A = ${A[ttBit].value}, B = ${B[ttBit].value}, Cin = ${C[ttBit].value} → S = ${S[ttBit].value}, Cout = ${C[ttBit + 1].value} (highlighted row).`);
    }

    let idleCount = 0;
    d.add(
      runCircuit(c, {
        slow: () => slow,
        onStep: () => {
          let justSettled = false;
          if (settledAt === null) {
            since++;
            if (c.idle) {
              settledAt = since;
              justSettled = true;
            }
          }
          // compress idle time so the ripple stands out in the trace
          if (settledAt === null || justSettled || ++idleCount % 8 === 0) trace.sample(c.time);
        },
        onFrame: () => {
          update();
          scope.draw(trace.samples, { window: WINDOW });
        },
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Build it like Ben', { accent: 'yellow', subtitle: 'the order from the video' }, stepList, row(nextBtn.el, undoBtn.el, allBtn.el, restartBtn.el), mistakesT.el),
        panel(
          'Power-on test',
          { accent: 'red', chips: '74LS283 ×2, 74LS86 ×2, 74LS245, 8 LEDs' },
          baRow.el,
          bbRow.el,
          row(bsuT.el, beoT.el, firstTest.el),
          row(sumLeds.el, carryLed.el),
          probeText,
          busLeds.el,
          buildStatus,
        ),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Inside a 74LS283: 4-bit ripple-carry adder',
          { accent: 'red', chips: 'XOR, AND, OR gates (the idea inside a 74LS283)' },
          sch.el,
          levelLegend(),
          row(ripple.el),
          slowT.el,
          note('Click A0-A3, B0-B3 and Cin. Each dashed box is one full adder; its carry out (yellow LED) is the next one’s carry in.'),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('What is happening', { accent: 'gray' }, sBar.el, addVals, delays, status),
          panel('Full adder truth table', { accent: 'gray' }, row(bitSel), tt.el, note('S = A XOR B XOR Cin. Cout = (A AND B) OR ((A XOR B) AND Cin): a carry is generated when both bits are 1, or propagated when exactly one is 1 and a carry comes in.')),
          panel('Timing (idle time compressed)', { accent: 'gray' }, scope.el),
          panel(
            'From gates to chips',
            { accent: 'gray' },
            note('Ben doesn’t wire 40 gates: one 74LS283 holds a whole 4-bit adder and two of them make 8 bits, with C4 of the low chip wired to C0 of the high one. The ALU sits between the A and B registers so their outputs reach the adders with short wires.'),
            note('Inside, the 74LS283 actually uses carry look-ahead, extra logic that works out all four carries at once instead of waiting for the ripple. Between the two chips the carry still ripples, and at the computer’s clock speeds those few nanoseconds don’t matter.'),
          ),
        ),
      ),
    );
    update();
    renderBuild();
    return d.dispose;
  },
});
