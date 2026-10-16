import type { Machine } from '../sim/machine';
import { Slider } from './components';

/**
 * The clock's Speed slider, on the computer page and the breadboard view. Ben's 555 (1 kΩ +
 * 1 kΩ..1 MΩ pot, 1 µF) spans ~0.7–480 Hz; beyond that is simulator turbo. Call `sync` from
 * the machine's onChange, so the slider follows speed changes made elsewhere (e.g. the pot RV1).
 */
export function speedSlider(m: Machine): { el: HTMLElement; sync: () => void } {
  const slider = new Slider({
    label: 'Speed', min: 0.5, max: 500_000, value: m.hz, log: true,
    format: (v) => (v >= 1000 ? `${(v / 1000).toPrecision(3)} kHz` : `${v.toPrecision(v < 10 ? 2 : 3)} Hz`),
    onInput: (v) => m.setHz(v),
  });
  const sync = () => {
    if (Math.abs(slider.value - m.hz) > 1e-9) slider.set(m.hz);
  };
  return { el: slider.el, sync };
}
