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
    if (typeof AudioContext === 'undefined') return;
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
      this.osc.type = 'square';
      this.osc.connect(this.gain);
      this.osc.start(now);
    }
    this.osc.frequency.value = hz;
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
