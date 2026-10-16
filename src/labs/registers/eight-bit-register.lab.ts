import type { Bit, Net } from '../../logic/circuit';
import { Button, DipSwitch, LedBar, Toggle, note, panel, readouts, row } from '../../ui/components';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { LS173_PINS, LS245_PINS, buildARegister } from './_model';
import { bin8, labFrame, levelLegend } from './_shared';

/**
 * Video 12 — "Building an 8-bit register".
 * The A register: two 74LS173 (U8 = bits 7-4, U9 = bits 3-0) whose outputs
 * are always on (M = N = GND) and drive the LEDs, plus a 74LS245 (U7) with
 * DIR = +5 V and ~OE = ~AO that puts the register on the bus.
 */
export default defineLab({
  id: 'eight-bit-register',
  title: 'An 8-bit register',
  summary:
    'Two 74LS173 4-bit registers hold the 8 bits, and a 74LS245 connects them to the bus. The 173s’ own tri-state outputs are left permanently on (M and N grounded) so the LEDs always show what is stored; the 245 decides when the register drives the bus. Both control lines are active low: pull ~LOAD (later ~AI) low and pulse the clock to load the bus; pull ~ENABLE (~AO) low to put the register on the bus. Use the switches as a temporary bus driver, like Ben’s jumper wires.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d);

    // ---- circuit ----
    const START = 0b00101010;
    const reg = buildARegister(START);
    const { c, GND, VCC, sw, swEn, nAI, nAO, CLK, CLR, bus, q } = reg;
    const set = (n: Net, v: Bit) => { c.set(n, v); c.settle(); };
    const flip = (n: Net) => { c.toggle(n); c.settle(); };

    // ---- schematic ----
    const sch = new Schematic(c, { width: 560, height: 520 });
    const p173 = (bits: number[]) => [
      ...bits.map((b, k) => ({ name: `${LS173_PINS[`${4 - k}D` as '4D']} ${4 - k}D`, net: bus[b] })),
      { name: `${LS173_PINS.G1} G1`, net: nAI, bubble: true },
      { name: `${LS173_PINS.G2} G2`, net: nAI, bubble: true },
      { name: `${LS173_PINS.CLK} CLK`, net: CLK },
      { name: `${LS173_PINS.CLR} CLR`, net: CLR },
    ];
    const q173 = (bits: number[]) => bits.map((b, k) => ({ name: `${4 - k}Q ${LS173_PINS[`${4 - k}Q` as '4Q']}`, net: q[b] }));
    const chipU8 = sch.chip({ x: 130, y: 40 }, { label: '74LS173', sublabel: 'U8 · bits 7-4', width: 118, height: 180, left: p173([7, 6, 5, 4]), right: q173([7, 6, 5, 4]), top: [{ name: 'M', net: GND, bubble: true }, { name: 'N', net: GND, bubble: true }] });
    const chipU9 = sch.chip({ x: 130, y: 280 }, { label: '74LS173', sublabel: 'U9 · bits 3-0', width: 118, height: 180, left: p173([3, 2, 1, 0]), right: q173([3, 2, 1, 0]), top: [{ name: 'M', net: GND, bubble: true }, { name: 'N', net: GND, bubble: true }] });
    const chip245 = sch.chip({ x: 350, y: 150 }, {
      label: '74LS245',
      sublabel: 'U7',
      width: 120,
      height: 180,
      left: [7, 6, 5, 4, 3, 2, 1, 0].map((b) => ({ name: `${LS245_PINS.A[b]} A${b + 1}`, net: q[b] })),
      right: [7, 6, 5, 4, 3, 2, 1, 0].map((b) => ({ name: `B${b + 1} ${LS245_PINS.B[b]}`, net: bus[b] })),
      top: [{ name: 'DIR 1', net: VCC }],
      bottom: [{ name: '~OE 19', net: nAO, bubble: true }],
    });
    const netLabel = (net: Net, from: { x: number; y: number }, x: number, text: string, anchor: 'start' | 'end') => {
      sch.wire(net, [x, from.y], from);
      sch.text(text, [anchor === 'end' ? x - 4 : x + 4, from.y], { size: 10, anchor });
    };
    for (const [chip, bits] of [[chipU8, [7, 6, 5, 4]], [chipU9, [3, 2, 1, 0]]] as const) {
      bits.forEach((b, k) => netLabel(bus[b], chip.left[k], 72, `BUS ${b}`, 'end'));
      netLabel(nAI, chip.left[4], 72, '~AI', 'end');
      netLabel(nAI, chip.left[5], 72, '~AI', 'end');
      netLabel(CLK, chip.left[6], 72, 'CLK', 'end');
      netLabel(CLR, chip.left[7], 72, 'CLR', 'end');
      for (const t of chip.top) sch.wire(GND, t, [t.x, t.y - 8]);
      sch.text('GND', [(chip.top[0].x + chip.top[1].x) / 2, chip.top[0].y - 14], { size: 10 });
      sch.wire(GND, [chip.top[0].x, chip.top[0].y - 8], [chip.top[1].x, chip.top[1].y - 8]);
    }
    // Q outputs: register LEDs + wires to the 245's A side
    const midX: Record<number, number> = { 7: 326, 6: 316, 5: 306, 4: 296, 3: 296, 2: 306, 1: 316, 0: 326 };
    const qPins = [...chipU8.right.map((p, k) => [7 - k, p] as const), ...chipU9.right.map((p, k) => [3 - k, p] as const)];
    for (const [b, p] of qPins) {
      const a = chip245.left[7 - b];
      sch.route(q[b], p, a, { midX: midX[b] });
      sch.probe(q[b], [278, p.y], { color: 'red' });
      sch.text(`A${b}`, [278, p.y - 14], { size: 9, class: 'gate-label' });
    }
    // bus side
    chip245.right.forEach((p, k) => {
      const b = 7 - k;
      sch.wire(bus[b], p, [510, p.y]);
      sch.probe(bus[b], [504, p.y], { color: 'red' });
      sch.text(`BUS ${b}`, [516, p.y], { size: 10, anchor: 'start' });
    });
    sch.wire(VCC, chip245.top[0], [chip245.top[0].x, chip245.top[0].y - 10]);
    sch.text('+5 V', [chip245.top[0].x, chip245.top[0].y - 18], { size: 10 });
    sch.wire(nAO, chip245.bottom[0], [chip245.bottom[0].x, chip245.bottom[0].y + 12]);
    sch.text('~AO', [chip245.bottom[0].x, chip245.bottom[0].y + 22], { size: 10 });
    // control switches (each drives the net with that label)
    const ctl: [Net, string, boolean][] = [[nAI, '~AI', false], [nAO, '~AO', false], [CLK, 'CLK', true], [CLR, 'CLR', true]];
    ctl.forEach(([net, label, momentary], i) => {
      const y = 404 + i * 30;
      sch.wire(net, [450, y], [480, y]);
      sch.text(label, [484, y], { size: 10, anchor: 'start' });
      sch.switch(net, [450, y], { label, momentary, onToggle: flip });
    });
    d.add(sch.autoUpdate());

    // ---- HTML controls ----
    const dip = new DipSwitch({ bits: 8, value: START, label: 'switches', onChange: (v) => { sw.forEach((s, i) => c.set(s, ((v >> i) & 1) as Bit)); c.settle(); } });
    const swT = new Toggle({ label: 'Switches drive the bus', value: true, onChange: (v) => set(swEn, v ? 1 : 0) });
    const aiT = new Toggle({ label: 'LOAD: pull ~AI low', onChange: (v) => set(nAI, v ? 0 : 1) });
    const aoT = new Toggle({ label: 'ENABLE: pull ~AO low', onChange: (v) => set(nAO, v ? 0 : 1) });
    const clkB = new Button({ label: 'Clock pulse', kind: 'primary', onPress: () => set(CLK, 1), onRelease: () => set(CLK, 0) });
    const clrB = new Button({ label: 'Clear (CLR)', kind: 'danger', title: 'CLR is active high and asynchronous: no clock needed', onPress: () => set(CLR, 1), onRelease: () => set(CLR, 0) });
    const regBar = new LedBar({ bits: 8, color: 'red', label: 'register', formats: ['bin', 'dec'] });
    const busBar = new LedBar({ bits: 8, color: 'red', label: 'bus' });
    const busVal = h('span', { class: 'mono dim' });
    const ro = readouts(['~AI line', '~AO line', 'CLK', 'register', 'bus']);
    const status = h('div', { class: 'callout' });

    const update = () => {
      const val = reg.value();
      regBar.set(val);
      const lv = [...bus].reverse().map((n) => n.value);
      busBar.setLevels(lv);
      const busTxt = lv.map(String).join('');
      setText(busVal, busTxt);
      aiT.set(nAI.value === 0);
      aoT.set(nAO.value === 0);
      swT.set(swEn.value === 1);
      ro.set('~AI line', nAI.value === 0 ? '0 (LOW → load on the clock edge)' : '1 (high → hold)');
      ro.set('~AO line', nAO.value === 0 ? '0 (LOW → 245 drives the bus)' : '1 (high → 245 off)');
      ro.set('CLK', String(CLK.value));
      ro.set('register', `${bin8(val)} = ${val}`);
      ro.set('bus', busTxt.includes('Z') ? `${busTxt} (Z = floating)` : busTxt.includes('X') ? `${busTxt} (X = contention)` : `${busTxt} = ${parseInt(busTxt, 2)}`);
      const contention = bus.some((n) => n.value === 'X');
      const floating = bus.every((n) => n.value === 'Z');
      setClass(status, 'warn', contention);
      const msgs: string[] = [];
      if (CLR.value === 1) msgs.push('CLR is high: both 173s clear immediately, no clock needed (asynchronous clear, active high).');
      if (contention) msgs.push('Contention! The switches and the 245 are both driving the bus. In the real computer only one module’s output enable is ever low at a time. Disconnect the switches or release ~AO.');
      else if (floating) msgs.push('Nothing drives the bus, so all eight lines float. The 173 inputs are LS-TTL, and a floating TTL input reads 1: load now and you get 1111 1111, just like Ben did.');
      if (nAO.value === 0 && !contention) msgs.push(`~AO is low, so the 245 copies the register (A side) onto the bus (B side): the bus shows ${bin8(val)}.`);
      if (nAI.value === 0) msgs.push(nAO.value === 0 && !contention ? 'With ~AI low too, the register would reload its own value on the clock edge: harmless.' : `~AI is low: on the next rising CLK edge both 173s load the bus${floating ? ' (all 1s)' : contention ? ' (garbage)' : ` (${busTxt})`}.`);
      else if (CLR.value !== 1) msgs.push(`~AI is high, so G1/G2 are high and the 173s ignore the clock: the register holds ${val}.`);
      setText(status, msgs.join(' '));
    };
    d.add(c.onChange(update));

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('A register', { accent: 'red', chips: '74LS173 ×2 (U8, U9), 74LS245 (U7), 8 LEDs' }, sch.el, levelLegend(), note('Pin numbers are next to the pin names. Wires with the same label (BUS 3, ~AI, CLK…) are connected. Click the switches at the bottom right to change ~AI, ~AO, CLK and CLR.')),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Controls', { accent: 'blue' }, row(dip.el), swT.el, row(aiT.el, aoT.el), row(clkB.el, clrB.el)),
          panel('LEDs', { accent: 'red' }, regBar.el, row(busBar.el, busVal), ro.el),
          panel('What is happening', { accent: 'gray' }, status),
          panel(
            'Why active low?',
            { accent: 'gray' },
            note('The 74LS173 loads only when both data-enable pins G1 and G2 are LOW, and the 74LS245 drives its outputs only when ~OE is LOW. A bubble on a pin means active low. So the control lines are ~LOAD and ~ENABLE: 1 = do nothing, 0 = act.'),
            note('In the finished computer the control logic produces active-high signals (AI, AO) and 74LS04 inverters turn them into ~AI and ~AO for the chips.'),
            note('The 173s also have tri-state outputs (M, N). Ben grounds them so the outputs always drive the LEDs and the ALU, and uses the separate 245 for the bus.'),
          ),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
