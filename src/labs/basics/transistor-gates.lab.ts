import { Slider, Toggle, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, h, s, setClass, setText } from '../../ui/dom';
import { callout, injectStyle, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { GATES, conducts, depletion, gate, truthRows, type GateId } from './_gates';

const CSS = `
.tg-lab svg { width: 100%; height: auto; display: block; }
.tg-lab .silicon { max-width: 640px; }
.tg-lab .gate-svg { max-width: 420px; }
.tg-lab .tg-wire { fill: none; stroke: var(--fg-faint); stroke-width: 2.5; stroke-linejoin: round; }
.tg-lab .tg-wire.hot { stroke: #f59e0b; stroke-width: 3.5; }
.tg-lab .tg-rail { stroke: var(--fg-dim); stroke-width: 3; }
.tg-lab .tg-label { fill: var(--fg-dim); font: 12px ui-monospace, monospace; }
.tg-lab .tg-res { fill: var(--panel); stroke: var(--fg-dim); stroke-width: 2; }
.tg-lab .tg-res.hot { stroke: #f59e0b; }
.tg-lab .tg-npn { fill: none; stroke: var(--fg-dim); stroke-width: 2.5; }
.tg-lab .tg-npn-ring { fill: none; stroke: var(--fg-faint); stroke-width: 1.5; }
.tg-lab .tg-npn.on, .tg-lab .tg-npn.on + .tg-npn-ring { stroke: #4ade80; }
.tg-lab .tg-led { fill: #3f1d1d; stroke: var(--fg-dim); stroke-width: 2; }
.tg-lab .tg-led.lit { fill: #ef4444; stroke: #fca5a5; filter: drop-shadow(0 0 6px #ef4444); }
.tg-lab .n-type { fill: color-mix(in srgb, #3b82f6 18%, var(--panel)); }
.tg-lab .p-type { fill: color-mix(in srgb, #ef4444 16%, var(--panel)); }
.tg-lab .depl { fill: var(--panel); stroke: var(--fg-faint); stroke-dasharray: 4 4; }
.tg-lab .electron { fill: #60a5fa; }
.tg-lab .hole { fill: none; stroke: #f87171; stroke-width: 1.5; }
.tg-lab .fixed { fill: var(--fg-faint); font: 11px ui-monospace, monospace; text-anchor: middle; }
`;

// ---------------------------------------------------------------------------
// Inside the silicon: a PN junction (diode) or an NPN transistor, with moving charge carriers

type Silicon = 'diode' | 'npn';
interface Carrier {
  x: number;
  y: number;
  kind: 'e' | 'h';
  /** Electrons crossing an on transistor: whether this one leaves through the base. */
  base?: boolean;
  el: SVGElement;
}

const W = 600, H = 170, Y0 = 30, Y1 = 140;

function siliconView(root: SVGSVGElement) {
  const layer = s('g');
  root.appendChild(layer);
  const carriers: Carrier[] = [];
  let mode: Silicon = 'diode', v = 0, baseOn = false;
  const regions = s('g');
  const fixed = s('g');
  const cg = s('g');
  const labels = s('g');
  layer.append(regions, fixed, cg, labels);

  const rect = (x0: number, x1: number, cls: string) => s('rect', { x: x0, y: Y0, width: Math.max(0, x1 - x0), height: Y1 - Y0, class: cls });
  const text = (x: number, y: number, t: string, cls = 'tg-label') => s('text', { x, y, class: cls, 'text-anchor': 'middle' }, t);

  const random = (() => {
    let a = 12345;
    return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  })();
  const spawn = (kind: 'e' | 'h', x0: number, x1: number) => {
    const el = kind === 'e' ? s('circle', { r: 3.2, class: 'electron' }) : s('circle', { r: 3.6, class: 'hole' });
    const c: Carrier = { x: x0 + random() * (x1 - x0), y: Y0 + 8 + random() * (Y1 - Y0 - 16), kind, el };
    cg.appendChild(el);
    carriers.push(c);
    return c;
  };
  const clear = () => {
    carriers.length = 0;
    cg.replaceChildren();
  };

  /** Where the regions and depletion bands are now. */
  const geometry = () => {
    if (mode === 'diode') {
      const w = 60 * (v < 0 ? Math.sqrt(1 + -v / 0.65) : depletion(v));
      return { bands: [[300 - w, 300 + w]] as [number, number][], n: [[40, 300]] as [number, number][], p: [[300, 560]] as [number, number][] };
    }
    // emitter 40-260 (N), base 260-320 (P, thin), collector 320-560 (N)
    const be = baseOn ? 0 : 22;
    return { bands: [[260 - be, 260 + be], [320 - 26, 320 + 30]] as [number, number][], n: [[40, 260], [320, 560]] as [number, number][], p: [[260, 320]] as [number, number][] };
  };
  const inBand = (x: number, bands: [number, number][]) => bands.some(([a, b]) => x > a && x < b);

  const layout = () => {
    const g = geometry();
    regions.replaceChildren(...g.n.map(([a, b]) => rect(a, b, 'n-type')), ...g.p.map(([a, b]) => rect(a, b, 'p-type')), ...g.bands.filter(([a, b]) => b - a > 1).map(([a, b]) => rect(a, b, 'depl')));
    // fixed charges in each band: + on its N side, - on its P side
    fixed.replaceChildren(
      ...g.bands.flatMap(([a, b], i) => {
        if (b - a < 6) return [];
        const nOnLeft = mode === 'diode' || i === 0;
        const mid = (a + b) / 2;
        const out: SVGElement[] = [];
        for (let y = Y0 + 16; y < Y1 - 6; y += 22) {
          out.push(text(nOnLeft ? (a + mid) / 2 : (mid + b) / 2, y, '+', 'fixed'));
          out.push(text(nOnLeft ? (mid + b) / 2 : (a + mid) / 2, y + 11, '−', 'fixed'));
        }
        return out;
      }),
    );
    labels.replaceChildren(
      ...(mode === 'diode'
        ? [text(170, Y0 - 10, 'N-type (phosphorus): free electrons'), text(430, Y0 - 10, 'P-type (boron): holes'), text(300, H - 8, g.bands[0][1] - g.bands[0][0] > 2 ? 'depletion region: no charge carriers' : 'no depletion region left: current flows')]
        : [text(150, Y0 - 10, 'emitter (N, heavily doped)'), text(290, Y0 - 10, 'base (P, thin)'), text(440, Y0 - 10, 'collector (N)'), text(290, H - 8, baseOn ? 'base current on: electrons sweep through the thin base' : 'off: the junctions’ depletion regions block')]),
    );
  };

  const reset = () => {
    clear();
    const g = geometry();
    for (const [a, b] of g.n) for (let k = 0; k < (b - a) / 6; k++) spawn('e', a + 4, b - 4);
    for (const [a, b] of g.p) for (let k = 0; k < (b - a) / 6; k++) spawn('h', a + 4, b - 4);
    layout();
  };

  const tick = (dt: number) => {
    const g = geometry();
    const flowing = mode === 'diode' ? conducts(v) : baseOn;
    for (const c of carriers) {
      // a jiggle, and a drift when current flows
      c.y = Math.max(Y0 + 6, Math.min(Y1 - 6, c.y + (random() - 0.5) * 2));
      let vx = (random() - 0.5) * 30;
      if (flowing) vx += c.kind === 'e' ? 90 : -60;
      if (mode === 'npn' && flowing && c.kind === 'e' && c.base && c.x > 270) c.y += dt * 120; // leaving through the base lead
      c.x += vx * dt;
      const homeN = g.n, homeP = g.p;
      const home = c.kind === 'e' ? homeN : homeP;
      if (!flowing) {
        // stay in its own kind of material, out of the depletion bands
        const inside = home.some(([a, b]) => c.x > a + 3 && c.x < b - 3) && !inBand(c.x, g.bands);
        if (!inside) c.x -= 2 * vx * dt;
      }
      // wrap round: carriers that leave come back in from the battery
      if (c.x > 556 || (c.base && c.y > Y1 - 6)) {
        const [a, b] = c.kind === 'e' ? homeN[0] : homeP[0];
        c.x = a + 4 + random() * 20;
        c.y = Y0 + 8 + random() * (Y1 - Y0 - 16);
        c.base = mode === 'npn' && random() < 0.02;
        if (c.kind === 'h' && mode === 'diode') c.x = b - 4 - random() * 20;
      }
      if (c.x < 44) c.x = c.kind === 'h' ? (homeP[0][1] - 4 - random() * 20) : 44;
      c.el.setAttribute('cx', c.x.toFixed(1));
      c.el.setAttribute('cy', c.y.toFixed(1));
      c.el.style.display = !flowing && inBand(c.x, g.bands) ? 'none' : '';
    }
  };

  reset();
  return {
    setMode(m: Silicon) {
      mode = m;
      reset();
    },
    setV(x: number) {
      v = x;
      layout();
    },
    setBase(on: boolean) {
      baseOn = on;
      for (const c of carriers) c.base = on && c.kind === 'e' && random() < 0.02;
      layout();
    },
    tick,
  };
}

// ---------------------------------------------------------------------------
// The gate circuits

interface Drawn {
  el: SVGSVGElement;
  update(a: boolean, b: boolean): void;
}

function drawGate(id: GateId): Drawn {
  const svg = s('svg', { viewBox: '0 0 320 300', class: 'gate-svg', role: 'img', 'aria-label': `${id} gate from transistors` });
  const upd: ((a: boolean, b: boolean) => void)[] = [];
  const st = (a: boolean, b: boolean) => gate(id, a, b);
  const wire = (pts: [number, number][], hot: (a: boolean, b: boolean) => boolean) => {
    const el = s('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'tg-wire' });
    svg.appendChild(el);
    upd.push((a, b) => setClass(el, 'hot', hot(a, b)));
  };
  const res = (x: number, y0: number, y1: number, hot: (a: boolean, b: boolean) => boolean, label = '') => {
    wire([[x, y0], [x, y0 + 8]], hot);
    wire([[x, y1 - 8], [x, y1]], hot);
    const el = s('rect', { x: x - 6, y: y0 + 8, width: 12, height: y1 - y0 - 16, rx: 2, class: 'tg-res' });
    svg.appendChild(el);
    if (label) svg.appendChild(s('text', { x: x + 10, y: (y0 + y1) / 2 + 4, class: 'tg-label' }, label));
    upd.push((a, b) => setClass(el, 'hot', hot(a, b)));
  };
  const led = (x: number, y: number, lit: (a: boolean, b: boolean) => boolean) => {
    // anode at y - 14, cathode at y + 14, pointing down
    const tri = s('path', { d: `M ${x - 9} ${y - 7} L ${x + 9} ${y - 7} L ${x} ${y + 7} Z`, class: 'tg-led' });
    svg.append(tri, s('line', { x1: x - 9, y1: y + 7, x2: x + 9, y2: y + 7, class: 'tg-npn' }), s('text', { x: x + 13, y: y + 4, class: 'tg-label' }, 'LED'));
    upd.push((a, b) => setClass(tri, 'lit', lit(a, b)));
  };
  /** An NPN transistor whose collector/emitter column is at x, base on the left (or right if flip). */
  const npn = (name: string, x: number, y: number, flip = false, input = '') => {
    const d = flip ? -1 : 1;
    const bar = x - 18 * d;
    const path = s('path', { d: `M ${bar - 16 * d} ${y} L ${bar} ${y} M ${bar} ${y - 12} L ${bar} ${y + 12} M ${bar} ${y - 6} L ${x} ${y - 16} L ${x} ${y - 26} M ${bar} ${y + 6} L ${x} ${y + 16} L ${x} ${y + 26} M ${x - 7 * d} ${y + 9} L ${x} ${y + 16} L ${x - 9 * d} ${y + 17}`, class: 'tg-npn' });
    const ring = s('circle', { cx: (bar + x) / 2, cy: y, r: 19, class: 'tg-npn-ring' });
    svg.append(path, ring, s('text', { x: x + 6 * d - (flip ? 22 : 0), y: y + 4, class: 'tg-label' }, name));
    if (input) {
      const bx = bar - 16 * d;
      svg.appendChild(s('text', { x: bx - 6 * d - (flip ? 0 : 10), y: y - 6, class: 'tg-label' }, input));
      wire([[bx - 20 * d, y], [bx, y]], (a, b) => (input === 'A' ? a : b));
    }
    upd.push((a, b) => setClass(path, 'on', st(a, b).on[name] === true));
    return { c: [x, y - 26] as [number, number], e: [x, y + 26] as [number, number], b: [bar - 16 * d, y] as [number, number] };
  };
  const rails = () => {
    svg.append(s('line', { x1: 10, y1: 20, x2: 310, y2: 20, class: 'tg-rail' }), s('text', { x: 12, y: 14, class: 'tg-label' }, '+5 V'));
    svg.append(s('line', { x1: 10, y1: 282, x2: 310, y2: 282, class: 'tg-rail' }), s('text', { x: 12, y: 297, class: 'tg-label' }, 'ground'));
  };
  rails();
  const always = () => true;

  if (id === 'buffer') {
    const lit = (a: boolean) => a;
    res(180, 20, 66, lit, 'R');
    led(180, 80, lit);
    const t = npn('T1', 180, 150, false, 'A');
    wire([[180, 94], t.c], lit);
    wire([t.e, [180, 282]], lit);
  } else if (id === 'inverter') {
    const ledOn = (a: boolean) => !a;
    res(150, 20, 66, always, 'R');
    wire([[150, 66], [150, 90], [240, 90], [240, 116]], ledOn);
    wire([[150, 90], [150, 124]], (a) => a);
    led(240, 130, ledOn);
    wire([[240, 144], [240, 282]], ledOn);
    const t = npn('T1', 150, 150, false, 'A');
    wire([t.e, [150, 282]], (a) => a);
    svg.appendChild(s('text', { x: 158, y: 86, class: 'tg-label' }, 'out'));
  } else if (id === 'and') {
    const lit = (a: boolean, b: boolean) => a && b;
    res(180, 20, 56, lit, 'R');
    led(180, 70, lit);
    const t1 = npn('T1', 180, 130, false, 'A');
    const t2 = npn('T2', 180, 210, false, 'B');
    wire([[180, 84], t1.c], lit);
    wire([t1.e, t2.c], lit);
    wire([t2.e, [180, 282]], lit);
  } else if (id === 'or') {
    const lit = (a: boolean, b: boolean) => a || b;
    res(180, 20, 56, lit, 'R');
    led(180, 70, lit);
    wire([[180, 84], [180, 112]], lit);
    wire([[100, 112], [260, 112]], lit);
    const t1 = npn('T1', 100, 170, false, 'A');
    const t2 = npn('T2', 260, 170, false, 'B');
    wire([[100, 112], t1.c], (a) => a);
    wire([[260, 112], t2.c], (_a, b) => b);
    wire([t1.e, [100, 282]], (a) => a);
    wire([t2.e, [260, 282]], (_a, b) => b);
  } else {
    // xor: the OR pair through T3, and T4 + T5 holding T3's base
    const t3on = (a: boolean, b: boolean) => !(a && b);
    const lit = (a: boolean, b: boolean) => (a || b) && t3on(a, b);
    res(110, 20, 50, lit, 'R1');
    led(110, 64, lit);
    wire([[110, 78], [110, 96]], lit);
    wire([[60, 96], [160, 96]], lit);
    const t1 = npn('T1', 60, 140, false, 'A');
    const t2 = npn('T2', 160, 140, false, 'B');
    wire([[60, 96], t1.c], (a, b) => a && t3on(a, b));
    wire([[160, 96], t2.c], (a, b) => b && t3on(a, b));
    wire([t1.e, [60, 184], [160, 184]], (a, b) => a && t3on(a, b));
    wire([t2.e, [160, 184]], (a, b) => b && t3on(a, b));
    wire([[110, 184], [110, 204]], lit);
    const t3 = npn('T3', 110, 230, true);
    wire([t3.e, [110, 282]], lit);
    // T3's base: R2 from +5 V; T4 and T5 in series to ground (inputs A and B)
    res(270, 20, 56, always, 'R2');
    wire([[270, 56], [270, 70]], always);
    wire([[270, 70], [200, 70], [200, 230], t3.b], t3on);
    const t4 = npn('T4', 270, 120, true, 'A');
    const t5 = npn('T5', 270, 196, true, 'B');
    wire([[270, 70], t4.c], (a, b) => a && b);
    wire([t4.e, t5.c], (a, b) => a && b);
    wire([t5.e, [270, 282]], (a, b) => a && b);
  }
  return { el: svg, update: (a, b) => upd.forEach((f) => f(a, b)) };
}

const EXPLAIN: Record<GateId, (a: boolean, b: boolean) => string> = {
  buffer: (a) => `A ${a ? 'on: current flows from the base to the emitter, so T1 switches on and the much larger current through the resistor and the LED flows from its collector to its emitter. The LED is lit.' : 'off: no base current, T1 is off and the LED circuit is open.'} The output follows the input: a buffer.`,
  inverter: (a) => (a ? 'A on: T1 switches on and pulls the node under the resistor to ground, so there is no voltage across the LED and it goes out.' : 'A off: T1 is off, so current flows through the resistor and the LED to ground: the LED is lit.') + ' The output is the opposite of the input: an inverter (NOT).',
  and: (a, b) => (a && b ? 'Both on: T1 and T2 in series complete the path from the LED to ground.' : 'The two transistors are in series, so one that is off breaks the path: the LED needs A and B.') + ' An AND gate.',
  or: (a, b) => (a || b ? `${a && b ? 'Both are' : a ? 'T1 is' : 'T2 is'} on, and either path to ground lights the LED.` : 'Both off: neither transistor gives the LED a path to ground.') + ' The transistors are in parallel: an OR gate.',
  xor: (a, b) =>
    a && b
      ? 'A and B both on: T4 and T5 in series ground T3’s base, which switches T3 off. With T3 off, the OR pair has no way to ground (5 V on both sides of the LED), so the LED is off.'
      : a || b
        ? 'One input on: T3 is on, because R2 drives its base and T4 and T5 aren’t both on, so the OR pair reaches ground through it and the LED is lit.'
        : 'Both off: T3 is on, but neither T1 nor T2 conducts, so the LED is off.',
};

export default defineLab({
  id: 'transistor-gates',
  title: 'From semiconductors to logic gates',
  summary:
    'Before the 8-bit computer Ben explained what the gates in the 74LS chips are made of. Pure silicon doesn’t conduct; doped with phosphorus it has spare electrons (N-type), with boron it has holes (P-type). Where N meets P, electrons fill the nearby holes and leave a depletion region with no charge carriers: a diode, which conducts once about 0.6 V pushes the right way. An NPN transistor (emitter, a very thin base, collector) is a current-controlled switch: a small current from base to emitter lets a much larger one flow from collector to emitter. Wire transistors in series and in parallel and you get gates.',
  mount(root) {
    const d = new Disposer();
    const wrap = h('div', { class: 'tg-lab' });
    root.appendChild(wrap);
    d.add(injectStyle(wrap, CSS));

    // ---- inside the silicon ----
    const siSvg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'silicon', role: 'img', 'aria-label': 'charge carriers in doped silicon' });
    const si = siliconView(siSvg);
    let mode: Silicon = 'diode', volts = 0;
    const siText = callout();
    const vSlider = new Slider({ label: 'Battery', min: -3, max: 1, step: 0.05, value: 0, format: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} V ${v > 0 ? '(+ on P: forward)' : v < 0 ? '(+ on N: reverse)' : ''}`, onInput: (v) => { volts = v; si.setV(v); } });
    const baseToggle = new Toggle({ label: 'Small current into the base', value: false, onChange: (v) => si.setBase(v) });
    const siControls = row(vSlider.el);
    const npnControls = row(baseToggle.el);
    npnControls.style.display = 'none';
    const modeSel = select<Silicon>([{ value: 'diode', label: 'A PN junction (a diode)' }, { value: 'npn', label: 'An NPN transistor' }], mode, (v) => {
      mode = v;
      si.setMode(v);
      si.setV(volts);
      si.setBase(baseToggle.value);
      siControls.style.display = v === 'diode' ? '' : 'none';
      npnControls.style.display = v === 'npn' ? '' : 'none';
    }, 'Show');

    // ---- the gates ----
    let gid: GateId = 'buffer', a = false, b = false;
    const gateHost = h('div');
    const tableHost = h('div');
    const gateText = callout();
    let drawn = drawGate(gid);
    let table = truthTable(['A', 'out'], []);
    const aT = new Toggle({ label: 'A (button)', value: false, onChange: (v) => { a = v; refresh(); } });
    const bT = new Toggle({ label: 'B (button)', value: false, onChange: (v) => { b = v; refresh(); } });
    const rebuild = () => {
      const g = GATES.find((x) => x.id === gid)!;
      drawn = drawGate(gid);
      gateHost.replaceChildren(drawn.el);
      table = truthTable(g.inputs === 1 ? ['A', 'out'] : ['A', 'B', 'out'], truthRows(gid).map((r) => r.map(String)));
      tableHost.replaceChildren(table.el);
      bT.el.style.display = g.inputs === 2 ? '' : 'none';
      refresh();
    };
    const refresh = () => {
      const g = GATES.find((x) => x.id === gid)!;
      const bb = g.inputs === 2 && b;
      drawn.update(a, bb);
      table.set(g.inputs === 1 ? Number(a) : Number(a) * 2 + Number(bb));
      setText(gateText, EXPLAIN[gid](a, bb));
    };
    const gateSel = select<GateId>(GATES.map((g) => ({ value: g.id, label: `${g.title}${g.transistors > 1 ? '' : ''}` })), gid, (v) => { gid = v; rebuild(); }, 'Gate');
    rebuild();

    d.add(
      animate((dt) => {
        si.tick(Math.min(dt, 50) / 1000);
        const dep = depletion(volts);
        setText(
          siText,
          mode === 'npn'
            ? baseToggle.value
              ? 'With a small current into the base (its junction with the emitter forward biased past about 0.7 V), that junction’s depletion region collapses. The emitter is heavily doped, so electrons pour into the base, and because the base is so thin, nearly all of them (about 99 %) are pulled across by the positive charge of the base-collector junction and carry on into the collector. A small base current turns on a large current through the transistor.'
              : 'With the battery only across emitter and collector, one of the two PN junctions is always the wrong way round, so its depletion region blocks: no current. The transistor is off.'
            : volts >= 0.6
              ? 'Above about 0.6 V forward (+ on the P side), the electrons pushed into the N side and the holes into the P side squeeze the depletion region away, and current flows all the way through.'
              : volts > 0
                ? `Forward, but below about 0.6 V: the depletion region narrows (${Math.round(dep * 100)} % of its width), but it still has no charge carriers, so no current flows yet.`
                : volts < 0
                  ? 'Reversed (+ on the N side): the battery pulls the electrons and holes away from the junction, so the depletion region gets wider and nothing flows. A diode lets current through one way only.'
                  : 'No battery: near the junction electrons from the N side have filled the holes on the P side, leaving a thin region with no charge carriers (and a slight + charge on the N side, − on the P side). Drag the battery voltage.',
        );
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-stack' },
        panel(
          'Inside the silicon',
          { accent: 'blue', subtitle: 'blue dots: electrons · red rings: holes · dashed: the depletion region' },
          row(modeSel),
          siControls,
          npnControls,
          siSvg,
          siText,
          note('Silicon has four outer electrons, all tied up in bonds with its neighbours, so pure silicon is an insulator. Phosphorus has five (an extra electron free to wander: N-type) and boron three (a hole that a neighbour’s electron can jump into, so the hole seems to move: P-type). Neither is charged overall: the extra electron comes with an extra proton. The diode symbol’s arrow points the way conventional current flows, from + to −, although the electrons go the other way. As long as you stick to one convention it doesn’t matter.'),
        ),
        panel(
          'Gates from transistors',
          { accent: 'green', chips: 'NPN transistors · a resistor and push button into each base · an LED with its resistor' },
          row(gateSel, aT.el, bT.el),
          h('div', { class: 'lab-grid two' }, gateHost, h('div', null, tableHost, gateText)),
          note('There are gates for every combination: NAND, NOR and XNOR are AND, OR and XOR with the output inverted, shown by a bubble on the symbol. The 74LS chips in Ben’s computer are full of them, and from gates you can build adders, memory and a whole computer.'),
        ),
      ),
    );
    return d.dispose;
  },
});
