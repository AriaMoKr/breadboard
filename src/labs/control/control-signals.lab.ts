import { Machine } from '../../sim/machine';
import { INSTRUCTION_BY_OPCODE, microIndex, UCODE_TEMPLATE_FLAGS } from '../../sim/microcode';
import { PROGRAM_BY_ID } from '../../sim/programs';
import { SIGNAL_BITS, SIGNAL_INFO, SIGNALS, formatControlWord, type ModuleId, type Signal } from '../../sim/signals';
import { Led, note, panel } from '../../ui/components';
import { ComputerView } from '../../ui/computer-view';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { defineLab } from '../types';
import { describeTransfer } from './_models';
import { highlightModules, machineToolbar, scopedStyle } from './_shared';

const MODULE_NAME: Record<ModuleId, string> = {
  clock: 'Clock', pc: 'Program counter', mar: 'Memory address register', ram: 'RAM', ir: 'Instruction register', a: 'A register',
  alu: 'ALU', b: 'B register', out: 'Output register', flags: 'Flags', control: 'Control logic', bus: 'Bus', input: 'Bus switches',
};

/** Where each control line ends up on Ben's boards (control.png / netlist). */
const HW: Record<Signal, string> = {
  HLT: 'Clock module: inverted by 74LS04 U4D and ANDed into CLK (U5C), so HLT high holds the clock low.',
  MI: 'MAR 74LS173 data-enable pins G̅1/G̅2 (active low), via a 74LS04 (U49).',
  RI: 'RAM write logic: NAND(RI, clock pulse) → 74LS157 → W̅E̅ of both 74LS189s. Active high, no inverter.',
  RO: 'RAM output 74LS245 C̅E̅ (pin 19, active low), via a 74LS04 (U49).',
  IO: 'Instruction register 74LS245 C̅E̅ (active low), via a 74LS04 (U49). Only the low 4 bits reach the bus.',
  II: 'Both instruction register 74LS173s G̅1/G̅2 (active low), via a 74LS04 (U49).',
  AI: 'A register 74LS173s G̅1/G̅2 (active low), via a 74LS04 (U49).',
  AO: 'A register 74LS245 C̅E̅ (active low), via a 74LS04 (U49).',
  EO: 'ALU (Σ) 74LS245 C̅E̅ (active low), via a 74LS04 (U53).',
  SU: 'The 8 XOR gates (74LS86) that invert B, and the carry-in of the low 74LS283. Active high.',
  BI: 'B register 74LS173s G̅1/G̅2 (active low), via a 74LS04 (U53).',
  OI: 'ANDed with CLK (74LS08) to clock the 74LS273 output register. Active high.',
  CE: 'Program counter 74LS161 CEP and CET (count enable). Active high.',
  CO: 'Program counter 74LS245 C̅E̅ (active low), via a 74LS04 (U53).',
  J: 'Program counter 74LS161 P̅E̅ (parallel load, active low), via a 74LS04 (U53).',
  FI: 'Flags 74LS173 G̅1/G̅2, via a spare 74LS04 gate (U53). Added in “CPU flags register”.',
};

const ROLE: Record<string, string> = { in: 'reads bus', out: 'drives bus', other: 'control' };

/** Worked table from the fetch/execute walkthrough: fetch, then LDA / ADD / OUT / HLT. */
const WALKTHROUGH: { label: string; opcode: number | null; step: number }[] = [
  { label: 'fetch', opcode: null, step: 0 },
  { label: 'fetch', opcode: null, step: 1 },
  { label: 'LDA', opcode: 0b0001, step: 2 },
  { label: 'LDA', opcode: 0b0001, step: 3 },
  { label: 'ADD', opcode: 0b0010, step: 2 },
  { label: 'ADD', opcode: 0b0010, step: 3 },
  { label: 'ADD', opcode: 0b0010, step: 4 },
  { label: 'OUT', opcode: 0b1110, step: 2 },
  { label: 'HLT', opcode: 0b1111, step: 2 },
];

function usedIn(sig: Signal): string {
  const out: string[] = [];
  UCODE_TEMPLATE_FLAGS.forEach((row, op) => {
    const mn = INSTRUCTION_BY_OPCODE.get(op)?.mnemonic;
    row.forEach((w, s) => {
      if (w & SIGNAL_BITS[sig] && mn && !(s < 2 && op > 0)) out.push(s < 2 ? `T${s} of every instruction` : `${mn} T${s}`);
    });
  });
  if (sig === 'J') out.push('JC/JZ T2 when the flag is set');
  return out.length ? out.join(', ') : 'nothing yet';
}

const CSS = `
.cs-lab table.sigs { border-collapse: collapse; font-size: 0.8rem; width: 100%; }
.cs-lab table.sigs th, .cs-lab table.sigs td { border-bottom: 1px solid var(--border); padding: 4px 6px; text-align: left; white-space: nowrap; }
.cs-lab table.sigs th { color: var(--fg-dim); font-weight: 600; font-size: 0.72rem; }
.cs-lab table.sigs tbody tr { cursor: pointer; }
.cs-lab table.sigs tbody tr:hover td { background: var(--panel-2); }
.cs-lab table.sigs tr.sel td { background: color-mix(in srgb, var(--accent-2) 16%, transparent); }
.cs-lab table.sigs tr.future td { opacity: 0.55; }
.cs-lab .pin { font-family: var(--mono); font-size: 0.75rem; }
.cs-lab .pin.lo { color: var(--wire-0); } .cs-lab .pin.hi { color: var(--wire-1); }
`;

export default defineLab({
  id: 'control-signals',
  title: 'Control signal overview',
  summary:
    'Every module has a few control lines: “in” signals that make a register latch the bus on the next clock edge, “out” signals that let a module drive the bus, and a few others like SU, CE and HLT. Ben brings all of them to one control area with an LED each, and inverts the active-low ones with 74LS04s so that 1 always means “do it”. Click a signal to see where it goes, then step through 28 + 14 and watch which signals light up in each micro-step.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'cs-lab lab-stack' });
    d.add(scopedStyle(wrap, CSS));

    const m = new Machine({ microcodeVersion: 'control-logic' });
    m.loadSource(PROGRAM_BY_ID.get('add')!.source);
    m.setHz(2);
    let selected: Signal = 'MI';

    const view = new ComputerView(m, {
      onModuleClick: (mod) => {
        const first = SIGNALS.find((s) => SIGNAL_INFO[s].module === mod);
        if (first) choose(first);
      },
    });
    d.add(() => view.dispose());
    const tb = machineToolbar(m, { keyboard: true, speeds: [1, 2, 5, 10] });
    d.add(tb.dispose);

    // ---- signal table ----
    const info = h('div', { class: 'callout' });
    const rows = SIGNALS.map((sig) => {
      const si = SIGNAL_INFO[sig];
      const logic = new Led('blue', `${sig} control LED`);
      const pin = h('span', { class: 'pin' });
      const tr = h(
        'tr',
        { class: sig === 'FI' ? 'future' : '', tabindex: 0, title: si.description },
        h('td', null, logic.el),
        h('td', { class: 'mono' }, h('strong', null, sig)),
        h('td', null, MODULE_NAME[si.module]),
        h('td', { class: 'dim' }, ROLE[si.role]),
        h('td', { class: 'mono' }, si.activeLowInHardware ? `${sig}̅ (74LS04)` : 'active high'),
        h('td', null, pin),
      );
      tr.addEventListener('click', () => choose(sig));
      tr.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose(sig)));
      return { sig, tr, logic, pin };
    });
    const table = h(
      'table',
      { class: 'sigs' },
      h('thead', null, h('tr', null, ['LED', 'signal', 'module', 'role', 'at the chip', 'pin now'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((r) => r.tr)),
    );

    const choose = (sig: Signal) => {
      selected = sig;
      const si = SIGNAL_INFO[sig];
      rows.forEach((r) => setClass(r.tr, 'sel', r.sig === sig));
      highlightModules(view.el, [si.module]);
      const on = (m.computer.controlWord & SIGNAL_BITS[sig]) !== 0;
      info.replaceChildren(
        h('strong', null, `${sig} · ${si.title}`),
        h('span', { class: 'dim small' }, ` (bit ${si.bit}, ${MODULE_NAME[si.module]})`),
        h('br'),
        `${si.description} `,
        si.role === 'in' ? 'It reads from the bus. ' : si.role === 'out' ? 'It drives the bus through a 74LS245, so at most one “out” signal may be on at a time. ' : '',
        h('br'),
        h('span', { class: 'dim' }, 'Wiring: '),
        HW[sig],
        si.activeLowInHardware
          ? ` Right now the LED shows ${on ? 1 : 0}, so the chip pin is at ${on ? '0 V (asserted)' : '5 V (idle)'}.`
          : ` Right now it is ${on ? 'high (asserted)' : 'low'}.`,
        h('br'),
        h('span', { class: 'dim' }, 'Used by the microcode in: '),
        usedIn(sig),
      );
      if (sig === 'FI') info.appendChild(h('div', { class: 'small', style: 'margin-top:4px' }, 'FI did not exist yet at this point in the series: there were only 15 control signals. It arrives with the flags register (video 43).'));
    };

    // ---- micro-step walkthrough ----
    const wrows = WALKTHROUGH.map((w) => {
      const word = m.computer.microcode[microIndex(0, w.opcode ?? 0, w.step)];
      const tr = h('tr', null, h('td', { class: 'mono' }, w.label), h('td', { class: 'mono' }, `T${w.step}`), h('td', { class: 'mono' }, formatControlWord(word)), h('td', null, describeTransfer(word)));
      return { ...w, tr };
    });
    const wtable = h(
      'div',
      { class: 'table-scroll' },
      h('table', { class: 'truth-table', style: 'text-align:left' }, h('thead', null, h('tr', null, ['', 'step', 'control word', 'what moves'].map((x) => h('th', null, x)))), h('tbody', null, wrows.map((r) => r.tr))),
    );
    const now = h('div', { class: 'callout' });

    const update = () => {
      const c = m.computer;
      const cw = c.controlWord;
      for (const r of rows) {
        const on = (cw & SIGNAL_BITS[r.sig]) !== 0;
        r.logic.set(on);
        const pinHigh = SIGNAL_INFO[r.sig].activeLowInHardware ? !on : on;
        setText(r.pin, pinHigh ? '5 V' : '0 V');
        setClass(r.pin, 'hi', pinHigh);
        setClass(r.pin, 'lo', !pinHigh);
      }
      for (const r of wrows) setClass(r.tr, 'current', c.step < 2 ? r.opcode === null && r.step === c.step : r.opcode === c.opcode && r.step === c.step);
      const instr = INSTRUCTION_BY_OPCODE.get(c.opcode)?.mnemonic ?? '?';
      setText(
        now,
        c.halted
          ? `HLT is on: the clock is stopped. The display shows ${c.out}. Press Reset to run it again.`
          : `T${c.step}${c.step < 2 ? ' (fetch)' : ` of ${instr}`}: ${formatControlWord(cw)} → ${describeTransfer(cw)}. ${c.clk === 1 ? 'The clock is high: the registers latched this transfer on the rising edge, and the step counter moves on at the falling edge.' : 'These signals are set now, while the clock is low; the transfer happens on the next rising edge.'}`,
      );
      choose(selected);
    };
    d.add(m.onChange(update));

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Control signals', { accent: 'blue', subtitle: 'click a row', chips: '2 × 74LS04 (U49, U53) invert the active-low lines' }, h('div', { class: 'table-scroll' }, table), info),
        panel(
          'Micro-steps of LDA, ADD, OUT',
          { accent: 'gray', subtitle: 'from the fetch/execute walkthrough' },
          wtable,
          now,
          note('Every instruction begins with the same two fetch steps. Step the program below and watch the highlighted row and the blue LEDs.'),
        ),
      ),
      tb.el,
      view.el,
    );
    root.appendChild(wrap);
    update();
    m.changed();
    return d.dispose;
  },
});
