import { Scope, Slider, Toggle, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { callout } from '../latches/_shared';
import { defineLab } from '../types';
import { InputStage, Noise, SquareChain, acSide, duty, thresholds } from './_analog';

const N = 500; // scope points
const DT = 5e-6; // the edge detector's pulses last about 33 µs
const pct = (v: number) => `${(v * 100).toFixed(0)} %`;

type Stages = 'one' | 'all';
type Top = '20k' | '30k' | '47k' | '200k';
const TOPS: Record<Top, number> = { '20k': 20e3, '30k': 30e3, '47k': 47e3, '200k': 200e3 };

export default defineLab({
  id: 'square-wave',
  title: 'Making a square wave square',
  summary:
    'The comparator from part 1 gives 60 Hz, but its duty cycle depends on how big the sine wave is next to the 2.5 V reference, and AC adapters vary (Ben’s “12 V” adapter gives about 15 V, his 240 V one about 12 V instead of 9 V). Ben makes the output independent of the input: an edge detector turns each falling edge into a short pulse, a second comparator turns the pulses into clean logic, each pulse dumps a 0.1 µF capacitor that recharges through 100 kΩ (a 10 ms ramp), and a third comparator turns the ramp into the final square wave. The ramp also swallows extra pulses that noise sneaks past the hysteresis.',
  mount(root) {
    const d = new Disposer();
    let rms = 12, top: Top = '47k', stages: Stages = 'all', hyst = true;
    const noise = new Noise(0, 50e-6, 5);
    let stage = new InputStage(thresholds(TOPS[top], 47e3, hyst ? 100e3 : null));
    const chain = new SquareChain();
    let t = 0;

    // 3 cycles of samples, kept a bit longer so the trigger can look back
    const keep = Math.round(0.08 / DT);
    const buf = { sig: [] as number[], ref1: [] as number[], c1: [] as (0 | 1)[], edge: [] as number[], ramp: [] as number[], ref3: [] as number[], c3: [] as (0 | 1)[] };
    // pulses counted over the last second
    let secStart = 0, c1Edges = 0, c3Edges = 0, lastC1 = 0 as 0 | 1, lastC3 = 0 as 0 | 1, perSec: [number, number] | null = null;

    const scope = new Scope(
      [
        { label: 'comparator 1: − divided signal, + reference (dashed)', kind: 'analog', min: 0, max: 9, color: '#f59e0b', overlayColor: '#60a5fa' },
        { label: 'comparator 1 output (pin 2)', color: '#a78bfa' },
        { label: 'edge detector: comparator 2 + (pin 7), 2.5 V dashed', kind: 'analog', min: 0, max: 6, guides: [2.5], color: '#f472b6' },
        { label: 'ramp: comparator 2 output (pin 1), comparator 3 reference', kind: 'analog', min: 0, max: 5.5, color: '#fbbf24', overlayColor: '#60a5fa' },
        { label: 'final output: comparator 3 (pin 14)', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 50 },
    );
    const kv = readouts(['comparator 1 duty cycle', 'final duty cycle', 'pulses per second']);
    const status = callout();
    const resetCount = () => {
      secStart = t;
      c1Edges = c3Edges = 0;
      perSec = null;
    };
    const rebuild = () => {
      const out = stage.comp.out, v = stage.v;
      stage = new InputStage(thresholds(TOPS[top], 47e3, hyst ? 100e3 : null));
      stage.comp.out = out;
      stage.v = v;
      resetCount();
    };

    const rmsSlider = new Slider({ label: 'Adapter', min: 6, max: 24, step: 0.5, value: rms, format: (v) => `${v.toFixed(1)} V AC (±${(v * Math.SQRT2).toFixed(0)} V)`, onInput: (v) => { rms = v; resetCount(); } });
    const noiseSlider = new Slider({ label: 'Noise at comparator 1', min: 0, max: 1.4, step: 0.02, value: 0, format: (v) => `±${v.toFixed(2)} V`, onInput: (v) => { noise.amp = v; resetCount(); } });
    const hystToggle = new Toggle({ label: '100 kΩ hysteresis on comparator 1', value: hyst, onChange: (v) => { hyst = v; rebuild(); } });
    const controls = row(
      select<Stages>([{ value: 'all', label: 'Ben’s final circuit (3 comparators)' }, { value: 'one', label: 'Comparator 1 only (part 1)' }], stages, (v) => { stages = v; resetCount(); }, 'Circuit'),
      select<Top>([{ value: '47k', label: '47 kΩ' }, { value: '200k', label: '200 kΩ' }, { value: '30k', label: '30 kΩ' }, { value: '20k', label: '20 kΩ' }], top, (v) => { top = v; rebuild(); }, 'Comparator 1 reference, top resistor'),
    );

    const step = (seconds: number) => {
      const n = Math.round(seconds / DT);
      const peak = rms * Math.SQRT2;
      for (let i = 0; i < n; i++) {
        t += DT;
        const nz = noise.next(DT);
        const c1 = stage.step(acSide(peak * Math.sin(2 * Math.PI * 60 * t)), DT, nz);
        const c3 = chain.step(c1, DT);
        if (c1 && !lastC1) c1Edges++;
        if (c3 && !lastC3) c3Edges++;
        lastC1 = c1;
        lastC3 = c3;
        buf.sig.push(stage.v + nz);
        buf.ref1.push(stage.comp.ref);
        buf.c1.push(c1);
        buf.edge.push(chain.edge);
        buf.ramp.push(chain.ramp);
        buf.ref3.push(chain.comp3.ref);
        buf.c3.push(c3);
        if (t - secStart >= 1) {
          perSec = [c1Edges, c3Edges];
          c1Edges = c3Edges = 0;
          secStart += 1;
        }
      }
      const over = buf.c1.length - keep;
      if (over > 0) for (const a of Object.values(buf)) a.splice(0, over);
    };

    const draw = () => {
      const len = Math.round(3 / 60 / DT);
      // trigger on comparator 1's falling edge (where the ramp starts)
      let from = Math.max(0, buf.c1.length - len);
      for (let i = buf.c1.length - len; i > 0; i--) if (!buf.c1[i] && buf.c1[i - 1]) { from = Math.max(0, i - Math.round(0.002 / DT)); break; }
      from = Math.min(from, Math.max(0, buf.c1.length - len));
      const per = Math.max(1, Math.floor(len / N));
      const pick = (a: number[], how: 'last' | 'min' = 'last') => {
        const out: number[] = [];
        for (let k = 0; k < N; k++) {
          const i0 = from + k * per;
          if (i0 >= a.length) break;
          let v = a[Math.min(a.length - 1, i0 + per - 1)];
          if (how === 'min') for (let i = i0; i < i0 + per && i < a.length; i++) v = Math.min(v, a[i]);
          out.push(v);
        }
        return out;
      };
      const all = stages === 'all';
      scope.draw([pick(buf.sig), pick(buf.c1), all ? pick(buf.edge, 'min') : [], all ? pick(buf.ramp) : [], all ? pick(buf.c3) : []], { window: N, overlays: [pick(buf.ref1), undefined, undefined, all ? pick(buf.ref3) : undefined] });
      const win = Math.round(0.05 / DT);
      const d1 = duty(buf.c1.slice(-win)), d3 = duty(buf.c3.slice(-win));
      kv.set('comparator 1 duty cycle', pct(d1));
      kv.set('final duty cycle', all ? pct(d3) : '–');
      kv.set('pulses per second', perSec ? (all ? `comparator 1: ${perSec[0]}, final: ${perSec[1]}` : `${perSec[0]}`) : 'counting…');
      let msg: string;
      if (!all)
        msg = `Comparator 1 alone: high while the divided sine wave is below the reference, so its duty cycle (${pct(d1)} now) depends on the sine wave’s size. Try another adapter voltage or reference resistor: tuning the resistor to get 50 % only works until the input voltage changes. Ben adds two more comparators.`;
      else if (perSec && perSec[0] > 60 && perSec[1] === 60)
        msg = `Comparator 1 is letting noise through (${perSec[0]} pulses a second instead of 60), but the final output still gives exactly 60. An extra pulse just dumps the ramp capacitor again before it has charged much, so the ramp, and comparator 3, only see one pulse per cycle.`;
      else if (perSec && perSec[1] !== 60)
        msg = `This much noise is too much even for the ramp: the final output gives ${perSec[1]} pulses a second. Ben’s circuit handles a lot of noise, though not unlimited amounts.`;
      else
        msg = `Each falling edge of comparator 1 dips the edge detector to 0 V for about 33 µs (the diode clips the upward spike), comparator 2 pulls its output low for that moment and dumps the 0.1 µF capacitor, which then recharges through 100 kΩ (τ = 10 ms). Comparator 3 is high until the ramp passes its reference, so the final output is about ${pct(d3)} high whatever the adapter gives: change the voltage and only comparator 1’s duty cycle moves.`;
      setText(status, msg);
    };

    d.add(
      animate((dt) => {
        step(Math.min(dt, 100) / 1000);
        draw();
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'Three comparators',
          { accent: 'blue', chips: 'LM339: comparator 1 (pins 4, 5 → 2), 2 (6, 7 → 1), 3 (8, 9 → 14) · 0.01 µF + 4.7 kΩ + diode edge detector · 100 kΩ + 0.1 µF ramp · 47 kΩ dividers · 100 kΩ hysteresis' },
          controls,
          row(rmsSlider.el),
          row(noiseSlider.el, hystToggle.el),
          scope.el,
          kv.el,
          status,
        ),
        panel(
          'How the pieces work',
          { accent: 'gray' },
          note('Edge detector: a capacitor passes only changes. When comparator 1’s output falls, the far side of the 0.01 µF capacitor dips from 5 V to 0 V and the 4.7 kΩ pull-up brings it back within a few tens of microseconds. When the output rises, the far side would jump to 10 V, but the diode to 5 V clips it. So only the falling edges make pulses.'),
          note('Ramp: comparator 2’s output is open collector, so it can pull the 0.1 µF capacitor hard to ground during each pulse, but only the 100 kΩ pull-up charges it back up: 0.1 µF × 100 kΩ = 10 ms, a bit more than half of the 16.7 ms period, which Ben aimed for.'),
          note('Noise: even one extra pulse in 10,000 makes the clock run fast by one part in 10,000, and with about 10,000 minutes in a week that is a minute a week, as Ben points out. Turn the noise up past what the hysteresis can handle and compare the pulse counts: a second pulse arrives while the ramp has barely started, so it just starts it again.'),
        ),
      ),
    );
    resetCount();
    return d.dispose;
  },
});
