import { s } from '../../ui/dom';
import type { Kit } from '../clock/_draw';

/**
 * Symbols the synth labs' schematics need beyond the clock labs' `Kit`: a battery, a supply rail
 * pointing down (for −9 V), a jack socket, an LED turned round, a diode, a Schmitt-trigger
 * inverter, a pot wired as a divider and an NPN transistor facing the other way.
 */

type P = [number, number];

/** A battery, vertical, its + at the top: two cells, each a long plate (+) over a short one. Its ends are 18 above and below. */
export function battery(kit: Kit, x: number, y: number, label?: string): { plus: P; minus: P } {
  const g = s('g', { class: 'battery' });
  for (const dy of [-8, 4]) {
    g.append(
      s('line', { x1: x - 12, y1: y + dy, x2: x + 12, y2: y + dy, class: 'part' }),
      s('line', { x1: x - 6, y1: y + dy + 4, x2: x + 6, y2: y + dy + 4, class: 'part battery-minus' }),
    );
  }
  g.append(s('path', { d: `M${x},${y - 18} v10 M${x},${y + 8} v10`, class: 'part' }));
  kit.over.appendChild(g);
  kit.text('+', [x + 17, y - 13], { size: 11, class: 'dim' });
  if (label) kit.text(label, [x - 18, y], { anchor: 'end', size: 11 });
  return { plus: [x, y - 18], minus: [x, y + 18] };
}

/** A supply rail pointing down from (x, y), with its label under it (−9 V). */
export function railDown(kit: Kit, x: number, y: number, label: string) {
  kit.over.appendChild(s('path', { d: `M${x},${y} v8 M${x - 7},${y + 8} h14`, class: 'part' }));
  kit.text(label, [x, y + 18], { size: 10, class: 'dim' });
}

/** A jack socket: its tip contact at (x, y), its sleeve 17 below, the body to the right (or to the left, `facing` left), with `name` over it. */
export function jack(kit: Kit, x: number, y: number, facing: 'right' | 'left' = 'right', name = 'jack'): { tip: P; sleeve: P } {
  const d = facing === 'right' ? 1 : -1, anchor = facing === 'right' ? 'start' : 'end';
  const g = s('g', { class: 'jack' });
  g.append(
    s('rect', { x: facing === 'right' ? x + 18 : x - 44, y: y - 13, width: 26, height: 40, rx: 3, class: 'part-fill' }),
    // the tip's spring contact, and the sleeve's
    s('path', { d: `M${x},${y} h${18 * d} l${7 * d},-5 l${7 * d},5`, class: 'part' }),
    s('path', { d: `M${x},${y + 17} h${30 * d}`, class: 'part' }),
  );
  kit.over.appendChild(g);
  kit.text(name, [x + 31 * d, y - 21], { size: 10, class: 'dim' });
  kit.text('tip', [x + 48 * d, y], { anchor, size: 10, class: 'dim' });
  kit.text('sleeve', [x + 48 * d, y + 17], { anchor, size: 10, class: 'dim' });
  return { tip: [x, y], sleeve: [x, y + 17] };
}

/** A pot wired as a divider: its track a resistor 30 long, upright, centred on (x, y), and its wiper an arrow from the right onto the middle of it. */
export function potDivider(kit: Kit, x: number, y: number): { top: P; bottom: P; wiper: P } {
  kit.resistor(x, y, 'v');
  kit.over.appendChild(s('path', { d: `M${x + 22},${y} H${x + 8} M${x + 8},${y} l6,-4 M${x + 8},${y} l6,4`, class: 'part' }));
  return { top: [x, y - 15], bottom: [x, y + 15], wiper: [x + 22, y] };
}

/** `Kit.npn` the other way round: its base on the left at (x − 18, y), its collector up to the right and its emitter down to the right. */
export function npnLeft(kit: Kit, x: number, y: number): { base: P; collector: P; emitter: P } {
  const grp = kit.group(() => kit.npn(x, y));
  for (const el of grp.els) el.setAttribute('transform', `translate(${2 * x} 0) scale(-1 1)`);
  return { base: [x - 18, y], collector: [x + 15, y - 18], emitter: [x + 15, y + 18] };
}

/** A diode 24 long centred on (x, y), pointing from its anode to its cathode (the bar) `dir`. Returns its two ends. */
export function diode(kit: Kit, x: number, y: number, dir: 'left' | 'right' | 'up' | 'down'): { a: P; k: P } {
  const angle = { right: 0, down: 90, left: 180, up: 270 }[dir];
  const g = s('g', { class: 'diode', transform: `rotate(${angle} ${x} ${y})` });
  g.append(
    s('path', { d: `M${x - 12},${y} h5 M${x + 7},${y} h5 M${x + 7},${y - 8} v16`, class: 'part' }),
    s('polygon', { points: `${x - 7},${y - 8} ${x + 7},${y} ${x - 7},${y + 8}`, class: 'part-fill' }),
  );
  kit.over.appendChild(g);
  const dx = Math.round(12 * Math.cos((angle * Math.PI) / 180)), dy = Math.round(12 * Math.sin((angle * Math.PI) / 180));
  return { a: [x - dx, y - dy], k: [x + dx, y + dy] };
}

/**
 * A Schmitt-trigger inverter pointing right, as a 40106 has six of: its input at (x, y), its output
 * after the bubble at (x + 48, y), and the hysteresis sign inside (it switches at one input voltage
 * going up and another coming down).
 */
export function schmitt(kit: Kit, x: number, y: number): { in: P; out: P } {
  const g = s('g', { class: 'schmitt' });
  g.append(
    s('polygon', { points: `${x},${y - 20} ${x + 40},${y} ${x},${y + 20}`, class: 'cmp' }),
    s('circle', { cx: x + 44, cy: y, r: 4, class: 'part-fill' }),
    s('path', { d: `M${x + 5},${y + 4} h11 v-8 M${x + 11},${y + 4} v-8 h11`, class: 'part schmitt-sign' }),
  );
  kit.over.appendChild(g);
  return { in: [x, y], out: [x + 48, y] };
}

/** `Kit.led`, turned round: its anode at the bottom (y + 12) and its cathode at the top. */
export function ledUp(kit: Kit, x: number, y: number, color: 'red' | 'blue' | 'green' | 'yellow' = 'red') {
  let led!: ReturnType<Kit['led']>;
  const grp = kit.group(() => (led = kit.led(x, y, color)));
  for (const el of grp.els) el.setAttribute('transform', `rotate(180 ${x} ${y})`);
  return { ...led, a: [x, y + 12] as P, b: [x, y - 12] as P };
}
