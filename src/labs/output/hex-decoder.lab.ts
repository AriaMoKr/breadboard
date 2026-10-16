import { Circuit, type Net } from '../../logic/circuit';
import { bin, hex } from '../../sim/assembler';
import { HEX_DIGITS } from '../../sim/display';
import { Button, DipSwitch, SevenSegment, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { Schematic, switchPitch } from '../../ui/schematic';
import { badge, makeTable, scopedStyle } from '../ram/_ui';
import { defineLab } from '../types';
import {
  SEGS, VARS, canonical, covers, decoderCost, decoderCostPairs, formatTerm, gateCount, literals, minimise, minterms, segLit, segOutput,
  type Implicant, type Polarity, type Seg,
} from './_shared';

const CSS = `
.hexdec .sevenseg .seg { cursor: pointer; stroke: transparent; stroke-width: 10; } /* the stroke widens the thin segments' hit area */
.hexdec .sevenseg .seg.picked { stroke: var(--accent-2); stroke-width: 2.5; }
.hexdec .expr { font-family: var(--mono); font-size: 0.9rem; line-height: 1.7; word-break: break-word; }
.hexdec .expr .term { padding: 1px 3px; border-radius: 4px; }
.hexdec .expr .term.hot { background: color-mix(in srgb, var(--wire-1) 30%, transparent); color: var(--fg); }
.hexdec .segbtns .btn { min-width: 34px; font-family: var(--mono); }
.hexdec .segbtns .btn.active { border-color: var(--accent-2); color: var(--accent-2); }
@media (prefers-color-scheme: light) { .hexdec .segbtns .btn.active { color: #b45309; } }
.hexdec .truth-table th.click { cursor: pointer; }
.hexdec .big7 { display: inline-flex; background: #0b0b0d; padding: 8px; border-radius: 8px; }
`;

export default defineLab({
  id: 'hex-decoder',
  title: '7-segment hex decoder',
  summary:
    'Four switches hold a 4-bit number. To show it as a hex digit, each of the 7 segments needs its own logic function of those 4 bits. Ben writes the truth table, builds every segment as an OR of AND terms (with a 74LS04 for the inverted inputs), and ends up with 9 AND chips and 5 OR chips for one digit. Pick a segment to see its truth-table column, its sum of products and a simplified version evaluated by live gates.',
  mount(root) {
    const d = new Disposer();
    d.add(scopedStyle(root, CSS));
    root.classList.add('hexdec');

    let x = 0b1010;
    let seg: Seg = 'a';
    let pol: Polarity = 'ca';
    let form: 'minimal' | 'canonical' = 'minimal';

    // ---- display + inputs ----
    const disp = new SevenSegment({ height: 120 });
    const dip = new DipSwitch({ bits: 4, value: x, label: 'A B C D', onChange: (v) => setX(v) });
    const valText = h('div', { class: 'mo-big' });
    const inc = new Button({ label: '+1', onClick: () => setX((x + 1) & 15) });
    const segBtns = SEGS.map((s) => {
      const b = new Button({ label: s, onClick: () => setSeg(s) });
      return b;
    });
    SEGS.forEach((s) => {
      const el = disp.el.querySelector(`.seg-${s}`);
      if (el) d.listen(el, 'click', () => setSeg(s));
    });
    const polToggle = new Toggle({ label: 'Ben’s common-anode display (a segment lights when its pin is LOW)', value: true, onChange: (v) => { pol = v ? 'ca' : 'cc'; rebuild(); } });
    const formToggle = new Toggle({ label: 'Draw the full sum of minterms', value: false, onChange: (v) => { form = v ? 'canonical' : 'minimal'; rebuild(); } });

    // ---- truth table ----
    const tt = makeTable(
      [...VARS, 'hex', ...SEGS],
      Array.from({ length: 16 }, (_, v) => [...bin(v, 4).split(''), hex(v, 1), ...SEGS.map(() => '')]),
      { class: 'compact' },
    );
    SEGS.forEach((s, i) => {
      const th = tt.head[5 + i];
      th.classList.add('click');
      th.title = `Show the logic for segment ${s}`;
      d.listen(th, 'click', () => setSeg(s));
    });
    const fillTable = () => {
      for (let v = 0; v < 16; v++)
        SEGS.forEach((s, i) => {
          const cell = tt.cells[v][5 + i];
          setText(cell, String(segOutput(v, s, pol)));
          setClass(cell, 'on', segLit(v, s) === 1);
          setClass(cell, 'sel', s === seg);
        });
      SEGS.forEach((s, i) => setClass(tt.head[5 + i], 'sel', s === seg));
    };

    // ---- logic panel ----
    const exprCanon = h('div', { class: 'expr' });
    const exprMin = h('div', { class: 'expr' });
    const segCost = h('div', { class: 'small' });
    const outBadge = badge();
    const logicHost = h('div');
    const logicCallout = h('div', { class: 'callout' });
    let logic: LogicView | null = null;
    d.add(() => logic?.dispose());

    // ---- gate count panel ----
    const costTable = makeTable(['design', '2-in AND', '2-in OR', 'NOT', 'chips (08 + 32 + 04)'], Array.from({ length: 6 }, () => ['', '', '', '', '']), { class: 'compact' });
    const fillCost = () => {
      const row = (name: string, c: ReturnType<typeof decoderCost>) => [name, String(c.and2), String(c.or2), String(c.not), `${c.chips.ls08} + ${c.chips.ls32} + ${c.chips.ls04} = ${c.chips.total}`];
      const rows = [
        row('every minterm', decoderCost('canonical', pol)),
        row('minimised', decoderCost('minimal', pol)),
        row('minimised, shared terms', decoderCost('minimal', pol, true)),
        row('minimised, shared terms and pairs', decoderCostPairs(pol)),
        ['Ben’s breadboard (parts list)', '≤ 36', '≤ 20', '≤ 6', '9 + 5 + 1 = 15'],
        ['one EEPROM (next video)', '', '', '', '1 × 28C16'],
      ];
      rows.forEach((r, i) => r.forEach((t, k) => setText(costTable.cells[i][k], t)));
    };

    const renderExpr = (el: HTMLElement, terms: Implicant[]) => {
      el.replaceChildren(
        h('span', null, `${pol === 'ca' ? `${seg}̅` : seg} = `),
        ...terms.flatMap((t, i) => [i ? ' + ' : '', h('span', { class: `term ${covers(t, x) ? 'hot' : ''}` }, formatTerm(t))]),
      );
    };

    let cache = { min: [] as Implicant[], can: [] as Implicant[] };
    const rebuild = () => {
      const ms = minterms(seg, pol);
      const min = minimise(ms);
      const can = canonical(ms);
      cache = { min, can };
      logic?.dispose();
      logic = buildLogic(form === 'minimal' ? min : can, seg, pol, (v) => setX(x ^ (1 << (3 - v))));
      logicHost.replaceChildren(logic.el);
      const gm = gateCount(min), gc = gateCount(can);
      setText(segCost, `Segment ${seg}: ${ms.length} minterms → ${gc.and2} ANDs + ${gc.or2} ORs as written; minimised to ${min.length} terms → ${gm.and2} ANDs + ${gm.or2} ORs (2-input gates).`);
      fillTable();
      fillCost();
      update();
    };

    const update = () => {
      disp.set(HEX_DIGITS[x]);
      if (dip.value !== x) dip.set(x);
      setText(valText, `${bin(x, 4)} = ${x} = 0x${hex(x, 1)}`);
      tt.highlight(x);
      segBtns.forEach((b, i) => setClass(b.el, 'active', SEGS[i] === seg));
      disp.el.querySelectorAll('.seg').forEach((el) => setClass(el, 'picked', el.classList.contains(`seg-${seg}`)));
      renderExpr(exprCanon, cache.can);
      renderExpr(exprMin, cache.min);
      logic?.setInputs(x);
      const out = segOutput(x, seg, pol);
      const lit = segLit(x, seg) === 1;
      outBadge.set(`output ${out} → segment ${seg} ${lit ? 'lit' : 'off'}`, lit ? 'on' : '');
      const hot = (form === 'minimal' ? cache.min : cache.can).filter((t) => covers(t, x)).map(formatTerm);
      setText(
        logicCallout,
        hot.length
          ? `Input ${bin(x, 4)}: the term${hot.length > 1 ? 's' : ''} ${hot.join(', ')} ${hot.length > 1 ? 'are' : 'is'} true, so the OR gate outputs 1${pol === 'ca' ? ', which pulls the segment pin high and turns the common-anode segment OFF' : ' and segment ' + seg + ' lights'}.`
          : `Input ${bin(x, 4)}: no AND term is true, so the OR gate outputs 0${pol === 'ca' ? ', the pin is low and the common-anode segment lights' : ' and segment ' + seg + ' stays dark'}.`,
      );
    };
    const setX = (v: number) => {
      x = v & 15;
      update();
    };
    const setSeg = (s: Seg) => {
      seg = s;
      rebuild();
    };

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            'Hex digit',
            { accent: 'red', subtitle: 'click a segment to pick it' },
            row(h('span', { class: 'big7' }, disp.el), h('div', { class: 'mo-col' }, dip.el, valText, row(inc.el))),
            h('div', { class: 'row segbtns' }, h('span', { class: 'mo-label' }, 'segment'), ...segBtns.map((b) => b.el)),
            polToggle.el,
            note('Ben’s patterns: B and D come out lowercase (b, d) so they don’t look like 8 and 0.'),
          ),
          panel('Segment logic', { accent: 'yellow', chips: '74LS04, 74LS08, 74LS32' }, logicHost, row(outBadge.el), logicCallout, formToggle.el, h('h4', null, 'Sum of minterms'), exprCanon, h('h4', null, 'Minimised'), exprMin, segCost),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Truth table', { accent: 'gray', subtitle: 'click a segment column' }, tt.el, note('Each row is one input combination. Each segment column is its own logic function: OR together an AND term for every row with a 1 in it and you have a working circuit.')),
          panel(
            'How many gates for one digit?',
            { accent: 'gray' },
            costTable.el,
            note('Counts use 2-input gates, as in the 74LS08 and 74LS32: a 4-input AND term costs 3 ANDs and ORing k terms costs k−1 ORs. Designing for Ben’s common-anode display covers the OFF rows instead, and there are far fewer of those: its minimised version needs 18 ORs, which fit in Ben’s 5 × 74LS32. Building each two-input product such as A̅B̅ or CD̅ only once and reusing it brings the ANDs within his 9 × 74LS08 as well. Ben’s exact equations are not known, so this is one way to reach his chip count, not necessarily his.'),
            h('div', { class: 'callout' }, 'This is about 15 chips of wiring for one hex digit. Showing an 8-bit value as three decimal digits would take far more. The next video swaps all of this for one EEPROM: the 4 inputs become address lines and the segment pattern is simply stored as data.'),
          ),
        ),
      ),
    );
    rebuild();
    return d.dispose;
  },
});

interface LogicView {
  el: SVGSVGElement;
  setInputs(x: number): void;
  dispose(): void;
}

/** Gate-level drawing of one segment's sum of products: input switches, 74LS04 rails, AND terms, OR. */
function buildLogic(terms: Implicant[], seg: Seg, pol: Polarity, onToggle: (v: number) => void): LogicView {
  const c = new Circuit();
  const ins = VARS.map((n) => c.input(n, 0));
  const negs = VARS.map((n) => c.net(`${n}̅`, 1));
  ins.forEach((n, i) => c.not(n, negs[i]));
  const k = terms.length > 6 ? 0.7 : 1;
  const termNets: Net[] = terms.map((t, i) => {
    const lits = literals(t);
    if (lits.length === 1) return lits[0].neg ? negs[lits[0].v] : ins[lits[0].v];
    const out = c.net(`t${i}`, 0);
    c.and(lits.map((l) => (l.neg ? negs[l.v] : ins[l.v])), out);
    return out;
  });
  const outNet = c.net(seg, 0);
  if (termNets.length === 1) c.buf(termNets[0], outNet);
  else if (termNets.length > 1) c.or(termNets, outNet);
  c.settle();

  const T = (v: number) => 110 + 46 * v;
  const C = (v: number) => T(v) + 31;
  const pitch = switchPitch(26); // input switches, wider apart on touch screens
  const yIn = (v: number) => 22 + pitch * v;
  const top = yIn(3) + 28; // terms start below the last input's inverter
  const spacing = terms.map((t) => Math.max(34, literals(t).length * 12 + 12) * k);
  const yTerm: number[] = [];
  let y = top;
  spacing.forEach((sp) => { yTerm.push(y + sp / 2); y += sp; });
  const bottom = Math.max(y, top + 40);
  const height = bottom + 16;
  const sch = new Schematic(c, { width: 560, height });

  VARS.forEach((name, v) => {
    sch.wire(ins[v], [40, yIn(v)], [T(v), yIn(v)]);
    sch.switch(ins[v], [40, yIn(v)], { label: name, onToggle: () => onToggle(v) });
    sch.wire(ins[v], [T(v), yIn(v)], [T(v), bottom]);
    sch.dot(ins[v], [T(v), yIn(v)]);
    const g = sch.gate('NOT', [T(v) + 6, yIn(v) + 12], { scale: 0.5, output: negs[v] });
    sch.wire(ins[v], [T(v), g.inputs[0].y], g.inputs[0]);
    sch.wire(negs[v], g.output, [C(v), g.output.y], [C(v), bottom]);
    sch.text(name, [T(v), top - 8], { size: 10, class: 'cap' });
    sch.text(`${name}̅`, [C(v), top - 8], { size: 10, class: 'cap' });
  });
  sch.text('74LS04', [C(3) + 30, yIn(0)], { size: 10, class: 'cap', anchor: 'start' });

  const xAnd = 330;
  const xOr = 466;
  let orIns: { x: number; y: number }[] = [];
  let orOut = { x: xOr + 50 * k, y: (top + bottom) / 2 };
  if (termNets.length > 1) {
    const g = sch.gate('OR', [xOr, (top + bottom) / 2], { inputs: termNets.length, output: outNet, scale: k, label: '74LS32' });
    orIns = g.inputs;
    orOut = g.output;
  }
  terms.forEach((t, i) => {
    const lits = literals(t);
    const yy = yTerm[i];
    let outPt: { x: number; y: number };
    if (lits.length === 1) {
      const l = lits[0];
      const rx = l.neg ? C(l.v) : T(l.v);
      sch.wire(termNets[i], [rx, yy], [xAnd + 40, yy]);
      sch.dot(termNets[i], [rx, yy]);
      outPt = { x: xAnd + 40, y: yy };
    } else {
      const g = sch.gate('AND', [xAnd, yy], { inputs: lits.length, output: termNets[i], scale: k });
      lits.forEach((l, j) => {
        const rx = l.neg ? C(l.v) : T(l.v);
        const net = l.neg ? negs[l.v] : ins[l.v];
        sch.wire(net, [rx, g.inputs[j].y], g.inputs[j]);
        sch.dot(net, [rx, g.inputs[j].y]);
      });
      outPt = g.output;
    }
    if (orIns[i]) {
      // fan in without crossings: terms above the OR gate turn right-most first, terms below mirror that
      const above = orIns[i].y > outPt.y;
      const rank = above ? i : terms.length - 1 - i;
      sch.route(termNets[i], outPt, orIns[i], { midX: 446 - 3.5 * rank });
    }
    else sch.wire(termNets[i], outPt, [xOr + 50, outPt.y]);
  });
  sch.text('74LS08', [xAnd + 20, top - 8], { size: 10, class: 'cap' });
  sch.wire(outNet, orOut, [532, orOut.y]);
  sch.probe(outNet, [540, orOut.y], { label: pol === 'ca' ? `${seg}̅` : seg, color: 'red', labelSide: 'top' });
  const stop = sch.autoUpdate();

  return {
    el: sch.el,
    setInputs(x: number) {
      VARS.forEach((_, v) => c.set(ins[v], ((x >> (3 - v)) & 1) as 0 | 1));
      c.settle();
      sch.update();
    },
    dispose: stop,
  };
}
