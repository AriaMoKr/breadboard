/** How many harmonics `Tone.wave` keeps: WebAudio drops those above half the sample rate itself. */
const HARMONICS = 64;

/**
 * The Fourier series of one period of a wave, from `samples` evenly spaced over it: the cosine
 * (`real`) and sine (`imag`) terms 1 to `n`, as WebAudio's PeriodicWave takes them. Term 0, the
 * average, stays 0: it would only be an offset, which a speaker doesn't play.
 */
export function periodicWave(samples: readonly number[], n: number): { real: Float32Array; imag: Float32Array } {
  const m = samples.length;
  const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < m; i++) {
      const ph = (2 * Math.PI * k * i) / m;
      re += samples[i] * Math.cos(ph);
      im += samples[i] * Math.sin(ph);
    }
    real[k] = (2 * re) / m;
    imag[k] = (2 * im) / m;
  }
  return { real, imag };
}

/** How strong each of the first `n` harmonics of a wave is, from one period of `samples`: the amplitude of terms 1 to `n` of its Fourier series. */
export function harmonics(samples: readonly number[], n: number): number[] {
  const { real, imag } = periodicWave(samples, n);
  return Array.from({ length: n }, (_, k) => Math.hypot(real[k + 1], imag[k + 1]));
}

/**
 * The synth labs' "Listen" toggles: a circuit's tone through WebAudio, quietly. Browsers only play
 * sound after a click or a key, so it starts from the toggle; where there is no AudioContext (the
 * tests) it does nothing.
 */
export class Tone {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  constructor(readonly volume = 0.04) {}

  get playing(): boolean {
    return this.osc !== null;
  }

  /** Play (or retune) a square wave at `hz`. */
  square(hz: number) {
    const osc = this.start();
    if (!osc) return;
    osc.type = 'square';
    osc.frequency.value = hz;
  }

  /** Play (or retune) a wave of which `samples` is one period, evenly spaced, at `hz`. */
  wave(hz: number, samples: readonly number[]) {
    const osc = this.start();
    if (!osc || !this.ctx) return;
    const { real, imag } = periodicWave(samples, HARMONICS);
    osc.setPeriodicWave(this.ctx.createPeriodicWave(real, imag));
    osc.frequency.value = hz;
  }

  /**
   * Play (or retune) a sawtooth at `hz`: the browser's own, which rises slowly and drops at once
   * and keeps all its harmonics at any pitch, so a few hertz come out as clicks.
   */
  saw(hz: number) {
    const osc = this.start();
    if (!osc) return;
    if (osc.type !== 'sawtooth') osc.type = 'sawtooth';
    osc.frequency.value = hz;
  }

  /** The oscillator, started (fading in) if it isn't playing; null where there is no WebAudio. */
  private start(): OscillatorNode | null {
    if (typeof AudioContext === 'undefined') return null;
    const ctx = (this.ctx ??= new AudioContext());
    void ctx.resume();
    if (!this.osc) {
      const now = ctx.currentTime;
      this.gain = ctx.createGain();
      // fade in and out over a few milliseconds, so it starts and stops without a click
      this.gain.gain.setValueAtTime(0, now);
      this.gain.gain.linearRampToValueAtTime(this.volume, now + 0.02);
      this.gain.connect(ctx.destination);
      this.osc = ctx.createOscillator();
      this.osc.connect(this.gain);
      this.osc.start(now);
    }
    return this.osc;
  }

  stop() {
    const { ctx, osc, gain } = this;
    if (!ctx || !osc || !gain) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.02);
    osc.stop(now + 0.03);
    osc.onended = () => gain.disconnect();
    this.osc = this.gain = null;
  }

  /** Stop and let the audio device go. */
  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** The thresholds `PwmTone`'s curve covers, ±4 V: past any sawtooth here, where the width stays as it is at either end. */
export const PWM_SPAN = 4;
/** Its points. */
const CURVE_N = 2049;
/** The longest delay it needs: a whole period, of 20 Hz at the lowest. */
const MAX_DELAY = 1 / 20;

/**
 * The curve `PwmTone` puts a threshold through: from −`span` to +`span` volts in `n` steps, how
 * much of a period the pulse is high less a half (`width` gives it, 0 to 1), as a WaveShaperNode
 * takes it.
 */
export function pwmCurve(width: (v: number) => number, n = CURVE_N, span = PWM_SPAN): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: n }, (_, k) => Math.max(0, Math.min(1, width(span * ((2 * k) / (n - 1) - 1)))) - 0.5);
}

/** The same thresholds' gate: 1 where there is a pulse, 0 where the output is stuck high or low. */
export function pwmGate(width: (v: number) => number, n = CURVE_N, span = PWM_SPAN): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: n }, (_, k) => {
    const w = width(span * ((2 * k) / (n - 1) - 1));
    return w > 0 && w < 1 ? 1 : 0;
  });
}

/** A sine-phase triangle, as WebAudio's 'triangle' oscillator: 0 at `phase` 0, rising to 1 at a quarter, −1 at three quarters. */
export const triangle = (phase: number) => 1 - 4 * Math.abs((((phase + 0.25) % 1) + 1) % 1 - 0.5);

/**
 * The PWM lab's "Listen": a pulse whose width follows a threshold, as a comparator makes it from a
 * sawtooth, with an LFO moving the threshold. WebAudio builds it from the browser's sawtooth and a
 * copy of it delayed by d of a period: their difference is a pulse d wide, as free of aliasing as
 * the sawtooth, with 2d − 1 added, which is taken out again. The threshold, a steady voltage and an
 * LFO's swing, goes through `pwmCurve`, which gives d for it, so the width follows the LFO sample by
 * sample, at any rate. Past the sawtooth's top or bottom, where the output is stuck, `pwmGate` shuts
 * the difference off: a delay of a whole period would leave the sawtooth's jump behind, smeared by
 * the delay's interpolation, where the circuit is silent. Quiet, and started only from a control, as
 * `Tone` is; where there is no AudioContext (the tests) it does nothing.
 */
export class PwmTone {
  private ctx: AudioContext | null = null;
  private v: {
    out: GainNode;
    saw: OscillatorNode;
    delay: DelayNode;
    toDelay: GainNode;
    steady: ConstantSourceNode;
    lfo: OscillatorNode;
    swing: GainNode;
    shaper: WaveShaperNode;
    gate: WaveShaperNode;
  } | null = null;
  private key = '';
  private hz = 0;
  /** The LFO's phase when its rate last changed, then, and the rate since. */
  private phase0 = 0;
  private t0 = 0;
  private rate = 0;
  constructor(readonly volume = 0.04) {}

  get playing(): boolean {
    return this.v !== null;
  }

  /**
   * Play (or change) the pulse at `hz`: `width(v)` says how much of a period it is high with the
   * threshold at v volts, and `key` names it, so that its curve is worked out again only when it
   * changes. The threshold is `steady` volts plus `swing` volts of a triangle LFO at `rate` hertz.
   */
  set(hz: number, width: (v: number) => number, key: string, steady: number, swing: number, rate: number) {
    if (typeof AudioContext === 'undefined' || !(hz >= 1 / MAX_DELAY)) return;
    const ctx = (this.ctx ??= new AudioContext());
    void ctx.resume();
    const now = ctx.currentTime;
    const v = (this.v ??= this.build(ctx, now));
    if (key !== this.key) {
      v.shaper.curve = pwmCurve(width);
      v.gate.curve = pwmGate(width);
      this.key = key;
    }
    if (hz !== this.hz) {
      // the delay follows the period, over a few milliseconds rather than with a click
      v.saw.frequency.setValueAtTime(hz, now);
      v.delay.delayTime.setTargetAtTime(0.5 / hz, now, 0.002);
      v.toDelay.gain.setTargetAtTime(1 / hz, now, 0.002);
      this.hz = hz;
    }
    v.steady.offset.setValueAtTime(steady / PWM_SPAN, now);
    v.swing.gain.setValueAtTime(swing / PWM_SPAN, now);
    if (rate !== this.rate) {
      this.phase0 += this.rate * (now - this.t0);
      this.t0 = now;
      this.rate = rate;
      v.lfo.frequency.setValueAtTime(rate, now);
    }
  }

  /** Where the LFO is in its cycle (0 to 1, from 0 V rising), or null while nothing plays. */
  lfoPhase(): number | null {
    if (!this.v || !this.ctx) return null;
    return (this.phase0 + this.rate * (this.ctx.currentTime - this.t0)) % 1;
  }

  private build(ctx: AudioContext, now: number) {
    const out = ctx.createGain();
    // fade in over a few milliseconds, so it starts without a click
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(this.volume, now + 0.02);
    out.connect(ctx.destination);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const delay = ctx.createDelay(MAX_DELAY);
    const inv = ctx.createGain();
    inv.gain.value = -1;
    // the sawtooth less its delayed copy, through the gate (its gain is the gate curve's output)
    const diff = ctx.createGain();
    const gated = ctx.createGain();
    gated.gain.value = 0;
    saw.connect(diff);
    saw.connect(delay).connect(inv).connect(diff);
    diff.connect(gated).connect(out);
    // the threshold, in PWM_SPAN's units: the steady part and the LFO's swing, through the curve to d − ½
    const steady = ctx.createConstantSource();
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    const swing = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const gate = ctx.createWaveShaper();
    steady.connect(shaper);
    lfo.connect(swing).connect(shaper);
    steady.connect(gate);
    swing.connect(gate);
    gate.connect(gated.gain);
    // the delay: half a period, plus (d − ½) periods; and the 2d − 1 the difference brings, taken out
    const toDelay = ctx.createGain();
    shaper.connect(toDelay).connect(delay.delayTime);
    const fix = ctx.createGain();
    fix.gain.value = -2;
    shaper.connect(fix).connect(out);
    for (const s of [saw, steady, lfo]) s.start(now);
    this.phase0 = 0;
    this.t0 = now;
    this.rate = 0;
    lfo.frequency.value = 0;
    this.hz = 0;
    this.key = '';
    return { out, saw, delay, toDelay, steady, lfo, swing, shaper, gate };
  }

  stop() {
    const { ctx, v } = this;
    if (!ctx || !v) return;
    const now = ctx.currentTime;
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + 0.02);
    for (const s of [v.saw, v.steady, v.lfo]) s.stop(now + 0.03);
    v.saw.onended = () => v.out.disconnect();
    this.v = null;
  }

  /** Stop and let the audio device go. */
  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
