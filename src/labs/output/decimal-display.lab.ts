import { Circuit } from '../../logic/circuit';
import { bin, hex } from '../../sim/assembler';
import { DEC_DIGITS, MINUS, toSigned8 } from '../../sim/display';
import { Button, DipSwitch, Led, Slider, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, animate, h, s, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { busLine, ledCell, ledRow, liveText, makeTable, scopedStyle } from '../ram/_ui';
import { defineLab } from '../types';
import { DIGIT_NAMES, DISPLAY_555, DISPLAY_IMAGE, SLOW_DEMO_C, advanceMux, astable555, capForFreq, digitAddress, ls139, newMuxState, persist } from './_shared';

const CSS = `
.decdisp .digits { display: inline-flex; gap: 6px; background: #0b0b0d; padding: 10px 12px; border-radius: 8px; }
.decdisp .digit { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.decdisp .glow7 { display: block; }
.decdisp .glow7 .off { fill: #2a1414; }
.decdisp .glow7 .lit { fill: #ff3030; }
.decdisp .digit .led-caption { color: #8b95a8; }
.decdisp .examples .btn { font-family: var(--mono); }
`;

const SHAPES: [string, number, string][] = [
  ['a', 0x40, '14,4 50,4 44,10 20,10'],
  ['b', 0x20, '51,6 51,46 46,42 45,12'],
  ['c', 0x10, '51,54 51,94 45,88 46,58'],
  ['d', 0x08, '14,96 50,96 44,90 20,90'],
  ['e', 0x04, '13,54 13,94 19,88 18,58'],
  ['f', 0x02, '13,6 13,46 18,42 19,12'],
  ['g', 0x01, '16,50 22,45 42,45 48,50 42,55 22,55'],
];

/** A 7-segment digit whose segments can glow at any brightness (for persistence of vision). */
class GlowDigit {
  readonly el: SVGSVGElement;
  private lit: SVGPolygonElement[];
  private last = '';
  constructor(height = 84) {
    const off = SHAPES.map(([, , p]) => s('polygon', { points: p, class: 'off' }));
    this.lit = SHAPES.map(([, , p]) => s('polygon', { points: p, class: 'lit', 'fill-opacity': 0 }));
    this.el = s('svg', { viewBox: '0 0 64 100', width: (height * 64) / 100, height, class: 'glow7', role: 'img' }, off, this.lit);
  }
  /** Segment byte (dp a b c d e f g) shown at brightness 0..1. */
  set(byte: number, brightness: number) {
    const b = Math.round(Math.max(0, Math.min(1, brightness)) * 50) / 50;
    const key = `${byte}/${b}`;
    if (key === this.last) return;
    this.last = key;
    SHAPES.forEach(([, bit], i) => this.lit[i].setAttribute('fill-opacity', String(byte & bit ? b : 0)));
  }
}

const glyph = (seg: number) => (seg === 0 ? '(blank)' : seg === MINUS ? '−' : String(DEC_DIGITS.indexOf(seg as (typeof DEC_DIGITS)[number])));
const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toPrecision(3)} kHz` : `${f.toPrecision(f < 10 ? 2 : 3)} Hz`);
const fmtC = (c: number) => (c >= 1e-6 ? `${(c * 1e6).toPrecision(2)} µF` : c >= 1e-9 ? `${(c * 1e9).toPrecision(2)} nF` : `${(c * 1e12).toPrecision(2)} pF`);
const TAU_MS = 30;

export default defineLab({
  id: 'decimal-display',
  title: 'Multiplexed decimal display',
  summary:
    'The output register holds an 8-bit number and one 28C16 EEPROM turns it into decimal on four 7-segment displays. The four digits share the EEPROM’s 8 data lines, so only one digit is switched on at a time. A 555 clock drives a 74LS76 2-bit counter, which tells the EEPROM which digit to output (A8, A9) and, through a 74LS139 decoder, which display’s common cathode to pull low. A10 selects unsigned or two’s-complement mode. Slow the clock down to watch the digits take turns, then speed it up until persistence of vision makes all four appear lit at once.',
  mount(root) {
    const d = new Disposer();
    d.add(scopedStyle(root, CSS));
    root.classList.add('decdisp');

    const st = { value: 42, signed: false, hz: 3.59, paused: false };
    const mux = newMuxState();

    // ---- display ----
    const digits = [3, 2, 1, 0].map(() => new GlowDigit(84)); // left to right: sign, hundreds, tens, ones
    const enLeds = [3, 2, 1, 0].map((k) => new Led('yellow', `${DIGIT_NAMES[k]} enabled (Y̅${k} low)`));
    const digitCells = digits.map((g, i) => h('div', { class: 'digit' }, g.el, ledCell(enLeds[i], DIGIT_NAMES[3 - i])));
    const dispCallout = h('div', { class: 'callout' });
    const timingText = h('div', { class: 'mono small' });

    // ---- clock controls ----
    const speed = new Slider({ label: '555 clock', min: 0.5, max: 2000, value: st.hz, log: true, format: fmtHz, onInput: (v) => (st.hz = v) });
    const slowBtn = new Button({ label: '2 µF: Ben’s slow demo', onClick: () => { st.hz = astable555(DISPLAY_555.r1, DISPLAY_555.r2, SLOW_DEMO_C).freq; speed.set(st.hz); } });
    const fastBtn = new Button({ label: '10 nF: the real display', onClick: () => { st.hz = astable555(DISPLAY_555.r1, DISPLAY_555.r2, DISPLAY_555.c).freq; speed.set(st.hz); } });
    const pauseT = new Toggle({ label: 'Stop the 555', onChange: (v) => (st.paused = v) });
    const stepBtn = new Button({ label: 'One 555 cycle', title: 'One falling edge: the counter moves to the next digit', onClick: () => { st.paused = true; pauseT.set(true); mux.counter.clockFall(); mux.out = 1; mux.untilToggle = 0; } });

    // ---- value controls ----
    const dip = new DipSwitch({ bits: 8, value: st.value, label: 'OUT register', onChange: (v) => setValue(v) });
    const valSlider = new Slider({ label: 'value', min: 0, max: 255, step: 1, value: st.value, format: (v) => String(Math.round(v)), onInput: (v) => setValue(Math.round(v)) });
    const signedT = new Toggle({ label: 'Signed mode (A10 high)', value: st.signed, onChange: (v) => { st.signed = v; } });
    const ex = (label: string, v: number, signed?: boolean) => new Button({ label, onClick: () => { setValue(v); if (signed !== undefined) { st.signed = signed; signedT.set(signed); } } });
    const examples = [ex('42', 42), ex('−13 = 11110011', 0b11110011, true), ex('−62 = 11000010', 0b11000010, true), ex('127', 127, true), ex('−128', 128, true), ex('255', 255, false), ex('7 → " 007"', 7)];
    const valText = h('div', { class: 'mono' });
    const twos = h('div', { class: 'callout' });
    const setValue = (v: number) => {
      st.value = v & 0xff;
      if (dip.value !== st.value) dip.set(st.value);
      if (Math.round(valSlider.value) !== st.value) valSlider.set(st.value);
    };

    // ---- schematic ----
    const c = new Circuit();
    const n555 = c.input('555', 1);
    const nA8 = c.input('A8', 1);
    const nA9 = c.input('A9', 1);
    const nA10 = c.input('A10', 0);
    const nGnd = c.input('GND', 0);
    const nY = [0, 1, 2, 3].map((i) => c.input(`Y̅${i}`, 1));
    const sch = new Schematic(c, { width: 560, height: 330 });
    const t555 = sch.chip([16, 40], { label: '555', sublabel: 'astable', width: 82, height: 80, right: [{ name: 'OUT', net: n555 }] });
    sch.text('R65 1 kΩ, R66 100 kΩ', [57, 136], { size: 9, class: 'cap' });
    const tC = liveText(sch, [57, 150], { anchor: 'middle', class: 'cap', size: 9 });
    const ff = sch.chip([150, 30], { label: '74LS76', sublabel: 'J = K = 1', width: 110, height: 110, left: [{ name: '1CLK', net: n555, bubble: true }, { name: '2CLK', net: nA8, bubble: true }], right: [{ name: '1Q̅', net: nA8 }, { name: '2Q̅', net: nA9 }] });
    const dec = sch.chip([340, 30], { label: '74LS139', width: 90, height: 110, left: [{ name: 'A0', net: nA8 }, { name: 'A1', net: nA9 }], bottom: [{ name: 'E̅', net: nGnd, bubble: true }], right: nY.map((n, i) => ({ name: `Y̅${i}`, net: n, bubble: true })) });
    const rom = sch.chip([150, 190], { label: '28C16', sublabel: 'display EEPROM', width: 150, height: 110, left: [{ name: 'A0-A7' }, { name: 'A8', net: nA8 }, { name: 'A9', net: nA9 }, { name: 'A10', net: nA10 }], right: [{ name: 'D0-D7' }] });
    sch.route(n555, t555.right[0], ff.left[0], { midX: 124 });
    // FF A Q̅ -> FF B clock, 139 A0, EEPROM A8
    sch.wire(nA8, ff.right[0], dec.left[0]);
    sch.wire(nA8, [290, ff.right[0].y], [290, 152], [130, 152], [130, ff.left[1].y], ff.left[1]);
    sch.dot(nA8, [290, ff.right[0].y]);
    sch.wire(nA8, [130, 152], [130, rom.left[1].y], rom.left[1]);
    sch.dot(nA8, [130, 152]);
    // FF B Q̅ -> 139 A1, EEPROM A9
    sch.wire(nA9, ff.right[1], dec.left[1]);
    sch.wire(nA9, [310, ff.right[1].y], [310, 170], [118, 170], [118, rom.left[2].y], rom.left[2]);
    sch.dot(nA9, [310, ff.right[1].y]);
    sch.wire(nGnd, dec.bottom[0], [dec.bottom[0].x, dec.bottom[0].y + 8]);
    sch.text('GND', [dec.bottom[0].x, dec.bottom[0].y + 16], { size: 9, class: 'cap' });
    const yNames = ['ones', 'tens', 'hundreds', 'sign'];
    nY.forEach((n, i) => {
      sch.wire(n, dec.right[i], [470, dec.right[i].y]);
      sch.text(`→ ${yNames[i]}`, [474, dec.right[i].y], { anchor: 'start', size: 10 });
    });
    sch.text('common cathodes', [490, 22], { size: 9, class: 'cap' });
    sch.wire(nA10, [96, rom.left[3].y], rom.left[3]);
    sch.switch(nA10, [96, rom.left[3].y], { label: '±', onToggle: () => { st.signed = !st.signed; signedT.set(st.signed); } });
    busLine(sch, [[40, rom.left[0].y], [138, rom.left[0].y]]).classList.add('active');
    sch.text('74LS273', [40, rom.left[0].y - 12], { anchor: 'start', size: 9, class: 'cap' });
    busLine(sch, [[312, 245], [400, 245], [400, 312]]).classList.add('active');
    sch.text('segments a-g of', [408, 290], { anchor: 'start', size: 10 });
    sch.text('all four displays', [408, 304], { anchor: 'start', size: 10 });
    const tAddr = liveText(sch, [160, 316], { size: 11 });
    const tData = liveText(sch, [320, 236], { size: 11 });
    d.add(sch.autoUpdate());

    // ---- EEPROM address / data ----
    const aHi = ledRow(['A10'], 'red');
    const aSel = ledRow(['A9', 'A8'], 'yellow');
    const aVal = ledRow(['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0'], 'green');
    const addrText = h('span', { class: 'mono small' });
    const dataLeds = ledRow(['dp', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], 'red');
    const dataText = h('span', { class: 'mono small' });
    const table = makeTable(['digit', 'Y̅ low', 'A10 A9 A8', 'address', 'data', 'shows'], [3, 2, 1, 0].map((k) => [DIGIT_NAMES[k], `Y̅${k}`, '', '', '', '']), { class: 'compact' });

    const update = () => {
      const timing = astable555(DISPLAY_555.r1, DISPLAY_555.r2, capForFreq(st.hz));
      const sel = mux.counter.select;
      const y = ls139(sel);
      c.set(n555, mux.out);
      c.set(nA8, mux.counter.a8);
      c.set(nA9, mux.counter.a9);
      c.set(nA10, st.signed ? 1 : 0);
      nY.forEach((n, i) => c.set(n, y[i]));
      const addr = digitAddress(st.value, sel, st.signed);
      const data = DISPLAY_IMAGE[addr];
      tC(`C8 = ${fmtC(capForFreq(st.hz))}`);
      tAddr(`address ${bin(addr >> 8, 3)} ${bin(addr & 0xff, 8)} = 0x${hex(addr, 3)}`);
      tData(`0x${hex(data)}`);
      // display
      digits.forEach((g, i) => {
        const k = 3 - i;
        const seg = DISPLAY_IMAGE[digitAddress(st.value, k, st.signed)];
        g.set(seg, Math.min(1, mux.glow[k] * 4));
        enLeds[i].set(y[k] === 0);
      });
      // address/data panel
      aHi.setValue(st.signed ? 1 : 0);
      aSel.setValue(sel);
      aVal.setValue(st.value);
      setText(addrText, `= 0x${hex(addr, 3)} (${addr})`);
      dataLeds.setValue(data);
      setText(dataText, `0x${hex(data)} → ${glyph(data)}`);
      [3, 2, 1, 0].forEach((k, r) => {
        const a = digitAddress(st.value, k, st.signed);
        const cells = table.cells[r];
        setText(cells[2], `${st.signed ? 1 : 0} ${bin(k, 2).split('').join(' ')}`);
        setText(cells[3], `0x${hex(a, 3)} = ${a}`);
        setText(cells[4], `0x${hex(DISPLAY_IMAGE[a])}`);
        setText(cells[5], glyph(DISPLAY_IMAGE[a]));
      });
      table.highlight(3 - sel);
      // value readouts
      const sv = toSigned8(st.value);
      const shown = [3, 2, 1, 0].map((k) => DISPLAY_IMAGE[digitAddress(st.value, k, st.signed)]).map((x) => (x === 0 ? ' ' : x === MINUS ? '-' : glyph(x))).join('');
      setText(valText, `${bin(st.value, 8)} · unsigned ${st.value} · signed ${sv} · display shows “${shown}”`);
      setText(
        twos,
        st.signed && sv < 0
          ? `Two’s complement: ${-sv} = ${bin(-sv, 8)}; invert every bit → ${bin(~-sv & 0xff, 8)}; add 1 → ${bin(st.value, 8)}. So the pattern ${bin(st.value, 8)} means ${sv}. In signed mode (A10 = 1) the EEPROM’s fourth digit holds 0x01, which is segment g only: the minus sign.`
          : st.signed
            ? `Signed mode: the top bit is 0, so ${bin(st.value, 8)} is the positive number ${sv} and the sign digit stays blank. Patterns from 10000000 to 11111111 show −128 to −1.`
            : `Unsigned mode (A10 = 0): ${bin(st.value, 8)} reads as ${st.value}. The sign digit is always blank, and leading zeros are not blanked: ${st.value < 100 ? `it shows “${shown}”.` : 'every digit comes straight from the table.'}`,
      );
      // timing text
      setText(timingText, `555: f = 1.44 / ((R65 + 2·R66)·C8) = ${fmtHz(timing.freq)} · each digit lit ${timing.period >= 1 ? `${timing.period.toFixed(2)} s` : `${(timing.period * 1000).toPrecision(3)} ms`} · whole display refreshed ${fmtHz(timing.freq / 4)}`);
      const name = DIGIT_NAMES[sel];
      setText(
        dispCallout,
        st.paused
          ? `The 555 is stopped, so the counter stays at ${bin(sel, 2)}: Y̅${sel} is low and only the ${name} digit is lit, showing ${glyph(data)} from address 0x${hex(addr, 3)}. The other digits fade out.`
          : st.hz < 12
            ? `At ${fmtHz(st.hz)} you can follow it: each falling edge of the 555 advances the 74LS76 counter. Right now it is ${bin(sel, 2)}, so the EEPROM outputs the ${name} digit (A9 A8 = ${bin(sel, 2)}) and the 74LS139 pulls Y̅${sel} low to switch on just that display.`
            : st.hz < 120
              ? `At ${fmtHz(st.hz)} the digits take turns ${fmtHz(st.hz / 4)} times a second: too fast to follow one by one, but you can see it flicker.`
              : `At ${fmtHz(st.hz)} each digit is on for only ${((1000 / st.hz)).toPrecision(2)} ms at a time, a quarter of the time. That is far faster than your eye can follow, so all four digits look steadily lit. That is persistence of vision.`,
      );
    };

    d.add(
      animate((dt) => {
        const ms = Math.min(dt, 100);
        if (st.paused) {
          const sel = mux.counter.select;
          for (let i = 0; i < 4; i++) mux.glow[i] = persist(mux.glow[i], i === sel ? 1 : 0, ms, TAU_MS);
        } else {
          const timing = astable555(DISPLAY_555.r1, DISPLAY_555.r2, capForFreq(st.hz));
          advanceMux(mux, ms, timing, TAU_MS);
        }
        update();
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            'Four multiplexed digits',
            { accent: 'red', chips: '4 common-cathode 7-segment displays' },
            h('div', { class: 'digits', role: 'img', 'aria-label': 'Decimal display' }, digitCells),
            row(speed.el),
            row(slowBtn.el, fastBtn.el),
            row(pauseT.el, stepBtn.el),
            timingText,
            dispCallout,
          ),
          panel(
            'Value in the output register',
            { accent: 'green', chips: '74LS273 → EEPROM A0-A7' },
            row(dip.el),
            row(valSlider.el),
            signedT.el,
            h('div', { class: 'row examples' }, examples.map((b) => b.el)),
            valText,
            twos,
          ),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('The multiplexing circuit', { accent: 'yellow', chips: '555, 74LS76, 74LS139, 28C16' }, sch.el, note('The 74LS76 flip-flops toggle on falling edges. FF A is clocked by the 555, FF B by FF A’s Q̅, and taking the Q̅ outputs makes the pair count 0, 1, 2, 3. Wires: red = high, blue = low. A low Y̅ output enables its display.')),
          panel(
            'EEPROM address and data right now',
            { accent: 'blue' },
            row(h('span', { class: 'mo-label' }, 'address'), aHi.el, aSel.el, aVal.el, addrText),
            row(h('span', { class: 'mo-label' }, 'data'), dataLeds.el, dataText),
            table.el,
            note('Address = A10 (signed) · A9 A8 (digit) · A7-A0 (value). Ben’s Arduino sketch fills all 2048 bytes: ones digits from 0, tens from 256, hundreds from 512, sign from 768, then the same again for two’s complement starting at 1024.'),
          ),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
