import { Circuit } from '../../logic/circuit';
import { Button, Led, Scope, Slider, Toggle, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { Kit, draw555, drawSupport, kitCss } from './_draw';
import { Astable555, V_HIGH_REF, V_LOW_REF, VCC, astableTiming, fmtF, fmtSI } from './_shared';

const SCOPE = 'lab-555a';
const N = 400; // scope samples per window

type RbMode = 'first' | 'pot';

export default defineLab({
  id: '555-astable',
  title: 'Astable 555 clock',
  summary:
    'The 555 timer in astable mode is the free-running clock of the computer. A capacitor charges through RA + RB until it reaches 2/3 Vcc, then the 555 discharges it through RB until it falls to 1/3 Vcc, and the cycle repeats. Change RA, RB (Ben first used 100 kΩ, then a 1 MΩ pot with 1 kΩ in series) and C, and compare the formulas with the simulated waveform.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE)));

    // ---- parameters ----
    let ra = 1e3;
    let rbMode: RbMode = 'first';
    let pot = 250e3;
    let series1k = true;
    let cap = 1e-6;
    let speed = 1;
    let fixes = true;
    const rb = () => (rbMode === 'first' ? 100e3 : (series1k ? 1e3 : 0) + pot);

    const m = new Astable555(ra, rb(), cap);

    // ---- diagram ----
    const dc = new Circuit();
    const sch = new Schematic(dc, { width: 600, height: 400 });
    const kit = new Kit(sch, dc);
    const ox = 152, oy = 62;
    const X = (x: number) => ox + x, Y = (y: number) => oy + y;
    const at = (x: number, y: number): [number, number] => [X(x), Y(y)];
    const chip = draw555(kit, ox, oy);
    const cx = -75; // external RC chain

    kit.vcc(X(cx), Y(-38));
    kit.wire('vcc', at(cx, -38), at(cx, -20));
    const rRA = kit.resistor(X(cx), Y(-5), 'v');
    const raLabel = kit.text('RA 1 kΩ', at(cx - 12, -5), { anchor: 'end', size: 11 });
    kit.ana('ana', at(cx, 10), at(cx, 30), chip.pin[7]);
    kit.anaDot('ana', at(cx, 30));
    // RB variants
    const rRB: SVGRectElement[] = [];
    const vFixed = kit.group(() => {
      kit.ana('ana', at(cx, 30), at(cx, 65));
      const r = kit.resistor(X(cx), Y(80), 'v');
      kit.text('RB', at(cx - 12, 74), { anchor: 'end', size: 11 });
      kit.text('100 kΩ', at(cx - 12, 88), { anchor: 'end', size: 11, class: 'dim' });
      kit.ana('ana', at(cx, 95), at(cx, 130));
      rRB.push(r.el);
    });
    const potLabel = { el: null as SVGTextElement | null };
    const vPot1k = kit.group(() => {
      kit.ana('ana', at(cx, 30), at(cx, 40));
      const r1 = kit.resistor(X(cx), Y(55), 'v');
      kit.text('1 kΩ', at(cx - 12, 55), { anchor: 'end', size: 11 });
      kit.ana('ana', at(cx, 70), at(cx, 85));
      rRB.push(r1.el);
    });
    const vPotWire = kit.group(() => {
      kit.ana('ana', at(cx, 30), at(cx, 85));
      kit.text('(no 1 kΩ)', at(cx - 12, 55), { anchor: 'end', size: 10, class: 'faint' });
    });
    const vPot = kit.group(() => {
      const r2 = kit.pot(X(cx), Y(100), undefined, 'left');
      kit.text('RV1 pot', at(cx - 14, 96), { anchor: 'end', size: 11 });
      potLabel.el = kit.text('250 kΩ', at(cx - 14, 110), { anchor: 'end', size: 11, class: 'dim' });
      kit.ana('ana', at(cx, 115), at(cx, 130));
      rRB.push(r2.el);
    });
    kit.ana('ana', at(cx, 130), chip.pin[6]);
    kit.anaDot('ana', at(cx, 130));
    kit.ana('ana', at(cx, 130), at(cx, 230), chip.pin[2]);
    kit.anaDot('ana', at(cx, 230));
    kit.ana('ana', at(cx, 230), at(cx, 246.5));
    kit.cap(X(cx), Y(250), 'v');
    const cLabel = kit.text('C 1 µF', at(cx - 16, 250), { anchor: 'end', size: 11 });
    kit.wire('gnd', at(cx, 253.5), at(cx, 268));
    kit.ground(X(cx), Y(268));
    const vcText = kit.text('Vc 0.00 V', at(cx + 7, 180), { anchor: 'start', size: 11, class: 'ana-text' });
    const sup = drawSupport(kit, chip, ox, oy, { resetToVcc: true, led: 'blue', outLabel: 'CLK' });
    const led = sup.led;

    // ---- widgets ----
    const bigLed = new Led('blue', 'Clock LED');
    bigLed.el.style.width = bigLed.el.style.height = '26px';
    const freqText = h('span', { class: 'mono' });
    const status = callout();
    const kv = readouts(['t_high = 0.693·(RA+RB)·C', 't_low = 0.693·RB·C', 'T = t_high + t_low', 'f = 1.44 / ((RA+2·RB)·C)', 'duty = (RA+RB) / (RA+2·RB)', 'simulated period']);

    const scope = new Scope(
      [
        { label: 'Vc (pins 2+6)', kind: 'analog', min: 0, max: VCC, guides: [V_LOW_REF, V_HIGH_REF], color: '#f59e0b' },
        { label: 'OUT (pin 3)', color: '#60a5fa' },
        { label: 'discharge transistor on', color: '#f87171' },
        { label: 'VCC rail', kind: 'analog', min: 3.8, max: 6.2, guides: [VCC], color: '#a3e635' },
      ],
      { width: 640, laneHeight: 52 },
    );
    const windowText = h('span', { class: 'dim small' });

    const potSlider = new Slider({ label: 'Pot', min: 0, max: 1e6, step: 1e3, value: pot, format: (v) => fmtSI(v, 'Ω'), onInput: (v) => { pot = v; apply(); } });
    const raSlider = new Slider({ label: 'RA', min: 1e3, max: 100e3, log: true, value: ra, format: (v) => fmtSI(v, 'Ω'), onInput: (v) => { ra = v; apply(); } });
    const cSlider = new Slider({ label: 'C', min: 0.01e-6, max: 10e-6, log: true, value: cap, format: (v) => fmtF(v), onInput: (v) => { cap = v; apply(); } });
    const seriesToggle = new Toggle({ label: '1 kΩ in series with the pot', value: true, onChange: (v) => { series1k = v; apply(); } });
    const potRow = row(potSlider.el, seriesToggle.el);
    const rbSelect = select<RbMode>(
      [
        { value: 'first', label: 'RB = 100 kΩ (first build)' },
        { value: 'pot', label: 'RB = 1 kΩ + 1 MΩ pot (final)' },
      ],
      rbMode,
      (v) => { rbMode = v; apply(); },
      'RB',
    );
    const preset = (label: string, v: number) => new Button({ label, onClick: () => { cap = v; cSlider.set(v); apply(); } }).el;
    const speedSlider = new Slider({ label: 'Speed', min: 0.001, max: 1, log: true, value: 1, format: (v) => (v >= 0.999 ? 'real time' : `${+v.toPrecision(2)}×`), onInput: (v) => (speed = v) });
    const fixesToggle = new Toggle({ label: 'CV 0.01 µF + 0.1 µF decoupling fitted', value: true, onChange: (v) => { fixes = v; apply(); } });

    // ---- scope buffers ----
    const buf = { vc: [] as number[], out: [] as (0 | 1)[], dis: [] as (0 | 1)[], vcc: [] as number[] };
    const RING = [0.95, -0.7, 0.4, -0.2, 0.08];
    let ring = RING.length;
    let windowS = 0.4;
    let acc = 0;
    const clearBuf = () => {
      buf.vc.length = buf.out.length = buf.dis.length = buf.vcc.length = 0;
    };
    const push = () => {
      buf.vc.push(m.vc);
      buf.out.push(m.q);
      buf.dis.push(m.q ? 0 : 1);
      let v = VCC;
      if (ring < RING.length) v += RING[ring++] * (fixes ? 0.08 : 1);
      buf.vcc.push(v);
    };
    const trim = () => {
      const extra = buf.vc.length - 2 * N;
      if (extra > 0) for (const a of [buf.vc, buf.out, buf.dis, buf.vcc]) a.splice(0, extra);
    };

    let flash: { which: 'thr' | 'trig'; until: number } | null = null;
    let nowMs = 0;
    const onEdge = (e: { by: 'thr' | 'trig' }) => {
      flash = { which: e.by, until: nowMs + 220 };
      ring = 0;
    };

    const apply = () => {
      m.ra = ra;
      m.rb = rb();
      m.c = cap;
      m.noise = fixes ? 0 : 0.18;
      const tm = astableTiming(ra, m.rb, cap);
      const w = Math.min(Math.max(tm.period * 3, 2e-5), 30);
      if (Math.abs(w - windowS) / windowS > 0.25) {
        windowS = w;
        clearBuf();
        acc = 0;
      }
      potSlider.set(pot);
      potRow.style.display = rbMode === 'pot' ? '' : 'none';
      vFixed.show(rbMode === 'first');
      vPot.show(rbMode === 'pot');
      vPot1k.show(rbMode === 'pot' && series1k);
      vPotWire.show(rbMode === 'pot' && !series1k);
      sup.cv.show(fixes);
      sup.cvOpen.show(!fixes);
      sup.dec.show(fixes);
      if (potLabel.el) setText(potLabel.el, fmtSI(pot, 'Ω'));
      setText(raLabel, `RA ${fmtSI(ra, 'Ω')}`);
      setText(cLabel, `C ${fmtF(cap)}`);
      const R = (v: number) => fmtSI(v, 'Ω');
      kv.set('t_high = 0.693·(RA+RB)·C', `0.693 × ${R(ra + m.rb)} × ${fmtF(cap)} = ${fmtSI(tm.tHigh, 's')}`);
      kv.set('t_low = 0.693·RB·C', `0.693 × ${R(m.rb)} × ${fmtF(cap)} = ${fmtSI(tm.tLow, 's')}`);
      kv.set('T = t_high + t_low', fmtSI(tm.period, 's'));
      kv.set('f = 1.44 / ((RA+2·RB)·C)', `1.44 / (${R(ra + 2 * m.rb)} × ${fmtF(cap)}) = ${fmtSI(tm.freq, 'Hz')}`);
      kv.set('duty = (RA+RB) / (RA+2·RB)', `${(tm.duty * 100).toFixed(1)} %`);
      setText(windowText, `Scope window ${fmtSI(windowS, 's')} (about 3 periods).`);
    };
    apply();

    const update = (bright: number) => {
      const tm = astableTiming(ra, m.rb, cap);
      const fast = tm.period / speed < 0.12;
      const fl = flash && flash.until > nowMs ? flash.which : null;
      chip.update({ trig: false, thr: false, flash: fl, armed: m.q ? 'thr' : 'trig', resetHigh: true, q: m.q, hiRefV: m.hiRef, loRefV: m.loRef });
      led.set(fast ? true : m.q === 1, fast ? bright : 1);
      bigLed.set(fast ? true : m.q === 1);
      bigLed.el.style.opacity = fast ? String(Math.max(0.35, bright)) : '1';
      rRA.el.classList.toggle('hot', m.q === 1);
      for (const r of rRB) r.classList.toggle('hot', true);
      setText(vcText, `Vc ${m.vc.toFixed(2)} V`);
      const meas = m.measuredPeriod();
      kv.set('simulated period', meas ? `${fmtSI(meas, 's')} (formula ${fmtSI(tm.period, 's')})` : 'measuring…');
      setText(freqText, `${fmtSI(tm.freq, 'Hz')} · ${(tm.duty * 100).toFixed(0)} % high`);
      const rbNow = m.rb;
      let msg: string;
      if (rbNow < 1) msg = 'RB = 0: the pot is at zero and there is no series resistor. When the discharge transistor turns on it shorts the capacitor directly (and VCC through RA straight to GND), so the low time collapses to almost nothing. That is why Ben keeps a 1 kΩ resistor in series with the pot.';
      else if (fast) msg = `The clock runs at ${fmtSI(tm.freq, 'Hz')}, too fast to follow at this speed: the LED just looks dimmer. Slow the simulation down to watch one cycle at a time.`;
      else if (tm.tLow / speed < 0.8) msg = `C charges through RA + RB (${fmtSI(ra + rbNow, 'Ω')}) while the output is high, until Vc reaches 2/3 Vcc and the threshold comparator resets the flip-flop. Then Q̅ turns the discharge transistor on and C discharges through RB alone (${fmtSI(rbNow, 'Ω')}) until Vc falls to 1/3 Vcc and the trigger comparator sets the flip-flop again. Slow the simulation down to follow one step at a time.`;
      else if (m.q) msg = `Output high. Q̅ is low, so the discharge transistor is off and C charges through RA + RB (${fmtSI(ra + rbNow, 'Ω')}) towards 5 V. Vc = ${m.vc.toFixed(2)} V. At ${m.hiRef.toFixed(2)} V (2/3 Vcc) the threshold comparator resets the flip-flop.`;
      else msg = `Output low. Q̅ is high, so the discharge transistor pulls pin 7 to GND and C discharges through RB alone (${fmtSI(rbNow, 'Ω')}). Vc = ${m.vc.toFixed(2)} V. At ${m.loRef.toFixed(2)} V (1/3 Vcc) the trigger comparator sets the flip-flop again.`;
      if (!fixes && !fast) msg += ' Without the CV capacitor and decoupling, every output transition kicks the supply and the comparator thresholds wander, so the period jitters.';
      setText(status, msg);
    };

    d.add(
      animate((dt, now) => {
        nowMs = now;
        const dtS = windowS / N;
        acc += (Math.min(dt, 100) / 1000) * speed;
        if (acc > windowS * 2) {
          // skip time nobody will see; keep the phase but not thousands of cycles
          const T = astableTiming(ra, m.rb, cap).period;
          let skip = acc - windowS * 2;
          if (skip > 4 * T) skip = (skip % T) + T;
          m.advance(skip);
          acc = windowS * 2;
        }
        let hi = 0, n = 0;
        while (acc >= dtS) {
          acc -= dtS;
          m.advance(dtS, onEdge);
          push();
          hi += m.q;
          n++;
        }
        trim();
        // trigger on a rising edge when the waveform is fast, roll otherwise
        let start = Math.max(0, buf.out.length - N);
        const tm = astableTiming(ra, m.rb, cap);
        if (tm.period / speed < 0.5) {
          for (let i = buf.out.length - N; i > 0; i--) {
            if (buf.out[i] === 1 && buf.out[i - 1] === 0) {
              start = i - 4 >= 0 ? i - 4 : i;
              break;
            }
          }
          start = Math.max(0, Math.min(start, buf.out.length - N));
        }
        const sl = <T>(a: T[]) => a.slice(start, start + N);
        scope.draw([sl(buf.vc), sl(buf.out), sl(buf.dis), sl(buf.vcc)], { window: N });
        update(n ? hi / n : m.q);
      }),
    );

    const legend = h(
      'div',
      { class: 'legend' },
      h('span', null, h('i', { style: 'background:var(--ana)' }), 'capacitor voltage'),
      h('span', null, h('i', { style: 'background:var(--ref)' }), 'divider references'),
      h('span', null, h('i', { style: 'background:var(--wire-1)' }), 'logic high'),
      h('span', null, h('i', { style: 'background:var(--wire-0)' }), 'logic low'),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'LM555 in astable mode',
          { accent: 'blue', chips: 'LM555 · RA 1 kΩ · RB 100 kΩ, later 1 kΩ + 1 MΩ pot · C 1 µF (measured ≈ 2 µF) · 0.01 µF on CV · LED + 330 Ω' },
          sch.el,
          legend,
          row(bigLed.el, h('strong', null, 'Clock LED'), freqText),
          status,
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            'Parts',
            { accent: 'gray' },
            row(rbSelect),
            potRow,
            row(raSlider.el),
            row(cSlider.el),
            row(h('span', { class: 'dim small' }, 'C presets:'), preset('1 µF', 1e-6), preset("2 µF (Ben's measured)", 2e-6), preset('0.1 µF', 0.1e-6)),
          ),
          panel(
            'Formulas (LM555 datasheet)',
            { accent: 'gray' },
            kv.el,
            note('Ben’s first build used RA = 1 kΩ, RB = 100 kΩ and a capacitor marked 1 µF. The formula predicts T = 0.693 × 201 kΩ × 1 µF = 139 ms, but his scope measured 263 ms: the capacitor really was about 2 µF (278 ms). Try the 2 µF preset.'),
          ),
          panel(
            'Oscilloscope',
            { accent: 'gray' },
            scope.el,
            windowText,
            row(speedSlider.el),
            row(fixesToggle.el),
            note('The dashed lines on Vc are 1/3 and 2/3 Vcc. Ben saw glitches on his scope, so he added 0.01 µF from pin 5 (CV) to GND as the datasheet suggests, a 0.1 µF capacitor across the supply right next to the chip, a shorter USB cable, and tied RESET (pin 4) to VCC. Switch the fixes off to see an illustration of what they prevent.'),
          ),
        ),
      ),
    );
    return d.dispose;
  },
});
