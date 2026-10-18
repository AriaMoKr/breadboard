import { CHIP_MODELS, instantiateChip } from '../../breadboard/sim/chips';
import type { Level } from '../../logic/circuit';
import { Button, Scope, SevenSegment, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { callout, injectStyle } from '../latches/_shared';
import { defineLab } from '../types';
import { BouncyButton, Debounce } from './_analog';
import { clockCircuit, decoder, segByte, sixty, timebase, value } from './_circuits';

type Contact = 'new' | 'old' | 'wire';
type Path = 'debounce' | 'direct';
const BOUNCE: Record<Contact, [number, number]> = { new: [0, 1], old: [6, 10], wire: [14, 25] };

const DT = 50e-6; // analog step: the bounce lasts milliseconds
const SCOPE_MS = 40;

const CSS = `
.dclock-time { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dclock-time .colon { display: grid; gap: 16px; margin: 0 2px; }
.dclock-time .colon i { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 6px #ef4444; }
`;

export default defineLab({
  id: 'setting-time',
  title: 'Setting the time',
  summary:
    'Zeroing the seconds is enough for them, but the minutes have to be set to a value. Ben runs them faster instead: an XOR gate passes the once-a-minute signal straight through while its other input is low, and a button feeds the 3 Hz signal from the divider into that other input, so holding the button counts the minutes three times a second. Then an old button shows the catch: its contacts bounce for about 10 ms, and each bounce can count an extra minute. A 47 kΩ × 0.1 µF RC filter (4.7 ms) and a comparator with hysteresis turn the bouncing into one clean transition.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'dclock-lab' });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, CSS));

    // ---- the clock: divider, seconds, the XOR, minutes -----------------------------------
    const { c, gnd, vcc } = clockCircuit();
    const hz = c.input('60HZ', 1);
    const tb = timebase(c, 60, hz, gnd, gnd);
    const sec = sixty(c, 'S', tb.out, gnd, gnd);
    const setIn = c.input('SET', 0); // the XOR's other input (pin 5)
    const minClk = c.net('MINCLK', 'Z');
    instantiateChip(c, CHIP_MODELS['74LS86'], { '2A': sec.carry, '2B': setIn, '2Y': minClk, '1A': gnd, '1B': gnd, '3A': gnd, '3B': gnd, '4A': gnd, '4B': gnd }, {}, 'U9');
    const min = sixty(c, 'M', minClk, gnd, gnd);
    const segs = [decoder(c, 'D1', min.tens.slice(0, 3), gnd, vcc), decoder(c, 'D2', min.units, gnd, vcc), decoder(c, 'D3', sec.tens.slice(0, 3), gnd, vcc), decoder(c, 'D4', sec.units, gnd, vcc)];
    c.settle(10000);

    let contact: Contact = 'old', path: Path = 'direct';
    const button = new BouncyButton(...BOUNCE[contact], 3);
    const deb = new Debounce();
    let t = 0, nextToggle = 0, hzLevel: Level = 1;
    // what the minutes did around the last press
    let heldFrom = -1, minutesAtPress = 0, minutesAtRelease = 0, releasedAt = -1, jump = 0;
    const minutes = () => 10 * value(min.tens.slice(0, 3)) + value(min.units);

    // scope: the 40 ms after the last press or release
    const rec = { contact: [] as Level[], node: [] as number[], rc: [] as number[], ref: [] as number[], out: [] as Level[] };
    let recording = -1;
    const scope = new Scope(
      [
        { label: 'button contacts (high = touching)', color: '#fbbf24' },
        { label: 'button’s far side (V)', kind: 'analog', min: 0, max: 5.5, color: '#a78bfa' },
        { label: 'RC: comparator − (pin 4), reference + (dashed)', kind: 'analog', min: 0, max: 5.5, color: '#f59e0b', overlayColor: '#60a5fa' },
        { label: 'XOR input (pin 5)', color: '#4ade80' },
      ],
      { width: 640, laneHeight: 46 },
    );

    const stepAll = (seconds: number) => {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) {
        t += DT;
        while (t >= nextToggle) {
          hzLevel = hzLevel ? 0 : 1;
          c.set(hz, hzLevel);
          c.settle(10000);
          nextToggle += 1 / 120;
        }
        const closed = button.step(DT);
        const fast = tb.fast.value === 1 ? 1 : 0;
        let want: Level;
        if (path === 'debounce') want = deb.step(closed, fast, DT);
        else {
          want = closed ? fast : 0; // the button straight into the XOR, 220 Ω to ground
          deb.step(closed, fast, DT); // (kept running, so switching paths doesn't jump)
        }
        if (want !== setIn.value) {
          c.set(setIn, want);
          c.settle(10000);
        }
        if (recording >= 0) {
          rec.contact.push(closed ? 1 : 0);
          rec.node.push(path === 'debounce' ? deb.node : closed ? fast * 5 : 0);
          rec.rc.push(deb.rc);
          rec.ref.push(deb.comp.ref);
          rec.out.push(setIn.value);
          if (++recording >= (SCOPE_MS / 1000) / DT) recording = -1;
        }
        if (releasedAt >= 0 && t - releasedAt > 0.05) {
          jump = minutes() - minutesAtRelease;
          releasedAt = -1;
        }
      }
    };
    const startScope = () => {
      for (const a of Object.values(rec)) a.length = 0;
      recording = 0;
    };

    const digits = segs.map(() => new SevenSegment({ height: 72 }));
    const colon = () => h('span', { class: 'colon', 'aria-hidden': 'true' }, h('i'), h('i'));
    const time = h('div', { class: 'dclock-time', role: 'img', 'aria-label': 'minutes and seconds' }, digits[0].el, digits[1].el, colon(), digits[2].el, digits[3].el);
    const kv = readouts(['while you held SET', 'after you let go']);
    const status = callout();

    const setBtn = new Button({
      label: 'Hold to SET MIN',
      kind: 'primary',
      onPress: () => {
        button.set(true);
        heldFrom = t;
        minutesAtPress = minutes();
        startScope();
      },
      onRelease: () => {
        button.set(false);
        minutesAtRelease = minutes();
        releasedAt = t;
        heldFrom = -1;
        startScope();
      },
    });
    const contactSel = select<Contact>(
      [
        { value: 'old', label: 'An old, bouncy button' },
        { value: 'new', label: 'A brand new button' },
        { value: 'wire', label: 'A bare wire (bounces a lot)' },
      ],
      contact,
      (v) => {
        contact = v;
        [button.bounces, button.ms] = BOUNCE[v];
      },
      'Button',
    );
    const pathSel = select<Path>(
      [
        { value: 'direct', label: 'Straight to the XOR (first try)' },
        { value: 'debounce', label: 'Through the RC + comparator debounce' },
      ],
      path,
      (v) => (path = v),
      'Wiring',
    );

    d.add(
      animate((dt) => {
        stepAll(Math.min(dt, 100) / 1000);
        segs.forEach((s, i) => digits[i].set(segByte(s)));
        scope.draw([rec.contact, rec.node, rec.rc, rec.out], { window: Math.round(SCOPE_MS / 1000 / DT), overlays: [undefined, undefined, rec.ref] });
        kv.set('while you held SET', heldFrom >= 0 ? `${minutes() - minutesAtPress} minutes so far` : '–');
        // a clean release can count once (letting go while the 3 Hz is high is one more edge); more is bounce
        kv.set('after you let go', releasedAt >= 0 ? 'watching…' : jump >= 2 ? `the minutes jumped ${jump} more` : jump === 1 ? 'one more step, as a clean release can give' : 'no jump');
        let msg: string;
        if (button.pressed) msg = `SET is held: the 3 Hz signal reaches the XOR’s second input, so the minutes count three times a second. When the seconds’ once-a-minute signal is high the XOR inverts the 3 Hz, but it still counts at 3 Hz.`;
        else if (jump >= 2 && path === 'direct') msg = `The minutes jumped ${jump} when you let go: the contacts bounced, and whenever the 3 Hz signal happened to be high, each bounce was one more falling edge for the minutes counter. (Not every time: only if the 3 Hz is high while it bounces.) Try the debounce wiring.`;
        else if (path === 'debounce') msg = 'With the debounce: the button’s far side is pulled up through 47 kΩ, and the 47 kΩ × 0.1 µF filter smooths the bounces into one slow change (4.7 ms time constant). The comparator, with its 100 kΩ hysteresis, switches once when the RC voltage crosses its reference. It also inverts, so with the button up it holds the XOR input low, like the 220 Ω resistor did. A few milliseconds of delay are part of debouncing, and you can’t notice them.';
        else msg = 'Hold SET to run the minutes; let go at the minute you want. With the old button, look at the scope after you let go: the contacts open and close several times in about 10 ms.';
        setText(status, msg);
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'Setting the minutes',
          { accent: 'red', chips: '74LS86 XOR (seconds’ once-a-minute signal ⊕ SET → minutes clock) · push button from the 3 Hz signal · second LM339: 47 kΩ + 0.1 µF RC, 47 kΩ / 47 kΩ reference, 100 kΩ hysteresis, 4.7 kΩ pull-up' },
          time,
          row(setBtn.el, contactSel, pathSel),
          kv.el,
          status,
        ),
        panel(
          'Switch bounce on the scope',
          { accent: 'gray', subtitle: `the ${SCOPE_MS} ms after each press and release` },
          scope.el,
          note('Ben tests the debounce with a bare wire instead of the button, which bounces far worse, and the minutes still don’t jump. He builds a second debounce circuit on the LM339’s other comparator (pins 6, 7 and 1) for setting the hours later, and ties the unused comparators’ inputs to ground.'),
          note('XOR: the output is high when exactly one input is high. With one input low it passes the other through unchanged; with it high it inverts it. Ben also puts 0.1 µF decoupling capacitors across the power rails: a chip switching draws a burst of current, and the capacitor supplies it before the supply sags. A rare glitch: if the seconds roll over while you are setting the minutes, it may count one extra minute. Ben doesn’t mind.'),
        ),
      ),
    );
    return d.dispose;
  },
});
