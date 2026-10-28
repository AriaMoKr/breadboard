import { h } from '../../ui/dom';

/**
 * A black-and-white TV of the time, as far as its picture goes, fed a video level and a sync level
 * (high in a sync pulse) a dot at a time. The beam sweeps across and down at fixed rates. Each
 * oscillator runs free, a little slower than the signal it expects, and a sync pulse fires it
 * early if it comes in the second half of its cycle. A sync pulse that lasts (the vertical sync,
 * many times longer than a line's) starts a field, as the TV's integrator does. The line
 * oscillator keeps the rate it locked to while no pulses come, through the vertical sync, as a
 * set's AFC (its flywheel) does; the field oscillator has none. The vertical hold
 * sets the field oscillator's free-running rate: above the frame rate it starts each field before
 * the sync pulse comes, and the picture rolls; below it, the pulses come a little sooner each
 * field until one falls in the second half and fires it, and from then on it holds.
 * (The numbers are NTSC's, for a 525-line set: 63.5 µs lines, 52.6 of them shown, and 20 lines of
 * vertical retrace.)
 */

/** The horizontal oscillator's free-running period, a little longer than NTSC's 63.5 µs line. */
export const H_FREE = 64e-6;
/** From the start of a line (the sync's leading edge) to the picture's left edge, and its width. */
export const H_START = 9.4e-6;
export const H_SHOWN = 52.6e-6;
/** From the start of a field to the picture's top, and how long the picture takes. */
export const V_START = 20 * 63.5e-6;
export const V_SHOWN = 242 * 63.5e-6;
/** A sync pulse fires an oscillator in this last part of its cycle. */
export const WINDOW = 0.5;
/** A sync pulse this long is a vertical one. */
export const V_PULSE = 20e-6;
/** The vertical hold's range and where a set usually leaves it: a little under 60 Hz. */
export const HOLD = { min: 50, max: 64, normal: 57 };

/** The picture's size in pixels: two columns a dot (52.6 µs is 240 dots), two rows a line. */
export const TV_W = 480;
export const TV_H = 484;

export class TvScan {
  /** Brightness of each pixel, 0-255, row by row. */
  readonly pixels = new Uint8Array(TV_W * TV_H);
  /** The vertical hold: the field oscillator's free-running rate in Hz. */
  hold = HOLD.normal;
  /** Seconds into the line and the field. */
  private hT = 0;
  /** The line oscillator's period: free-running, or a little longer than the lines it locked to. */
  private hPeriod = H_FREE;
  /** Seconds of signal so far, and when the last line started on a sync pulse. */
  private t = 0;
  private lastSync = -1;
  private vT = 0;
  private syncWas = false;
  private syncFor = 0;
  private vFired = false;
  private row = -1;
  /** Lines and fields started by a sync pulse, and by the oscillator running out. */
  readonly count = { lines: 0, freeLines: 0, fields: 0, freeFields: 0 };
  /** How the last few fields started: true by a sync pulse. */
  private recent: boolean[] = [];

  /** The beam's place on the picture, 0-1 each way, or null in retrace or off the picture. */
  get beam(): { x: number; y: number } | null {
    const x = (this.hT - H_START) / H_SHOWN, y = (this.vT - V_START) / V_SHOWN;
    return x >= 0 && x < 1 && y >= 0 && y < 1 ? { x, y } : null;
  }

  /** The last fields all began on a sync pulse: the picture holds still. */
  get locked(): boolean {
    return this.recent.length >= 2 && this.recent.every(Boolean);
  }

  private newLine() {
    this.hT = 0;
    const y = (this.vT - V_START) / V_SHOWN;
    this.row = y >= 0 && y < 1 ? Math.floor(y * (TV_H / 2)) * 2 : -1;
    // the dark row between lines, as the beam passes
    if (this.row >= 0) this.pixels.fill(0, (this.row + 1) * TV_W, (this.row + 2) * TV_W);
  }

  private newField(bySync: boolean) {
    this.vT = 0;
    if (bySync) this.count.fields++;
    else this.count.freeFields++;
    this.recent.push(bySync);
    if (this.recent.length > 3) this.recent.shift();
  }

  /** `dt` seconds of signal: the video and sync levels. */
  feed(video: boolean, sync: boolean, dt: number) {
    const vFree = 1 / this.hold;
    // a sync pulse's leading edge: a line, if the line oscillator is in its second half
    if (sync && !this.syncWas && this.hT > (1 - WINDOW) * this.hPeriod) {
      this.count.lines++;
      const line = this.t - this.lastSync;
      if (line > 0.9 * H_FREE && line < 1.1 * H_FREE) this.hPeriod = 1.01 * line;
      this.lastSync = this.t;
      this.newLine();
    }
    this.syncFor = sync ? this.syncFor + dt : 0;
    if (!sync) this.vFired = false;
    else if (this.syncFor >= V_PULSE && !this.vFired) {
      this.vFired = true;
      if (this.vT > (1 - WINDOW) * vFree) this.newField(true);
    }
    this.syncWas = sync;
    if (this.row >= 0) {
      const x0 = (this.hT - H_START) / H_SHOWN, x1 = (this.hT + dt - H_START) / H_SHOWN;
      if (x1 > 0 && x0 < 1) {
        const from = Math.max(0, Math.round(x0 * TV_W)), to = Math.min(TV_W, Math.round(x1 * TV_W));
        this.pixels.fill(video ? 255 : 0, this.row * TV_W + from, this.row * TV_W + to);
      }
    }
    this.t += dt;
    this.hT += dt;
    this.vT += dt;
    if (this.hT >= this.hPeriod) {
      this.count.freeLines++;
      this.newLine();
    }
    if (this.vT >= vFree) this.newField(false);
  }
}

/** Phosphor colours: dark and lit. */
const DARK = [14, 18, 16], LIT = [222, 236, 226];

/** The TV on the page: a canvas showing a TvScan's picture, with the beam marked while it draws. */
export class TvScreen {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private rgba = new Uint8ClampedArray(TV_W * TV_H * 4);

  constructor(
    readonly scan: TvScan,
    label: string,
  ) {
    this.canvas = h('canvas', { width: TV_W, height: TV_H, class: 'tvt-screen', role: 'img', 'aria-label': label });
    this.ctx = this.canvas.getContext?.('2d') ?? null;
    this.el = h('div', { class: 'tvt-tv' }, this.canvas);
  }

  /** Name the picture for screen readers (what it shows now). */
  describe(label: string) {
    this.canvas.setAttribute('aria-label', label);
  }

  draw(markBeam: boolean) {
    const ctx = this.ctx;
    if (!ctx || typeof ImageData === 'undefined') return;
    const px = this.scan.pixels, out = this.rgba;
    for (let i = 0, j = 0; i < px.length; i++, j += 4) {
      const t = px[i] / 255;
      out[j] = DARK[0] + (LIT[0] - DARK[0]) * t;
      out[j + 1] = DARK[1] + (LIT[1] - DARK[1]) * t;
      out[j + 2] = DARK[2] + (LIT[2] - DARK[2]) * t;
      out[j + 3] = 255;
    }
    ctx.putImageData(new ImageData(out, TV_W, TV_H), 0, 0);
    const b = this.scan.beam;
    if (markBeam && b) {
      ctx.fillStyle = '#fff6a0';
      ctx.beginPath();
      ctx.arc(b.x * TV_W, Math.floor(b.y * (TV_H / 2)) * 2, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}
