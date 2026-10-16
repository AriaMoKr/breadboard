import { Button, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, h, s, setClass, setText } from '../../ui/dom';
import { defineLab } from '../types';
import { BitRow, labFrame } from '../registers/_shared';
import { ENCODINGS, addBinary, bitOf, decode, encode, encodingRange, mask, negateTwos, signedAddDemo, toBin, toBinSpaced, twosWeights, type Encoding } from './_model';

/**
 * Video 14 — "Twos complement: Negative numbers in binary".
 * One bit pattern read four ways, negation by invert + 1, the number wheel,
 * and adding signed numbers with an ordinary adder (carry out ignored).
 */

const CSS = `
.tc-wheel { width: 100%; max-width: 320px; height: auto; display: block; margin: 0 auto; }
.tc-wheel .tick { stroke: var(--fg-faint); stroke-width: 1.5; }
.tc-wheel .tick.major { stroke: var(--fg-dim); stroke-width: 2; }
.tc-wheel .ring { fill: none; stroke: var(--grid); stroke-width: 10; }
.tc-wheel .lab-out { fill: var(--fg-dim); font: 10px var(--mono); }
.tc-wheel .lab-in { fill: var(--fg); font: 600 12px var(--mono); }
.tc-wheel .lab-in.neg { fill: var(--danger); }
.tc-wheel .bound { stroke-width: 2.5; stroke-dasharray: 4 3; }
.tc-wheel .bound.ovf { stroke: var(--danger); }
.tc-wheel .bound.cry { stroke: var(--accent-2); }
.tc-wheel .btext { font: 600 10px var(--sans); }
.tc-wheel .btext.ovf { fill: var(--danger); }
.tc-wheel .btext.cry { fill: var(--accent-2); }
.tc-wheel .ptr { stroke: var(--accent); stroke-width: 3; stroke-linecap: round; }
.tc-wheel .ptr-dot { fill: var(--accent); }
.tc-wheel .arc { fill: none; stroke: var(--ok); stroke-width: 5; stroke-linecap: round; opacity: 0.85; }
.tc-wheel .arc-dot { fill: var(--ok); }
.tc-wheel .center-big { fill: var(--fg); font: 700 26px var(--mono); }
.tc-wheel .center-small { fill: var(--fg-dim); font: 11px var(--mono); }
.tc-line { width: 100%; max-width: 360px; height: auto; display: block; }
.tc-line .axis { stroke: var(--fg-faint); stroke-width: 2; }
.tc-line .lbl { fill: var(--fg-dim); font: 10px var(--mono); }
.tc-line .mk { fill: var(--accent); }
.tc-line .link { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 3 3; }
.tc-big { font: 700 1.3rem var(--mono); }
.tc-steps { font-family: var(--mono); border-collapse: collapse; font-size: 0.95rem; }
.tc-steps td { padding: 2px 8px; white-space: nowrap; }
.tc-steps tr.active td { background: color-mix(in srgb, var(--accent-2) 18%, transparent); }
.tc-steps td.op { color: var(--fg-dim); text-align: right; }
.tc-num { width: 6.5em; }
.tc-interp td:first-child, .tc-interp th:first-child { text-align: left; }
.tc-interp td.v { font-weight: 700; }
`;

const fmtW = (w: number) => (w < 0 ? `−${-w}` : String(w));
const sgn = (v: number) => (v < 0 ? `−${-v}` : `${v}`);
const sgnP = (v: number) => (v < 0 ? `(−${-v})` : `(+${v})`);

export default defineLab({
  id: 'twos-complement',
  title: "Two's complement",
  summary:
    "How do you store a negative number in a register that only holds 1s and 0s? Ben compares three schemes. A sign bit is the obvious one, but it has two zeros and normal binary addition gives wrong answers. Ones’ complement is closer but still off by one. Two’s complement simply gives the top bit a negative place value (−8 for 4 bits, −128 for 8): there is one zero, negating is “invert and add 1”, and the plain adder in the ALU gets every answer right as long as you ignore the carry out.",
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d, CSS);

    let n: 4 | 8 = 8;
    let bits = 0b11111011; // −5
    let anim: { phase: 'invert' | 'add' | 'done'; bit: number; t: number; carry: boolean; orig: number; inv: number; res: number } | null = null;

    // ---- bit row ----
    const rows = {
      4: new BitRow({ bits: 4, value: bits & 15, weights: twosWeights(4).map(fmtW), onChange: (v) => setBits(v) }),
      8: new BitRow({ bits: 8, value: bits, weights: twosWeights(8).map(fmtW), onChange: (v) => setBits(v) }),
    };
    const bitHost = h('div');
    const sumLine = h('div', { class: 'dp-eq' });
    const bigVal = h('span', { class: 'tc-big' });
    const numIn = h('input', { type: 'number', class: 'tc-num', 'aria-label': 'Type a number' });
    numIn.addEventListener('change', () => {
      const v = Math.round(Number(numIn.value));
      if (!Number.isFinite(v)) return;
      const b = v < 0 ? encode(v, 'twos', n) : v <= mask(n) ? v : null;
      if (b !== null) setBits(b);
      else render();
    });
    const widthSel = select<'4' | '8'>([{ value: '8', label: '8 bits' }, { value: '4', label: '4 bits (Ben’s examples)' }], '8', (v) => setWidth(v === '4' ? 4 : 8), 'Width');
    const negBtn = new Button({ label: 'Negate: invert, then add 1', kind: 'primary', onClick: () => startNegate() });
    const presetRow = h('div', { class: 'row' });
    const presets = () => {
      const lo = -(1 << (n - 1)), hi = (1 << (n - 1)) - 1;
      const list = [5, -5, 0, -1, hi, lo];
      presetRow.replaceChildren(...list.map((v) => new Button({ label: sgn(v), kind: 'ghost', onClick: () => setBits(encode(v, 'twos', n)!) }).el));
    };

    // ---- interpretations ----
    const interpBody = h('tbody');
    const interp = h('table', { class: 'truth-table tc-interp' }, h('thead', null, h('tr', null, ['Read as', 'value', 'rule'].map((x) => h('th', null, x)))), interpBody);
    const zeroNote = h('div', { class: 'callout' });

    // ---- negate steps ----
    const stepRows = ['start', 'invert', 'add 1', 'result'].map(() => h('tr'));
    const stepTable = h('table', { class: 'tc-steps' }, h('tbody', null, stepRows));
    const negNote = h('div', { class: 'callout' });

    // ---- wheel + number line ----
    const wheelHost = h('div');
    const lineHost = h('div');
    let wheel = buildWheel(n);
    let line = buildLine(n);
    wheelHost.append(wheel.el);
    lineHost.append(line.el);

    // ---- adder ----
    let enc: Exclude<Encoding, 'unsigned'> = 'twos';
    let x = 5, y = -3;
    const xIn = h('input', { type: 'number', class: 'tc-num', value: String(x), 'aria-label': 'First number' });
    const yIn = h('input', { type: 'number', class: 'tc-num', value: String(y), 'aria-label': 'Second number' });
    const readXY = () => {
      const [lo, hi] = encodingRange(enc, n);
      const clamp = (v: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));
      x = clamp(Number(xIn.value));
      y = clamp(Number(yIn.value));
      renderAdder();
    };
    xIn.addEventListener('change', readXY);
    yIn.addEventListener('change', readXY);
    const encSel = select<Exclude<Encoding, 'unsigned'>>(
      ENCODINGS.filter((e) => e.id !== 'unsigned').map((e) => ({ value: e.id as Exclude<Encoding, 'unsigned'>, label: e.title })),
      'twos',
      (v) => { enc = v; readXY(); },
      'Encoding',
    );
    encSel.querySelector('select')!.value = 'twos';
    const addPresets: [number, number][] = [[5, -5], [5, -3], [6, -2], [-3, -4], [127, 1], [-128, -1]];
    const addPresetRow = h('div', { class: 'row' });
    const renderAddPresets = () => {
      const [lo, hi] = encodingRange('twos', n);
      const ok = addPresets.map(([a, b]): [number, number] => (n === 4 && (a > hi || a < lo) ? [a > 0 ? hi : lo, b] : [a, b]));
      const uniq = [...new Map(ok.map((p) => [p.join(','), p])).values()];
      addPresetRow.replaceChildren(...uniq.map(([a, b]) => new Button({ label: `${sgn(a)} + ${b < 0 ? `(${sgn(b)})` : b}`, kind: 'ghost', onClick: () => { xIn.value = String(a); yIn.value = String(b); readXY(); } }).el));
    };
    const sumTable = h('table', { class: 'dp-sum' });
    const verdict = h('div', { class: 'callout' });

    // ---- behaviour ----
    function setBits(v: number) {
      if (anim && anim.phase !== 'done') return;
      anim = null;
      bits = v & mask(n);
      render();
    }
    function setWidth(w: 4 | 8) {
      if (w === n) return;
      const val = decode(bits, 'twos', n).value;
      n = w;
      anim = null;
      const [lo, hi] = encodingRange('twos', n);
      bits = encode(Math.max(lo, Math.min(hi, val)), 'twos', n)!;
      wheel = buildWheel(n);
      line = buildLine(n);
      wheelHost.replaceChildren(wheel.el);
      lineHost.replaceChildren(line.el);
      (widthSel.querySelector('select') as HTMLSelectElement).value = String(n);
      presets();
      renderAddPresets();
      readXY();
      render();
    }
    function startNegate() {
      if (anim && anim.phase !== 'done') return;
      const r = negateTwos(bits, n);
      anim = { phase: 'invert', bit: n - 1, t: 0, carry: true, orig: bits, inv: r.inverted, res: r.result };
      render();
    }

    function render() {
      const row4 = rows[4], row8 = rows[8];
      const br = n === 4 ? row4 : row8;
      if (bitHost.firstChild !== br.el) bitHost.replaceChildren(br.el);
      br.set(bits);
      br.setReadOnly(!!anim && anim.phase !== 'done');
      const tw = decode(bits, 'twos', n).value;
      // sum of place values
      const w = twosWeights(n);
      const terms = w.filter((_, i) => bitOf(bits, n - 1 - i)).map(fmtW);
      setText(sumLine, `${terms.length ? terms.join(' + ').replace(/\+ −/g, '− ') : '0'} = ${sgn(tw)}`);
      setText(bigVal, `${toBinSpaced(bits, n)} = ${sgn(tw)}`);
      if (document.activeElement !== numIn) numIn.value = String(tw);
      numIn.min = String(-(1 << (n - 1)));
      numIn.max = String(mask(n));
      // interpretations
      const msb = bitOf(bits, n - 1);
      const mag = bits & mask(n - 1);
      const rules: Record<Encoding, string> = {
        unsigned: `place values ${twosWeights(n).map((v) => Math.abs(v)).join(' ')}`,
        'sign-magnitude': `sign bit ${msb} (${msb ? '−' : '+'}), magnitude ${toBin(mag, n - 1)} = ${mag}`,
        ones: msb ? `negative: invert all bits → ${toBin(~bits, n)} = ${~bits & mask(n)}` : 'positive: same as unsigned',
        twos: msb ? `−${1 << (n - 1)} + ${bits & mask(n - 1)}  (or invert + 1 → ${negateTwos(bits, n).result})` : 'positive: same as unsigned',
      };
      interpBody.replaceChildren(
        ...ENCODINGS.map((e) => {
          const dv = decode(bits, e.id, n);
          const txt = dv.negativeZero ? '−0 (!)' : sgn(dv.value);
          const tr = h('tr', null, h('td', null, e.title), h('td', { class: 'v' }, txt), h('td', { class: 'small', style: 'text-align:left' }, rules[e.id]));
          if (e.id === 'twos') tr.classList.add('current');
          return tr;
        }),
      );
      const nz = ENCODINGS.filter((e) => decode(bits, e.id, n).negativeZero).map((e) => e.title.toLowerCase());
      setText(
        zeroNote,
        nz.length
          ? `${toBinSpaced(bits, n)} is “negative zero” in ${nz.join(' and ')}. Those schemes have two different patterns for 0, which wastes a pattern and makes “is it zero?” harder. In two’s complement it is ${sgn(tw)}; the only zero is ${'0'.repeat(n)}.`
          : `Two’s complement: the top bit is worth −${1 << (n - 1)} instead of +${1 << (n - 1)}, and everything else is ordinary binary. Range ${sgn(-(1 << (n - 1)))} … ${(1 << (n - 1)) - 1}, with exactly one zero.`,
      );
      // negate panel
      const a = anim;
      const cells = (label: string, v: number | null, op: string) => [h('td', { class: 'op' }, op), h('td', null, v === null ? '' : toBinSpaced(v, n)), h('td', { class: 'dim' }, v === null ? '' : `${label}`)];
      const orig = a ? a.orig : bits;
      const r = negateTwos(orig, n);
      stepRows[0].replaceChildren(...cells(sgnP(decode(orig, 'twos', n).value), orig, ''));
      stepRows[1].replaceChildren(...cells('every bit flipped', a && a.phase === 'invert' ? null : r.inverted, 'invert'));
      stepRows[2].replaceChildren(...cells('', a && a.phase === 'invert' ? null : 1, '+'));
      stepRows[3].replaceChildren(...cells(sgnP(decode(r.result, 'twos', n).value), a && a.phase !== 'done' ? null : r.result, '='));
      stepRows.forEach((tr, i) => setClass(tr, 'active', !!a && ((a.phase === 'invert' && i === 1) || (a.phase === 'add' && i === 2) || (a.phase === 'done' && i === 3))));
      const minVal = 1 << (n - 1);
      if (!a) setText(negNote, 'Press Negate to watch it happen. Why it works: x + (inverted x) = 111…1, which is −1, so (inverted x) + 1 = −x.');
      else if (a.phase === 'invert') setText(negNote, 'Step 1: invert every bit (that’s the ones’ complement).');
      else if (a.phase === 'add') setText(negNote, 'Step 2: add 1. A 1 plus 1 gives 0 and carries into the next bit; the carry stops at the first 0.');
      else if (a.orig === minVal) setText(negNote, `${toBinSpaced(a.orig, n)} (−${minVal}) negates to itself: +${minVal} doesn’t fit in ${n} bits. The one number with no positive partner.`);
      else setText(negNote, `Done: ${sgn(decode(a.orig, 'twos', n).value)} → ${sgn(decode(a.res, 'twos', n).value)}. Negate again and you get back where you started.`);
      wheel.update(bits, adderArc());
      line.update(bits);
    }

    function adderArc(): { from: number; steps: number; to: number } | null {
      if (enc !== 'twos') return null;
      const r = signedAddDemo(x, y, 'twos', n);
      if (!r) return null;
      return { from: r.a, steps: r.b, to: r.add.sum };
    }

    function renderAdder() {
      if (document.activeElement !== xIn) xIn.value = String(x);
      if (document.activeElement !== yIn) yIn.value = String(y);
      const [lo, hi] = encodingRange(enc, n);
      xIn.min = yIn.min = String(lo);
      xIn.max = yIn.max = String(hi);
      const r = signedAddDemo(x, y, enc, n);
      if (!r) return;
      const add = addBinary(r.a, r.b, n);
      const bitCells = (v: number | null, cls = '', carryCol: string | null = '') => {
        const tds = [h('td', { class: `dim ${cls}` }, carryCol ?? '')];
        for (let i = n - 1; i >= 0; i--) tds.push(h('td', { class: cls, style: i % 4 === 3 && i !== n - 1 ? 'padding-left:12px' : '' }, v === null ? '' : String(bitOf(v, i))));
        return tds;
      };
      const carryRow = [h('td', { class: 'dim' }, 'carry')];
      for (let i = n; i >= 0; i--) carryRow.push(h('td', { class: 'carry', style: i % 4 === 3 && i !== n ? 'padding-left:12px' : '' }, bitOf(add.carries, i) ? '1' : ''));
      carryRow.push(h('td'));
      const dec = (v: number) => decode(v, enc, n);
      const show = (v: number) => (dec(v).negativeZero ? '−0' : sgn(dec(v).value));
      sumTable.replaceChildren(
        h('tr', null, carryRow),
        h('tr', null, h('td', { class: 'dim' }, ''), ...bitCells(r.a).slice(0), h('td', { class: 'dim' }, show(r.a))),
        h('tr', null, h('td', { class: 'dim' }, '+'), ...bitCells(r.b), h('td', { class: 'dim' }, show(r.b))),
        h('tr', { class: 'rule' }, h('td', { class: 'dim' }, '='), ...bitCells(add.sum, '', add.carryOut ? '1' : ''), h('td', null, h('b', null, show(add.sum)))),
      );
      // strike the discarded carry out
      const last = sumTable.lastElementChild!.children[1] as HTMLElement;
      setClass(last, 'strike', add.carryOut === 1);
      const name = ENCODINGS.find((e) => e.id === enc)!.title.toLowerCase();
      setClass(verdict, 'good', r.correct && !r.got.negativeZero);
      setClass(verdict, 'warn', !r.correct);
      const carryTxt = add.carryOut ? ' The carry out of the top bit is simply thrown away.' : '';
      if (r.correct && r.got.negativeZero) setText(verdict, `${sgn(x)} + ${sgnP(y)} gives ${toBin(add.sum, n)}, which ${name} calls “−0”. Numerically fine, but now zero has two patterns.${carryTxt}`);
      else if (r.correct) setText(verdict, `Correct: ${sgn(x)} + ${sgnP(y)} = ${sgn(r.exact)}.${carryTxt}${enc === 'twos' ? ' The ordinary adder just works: that is why the ALU uses two’s complement.' : ''}`);
      else if (!r.representable) setText(verdict, `Overflow: the true answer ${sgn(r.exact)} doesn’t fit (range ${lo} … ${hi}), so the result wraps around to ${show(add.sum)}. Adding two numbers of the same sign and getting the opposite sign is the tell-tale sign. On the wheel the arc crosses the red line.`);
      else if (enc === 'ones') setText(verdict, `Off by one: the adder gives ${show(add.sum)} but ${sgn(x)} + ${sgnP(y)} = ${sgn(r.exact)}. Ones’ complement only works if the carry out is added back in at the bottom (“end-around carry”), which needs extra hardware.`);
      else setText(verdict, `Wrong: the adder gives ${show(add.sum)} but ${sgn(x)} + ${sgnP(y)} = ${sgn(r.exact)}. With a sign bit, a plain adder can’t handle mixed signs: it adds the sign bits like any other bits.`);
      wheel.update(bits, adderArc());
    }

    // ---- negate animation ----
    d.add(
      animate((dt) => {
        if (!anim || anim.phase === 'done') return;
        anim.t += dt;
        const br = rows[n];
        const stepMs = anim.phase === 'invert' ? 140 : 320;
        if (anim.t < stepMs) return;
        anim.t = 0;
        br.clearMarks();
        if (anim.phase === 'invert') {
          bits ^= 1 << anim.bit;
          br.mark(anim.bit, 'flash', true);
          anim.bit--;
          if (anim.bit < 0) { anim.phase = 'add'; anim.bit = 0; anim.carry = true; }
        } else if (anim.phase === 'add') {
          if (!anim.carry || anim.bit >= n) {
            anim.phase = 'done';
          } else {
            const was = bitOf(bits, anim.bit);
            bits ^= 1 << anim.bit;
            br.mark(anim.bit, 'flash', true);
            anim.carry = was === 1;
            anim.bit++;
            if (!anim.carry || anim.bit >= n) { anim.phase = 'done'; bits = anim.res; }
          }
        }
        render();
      }),
    );

    // ---- Ben's −5 ----
    const ben = h(
      'table',
      { class: 'truth-table compact' },
      h('thead', null, h('tr', null, ['−5 in 4 bits', 'pattern', ''].map((t) => h('th', null, t)))),
      h(
        'tbody',
        null,
        (['sign-magnitude', 'ones', 'twos'] as const).map((e) => {
          const p = encode(-5, e, 4)!;
          const btn = new Button({ label: 'show', kind: 'ghost', onClick: () => { setWidth(4); setBits(p); } });
          return h('tr', null, h('td', { style: 'text-align:left' }, ENCODINGS.find((x) => x.id === e)!.title), h('td', null, toBin(p, 4)), h('td', null, btn.el));
        }),
      ),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Click the bits',
          { accent: 'red', subtitle: 'place values underneath' },
          row(widthSel, h('label', { class: 'select' }, h('span', { class: 'slider-label' }, 'Type'), numIn)),
          bitHost,
          bigVal,
          sumLine,
          presetRow,
          note('The only difference from ordinary binary: the top bit’s place value is negative.'),
        ),
        panel('The same bits, four ways', { accent: 'gray' }, h('div', { class: 'dp-scroll' }, interp), zeroNote, ben),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Negating: invert, then add 1', { accent: 'yellow' }, row(negBtn.el), h('div', { class: 'dp-scroll' }, stepTable), negNote),
        panel(
          'The number wheel',
          { accent: 'blue' },
          wheelHost,
          lineHost,
          note('Outside: the bit patterns (unsigned). Inside: their two’s-complement values. Counting up past the amber line wraps 111…1 → 000…0 (that’s the carry out). Crossing the red line jumps from the largest positive to the most negative number: overflow. The green arc is the addition below: adding a negative number is going most of the way round.'),
        ),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Adding signed numbers with an ordinary adder',
          { accent: 'green' },
          row(encSel),
          row(h('label', { class: 'select' }, h('span', { class: 'slider-label' }, 'x'), xIn), h('span', null, '+'), h('label', { class: 'select' }, h('span', { class: 'slider-label' }, 'y'), yIn)),
          addPresetRow,
          h('div', { class: 'dp-scroll' }, sumTable),
          verdict,
        ),
        panel(
          'What Ben shows',
          { accent: 'gray' },
          note('Sign bit: 5 + (−5) = 0101 + 1101 = 1 0010 → 2. Wrong, and there are two zeros (0000 and 1000).'),
          note('Ones’ complement (invert to negate): 5 + (−5) = 0101 + 1010 = 1111, which is −0. And 6 + (−2) = 0110 + 1101 = 1 0011 → 3: off by one.'),
          note('Two’s complement (invert and add 1): place values −8 4 2 1. 5 + (−5) = 0101 + 1011 = 1 0000 → 0 once you drop the carry; 6 − 2 = 0110 + 1110 = 1 0100 → 4. So the ALU can subtract with nothing but an adder and some inverters, which is exactly what the next video builds.'),
        ),
      ),
    );
    presets();
    renderAddPresets();
    render();
    renderAdder();
    return d.dispose;
  },
});

// ---------------------------------------------------------------------------
// SVG helpers

function buildWheel(n: number) {
  const N = 1 << n;
  const C = 160, R = 112;
  const svg = s('svg', { viewBox: '0 0 320 320', class: 'tc-wheel', role: 'img', 'aria-label': `${n}-bit number wheel` });
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / N;
  const pt = (i: number, r: number): [number, number] => [C + r * Math.cos(ang(i)), C + r * Math.sin(ang(i))];
  svg.appendChild(s('circle', { cx: C, cy: C, r: R, class: 'ring' }));
  const every = n === 4 ? 1 : 32;
  for (let i = 0; i < N; i++) {
    const major = i % (n === 4 ? 1 : 16) === 0;
    const [x1, y1] = pt(i, major ? R - 9 : R - 4);
    const [x2, y2] = pt(i, major ? R + 9 : R + 4);
    svg.appendChild(s('line', { x1, y1, x2, y2, class: `tick ${major ? 'major' : ''}` }));
    if (i % every === 0) {
      const [ox, oy] = pt(i, R + 22);
      svg.appendChild(s('text', { x: ox, y: oy, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'lab-out' }, n === 4 ? toBin(i, 4) : String(i)));
      const v = decode(i, 'twos', n).value;
      const [ix, iy] = pt(i, R - 26);
      svg.appendChild(s('text', { x: ix, y: iy, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: `lab-in ${v < 0 ? 'neg' : ''}` }, v < 0 ? `−${-v}` : String(v)));
    }
  }
  const bound = (i: number, cls: string, label: string) => {
    const [x1, y1] = pt(i + 0.5, R - 40);
    const [x2, y2] = pt(i + 0.5, R + 12);
    svg.appendChild(s('line', { x1, y1, x2, y2, class: `bound ${cls}` }));
    const [tx, ty] = pt(i + 0.5, R - 50);
    svg.appendChild(s('text', { x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: `btext ${cls}` }, label));
  };
  bound(N / 2 - 1, 'ovf', 'overflow');
  bound(N - 1, 'cry', 'carry');
  const arc = s('path', { class: 'arc', d: '' });
  const arcDot = s('circle', { r: 5, class: 'arc-dot', cx: -10, cy: -10 });
  const ptr = s('line', { x1: C, y1: C, x2: C, y2: C - R, class: 'ptr' });
  const dot = s('circle', { cx: C, cy: C - R, r: 7, class: 'ptr-dot' });
  const big = s('text', { x: C, y: C + 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'center-big' }, '');
  const small = s('text', { x: C, y: C + 24, 'text-anchor': 'middle', class: 'center-small' }, '');
  svg.append(arc, arcDot, ptr, dot, big, small);
  return {
    el: svg,
    update(bits: number, add: { from: number; steps: number; to: number } | null) {
      const [px, py] = pt(bits, R);
      ptr.setAttribute('x2', String(C + (px - C) * 0.8));
      ptr.setAttribute('y2', String(C + (py - C) * 0.8));
      dot.setAttribute('cx', String(px));
      dot.setAttribute('cy', String(py));
      const v = decode(bits, 'twos', n).value;
      setText(big, v < 0 ? `−${-v}` : String(v));
      setText(small, `${toBin(bits, n)} = ${bits} unsigned`);
      if (add && add.steps > 0) {
        const r = R - 62;
        const [ax, ay] = pt(add.from, r);
        const [bx, by] = pt(add.to, r);
        const large = add.steps > N / 2 ? 1 : 0;
        arc.setAttribute('d', `M ${ax} ${ay} A ${r} ${r} 0 ${large} 1 ${bx} ${by}`);
        arcDot.setAttribute('cx', String(bx));
        arcDot.setAttribute('cy', String(by));
      } else {
        arc.setAttribute('d', '');
        arcDot.setAttribute('cx', '-10');
      }
    },
  };
}

function buildLine(n: number) {
  const N = 1 << n;
  const half = N / 2;
  const X0 = 20, X1 = 340;
  const svg = s('svg', { viewBox: '0 0 360 78', class: 'tc-line', role: 'img', 'aria-label': 'Number lines' });
  const xs = (v: number, lo: number, hi: number) => X0 + ((v - lo) / (hi - lo)) * (X1 - X0);
  svg.append(
    s('line', { x1: X0, y1: 20, x2: X1, y2: 20, class: 'axis' }),
    s('line', { x1: X0, y1: 58, x2: X1, y2: 58, class: 'axis' }),
    s('text', { x: X0, y: 10, class: 'lbl' }, `two’s: −${half}`),
    s('text', { x: X1, y: 10, 'text-anchor': 'end', class: 'lbl' }, String(half - 1)),
    s('text', { x: xs(0, -half, half - 1), y: 34, 'text-anchor': 'middle', class: 'lbl' }, '0'),
    s('text', { x: X0, y: 74, class: 'lbl' }, 'unsigned: 0'),
    s('text', { x: X1, y: 74, 'text-anchor': 'end', class: 'lbl' }, String(N - 1)),
    s('text', { x: xs(half, 0, N - 1), y: 50, 'text-anchor': 'middle', class: 'lbl' }, String(half)),
  );
  const link = s('line', { class: 'link' });
  const m1 = s('circle', { r: 5, class: 'mk', cy: 20 });
  const m2 = s('circle', { r: 5, class: 'mk', cy: 58 });
  svg.append(link, m1, m2);
  return {
    el: svg,
    update(bits: number) {
      const v = decode(bits, 'twos', n).value;
      const a = xs(v, -half, half - 1), b = xs(bits, 0, N - 1);
      m1.setAttribute('cx', String(a));
      m2.setAttribute('cx', String(b));
      link.setAttribute('x1', String(a));
      link.setAttribute('y1', '20');
      link.setAttribute('x2', String(b));
      link.setAttribute('y2', '58');
    },
  };
}
