import { Machine } from '../sim/machine';
import { MICROCODE_VERSIONS, type MicrocodeVersionId } from '../sim/microcode';
import type { ModuleId, Signal } from '../sim/signals';
import { Button, select } from '../ui/components';
import { ComputerView } from '../ui/computer-view';
import { Disposer, h, media, setText } from '../ui/dom';
import { MicrocodePanel } from '../ui/microcode-panel';
import { ProgramPanel } from '../ui/program-panel';

export interface ComputerWorkbenchOptions {
  machine?: Machine;
  microcodeVersion?: MicrocodeVersionId;
  /** Program id from src/sim/programs.ts or assembly source to preload. */
  program?: string;
  /** Keep the program `machine` already holds instead of loading `program` (pages sharing one machine). */
  keepProgram?: boolean;
  modules?: ModuleId[];
  highlight?: ModuleId[];
  manualControl?: boolean;
  /** Only these manual control switches (implies manualControl); see ComputerViewOptions. */
  manualSignals?: Signal[];
  /** Show 8 switches that can drive the bus. */
  busInput?: boolean;
  /** Which side tabs to show (default all). */
  tabs?: ('program' | 'microcode' | 'output')[];
  microcodeEditable?: boolean;
  /** Offer a microcode-version picker in the toolbar. */
  versionPicker?: boolean;
  /** Keyboard shortcuts (Space = clock pulse, etc). Default true. */
  keyboard?: boolean;
}

export interface ComputerWorkbench {
  machine: Machine;
  dispose: () => void;
  view: ComputerView;
  /** The program editor / memory tab (null if the 'program' tab is hidden). */
  programPanel: ProgramPanel | null;
  /** The microcode tab (null if hidden). */
  microcodePanel: MicrocodePanel | null;
  /** Show one of the side tabs. */
  showTab: (id: 'program' | 'microcode' | 'output') => void;
}

/**
 * The full computer plus toolbar and side panels (program editor / memory,
 * microcode table, output log). Used by the "Finished computer" page and by
 * the control-logic chapter labs.
 */
export function mountComputerWorkbench(root: HTMLElement, opts: ComputerWorkbenchOptions = {}): ComputerWorkbench {
  const d = new Disposer();
  const machine = opts.machine ?? new Machine({ microcodeVersion: opts.microcodeVersion ?? 'flags' });
  if (opts.microcodeVersion && machine.microcodeVersion !== opts.microcodeVersion) machine.setMicrocodeVersion(opts.microcodeVersion);

  const view = new ComputerView(machine, { modules: opts.modules, highlight: opts.highlight, manualControl: opts.manualControl, manualSignals: opts.manualSignals, busInput: opts.busInput });
  const manual = !!(opts.manualControl || opts.manualSignals);
  d.add(() => view.dispose());

  // ---- toolbar ----
  const runBtn = new Button({ label: 'Run', kind: 'primary', title: 'Start/stop the astable clock (R)', onClick: () => (machine.running && machine.mode === 'auto' ? machine.stop() : machine.start()) });
  const stepBtn = new Button({ label: 'Clock pulse', shortLabel: 'Pulse', title: 'One clock cycle (Space)', onClick: () => machine.pulse() });
  const instrBtn = new Button({ label: 'Step instruction', shortLabel: 'Step', title: 'Run until the next T0 (I)', onClick: () => machine.stepInstruction() });
  const resetBtn = new Button({ label: 'Reset', kind: 'danger', title: 'Reset (Backspace)', onClick: () => machine.reset() });
  const status = h('span', { class: 'mono dim status' });
  const versionPicker = opts.versionPicker
    ? select(
        (Object.keys(MICROCODE_VERSIONS) as MicrocodeVersionId[]).map((id) => ({ value: id, label: MICROCODE_VERSIONS[id].title })),
        machine.microcodeVersion,
        (id) => machine.setMicrocodeVersion(id),
        'Microcode',
      )
    : null;
  // Sticks to the top of the screen (CSS), so Run and Step stay in reach while you scroll the modules.
  const toolbar = h('div', { class: 'toolbar workbench-toolbar' }, runBtn.el, stepBtn.el, instrBtn.el, resetBtn.el, versionPicker, status);
  const narrow = media('(max-width: 860px)');
  if (versionPicker && narrow) {
    // On narrow screens, keep the sticky bar to one row of run controls: the picker goes underneath.
    const placePicker = () => (narrow.matches ? toolbar.after(versionPicker) : toolbar.insertBefore(versionPicker, status));
    narrow.addEventListener('change', placePicker);
    d.add(() => narrow.removeEventListener('change', placePicker));
    queueMicrotask(placePicker); // once the toolbar is in the page
  }

  // ---- side tabs ----
  const tabs = opts.tabs ?? ['program', 'microcode', 'output'];
  const tabPanels: Record<string, HTMLElement> = {};
  let programPanel: ProgramPanel | null = null;
  let microcodePanel: MicrocodePanel | null = null;
  if (tabs.includes('program')) {
    const p = (programPanel = new ProgramPanel(machine, { initial: opts.program, memoryOnly: manual, keepLoaded: opts.keepProgram }));
    d.add(() => p.dispose());
    tabPanels.program = p.el;
  }
  if (tabs.includes('microcode')) {
    const p = (microcodePanel = new MicrocodePanel(machine, { editable: opts.microcodeEditable }));
    d.add(() => p.dispose());
    tabPanels.microcode = p.el;
  }
  if (tabs.includes('output')) {
    const list = h('ol', { class: 'output-log mono' });
    const upd = () => {
      const log = machine.outputLog;
      if (list.childElementCount === log.length && (log.length === 0 || list.lastElementChild?.textContent === String(log[log.length - 1]))) return;
      list.replaceChildren(...log.slice(-64).map((v) => h('li', null, String(v))));
    };
    d.add(machine.onChange(upd));
    tabPanels.output = h('div', { class: 'output-panel' }, h('h4', null, 'Output register history'), list);
  }
  const tabButtons = h('div', { class: 'tabs', role: 'tablist' });
  const tabBody = h('div', { class: 'tab-body' });
  const labels: Record<string, string> = { program: 'Program & RAM', microcode: 'Microcode', output: 'Output log' };
  const showTab = (id: string) => {
    if (!tabPanels[id]) return;
    tabBody.replaceChildren(tabPanels[id]);
    tabButtons.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  };
  for (const id of Object.keys(tabPanels)) {
    const b = h('button', { type: 'button', role: 'tab', dataset: { tab: id }, onClick: () => showTab(id) }, labels[id]);
    tabButtons.appendChild(b);
  }
  const first = Object.keys(tabPanels)[0];
  if (first) showTab(first);

  const updateStatus = () => {
    const c = machine.computer;
    runBtn.setLabel(machine.running && machine.mode === 'auto' ? 'Stop' : 'Run');
    setText(status, `${c.halted ? 'HALTED · ' : ''}cycles ${c.cycles} · instructions ${c.instructions}`);
  };
  d.add(machine.onChange(updateStatus));
  updateStatus();

  if (opts.keyboard !== false) {
    d.listen(window, 'keydown', (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, select, [contenteditable]')) return;
      if (e.key === ' ') { e.preventDefault(); machine.pulse(); }
      else if (e.key === 'r' || e.key === 'R') machine.running && machine.mode === 'auto' ? machine.stop() : machine.start();
      else if (e.key === 'i' || e.key === 'I') machine.stepInstruction();
      else if (e.key === 'Backspace') { e.preventDefault(); machine.reset(); }
    });
  }

  const side = Object.keys(tabPanels).length ? h('aside', { class: 'workbench-side' }, tabButtons, tabBody) : null;
  root.appendChild(h('div', { class: 'workbench' }, h('div', { class: 'workbench-main' }, toolbar, view.el), side));
  machine.changed();
  return { machine, dispose: d.dispose, view, programPanel, microcodePanel, showTab };
}
