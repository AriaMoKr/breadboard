import { Circuit } from '../../logic/circuit';
import { Button, LedBar, Scope, Toggle, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { Kit, draw555, drawSupport, kitCss } from './_draw';
import { type Bit, type Edge, Monostable555, V_HIGH_REF, V_LOW_REF, VCC, countClosures, fmtF, fmtSI, monostableWidth, pressBounce, releaseBounce } from './_shared';

const SCOPE = 'lab-555m';
const R = 1e6;
const H = 20e-6; // simulation step: 20 µs resolves the bounces
const N = 400; // samples in the rolling scope
const ZOOM_PRE = 1e-3;
const ZOOM_POST = 9e-3;

type CapChoice = 'final' | 'first';

export default defineLab({
  id: '555-monostable',
  title: 'Monostable 555 (single-step button)',
  summary:
    'A push button bounces: its contacts close, open and close again several times in a few milliseconds, so a counter clocked straight from it counts several times per press. Ben debounces the single-step button with a second 555 in monostable (one-shot) mode: the first contact closure triggers one clean output pulse 1.1·R·C long, and the bounces are ignored. Press the button and compare the raw switch with the 555 output.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: SCOPE });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, kitCss(SCOPE)));

    let capChoice: CapChoice = 'final';
    const capValue = () => (capChoice === 'final' ? 0.1e-6 : 2e-6);
    const m = new Monostable555(R, capValue());
    let releaseBounces = false;
    let slow = false;

    // contact state: absolute-time edge list
    let pending: Edge[] = [];
    let contact: Bit = 0;
    let held = false;
    let plainCount = 0, monoCount = 0;
    let lastPressT = -1, lastRiseT = -1, lastWidth = 0, lastBounceEdges = 0;
    let retriggered = false;

    // ---- diagram ----
    const dc = new Circuit();
    const sch = new Schematic(dc, { width: 600, height: 400 });
    const kit = new Kit(sch, dc);
    const ox = 152, oy = 62;
    const X = (x: number) => ox + x, Y = (y: number) => oy + y;
    const at = (x: number, y: number): [number, number] => [X(x), Y(y)];
    const chip = draw555(kit, ox, oy, { trigNet: 'p2' });
    const sup = drawSupport(kit, chip, ox, oy, { resetToVcc: true, led: 'green', outLabel: 'step' });
    const cx = -75;
    kit.vcc(X(cx), Y(-38));
    kit.wire('vcc', at(cx, -38), at(cx, -20));
    const rr = kit.resistor(X(cx), Y(-5), 'v');
    kit.text('R 1 MΩ', at(cx - 12, -5), { anchor: 'end', size: 11 });
    kit.ana('ana', at(cx, 10), at(cx, 30), chip.pin[7]);
    kit.anaDot('ana', at(cx, 30));
    kit.ana('ana', at(cx, 30), at(cx, 130), chip.pin[6]);
    kit.anaDot('ana', at(cx, 130));
    kit.ana('ana', at(cx, 130), at(cx, 156.5));
    kit.cap(X(cx), Y(160), 'v');
    const cLabel = kit.text('C 0.1 µF', at(cx - 16, 160), { anchor: 'end', size: 11 });
    kit.wire('gnd', at(cx, 163.5), at(cx, 176));
    kit.ground(X(cx), Y(176));
    const vcText = kit.text('Vc 0.00 V', at(cx + 7, 55), { anchor: 'start', size: 11, class: 'ana-text' });
    // trigger: 1 kΩ pull-up and the push button to GND
    kit.wire('p2', chip.pin[2], at(-45, 230));
    kit.dot('p2', at(-45, 230));
    kit.vcc(X(-45), Y(186));
    kit.wire('vcc', at(-45, 186), at(-45, 190));
    kit.resistor(X(-45), Y(205), 'v', '1 kΩ');
    kit.wire('p2', at(-45, 220), at(-45, 230), at(-45, 248));
    const btn = kit.pushButton(X(-45), Y(248), Y(276));
    kit.wire('gnd', at(-45, 276), at(-45, 288));
    kit.ground(X(-45), Y(288));
    kit.text('SW1', at(-74, 262), { anchor: 'end', size: 11 });
    btn.el.setAttribute('class', 'pushbutton clickable');
    btn.el.setAttribute('role', 'button');
    btn.el.setAttribute('tabindex', '0');
    btn.el.setAttribute('aria-label', 'Step button');
    sch.el.setAttribute('role', 'group'); // holds a control: not only a picture

    // ---- widgets ----
    const status = callout();
    const plainBar = new LedBar({ bits: 4, color: 'yellow', label: 'Counter on the plain switch', formats: ['dec'] });
    const monoBar = new LedBar({ bits: 4, color: 'green', label: 'Counter on the 555 output', formats: ['dec'] });
    const kv = readouts(['t = 1.1·R·C', 'last pulse (simulated)', 'bounces in last press']);
    const scope = new Scope(
      [
        { label: 'raw switch contact', color: '#fbbf24' },
        { label: 'pin 2 TRIG', kind: 'analog', min: 0, max: VCC, guides: [V_LOW_REF], color: '#60a5fa' },
        { label: 'Vc (pins 6+7)', kind: 'analog', min: 0, max: VCC, guides: [V_HIGH_REF], color: '#f59e0b' },
        { label: '555 OUT (pin 3)', color: '#4ade80' },
        { label: 'counter on the plain switch (0-15)', kind: 'analog', min: 0, max: 15, color: '#f472b6' },
      ],
      { width: 640, laneHeight: 46 },
    );
    const zoom = new Scope(
      [
        { label: 'raw switch contact', color: '#fbbf24' },
        { label: 'pin 2 TRIG', kind: 'analog', min: 0, max: VCC, guides: [V_LOW_REF], color: '#60a5fa' },
        { label: '555 OUT (pin 3)', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 46 },
    );
    const zoomInfo = h('span', { class: 'dim small' }, 'Press the button to capture the first 9 ms.');

    const press = () => {
      if (held) return;
      held = true;
      btnWidget.el.classList.add('pressed');
      pending = pressBounce(Math.random).map((e) => ({ t: m.t + e.t, v: e.v }));
      lastBounceEdges = countClosures(pending.map((e) => ({ t: e.t, v: e.v })), contact);
      lastPressT = m.t;
      retriggered = false;
      zoomBuf.start(m.t);
    };
    const release = () => {
      if (!held) return;
      held = false;
      btnWidget.el.classList.remove('pressed');
      const rel = releaseBounces ? releaseBounce(Math.random) : [{ t: 0, v: 0 as Bit }];
      pending = rel.map((e) => ({ t: m.t + e.t, v: e.v }));
    };
    const btnWidget = new Button({ label: 'Press the step button', kind: 'primary', onPress: press, onRelease: release });
    d.listen(btn.el, 'pointerdown', (e) => { e.preventDefault(); press(); });
    d.listen(btn.el, 'pointerup', release);
    d.listen(btn.el, 'pointerleave', release);
    d.listen(btn.el, 'keydown', (e) => (e as KeyboardEvent).key === ' ' && (e.preventDefault(), press()));
    d.listen(btn.el, 'keyup', (e) => (e as KeyboardEvent).key === ' ' && release());
    const capSelect = select<CapChoice>(
      [
        { value: 'final', label: 'C = 0.1 µF (final: 110 ms)' },
        { value: 'first', label: 'C = 2 µF (first try: 2.2 s)' },
      ],
      capChoice,
      (v) => { capChoice = v; apply(); },
      'Timing C',
    );
    const relToggle = new Toggle({ label: 'Contacts also bounce on release', onChange: (v) => (releaseBounces = v) });
    const slowToggle = new Toggle({ label: 'Slow motion (1/10 speed)', onChange: (v) => (slow = v) });
    const resetBtn = new Button({ label: 'Clear counters', onClick: () => { plainCount = monoCount = 0; } });

    // ---- scope buffers ----
    let windowS = 0.3;
    const roll = { contact: [] as Bit[], pin2: [] as number[], vc: [] as number[], out: [] as Bit[], cnt: [] as number[] };
    let acc = 0, sampleAcc = 0;
    let sawC0 = false, sawC1 = false, sawO0 = false, sawO1 = false;
    const clearRoll = () => { for (const a of Object.values(roll)) (a as unknown[]).length = 0; };
    const pushRoll = () => {
      const prevC = roll.contact[roll.contact.length - 1] ?? 0;
      const prevO = roll.out[roll.out.length - 1] ?? 0;
      // glitch-preserving sampling: show bounces shorter than one sample
      const c: Bit = sawC0 && sawC1 ? (prevC ? 0 : 1) : contact;
      const o: Bit = sawO0 && sawO1 ? (prevO ? 0 : 1) : m.q;
      roll.contact.push(c);
      roll.pin2.push(c ? 0 : VCC);
      roll.vc.push(m.vc);
      roll.out.push(o);
      roll.cnt.push(plainCount % 16);
      for (const a of Object.values(roll)) if ((a as unknown[]).length > N) (a as unknown[]).shift();
      sawC0 = sawC1 = sawO0 = sawO1 = false;
    };
    // zoom capture (single shot, triggered by the press)
    const pre: { c: Bit; q: Bit }[] = [];
    const zoomBuf = {
      active: false,
      t0: 0,
      c: [] as Bit[], p2: [] as number[], q: [] as Bit[],
      start(t: number) {
        this.active = true;
        this.t0 = t;
        this.c = pre.map((p) => p.c);
        this.p2 = pre.map((p) => (p.c ? 0 : VCC));
        this.q = pre.map((p) => p.q);
      },
      push() {
        if (!this.active) return;
        this.c.push(contact);
        this.p2.push(contact ? 0 : VCC);
        this.q.push(m.q);
        if (m.t - this.t0 >= ZOOM_POST) this.active = false;
      },
    };
    const ZN = Math.round((ZOOM_PRE + ZOOM_POST) / H);

    const apply = () => {
      m.c = capValue();
      const w = monostableWidth(R, m.c);
      windowS = Math.max(0.3, w * 2.6);
      clearRoll();
      setText(cLabel, `C ${fmtF(m.c)}`);
      kv.set('t = 1.1·R·C', `1.1 × 1 MΩ × ${fmtF(m.c)} = ${fmtSI(w, 's')}`);
    };
    apply();

    const simStep = () => {
      while (pending.length && pending[0].t <= m.t) {
        const e = pending.shift()!;
        if (e.v === 1 && contact === 0) plainCount++;
        contact = e.v;
      }
      const prevQ = m.q;
      m.step(H, contact ? 0 : VCC);
      if (m.q && !prevQ) {
        monoCount++;
        lastRiseT = m.t;
        if (!held && lastPressT >= 0 && m.t - lastPressT > 0.02) retriggered = true;
      }
      if (!m.q && prevQ && lastRiseT >= 0) lastWidth = m.t - lastRiseT;
      if (contact) sawC1 = true; else sawC0 = true;
      if (m.q) sawO1 = true; else sawO0 = true;
      pre.push({ c: contact, q: m.q });
      if (pre.length > ZOOM_PRE / H) pre.shift();
      zoomBuf.push();
    };

    const update = () => {
      const w = monostableWidth(R, m.c);
      // While the button is held past the pulse both comparators fire; the
      // trigger wins (datasheet function table), so the output stays high.
      chip.update({ trig: contact === 1, thr: m.vc > V_HIGH_REF, armed: m.q ? 'thr' : 'trig', resetHigh: true, q: m.q });
      kit.level('p2', contact ? 0 : 1);
      btn.set(contact === 1);
      sup.led.set(m.q === 1);
      rr.el.classList.toggle('hot', m.q === 1);
      setText(vcText, `Vc ${m.vc.toFixed(2)} V`);
      plainBar.set(plainCount % 16);
      monoBar.set(monoCount % 16);
      kv.set('last pulse (simulated)', lastWidth ? fmtSI(lastWidth, 's') : '—');
      kv.set('bounces in last press', lastPressT >= 0 ? `${lastBounceEdges} contact closures` : '—');
      let msg: string;
      if (retriggered) msg = 'The release bounced and re-triggered the 555: you held the button longer than the pulse, so the flip-flop had already reset, and a bounce on release pulled pin 2 low again. Real tact switches can do this; keep presses short or switch off release bounce.';
      else if (m.q && held && m.vc >= V_HIGH_REF - 0.01) msg = `You are still holding the button after ${fmtSI(w, 's')}. Pin 2 is still below 1/3 Vcc, and in the 555 the trigger comparator wins over the threshold comparator (datasheet function table), so the output stays high until you let go. Still only one pulse.`;
      else if (m.q && contact) msg = `Pressed: pin 2 fell below 1/3 Vcc (1.67 V), so the trigger comparator set the flip-flop. The output went high and the discharge transistor let go of C, which now charges through 1 MΩ: Vc = ${m.vc.toFixed(2)} V. The bouncing contact closed ${lastBounceEdges} times, but setting a flip-flop that is already set changes nothing.`;
      else if (m.q) msg = `Timing: Vc = ${m.vc.toFixed(2)} V, heading for 3.33 V (2/3 Vcc). The output stays high for 1.1·R·C = ${fmtSI(w, 's')} no matter what the switch does in the meantime.`;
      else if (lastPressT >= 0) msg = `Done: one clean pulse of ${fmtSI(lastWidth || w, 's')}. When Vc reached 2/3 Vcc the threshold comparator reset the flip-flop and the discharge transistor emptied C. The plain switch closed ${lastBounceEdges} times, so a counter wired straight to it would have counted ${lastBounceEdges}. The counter on the 555 output counted 1.`;
      else msg = 'Waiting. The 1 kΩ pull-up holds pin 2 at 5 V, the output is low and the discharge transistor keeps C empty. Press the button.';
      setText(status, msg);
    };

    d.add(
      animate((dt) => {
        const simDt = (Math.min(dt, 50) / 1000) * (slow ? 0.1 : 1);
        acc += simDt;
        const sampleDt = windowS / N;
        while (acc >= H) {
          acc -= H;
          simStep();
          sampleAcc += H;
          if (sampleAcc >= sampleDt) {
            sampleAcc -= sampleDt;
            pushRoll();
          }
        }
        scope.draw([roll.contact, roll.pin2, roll.vc, roll.out, roll.cnt], { window: N });
        if (zoomBuf.c.length) {
          zoom.draw([zoomBuf.c, zoomBuf.p2, zoomBuf.q], { window: ZN });
          if (!zoomBuf.active) setText(zoomInfo, `Captured: the contact closed ${lastBounceEdges} times in the first few ms of the press, but the output has one clean rising edge.`);
        }
        update();
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'LM555 in monostable mode',
          { accent: 'green', chips: 'LM555 · 1 kΩ pull-up on TRIG · R 1 MΩ · C 2 µF, then 0.1 µF · 0.01 µF on CV · tact switch' },
          sch.el,
          row(btnWidget.el, capSelect),
          row(relToggle.el, slowToggle.el),
          status,
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Oscilloscope', { accent: 'gray', subtitle: 'rolling' }, scope.el, note('The dashed line on pin 2 is 1/3 Vcc (the trigger level), the one on Vc is 2/3 Vcc (the threshold).')),
          panel('Zoom: the first 9 ms of the press', { accent: 'gray', subtitle: 'single shot' }, zoom.el, zoomInfo),
          panel('What a counter would see', { accent: 'gray' }, plainBar.el, monoBar.el, row(resetBtn.el), kv.el),
          panel(
            'Why one pulse',
            { accent: 'gray' },
            note('The trigger comparator fires when pin 2 drops below 1/3 Vcc and sets the flip-flop. Every later bounce just tries to set it again, which does nothing. Only the threshold comparator ends the pulse, when C reaches 2/3 Vcc after 1.1·R·C: 2.2 s with Ben’s first 2 µF, 110 ms with the final 0.1 µF.'),
            note('The 555 responds to the level on pin 2, not to an edge. If you hold the button longer than the pulse, the trigger keeps the output high until you let go. You still get only one pulse per press.'),
          ),
        ),
      ),
    );
    return d.dispose;
  },
});
