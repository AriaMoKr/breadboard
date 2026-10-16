import { disassemble } from '../sim/assembler';
import { displaySegments, toSigned8 } from '../sim/display';
import type { Machine } from '../sim/machine';
import { INSTRUCTION_BY_OPCODE } from '../sim/microcode';
import { SIGNAL_BITS, SIGNALS, SIGNAL_INFO, formatControlWord, type ModuleId, type Signal } from '../sim/signals';
import { speedSlider } from './clock-speed';
import { Button, DipSwitch, Led, LedBar, SevenSegment, Toggle, panel, row } from './components';
import { Disposer, animate, h, setClass, setText } from './dom';

/**
 * The whole computer laid out like Ben's breadboards: modules on the left
 * and right of a vertical 8-bit bus, control logic underneath.
 *
 *   Clock          | bus |  Program counter
 *   Memory address |     |  A register
 *   RAM            |     |  ALU (Σ)
 *   Instruction    |     |  B register
 *   Control logic  |     |  Output / Flags
 */

export interface ComputerViewOptions {
  /** Only show these modules (earlier chapters). Default: all. */
  modules?: ModuleId[];
  /**
   * Replace the control logic with 16 manual control switches ("Connecting
   * the bus"). The switch panel appears in the control-logic slot, so either
   * include 'control' in `modules` or pass `manualSignals`.
   */
  manualControl?: boolean;
  /**
   * Only offer these control signals as manual switches (the jumpers wired
   * so far in a chapter). Implies `manualControl`, and shows the switch panel
   * even when 'control' is not in `modules`.
   */
  manualSignals?: Signal[];
  /** Add a bank of 8 switches that can drive the bus (testing modules by hand). */
  busInput?: boolean;
  /** Modules to draw attention to. */
  highlight?: ModuleId[];
  /** Run the machine's clock from this view's animation loop (default true). */
  driveClock?: boolean;
  /** Called when a module card is clicked. */
  onModuleClick?: (m: ModuleId) => void;
}

const ALL_MODULES: ModuleId[] = ['clock', 'pc', 'mar', 'a', 'ram', 'alu', 'b', 'ir', 'out', 'flags', 'control', 'bus'];

const MODULE_SIGNALS: Record<ModuleId, Signal[]> = {
  clock: ['HLT'],
  pc: ['CE', 'CO', 'J'],
  mar: ['MI'],
  ram: ['RI', 'RO'],
  ir: ['II', 'IO'],
  a: ['AI', 'AO'],
  alu: ['EO', 'SU'],
  b: ['BI'],
  out: ['OI'],
  flags: ['FI'],
  control: [],
  bus: [],
  input: [],
};

export class ComputerView {
  readonly el: HTMLDivElement;
  private d = new Disposer();
  private updaters: (() => void)[] = [];
  private sigBadges = new Map<Signal, HTMLElement[]>();
  private moduleEls = new Map<ModuleId, HTMLElement>();
  private manualSwitches: Toggle[] = [];

  constructor(
    readonly machine: Machine,
    private opts: ComputerViewOptions = {},
  ) {
    if (opts.manualSignals) opts = { ...opts, manualControl: true };
    this.opts = opts;
    const show = new Set(opts.modules ?? ALL_MODULES);
    if (opts.manualSignals) show.add('control');
    const slot = (m: ModuleId, build: () => HTMLElement) => {
      if (!show.has(m)) return h('div', { class: `module-slot empty slot-${m}` });
      const el = build();
      el.classList.add('module', `module-${m}`);
      el.dataset.module = m;
      if (opts.highlight?.includes(m)) el.classList.add('highlight');
      if (opts.onModuleClick) el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button, input, label, select')) return;
        opts.onModuleClick!(m);
      });
      this.moduleEls.set(m, el);
      return h('div', { class: `module-slot slot-${m}` }, el);
    };

    this.el = h(
      'div',
      { class: 'computer' },
      slot('clock', () => this.clockModule()),
      slot('bus', () => this.busModule()),
      slot('pc', () => this.pcModule()),
      slot('mar', () => this.marModule()),
      slot('a', () => this.registerModule('a', 'A register', 'red')),
      slot('ram', () => this.ramModule()),
      slot('alu', () => this.aluModule()),
      slot('ir', () => this.irModule()),
      slot('b', () => this.registerModule('b', 'B register', 'red')),
      slot('control', () => (opts.manualControl ? this.manualControlModule() : this.controlModule())),
      slot('out', () => this.outputModule()),
      slot('flags', () => this.flagsModule()),
      opts.busInput ? h('div', { class: 'module-slot slot-input' }, this.busInputModule()) : null,
    );
    if (opts.busInput) this.el.classList.add('with-input');

    this.d.add(machine.onChange(() => this.update()));
    if (opts.driveClock !== false) this.d.add(animate((dt) => machine.frame(dt)));
    if (opts.manualControl) machine.computer.setManualControl(machine.computer.manualControl ?? 0);
    this.update();
  }

  dispose() {
    this.d.dispose();
    if (this.opts.manualControl) this.machine.computer.setManualControl(null);
    if (this.opts.busInput) this.machine.computer.busInput = null;
  }

  /** Draw attention to these module cards (replaces the previous highlight). */
  setHighlight(modules: readonly ModuleId[]) {
    for (const [m, el] of this.moduleEls) setClass(el, 'highlight', modules.includes(m));
  }

  /** The card element of a module, if it is shown. */
  moduleEl(m: ModuleId): HTMLElement | undefined {
    return this.moduleEls.get(m);
  }

  // ---- helpers ---------------------------------------------------------------

  private sigBadge(sig: Signal): HTMLElement {
    const info = SIGNAL_INFO[sig];
    const el = h('span', { class: `sig sig-${info.role}`, title: `${sig} — ${info.title}: ${info.description}` }, sig);
    const list = this.sigBadges.get(sig) ?? [];
    list.push(el);
    this.sigBadges.set(sig, list);
    return el;
  }

  private badges(m: ModuleId) {
    return h('div', { class: 'sig-row' }, MODULE_SIGNALS[m].map((s) => this.sigBadge(s)));
  }

  private on(fn: () => void) {
    this.updaters.push(fn);
  }

  update() {
    const c = this.machine.computer;
    const cw = c.controlWord;
    for (const [sig, els] of this.sigBadges) {
      const on = (cw & SIGNAL_BITS[sig]) !== 0;
      for (const el of els) setClass(el, 'on', on);
    }
    for (const fn of this.updaters) fn();
  }

  // ---- modules ---------------------------------------------------------------

  private clockModule() {
    const m = this.machine;
    const clk = new Led('blue', 'Clock');
    const hlt = new Led('red', 'Halted');
    const mode = new Toggle({ label: 'Auto', value: m.mode === 'auto' && m.running, onChange: (v) => (v ? m.start() : m.setMode('manual')), title: 'Bistable 555: select free-running astable clock or manual push button' });
    const pulse = new Button({ label: 'Pulse', title: 'Monostable 555: one debounced clock pulse (also: Space)', onPress: () => {
      if (m.mode === 'auto' && m.running) return;
      m.computer.clk === 0 && m.halfPulse();
    }, onRelease: () => {
      m.computer.clk === 1 && m.halfPulse();
    } });
    const speed = speedSlider(m);
    this.on(() => {
      clk.set(m.computer.clk === 1);
      hlt.set(m.computer.halted);
      mode.set(m.mode === 'auto' && m.running);
      pulse.setDisabled(m.mode === 'auto' && m.running);
      speed.sync();
    });
    return panel('Clock', { accent: 'blue', chips: '555 ×3, 74LS04, 74LS08, 74LS32' },
      row(h('span', { class: 'led-cell' }, clk.el, h('span', { class: 'led-caption' }, 'CLK')), h('span', { class: 'led-cell' }, hlt.el, h('span', { class: 'led-caption' }, 'HLT')), mode.el, pulse.el),
      speed.el,
      this.badges('clock'),
    );
  }

  private busModule() {
    const c = this.machine.computer;
    const bar = new LedBar({ bits: 8, color: 'red', formats: ['dec'], title: 'The 8-bit bus' });
    bar.el.classList.add('vertical');
    const drivers = h('div', { class: 'bus-drivers' });
    const warn = h('div', { class: 'bus-warn' }, '⚠ bus contention');
    this.on(() => {
      const b = c.bus;
      if (b.floating) {
        // no pull-downs: show undriven lines as floating (they read as 1)
        bar.setLevels(Array.from({ length: 8 }, (_, i) => ((b.floating >> (7 - i)) & 1 ? 'Z' : (((b.value >> (7 - i)) & 1) as 0 | 1))), b.value);
      } else bar.set(b.value);
      const who = b.drivers.length ? b.drivers.map((d) => d.toUpperCase()).join(' + ') : 'idle';
      setText(drivers, b.floating ? `${who} · ${b.floating === 0xff ? 'all lines float' : 'some lines float'} (read as 1)` : who);
      setClass(warn, 'show', b.contention);
    });
    return h('section', { class: 'panel bus accent-red' }, h('header', { class: 'panel-head' }, h('h3', null, 'Bus')), h('div', { class: 'panel-body' }, bar.el, drivers, warn));
  }

  private pcModule() {
    const c = this.machine.computer;
    const bar = new LedBar({ bits: 4, color: 'green', formats: ['dec'] });
    this.on(() => bar.set(c.pc));
    return panel('Program counter', { accent: 'green', chips: '74LS161, 74LS245' }, bar.el, this.badges('pc'));
  }

  private marModule() {
    const m = this.machine;
    const c = m.computer;
    const bar = new LedBar({ bits: 4, color: 'yellow', formats: ['dec'], title: 'Address presented to RAM (after the run/program multiplexer)' });
    const prog = new Toggle({ label: 'Program', value: c.programMode, onChange: (v) => { c.programMode = v; m.changed(); }, title: 'Run / program mode switch (74LS157 multiplexers)' });
    const dip = new DipSwitch({ bits: 4, value: c.dipAddress, label: 'addr', onChange: (v) => { c.dipAddress = v; m.changed(); } });
    this.on(() => {
      bar.set(c.ramAddress);
      prog.set(c.programMode);
      if (dip.value !== c.dipAddress) dip.set(c.dipAddress);
      setClass(dip.el, 'dim', !c.programMode);
    });
    return panel('Memory address', { accent: 'yellow', chips: '74LS173, 74LS157' }, bar.el, row(prog.el, dip.el), this.badges('mar'));
  }

  private ramModule() {
    const m = this.machine;
    const c = m.computer;
    const bar = new LedBar({ bits: 8, color: 'red', formats: ['bin'] });
    const dis = h('span', { class: 'mono dim' });
    const dip = new DipSwitch({ bits: 8, value: c.dipData, label: 'data', onChange: (v) => { c.dipData = v; m.changed(); } });
    const write = new Button({ label: 'Write', title: 'Write the data switches into RAM (program mode only)', onClick: () => { c.programWrite(); m.changed(); } });
    this.on(() => {
      bar.set(c.ramValue);
      setText(dis, disassemble(c.ramValue));
      if (dip.value !== c.dipData) dip.set(c.dipData);
      setClass(dip.el, 'dim', !c.programMode);
      write.setDisabled(!c.programMode);
    });
    return panel('RAM', { accent: 'red', chips: '74LS189 ×2, 74LS04 ×2, 74LS157 ×2, 74LS245' }, row(bar.el, dis), row(dip.el, write.el), this.badges('ram'));
  }

  private irModule() {
    const c = this.machine.computer;
    const bar = new LedBar({ bits: 8, color: ['blue', 'blue', 'blue', 'blue', 'yellow', 'yellow', 'yellow', 'yellow'] });
    const dis = h('span', { class: 'mono' });
    this.on(() => {
      bar.set(c.ir);
      const instr = INSTRUCTION_BY_OPCODE.get(c.opcode);
      setText(dis, instr ? disassemble(c.ir) : `${c.opcode.toString(2).padStart(4, '0')} ?`);
    });
    return panel('Instruction register', { accent: 'blue', chips: '74LS173 ×2, 74LS245' }, row(bar.el, dis), this.badges('ir'));
  }

  private registerModule(m: 'a' | 'b', title: string, color: 'red') {
    const c = this.machine.computer;
    const bar = new LedBar({ bits: 8, color, formats: ['dec'] });
    this.on(() => bar.set(m === 'a' ? c.a : c.b));
    return panel(title, { accent: 'red', chips: '74LS173 ×2, 74LS245' }, bar.el, this.badges(m));
  }

  private aluModule() {
    const c = this.machine.computer;
    const bar = new LedBar({ bits: 8, color: 'red', formats: ['dec'] });
    const eq = h('div', { class: 'mono dim alu-eq' });
    this.on(() => {
      const r = c.alu;
      bar.set(r.value);
      setText(eq, `${c.a} ${r.subtract ? '−' : '+'} ${c.b} = ${r.value}${r.carry ? '  C' : ''}${r.zero ? '  Z' : ''}`);
    });
    return panel('ALU (Σ)', { accent: 'red', chips: '74LS283 ×2, 74LS86 ×2, 74LS245' }, bar.el, eq, this.badges('alu'));
  }

  private outputModule() {
    const m = this.machine;
    const c = m.computer;
    const digits = [0, 1, 2, 3].map(() => new SevenSegment({ height: 54 }));
    const signed = new Toggle({ label: '±', value: c.signedDisplay, title: "Show the output as two's complement", onChange: (v) => { c.signedDisplay = v; m.changed(); } });
    const val = h('span', { class: 'mono dim' });
    this.on(() => {
      const segs = displaySegments(c.out, c.signedDisplay);
      digits.forEach((d, i) => d.set(segs[i]));
      signed.set(c.signedDisplay);
      setText(val, `${c.out.toString(2).padStart(8, '0')}${c.signedDisplay ? ` = ${toSigned8(c.out)}` : ''}`);
    });
    return panel('Output', { accent: 'red', chips: '74LS273, 28C16, 555, 74LS76, 74LS139' }, h('div', { class: 'display4' }, digits.map((d) => d.el)), row(signed.el, val), this.badges('out'));
  }

  private flagsModule() {
    const c = this.machine.computer;
    const cf = new Led('green', 'Carry flag');
    const zf = new Led('green', 'Zero flag');
    this.on(() => {
      cf.set(c.flagC === 1);
      zf.set(c.flagZ === 1);
    });
    return panel('Flags', { accent: 'green', chips: '74LS173, 74LS02, 74LS08' },
      row(h('span', { class: 'led-cell' }, cf.el, h('span', { class: 'led-caption' }, 'C')), h('span', { class: 'led-cell' }, zf.el, h('span', { class: 'led-caption' }, 'Z'))),
      this.badges('flags'));
  }

  private controlModule() {
    const m = this.machine;
    const c = m.computer;
    const steps = new LedBar({ bits: 3, color: 'red', formats: ['dec'], label: 'step', title: '74LS161 step counter (clocked by inverted CLK)' });
    const tLeds = Array.from({ length: 5 }, (_, i) => new Led('green', `T${i}`));
    const cwBar = new LedBar({ bits: 16, color: 'blue', captions: [...SIGNALS] });
    cwBar.el.classList.add('control-word');
    const text = h('span', { class: 'mono' });
    const reset = new Button({ label: 'Reset', kind: 'danger', title: 'Clear PC, step counter and registers (RAM is kept)', onClick: () => m.reset() });
    this.on(() => {
      steps.set(c.step);
      tLeds.forEach((l, i) => l.set(c.step === i));
      cwBar.set(c.controlWord);
      setText(text, `T${c.step}: ${formatControlWord(c.controlWord)}`);
    });
    return panel('Control logic', { accent: 'blue', class: 'wide', chips: '74LS161, 74LS138, 28C16 ×2, 74LS04' },
      row(steps.el, h('span', { class: 'tleds' }, tLeds.map((l, i) => h('span', { class: 'led-cell' }, l.el, h('span', { class: 'led-caption' }, `T${i}`)))), text, reset.el),
      cwBar.el,
    );
  }

  private busInputModule() {
    const m = this.machine;
    const c = m.computer;
    const dip = new DipSwitch({ bits: 8, value: c.busInput ?? 0, onChange: (v) => { if (c.busInput !== null) c.busInput = v; m.changed(); } });
    const en = new Toggle({ label: 'Drive bus', value: c.busInput !== null, title: 'Connect the switches to the bus (like Ben’s temporary jumper wires)', onChange: (v) => { c.busInput = v ? dip.value : null; m.changed(); } });
    const val = h('span', { class: 'mono dim' });
    this.on(() => {
      en.set(c.busInput !== null);
      setClass(dip.el, 'dim', c.busInput === null);
      setText(val, String(dip.value));
    });
    const el = panel('Bus input switches', { accent: 'orange', subtitle: 'temporary test rig' }, row(en.el, dip.el, val));
    el.classList.add('module', 'module-input');
    return el;
  }

  private manualControlModule() {
    const m = this.machine;
    const c = m.computer;
    const signals: readonly Signal[] = this.opts.manualSignals ?? SIGNALS;
    const offered = signals.reduce((w, sig) => w | SIGNAL_BITS[sig], 0);
    const set = () => {
      // keep any signal that isn't offered as a switch as it is
      let w = (c.manualControl ?? 0) & ~offered;
      this.manualSwitches.forEach((t, i) => t.value && (w |= SIGNAL_BITS[signals[i]]));
      c.setManualControl(w);
      m.changed();
    };
    this.manualSwitches = signals.map((sig) => new Toggle({ label: sig, value: ((c.manualControl ?? 0) & SIGNAL_BITS[sig]) !== 0, title: SIGNAL_INFO[sig].description, onChange: set }));
    const clear = new Button({ label: 'All off', onClick: () => { this.manualSwitches.forEach((t) => t.set(false)); set(); } });
    const reset = new Button({ label: 'Reset', kind: 'danger', onClick: () => m.reset() });
    this.on(() => {
      const w = c.manualControl ?? 0;
      this.manualSwitches.forEach((t, i) => t.set((w & SIGNAL_BITS[signals[i]]) !== 0));
    });
    return panel('Control signals (manual)', { accent: 'blue', class: 'wide', subtitle: this.opts.manualSignals ? 'The control lines wired so far: set each one by hand, then pulse the clock' : 'Wire each control line high or low by hand, then pulse the clock' },
      h('div', { class: 'manual-switches' }, this.manualSwitches.map((t) => t.el)),
      row(clear.el, reset.el),
    );
  }
}
