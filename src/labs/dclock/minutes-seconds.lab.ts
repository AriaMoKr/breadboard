import { CHIP_MODELS, instantiateChip } from '../../breadboard/sim/chips';
import { not, type Level, type Net } from '../../logic/circuit';
import { Button, DipSwitch, LedBar, SevenSegment, Toggle, note, panel, readouts, row, select } from '../../ui/components';
import { Disposer, animate, h, setText } from '../../ui/dom';
import { callout, injectStyle, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { SquareSource, clockCircuit, decoder, segByte, sixty, timebase, value } from './_circuits';

type Tap = '1' | '3' | '6' | '60';

/** The CD4511's truth table (datasheet), a..g for inputs 0-15. */
export const CD4511_TABLE = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '0011111', '1110000', '1111111', '1110011', ...Array<string>(6).fill('0000000')];

const CSS = `
.dclock-time { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dclock-time .colon { display: grid; gap: 16px; margin: 0 2px; }
.dclock-time .colon i { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 6px #ef4444; }
.dclock-digit { display: grid; justify-items: center; gap: 4px; }
`;

export default defineLab({
  id: 'minutes-seconds',
  title: 'Building the minutes and seconds',
  summary:
    'With one pulse a second, the rest of the clock is more counting. A 74LS90 counts the units of the seconds 0 to 9 and wraps, and a 74LS92 used as a ÷6 counts the tens 0 to 5. The tens are clocked by the units’ top bit Q3, and because the counters count on falling edges, the tens step as the units go from 9 back to 0, not from 7 to 8. A CD4511 decodes each digit for a common-cathode display. The minutes are the same circuit, clocked by the tens of seconds as they go from 5 back to 0. Ben’s ZERO button resets the seconds (and the divider, so the first second is a whole one).',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'dclock-lab' });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, CSS));

    // ---- the clock -------------------------------------------------------------------
    const cc = clockCircuit();
    const { c, gnd, vcc } = cc;
    const hz = c.input('60HZ', 1);
    const zero = c.input('ZERO', 0);
    const tb = timebase(c, 60, hz, zero, gnd);
    const taps: Record<Tap, Net> = { '1': tb.out, '3': tb.fast, '6': tb.taps[2][1], '60': hz };
    // Ben's troubleshooting jumper: which signal feeds the seconds
    let tap: Tap = '1';
    const poke = c.input('POKE', 0);
    const secIn = c.net('SECIN', 'Z');
    const order: Tap[] = ['1', '3', '6', '60'];
    c.add({ kind: 'JUMPER', inputs: [...order.map((k) => taps[k]), poke], outputs: [secIn], delay: 1, evaluate: (l) => [l[order.indexOf(tap)]] });
    // the "what if" inverter between the units' Q3 and the tens' clock
    let rising = false;
    const sec = sixty(c, 'S', secIn, zero, gnd, (q3) => {
      const out = c.net('S.TCLK', 'Z');
      c.add({ kind: 'EDGE?', inputs: [q3, poke], outputs: [out], delay: 1, evaluate: (l) => [rising ? not(l[0]) : l[0]] });
      return out;
    });
    const min = sixty(c, 'M', sec.carry, gnd, gnd);
    const segs = [decoder(c, 'D1', min.tens.slice(0, 3), gnd, vcc), decoder(c, 'D2', min.units, gnd, vcc), decoder(c, 'D3', sec.tens.slice(0, 3), gnd, vcc), decoder(c, 'D4', sec.units, gnd, vcc)];
    const src = new SquareSource(c, hz, 60);
    const pokeIt = () => {
      c.set(poke, poke.value === 1 ? 0 : 1);
      c.settle(10000);
    };

    const digits = segs.map(() => new SevenSegment({ height: 72 }));
    const bars = [
      new LedBar({ bits: 3, color: 'yellow', label: 'Q2-Q0' }),
      new LedBar({ bits: 4, color: 'yellow', label: 'Q3-Q0' }),
      new LedBar({ bits: 3, color: 'yellow', label: 'Q2-Q0' }),
      new LedBar({ bits: 4, color: 'yellow', label: 'Q3-Q0' }),
    ];
    const counts = [min.tens.slice(0, 3), min.units, sec.tens.slice(0, 3), sec.units];
    const digitEl = (i: number) => h('div', { class: 'dclock-digit' }, digits[i].el, bars[i].el);
    const colon = () => h('span', { class: 'colon', 'aria-hidden': 'true' }, h('i'), h('i'));
    const time = h('div', { class: 'dclock-time', role: 'img', 'aria-label': 'minutes and seconds' }, digitEl(0), digitEl(1), colon(), digitEl(2), digitEl(3));
    const kv = readouts(['seconds input', 'counted']);
    const status = callout();

    const tapSelect = select<Tap>(
      [
        { value: '1', label: '1 Hz (normal: 74LS92 pin 9)' },
        { value: '3', label: '3 Hz (74LS92 pin 12)' },
        { value: '6', label: '6 Hz (74LS90 pin 11)' },
        { value: '60', label: '60 Hz (straight from the comparator)' },
      ],
      tap,
      (v) => {
        tap = v;
        pokeIt();
      },
      'Seconds input (Ben’s test jumper)',
    );
    const zeroBtn = new Button({
      label: 'ZERO',
      title: 'Hold to reset the seconds (and the divider); they start when you let go',
      onPress: () => {
        c.set(zero, 1);
        c.settle(10000);
      },
      onRelease: () => {
        c.set(zero, 0);
        c.settle(10000);
      },
    });
    const risingToggle = new Toggle({
      label: 'What if the tens counted on Q3’s rising edge? (an inverter in between)',
      value: false,
      onChange: (v) => {
        rising = v;
        pokeIt();
        c.set(zero, 1);
        c.settle(10000);
        c.set(zero, 0);
        c.settle(10000);
      },
    });

    // ---- the CD4511 on its own --------------------------------------------------------------
    const dc = clockCircuit();
    const bcd = [0, 1, 2, 3].map((k) => dc.c.input(`IN${'ABCD'[k]}`, 0));
    const lt = dc.c.input('~LT', 1), bi = dc.c.input('~BI', 1), le = dc.c.input('LE', 0);
    const seg1 = [0, 1, 2, 3, 4, 5, 6].map((k) => dc.c.net('abcdefg'[k], 'Z'));
    instantiateChip(dc.c, CHIP_MODELS.CD4511, { A: bcd[0], B: bcd[1], C: bcd[2], D: bcd[3], '~LT': lt, '~BI': bi, LE: le, a: seg1[0], b: seg1[1], c: seg1[2], d: seg1[3], e: seg1[4], f: seg1[5], g: seg1[6] }, {}, 'U');
    dc.c.settle(1000);
    const one = new SevenSegment({ height: 96 });
    const segBar = new LedBar({ bits: 7, color: 'red', label: 'a b c d e f g' });
    const table = truthTable(['D C B A', 'a b c d e f g', 'shows'], CD4511_TABLE.map((s, v) => [v.toString(2).padStart(4, '0'), s.split('').join(' '), v < 10 ? String(v) : 'blank']));
    const decText = callout();
    const setIn = (v: number, l: Level = lt.value, b: Level = bi.value, e: Level = le.value) => {
      bcd.forEach((n, k) => dc.c.set(n, ((v >> k) & 1) as Level));
      dc.c.set(lt, l);
      dc.c.set(bi, b);
      dc.c.set(le, e);
      dc.c.settle(1000);
    };
    let dipVal = 0;
    const dip = new DipSwitch({ bits: 4, value: 0, label: 'D C B A', onChange: (v) => { dipVal = v; setIn(v); } });
    const ltT = new Toggle({ label: '~LT high (lamp test off)', value: true, onChange: (v) => setIn(dipVal, v ? 1 : 0) });
    const biT = new Toggle({ label: '~BI high (not blanked)', value: true, onChange: (v) => setIn(dipVal, undefined, v ? 1 : 0) });
    const leT = new Toggle({ label: 'LE low (follow the input)', value: true, onChange: (v) => setIn(dipVal, undefined, undefined, v ? 0 : 1) });

    d.add(
      animate((dt) => {
        src.advance(Math.min(dt, 100) / 1000);
        segs.forEach((s, i) => digits[i].set(segByte(s)));
        counts.forEach((q, i) => bars[i].set(Math.max(0, value(q))));
        const mm = 10 * value(min.tens.slice(0, 3)) + value(min.units), ss = 10 * value(sec.tens.slice(0, 3)) + value(sec.units);
        kv.set('seconds input', tap === '1' ? 'once a second' : `${tap} times a second (testing)`);
        kv.set('counted', `${mm} min ${ss} s`);
        let msg: string;
        if (zero.value === 1) msg = 'ZERO is held: the seconds counters (and the divider timing each second) are held at 0. Let go and the first second is a whole second.';
        else if (rising) msg = `With an inverter, the tens would count when Q3 rises, which happens as the units go from 7 to 8 (0111 to 1000): watch the tens step at 8, not at 10. The 74LS92’s clock inputs count on the falling edge (the bubble on the datasheet’s clock pins), so wired straight, Q3 falling at 9 → 0 is the carry.`;
        else if (tap !== '1') msg = `Testing like Ben: the seconds counter is fed ${tap} Hz instead of 1 Hz, so the minutes come round much sooner and you can check that 59 rolls over to 00 and carries into the minutes.`;
        else msg = 'Real time. The units count 0-9 and wrap; the tens count 0-5 on Q0-Q2 of the 74LS92 (its Q3 isn’t used, and the decoder’s D input is grounded). When the seconds go from 59 to 00, the tens’ Q2 falls, and that clocks the minutes.';
        setText(status, msg);
        // the decoder panel
        one.set(segByte(seg1));
        segBar.set(segByte(seg1));
        const shown = value(bcd);
        table.set(lt.value === 0 || bi.value === 0 || le.value === 1 ? -1 : shown);
        setText(decText, lt.value === 0 ? 'Lamp test (~LT low) lights all seven segments, whatever the input.' : bi.value === 0 ? 'Blanking (~BI low) turns every segment off.' : le.value === 1 ? 'LE high latches: the display holds the code it had when LE went high. Change the switches: nothing happens until LE goes low again.' : shown > 9 ? `${shown} isn’t a decimal digit: the CD4511 shows nothing for 10-15.` : `${shown}: segments ${CD4511_TABLE[shown].split('').map((b, i) => (b === '1' ? 'abcdefg'[i] : '')).join(' ')}.${shown === 6 || shown === 9 ? ' The CD4511’s 6 and 9 have no tails.' : ''}`);
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'Minutes and seconds',
          { accent: 'red', chips: 'seconds and minutes: 74LS90 (units) + 74LS92 (tens) each · CD4511 ×4 · common-cathode displays, one 220 Ω each · colon LEDs with 4.7 kΩ · 60 Hz divider from part 3' },
          time,
          row(tapSelect, zeroBtn.el),
          row(risingToggle.el),
          kv.el,
          status,
          note('Wiring each digit: the counter’s Q0-Q3 (pins 12, 9, 8, 11 on the 74LS90) go to the CD4511’s A-D (pins 7, 1, 2, 6). Its ~LT (pin 3) and ~BI (pin 4) are tied high and LE (pin 5) low, and the outputs on the top row (pins 9-15) go to segments e, d, c, b, a, g, f. The display’s common cathode goes to ground through a single 220 Ω resistor. Ben adds all six displays and the colon LEDs (always on, 4.7 kΩ each) before wiring, so he knows where everything has to fit.'),
          note('With all the displays lit, the 7805 gets hot, over 45 °C even with the big heat sink Ben adds, so don’t leave it out.'),
        ),
        panel(
          'The CD4511 decoder',
          { accent: 'blue', chips: 'CD4511 BCD to 7-segment latch/decoder/driver' },
          row(dip.el, one.el, segBar.el),
          row(ltT.el, biT.el, leT.el),
          decText,
          table.el,
        ),
      ),
    );
    return d.dispose;
  },
});
