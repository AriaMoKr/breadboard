import { s } from '../../ui/dom';
import type { Kit } from '../clock/_draw';

/**
 * Symbols the synth labs' schematics need beyond the clock labs' `Kit`: a battery, a supply rail
 * pointing down (for −9 V), a jack socket, and an LED turned round.
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

/** A jack socket: its tip contact at (x, y), its sleeve 17 below, the body to the right. */
export function jack(kit: Kit, x: number, y: number): { tip: P; sleeve: P } {
  const g = s('g', { class: 'jack' });
  g.append(
    s('rect', { x: x + 18, y: y - 13, width: 26, height: 40, rx: 3, class: 'part-fill' }),
    // the tip's spring contact, and the sleeve's
    s('path', { d: `M${x},${y} h18 l7,-5 l7,5`, class: 'part' }),
    s('path', { d: `M${x},${y + 17} h30`, class: 'part' }),
  );
  kit.over.appendChild(g);
  kit.text('jack', [x + 31, y - 21], { size: 10, class: 'dim' });
  kit.text('tip', [x + 48, y], { anchor: 'start', size: 10, class: 'dim' });
  kit.text('sleeve', [x + 48, y + 17], { anchor: 'start', size: 10, class: 'dim' });
  return { tip: [x, y], sleeve: [x, y + 17] };
}

/** `Kit.led`, turned round: its anode at the bottom (y + 12) and its cathode at the top. */
export function ledUp(kit: Kit, x: number, y: number, color: 'red' | 'blue' | 'green' | 'yellow' = 'red') {
  let led!: ReturnType<Kit['led']>;
  const grp = kit.group(() => (led = kit.led(x, y, color)));
  for (const el of grp.els) el.setAttribute('transform', `rotate(180 ${x} ${y})`);
  return { ...led, a: [x, y + 12] as P, b: [x, y - 12] as P };
}
