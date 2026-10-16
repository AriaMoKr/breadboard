import type { Net } from '../../logic/circuit';
import { LedBar, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, s, setClass, setText } from '../../ui/dom';
import { Schematic, switchPitch } from '../../ui/schematic';
import { defineLab } from '../types';
import { BitRow, labFrame, levelLegend, truthTable } from '../registers/_shared';
import { LS283_PINS, aluDetail, bitOf, buildAlu8, netsValue, toBinSpaced, toSigned } from './_model';

/**
 * Video 15 — "ALU Design".
 * Σ = A + (B XOR SU) + SU using two 74LS86 (8 XOR gates) and two 74LS283
 * 4-bit adders with the carry chained from U21 (bits 3-0) to U20 (bits 7-4).
 */

const sg = (v: number) => (v < 0 ? `−${-v}` : `+${v}`);

export default defineLab({
  id: 'alu-design',
  title: 'ALU design',
  summary:
    'Ben’s ALU only adds and subtracts, but that is enough. Two 74LS283 4-bit adders, with the carry out of the low one feeding the carry in of the high one, add A and B all the time. For subtraction the SU line inverts every bit of B through 74LS86 XOR gates (B XOR 1 = NOT B) and also feeds a 1 into the carry input, so the ALU computes A + NOT B + 1, which in two’s complement is A − B. Set A and B, flip SU, and follow the wires.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d);

    // ---- circuit ----
    const { c, A, B, SU, BX, S, C4L, COUT } = buildAlu8(9, 5);
    const num = netsValue;

    // ---- schematic ----
    // the A and B switches sit level with the 74LS283 pins: 230 / 9 apart, wider on touch screens
    const chipH = 9 * switchPitch(230 / 9);
    const grow = chipH - 230; // per chip
    const sch = new Schematic(c, { width: 390, height: 612 + 2 * grow });
    const SU_X = 96;
    const slice = (y0: number, lo: number, name: string, c0: Net, c4: Net) => {
      const bits = [3, 2, 1, 0].map((k) => lo + k);
      const chip = sch.chip({ x: 200, y: y0 }, {
        label: '74LS283',
        sublabel: `${name} · bits ${lo + 3}-${lo}`,
        width: 108,
        height: chipH,
        left: [
          ...bits.map((b) => ({ name: `${LS283_PINS.A[b - lo]} A${b - lo + 1}`, net: A[b] })),
          ...bits.map((b) => ({ name: `${LS283_PINS.B[b - lo]} B${b - lo + 1}`, net: BX[b] })),
        ],
        right: bits.map((b) => ({ name: `Σ${b - lo + 1} ${LS283_PINS.S[b - lo]}`, net: S[b] })),
        top: [{ name: `C4 ${LS283_PINS.C4}`, net: c4 }],
        bottom: [{ name: `C0 ${LS283_PINS.C0}`, net: c0 }],
      });
      // A inputs straight in
      bits.forEach((b, k) => {
        const p = chip.left[k];
        sch.wire(A[b], [60, p.y], p);
        sch.switch(A[b], [60, p.y], { label: `A${b}`, onToggle: flip });
      });
      // B through the XOR gates
      // the 74LS86 package: four XOR gates inside one chip outline
      const top = chip.left[4].y - 20, bottom = chip.left[7].y + 30;
      sch.el.querySelector('.sch-parts')!.appendChild(s('rect', { x: 104, y: top, width: 66, height: bottom - top, rx: 5, style: 'fill:color-mix(in srgb, var(--panel-2) 60%, transparent);stroke:var(--fg-dim);stroke-width:1.5' }));
      sch.text('74LS86', [137, bottom - 9], { size: 9 });
      bits.forEach((b, k) => {
        const p = chip.left[4 + k];
        const g = sch.gate('XOR', { x: 120, y: p.y }, { scale: 0.75, output: BX[b] });
        sch.wire(B[b], [60, g.inputs[0].y], g.inputs[0]);
        sch.switch(B[b], [60, g.inputs[0].y], { label: `B${b}`, onToggle: flip });
        sch.wire(SU, [SU_X, g.inputs[1].y], g.inputs[1]);
        sch.dot(SU, [SU_X, g.inputs[1].y]);
        sch.wire(BX[b], g.output, p);
      });
      // sum outputs
      chip.right.forEach((p, k) => {
        const b = bits[k];
        sch.wire(S[b], p, [344, p.y]);
        sch.probe(S[b], [344, p.y], { label: `Σ${b}`, color: 'red' });
      });
      return chip;
    };
    const hi = slice(40, 4, 'U20', C4L, COUT);
    const lo = slice(336 + grow, 0, 'U21', SU, C4L);
    // carry chain U21 C4 → U20 C0
    sch.wire(C4L, lo.top[0], hi.bottom[0]);
    sch.text('carry', [lo.top[0].x + 6, (lo.top[0].y + hi.bottom[0].y) / 2], { size: 10, anchor: 'start', class: 'gate-label' });
    // carry out
    sch.wire(COUT, hi.top[0], [hi.top[0].x, 16], [330, 16]);
    sch.probe(COUT, [338, 16], { label: 'C', color: 'yellow' });
    // SU line: all XOR gates + carry in of U21
    sch.wire(SU, [SU_X, 22], [SU_X, 596 + 2 * grow], [lo.bottom[0].x, 596 + 2 * grow], lo.bottom[0]);
    sch.switch(SU, [SU_X, 22], { label: 'SU', onToggle: flip });
    d.add(sch.autoUpdate());

    // ---- HTML inputs ----
    const aRow = new BitRow({ bits: 8, value: num(A), label: 'A', weights: [128, 64, 32, 16, 8, 4, 2, 1], onChange: (v) => setBus(A, v) });
    const bRow = new BitRow({ bits: 8, value: num(B), label: 'B', weights: [128, 64, 32, 16, 8, 4, 2, 1], onChange: (v) => setBus(B, v) });
    const suT = new Toggle({ label: 'SU (subtract)', onChange: (v) => { c.set(SU, v ? 1 : 0); c.settle(); } });
    const sumBar = new LedBar({ bits: 8, color: 'red', label: 'Σ', formats: ['bin', 'dec', 'sdec'] });
    const carryLed = new LedBar({ bits: 1, color: 'yellow', label: 'carry out' });
    function flip(n: Net) { c.toggle(n); c.settle(); }
    function setBus(nets: Net[], v: number) {
      nets.forEach((n, i) => c.set(n, bitOf(v, i)));
      c.settle();
    }

    const eq = h('table', { class: 'dp-sum' });
    const status = h('div', { class: 'callout' });
    const xorTT = truthTable(['B', 'SU', 'B XOR SU', ''], [
      ['0', '0', '0', 'B passes'],
      ['1', '0', '1', 'B passes'],
      ['0', '1', '1', 'inverted'],
      ['1', '1', '0', 'inverted'],
    ], { caption: 'Highlighted: bit 0 of B right now' });
    const readout = h('div', { class: 'dp-eq' });

    const update = () => {
      const a = num(A), b = num(B), su = SU.value === 1;
      const det = aluDetail(a, b, su);
      aRow.set(a);
      bRow.set(b);
      suT.set(su);
      const sum = num(S);
      sumBar.set(sum);
      carryLed.set(COUT.value === 1 ? 1 : 0);
      xorTT.highlight((su ? 2 : 0) + bitOf(b, 0));
      const cell = (t: string, cls = '') => h('td', { class: cls }, t);
      eq.replaceChildren(
        h('tr', null, cell('A', 'dim'), cell(''), cell(toBinSpaced(a, 8)), cell(String(a)), cell(sg(toSigned(a)), 'dim')),
        h('tr', null, cell(su ? 'B XOR 1 (= NOT B)' : 'B XOR 0 (= B)', 'dim'), cell('+'), cell(toBinSpaced(det.bx, 8)), cell(String(det.bx)), cell(sg(toSigned(det.bx)), 'dim')),
        h('tr', null, cell('carry in = SU', 'dim'), cell('+'), cell(su ? '1' : '0'), cell(''), cell('')),
        h('tr', { class: 'rule' }, cell('Σ', 'dim'), cell(det.carry ? '1' : '', 'carry'), cell(toBinSpaced(sum, 8)), cell(String(sum)), cell(sg(toSigned(sum)), 'dim')),
      );
      const exact = su ? a - b : a + b;
      const sExact = su ? toSigned(a) - toSigned(b) : toSigned(a) + toSigned(b);
      const ovf = sExact < -128 || sExact > 127;
      setText(readout, `Σ = A + (B XOR SU) + SU = ${a} + ${det.bx} + ${su ? 1 : 0} = ${a + det.bx + (su ? 1 : 0)} → ${sum} (8 bits), carry ${det.carry}`);
      const parts: string[] = [];
      if (!su) {
        parts.push(`SU = 0: the XOR gates pass B through unchanged and the carry in is 0, so Σ = A + B = ${a} + ${b} = ${exact}.`);
        parts.push(det.carry ? `That doesn’t fit in 8 bits: the 9th bit comes out as the carry (C = 1) and Σ shows ${sum} (= ${exact} − 256).` : 'No carry: the unsigned answer fits in 8 bits.');
      } else {
        parts.push(`SU = 1: every XOR inverts its B bit, so the adder sees NOT B = ${toBinSpaced(det.bx, 8)}, and SU also feeds a 1 into the carry input of U21. NOT B + 1 is −B in two’s complement, so Σ = A − B = ${a} − ${b}.`);
        parts.push(det.carry ? `Carry out = 1 means no borrow: A ≥ B (unsigned), and Σ = ${exact}.` : `Carry out = 0 means a borrow: B > A, so the unsigned result wrapped to ${sum}; read as two’s complement that is ${toSigned(sum)}.`);
      }
      parts.push(ovf ? `As signed numbers (${sg(toSigned(a))} ${su ? '−' : '+'} ${sg(toSigned(b))} = ${sExact}) this overflows the range −128…127.` : `As signed numbers: ${sg(toSigned(a))} ${su ? '−' : '+'} ${sg(toSigned(b))} = ${sg(toSigned(sum))}.`);
      setText(status, parts.join(' '));
      setClass(status, 'good', su && det.carry === 1);
    };
    d.add(c.onChange(update));

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('ALU schematic', { accent: 'red', chips: '74LS283 ×2 (U20, U21), 74LS86 ×2 (XOR pins 1,2→3 · 4,5→6 · 9,10→8 · 12,13→11), 74LS245 to the bus (EO)' }, sch.el, levelLegend(), note('Click any A or B switch, or SU. Pin numbers are next to the pin names. U21’s C4 (pin 9) feeds U20’s C0 (pin 7).')),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Inputs', { accent: 'red', subtitle: 'from the A and B registers' }, aRow.el, bRow.el, suT.el),
          panel('Result', { accent: 'red' }, row(sumBar.el, carryLed.el), h('div', { class: 'dp-scroll' }, eq), readout, status),
          panel('XOR as a controllable inverter', { accent: 'gray', chips: '74LS86: 4 XOR gates per chip, 8 in total' }, xorTT.el),
          panel(
            'Why A + NOT B + 1?',
            { accent: 'gray' },
            note('In two’s complement −B is “invert B and add 1”. So A − B = A + (NOT B) + 1. The XOR gates do the inverting only when SU = 1, and instead of a separate +1 circuit, Ben uses the carry input of the low adder, which is otherwise unused: SU goes straight into C0.'),
            note('For subtraction the carry out is the opposite of a borrow: C = 1 means A ≥ B, C = 0 means the result went below zero. The CPU flags video later uses exactly this.'),
            note('The ALU is purely combinational: it is always computing. A 74LS245 (enabled by ~EO, “Σ out”) decides when the result is put on the bus.'),
          ),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
