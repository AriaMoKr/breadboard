import { MODULE_BOARDS } from '../breadboard/boards';
import { composeComputer, moduleLinks, type LinkKind } from '../breadboard/computer-layout';
import { layoutBounds, type LiveControl } from '../breadboard/layout';
import { LayoutView, type PartEvent } from '../breadboard/render';
import { PanZoom } from '../breadboard/viewer';
import { Machine } from '../sim/machine';
import { speedSlider } from '../ui/clock-speed';
import { Button, Toggle, select } from '../ui/components';
import { Disposer, animate, h, s, setText } from '../ui/dom';
import { ProgramPanel } from '../ui/program-panel';

/**
 * The finished computer drawn as Ben's breadboards, driven live by the
 * control-signal-level simulator: every LED, the 7-segment display and the
 * front-panel controls (clock button, mode switches, DIP switches, reset)
 * work on the boards themselves.
 */
export function mountBreadboardPage(root: HTMLElement, opts: { machine?: Machine } = {}): () => void {
  const d = new Disposer();
  const machine = opts.machine ?? new Machine({ microcodeVersion: 'flags' });
  const scene = composeComputer([...MODULE_BOARDS.values()]);

  const onEvent = (id: string, ev: PartEvent) => {
    const ctl: LiveControl | undefined = scene.live.controls[id];
    if (!ctl) return;
    switch (ctl.kind) {
      case 'button':
        if (ev.type === 'press') ctl.press(machine);
        if (ev.type === 'release') ctl.release?.(machine);
        break;
      case 'slide':
        if (ev.type === 'toggle') ctl.set(machine, ctl.get(machine) ? 0 : 1);
        break;
      case 'dip':
        if (ev.type === 'dip') ctl.set(machine, ctl.get(machine) ^ (1 << ev.bit));
        break;
      case 'pot':
        if (ev.type === 'pot') ctl.set(machine, ev.value);
        break;
    }
    machine.changed();
  };

  const view = new LayoutView(scene.layout, { onEvent, padding: 4 });

  // ---- wires between modules (drawn under the parts, over the boards) ----
  const linkLayer = s('g', { class: 'bb-links' });
  view.el.insertBefore(linkLayer, view.el.querySelector('.bb-parts'));
  const LINK_COLORS: Record<LinkKind, string> = { bus: '#2563d4', control: '#8146c9', clock: '#f4f4f2', data: '#e8c516' };
  const linkGroups: Record<LinkKind, SVGGElement> = { bus: s('g'), control: s('g'), clock: s('g'), data: s('g') };
  for (const g of Object.values(linkGroups)) linkLayer.appendChild(g);
  for (const link of moduleLinks(scene, (b, hole) => view.holeScene(b, hole))) {
    const a = view.holeScene(link.from.board, link.from.hole);
    const z = view.holeScene(link.to.board, link.to.hole);
    const dx = Math.max(6, Math.abs(z.x - a.x) * 0.4);
    const dir = z.x >= a.x ? 1 : -1;
    const d = `M ${a.x} ${a.y} C ${a.x + dir * dx} ${a.y}, ${z.x - dir * dx} ${z.y}, ${z.x} ${z.y}`;
    const path = s('path', { d, class: `bb-link link-${link.kind}`, stroke: LINK_COLORS[link.kind] });
    path.appendChild(s('title', null, `${link.name}: ${link.from.module} → ${link.to.module}`));
    linkGroups[link.kind].append(s('path', { d, class: 'bb-link-outline' }), path);
  }
  const linkToggle = (kind: LinkKind, label: string, on: boolean) => {
    linkGroups[kind].style.display = on ? '' : 'none';
    return new Toggle({ label, value: on, onChange: (v) => (linkGroups[kind].style.display = v ? '' : 'none') }).el;
  };
  const linkToggles = h('div', { class: 'row bb-link-toggles' }, h('span', { class: 'dim small' }, 'Wires between boards:'), linkToggle('bus', 'Bus', true), linkToggle('clock', 'Clock', false), linkToggle('control', 'Control lines', false), linkToggle('data', 'Data', false));
  const b = layoutBounds(scene.layout);
  const pz = new PanZoom(view.el, { x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }, {
    hint: 'Drag to pan · wheel or pinch to zoom · click switches and buttons',
    touchHint: 'Tap to zoom in, then tap switches and buttons · drag to pan · pinch to zoom',
    tapZoom: true,
  });
  d.add(() => pz.dispose());

  // ---- live state ----
  const ledIds = Object.keys(scene.live.leds);
  const segIds = Object.keys(scene.live.seg7);
  const update = () => {
    const c = machine.computer;
    for (const id of ledIds) view.setLed(id, scene.live.leds[id](c, machine));
    for (const id of segIds) view.setSeg7(id, scene.live.seg7[id](c, machine));
    for (const [id, ctl] of Object.entries(scene.live.controls)) {
      if (ctl.kind === 'slide') view.setSlide(id, ctl.get(machine));
      else if (ctl.kind === 'dip') view.setDip(id, ctl.get(machine));
      else if (ctl.kind === 'pot') view.setPot(id, ctl.get(machine));
    }
  };
  d.add(machine.onChange(update));
  d.add(animate((dt) => machine.frame(dt)));

  // ---- toolbar ----
  const run = new Button({ label: 'Run', labels: ['Run', 'Stop'], kind: 'primary', onClick: () => (machine.running && machine.mode === 'auto' ? machine.stop() : machine.start()) });
  const pulse = new Button({ label: 'Clock pulse', shortLabel: 'Pulse', onClick: () => machine.pulse() });
  const step = new Button({ label: 'Step instruction', shortLabel: 'Step', onClick: () => machine.stepInstruction() });
  const reset = new Button({ label: 'Reset', kind: 'danger', onClick: () => machine.reset() });
  // Same clock as the pot RV1 on the clock board: each follows the other.
  const speed = speedSlider(machine);
  speed.el.title = 'Clock speed in auto mode. RV1 on the clock board turns with it; Ben’s 555 reaches about 0.7–480 Hz, faster is simulator turbo.';
  d.add(machine.onChange(speed.sync));
  const status = h('span', { class: 'mono dim status' });
  const moduleIds = [...scene.modules.keys()];
  const zoomPick = select(
    [{ value: '', label: 'Whole computer' }, ...moduleIds.map((m) => ({ value: m, label: scene.modules.get(m)!.def.title }))],
    '',
    (id) => {
      if (!id) return pz.fit();
      const mod = scene.modules.get(id)!;
      const lb = layoutBounds(mod.def.layout);
      pz.zoomTo({ x: mod.x + lb.x, y: mod.y + lb.y, w: lb.w, h: lb.h }, 4);
    },
    'Zoom to',
  );
  const updateStatus = () => {
    const c = machine.computer;
    run.setLabel(machine.running && machine.mode === 'auto' ? 'Stop' : 'Run');
    setText(status, `${c.halted ? 'HALTED · ' : ''}T${c.step} · cycles ${c.cycles}`);
  };
  d.add(machine.onChange(updateStatus));

  const prog = new ProgramPanel(machine, { initial: 'add', keepLoaded: true });
  d.add(() => prog.dispose());

  root.append(
    h('div', { class: 'toolbar' }, run.el, pulse.el, step.el, reset.el, speed.el, zoomPick, status),
    linkToggles,
    pz.el,
    h('details', { class: 'bb-program' }, h('summary', null, 'Program & RAM'), prog.el),
  );
  update();
  updateStatus();
  machine.changed();
  return d.dispose;
}
