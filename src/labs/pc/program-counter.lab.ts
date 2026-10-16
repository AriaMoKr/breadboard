import { Circuit, Trace, type Level, type Net } from '../../logic/circuit';
import { bin } from '../../sim/assembler';
import { Button, DipSwitch, Led, LedBar, Scope, Slider, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { ledCell, makeTable, scopedStyle } from '../ram/_ui';
import { defineLab } from '../types';
import { ls161Async, ls161Mode, ls161Rise, ls161Tc, pcBusLevels, rippleStates, ttlReadNibble, type Ls161Inputs } from './_shared';

const PULSE_MS = 260;
const SAMPLE_MS = 40;
const WINDOW = 200;
/** Gate delays per flip-flop in the ripple/synchronous comparison. */
const FF_DELAY = 4;
const NS_PER_UNIT = 5;

export default defineLab({
  id: 'program-counter',
  title: 'Program counter',
  summary:
    'The program counter holds the address of the next instruction. Ben builds it from a 74LS161 synchronous 4-bit counter and a 74LS245 bus buffer. CE (count enable) makes it count up on each rising clock edge, CO (counter out) puts the count on the low 4 bits of the bus, and J (jump) loads a new value from the bus on the next edge instead of counting. CLR resets it to 0 straight away, without waiting for the clock. Try each signal, then compare it with the ripple counter from the binary-counter video.',
  mount(root) {
    const d = new Disposer();
    d.add(scopedStyle(root));
    root.classList.add('program-counter');

    // ---- state ----
    const st = { ce: false, j: false, co: false, clr: false, busDrive: false, busSw: 0b0101, clk: 0 as 0 | 1, auto: false, hz: 2 };
    let q = 0;
    let now = 0;
    let fallAt = 0;
    let autoPhase = 0;
    let lastEdge: { from: number; to: number; mode: string } | null = null;

    const chipIn = (): Ls161Inputs => ({ mrN: st.clr ? 0 : 1, peN: st.j ? 0 : 1, cep: st.ce ? 1 : 0, cet: st.ce ? 1 : 0, p: busRead() & 15 });
    /** Per-bit bus levels (bits 0-3), with the 245 and the test switches as drivers. */
    const busLevels = (): Level[] => pcBusLevels(q, st.co, st.busDrive, st.busSw);
    /** What the 161's P inputs read: floating TTL inputs read 1; with contention the low output wins. */
    const busRead = () => ttlReadNibble(busLevels());
    const rise = () => {
      if (st.clk === 1) return;
      st.clk = 1;
      const i = chipIn();
      const before = q;
      q = ls161Rise(q, i);
      lastEdge = { from: before, to: q, mode: ls161Mode(i) };
    };

    // ---- nets for the schematic ----
    const c = new Circuit();
    const nMR = c.input('M̅R̅', 1);
    const nCP = c.input('CP', 0);
    const nCE = c.input('CE', 0);
    const nPE = c.input('P̅E̅', 1);
    const nQ = [0, 1, 2, 3].map((i) => c.input(`Q${i}`, 0));
    const nTC = c.input('TC', 0);
    const nOE = c.input('O̅E̅', 1);
    const nGND = c.input('GND', 0);
    const nB = [0, 1, 2, 3].map((i) => c.input(`BUS${i}`, 'Z'));

    const sch = new Schematic(c, { width: 520, height: 384 });
    const busX = (b: number) => 24 + 10 * b;
    nB.forEach((n, b) => sch.wire(n, [busX(b), 28], [busX(b), 374]));
    sch.text('bus 0-3', [39, 14], { size: 11 });
    const pc = sch.chip([170, 20], {
      label: '74LS161',
      sublabel: 'PC',
      width: 120,
      left: [
        { name: '1 M̅R̅', net: nMR, bubble: true }, { name: '2 CP', net: nCP },
        { name: '3 P0', net: nB[0] }, { name: '4 P1', net: nB[1] }, { name: '5 P2', net: nB[2] }, { name: '6 P3', net: nB[3] },
        { name: '7 CEP', net: nCE }, { name: '10 CET', net: nCE }, { name: '9 P̅E̅', net: nPE, bubble: true },
      ],
      right: [{ name: 'Q0 14', net: nQ[0] }, { name: 'Q1 13', net: nQ[1] }, { name: 'Q2 12', net: nQ[2] }, { name: 'Q3 11', net: nQ[3] }, { name: 'TC 15', net: nTC }],
    });
    const L = pc.left;
    const ctl = (net: Net, pin: { x: number; y: number }, label: string) => {
      sch.wire(net, [112, pin.y], pin);
      sch.text(label, [106, pin.y], { anchor: 'end', size: 12 });
    };
    ctl(nMR, L[0], 'C̅L̅R̅');
    ctl(nCP, L[1], 'CLK');
    for (let b = 0; b < 4; b++) {
      sch.wire(nB[b], [busX(b), L[2 + b].y], L[2 + b]);
      sch.dot(nB[b], [busX(b), L[2 + b].y]);
    }
    ctl(nCE, L[6], 'CE');
    sch.wire(nCE, [140, L[6].y], [140, L[7].y], L[7]);
    sch.dot(nCE, [140, L[6].y]);
    ctl(nPE, L[8], 'J̅');
    sch.wire(nTC, pc.right[4], [330, pc.right[4].y]);
    sch.text('(unused)', [336, pc.right[4].y], { anchor: 'start', size: 10, class: 'cap' });

    const buf = sch.chip([170, 262], {
      label: '74LS245',
      sublabel: 'B → A',
      width: 120,
      height: 104,
      left: [{ name: 'A4' }, { name: 'A5' }, { name: 'A6' }, { name: 'A7' }],
      right: [{ name: 'B4' }, { name: 'B5' }, { name: 'B6' }, { name: 'B7' }],
      top: [{ name: 'O̅E̅', net: nOE, bubble: true }, { name: 'DIR', net: nGND }],
    });
    // Q0..Q3 -> green LEDs -> 245 B7..B4 (bit order reversed on the chip, bit-for-bit on the bus)
    for (let b = 0; b < 4; b++) {
      const yq = pc.right[b].y;
      const pin = buf.right[3 - b];
      const x = 400 + 12 * (3 - b);
      sch.wire(nQ[b], pc.right[b], [x, yq], [x, pin.y], pin);
      sch.probe(nQ[b], [348, yq], { label: `Q${b}`, color: 'green', labelSide: 'top' });
      // 245 A side -> bus line b
      const a = buf.left[3 - b];
      sch.wire(nB[b], a, [busX(b), a.y]);
      sch.dot(nB[b], [busX(b), a.y]);
    }
    sch.wire(nOE, buf.top[0], [buf.top[0].x, 240]);
    sch.text('C̅O̅', [buf.top[0].x, 232], { size: 11 });
    sch.wire(nGND, buf.top[1], [buf.top[1].x, 240]);
    sch.text('GND', [buf.top[1].x, 232], { size: 10, class: 'cap' });
    d.add(sch.autoUpdate());

    // ---- controls ----
    const ceT = new Toggle({ label: 'CE', title: 'Count enable → CEP and CET', onChange: (v) => (st.ce = v) });
    const jT = new Toggle({ label: 'J', title: 'Jump → P̅E̅ (load from the bus on the next edge)', onChange: (v) => (st.j = v) });
    const coT = new Toggle({ label: 'CO', title: 'Counter out → 74LS245 O̅E̅', onChange: (v) => (st.co = v) });
    const clrT = new Toggle({ label: 'CLR', title: 'Clear → M̅R̅ (asynchronous)', onChange: (v) => (st.clr = v) });
    const busDip = new DipSwitch({ bits: 4, value: st.busSw, label: 'bus 3-0', onChange: (v) => (st.busSw = v) });
    const busT = new Toggle({ label: 'Drive bus', title: 'Connect the switches to bus bits 0-3', onChange: (v) => (st.busDrive = v) });
    const pulse = new Button({ label: 'Clock pulse', kind: 'primary', onClick: () => { rise(); fallAt = now + PULSE_MS; } });
    const autoT = new Toggle({ label: 'Auto clock', onChange: (v) => { st.auto = v; autoPhase = 0; } });
    const speed = new Slider({ label: 'speed', min: 0.5, max: 8, value: st.hz, step: 0.1, format: (v) => `${v.toFixed(1)} Hz`, onInput: (v) => (st.hz = v) });
    const clkLed = new Led('blue', 'CLK');
    const qBar = new LedBar({ bits: 4, color: 'green', formats: ['bin', 'dec'], label: 'PC' });
    const busBar = new LedBar({ bits: 4, color: 'red', label: 'bus' });
    const busText = h('span', { class: 'mono dim small' });

    // ---- mode table ----
    const modeTable = makeTable(['M̅R̅', 'P̅E̅', 'CEP', 'CET', 'CP', 'action'], [
      ['0', 'X', 'X', 'X', 'X', 'clear to 0 (asynchronous)'],
      ['1', '0', 'X', 'X', '↑', 'load P0-P3 (jump)'],
      ['1', '1', '1', '1', '↑', 'count up'],
      ['1', '1', '0', 'X', 'X', 'hold'],
      ['1', '1', 'X', '0', 'X', 'hold'],
    ]);
    const status = h('div', { class: 'callout' });

    // ---- timing diagram ----
    const lanes: Level[][] = Array.from({ length: 8 }, () => []);
    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'CE', color: '#fbbf24' },
        { label: 'J', color: '#c084fc' },
        { label: 'CLR', color: '#f472b6' },
        { label: 'Q0', color: '#4ade80' },
        { label: 'Q1', color: '#4ade80' },
        { label: 'Q2', color: '#4ade80' },
        { label: 'Q3', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 30 },
    );
    let sampleAcc = 0;
    const sample = () => {
      const vals: Level[] = [st.clk, st.ce ? 1 : 0, st.j ? 1 : 0, st.clr ? 1 : 0, ...[0, 1, 2, 3].map((b) => ((q >> b) & 1) as Level)];
      vals.forEach((v, i) => {
        lanes[i].push(v);
        if (lanes[i].length > WINDOW) lanes[i].shift();
      });
    };

    const update = () => {
      q = ls161Async(q, chipIn());
      const i = chipIn();
      const mode = ls161Mode(i);
      const bl = busLevels();
      c.set(nMR, i.mrN);
      c.set(nCP, st.clk);
      c.set(nCE, i.cep);
      c.set(nPE, i.peN);
      nQ.forEach((n, b) => c.set(n, ((q >> b) & 1) as 0 | 1));
      c.set(nTC, ls161Tc(q, i.cet));
      c.set(nOE, st.co ? 0 : 1);
      nB.forEach((n, b) => c.set(n, bl[b]));
      clkLed.set(st.clk === 1);
      qBar.set(q);
      busBar.setLevels([...bl].reverse());
      const contention = bl.includes('X');
      setText(busText, bl.every((l) => l === 'Z') ? 'floating (TTL reads 1111)' : contention ? `contention! (reads ${bin(busRead(), 4)})` : bin(busRead(), 4));
      modeTable.highlight(mode === 'clear' ? 0 : mode === 'load' ? 1 : mode === 'count' ? 2 : 3);
      const next = ls161Rise(q, i);
      let msg: string;
      if (contention) msg = `CO is on while the bus switches also drive the bus, and they disagree on some bits (orange). Where two TTL outputs fight, the one pulling low usually wins, so the bus reads ${bin(i.p, 4)}${mode === 'load' ? ' and that is what J would load' : ''}. Only one thing should drive the bus at a time.`;
      else if (mode === 'clear') msg = 'CLR pulls M̅R̅ low: the 161 clears to 0000 immediately, no clock edge needed (asynchronous), and holds it there until CLR is released.';
      else if (mode === 'load') msg = `J is on, so P̅E̅ is low. On the next rising edge the 161 loads ${bin(i.p, 4)} from the bus (${i.p})${bl.every((l) => l === 'Z') ? ', and since nothing drives the bus, the floating inputs read 1111' : ''}. Load wins over counting even if CE is on: that is how a jump overrides the incremented PC.`;
      else if (mode === 'count') msg = `CE drives CEP and CET high: on the next rising edge the counter goes from ${q} to ${next}${q === 15 ? ' (it wraps around)' : ''}. All four flip-flops share the clock, so all bits change together.`;
      else msg = `CE is low, so the counter holds ${q} (${bin(q, 4)}) no matter how many clock pulses arrive.`;
      if (st.co && !contention) msg += ` CO is on: the 74LS245 drives the count onto bus bits 0-3.`;
      if (lastEdge && st.clk === 1) msg = `Rising edge: ${lastEdge.mode === 'hold' ? `held at ${lastEdge.to}` : lastEdge.mode === 'load' ? `loaded ${lastEdge.to} from the bus (jump)` : lastEdge.mode === 'count' ? `counted ${lastEdge.from} → ${lastEdge.to}` : 'cleared'}. ` + msg;
      setText(status, msg);
    };

    // =====================================================================
    // Ripple vs synchronous
    let cmp = buildCompare(7);
    const ripBar = new LedBar({ bits: 4, color: 'green', formats: ['bin', 'dec'], label: 'ripple' });
    const synBar = new LedBar({ bits: 4, color: 'green', formats: ['bin', 'dec'], label: '161' });
    const cmpScope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'ripple Q0', color: '#fbbf24' }, { label: 'ripple Q1', color: '#fbbf24' }, { label: 'ripple Q2', color: '#fbbf24' }, { label: 'ripple Q3', color: '#fbbf24' },
        { label: '161 Q0', color: '#4ade80' }, { label: '161 Q1', color: '#4ade80' }, { label: '161 Q2', color: '#4ade80' }, { label: '161 Q3', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 26 },
    );
    const seen = h('div', { class: 'mono small' });
    const cmpMsg = h('div', { class: 'callout' }, 'Press “One clock edge” and watch both counters in slow motion (one step ≈ 5 ns).');
    let cmpAcc = 0;
    let ripSeen: number[] = [];
    const countBtn = new Button({
      label: 'One clock edge',
      kind: 'primary',
      onClick: () => {
        if (!cmp.c.idle || cmp.fallIn > 0) return;
        ripSeen = [cmp.ripple()];
        cmp.c.set(cmp.ck, 1);
        cmp.fallIn = 30;
        setText(cmpMsg, `Expected ripple states: ${[cmp.ripple(), ...rippleStates(cmp.ripple())].map((v) => bin(v, 4)).join(' → ')}`);
      },
    });
    const preset = (v: number) => new Button({ label: `Start at ${bin(v, 4)}`, onClick: () => { cmp.dispose(); cmp = buildCompare(v); ripSeen = []; } });
    const presets = [preset(7), preset(15), preset(3)];

    d.add(
      animate((dt) => {
        now += dt;
        if (st.auto) {
          autoPhase += (dt / 1000) * st.hz * 2;
          while (autoPhase >= 1) {
            autoPhase -= 1;
            if (st.clk === 0) rise();
            else st.clk = 0;
          }
        } else if (st.clk === 1 && now >= fallAt) st.clk = 0;
        update();
        sampleAcc += dt;
        while (sampleAcc >= SAMPLE_MS) {
          sampleAcc -= SAMPLE_MS;
          sample();
        }
        scope.draw(lanes, { window: WINDOW });

        // comparison, slow motion: one circuit time unit every 70 ms
        cmpAcc += dt;
        while (cmpAcc >= 70) {
          cmpAcc -= 70;
          if (cmp.fallIn > 0 && --cmp.fallIn === 0) cmp.c.set(cmp.ck, 0);
          if (!cmp.c.idle || cmp.fallIn > 0) cmp.c.step();
          const r = cmp.ripple();
          if (ripSeen.length && ripSeen[ripSeen.length - 1] !== r) ripSeen.push(r);
        }
        if (cmpAcc > 500) cmpAcc = 0;
        ripBar.set(cmp.ripple());
        synBar.set(cmp.sync());
        setText(seen, ripSeen.length > 1 ? `ripple went ${ripSeen.map((v) => bin(v, 4)).join(' → ')} · t = ${cmp.c.time * NS_PER_UNIT} ns` : `t = ${cmp.c.time * NS_PER_UNIT} ns`);
        cmpScope.draw(cmp.trace.samples, { window: 90 });
      }),
    );
    d.add(() => cmp.dispose());

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        h(
          'div',
          { class: 'lab-stack' },
          panel('Program counter module', { accent: 'green', chips: '74LS161, 74LS245, 4 green LEDs' }, sch.el, note('Wires: red = high, blue = low, dashed = floating. C̅L̅R̅, J̅ and C̅O̅ are active low on the chips; the toggles below are the active-high control signals (the control logic inverts them later).')),
          panel('74LS161 function table', { accent: 'gray' }, modeTable.el, status),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            'Controls',
            { accent: 'blue' },
            row(ceT.el, jT.el, coT.el, clrT.el),
            row(busT.el, busDip.el),
            row(ledCell(clkLed, 'CLK'), pulse.el, autoT.el, speed.el),
            row(qBar.el),
            row(busBar.el, busText),
          ),
          panel('Timing diagram', { accent: 'gray', subtitle: 'scrolls in real time' }, scope.el),
          panel(
            'Synchronous vs ripple',
            { accent: 'yellow', subtitle: 'the binary-counter video’s 74LS76 chain vs the 74LS161' },
            row(countBtn.el, ...presets.map((b) => b.el)),
            row(ripBar.el),
            row(synBar.el),
            seen,
            cmpScope.el,
            cmpMsg,
            note('In the ripple counter each flip-flop is clocked by the one before it, so a carry has to ripple through the stages one delay after another, and for a moment the outputs show wrong values. Inside the 161 every flip-flop is clocked by CLK at the same time and gating logic decides which ones toggle, so all four bits change together.'),
          ),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});

/** Two 4-bit counters on one clock: a ripple chain (each stage clocked by the previous stage) and a synchronous one. */
function buildCompare(initial: number) {
  const c = new Circuit();
  const ck = c.input('CLK', 0);
  const R = [0, 1, 2, 3].map((i) => c.net(`R${i}`, ((initial >> i) & 1) as 0 | 1));
  const Rn = [0, 1, 2, 3].map((i) => c.net(`R̅${i}`, (((initial >> i) & 1) ^ 1) as 0 | 1));
  const S = [0, 1, 2, 3].map((i) => c.net(`S${i}`, ((initial >> i) & 1) as 0 | 1));
  for (let i = 0; i < 4; i++) {
    const clkIn = i === 0 ? ck : Rn[i - 1];
    c.add({
      kind: 'TFF',
      inputs: [clkIn],
      outputs: [R[i], Rn[i]],
      delay: FF_DELAY,
      evaluate: ([v], ctx) => {
        if (ctx.state.q === undefined) ctx.state.q = (initial >> i) & 1;
        if (ctx.prevInputs[0] === 0 && v === 1) ctx.state.q = (ctx.state.q as number) ^ 1;
        const qv = ctx.state.q as 0 | 1;
        return [qv, (qv ^ 1) as 0 | 1];
      },
    });
  }
  c.add({
    kind: '161',
    inputs: [ck],
    outputs: S,
    delay: FF_DELAY,
    evaluate: ([v], ctx) => {
      if (ctx.state.v === undefined) ctx.state.v = initial;
      if (ctx.prevInputs[0] === 0 && v === 1) ctx.state.v = ((ctx.state.v as number) + 1) & 15;
      const val = ctx.state.v as number;
      return [0, 1, 2, 3].map((b) => ((val >> b) & 1) as Level);
    },
  });
  c.settle();
  const trace = new Trace([ck, ...R, ...S], 90);
  const off = trace.attach(c);
  const read = (nets: Net[]) => nets.reduce((v, n, b) => v | ((n.value === 1 ? 1 : 0) << b), 0);
  return { c, ck, trace, fallIn: 0, ripple: () => read(R), sync: () => read(S), dispose: off };
}
