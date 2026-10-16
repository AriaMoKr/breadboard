import { Machine } from '../../sim/machine';
import { AI, EO, SU, formatControlWord } from '../../sim/signals';
import { Button, LedBar, note, panel, row } from '../../ui/components';
import { ComputerView } from '../../ui/computer-view';
import { Disposer, animate, h, setClass, setText } from '../../ui/dom';
import { defineLab } from '../types';
import { Checklist, controlJumpers, labFrame, onRisingEdge } from '../registers/_shared';
import { aluDetail, latchRace, toBinSpaced, toSigned } from './_model';

/**
 * Video 18 — "Testing the computer's ALU".
 * A, ALU and B on the bus. With EO + AI the ALU result goes back into A on
 * every rising edge, so A counts by B (or down with SU).
 */

const sg = (v: number) => (v < 0 ? `−${-v}` : `${v}`);

export default defineLab({
  id: 'alu-test',
  title: 'Testing the ALU',
  summary:
    'Now the ALU’s 74LS245 joins the bus. Load A and B from the switches, then turn on EO (Σ out) and AI together: every clock pulse loads A + B back into A, so A counts up by B. Turn on SU and it counts down. This only works because the registers are edge-triggered: the ALU recomputes immediately, but A only takes a new value at the instant the clock rises.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d);

    const machine = new Machine();
    const c = machine.computer;
    c.busInput = 2;
    c.pullDowns = false; // the bus pull-downs only arrive in video 34
    const view = new ComputerView(machine, { modules: ['clock', 'bus', 'a', 'alu', 'b'], manualControl: true, busInput: true });
    d.add(() => view.dispose());
    const jumpers = controlJumpers(machine, ['AI', 'AO', 'BI', 'EO', 'SU']);
    d.add(jumpers.dispose);

    const pulse = new Button({ label: 'Clock pulse', kind: 'primary', onClick: () => machine.pulse() });
    const allOff = new Button({ label: 'All lines off', onClick: () => { c.setManualControl(0); machine.changed(); } });
    const status = h('div', { class: 'callout' });

    const checklist = new Checklist([
      { title: 'Load a starting value into A from the switches.', detail: 'Drive bus on, AI on, pulse the clock.' },
      { title: 'Load B from the switches.', detail: 'Ben uses a small number. Turn AI off, BI on, pulse.' },
      { title: 'Count up: switches off the bus, then EO + AI. Pulse at least 3 times.', detail: 'Each pulse: A ← A + B.' },
      { title: 'Count down: also turn on SU. Pulse at least twice.', detail: 'Each pulse: A ← A − B.' },
      { title: 'Let it run: switch the clock to Auto and watch A wrap past 255 ↔ 0.' },
    ]);
    const done = h('div', { class: 'callout good', style: 'display:none' }, 'The ALU works on the computer: it adds and subtracts B and feeds the result back through the bus into A, one step per clock edge.');

    // ---- live equation ----
    const eq = h('table', { class: 'dp-sum' });
    const next = h('div', { class: 'callout' });
    const log: string[] = [];
    const logEl = h('ol', { class: 'dp-log' });

    let upCount = 0, downCount = 0;
    let prevA = c.a;
    d.add(
      onRisingEdge(machine, (tr, edges) => {
        const fromAlu = tr.some((t) => t.signal === 'AI' && t.from === 'alu');
        const sub = c.has(SU);
        if (tr.some((t) => t.signal === 'AI' && t.from === 'input')) checklist.complete(0);
        if (tr.some((t) => t.signal === 'BI' && t.from === 'input' && t.value !== 0)) checklist.complete(1);
        if (fromAlu) {
          if (sub) { downCount += edges; upCount = 0; } else { upCount += edges; downCount = 0; }
          if (upCount >= 3 && checklist.done[1]) checklist.complete(2);
          if (downCount >= 2 && checklist.done[2]) checklist.complete(3);
          const wrapped = sub ? c.a > prevA : c.a < prevA;
          if (wrapped && machine.mode === 'auto' && machine.running && checklist.done[3]) checklist.complete(4);
          log.push(`edge: A ${prevA} → ${c.a}${edges > 1 ? ` (${edges} edges)` : ''}${wrapped ? (sub ? ' · wrapped below 0' : ' · wrapped past 255') : ''}; Σ now ${c.alu.value}`);
        } else if (tr.length) {
          log.push(tr.map((t) => `${t.signal}: ${t.to.toUpperCase()} ← ${t.value}`).join(', '));
        } else log.push('edge: no load line on, nothing changes');
        if (log.length > 60) log.splice(0, log.length - 60);
        prevA = c.a;
      }),
    );

    const update = () => {
      const su = c.has(SU);
      const det = aluDetail(c.a, c.b, su);
      const cell = (t: string, cls = '') => h('td', { class: cls }, t);
      eq.replaceChildren(
        h('tr', null, cell('A', 'dim'), cell(''), cell(toBinSpaced(c.a, 8)), cell(String(c.a)), cell(sg(toSigned(c.a)), 'dim')),
        h('tr', null, cell(su ? 'NOT B' : 'B', 'dim'), cell('+'), cell(toBinSpaced(det.bx, 8)), cell(String(det.bx)), cell(su ? `(B = ${c.b})` : '', 'dim')),
        h('tr', null, cell('SU', 'dim'), cell('+'), cell(su ? '1' : '0'), cell(''), cell('')),
        h('tr', { class: 'rule' }, cell('Σ', 'dim'), cell(det.carry ? '1' : '', 'carry'), cell(toBinSpaced(det.value, 8)), cell(String(det.value)), cell(sg(toSigned(det.value)), 'dim')),
      );
      const cw = c.controlWord;
      const loop = (cw & EO) !== 0 && (cw & AI) !== 0;
      const bus = c.bus;
      setClass(next, 'warn', bus.contention);
      if (bus.contention) setText(next, `Bus contention: ${bus.drivers.map((x) => (x === 'input' ? 'the switches' : x.toUpperCase())).join(' and ')} are all driving the bus. Take the switches off the bus before turning on EO or AO.`);
      else if (loop) setText(next, `EO + AI: the ALU drives Σ = ${c.a} ${su ? '−' : '+'} ${c.b} = ${det.value} onto the bus, and A will load it on the next rising edge. Right after that the ALU sees the new A and immediately works out ${det.value} ${su ? '−' : '+'} ${c.b} = ${aluDetail(det.value, c.b, su).value}, but A ignores it until the following edge.`);
      else if (cw & EO) setText(next, `EO puts the ALU result (${det.value}) on the bus. Turn on AI too to feed it back into A.`);
      else setText(next, `The ALU always shows A ${su ? '−' : '+'} B = ${det.value} on its own LEDs, whether or not EO puts it on the bus.`);
      logEl.replaceChildren(...log.slice(-10).map((t) => h('li', null, t)));
      done.style.display = checklist.allDone ? '' : 'none';
      // status for the control panel
      const drv = bus.drivers.map((x) => (x === 'input' ? 'switches' : x.toUpperCase()));
      setText(status, `Bus: ${drv.length ? `${drv.join(' + ')} → ${bus.value}` : c.pullDowns ? 'idle (0)' : 'nobody drives it, so it floats (a load would read 1111 1111)'} · control word: ${formatControlWord(cw)}`);
    };
    d.add(machine.onChange(update));

    // ---- what if A were a latch? ----
    const latchBar = new LedBar({ bits: 8, color: 'red', label: 'A (latch)', formats: ['dec'] });
    const latchText = h('div', { class: 'callout' }, 'Hold the button to keep the clock high with EO + AI on, as if A were a transparent latch instead of edge-triggered flip-flops.');
    let latch: { x: number; rounds: number } | null = null;
    const hold = new Button({
      label: 'Hold clock high (latch A)',
      onPress: () => { latch = { x: c.a, rounds: 0 }; },
      onRelease: () => {
        if (!latch) return;
        if (latch.rounds === 0) {
          latch = null;
          return;
        }
        setText(latchText, `Released after about ${latch.rounds} trips round the loop. A ended up at ${latch.x}: whatever value happened to be there when the clock fell. With a latch the result depends on how long the clock is high and on gate delays, which is useless. The 74LS173 is edge-triggered, so it loads exactly once per pulse.`);
        latch = null;
      },
    });
    latchBar.set(c.a);
    d.add(
      animate(() => {
        if (!latch) return;
        const su = c.has(SU);
        if (!c.has(EO) || !c.has(AI)) {
          setText(latchText, 'Turn on EO and AI first: the race only happens when the ALU output is fed back into A while A is open.');
          return;
        }
        const vals = latchRace(latch.x, c.b, su, 3);
        latch.x = vals[vals.length - 1];
        latch.rounds += 3;
        latchBar.set(latch.x);
        setText(latchText, c.b === 0 ? 'B is 0, so A + B = A and nothing visibly races. Load a non-zero B first.' : `CLK high, latch open: A keeps re-loading A ${su ? '−' : '+'} ${c.b} every few tens of nanoseconds… ${latch.rounds} times so far (shown much slower than real).`);
      }),
    );

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Control lines', { accent: 'blue', subtitle: 'jumper wires for now' }, jumpers.el, row(pulse.el, allOff.el), status),
        panel('Test plan', { accent: 'yellow' }, checklist.el, done),
      ),
      view.el,
      h(
        'div',
        { class: 'lab-grid two' },
        panel('The ALU right now', { accent: 'red', chips: 'Σ = A + (B XOR SU) + SU' }, h('div', { class: 'dp-scroll' }, eq), next),
        panel('Clock edges', { accent: 'gray' }, logEl, note('On the rising edge A latches the bus value it saw just before the edge. The ALU is combinational: its output changes a few nanoseconds later, but by then the edge is over.')),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('What if A were a latch?', { accent: 'orange' }, row(hold.el), latchBar.el, latchText),
        panel(
          'Signals so far',
          { accent: 'gray' },
          note('AI / AO: A register in / out. BI: B register in. EO: Σ (ALU) out, through the ALU’s 74LS245. SU: subtract (inverts B through the XORs and sets the carry in). Plus CLR on the registers, and CLK from the clock module.'),
          note('Counting down past zero wraps: 0 − 2 = 254, which as a signed number is −2. The carry flag (later) tells the two cases apart.'),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
