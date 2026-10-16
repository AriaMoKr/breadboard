import type { Level } from '../../logic/circuit';
import { computeAlu } from '../../sim/computer';
import { Machine } from '../../sim/machine';
import { INSTRUCTION_BY_OPCODE, UCODE_TEMPLATE_FLAGS } from '../../sim/microcode';
import { FI, formatControlWord } from '../../sim/signals';
import { Button, DipSwitch, Led, LedBar, Scope, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { Schematic, switchPitch } from '../../ui/schematic';
import { MicrostepTrace, chipContrastCss, machineToolbar, scopedStyle } from '../control/_shared';
import { defineLab } from '../types';
import { buildFlagsCircuit } from './_circuits';
import { opcodesSettingFlags } from './_models';

const DEMO = `; why a flags register is needed
        LDA 15    ; A = 255
        ADD 14    ; 255 + 1 = 0: carry and zero
        OUT
        LDA 13    ; A = 7: the ALU's carry is gone, the flags remember
        OUT
        HLT
13:     7
14:     1
15:     255
`;

const CSS = `
${chipContrastCss('.fl-lab')}
.fl-lab .ledcell { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; font-family: var(--mono); font-size: 0.7rem; color: var(--fg-dim); }
`;

export default defineLab({
  id: 'flags-register',
  title: 'CPU flags register',
  summary:
    'For conditional jumps the CPU needs to know whether the last addition carried out of bit 7 and whether the result was zero. The ALU computes both all the time, but it is combinational: as soon as ADD writes the result into A, the ALU shows A + B again and the information is gone. So Ben latches them in a 74LS173 flags register, only when the new FI signal says so. Set the ALU inputs, raise FI and clock it.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'fl-lab lab-stack' });
    d.add(scopedStyle(wrap, CSS));
    const f = buildFlagsCircuit();
    const c = f.c;

    // ---- ALU inputs ----
    let a = 255, b = 1, su = false;
    const aSw = new DipSwitch({ bits: 8, value: a, label: 'A', onChange: (v) => { a = v; updAlu(); } });
    const bSw = new DipSwitch({ bits: 8, value: b, label: 'B', onChange: (v) => { b = v; updAlu(); } });
    const suT = new Toggle({ label: 'SU (subtract)', onChange: (v) => { su = v; updAlu(); } });
    const sumBar = new LedBar({ bits: 8, color: 'red', label: 'Σ', formats: ['dec'] });
    const carryLed = new Led('red', 'carry out C4');
    const aluEq = h('div', { class: 'mono small' });
    const preset = (pa: number, pb: number, sub: boolean) => () => {
      a = pa; b = pb; su = sub;
      aSw.set(a); bSw.set(b); suT.set(su);
      updAlu();
    };
    const presets = [
      new Button({ label: '255 + 1', onClick: preset(255, 1, false) }),
      new Button({ label: '5 − 5', onClick: preset(5, 5, true) }),
      new Button({ label: '3 − 5', onClick: preset(3, 5, true) }),
      new Button({ label: '28 + 14', onClick: preset(28, 14, false) }),
    ];
    const updAlu = () => {
      const r = computeAlu(a, b, su);
      f.setSum(r.value, r.carry);
      c.settle();
      sumBar.set(r.value);
      carryLed.set(r.carry === 1);
      setText(aluEq, `${a} ${su ? '−' : '+'} ${b} = ${r.value}${su ? ` (computed as ${a} + ${(~b) & 0xff} + 1)` : ''} · carry ${r.carry} · zero ${r.zero}`);
      updNote();
    };

    // ---- schematic ----
    const sch = new Schematic(c, { width: 620, height: 380 });
    const nors = [50, 110, 170, 230].map((y, i) => sch.gate('NOR', { x: 120, y }, { label: i === 0 ? '74LS02' : undefined, output: f.nors[i] }));
    nors.forEach((g, i) => {
      [0, 1].forEach((k) => {
        const bit = 2 * i + k;
        sch.wire(f.sum[bit], [50, g.inputs[k].y], g.inputs[k]);
        sch.text(`Σ${bit}`, [44, g.inputs[k].y], { anchor: 'end', size: 11 });
      });
    });
    const and1 = sch.gate('AND', { x: 220, y: 80 }, { label: 'U23A', output: f.and1 });
    const and2 = sch.gate('AND', { x: 220, y: 200 }, { label: 'U23C', output: f.and2 });
    const and3 = sch.gate('AND', { x: 310, y: 140 }, { label: '74LS08 U23B', output: f.zero });
    sch.wire(f.nors[0], nors[0].output, [195, 50], [195, and1.inputs[0].y], and1.inputs[0]);
    sch.wire(f.nors[1], nors[1].output, [195, 110], [195, and1.inputs[1].y], and1.inputs[1]);
    sch.wire(f.nors[2], nors[2].output, [195, 170], [195, and2.inputs[0].y], and2.inputs[0]);
    sch.wire(f.nors[3], nors[3].output, [195, 230], [195, and2.inputs[1].y], and2.inputs[1]);
    sch.wire(f.and1, and1.output, [285, 80], [285, and3.inputs[0].y], and3.inputs[0]);
    sch.wire(f.and2, and2.output, [285, 200], [285, and3.inputs[1].y], and3.inputs[1]);
    const reg = sch.chip(
      { x: 420, y: 100 },
      {
        label: '74LS173',
        sublabel: 'flags',
        width: 100,
        height: 120,
        left: [{ name: 'D0', net: f.c4 }, { name: 'D1', net: f.zero }, { name: 'G̅', net: f.fin, bubble: true }, { name: 'CLK', net: f.clk }, { name: 'MR', net: f.clr }],
        right: [{ name: 'Q0', net: f.cf }, { name: 'Q1', net: f.zf }],
      },
    );
    sch.wire(f.zero, and3.output, reg.left[1]);
    // between the U23B output and the C4 wire (x = 390), so it crosses neither
    sch.text('zero', [375, 151], { size: 10 });
    sch.wire(f.c4, [50, 310], [390, 310], [390, reg.left[0].y], reg.left[0]);
    sch.text('C4 of the high 74LS283', [54, 298], { anchor: 'start', size: 10 });
    const inv = sch.gate('NOT', { x: 250, y: 340 }, { label: '74LS04 (spare)', output: f.fin });
    sch.wire(f.fi, [220, 340], inv.inputs[0]);
    sch.wire(f.fin, inv.output, [398, 340], [398, reg.left[2].y], reg.left[2]);
    sch.wire(f.clk, [300, 280], [370, 280], [370, reg.left[3].y], reg.left[3]);
    const clrY = 280 - switchPitch(30); // CLR above CLK, wider apart on touch screens
    sch.wire(f.clr, [300, clrY], [380, clrY], [380, reg.left[4].y], reg.left[4]);
    sch.wire(f.cf, reg.right[0], [560, reg.right[0].y]);
    sch.wire(f.zf, reg.right[1], [560, reg.right[1].y]);
    sch.probe(f.cf, [570, reg.right[0].y], { label: 'C', color: 'green' });
    sch.probe(f.zf, [570, reg.right[1].y], { label: 'Z', color: 'green' });
    const toggleAndNote = (n: typeof f.fi) => {
      const wasClk = f.clk.value;
      c.toggle(n);
      c.settle();
      if (n === f.clk && wasClk === 0) lastEdge = { fi: f.fi.value === 1, c: f.cf.value, z: f.zf.value };
      updNote();
    };
    sch.switch(f.fi, [220, 340], { label: 'FI', onToggle: toggleAndNote });
    sch.switch(f.clk, [300, 280], { label: 'CLK', momentary: true, onToggle: toggleAndNote });
    sch.switch(f.clr, [300, clrY], { label: 'CLR', momentary: true, onToggle: toggleAndNote });
    d.add(sch.autoUpdate());

    // ---- EEPROM rewiring ----
    const rw = new Schematic(c, { width: 440, height: 150 });
    const u47 = rw.chip({ x: 150, y: 20 }, { label: '28C16', sublabel: 'U47', width: 100, height: 80, left: [{ name: 'A8', net: f.a8 }, { name: 'A9', net: f.a9 }, { name: 'A10', net: f.gnd }] });
    const u52 = rw.chip({ x: 310, y: 20 }, { label: '28C16', sublabel: 'U52', width: 100, height: 80, left: [{ name: 'A8', net: f.a8 }, { name: 'A9', net: f.a9 }, { name: 'A10', net: f.gnd }] });
    rw.wire(f.a8, [56, u47.left[0].y], u47.left[0]);
    rw.wire(f.a8, [120, u47.left[0].y], [120, 118], [275, 118], [275, u52.left[0].y], u52.left[0]);
    rw.wire(f.a9, [56, u47.left[1].y], u47.left[1]);
    rw.wire(f.a9, [110, u47.left[1].y], [110, 128], [284, 128], [284, u52.left[1].y], u52.left[1]);
    rw.dot(f.a8, [120, u47.left[0].y]);
    rw.dot(f.a9, [110, u47.left[1].y]);
    rw.wire(f.gnd, [130, u47.left[2].y], u47.left[2]);
    rw.wire(f.gnd, [290, u52.left[2].y], u52.left[2]);
    rw.text('GND', [288, u52.left[2].y], { anchor: 'end', size: 9 });
    const l8 = rw.text('CF', [52, u47.left[0].y], { anchor: 'end', size: 11 });
    const l9 = rw.text('ZF', [52, u47.left[1].y], { anchor: 'end', size: 11 });
    rw.text('GND', [126, u47.left[2].y], { anchor: 'end', size: 9 });
    rw.text('A0–A7: step, opcode, byte select', [270, 142], { size: 10 });
    d.add(rw.autoUpdate());
    const rewT = new Toggle({ label: 'After video 43: A8 = CF, A9 = ZF', value: true, onChange: (v) => {
      c.set(f.rewired, v ? 1 : 0);
      c.settle();
      setText(l8, v ? 'CF' : 'GND');
      setText(l9, v ? 'ZF' : 'GND');
      updNote();
    } });

    // ---- explanation ----
    let lastEdge: { fi: boolean; c: Level; z: Level } | null = null;
    const status = h('div', { class: 'callout' });
    const updNote = () => {
      const r = computeAlu(a, b, su);
      const live = `The ALU shows ${r.value}: carry ${r.carry}, zero ${r.zero} (live, 74LS02 + 74LS08 on the sum bits).`;
      let msg: string;
      if (f.clr.value === 1) msg = 'CLR (the reset button) is pressed: the 74LS173 is cleared, C = Z = 0.';
      else if (lastEdge && !lastEdge.fi) msg = `${live} The clock rose, but FI was low (so F̅I̅ = 1 disables the 173’s data inputs): the flags kept C = ${f.cf.value}, Z = ${f.zf.value}. This is what happens during LDA, LDI, OUT… only ADD and SUB assert FI.`;
      else if (lastEdge) msg = `${live} On the rising edge with FI high, the 173 latched C = ${lastEdge.c} and Z = ${lastEdge.z}.${f.cf.value !== r.carry || f.zf.value !== r.zero ? ' Now the ALU has changed but the flags remember the old result: exactly why the register is needed.' : ' Change A or B: the live values change, the flags stay.'}`;
      else msg = `${live} Turn FI on and press CLK to latch them into the flags register.`;
      if (f.rewired.value === 0) msg += ' (With A8/A9 tied to GND, as before this video, the EEPROMs could not see the flags at all.)';
      setText(status, msg);
    };

    // ---- timing ----
    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'FI', color: '#fbbf24' },
        { label: 'C4 (live)', color: '#f87171' },
        { label: 'zero (live)', color: '#fb923c' },
        { label: 'C flag', color: '#4ade80' },
        { label: 'Z flag', color: '#22d3ee' },
      ],
      { width: 620, laneHeight: 30 },
    );
    const nets = [f.clk, f.fi, f.c4, f.zero, f.cf, f.zf];
    const samples: Level[][] = nets.map(() => []);
    let acc = 0;
    d.add(
      animate((dt) => {
        acc += dt;
        while (acc > 1000 / 30) {
          acc -= 1000 / 30;
          nets.forEach((n, i) => {
            samples[i].push(n.value);
            if (samples[i].length > 180) samples[i].shift();
          });
        }
        if (acc > 500) acc = 0;
        scope.draw(samples, { window: 180 });
      }),
    );

    // ---- which instructions set the flags ----
    const setters = new Set(opcodesSettingFlags(UCODE_TEMPLATE_FLAGS));
    const fiTable = h(
      'table',
      { class: 'truth-table' },
      h('thead', null, h('tr', null, ['instruction', 'FI?', 'step'].map((x) => h('th', null, x)))),
      h(
        'tbody',
        null,
        [...INSTRUCTION_BY_OPCODE.values()].map((ins) => {
          const row4 = UCODE_TEMPLATE_FLAGS[ins.opcode];
          const st = row4.findIndex((w) => w & FI);
          return h('tr', { class: setters.has(ins.opcode) ? 'current' : '' }, h('td', null, ins.mnemonic), h('td', null, setters.has(ins.opcode) ? 'yes' : '—'), h('td', null, st >= 0 ? `T${st}: ${formatControlWord(row4[st])}` : ''));
        }),
      ),
    );

    // ---- the need for a flags register (whole computer) ----
    const m = new Machine({ microcodeVersion: 'flags' });
    m.loadSource(DEMO);
    m.setHz(4);
    d.add(animate((dt) => m.frame(dt))); // no ComputerView here, so drive the clock ourselves
    const tb = machineToolbar(m, { speeds: [1, 2, 4, 10] });
    d.add(tb.dispose);
    const trace = new MicrostepTrace(m, { max: 32, title: 'Trace: live ALU flags vs the flags register', showAlu: true, showFlags: true });
    d.add(() => trace.dispose());
    const origReset = m.reset.bind(m);
    m.reset = () => { origReset(); trace.clear(); };
    d.add(() => (m.reset = origReset));
    const liveC = new Led('red', 'live carry');
    const liveZ = new Led('orange', 'live zero');
    const cfL = new Led('green', 'C flag');
    const zfL = new Led('green', 'Z flag');
    const mText = h('div', { class: 'callout' });
    const cell = (led: Led, label: string) => h('span', { class: 'ledcell' }, led.el, label);
    const updM = () => {
      const cc = m.computer;
      const alu = cc.alu;
      liveC.set(alu.carry === 1);
      liveZ.set(alu.zero === 1);
      cfL.set(cc.flagC === 1);
      zfL.set(cc.flagZ === 1);
      const instr = cc.step < 2 ? 'fetch' : INSTRUCTION_BY_OPCODE.get(cc.opcode)?.mnemonic ?? '?';
      setText(
        mText,
        `T${cc.step} ${instr}: A = ${cc.a}, B = ${cc.b}, ALU = ${alu.value} (carry ${alu.carry}, zero ${alu.zero}); flags C = ${cc.flagC}, Z = ${cc.flagZ}. ` +
          (cc.flagC && !alu.carry ? 'The ALU’s carry has gone (A changed), but the flags register still says C = 1: a JC now would still know that 255 + 1 overflowed.' : cc.halted ? 'Halted.' : 'Watch T4 of ADD: EO|AI|FI. A and the flags latch at the same edge, from the same ALU result.'),
      );
    };
    d.add(m.onChange(updM));
    const mView = h('div', { class: 'row' }, cell(liveC, 'ALU C'), cell(liveZ, 'ALU Z'), cell(cfL, 'flag C'), cell(zfL, 'flag Z'));

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('ALU', { accent: 'red', chips: '74LS283 ×2, 74LS86 ×2' }, row(aSw.el), row(bSw.el), suT.el, row(sumBar.el, h('span', { class: 'ledcell' }, carryLed.el, 'C4')), aluEq, row(...presets.map((p) => p.el))),
        panel('Which instructions set the flags', { accent: 'gray' }, fiTable, note('FI is asserted only in T4 of ADD and SUB, together with EO|AI. So LDA, LDI, STA, OUT… leave the flags alone: to test A for zero you have to ADD or SUB something.')),
      ),
      panel('Zero detector and flags register', { accent: 'green', chips: '74LS02 (U22), 74LS08 (U23), 74LS173 (U19), spare 74LS04 gate' }, sch.el, status, scope.el, note('Zero = all 8 sum bits low: four NOR gates check pairs of bits, three AND gates combine them. FI is active low at the 173 (its G̅ inputs), so it uses a spare 74LS04 gate on the control board. Click FI, then press CLK; CLR is the reset line.')),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Flags to the microcode EEPROMs', { accent: 'blue', subtitle: 'A8 and A9 of both chips' }, rw.el, rewT.el, note('Before this video A8, A9 and A10 of both EEPROMs were tied to GND. Ben removes the ties on A8 and A9, links A8 left to A8 right and A9 left to A9 right, and connects CF to A8 and ZF to A9. A10 stays at GND. The microcode can now depend on the flags (next video).')),
        panel('Why latch? Run it', { accent: 'red', subtitle: '255 + 1, then LDA' }, tb.el, mView, mText, note('The program adds 255 + 1 (result 0: carry and zero), then loads 7. The live ALU outputs change with every step; the flags register keeps the result of the ADD.')),
      ),
      trace.el,
    );
    root.appendChild(wrap);
    updAlu();
    m.changed();
    return d.dispose;
  },
});
