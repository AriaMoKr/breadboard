import { MODULE_BOARDS } from '../breadboard/boards';
import { hzFromPot } from '../breadboard/boards/clock.board';
import { composeComputer } from '../breadboard/computer-layout';
import { EXAMPLES } from '../breadboard/examples';
import type { Layout } from '../breadboard/layout';
import { BreadboardSim } from '../breadboard/sim/engine';
import type { SimProblem } from '../breadboard/sim/types';
import { Machine } from '../sim/machine';
import { PROGRAMS } from '../sim/programs';
import type { ComputerModel, ControlHit } from './model';
import type { PanelAction } from './panel';

/**
 * What stands on the VR table: Ben's computer, run by the control-signal-level simulator, or a
 * breadboard circuit from the sandbox (an example, or one from a share link), run by the
 * chip-level engine like in the sandbox. The VR page shows one at a time.
 */
export interface Exhibit {
  title: string;
  layout: Layout;
  /** Its buttons on the control panel. */
  actions: PanelAction[];
  /** Advance by `ms` of real time; true if anything shown may have changed. */
  frame(ms: number): boolean;
  /** Show LEDs, displays, switch positions and pressed buttons on the model. */
  show(model: ComputerModel): void;
  /** Two lines for the panel. */
  status(): string[];
  /** A pointer pressed on a control (a hit box of the model). */
  begin(hit: ControlHit): Hold | null;
  /** What a control is and how it is set, for the label over it. */
  describe(hit: ControlHit, inVR: boolean): string;
}

/** What pressing a control does until it is let go: `end(click)` with click = not dragged. */
export interface Hold {
  end(click: boolean): void;
  /** Pots: turn by `by` (a whole turn is 1) from where the hold started. */
  turn?(by: number): void;
}

export const fmtHz = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toPrecision(3)} kHz` : `${+hz.toPrecision(2)} Hz`);

// ---- what the page's #hash asks for ----

export type ExhibitChoice = { kind: 'computer' } | { kind: 'example'; id: string } | { kind: 'circuit'; code: string };

/**
 * `vr.html` alone is the computer, `#example/<id>` a sandbox example, and `#c1.…` a circuit from
 * a sandbox share link (`#/sandbox/c1.…`, the sandbox's own form, works too).
 */
export function parseExhibitHash(hash: string): ExhibitChoice {
  const h = hash.replace(/^#\/?/, '');
  const code = h.replace(/^sandbox\//, '');
  if (code.startsWith('c1.')) return { kind: 'circuit', code };
  const example = /^example\/(.+)$/.exec(h)?.[1];
  if (example && EXAMPLES.some((e) => e.id === example)) return { kind: 'example', id: example };
  return { kind: 'computer' };
}

export const exhibitHash = (c: ExhibitChoice) => (c.kind === 'circuit' ? `#${c.code}` : c.kind === 'example' ? `#example/${c.id}` : '');

// ---- Ben's computer ----

/**
 * RV1 as the VR knob turns it: like a log-taper pot, its travel spreads Ben's 0.72–480 Hz evenly
 * (a decade per ~100°), and 0 is still the fast end. Ben's pot is linear: its fastest tenth spans
 * 7–480 Hz, a few degrees of wrist per octave, too fine to set with a controller. Only the knob's
 * angle in VR differs; the speeds and the board are Ben's.
 */
const HZ_FAST = hzFromPot(0);
const HZ_SLOW = hzFromPot(1);
export const speedDial = {
  get: (m: Machine) => Math.max(0, Math.min(1, Math.log(HZ_FAST / m.hz) / Math.log(HZ_FAST / HZ_SLOW))),
  set: (m: Machine, t: number) => m.setHz(HZ_FAST * (HZ_SLOW / HZ_FAST) ** t),
};

export function computerExhibit(): Exhibit & { machine: Machine } {
  const composed = composeComputer([...MODULE_BOARDS.values()]);
  const live = composed.live.controls;
  const parts = new Map(composed.layout.parts.map((p) => [p.id, p]));
  const ledIds = Object.keys(composed.live.leds);
  const segIds = Object.keys(composed.live.seg7);
  const machine = new Machine({ microcodeVersion: 'flags' });
  let program = PROGRAMS.findIndex((p) => p.id === 'count-by-3');
  const load = (i: number) => {
    program = (i + PROGRAMS.length) % PROGRAMS.length;
    const wasRunning = running();
    machine.loadSource(PROGRAMS[program].source);
    if (wasRunning) machine.start();
  };
  const running = () => machine.running && machine.mode === 'auto';
  load(program);
  machine.setHz(4);
  machine.start();
  let changed = true;
  machine.onChange(() => (changed = true));
  const pressed = new Set<string>();

  return {
    title: 'Breadboard 8-bit',
    layout: composed.layout,
    machine,
    actions: [
      { label: () => (running() ? 'Stop' : 'Run'), run: () => (running() ? machine.stop() : machine.start()), primary: true },
      { label: () => 'Pulse', run: () => machine.pulse() },
      { label: () => 'Step', run: () => machine.stepInstruction() },
      { label: () => 'Reset', run: () => machine.reset() },
      { label: () => 'Slower', run: () => machine.setHz(Math.max(0.5, machine.hz / 2)) },
      { label: () => 'Faster', run: () => machine.setHz(Math.min(500_000, machine.hz * 2)) },
      { label: () => 'Program ▸', run: () => load(program + 1) },
    ],
    frame(ms) {
      machine.frame(ms);
      const c = changed;
      changed = false;
      return c;
    },
    show(model) {
      const c = machine.computer;
      for (const id of ledIds) model.setLed(id, composed.live.leds[id](c, machine));
      for (const id of segIds) model.setSeg7(id, composed.live.seg7[id](c, machine));
      for (const [id, ctl] of Object.entries(live)) model.setControl(id, ctl.kind === 'button' ? +pressed.has(id) : (id === 'clock/RV1' ? speedDial : ctl).get(machine));
    },
    status() {
      const c = machine.computer;
      return [PROGRAMS[program].title, `${c.halted ? 'halted' : running() ? 'running' : 'stopped'} at ${fmtHz(machine.hz)} · T${c.step} · cycle ${c.cycles} · OUT ${c.out}`];
    },
    begin(hit) {
      const ctl = live[hit.part];
      const notify = () => machine.changed();
      switch (ctl?.kind) {
        case 'button':
          ctl.press(machine);
          pressed.add(hit.part);
          notify();
          return {
            end() {
              ctl.release?.(machine);
              pressed.delete(hit.part);
              notify();
            },
          };
        case 'slide':
          return { end: (click) => click && (ctl.set(machine, ctl.get(machine) ? 0 : 1), notify()) };
        case 'dip':
          return { end: (click) => click && (ctl.set(machine, ctl.get(machine) ^ (1 << (hit.bit ?? 0))), notify()) };
        case 'pot': {
          const dial = hit.part === 'clock/RV1' ? speedDial : ctl;
          const t0 = dial.get(machine);
          return { end() {}, turn: (by) => (dial.set(machine, Math.max(0, Math.min(1, t0 + by))), notify()) };
        }
      }
      return null;
    },
    describe(hit, inVR) {
      const ctl = live[hit.part];
      const name = parts.get(hit.part)?.label ?? hit.part.split('/').pop()!;
      switch (ctl?.kind) {
        case 'slide': {
          const pos = ctl.get(machine);
          return `${name}: ${ctl.positions?.[pos] ?? `position ${pos}`}`;
        }
        case 'dip':
          return dipText(name, hit.bit ?? 0, ctl.get(machine));
        case 'pot': {
          const value = hit.part === 'clock/RV1' ? fmtHz(machine.hz) : `${Math.round(ctl.get(machine) * 100)}%`;
          return `${name}: ${value} · ${inVR ? 'hold the trigger and twist' : 'drag up or down'}`;
        }
        case 'button':
          return `${name} · push`;
      }
      return name;
    },
  };
}

const dipText = (name: string, bit: number, value: number) => `${name} switch ${bit + 1}: ${(value >> bit) & 1 ? 'ON' : 'off'}`;

// ---- a sandbox circuit ----

/** Gate delays per frame: as in the sandbox, and its slider's range. */
const SPEED = { start: 40, min: 1, max: 5000 };

export function circuitExhibit(title: string, layout: Layout): Exhibit & { sim(): BreadboardSim } {
  const parts = new Map(layout.parts.map((p) => [p.id, p]));
  let sim: BreadboardSim;
  const switches = new Map<string, number>(); // slide position / DIP value, by part
  const pressed = new Set<string>();
  let running = true;
  let speed = SPEED.start;
  let changed = true;
  const problems = { at: -Infinity, list: [] as SimProblem[] };
  const reset = () => {
    sim = new BreadboardSim(layout);
    switches.clear();
    pressed.clear();
    sim.settle(5000);
    problems.at = -Infinity;
    changed = true;
  };
  reset();
  const after = () => {
    sim.settle(2000);
    problems.at = -Infinity;
    changed = true;
  };
  const slide = (id: string) => {
    const p = parts.get(id);
    return switches.get(id) ?? (p?.kind === 'slide' ? (p.initial ?? 0) : 0);
  };
  const act = (fn: () => unknown) => () => {
    fn();
    changed = true;
  };
  // "1 chip · 2 LEDs · 2 buttons": the panel's first line (its title is already the name)
  const count = (...kinds: string[]) => layout.parts.filter((p) => kinds.includes(p.kind)).length;
  const some = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : '');
  const summary = [some(count('chip'), 'chip'), some(count('led'), 'LED'), some(count('seg7'), 'display'), some(count('button'), 'button'), some(count('slide', 'dip'), 'switch', 'switches')].filter(Boolean).join(' · ') || 'an empty board';

  return {
    title,
    layout,
    sim: () => sim,
    actions: [
      { label: () => (running ? 'Pause' : 'Run'), run: act(() => (running = !running)), primary: true },
      { label: () => 'Step', run: act(() => sim.step(speed)) },
      { label: () => 'Reset', run: reset },
      { label: () => 'Slower', run: act(() => (speed = Math.max(SPEED.min, Math.round(speed / 2)))) },
      { label: () => 'Faster', run: act(() => (speed = Math.min(SPEED.max, speed * 2))) },
    ],
    frame() {
      if (running) {
        sim.step(speed);
        changed = true;
      }
      const c = changed;
      changed = false;
      return c;
    },
    show(model) {
      for (const p of layout.parts) {
        if (p.kind === 'led') model.setLed(p.id, sim.ledLit(p.id));
        else if (p.kind === 'seg7') model.setSeg7(p.id, sim.seg7(p.id));
        else if (p.kind === 'slide') model.setControl(p.id, slide(p.id));
        else if (p.kind === 'dip') model.setControl(p.id, switches.get(p.id) ?? 0);
        else if (p.kind === 'button') model.setControl(p.id, +pressed.has(p.id));
      }
    },
    status() {
      // problems() looks at every net: at most twice a second while it runs
      const now = performance.now();
      if (now - problems.at > 500) {
        problems.at = now;
        problems.list = sim.problems();
      }
      const first = problems.list[0]?.message;
      return [summary, `${running ? 'running' : 'paused'} · ${speed} gate delays per frame${first ? ` · ${first}` : ''}`];
    },
    begin(hit) {
      const p = parts.get(hit.part);
      switch (p?.kind) {
        case 'button':
          sim.press(p.id);
          pressed.add(p.id);
          after();
          return {
            end() {
              sim.release(p.id);
              pressed.delete(p.id);
              after();
            },
          };
        case 'slide':
          return {
            end(click) {
              if (!click) return;
              const pos = slide(p.id) ? 0 : 1;
              switches.set(p.id, pos);
              sim.setSlide(p.id, pos);
              after();
            },
          };
        case 'dip':
          return {
            end(click) {
              if (!click) return;
              const v = (switches.get(p.id) ?? 0) ^ (1 << (hit.bit ?? 0));
              switches.set(p.id, v);
              sim.setDip(p.id, v);
              after();
            },
          };
      }
      return null; // the sandbox's engine has no pots
    },
    describe(hit) {
      const p = parts.get(hit.part);
      const name = p?.label ?? hit.part;
      if (p?.kind === 'slide') return `${name}: position ${slide(p.id)}`;
      if (p?.kind === 'dip') return dipText(name, hit.bit ?? 0, switches.get(p.id) ?? 0);
      if (p?.kind === 'button') return `${name} · push`;
      return name;
    },
  };
}

/** The sandbox's example circuits, as exhibits. */
export const exampleExhibit = (id: string) => {
  const e = EXAMPLES.find((x) => x.id === id)!;
  return circuitExhibit(e.title, e.build());
};
export const EXAMPLE_IDS = EXAMPLES.map((e) => e.id);
