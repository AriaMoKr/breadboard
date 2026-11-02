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
