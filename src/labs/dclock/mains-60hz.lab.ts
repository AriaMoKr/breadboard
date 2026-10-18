import { Scope, Slider, Toggle, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { callout } from '../latches/_shared';
import { defineLab } from '../types';
import { InputStage, Noise, Supply, acSide, thresholds } from './_analog';

const N = 500; // scope points

type Rect = 'bridge' | 'half';
type Cap = 'none' | '100u' | '1000u' | '10000u';
type Load = 'none' | '1k' | '100' | '10';
type View = 'cycles' | 'zoom';

const CAPS: Record<Cap, number | null> = { none: null, '100u': 100e-6, '1000u': 1000e-6, '10000u': 10000e-6 };
const LOADS: Record<Load, number | null> = { none: null, '1k': 1000, '100': 100, '10': 10 };
const v2 = (v: number) => `${v.toFixed(2)} V`;

export default defineLab({
  id: 'mains-60hz',
  title: 'A 60 Hz signal from the mains',
  summary:
    'Ben’s clock keeps time with the mains: the power company holds its 60 Hz (50 Hz in many countries) exact over the long run. An AC-to-AC adapter (12 V AC, about 17 V peak) feeds a bridge rectifier, a 10,000 µF capacitor and a 7805 for the 5 V the logic needs. One side of the AC, divided down by two 47 kΩ resistors and smoothed by 0.1 µF, goes to an LM339 comparator against a 2.5 V reference, which turns the sine wave into a square wave. Noise at the switching point makes extra pulses that would make the clock run fast, until a 100 kΩ feedback resistor adds hysteresis.',
  mount(root) {
    const d = new Disposer();

    // ---- the supply ---------------------------------------------------------------
    let rect: Rect = 'bridge', cap: Cap = '10000u', load: Load = '1k', peak = 17;
    const sup = new Supply({ peak, hz: 60, bridge: true, cap: CAPS[cap], load: LOADS[load] });
    const supScope = new Scope(
      [
        { label: 'adapter AC (V)', kind: 'analog', min: -25, max: 25, guides: [0], color: '#a78bfa' },
        { label: '7805 input (V)', kind: 'analog', min: 0, max: 25, guides: [7], color: '#f59e0b' },
        { label: '7805 output (V)', kind: 'analog', min: 0, max: 6, guides: [5], color: '#4ade80' },
      ],
      { width: 640, laneHeight: 56 },
    );
    const supKv = readouts(['7805 input', 'ripple', '7805 output']);
    const supStatus = callout();
    const supBuf = { ac: [] as number[], vin: [] as number[], vout: [] as number[] };
    const SUP_DT = 20e-6, SUP_EVERY = 5; // a point every 100 µs: 50 ms on the scope
    let supN = 0;
    const applySupply = () => {
      sup.o = { peak, hz: 60, bridge: rect === 'bridge', cap: CAPS[cap], load: LOADS[load] };
    };
    const supControls = row(
      select<Rect>([{ value: 'bridge', label: 'Full bridge (4 diodes)' }, { value: 'half', label: 'Half-wave (1 diode)' }], rect, (v) => { rect = v; applySupply(); }, 'Rectifier'),
      select<Cap>([{ value: '10000u', label: '10,000 µF' }, { value: '1000u', label: '1,000 µF' }, { value: '100u', label: '100 µF' }, { value: 'none', label: 'none' }], cap, (v) => { cap = v; applySupply(); }, 'Capacitor'),
      select<Load>([{ value: '1k', label: '1 kΩ' }, { value: '100', label: '100 Ω' }, { value: '10', label: '10 Ω' }, { value: 'none', label: 'none' }], load, (v) => { load = v; applySupply(); }, 'Load'),
    );
    const peakSlider = new Slider({ label: 'AC peak', min: 9, max: 25, step: 0.5, value: peak, format: (v) => `±${v.toFixed(1)} V`, onInput: (v) => { peak = v; applySupply(); } });

    // ---- the 60 Hz extraction ---------------------------------------------------------
    let hyst = false, hz = 60, view: View = 'cycles';
    const noise = new Noise(0.05, 50e-6, 11);
    let stage = new InputStage(thresholds(47e3, 47e3, null));
    const EX_DT = 5e-6;
    const keep = Math.round(0.04 / EX_DT); // 40 ms of samples
    const ex = { side: [] as number[], v: [] as number[], ref: [] as number[], out: [] as (0 | 1)[] };
    let exT = 0, secStart = 0, pulses = 0, lastSecond = -1, extra = 0, seconds = 0;
    let lastGlitchAt = -1, lastFallAt = -1;
    const exScope = new Scope(
      [
        { label: 'one side of the AC (V)', kind: 'analog', min: -2, max: 18, guides: [0], color: '#a78bfa' },
        { label: '− input: divided signal · + input: reference (dashed)', kind: 'analog', min: 0, max: 6, color: '#f59e0b', overlayColor: '#60a5fa' },
        { label: 'comparator output (pin 2)', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 56 },
    );
    const exKv = readouts(['reference', 'pulses in the last second', 'extra pulses so far', 'a clock counting them']);
    const exStatus = callout();
    const resetCount = () => {
      pulses = 0;
      extra = 0;
      seconds = 0;
      lastSecond = -1;
      secStart = exT;
    };
    const applyStage = () => {
      const keepOut = stage.comp.out, keepV = stage.v;
      stage = new InputStage(thresholds(47e3, 47e3, hyst ? 100e3 : null));
      stage.comp.out = keepOut;
      stage.v = keepV;
      resetCount();
    };
    const hystToggle = new Toggle({ label: '100 kΩ hysteresis resistor (pin 2 to pin 5)', value: hyst, onChange: (v) => { hyst = v; applyStage(); } });
    const noiseSlider = new Slider({ label: 'Noise at the inputs', min: 0, max: 0.3, step: 0.005, value: noise.amp, format: (v) => `±${Math.round(v * 1000)} mV`, onInput: (v) => { noise.amp = v; resetCount(); } });
    const exControls = row(
      select<'60' | '50'>([{ value: '60', label: '60 Hz (US)' }, { value: '50', label: '50 Hz' }], '60', (v) => { hz = Number(v); resetCount(); }, 'Mains'),
      select<View>([{ value: 'cycles', label: 'Two cycles' }, { value: 'zoom', label: 'Zoom on the switching point (1 ms)' }], view, (v) => (view = v), 'Scope'),
    );

    const stepExtraction = (seconds_: number) => {
      const n = Math.round(seconds_ / EX_DT);
      for (let i = 0; i < n; i++) {
        exT += EX_DT;
        const ac = peak * Math.sin(2 * Math.PI * hz * exT);
        const side = acSide(ac);
        const nz = noise.next(EX_DT);
        const before = stage.comp.out;
        const out = stage.step(side, EX_DT, nz);
        const idx = ex.out.length;
        if (out && !before) {
          pulses++;
          if (lastFallAt >= 0 && idx - lastFallAt < 96e-6 / EX_DT) lastGlitchAt = idx; // a low pulse shorter than 96 µs, like Ben's scope trigger
        }
        if (!out && before) lastFallAt = idx;
        ex.side.push(side);
        ex.v.push(stage.v + nz);
        ex.ref.push(stage.comp.ref);
        ex.out.push(out);
        if (exT - secStart >= 1) {
          secStart += 1;
          lastSecond = pulses;
          extra += pulses - hz;
          seconds++;
          pulses = 0;
        }
      }
      const over = ex.out.length - keep;
      if (over > 0) {
        for (const a of [ex.side, ex.v, ex.ref, ex.out]) a.splice(0, over);
        lastGlitchAt -= over;
        lastFallAt -= over;
      }
    };

    const drawExtraction = () => {
      const per = 1 / hz / EX_DT; // samples per cycle
      let from: number, len: number;
      if (view === 'zoom') {
        len = Math.round(1e-3 / EX_DT);
        const at = lastGlitchAt >= len / 2 ? lastGlitchAt : lastFallAt >= len / 2 ? lastFallAt : ex.out.length - len / 2;
        from = Math.max(0, Math.min(ex.out.length - len, Math.round(at - len / 2)));
      } else {
        len = Math.round(2 * per);
        // trigger on a rising zero crossing of the AC
        from = Math.max(0, ex.side.length - len);
        for (let i = ex.side.length - len; i > 0; i--) if (ex.side[i] > 0 && ex.side[i - 1] <= -0.69) { from = i; break; }
        from = Math.max(0, Math.min(from, ex.side.length - len));
      }
      const pick = <T>(a: T[]) => {
        const out: T[] = [];
        const stepN = Math.max(1, len / N);
        for (let k = 0; k < Math.min(N, len); k++) out.push(a[Math.min(a.length - 1, from + Math.floor(k * stepN))]);
        return out;
      };
      exScope.draw([pick(ex.side), pick(ex.v), pick(ex.out)], { window: Math.min(N, len), overlays: [undefined, pick(ex.ref)] });
    };

    const update = () => {
      // supply readouts over the scope window
      const vin = supBuf.vin, vout = supBuf.vout;
      if (vin.length) {
        const hi = Math.max(...vin), lo = Math.min(...vin), outLo = Math.min(...vout);
        supKv.set('7805 input', `${lo.toFixed(1)} to ${hi.toFixed(1)} V`);
        supKv.set('ripple', `${(hi - lo).toFixed(2)} V`);
        supKv.set('7805 output', outLo >= 4.99 ? '5.00 V, steady' : `dips to ${outLo.toFixed(1)} V`);
        let msg: string;
        if (!CAPS[cap]) msg = `Without the capacitor the 7805 gets the rectifier’s raw ${rect === 'bridge' ? 'humps' : 'half-waves'}. It needs at least 7 V in to give 5 V out, so whenever the input drops below that, the output drops out too.`;
        else if (outLo < 4.99) msg = `The capacitor charges at each peak and feeds the load in between, but ${load === 'none' ? 'it' : `${LOADS[load]} Ω draws ${(hi / (LOADS[load] ?? 1)).toFixed(2)} A, so it`} sags below the 7 V the 7805 needs: the ripple reaches the output. A bigger capacitor, a lighter load or a full bridge (which refills it twice per cycle) fixes it.`;
        else if (load === 'none') msg = 'With nothing drawing current, the capacitor just stays charged to the peak: perfectly smooth, as Ben shows in the simulator.';
        else msg = `The ${rect === 'bridge' ? 'bridge refills the capacitor on both halves of the sine wave' : 'single diode refills the capacitor once per cycle'}; between peaks it feeds the load and the voltage sags a little (the ripple). It stays above 7 V, so the 7805 gives a clean 5 V.`;
        setText(supStatus, msg);
      }
      const th = stage.comp.th;
      exKv.set('reference', hyst ? `${v2(th.whenHigh)} while the output is high, ${v2(th.whenLow)} while it is low` : `${v2(th.whenHigh)} (47 kΩ / 47 kΩ from 5 V)`);
      exKv.set('pulses in the last second', lastSecond < 0 ? 'counting…' : `${lastSecond} (should be ${hz})`);
      exKv.set('extra pulses so far', seconds ? `${extra} in ${seconds} s` : 'counting…');
      if (seconds) {
        const gain = (extra / seconds / hz) * 86400; // seconds per day
        exKv.set('a clock counting them', extra === 0 ? 'keeps time' : `runs fast by ${gain >= 3600 ? `${(gain / 3600).toFixed(1)} hours` : gain >= 60 ? `${(gain / 60).toFixed(0)} minutes` : `${gain.toFixed(0)} seconds`} a day`);
      } else exKv.set('a clock counting them', '…');
      let msg: string;
      if (!hyst && noise.amp > 0)
        msg = `The comparator’s output is high while the divided signal is below the 2.5 V reference and low while it is above. Near the crossing the noise makes the signal cross the reference several times, so the output flips back and forth: extra pulses. ${view === 'zoom' ? 'This is zoomed in on the last switching point.' : 'Zoom in on the switching point to see them.'} Turn on the hysteresis resistor.`;
      else if (!hyst) msg = 'Without noise a single reference works: the output switches once each way per cycle. But a real circuit has noise on both inputs (Ben saw tens of millivolts); turn the noise up.';
      else if (seconds && extra > 0) msg = 'Even with hysteresis, noise this big still gets through now and then: it is larger than the gap between the two references. (Part 2 adds a second line of defence.)';
      else msg = `Hysteresis: the 100 kΩ resistor from the output to the + input pulls the reference up to ${v2(th.whenHigh)} while the output is high and down to ${v2(th.whenLow)} while it is low. The moment the output switches, the reference jumps away from the signal, so noise near the crossing can’t switch it back, like a thermostat with two set points.`;
      setText(exStatus, msg);
    };

    d.add(
      animate((dt) => {
        const s = Math.min(dt, 100) / 1000;
        // supply: keep 50 ms of samples
        const n = Math.round(s / SUP_DT);
        for (let i = 0; i < n; i++) {
          const smp = sup.step(SUP_DT);
          if (++supN % SUP_EVERY === 0) {
            supBuf.ac.push(smp.ac);
            supBuf.vin.push(smp.vin);
            supBuf.vout.push(smp.vout);
          }
        }
        const over = supBuf.ac.length - 2 * N;
        if (over > 0) for (const a of [supBuf.ac, supBuf.vin, supBuf.vout]) a.splice(0, over);
        let from = Math.max(0, supBuf.ac.length - N);
        for (let i = supBuf.ac.length - N; i > 0; i--) if (supBuf.ac[i] >= 0 && supBuf.ac[i - 1] < 0) { from = i; break; }
        const sl = (a: number[]) => a.slice(from, from + N);
        supScope.draw([sl(supBuf.ac), sl(supBuf.vin), sl(supBuf.vout)], { window: N });
        stepExtraction(s);
        drawExtraction();
        update();
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'The 5 V supply',
          { accent: 'red', chips: '12 V AC adapter · DB105 bridge rectifier · 10,000 µF · LM7805 (0.1 µF on its input and output)' },
          supControls,
          row(peakSlider.el),
          supScope.el,
          supKv.el,
          supStatus,
          note('The 7805’s middle pin is ground, the left pin takes 7 to 35 V DC and the right pin gives 5 V. Ben’s adapter says 12 V AC, which is the RMS value: its sine wave peaks at about 17 V (he measured nearer 20 V). Mind the big capacitor’s polarity.'),
        ),
        panel(
          'From the sine wave to a 60 Hz square wave',
          { accent: 'blue', chips: 'LM339 (pins 4 −, 5 +, output 2) · 47 kΩ ×4 · 0.1 µF · 4.7 kΩ pull-up · 100 kΩ hysteresis' },
          exControls,
          row(hystToggle.el),
          row(noiseSlider.el),
          exScope.el,
          exKv.el,
          exStatus,
          note('One side of the AC, measured from the bridge’s ground, swings from about 16 V down to a diode drop below ground. Two 47 kΩ resistors halve it and 0.1 µF smooths it; another two 47 kΩ resistors make the 2.5 V reference. The LM339’s output is open collector: it can only pull low, so a 4.7 kΩ resistor pulls it up. Ben ties the inputs of the three unused comparators to ground, so they don’t switch on their own and add noise.'),
        ),
      ),
    );
    resetCount();
    return d.dispose;
  },
});
