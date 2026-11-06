import { h, s, setClass, setText } from '../../ui/dom';
import type { Schematic } from '../../ui/schematic';
import { noteOf } from './_analog';

/** How the VCO labs (parts 2 to 4) write voltages, currents, times and pitches, and parts 3 and 4's tuner. */

/** The top of hearing. */
export const HEARING = 20e3;

/**
 * A schematic's box beside a lab's readouts (`.synth-sch`, which the lab sizes in its row, with
 * `schBoxCss`): no wider than the drawing, and on a touch screen, where the drawing stops shrinking
 * at 3/4 of its size (styles.css), the box scrolls sideways. `show` puts a drawing in it, at its
 * width as it is then.
 */
export function schBox(sch?: Schematic) {
  const el = h('div', { class: 'synth-sch' });
  const show = (next: Schematic) => {
    el.replaceChildren(next.el);
    el.style.maxWidth = next.el.style.maxWidth;
    el.style.setProperty('--sch-w', next.el.style.getPropertyValue('--sch-w'));
  };
  if (sch) show(sch);
  return { el, show };
}

/**
 * `schBox`'s rules, under `.${scope}`. With a mouse the box shrinks as the drawing does. On a touch
 * screen it keeps the drawing's 3/4 (`--sch-w`, from `show`) or its row's width if that is less,
 * so that what sits beside it wraps below while the whole drawing fits on the row, and it scrolls
 * only where it doesn't; and it draws the drawing's focus ring itself, since a box that scrolls
 * clips what is drawn outside the drawing.
 */
export const schBoxCss = (scope: string) => `
.${scope} .synth-sch { min-width: 0; }
@media (pointer: coarse) {
  .${scope} .synth-sch { min-width: min(100%, calc(var(--sch-w, 0) * 0.75px)); }
  .${scope} .synth-sch:has(> .schematic:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
}`;

export const fmtV = (v: number) => `${v.toFixed(3)} V`;
export const mV = (v: number) => `${Math.round(v * 1e3)} mV`;
export const fmtHz = (hz: number) => (hz >= 1e3 ? `${+(hz / 1e3).toPrecision(3)} kHz` : `${+hz.toPrecision(3)} Hz`);
export function fmtT(t: number): string {
  if (t >= 2 * 86400) return `${Math.round(t / 86400)} days`;
  if (t >= 2 * 3600) return `${Math.round(t / 3600)} hours`;
  if (t >= 120) return `${Math.round(t / 60)} minutes`;
  if (t >= 1) return `${+t.toPrecision(3)} s`;
  if (t >= 1e-3) return `${+(t * 1e3).toPrecision(3)} ms`;
  return `${+(t * 1e6).toPrecision(3)} µs`;
}
export function fmtA(i: number): string {
  if (i >= 1e-3) return `${+(i * 1e3).toPrecision(3)} mA`;
  if (i >= 1e-6) return `${+(i * 1e6).toPrecision(3)} µA`;
  if (i >= 1e-9) return `${+(i * 1e9).toPrecision(3)} nA`;
  if (i >= 1e-12) return `${+(i * 1e12).toPrecision(3)} pA`;
  if (i >= 1e-15) return `${+(i * 1e15).toPrecision(3)} fA`;
  return i > 0 ? 'under a femtoamp' : 'none';
}
export const fmtCv = (v: number) => `${+v.toFixed(2)} V`;

type Pitch = { hz: number; stalled: boolean };

/** The core's pitch, in words: a note, clicks, out of hearing, or stopped. */
export function pitchText(t: Pitch): string {
  if (t.stalled) return 'none: the core has stopped';
  if (!(t.hz > 0) || 1 / t.hz > 86400) return 'none to speak of: under a click a day';
  if (t.hz < 1) return `a click every ${fmtT(1 / t.hz)}`;
  if (t.hz < 20) return `${fmtHz(t.hz)}: clicks, not a note`;
  if (t.hz > HEARING) return `${fmtHz(t.hz)}, above hearing`;
  const n = noteOf(t.hz);
  return `${fmtHz(t.hz)} (${n.name} ${n.cents < 0 ? '−' : n.cents > 0 ? '+' : '±'}${Math.abs(n.cents)}¢)`;
}

/** The same, short, for a sequence's table. */
export function playsText(t: Pitch): string {
  if (t.stalled) return 'stopped';
  if (!(t.hz > 0) || 1 / t.hz > 86400) return 'nothing';
  if (t.hz < 0.1) return `once in ${fmtT(1 / t.hz)}`;
  if (t.hz < 20) return `${fmtHz(t.hz)}, clicks`;
  if (t.hz > HEARING) return `${fmtHz(t.hz)}, too high`;
  return `${noteOf(t.hz).name}, ${fmtHz(t.hz)}`;
}

/** Volts with their sign. */
export const sV = (v: number) => `${v < -5e-4 ? '−' : ''}${Math.abs(v).toFixed(3)} V`;

/** Millivolts with their sign, to a tenth. */
export const sMV = (v: number) => {
  const m = Math.round(v * 1e4) / 10;
  return `${m < 0 ? '−' : m > 0 ? '+' : ''}${Math.abs(m).toFixed(1)} mV`;
};

/** How many cents `hz` is above `ref`. */
export const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);

/** Cents off a note: +3¢ or −12¢, or semitones once it's a note or more. */
export const offText = (c: number) =>
  Math.abs(c) < 99.5 ? `${c >= 0.5 ? '+' : c <= -0.5 ? '−' : '±'}${Math.abs(Math.round(c))}¢` : `${c > 0 ? '+' : '−'}${(Math.abs(c) / 100).toFixed(1)} semitones`;

/** The same in words, for a screen reader. */
export const centsWords = (c: number) => (Math.round(c) === 0 ? 'dead on' : `${Math.abs(Math.round(c))} cents ${c > 0 ? 'sharp' : 'flat'}`);

/** Cents either way that the tuner calls in tune. */
export const IN_TUNE = 5;

/** One line of the tuner: what plays, its nearest note, and how many cents off it, on a bar from −50 to +50. Styled by `tunerCss`. */
export function tunerRow(label: string) {
  const head = h('span', { class: 't-label' }, label);
  const name = h('span', { class: 't-note' });
  const off = h('span', { class: 't-cents' });
  const mark = s('rect', { x: 98, y: 3, width: 4, height: 18, rx: 1, class: 'mark' });
  // the bar's ends are 50 cents either way
  const bar = s(
    'svg',
    { viewBox: '0 0 200 24', class: 't-bar', role: 'img', 'aria-label': 'Tuner: no note yet' },
    s('rect', { x: 5, y: 8, width: 190, height: 8, rx: 4, class: 'bar' }),
    ...[-25, 0, 25].map((c) => s('line', { x1: 100 + c * 1.9, y1: c ? 6 : 2, x2: 100 + c * 1.9, y2: c ? 18 : 22, class: c ? 'tick' : 'tick zero' })),
    mark,
  );
  const el = h('div', { class: 't-row' }, head, name, off, bar);
  return {
    el,
    setLabel: (text: string) => setText(head, text),
    set(hz: number) {
      const n = noteOf(hz);
      setText(name, n.name);
      setText(off, `${offText(n.cents)} ${Math.abs(n.cents) <= IN_TUNE ? '(in tune)' : ''}`.trim());
      mark.setAttribute('x', (98 + Math.max(-50, Math.min(50, n.cents)) * 1.9).toFixed(1));
      bar.setAttribute('aria-label', `Tuner: ${n.name}, ${centsWords(n.cents)}`);
      setClass(el, 'ok', Math.abs(n.cents) <= IN_TUNE);
    },
  };
}

/** The tuner's rows and the sequence tables beside them, under `.${scope}`. */
export const tunerCss = (scope: string) => `
.${scope} .tuner { display: grid; gap: 6px; margin-bottom: 8px; }
.${scope} .t-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; padding: 4px 8px; border-radius: 6px; }
.${scope} .t-row.current { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.${scope} .t-label { min-width: 4.5em; color: var(--fg-dim); }
.${scope} .t-note { min-width: 3.2em; font-size: 1.25rem; font-weight: 700; }
.${scope} .t-cents { min-width: 7em; font-variant-numeric: tabular-nums; }
.${scope} .t-bar { flex: 1 1 150px; max-width: 260px; height: auto; display: block; }
.${scope} .t-bar .bar { fill: var(--panel-2); stroke: var(--fg-faint); }
.${scope} .t-bar .tick { stroke: var(--fg-faint); stroke-width: 1.5; }
.${scope} .t-bar .tick.zero { stroke: var(--fg-dim); stroke-width: 2.5; }
.${scope} .t-bar .mark { fill: var(--fg); }
.${scope} .t-row.ok .t-bar .mark { fill: var(--accent); }
.${scope} .seq-table { font-size: 0.8rem; }
.${scope} .seq-table th, .${scope} .seq-table td { padding: 2px 7px; }
@media (forced-colors: active) {
  .${scope} .t-row.current { outline: 2px solid Highlight; }
}
`;
