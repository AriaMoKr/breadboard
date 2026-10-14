import { Circuit, type Level } from '../../logic/circuit';
import { bin, hex } from '../../sim/assembler';
import { HEX_DIGITS } from '../../sim/display';
import { Button, DipSwitch, Led, LedBar, Scope, SevenSegment, Toggle, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { badge, ledCell, makeHexDump, scopedStyle, stepList } from '../ram/_ui';
import { defineLab } from '../types';
import { Eeprom28C16, HEX_CA, T_WP_MAX_NS, T_WP_MIN_NS, checkWritePulse, rcPulseNs } from './_shared';

const CSS = `
.eeprom-lab .big7 { display: inline-flex; background: #0b0b0d; padding: 8px; border-radius: 8px; }
`;

type PulseKind = 'rc' | 'rc100n' | 'button' | 'glitch';
const PULSES: Record<PulseKind, { label: string; ns: number }> = {
  rc: { label: 'RC one-shot, 680 Ω × 1 nF', ns: Math.round(rcPulseNs(680, 1e-9)) },
  rc100n: { label: '680 Ω × 100 nF (description’s part)', ns: Math.round(rcPulseNs(680, 100e-9)) },
  button: { label: 'push button straight to W̅E̅ (~150 ms)', ns: 150e6 },
  glitch: { label: 'a 50 ns glitch', ns: 50 },
};
const fmtNs = (ns: number) => (ns >= 1e6 ? `${+(ns / 1e6).toPrecision(3)} ms` : ns >= 1000 ? `${+(ns / 1000).toPrecision(3)} µs` : `${Math.round(ns)} ns`);

export default defineLab({
  id: 'eeprom',
  title: 'Using an EEPROM as logic',
  summary:
    'An EEPROM is a memory you can write electrically and that keeps its data without power. The 28C16 stores 2048 bytes: 11 address lines in, 8 data lines out. Ben wires A0-A3 to a DIP switch and the data lines to LEDs, then writes bytes by hand: set the address and data switches, take O̅E̅ high and pulse W̅E̅ low for under a microsecond. Once the hex-digit patterns are stored, the 4 address switches drive a 7-segment display through the chip. Any truth table can be stored this way and read back as a lookup.',
  mount(root) {
    const d = new Disposer();
    const dump = makeHexDump();
    d.add(scopedStyle(root, CSS + dump.css));
    root.classList.add('eeprom-lab');

    const rom = new Eeprom28C16();
    const st = { addr: 0, data: 0, ceN: 0 as 0 | 1, writeMode: false, pulse: 'rc' as PulseKind, ca: true };
    let now = 0;
    let busyUntil = 0;
    let flashAddr = -1;
    let lastPulseNs = 0;
    let lastResult: ReturnType<Eeprom28C16['write']> | null = null;
    /** Show the write result until the next control change. */
    let showResult = false;
    const flags = { write: false, addr: false, data: false, readBack: false };

    // ---- I/O line resolution: EEPROM outputs vs data switches (to +5 V, 10 kΩ pull-downs) ----
    const oeN = () => (st.writeMode ? 1 : 0) as 0 | 1;
    const ioLevels = (): Level[] => {
      const out = rom.output(st.addr, st.ceN, oeN(), 1);
      return Array.from({ length: 8 }, (_, b) => {
        const sw = (st.data >> b) & 1;
        if (out === null) return sw as 0 | 1;
        const e = (out >> b) & 1;
        if (sw === 1 && e === 0) return 'X';
        return e as 0 | 1;
      });
    };
    const ioValue = (lv: Level[]) => lv.reduce<number>((v, l, b) => v | ((l === 1 ? 1 : 0) << b), 0);

    // ---- schematic ----
    const c = new Circuit();
    const nA = Array.from({ length: 11 }, (_, i) => c.input(`A${i}`, 0));
    const nIO = Array.from({ length: 8 }, (_, i) => c.input(`I/O${i}`, 0));
    const nCE = c.input('C̅E̅', 0);
    const nOE = c.input('O̅E̅', 0);
    const nWE = c.input('W̅E̅', 1);
    const addrPins = [8, 7, 6, 5, 4, 3, 2, 1, 23, 22, 19];
    const ioPins = [9, 10, 11, 13, 14, 15, 16, 17];
    const sch = new Schematic(c, { width: 420, height: 330 });
    const chip = sch.chip([150, 20], {
      label: '28C16',
      sublabel: '2K × 8 EEPROM',
      width: 120,
      left: nA.map((n, i) => ({ name: `${addrPins[i]} A${i}`, net: n })),
      right: nIO.map((n, i) => ({ name: `I/O${i} ${ioPins[i]}`, net: n })),
      bottom: [{ name: 'C̅E̅', net: nCE, bubble: true }, { name: 'O̅E̅', net: nOE, bubble: true }, { name: 'W̅E̅', net: nWE, bubble: true }],
    });
    nA.forEach((n, i) => {
      const p = chip.left[i];
      sch.wire(n, [100, p.y], p);
      sch.switch(n, [100, p.y], { label: `A${i}`, onToggle: () => { st.addr ^= 1 << i; flags.addr = true; refresh(); } });
    });
    nIO.forEach((n, i) => {
      const p = chip.right[i];
      sch.wire(n, p, [352, p.y]);
      sch.probe(n, [360, p.y], { color: 'red' });
    });
    sch.text('LEDs (330 Ω)', [360, 290], { size: 10, class: 'cap' });
    const labels = ['C̅E̅', 'O̅E̅', 'W̅E̅'];
    chip.bottom.forEach((p, i) => {
      const net = [nCE, nOE, nWE][i];
      sch.wire(net, p, [p.x, p.y + 14]);
      sch.text(labels[i], [p.x, p.y + 24], { size: 10 });
    });
    d.add(sch.autoUpdate());

    // ---- controls ----
    const loDip = new DipSwitch({ bits: 4, label: 'A3-A0', onChange: (v) => { st.addr = (st.addr & ~15) | v; flags.addr = true; refresh(); } });
    const hiDip = new DipSwitch({ bits: 7, label: 'A10-A4', onChange: (v) => { st.addr = (st.addr & 15) | (v << 4); refresh(); } });
    const dataDip = new DipSwitch({ bits: 8, label: 'I/O7-0', onChange: (v) => { st.data = v; flags.data = true; refresh(); } });
    const modeToggle = new Toggle({ label: 'Write mode (O̅E̅ high)', onLabel: 'O̅E̅ = 1', offLabel: 'O̅E̅ = 0, reading', onChange: (v) => { st.writeMode = v; refresh(); } });
    const ceToggle = new Toggle({ label: 'C̅E̅ high (chip disabled)', onChange: (v) => { st.ceN = v ? 1 : 0; refresh(); } });
    const pulseSel = select((Object.keys(PULSES) as PulseKind[]).map((k) => ({ value: k, label: `${PULSES[k].label}: ${fmtNs(PULSES[k].ns)}` })), st.pulse, (v) => { st.pulse = v; drawPulse(PULSES[v].ns); refresh(); }, 'W̅E̅ pulse');
    const weBtn = new Button({
      label: 'Pulse W̅E̅',
      kind: 'primary',
      onClick: () => {
        const ns = PULSES[st.pulse].ns;
        lastPulseNs = ns;
        const data = ioValue(ioLevels());
        lastResult = rom.write(st.addr, data, { ceN: st.ceN, oeN: oeN(), pulseNs: ns });
        if (lastResult.stored) {
          busyUntil = now + 400;
          flashAddr = st.addr;
          flags.write = true;
          flags.readBack = false;
        }
        drawPulse(ns);
        showResult = true;
        refresh(false);
      },
    });
    const caToggle = new Toggle({ label: 'Common-anode display (lit = 0), as in Ben’s video', value: st.ca, onChange: (v) => { st.ca = v; refresh(); } });
    const progAll = new Button({ label: 'Program the whole hex table', onClick: () => { (st.ca ? HEX_CA : HEX_DIGITS).forEach((v, a) => (rom.mem[a] = v)); flags.write = true; refresh(); } });
    const erase = new Button({ label: 'Erase (all 0xFF)', kind: 'danger', onClick: () => { rom.erase(); refresh(); } });

    const ioBar = new LedBar({ bits: 8, color: 'red', formats: ['bin', 'hex'], label: 'I/O LEDs' });
    const busyLed = new Led('yellow', 'write cycle in progress');
    const writeBadge = badge();
    const seg = new SevenSegment({ height: 96 });
    const segText = h('div', { class: 'small dim' });
    const status = h('div', { class: 'callout' });
    const lookup = h('div', { class: 'callout' });
    const steps = stepList([
      'Flip to write mode: O̅E̅ high turns the EEPROM’s outputs off, so the data switches can drive the I/O lines.',
      'Set the address on A3-A0, e.g. 0000 for the digit 0.',
      'Set the data switches to the segment pattern (common anode: 1000 0001 = 0x81 for “0”).',
      'Pulse W̅E̅ low. The chip latches the address on the falling edge and the data on the rising edge, then needs up to 1 ms to store it.',
      'Turn the data switches off and go back to read mode: the LEDs and the display show the stored byte.',
    ]);

    // ---- write pulse scope ----
    const scope = new Scope(
      [
        { label: 'W̅E̅', color: '#f87171' },
        { label: `rising edge allowed (${T_WP_MIN_NS}-${T_WP_MAX_NS} ns)`, color: '#4ade80' },
      ],
      { width: 640, laneHeight: 44 },
    );
    const scopeInfo = h('div', { class: 'mono small' });
    const drawPulse = (ns: number) => {
      const span = Math.max(2000, ns * 1.6);
      const n = 300;
      const t0 = -0.15 * span;
      const we: Level[] = [];
      const ok: Level[] = [];
      for (let i = 0; i < n; i++) {
        const t = t0 + (span * i) / (n - 1);
        we.push(t >= 0 && t < ns ? 0 : 1);
        ok.push(t >= T_WP_MIN_NS && t <= T_WP_MAX_NS ? 1 : 0);
      }
      scope.draw([we, ok], { window: n });
      const chk = checkWritePulse(ns);
      setText(scopeInfo, `pulse ${fmtNs(ns)} · window shown ${fmtNs(span)} · ${chk === 'ok' ? 'within spec' : chk === 'too-short' ? 'too short' : 'too long: out of spec'}`);
    };

    const pageText = h('div', { class: 'small dim' });

    const refresh = (userChange = true) => {
      if (userChange) showResult = false;
      const lv = ioLevels();
      const val = ioValue(lv);
      nA.forEach((n, i) => c.set(n, ((st.addr >> i) & 1) as 0 | 1));
      nIO.forEach((n, i) => c.set(n, lv[i]));
      c.set(nCE, st.ceN);
      c.set(nOE, oeN());
      c.set(nWE, 1);
      if (loDip.value !== (st.addr & 15)) loDip.set(st.addr & 15);
      if (hiDip.value !== st.addr >> 4) hiDip.set(st.addr >> 4);
      ioBar.setLevels([...lv].reverse());
      const reading = !st.writeMode && st.ceN === 0;
      const contention = lv.includes('X');
      if (reading && !contention && flags.write) flags.readBack = true;
      seg.set(st.ca ? ~val & 0xff : val);
      setText(segText, st.ca ? `display: common anode, a segment lights where its line is 0 (pattern ${bin(val, 8)})` : `display: common cathode, a 1 lights the segment`);
      if (lastResult) writeBadge.set(`${lastResult.stored ? 'stored' : 'not stored'} · ${fmtNs(lastPulseNs)}`, lastResult.stored ? (lastResult.check === 'ok' ? 'ok' : 'warn') : 'bad');
      setText(
        status,
        st.ceN === 1
          ? 'C̅E̅ is high: the whole chip is disabled. Its outputs float and it ignores W̅E̅. Ben ties C̅E̅ to ground.'
          : contention
            ? 'Reading, but some data switches are on: those switches pull an I/O line high while the EEPROM drives it low (orange). Turn the data switches off before reading, as Ben does.'
            : lastResult && showResult
              ? lastResult.reason
              : st.writeMode
                ? `Write mode: O̅E̅ is high, so the EEPROM’s outputs are off and the I/O lines show the data switches (${bin(st.data, 8)}). A W̅E̅ pulse stores them at address ${st.addr} (0x${hex(st.addr, 3)}).`
                : `Read mode: C̅E̅ and O̅E̅ are low, so the EEPROM drives the byte at address ${st.addr} (0x${hex(st.addr, 3)}) onto the I/O lines: ${bin(val, 8)} = 0x${hex(val)}.${rom.mem[st.addr] === 0xff ? ' An erased byte reads FF.' : ''}`,
      );
      setText(lookup, `As a lookup table, address ${bin(st.addr & 15, 4)} goes in and ${bin(rom.mem[st.addr], 8)} comes out. The address lines are the inputs of a truth table and the stored bytes are its output columns, so this one chip can replace the whole hex decoder from the last video, or any other combinational logic with up to 11 inputs and 8 outputs.`);
      steps.set([st.writeMode, flags.addr, flags.data, flags.write, flags.readBack], !st.writeMode && !flags.write ? 0 : !flags.addr ? 1 : !flags.data ? 2 : !flags.write ? 3 : !flags.readBack ? 4 : -1);
      // hex dump
      const page = st.addr & 0x700;
      setText(pageText, `page 0x${hex(page, 3)}-0x${hex(page + 255, 3)} (A10-A8 = ${bin(page >> 8, 3)})`);
      dump.update(rom.mem, page, st.addr, now < busyUntil ? flashAddr : -1);
    };

    d.add(
      animate((dt) => {
        now += dt;
        busyLed.set(now < busyUntil);
        if (flashAddr >= 0 && now >= busyUntil) {
          flashAddr = -1;
          refresh(false);
        }
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            '28C16 EEPROM',
            { accent: 'red', chips: '28C16, 8 LEDs + 330 Ω, 12 × 10 kΩ pull-downs' },
            sch.el,
            row(loDip.el, hiDip.el),
            note('Ben wires only A0-A3 to switches and ties A4-A10 to ground; you can use all 11 address lines here.'),
            row(dataDip.el),
            row(modeToggle.el, ceToggle.el),
            row(pulseSel, weBtn.el, ledCell(busyLed, 'busy'), writeBadge.el),
            row(ioBar.el),
            status,
          ),
          panel('Programming by hand', { accent: 'gray' }, steps.el),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('ROM as combinational logic', { accent: 'red', subtitle: 'the EEPROM drives the display' }, row(h('span', { class: 'big7' }, seg.el), h('div', { class: 'mo-col' }, caToggle.el, segText, row(progAll.el, erase.el))), lookup),
          panel('W̅E̅ pulse timing', { accent: 'yellow', subtitle: '28C16 datasheet: t_WP 100 ns min, 1000 ns max' }, scope.el, scopeInfo, note('The address is latched on the falling edge of W̅E̅ and the data on the rising edge; then the chip times its own write cycle (up to 1 ms). A push button stays low for a long time, which is outside the datasheet’s 1 µs maximum, so Ben shapes the press into a short pulse with a resistor and capacitor. Exactly which R and C he used is not certain.')),
          panel('Memory contents', { accent: 'gray', subtitle: 'hex dump of the current 256-byte page' }, pageText, dump.el),
        ),
      ),
    );
    drawPulse(PULSES[st.pulse].ns);
    refresh();
    return d.dispose;
  },
});
