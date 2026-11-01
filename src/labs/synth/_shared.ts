import { noteOf } from './_analog';

/** How the VCO labs (parts 2 and 3) write voltages, currents, times and pitches. */

/** The top of hearing. */
export const HEARING = 20e3;

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
  return `${fmtHz(t.hz)} (${n.name} ${n.cents < 0 ? '−' : '+'}${Math.abs(n.cents)}¢)`;
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
