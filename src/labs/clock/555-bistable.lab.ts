import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { callout, injectStyle, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { Kit, draw555, drawSupport, kitCss } from './_draw';
import { type Bit, type BistableCapture, type SpdtFlip, levelAt, simulateBistable, spdtFlip } from './_shared';

const SCOPE = 'lab-555b';
const DT = 10e-6;
const PRE = 1e-3;
const WIN = 12e-3;
const REPLAY_MS = 2600; // the 12 ms capture replayed about 200× slower

export default defineLab({
  id: '555-bistable',
  title: 'Bistable 555 (debounced mode switch)',
  summary:
    'The third 555 is used only for its flip-flop. The auto/manual toggle switch grounds either TRIG (pin 2) or RESET (pin 4), and both pins are pulled up with 1 kΩ. The switch contact bounces when it lands, but a flip-flop that is already set ignores more set pulses, so the output changes exactly once. Flip the switch and watch the slowed-down replay.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE)));

    let severity = 0.5;
    let side: 'a' | 'c' = 'a'; // lever on A = TRIG grounded = AUTO
    let q: Bit = 1;
    let flip: SpdtFlip | null = null;
    let cap: BistableCapture | null = null;
    let replayStart = -1;
    let cursor = -1; // sample index being shown, -1 = live/final
    let nowMs = 0;

    // ---- diagram ----
    const dc = new Circuit();
    const sch = new Schematic(dc, { width: 600, height: 446 });
    const kit = new Kit(sch, dc);
    const ox = 152, oy = 62;
    const X = (x: number) => ox + x, Y = (y: number) => oy + y;
    const at = (x: number, y: number): [number, number] => [X(x), Y(y)];
    const chip = draw555(kit, ox, oy, { thrDead: true, disUnused: true, trigNet: 'p2', thrNet: 'gnd' });
    const sup = drawSupport(kit, chip, ox, oy, { led: 'yellow', outLabel: 'SEL' });
    // DIS not connected, THR to GND
    kit.text('NC', at(-30, 22), { size: 10, class: 'faint' });
    kit.wire('gnd', chip.pin[6], at(-34, 130));
    kit.ground(X(-34), Y(130));
    // pin 2: 1 kΩ pull-up and throw A
    kit.wire('p2', chip.pin[2], at(-45, 230));
    kit.dot('p2', at(-45, 230));
    kit.vcc(X(-45), Y(186));
    kit.wire('vcc', at(-45, 186), at(-45, 190));
    kit.resistor(X(-45), Y(205), 'v', '1 kΩ');
    kit.wire('p2', at(-45, 220), at(-45, 230), at(-100, 230), at(-100, 320));
    // pin 4: 1 kΩ pull-up and throw C
    kit.wire('p4', chip.pin[4], at(255, 372), at(-40, 372), at(-40, 320));
    kit.dot('p4', at(255, 350));
    kit.wire('p4', at(255, 350), at(290, 350));
    kit.resistor(X(305), Y(350), 'h', '1 kΩ');
    kit.wire('vcc', at(320, 350), at(336, 350));
    kit.vcc(X(336), Y(350));
    // the switch: common to GND
    const sw = kit.spdt(at(-70, 352), at(-100, 320), at(-40, 320));
    kit.wire('gnd', at(-70, 352), at(-70, 358));
    kit.ground(X(-70), Y(358));
    kit.text('AUTO', at(-108, 320), { anchor: 'end', size: 11 });
    kit.text('MANUAL', at(-32, 318), { anchor: 'start', size: 11 });
    kit.text('SW2', at(-84, 352), { anchor: 'end', size: 11, class: 'dim' });

    // ---- widgets ----
    const status = callout();
    const kv = readouts(['trigger comparator fired', 'RESET pulled low', 'output changed', 'bare switch as SEL']);
    kv.set('trigger comparator fired', '—');
    const scope = new Scope(
      [
        { label: 'pin 2 TRIG (throw A)', color: '#60a5fa' },
        { label: 'pin 4 RESET (throw C)', color: '#c084fc' },
        { label: 'trigger comparator fires', color: '#f59e0b' },
        { label: '555 OUT = SEL', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 48 },
    );
    const tt = truthTable(
      ['pin 2', 'pin 4', 'OUT', ''],
      [
        ['high', 'high', 'Q', 'hold'],
        ['low', 'high', '1', 'set: AUTO (astable)'],
        ['high', 'low', '0', 'reset: MANUAL'],
        ['low', 'low', '0', 'reset wins'],
      ],
    );
    const modeToggle = new Toggle({ label: 'Mode switch', value: true, onLabel: 'AUTO', offLabel: 'MANUAL', onChange: (v) => doFlip(v ? 'a' : 'c') });
    const sev = new Slider({ label: 'Bounce', min: 0, max: 1, step: 0.05, value: severity, format: (v) => (v === 0 ? 'none' : v < 0.35 ? 'mild' : v < 0.7 ? 'typical' : 'severe'), onInput: (v) => (severity = v) });
    const replayBtn = new Button({ label: 'Replay slowly', onClick: () => cap && (replayStart = nowMs) });

    const doFlip = (to: 'a' | 'c') => {
      if (to === side) return;
      flip = spdtFlip(Math.random, to, severity);
      cap = simulateBistable(q, flip, { dt: DT, window: WIN, pre: PRE });
      q = cap.out[cap.out.length - 1];
      side = to;
      modeToggle.set(to === 'a');
      replayStart = nowMs;
      kv.set('trigger comparator fired', `${cap.trigFires}×`);
      kv.set('RESET pulled low', `${cap.resetFires}×`);
      kv.set('output changed', `${cap.outEdges}×`);
      kv.set('bare switch as SEL', `${cap.bareEdges} edges on pin ${to === 'a' ? 2 : 4}`);
    };
    d.listen(sw.el, 'click', () => doFlip(side === 'a' ? 'c' : 'a'));
    d.listen(sw.el, 'keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        doFlip(side === 'a' ? 'c' : 'a');
      }
    });

    /** Lever position at capture time t: 0 = on A, 1 = on C. */
    const leverAt = (f: SpdtFlip, t: number): { pos: number; touch: boolean } => {
      const from = f.to === 'a' ? 1 : 0, to = f.to === 'a' ? 0 : 1;
      const landing = f.to === 'a' ? f.a : f.c;
      const tLand = landing[0].t;
      if (t < 0) return { pos: from, touch: true };
      if (t >= tLand) return { pos: to, touch: levelAt(landing, t, 0) === 1 };
      const leaving = f.to === 'a' ? f.c : f.a;
      const k = t / tLand;
      return { pos: from + (to - from) * Math.max(0.05, Math.min(0.95, k)), touch: levelAt(leaving, t, 1) === 1 && k < 0.05 };
    };

    const describe = (i: number, c: BistableCapture): string => {
      const t = c.t[i];
      const p2 = c.pin2[i], p4 = c.pin4[i], out = c.out[i];
      const ms = (t * 1000).toFixed(2);
      const toAuto = flip?.to === 'a';
      if (t < 0) return `t = ${ms} ms. The lever still rests on ${toAuto ? 'MANUAL: pin 4 is grounded and holds the flip-flop reset' : 'AUTO: pin 2 is grounded, so the trigger comparator holds the flip-flop set'}.`;
      if (!p2 && p4) return `t = ${ms} ms. Contact A touches: pin 2 is below 1/3 Vcc, so the trigger comparator fires and sets the flip-flop. OUT = ${out}${c.out[Math.max(0, i - 1)] === 0 ? ' (it just changed)' : ', it was already set, so nothing changes'}.`;
      if (p2 && !p4) return `t = ${ms} ms. Contact C touches: pin 4 is low, which resets the flip-flop. OUT = ${out}${c.out[Math.max(0, i - 1)] === 1 ? ' (it just changed)' : ', it was already reset, so nothing changes'}.`;
      if (p2 && p4) return `t = ${ms} ms. No contact is touching (travelling or bounced off): both pull-ups hold pins 2 and 4 high, the trigger comparator is quiet and the flip-flop simply holds OUT = ${out}.`;
      return `t = ${ms} ms. Both pins low.`;
    };

    const show = (i: number) => {
      if (!cap || !flip) return;
      const p2 = cap.pin2[i], p4 = cap.pin4[i];
      const lev = leverAt(flip, cap.t[i]);
      sw.set(lev.pos, lev.touch);
      kit.level('p2', p2);
      kit.level('p4', p4);
      chip.update({ trig: cap.trig[i] === 1, thr: false, resetHigh: p4 === 1, q: cap.out[i] });
      sup.led.set(cap.out[i] === 1);
      tt.set(p2 && p4 ? 0 : !p2 && p4 ? 1 : p2 && !p4 ? 2 : 3);
      setText(status, describe(i, cap));
    };

    const showRest = () => {
      sw.set(side === 'a' ? 0 : 1, true);
      kit.level('p2', side === 'a' ? 0 : 1);
      kit.level('p4', side === 'c' ? 0 : 1);
      chip.update({ trig: side === 'a', thr: false, resetHigh: side !== 'c', q });
      sup.led.set(q === 1);
      tt.set(side === 'a' ? 1 : 2);
      const base = side === 'a' ? 'AUTO: the switch grounds pin 2, the trigger comparator keeps the flip-flop set and OUT = SEL = 1 selects the astable clock.' : 'MANUAL: the switch grounds pin 4 (RESET), so OUT = SEL = 0 selects the single-step button.';
      setText(status, cap ? `${base} Last flip: the trigger comparator fired ${cap.trigFires}× and RESET went low ${cap.resetFires}×, but the output changed only ${cap.outEdges}×. A select line taken straight from the contact it landed on would have seen ${cap.bareEdges} edges.` : `${base} THR (pin 6) is tied to GND, so the threshold comparator never fires; DIS (pin 7) is not connected.`);
    };

    const drawCursor = (i: number) => {
      const ctx = scope.canvas.getContext?.('2d');
      if (!ctx || !cap) return;
      const x = (i / (cap.t.length - 1)) * scope.canvas.width;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scope.canvas.height);
      ctx.stroke();
      ctx.restore();
    };

    // idle trace before the first flip: flat lines in AUTO
    const idle = simulateBistable(1, { a: [], c: [], a0: 1, c0: 0, to: 'a' }, { dt: DT, window: WIN, pre: PRE });

    d.add(
      animate((_dt, now) => {
        nowMs = now;
        const c = cap ?? idle;
        if (cap && replayStart >= 0) {
          const k = (now - replayStart) / REPLAY_MS;
          if (k >= 1) {
            replayStart = -1;
            cursor = -1;
          } else cursor = Math.min(c.t.length - 1, Math.floor(k * c.t.length));
        }
        scope.draw([c.pin2, c.pin4, c.trig, c.out], { window: c.t.length });
        if (cursor >= 0 && cap) {
          drawCursor(cursor);
          show(cursor);
        } else showRest();
      }),
    );
    showRest();

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'LM555 in bistable mode',
          { accent: 'yellow', chips: 'LM555 · 2× 1 kΩ pull-ups on TRIG and RESET · SPDT toggle switch · 0.01 µF on CV · THR to GND · DIS not connected' },
          sch.el,
          row(modeToggle.el, sev.el),
          row(replayBtn.el, h('span', { class: 'dim small' }, 'Click the switch in the drawing or use the toggle.')),
          status,
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Oscilloscope: 12 ms around the flip', { accent: 'gray', subtitle: 'single shot' }, scope.el, kv.el, note('The dashed cursor follows the slow replay. A contact touching pulls its pin low (0 on the scope).')),
          panel('555 as an SR latch', { accent: 'gray' }, tt.el, note('With THR (pin 6) on GND the threshold comparator can never fire, so only the trigger comparator (set) and RESET (pin 4) act on the flip-flop. Grounding pin 2 again while it is already set, or pin 4 while it is already reset, changes nothing. That is why the bounces disappear.'), note('Ben’s recap: astable has no stable state, monostable has one, bistable has two.')),
        ),
      ),
    );
    return d.dispose;
  },
});
