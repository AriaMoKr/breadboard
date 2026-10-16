import { Button, note, panel, row } from '../../ui/components';
import { Disposer, animate, h, media, s, setClass, setText } from '../../ui/dom';
import { levelClass } from '../../ui/schematic';
import { defineLab } from '../types';
import { BUS_MODULES, busControlWord, busModuleOutput, clockBus, resolveBus, type BusModuleId, type BusRegId, type BusTransfer, type BusValues } from './_model';
import { Checklist, bin8, labFrame, levelLegend } from './_shared';

/**
 * Video 9 — "Bus architecture and how register transfers work".
 * A conceptual 8-bit bus with six modules. Each has a LOAD ("…I") and/or an
 * ENABLE ("…O") control. One output + any inputs + a clock pulse = a transfer,
 * animated as a packet travelling along the bus.
 */

/**
 * Touch screens: the input switches sit in two rows of four (high nibble on top), twice as far
 * apart, so a fingertip hits one switch. The switch box grows and the rows below move down.
 */
const TOUCH = media('(pointer: coarse)')?.matches ?? false;
const SW_ROW = TOUCH ? 34 : 0; // the second row of switches
const SW_PITCH = TOUCH ? 32 : 16;
const W = 400, H = 444 + SW_ROW;
const BUS_X = 200;
const busLineX = (bit: number) => 186 + (7 - bit) * 4;
const ROW_Y = [28, 168 + SW_ROW, 308 + SW_ROW];
const BOX_W = 150, BOX_H = 112;
const LAYOUT: Record<BusModuleId, { side: 'l' | 'r'; row: number }> = {
  sw: { side: 'l', row: 0 },
  ir: { side: 'l', row: 1 },
  out: { side: 'l', row: 2 },
  a: { side: 'r', row: 0 },
  sum: { side: 'r', row: 1 },
  b: { side: 'r', row: 2 },
};
const boxX = (id: BusModuleId) => (LAYOUT[id].side === 'l' ? 8 : 242);
const midY = (id: BusModuleId) => ROW_Y[LAYOUT[id].row] + 56;
const edgeX = (id: BusModuleId) => (LAYOUT[id].side === 'l' ? 158 : 242);
const ANIM_MS = 750;

const CSS = `
.bt-svg .bt-box { fill: var(--panel); stroke: var(--border); stroke-width: 1.5; transition: stroke 0.15s; }
.bt-svg .bt-box.drive { stroke: var(--wire-1); stroke-width: 2.5; }
.bt-svg .bt-box.load { stroke: var(--ok); stroke-width: 2.5; }
.bt-svg .bt-box.flash { fill: color-mix(in srgb, var(--accent-2) 22%, var(--panel)); }
.bt-svg .bt-title { fill: var(--fg); font: 600 13px var(--sans); }
.bt-svg .bt-val { fill: var(--fg-dim); font: 11.5px var(--mono); }
.bt-svg .bt-small { fill: var(--fg-faint); font: 10px var(--mono); }
.bt-svg .bt-led { fill: var(--led-off); stroke: rgba(0,0,0,.35); stroke-width: 1; }
.bt-svg .bt-led.on { fill: var(--led-red); }
.bt-svg .bt-led.blue.on { fill: var(--led-blue); }
.bt-svg .bt-led.yellow.on { fill: var(--led-yellow); }
.bt-svg .bt-sw { cursor: pointer; }
.bt-svg .bt-sw rect.hit { fill: transparent; }
.bt-svg .bt-sw rect.body { fill: #c0392b; }
.bt-svg .bt-sw rect.knob { fill: #f4f4f4; transition: y 0.1s; }
.bt-svg .bt-sw:focus-visible rect.body { stroke: var(--accent); stroke-width: 2; }
.bt-svg .bt-pill { cursor: pointer; }
.bt-svg .bt-pill rect { fill: var(--panel-2); stroke: var(--fg-faint); stroke-width: 1.2; }
.bt-svg .bt-pill text { fill: var(--fg-dim); font: 700 12px var(--mono); pointer-events: none; }
.bt-svg .bt-pill.on rect { fill: var(--led-blue); stroke: var(--led-blue); }
.bt-svg .bt-pill.on text { fill: #fff; }
.bt-svg .bt-pill:focus-visible rect { stroke: var(--accent); stroke-width: 2.5; }
.bt-svg .bt-stub { stroke: var(--grid); stroke-width: 8; stroke-linecap: butt; }
.bt-svg .bt-stub.drive { stroke: var(--wire-1); }
.bt-svg .bt-stub.load { stroke: var(--ok); }
.bt-svg .bt-stub.x { stroke: var(--wire-x); }
.bt-svg .bt-arrow { fill: var(--fg); opacity: 0; }
.bt-svg .bt-arrow.show { opacity: 0.9; }
.bt-svg .bt-packet rect { fill: var(--accent-2); stroke: rgba(0,0,0,.35); }
.bt-svg .bt-packet.bad rect { fill: var(--wire-x); }
.bt-svg .bt-packet text { fill: #1a1300; font: 700 11px var(--mono); }
.bt-svg .bt-warn { fill: var(--wire-x); font: 700 12px var(--sans); }
.bt-ctl { font-family: var(--mono); font-size: 1.15rem; font-weight: 700; }
`;

export default defineLab({
  id: 'bus-transfers',
  title: 'Bus architecture and register transfers',
  summary:
    'Every module of the computer hangs off the same 8 bus wires. Each one has a LOAD control (read the bus on the next clock edge) and an ENABLE control (put my value on the bus). A transfer is: enable exactly one output, enable one or more loads, pulse the clock. Click the signal buttons on the modules, then press Clock and watch the value travel. Ben later names these signals AI/AO, BI, II/IO, EO, OI.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d, CSS);

    let vals: BusValues = { sw: 42, a: 0, b: 0, ir: 0, out: 0 };
    const outs = new Set<BusModuleId>();
    const ins = new Set<BusModuleId>();
    const flash = new Map<BusRegId, number>();
    let anim: { t: number; next: BusValues; transfers: BusTransfer[]; packets: { g: SVGGElement; pts: [number, number][] }[]; outs: BusModuleId[] } | null = null;
    const log: { text: string; bad: boolean }[] = [];

    // ---- SVG ----
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'schematic bt-svg', role: 'img', 'aria-label': 'Bus with six modules', style: `--sch-w: ${W}` });
    svg.style.maxWidth = `${W + 60}px`;
    const gStubs = s('g');
    const gBus = s('g');
    const gBoxes = s('g');
    const gTop = s('g');
    svg.append(gStubs, gBus, gBoxes, gTop);

    // bus lines
    const busLines = Array.from({ length: 8 }, (_, bit) => {
      const ln = s('line', { x1: busLineX(bit), y1: 18, x2: busLineX(bit), y2: H - 10, class: 'wire lz' });
      gBus.appendChild(ln);
      return ln;
    });
    gBus.appendChild(s('text', { x: BUS_X, y: 11, 'text-anchor': 'middle', class: 'bt-small' }, 'BUS  7 … 0'));
    const warnText = s('text', { x: BUS_X, y: H - 1, 'text-anchor': 'middle', class: 'bt-warn' }, '');
    gTop.appendChild(warnText);

    interface ModView {
      box: SVGRectElement;
      leds: SVGElement[];
      val: SVGTextElement;
      stub: SVGLineElement;
      arrowOut: SVGPolygonElement;
      arrowIn: SVGPolygonElement;
      pills: { kind: 'in' | 'out'; g: SVGGElement }[];
    }
    const views = new Map<BusModuleId, ModView>();
    /** Top of each input switch (its row), for placing the knob. */
    const swTop = new Map<SVGElement, number>();

    const pill = (x: number, y: number, label: string, onClick: () => void) => {
      const g = s('g', { class: 'bt-pill', tabindex: 0, role: 'button', 'aria-pressed': 'false', 'aria-label': label });
      g.append(s('rect', { x, y, width: 56, height: 22, rx: 11 }), s('text', { x: x + 28, y: y + 15.5, 'text-anchor': 'middle' }, label));
      g.addEventListener('click', onClick);
      g.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === ' ' || k === 'Enter') { e.preventDefault(); onClick(); }
      });
      return g;
    };

    for (const m of BUS_MODULES) {
      const x = boxX(m.id), y = ROW_Y[LAYOUT[m.id].row];
      const extra = m.id === 'sw' ? SW_ROW : 0; // the switch box's second row (touch screens)
      const box = s('rect', { x, y, width: BOX_W, height: BOX_H + extra, rx: 8, class: 'bt-box' });
      gBoxes.appendChild(box);
      gBoxes.appendChild(s('text', { x: x + 9, y: y + 18, class: 'bt-title' }, m.name));
      const leds: SVGElement[] = [];
      for (let i = 0; i < 8; i++) {
        const bit = 7 - i;
        const cx = x + 18 + i * 16 + (i >= 4 ? 4 : 0);
        if (m.id === 'sw') {
          const g = s('g', { class: 'bt-sw', tabindex: 0, role: 'button', 'aria-label': `switch bit ${bit}` });
          const sx = TOUCH ? x + 18 + (i % 4) * SW_PITCH : cx;
          const sy = TOUCH && i >= 4 ? y + SW_ROW : y; // touch: bits 3-0 on a second row
          swTop.set(g, sy);
          // hit: the switch's whole slot and a bit above and below, for fingertips
          g.append(s('rect', { x: sx - SW_PITCH / 2, y: sy + 22, width: SW_PITCH, height: 32, class: 'hit' }), s('rect', { x: sx - 6, y: sy + 28, width: 12, height: 20, rx: 2, class: 'body' }), s('rect', { x: sx - 4, y: sy + 38, width: 8, height: 8, rx: 1, class: 'knob' }));
          const flip = () => {
            if (anim) return;
            vals = { ...vals, sw: vals.sw ^ (1 << bit) };
            render();
          };
          g.addEventListener('click', flip);
          g.addEventListener('keydown', (e) => {
            const k = (e as KeyboardEvent).key;
            if (k === ' ' || k === 'Enter') { e.preventDefault(); flip(); }
          });
          gBoxes.appendChild(g);
          leds.push(g);
        } else {
          const color = m.id === 'ir' ? (bit >= 4 ? 'blue' : 'yellow') : '';
          const c = s('circle', { cx, cy: y + 38, r: 6, class: `bt-led ${color}` });
          gBoxes.appendChild(c);
          leds.push(c);
        }
      }
      const val = s('text', { x: x + 9, y: y + 66 + extra, class: 'bt-val' }, '');
      gBoxes.appendChild(val);
      // stub to the bus
      const ex = edgeX(m.id), my = midY(m.id);
      const bx = LAYOUT[m.id].side === 'l' ? busLineX(7) - 3 : busLineX(0) + 3;
      const stub = s('line', { x1: ex, y1: my, x2: bx, y2: my, class: 'bt-stub' });
      gStubs.appendChild(stub);
      const dir = LAYOUT[m.id].side === 'l' ? 1 : -1; // +1: pointing right
      const ax = (ex + bx) / 2;
      const tri = (pointRight: boolean) => s('polygon', { points: pointRight ? `${ax - 5},${my - 6} ${ax + 5},${my} ${ax - 5},${my + 6}` : `${ax + 5},${my - 6} ${ax - 5},${my} ${ax + 5},${my + 6}`, class: 'bt-arrow' });
      const arrowOut = tri(dir === 1);
      const arrowIn = tri(dir !== 1);
      gTop.append(arrowOut, arrowIn);
      // control pills
      const pills: ModView['pills'] = [];
      const py = y + 80 + extra;
      const sigs: { kind: 'in' | 'out'; label: string }[] = [];
      if (m.inSig) sigs.push({ kind: 'in', label: m.inSig });
      if (m.outSig) sigs.push({ kind: 'out', label: m.id === 'b' ? 'BO*' : m.id === 'sw' ? 'ON BUS' : m.outSig });
      sigs.forEach((sg, i) => {
        const px = sigs.length === 1 ? x + 9 : x + 9 + i * 68;
        const width = sg.label.length > 4 ? 76 : 56;
        const g = pill(px, py, sg.label, () => {
          if (anim) return;
          const set = sg.kind === 'in' ? ins : outs;
          if (set.has(m.id)) set.delete(m.id); else set.add(m.id);
          render();
        });
        (g.firstChild as SVGRectElement).setAttribute('width', String(width));
        (g.lastChild as SVGTextElement).setAttribute('x', String(px + width / 2));
        g.appendChild(s('title', null, sg.kind === 'in' ? `${sg.label}: load from the bus on the next clock edge` : `${sg.label}: drive this module's value onto the bus`));
        gTop.appendChild(g);
        pills.push({ kind: sg.kind, g });
      });
      views.set(m.id, { box, leds, val, stub, arrowOut, arrowIn, pills });
    }

    // ---- HTML controls ----
    const ctlWord = h('span', { class: 'bt-ctl' });
    const status = h('div', { class: 'callout' });
    const logEl = h('ol', { class: 'dp-log' });
    const clockBtn = new Button({ label: 'Clock pulse ⎍', kind: 'primary', title: 'Rising edge: every module with its load enabled latches the bus', onClick: () => pulse() });
    const allOff = new Button({ label: 'All controls off', onClick: () => { if (anim) return; outs.clear(); ins.clear(); render(); } });
    const resetBtn = new Button({ label: 'Clear registers', kind: 'danger', onClick: () => { if (anim) return; vals = { ...vals, a: 0, b: 0, ir: 0, out: 0 }; render(); } });

    const checklist = new Checklist([
      { title: 'Load the switch value into A.', detail: 'Turn on the switches’ bus driver and AI, then pulse the clock.' },
      { title: 'Copy A into B with one clock pulse.', detail: 'Turn the switches off the bus first. Only A may drive: AO + BI.' },
      { title: 'One output, several inputs: load the same value into A, B and the output in a single pulse.' },
      { title: 'Show A + B on the output register.', detail: 'The ALU is always adding; EO just connects its result to the bus. EO + OI.' },
      { title: 'Load the IR with something ≥ 16 (e.g. 0010 1111), then copy IR into A.', detail: 'Watch which bits arrive: IO only drives the low 4 bits.' },
      { title: 'Accumulate: EO + AI. A takes A + B on the edge. Pulse a few times.' },
    ]);

    const name = (id: BusModuleId) => BUS_MODULES.find((m) => m.id === id)!.name;
    const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

    const loaders = () => [...ins].filter((id) => BUS_MODULES.find((m) => m.id === id)?.inSig) as BusRegId[];
    const drivers = () => [...outs].filter((id) => BUS_MODULES.find((m) => m.id === id)?.outSig);

    function describe() {
      const bus = resolveBus(vals, drivers());
      const L = loaders(), D = drivers();
      setClass(status, 'warn', bus.contention);
      if (anim) {
        setText(status, `Rising clock edge: ${list(anim.transfers.map((t) => name(t.to)))} ${anim.transfers.length === 1 ? 'latches' : 'latch'} ${bus.value} from the bus.`);
        return;
      }
      if (bus.contention) {
        setText(status, `${list(D.map(name))} are ${D.length === 2 ? 'both' : 'all'} driving the bus at once. Where their bits disagree (orange wires) one output pulls the line up to +5 V while the other pulls it down to ground: a short circuit, and the wire is neither a valid 0 nor a valid 1. Turn all outputs but one off. (If you clock now, the receivers latch whatever the fight produces; on LS-TTL the low side usually wins.)`);
        return;
      }
      if (!D.length && !L.length) {
        setText(status, 'Nothing is enabled, so no one drives the bus and its wires float (dashed). Pick one module to drive the bus (an …O signal) and one or more to load from it (…I), then press Clock.');
        return;
      }
      if (!D.length) {
        setText(status, `${list(L.map(name))} will load from a bus that nobody is driving. Floating LS-TTL inputs read as 1, so the clock would latch 1111 1111. Enable an output too.`);
        return;
      }
      const v = bus.value;
      const extra = D[0] === 'ir' ? ' The IR only drives its low 4 bits; its 74LS245 drives bits 7-4 as 0.' : D[0] === 'sum' ? ' The ALU output is just A + B, worked out continuously; EO connects it to the bus.' : '';
      if (!L.length) {
        setText(status, `${name(D[0])} drives ${v} (${bin8(v)}) onto the bus. Every module can see it, but nothing changes until a load signal is on at a clock edge.${extra}`);
        return;
      }
      setText(status, `Control word ${busControlWord(D, L)}: on the next rising clock edge ${list(L.map(name))} ${L.length === 1 ? 'loads' : 'load'} ${v} (${bin8(v)}) from ${name(D[0])}. Press Clock.${extra}`);
    }

    function render() {
      const D = drivers(), L = loaders();
      const bus = resolveBus(vals, D);
      bus.levels.forEach((lv, bit) => {
        const ln = busLines[bit];
        ln.classList.remove('l0', 'l1', 'lz', 'lx');
        ln.classList.add(levelClass(lv));
      });
      setText(warnText, bus.contention ? '⚠ bus contention' : '');
      for (const m of BUS_MODULES) {
        const v = views.get(m.id)!;
        const value = m.id === 'sum' ? busModuleOutput('sum', vals) : vals[m.id as BusRegId];
        v.leds.forEach((el, i) => {
          const on = ((value >> (7 - i)) & 1) === 1;
          if (m.id === 'sw') {
            const knob = el.lastChild as SVGRectElement;
            knob.setAttribute('y', String(swTop.get(el)! + (on ? 30 : 38)));
            el.setAttribute('aria-pressed', String(on));
          } else setClass(el, 'on', on);
        });
        const text = m.id === 'sum' ? `= ${vals.a} + ${vals.b} → ${value}` : m.id === 'out' ? `display: ${value}` : `${value}  ${bin8(value)}`;
        setText(v.val, text);
        const driving = D.includes(m.id), loading = L.includes(m.id as BusRegId);
        setClass(v.box, 'drive', driving);
        setClass(v.box, 'load', loading && !driving);
        setClass(v.box, 'flash', (flash.get(m.id as BusRegId) ?? 0) > 0);
        setClass(v.stub, 'drive', driving && !bus.contention);
        setClass(v.stub, 'x', driving && bus.contention);
        setClass(v.stub, 'load', loading && !driving);
        setClass(v.arrowOut, 'show', driving);
        setClass(v.arrowIn, 'show', loading && !driving);
        for (const p of v.pills) {
          const on = p.kind === 'in' ? ins.has(m.id) : outs.has(m.id);
          setClass(p.g, 'on', on);
          p.g.setAttribute('aria-pressed', String(on));
        }
      }
      setText(ctlWord, busControlWord(D, L));
      logEl.replaceChildren(...log.slice(-8).map((e) => h('li', { class: e.bad ? 'bad' : '' }, e.text)));
      clockBtn.setDisabled(!!anim);
      describe();
    }

    function packetPath(from: BusModuleId | null, to: BusRegId): [number, number][] {
      const ty = midY(to), tx = edgeX(to);
      if (from === null) return [[BUS_X, 20], [BUS_X, ty], [tx, ty]];
      const fy = midY(from), fx = edgeX(from);
      return [[fx, fy], [BUS_X, fy], [BUS_X, ty], [tx, ty]];
    }

    function pulse() {
      if (anim) return;
      const D = drivers();
      const r = clockBus(vals, D, loaders());
      if (!r.transfers.length) {
        log.push({ text: `clock: ${busControlWord(D, [])} → nothing loads`, bad: false });
        render();
        return;
      }
      const bad = r.bus.contention || r.bus.floating;
      const packets = r.transfers.map((t) => {
        const g = s('g', { class: `bt-packet ${bad ? 'bad' : ''}` });
        g.append(s('rect', { x: -36, y: -10, width: 72, height: 20, rx: 10 }), s('text', { x: 0, y: 4, 'text-anchor': 'middle' }, (t.value & 0xff).toString(2).padStart(8, '0')));
        gTop.appendChild(g);
        const pts = packetPath(D[0] ?? null, t.to);
        g.setAttribute('transform', `translate(${pts[0][0]},${pts[0][1]})`);
        return { g, pts };
      });
      anim = { t: 0, next: r.values, transfers: r.transfers, packets, outs: D };
      for (const t of r.transfers) {
        log.push({
          text: `${busControlWord(D, [t.to])}: ${name(t.to)} ← ${t.value} (${bin8(t.value)})${r.bus.contention ? ' garbage from contention' : r.bus.floating ? ' floating bus' : ''}`,
          bad,
        });
      }
      render();
    }

    function pointAt(pts: [number, number][], t: number): [number, number] {
      const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
      const total = seg.reduce((a, b) => a + b, 0) || 1;
      let dist = Math.min(1, Math.max(0, t)) * total;
      for (let i = 0; i < seg.length; i++) {
        if (dist <= seg[i] || i === seg.length - 1) {
          const f = seg[i] ? Math.min(1, dist / seg[i]) : 1;
          return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
        }
        dist -= seg[i];
      }
      return pts[pts.length - 1];
    }

    function checkChallenges(tr: BusTransfer[], before: BusValues) {
      const single = tr.length > 0 && tr[0].from.length === 1;
      const from = single ? tr[0].from[0] : null;
      const to = new Set(tr.map((t) => t.to));
      if (from === 'sw' && to.has('a')) checklist.complete(0);
      if (from === 'a' && to.has('b')) checklist.complete(1);
      if (single && to.has('a') && to.has('b') && to.has('out')) checklist.complete(2);
      if (from === 'sum' && to.has('out')) checklist.complete(3);
      if (from === 'ir' && to.has('a') && before.ir >= 16) checklist.complete(4);
      if (from === 'sum' && to.has('a') && before.b !== 0) checklist.complete(5);
    }

    d.add(
      animate((dt) => {
        let dirty = false;
        for (const [k, v] of flash) {
          const nv = v - dt;
          if (nv <= 0) { flash.delete(k); dirty = true; } else flash.set(k, nv);
        }
        if (anim) {
          anim.t += dt / ANIM_MS;
          for (const p of anim.packets) {
            const [x, y] = pointAt(p.pts, anim.t);
            p.g.setAttribute('transform', `translate(${x},${y})`);
          }
          if (anim.t >= 1) {
            const before = vals;
            vals = anim.next;
            for (const t of anim.transfers) flash.set(t.to, 450);
            for (const p of anim.packets) p.g.remove();
            const tr = anim.transfers;
            anim = null;
            checkChallenges(tr, before);
            dirty = true;
          }
        }
        if (dirty) render();
      }),
    );
    d.add(() => anim?.packets.forEach((p) => p.g.remove()));

    // ---- signal reference table ----
    const sigTable = h(
      'table',
      { class: 'truth-table compact' },
      h('thead', null, h('tr', null, ['Module', 'Load (in)', 'Enable (out)'].map((x) => h('th', null, x)))),
      h(
        'tbody',
        null,
        BUS_MODULES.filter((m) => m.id !== 'sw').map((m) => h('tr', null, h('td', { style: 'text-align:left' }, m.name), h('td', null, m.inSig ?? '—'), h('td', null, m.id === 'b' ? 'BO*' : (m.outSig ?? '—')))),
      ),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('The bus', { accent: 'red', subtitle: '8 shared wires' }, svg, levelLegend(), row(clockBtn.el, allOff.el, resetBtn.el), note('Click a module’s buttons to enable its load (…I) or its output (…O). Click the red switches to change the switch value.')),
        h(
          'div',
          { class: 'lab-stack' },
          panel('What happens now', { accent: 'gray' }, h('div', null, h('span', { class: 'dim small' }, 'Control word: '), ctlWord), status),
          panel('Try it', { accent: 'yellow' }, checklist.el),
          panel('Transfers', { accent: 'gray' }, logEl),
          panel(
            'Signal names used later',
            { accent: 'blue' },
            sigTable,
            note('* In the finished computer B never drives the bus: its 74LS245 is permanently disabled, so there is no BO signal. The IR’s output (IO) only carries the low 4 bits (the operand); the top 4 bits go to the control logic.'),
            note('Loading is edge-triggered: values only move on the rising edge of the clock, so it’s fine for a register to read the bus while the ALU it feeds is changing.'),
          ),
        ),
      ),
    );
    render();
    return d.dispose;
  },
});
