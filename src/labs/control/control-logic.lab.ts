import { mountComputerWorkbench } from '../../app/computer-page';
import { Circuit, type Level, type Net } from '../../logic/circuit';
import { assemble, disassemble } from '../../sim/assembler';
import { Machine } from '../../sim/machine';
import { INSTRUCTION_BY_OPCODE, microcodeEepromImage, UCODE_TEMPLATE_BASIC } from '../../sim/microcode';
import { PROGRAM_BY_ID } from '../../sim/programs';
import { AI, AO, BI, CE, CO, EO, II, IO, MI, OI, RO, SIGNALS, formatControlWord } from '../../sim/signals';
import { Button, Scope, Toggle, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, h, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { buildStepCounter } from './_circuits';
import { describeTransfer } from './_models';
import { ControlUnitExercise, chipContrastCss, labTabs, routeVideo, scopedStyle, sigChips } from './_shared';

const ADD = PROGRAM_BY_ID.get('add')!;

// ===========================================================================
// Part 1: executing LDA / ADD / OUT by hand

function mountPart1(el: HTMLElement): () => void {
  const d = new Disposer();
  const asm = assemble(ADD.source);
  const isa = h(
    'table',
    { class: 'truth-table' },
    h('thead', null, h('tr', null, ['opcode', 'mnemonic', 'what it does'].map((x) => h('th', null, x)))),
    h(
      'tbody',
      null,
      [
        ['0001', 'LDA addr', 'load A from RAM[addr]'],
        ['0010', 'ADD addr', 'A ← A + RAM[addr]'],
        ['1110', 'OUT', 'show A on the display'],
        ['1111', 'HLT', 'stop the clock (added in part 3)'],
      ].map((r) => h('tr', null, r.map((x) => h('td', { style: 'text-align:left' }, x)))),
    ),
  );
  const listing = h(
    'table',
    { class: 'truth-table' },
    h('thead', null, h('tr', null, ['addr', 'contents', 'meaning'].map((x) => h('th', null, x)))),
    h(
      'tbody',
      null,
      asm.listing.map((l) =>
        h('tr', null, h('td', null, l.addr.toString(2).padStart(4, '0')), h('td', null, `${(l.byte >> 4).toString(2).padStart(4, '0')} ${(l.byte & 15).toString(2).padStart(4, '0')}`), h('td', { style: 'text-align:left' }, l.addr >= 14 ? `data ${l.byte}` : disassemble(l.byte))),
      ),
    ),
  );

  const wbHost = h('div');
  const wb = mountComputerWorkbench(wbHost, { manualControl: true, microcodeVersion: 'control-logic', tabs: ['program'] });
  d.add(wb.dispose);
  const ex = new ControlUnitExercise(wb.machine, {
    source: ADD.source,
    guided: true,
    intro: 'With “guided” on, the switches are set for you, exactly as Ben flips them in the video: just pulse the clock and read what each step does. Turn guided off to work out the control word yourself.',
  });
  d.add(() => ex.dispose());

  el.append(
    h(
      'div',
      { class: 'lab-grid' },
      panel('A tiny machine language', { accent: 'gray', subtitle: 'opcode = high 4 bits' }, isa, note('The low 4 bits are the operand: a RAM address for LDA and ADD.')),
      panel('The program in RAM', { accent: 'red', subtitle: '28 + 14, entered in program mode' }, listing, note('Ben toggles these bytes into RAM with the DIP switches in program mode. Here they are already loaded.')),
    ),
    panel('Manual execution', { accent: 'blue', subtitle: 'fetch = MI|CO, then RO|II|CE' }, ex.el),
    wbHost,
  );
  return d.dispose;
}

// ===========================================================================
// Part 2: the step counter (74LS161 on CLK̅ + 74LS138)

const LINE_BITS = [MI, CO, RO, II, CE, IO, AI, BI, EO, AO, OI];
const LINE_LANES: { bit: number; label: string; color: string }[] = [
  { bit: MI, label: 'MI', color: '#c084fc' },
  { bit: RO, label: 'RO', color: '#f472b6' },
  { bit: CE, label: 'CE', color: '#fb923c' },
];
const INSTR_CHOICES = [
  { value: '1', label: 'LDA' },
  { value: '2', label: 'ADD' },
  { value: '14', label: 'OUT' },
];

function wordsFor(opcode: number, sixSteps: boolean): number[] {
  const row = UCODE_TEMPLATE_BASIC[opcode];
  if (!sixSteps) return row.slice(0, 5);
  // Ben's first version: CE had its own step, so fetch took 3 clocks and the counter reset at O6.
  return [MI | CO, RO | II, CE, row[2], row[3], row[4]];
}

const P2_CSS = `
.sc-lab .schematic .wire.inactive { opacity: 0.18; }
${chipContrastCss('.sc-lab')}
`;

function mountPart2(el: HTMLElement): () => void {
  const d = new Disposer();
  const wrap = h('div', { class: 'sc-lab lab-stack' });
  d.add(scopedStyle(wrap, P2_CSS));
  let opcode = 1;
  let six = false;
  const sc = buildStepCounter(LINE_BITS, wordsFor(opcode, six));
  const c = sc.c;

  // ---- schematic ----
  const sch = new Schematic(c, { width: 640, height: 340 });
  const inv = sch.gate('NOT', { x: 70, y: 60 }, { label: '74LS04', output: sc.clkn });
  const cnt = sch.chip({ x: 165, y: 40 }, { label: '74LS161', sublabel: 'counter', width: 120, height: 100, left: [{ name: 'CP', net: sc.cp }, { name: 'M̅R̅', net: sc.mrn, bubble: true }], right: sc.q.map((n, i) => ({ name: `Q${i}`, net: n })) });
  const dec = sch.chip({ x: 400, y: 30 }, { label: '74LS138', sublabel: 'decoder', width: 100, height: 180, left: sc.q.slice(0, 3).map((n, i) => ({ name: `A${i}`, net: n })), right: sc.o.map((n, i) => ({ name: `O${i}̅`, net: n, bubble: true })) });
  sch.wire(sc.clk, [40, 60], inv.inputs[0]);
  sch.text('CLK', [24, 44], { size: 11 });
  const wInv = [sch.wire(sc.clkn, inv.output, [138, 60], [138, cnt.left[0].y], [146, cnt.left[0].y])];
  const wDir = [sch.wire(sc.clk, [45, 60], [45, 24], [146, 24], [146, cnt.left[0].y])];
  sch.wire(sc.cp, [146, cnt.left[0].y], cnt.left[0]);
  sch.dot(sc.clk, [45, 60]);
  [365, 355, 345].forEach((mx, i) => sch.route(sc.q[i], cnt.right[i], dec.left[i], { midX: mx }));
  sc.q.slice(0, 3).forEach((n, i) => sch.probe(n, [318, cnt.right[i].y], { color: 'red' }));
  sch.text('step', [318, 44], { size: 10 });
  sch.text('n.c.', [303, cnt.right[3].y], { size: 10, anchor: 'start' });
  for (let i = 0; i < 5; i++) {
    sch.wire(sc.o[i], dec.right[i], [572, dec.right[i].y]);
    sch.probe(sc.t[i], [582, dec.right[i].y], { label: `T${i}`, color: 'green' });
  }
  sch.text('lit when low', [592, 152], { size: 9 });
  sch.text('CEP, CET, P̅E̅ = VCC', [225, 156], { size: 10 });
  sch.text('E̅1, E̅2 = GND, E3 = VCC', [445, 226], { size: 10 });
  const nandB = sch.gate('NAND', { x: 400, y: 280 }, { label: '74LS00 U51B', output: sc.nand1 });
  const nandA = sch.gate('NAND', { x: 500, y: 300 }, { label: 'U51A', output: sc.mrn });
  const w5 = [sch.wire(sc.o[5], dec.right[5], [548, dec.right[5].y], [548, 244], [370, 244], [370, nandB.inputs[0].y], nandB.inputs[0])];
  const w6 = [sch.wire(sc.o[6], dec.right[6], [534, dec.right[6].y], [534, 236], [362, 236], [362, nandB.inputs[0].y], [370, nandB.inputs[0].y])];
  sch.wire(sc.clrn, [330, nandB.inputs[1].y], nandB.inputs[1]);
  sch.switch(sc.clrn, [330, nandB.inputs[1].y], { label: 'CLR̅', onToggle: (n) => c.toggle(n) });
  sch.wire(sc.nand1, nandB.output, [475, 280], [475, nandA.inputs[0].y], nandA.inputs[0]);
  sch.wire(sc.nand1, [475, nandA.inputs[0].y], [475, nandA.inputs[1].y], nandA.inputs[1]);
  sch.dot(sc.nand1, [475, nandA.inputs[0].y]);
  // the return path runs below the U51A label (y ≈ 328)
  sch.wire(sc.mrn, nandA.output, [600, 300], [600, 337], [128, 337], [128, cnt.left[1].y], cnt.left[1]);
  d.add(sch.autoUpdate());
  const setDim = () => {
    const invOn = sc.useInverted.value === 1;
    wInv.forEach((w) => setClass(w, 'inactive', !invOn));
    wDir.forEach((w) => setClass(w, 'inactive', invOn));
    w5.forEach((w) => setClass(w, 'inactive', six));
    w6.forEach((w) => setClass(w, 'inactive', !six));
  };

  // ---- controls ----
  const HALF = 20; // half a clock period, in gate delays
  let running = true;
  let speed = 60; // gate delays per second
  let pulseEnd = -1;
  const runT = new Toggle({ label: 'Run the clock', value: true, onChange: (v) => (running = v) });
  const pulseB = new Button({ label: 'Clock pulse', onClick: () => {
    if (running || sc.clk.value === 1) return;
    c.set(sc.clk, 1);
    pulseEnd = c.time + HALF;
  } });
  const raceT = new Toggle({ label: 'Counter on CLK instead of CLK̅ (the race)', onChange: (v) => { c.set(sc.useInverted, v ? 0 : 1); setDim(); } });
  const sixT = new Toggle({ label: 'Reset on O6̅ (Ben’s first 6-step version)', onChange: (v) => { six = v; c.set(sc.resetAt6, v ? 1 : 0); sc.setWords(wordsFor(opcode, six)); setDim(); } });
  const instrSel = select(INSTR_CHOICES, '1', (v) => { opcode = Number(v); sc.setWords(wordsFor(opcode, six)); }, 'Microcode for');
  const speedSel = select([{ value: '20', label: 'slow' }, { value: '60', label: 'normal' }, { value: '200', label: 'fast' }], '60', (v) => (speed = Number(v)), 'Speed');
  const resetB = new Button({ label: 'Reset (hold)', kind: 'danger', onPress: () => c.set(sc.clrn, 0), onRelease: () => c.set(sc.clrn, 1) });
  setDim();

  // ---- timing diagram ----
  const WINDOW = 240;
  const lanes = [
    { label: 'CLK', color: '#60a5fa' },
    { label: 'CLK̅ (74LS04)', color: '#93c5fd' },
    { label: 'counter CP', color: '#a5b4fc' },
    { label: 'step', color: '#f87171', kind: 'analog' as const, min: 0, max: 7 },
    ...[0, 1, 2, 3, 4].map((i) => ({ label: `T${i}`, color: '#4ade80' })),
    { label: 'reset (O5̅/O6̅)', color: '#fbbf24' },
    ...LINE_LANES.map((l) => ({ label: l.label, color: l.color })),
    { label: 'registers latch', color: '#e879f9' },
  ];
  const scope = new Scope(lanes, { width: 640, laneHeight: 22 });
  const samples: (Level | number)[][] = lanes.map(() => []);
  const lineIdx = LINE_LANES.map((l) => LINE_BITS.indexOf(l.bit));
  let lastRise = -1e9;
  let lastChange = -1e9;
  let prevSig = '';
  let prevClk: Level = 0;
  let races = 0;
  let lastRaceAt = -1e9;
  const sig = () => sc.lines.map((n) => n.value).join('');
  const markBack = (k: number) => {
    const lane = samples[samples.length - 1];
    for (let i = 0; i <= k && i < lane.length; i++) lane[lane.length - 1 - i] = 'X';
  };
  const sampleNow = () => {
    const t = c.time;
    const clk = sc.clk.value;
    const vals: (Level | number)[] = [clk, sc.clkn.value, sc.cp.value, Math.max(0, sc.count()), ...sc.t.slice(0, 5).map((n) => n.value), sc.osel.value, ...lineIdx.map((i) => sc.lines[i].value)];
    let race = -1;
    if (prevClk === 0 && clk === 1) {
      lastRise = t;
      if (t - lastChange <= 3) race = t - lastChange;
    }
    const s = sig();
    if (s !== prevSig) {
      prevSig = s;
      lastChange = t;
      if (clk === 1 && t - lastRise <= 10) race = t - lastRise;
    }
    prevClk = clk;
    vals.push(t - lastRise < 3 ? 1 : 0);
    vals.forEach((v, i) => {
      samples[i].push(v);
      if (samples[i].length > WINDOW) samples[i].shift();
    });
    if (race >= 0) {
      markBack(race);
      if (t - lastRaceAt > HALF) races++;
      lastRaceAt = t;
    }
  };

  // ---- readouts ----
  const status = h('div', { class: 'callout' });
  const cwText = h('div', { class: 'mono' });
  const update = () => {
    const n = sc.count();
    const words = wordsFor(opcode, six);
    const w = n >= 0 ? (words[n] ?? 0) : 0;
    setText(cwText, `count ${n} → T${n}: ${formatControlWord(w)}  (${describeTransfer(w)})`);
    const raceOn = sc.useInverted.value === 0;
    setText(
      status,
      sc.clrn.value === 0
        ? 'CLR̅ is low (reset), so U51B outputs 1, U51A turns that into M̅R̅ = 0 and the counter is held at 0 (T0 lit).'
        : raceOn
          ? `The counter now counts on the rising edge of CLK: the very edge on which the registers latch the bus. The control word changes a few gate delays after that edge (counter + EEPROM delay), shown in red on the “registers latch” lane${races ? ` (${races} so far)` : ''}. Whether a register sees the old or the new control word is a race. Worse, while CLK is high, CLK·OI and CLK·RI see their control line change and fire extra pulses. Clocking the counter on CLK̅ moves every change to the falling edge.`
          : six
            ? 'Reset now comes from O6̅, so the counter runs T0 to T5: Ben’s first version, with CE in a step of its own (T2). Merging CE into T1 (RO|II|CE) saves a clock per instruction, so he moved the reset to O5̅.'
            : 'The 74LS161 is clocked by CLK̅, so the step changes on the falling edge of CLK. The EEPROM needs a few gate delays to show the new control word, but that is still long before the rising edge, so the control lines are stable when the registers latch. When the count reaches 5, O5̅ goes low for a moment and the NANDs clear the counter: watch the short spike on the step and reset lanes.',
    );
  };

  let acc = 0;
  let phase = 0;
  for (let i = 0; i < WINDOW; i++) {
    c.step();
    sampleNow();
  }
  d.add(
    animate((dt) => {
      acc += (dt / 1000) * speed;
      let n = 0;
      while (acc >= 1 && n < 50) {
        acc -= 1;
        n++;
        if (running) {
          phase++;
          if (phase >= HALF) {
            phase = 0;
            c.toggle(sc.clk);
          }
        } else if (pulseEnd >= 0 && c.time >= pulseEnd) {
          pulseEnd = -1;
          c.set(sc.clk, 0);
        }
        c.step();
        sampleNow();
      }
      if (acc > 50) acc = 0;
      scope.draw(samples, { window: WINDOW });
      update();
      pulseB.setDisabled(running);
    }),
  );

  wrap.append(
    panel(
      'Step counter and decoder',
      { accent: 'blue', chips: '74LS161 (U48), 74LS138 (U50), 74LS00 (U51), 74LS04' },
      sch.el,
      cwText,
      row(runT.el, pulseB.el, resetB.el, speedSel),
      row(raceT.el),
      row(sixT.el, instrSel),
      status,
    ),
    panel('Timing diagram', { accent: 'gray', subtitle: 'one column = one gate delay' }, scope.el, note('T0–T4 are the LEDs (lit while the 74LS138 output is low). The “registers latch” lane pulses at every rising edge of CLK; red means the control word changed too close to that edge.')),
  );
  el.appendChild(wrap);
  update();
  return d.dispose;
}

// ===========================================================================
// Part 3: two 28C16 EEPROMs as the microcode ROM

const LEFT_SIGS = SIGNALS.slice(0, 8); // D7..D0 = HLT..AO
// D7..D0 = EO..J, then D0 = FI, which only exists from the flags video (43) on
const RIGHT_SIGS = [...SIGNALS.slice(8, 15), '(FI)'];

function eepromView(c: Circuit, title: string, sub: string, aSrc: string[], sigs: readonly string[]) {
  const a = Array.from({ length: 11 }, (_, i) => c.input(`A${i}`, 0));
  const dnets = Array.from({ length: 8 }, (_, i) => c.input(`D${i}`, 0));
  const sch = new Schematic(c, { width: 310, height: 290 });
  const chip = sch.chip(
    { x: 84, y: 20 },
    {
      label: title,
      sublabel: sub,
      width: 120,
      height: 250,
      left: a.map((n, i) => ({ name: `A${i}`, net: n })).reverse(),
      right: dnets.map((n, i) => ({ name: `D${i}`, net: n })).reverse(),
    },
  );
  chip.left.forEach((p, i) => {
    sch.wire(a[10 - i], [56, p.y], p);
    sch.text(aSrc[i], [52, p.y], { anchor: 'end', size: 10 });
  });
  chip.right.forEach((p, i) => {
    const net = dnets[7 - i];
    sch.wire(net, p, [238, p.y]);
    sch.probe(net, [246, p.y], { label: sigs[i], color: 'blue' });
  });
  return { sch, a, d: dnets };
}

function mountPart3(el: HTMLElement): () => void {
  const d = new Disposer();
  el.classList.add('ee-lab');
  d.add(scopedStyle(el, chipContrastCss('.ee-lab')));
  const m = new Machine({ microcodeVersion: 'control-logic' });
  m.setHz(2);
  const img = () => microcodeEepromImage(m.computer.microcode);
  const ec = new Circuit();
  const addrSrc = (sel: string) => ['GND', 'GND', 'GND', sel, 'IR7', 'IR6', 'IR5', 'IR4', 'Q2', 'Q1', 'Q0'];
  const left = eepromView(ec, '28C16', 'U47 (left)', addrSrc('GND'), LEFT_SIGS);
  const right = eepromView(ec, '28C16', 'U52 (right)', addrSrc('VCC'), RIGHT_SIGS);
  d.add(left.sch.autoUpdate());
  d.add(right.sch.autoUpdate());

  let follow = true;
  let pickOp = 1;
  let pickStep = 2;
  const followT = new Toggle({ label: 'Follow the computer', value: true, onChange: (v) => { follow = v; upd(); } });
  const opSel = select(Array.from({ length: 16 }, (_, op) => ({ value: String(op), label: `${op.toString(2).padStart(4, '0')} ${INSTRUCTION_BY_OPCODE.get(op)?.mnemonic ?? ''}` })), String(pickOp), (v) => { pickOp = Number(v); followT.set(false); follow = false; upd(); }, 'opcode');
  const stSel = select(Array.from({ length: 8 }, (_, s) => ({ value: String(s), label: `T${s}` })), String(pickStep), (v) => { pickStep = Number(v); followT.set(false); follow = false; upd(); }, 'step');
  const leftInfo = h('div', { class: 'small' });
  const rightInfo = h('div', { class: 'small' });
  const wordInfo = h('div', { class: 'callout' });

  const bits = (v: number, n: number) => v.toString(2).padStart(n, '0');
  const describe = (addr: number, byte: number, sigs: readonly string[]) => {
    const on = sigs.filter((_, i) => byte & (0x80 >> i));
    return [
      h('div', { class: 'mono' }, `A10–A0 = ${bits(addr >> 8, 3)} ${(addr >> 7) & 1} ${bits((addr >> 3) & 15, 4)} ${bits(addr & 7, 3)} = 0x${addr.toString(16).padStart(3, '0')}`),
      h('div', { class: 'mono' }, `data = ${bits(byte, 8)} = 0x${byte.toString(16).padStart(2, '0')} → ${on.length ? on.join(' ') : '—'}`),
    ];
  };
  const upd = () => {
    const c = m.computer;
    const op = follow ? c.opcode : pickOp;
    const st = follow ? c.step : pickStep;
    const image = img();
    const base = (op << 3) | st;
    const hi = image[base];
    const lo = image[base | 0x80];
    const setNets = (nets: Net[], v: number) => nets.forEach((n, i) => ec.set(n, ((v >> i) & 1) as 0 | 1));
    setNets(left.a, base);
    setNets(right.a, base | 0x80);
    setNets(left.d, hi);
    setNets(right.d, lo);
    leftInfo.replaceChildren(h('strong', null, 'Left (A7 = GND): '), ...describe(base, hi, LEFT_SIGS));
    rightInfo.replaceChildren(h('strong', null, 'Right (A7 = VCC): '), ...describe(base | 0x80, lo, RIGHT_SIGS));
    const w = (hi << 8) | lo;
    const mn = INSTRUCTION_BY_OPCODE.get(op)?.mnemonic ?? 'unused opcode';
    wordInfo.replaceChildren(
      h('div', null, `Opcode ${bits(op, 4)} (${mn}), step T${st}${st >= 5 ? ' (never reached: the counter resets at 5)' : ''} → control word `, h('strong', { class: 'mono' }, `0x${w.toString(16).padStart(4, '0')}`), ' = '),
      sigChips(w),
      h('div', { class: 'small dim', style: 'margin-top:4px' }, follow ? `${describeTransfer(w)}. The EEPROMs are pure combinational logic here (C̅E̅ = O̅E̅ = GND, W̅E̅ = VCC): change the step or the opcode and the data pins follow.` : 'Pick any opcode and step to look up its control word; turn “Follow the computer” back on to track the running program.'),
    );
    const opSelect = opSel.querySelector('select');
    const stSelect = stSel.querySelector('select');
    if (follow && opSelect && stSelect) {
      opSelect.value = String(op);
      stSelect.value = String(st);
    }
  };
  d.add(m.onChange(upd));

  const wbHost = h('div');
  const wb = mountComputerWorkbench(wbHost, { machine: m, tabs: ['program', 'microcode', 'output'], program: 'add' });
  d.add(wb.dispose);

  el.append(
    panel(
      'Microcode EEPROMs',
      { accent: 'blue', chips: '2 × 28C16 (U47, U52), 16 blue LEDs' },
      row(followT.el, opSel, stSel),
      h('div', { class: 'lab-grid' }, h('div', null, left.sch.el, leftInfo), h('div', null, right.sch.el, rightInfo)),
      wordInfo,
      note('Address: A0–A2 = step counter, A3–A6 = opcode (IR bits 4–7), A7 = which byte. One image serves both chips: the left one (A7 = GND) outputs the high byte HLT…AO, the right one (A7 = VCC) the low byte EO…J. In part 3 Ben actually tied A7 low on both chips and burned each one by hand with its own byte; the A7 byte-select trick arrives with the Arduino programmer (video 40). A8–A10 are tied to GND until the flags register.'),
    ),
    wbHost,
    note('The program: LDA 14, ADD 15, OUT, HLT with 28 and 14 in RAM → 42. At the end of part 3 Ben adds HLT (opcode 1111): its T2 step stops the clock, so the computer halts with the answer on the display.'),
  );
  upd();
  return d.dispose;
}

// ===========================================================================

export default defineLab({
  id: 'control-logic',
  title: 'Control logic',
  summary:
    'Part 1: Ben runs LDA, ADD and OUT by setting every control line himself, two fetch steps (MI|CO, then RO|II|CE) followed by each instruction’s own steps. Part 2: a 74LS161 step counter clocked on the inverted clock and a 74LS138 decoder sequence the micro-steps T0–T4. Part 3: two 28C16 EEPROMs, addressed by the step and the opcode, replace the hand-set switches, and the computer runs 28 + 14 = 42 on its own.',
  mount(root) {
    const v = routeVideo();
    const tabs = labTabs(
      [
        { id: 'p1', label: 'Part 1 · by hand', mount: mountPart1 },
        { id: 'p2', label: 'Part 2 · step counter', mount: mountPart2 },
        { id: 'p3', label: 'Part 3 · EEPROMs', mount: mountPart3 },
      ],
      v === 37 ? 'p2' : v === 38 ? 'p3' : 'p1',
    );
    root.appendChild(tabs.el);
    return tabs.dispose;
  },
});
