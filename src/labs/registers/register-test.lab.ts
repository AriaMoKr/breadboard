import { Machine } from '../../sim/machine';
import { AI, BI, II, IO } from '../../sim/signals';
import { Button, LedBar, Toggle, note, panel, row } from '../../ui/components';
import { ComputerView } from '../../ui/computer-view';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { defineLab } from '../types';
import { Checklist, bin8, controlJumpers, labFrame, onRisingEdge } from './_shared';

/**
 * Video 13 — "Testing our computer's registers".
 * A, B and the instruction register on the bus, controlled by hand
 * (manual control word) with DIP switches as a temporary bus driver.
 */
export default defineLab({
  id: 'register-test',
  title: 'Testing the registers',
  summary:
    'With A, B and the instruction register on the bus, Ben tests them by hand: jumper wires set the control lines and put values on the bus, and the clock module does the loading. Follow the test plan: load A from an empty bus (it reads 1111 1111, because floating TTL inputs read high), load it from the switches, move A to B, then load the instruction register and see that it only puts its low 4 bits back on the bus.',
  mount(root) {
    const d = new Disposer();
    const wrap = labFrame(root, d);

    const machine = new Machine();
    const c = machine.computer;
    c.busInput = 0b00101010;
    const view = new ComputerView(machine, { modules: ['clock', 'bus', 'a', 'b', 'ir'], manualControl: true, busInput: true });
    d.add(() => view.dispose());
    const jumpers = controlJumpers(machine, ['AI', 'AO', 'BI', 'II', 'IO']);
    d.add(jumpers.dispose);

    // Video 13 has no bus pull-downs yet (they arrive in video 34): an
    // undriven bus floats and the LS-TTL register inputs read 1111 1111.
    c.pullDowns = false;
    const pdToggle = new Toggle({ label: '10k pull-downs on the bus (added in video 34)', onChange: (v) => { c.pullDowns = v; machine.changed(); } });
    const pulse = new Button({ label: 'Clock pulse', kind: 'primary', title: 'One pulse from the monostable 555', onClick: () => machine.pulse() });
    const clearSigs = new Button({ label: 'All lines off', onClick: () => { c.setManualControl(0); machine.changed(); } });
    const status = h('div', { class: 'callout' });

    const checklist = new Checklist([
      { title: 'Load A from an empty bus.', detail: 'Switches “Drive bus” off, AI on, pulse. With no pull-downs the floating lines read high and A becomes 1111 1111, as in the video.' },
      { title: 'Put a value on the bus with the switches and load it into A.', detail: 'Switches “Drive bus” on, AI on, then pulse the clock. The A LEDs should copy the bus.' },
      { title: 'Move A to B.', detail: 'Take the switches off the bus first. Then AO puts A on the bus and BI loads it into B on the next pulse.' },
      { title: 'Load the instruction register from the switches.', detail: 'Use a value with some of the top 4 bits set (e.g. 0010 1010), turn off AO/BI, turn on II and pulse.' },
      { title: 'Put the IR back on the bus (IO) and load it into A.', detail: 'Switches off the bus, IO + AI, pulse. Only the low 4 bits arrive; the top 4 come back as 0000.' },
    ]);
    const done = h('div', { class: 'callout good', style: 'display:none' }, 'All registers work. A, B and IR load on the clock edge only when their load line is asserted, and only one module ever drives the bus.');

    // ---- IR split view ----
    const opBar = new LedBar({ bits: 4, color: 'blue', label: 'opcode (to control logic)', formats: ['bin'] });
    const argBar = new LedBar({ bits: 4, color: 'yellow', label: 'operand (to the 245)', formats: ['bin'] });
    const irBusBar = new LedBar({ bits: 8, color: 'red', label: 'what IO puts on the bus', formats: ['bin', 'dec'] });

    const log: string[] = [];
    const logEl = h('ol', { class: 'dp-log' });

    d.add(
      onRisingEdge(machine, (tr) => {
        const floating = !c.pullDowns && c.bus.drivers.length === 0;
        const from = (t: (typeof tr)[number]) => t.from ?? (floating ? 'floating bus' : 'bus (no single driver)');
        for (const t of tr) log.push(`${t.signal}: ${t.to.toUpperCase()} ← ${from(t)} ${bin8(t.value)} (${t.value})`);
        if (!tr.length) log.push('clock edge: no load line asserted, nothing changes');
        if (floating && tr.some((t) => t.signal === 'AI' && t.value === 0xff)) checklist.complete(0);
        if (tr.some((t) => t.signal === 'AI' && t.from === 'input' && t.value !== 0)) checklist.complete(1);
        if (tr.some((t) => t.signal === 'BI' && t.from === 'a' && t.value !== 0)) checklist.complete(2);
        if (tr.some((t) => t.signal === 'II' && t.from === 'input' && t.value >= 16)) checklist.complete(3);
        if (checklist.done[3] && tr.some((t) => (t.signal === 'AI' || t.signal === 'BI') && t.from === 'ir')) checklist.complete(4);
      }),
    );

    const update = () => {
      const bus = c.bus;
      const cw = c.controlWord;
      opBar.set(c.ir >> 4);
      argBar.set(c.ir & 15);
      irBusBar.set(c.ir & 15);
      setClass(irBusBar.el, 'idle', !(cw & IO)); // dimmed while IO is off (styles.css: .ledbar.idle)
      logEl.replaceChildren(...log.slice(-10).map((t) => h('li', null, t)));
      done.style.display = checklist.allDone ? '' : 'none';
      const ins: string[] = [];
      if (cw & AI) ins.push('A');
      if (cw & BI) ins.push('B');
      if (cw & II) ins.push('IR');
      const drv = bus.drivers.map((x) => (x === 'input' ? 'the switches' : x.toUpperCase()));
      setClass(status, 'warn', bus.contention);
      let msg: string;
      if (bus.contention) msg = `Bus contention: ${drv.join(' and ')} are all driving the bus. Their outputs fight wherever the bits differ. Turn all but one off (on the board, unplug the switch jumpers before enabling AO or IO).`;
      else if (!drv.length)
        msg = c.pullDowns
          ? 'Nothing drives the bus, and the 10k pull-down resistors (added in video 34) hold every line low, so a load now gives 0000 0000.'
          : 'Nothing drives the bus. There are no pull-down resistors yet, so the lines float, and a floating LS-TTL input reads high: a load now gives 1111 1111, just as Ben found. To load 0s he grounds the bus lines with jumper wires.';
      else msg = `${drv[0][0].toUpperCase()}${drv[0].slice(1)} ${drv[0] === 'the switches' ? 'drive' : 'drives'} ${bin8(bus.value)} (${bus.value}) onto the bus${bus.drivers[0] === 'ir' ? ': only the IR’s low 4 bits, the top 4 are driven as 0' : ''}.`;
      msg += ins.length ? ` On the next rising clock edge ${ins.join(' and ')} ${ins.length === 1 ? 'loads' : 'load'} it.` : ' No load line is on, so a clock pulse changes nothing.';
      setText(status, msg);
    };
    d.add(machine.onChange(update));

    wrap.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel('Control lines (jumper wires)', { accent: 'blue', subtitle: 'active-low on the chips' }, jumpers.el, row(pulse.el, clearSigs.el), pdToggle.el, status),
        panel('Test plan', { accent: 'yellow' }, checklist.el, done),
      ),
      view.el,
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Why the IR only outputs 4 bits',
          { accent: 'blue', chips: 'IR: 74LS173 ×2, 74LS245 with inputs A0-A3 grounded' },
          opBar.el,
          argBar.el,
          irBusBar.el,
          note('An instruction byte is opcode (high 4 bits) + operand (low 4 bits). The opcode goes straight to the control logic, never to the bus. The operand is a RAM address or a small number, and with only 16 bytes of RAM 4 bits are all it needs. So Ben wires just the low nibble to the IR’s 74LS245 and grounds its other 4 inputs: IO drives the operand onto bus bits 0-3 and 0000 onto bits 4-7.'),
          note('The IR is also built mirror-image on the breadboard to make the wiring fit; logically bit 0 is still bit 0.'),
        ),
        panel('Clock edges', { accent: 'gray' }, logEl, note('Registers only change on the rising edge, and only if their load line (AI, BI, II) is on. Enabling an output (AO, IO) changes the bus immediately, without a clock.')),
      ),
    );
    update();
    return d.dispose;
  },
});
