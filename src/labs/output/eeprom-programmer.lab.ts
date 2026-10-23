import type { Level } from '../../logic/circuit';
import { hex } from '../../sim/assembler';
import { Button, DipSwitch, Led, LedBar, Scope, Toggle, note, panel, row, select } from '../../ui/components';
import { Disposer, animate, h, setClass, setText } from '../../ui/dom';
import { badge, ledCell, ledRow, makeHexDump, scopedStyle } from '../ram/_ui';
import { defineLab } from '../types';
import { ArduinoProgrammer, CODE_LINES, EEPROM_D0, LINE_INDEX, SHIFT_CLK, SHIFT_DATA, SHIFT_LATCH, WRITE_EN, type Ev } from './_programmer';
import { HEX_CA } from './_shared';

const CSS = `
.eprog .code { position: relative; font-family: var(--mono); font-size: 0.72rem; line-height: 1.45; max-height: 380px; overflow: auto; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 6px 0; }
.eprog .code div { white-space: pre; padding: 0 10px; color: var(--fg-dim); }
.eprog .code div.hl { color: var(--fg); }
.eprog .code div.cur { background: color-mix(in srgb, var(--accent-2) 26%, transparent); color: var(--fg); box-shadow: inset 3px 0 0 var(--accent-2); }
.eprog .serial { font-family: var(--mono); font-size: 0.74rem; background: #0a0d10; color: #c8f7c5; border-radius: 8px; padding: 8px 10px; min-height: 120px; max-height: 300px; overflow: auto; white-space: pre; margin: 0; }
.eprog .pinrow { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: flex-end; }
.eprog .pmode { font-family: var(--mono); font-size: 0.58rem; color: var(--fg-faint); }
.eprog .pmode.out { color: var(--accent-2); }
@media (prefers-color-scheme: light) { .eprog .pmode.out { color: #b45309; } }
`;

type Speed = 'step' | 'slow' | 'medium' | 'fast' | 'instant';
const SPEEDS: { value: Speed; label: string }[] = [
  { value: 'step', label: 'Paused (step by hand)' },
  { value: 'slow', label: 'Slow (3 steps/s)' },
  { value: 'medium', label: 'Medium (25 steps/s)' },
  { value: 'fast', label: 'Fast' },
  { value: 'instant', label: 'Instant' },
];

const HELP: Record<string, string> = {
  sa1: 'setAddress() shifts out the high byte first, MSB first: address bits 10-8 plus bit 7, the output-enable bit (0x80 = outputs OFF). By the time both bytes are out, this byte has been pushed through QH′ into the second 595, so bit 7 lands on QH → O̅E̅ and bits 10-8 on QC-QA → A10-A8.',
  sa2: 'Then the low byte, A7-A0. It ends up in the first 595, whose outputs QA-QH drive A0-A7.',
  sa3: 'SHIFT_LATCH (RCLK) low. While bits are shifting, the 595 outputs (and so the EEPROM address) don’t change at all.',
  sa4: 'SHIFT_LATCH rises: both storage registers copy the shift registers at the same instant, so the EEPROM sees the whole new address and O̅E̅ in one step.',
  sa5: 'SHIFT_LATCH back low, ready for next time.',
  rd1: 'pinMode(INPUT): the EEPROM is about to drive the I/O lines. If the Arduino kept driving them as outputs, the two would fight wherever they disagree.',
  rd2: 'setAddress(address, true) also puts 0 in the O̅E̅ bit, so the EEPROM turns its outputs on and drives the byte onto D5-D12.',
  rd3: 'digitalRead from D12 (I/O7) down to D5 (I/O0): each new bit is shifted in from the right, so the first bit read ends up as bit 7.',
  rd4: 'The assembled byte is returned.',
  wr1: 'setAddress(address, false): O̅E̅ goes high first, so the EEPROM’s outputs are off before the Arduino starts driving the data lines.',
  wr2: 'pinMode(OUTPUT): now the Arduino drives the 8 I/O lines.',
  wr3: 'The byte goes out LSB first: bit 0 on D5 (I/O0) up to bit 7 on D12 (I/O7).',
  wr4: 'WRITE_EN low: W̅E̅ falls and the EEPROM latches the address.',
  wr5: 'delayMicroseconds(1): the 28C16 wants W̅E̅ low for 100-1000 ns. The digitalWrite calls around it take a few microseconds of their own, so the real pulse is somewhat longer than the datasheet’s 1 µs maximum. It works in practice.',
  wr6: 'WRITE_EN high: W̅E̅ rises and the data is latched. The chip now runs its own internal write cycle.',
  wr7: 'delay(10): wait 10 ms so the internal write cycle is finished before the next access. The datasheet says a byte write takes at most 1 ms, so this is a generous margin.',
  pc1: 'printContents() walks through the first 256 bytes, 16 at a time.',
  pc2: 'Each byte comes from readEEPROM(), the whole shift-out / latch / read sequence for every single address.',
  pc3: 'sprintf formats one line: the 3-digit base address, then 16 bytes in two groups of 8.',
  pc4: 'Serial.println sends the line to the serial monitor at 57600 baud.',
  er1: 'setup() first erases the whole chip, so leftovers from earlier experiments don’t survive.',
  er2: 'writeEEPROM(address, 0xff) for every one of the 2048 addresses. With delay(10) after each byte this takes over 20 seconds on the real Arduino: watch the Arduino time.',
  er3: 'A dot every 64 bytes, so you can see it is still alive.',
  er4: 'Erasing finished: every byte now reads FF.',
  su1: 'setup() starts programming.',
  su2: 'writeEEPROM() for each byte of data[]: Ben’s common-anode hex digit patterns.',
  su3: 'A dot for progress every 64 bytes.',
  su4: 'Programming finished.',
  su5: 'Now read everything back.',
  su6: 'printContents() dumps the first 256 bytes.',
};

export default defineLab({
  id: 'eeprom-programmer',
  title: 'Arduino EEPROM programmer',
  summary:
    'Setting DIP switches for 2048 bytes is no fun, so Ben builds a programmer around an Arduino Nano. The Nano doesn’t have enough pins for 11 address lines, so two chained 74HC595 shift registers take the address one bit at a time on SHIFT_DATA/SHIFT_CLK and update all their outputs together on SHIFT_LATCH. The last bit drives the EEPROM’s O̅E̅. Eight Arduino pins connect straight to the data lines and one drives W̅E̅. Step through the sketch and watch every bit move.',
  mount(root) {
    const d = new Disposer();
    const dump = makeHexDump();
    d.add(scopedStyle(root, CSS + dump.css));
    root.classList.add('eprog');

    let ard = new ArduinoProgrammer();
    let task: Generator<Ev, unknown> | null = null;
    let taskName = '';
    let cur: Ev | null = null;
    let speed: Speed = 'medium';
    let acc = 0;
    let events = 0;
    let doneMsg = '';

    // ---- code view ----
    const lineEls = CODE_LINES.map((l) => h('div', { class: l.id ? 'hl' : '' }, l.text || ' '));
    const code = h('div', { class: 'code', role: 'region', 'aria-label': 'Arduino sketch', tabindex: 0 }, lineEls);
    let curLineIdx = -1;
    const evNote = h('div', { class: 'mono small' });
    const explain = h('div', { class: 'callout' });

    // ---- serial ----
    const serial = h('pre', { class: 'serial', 'aria-live': 'polite' });
    let serialLen = -1;

    // ---- controls ----
    const addrDip = new DipSwitch({ bits: 11, label: 'address', value: 0 });
    const dataDip = new DipSwitch({ bits: 8, label: 'data', value: 0x81 });
    const start = (name: string, gen: Generator<Ev, unknown>, minSpeed?: Speed) => {
      task = gen;
      taskName = name;
      doneMsg = '';
      events = 0;
      if (minSpeed && (speed === 'slow' || speed === 'medium')) setSpeed(minSpeed);
    };
    const writeBtn = new Button({ label: 'writeEEPROM(address, data)', kind: 'primary', onClick: () => start(`writeEEPROM(0x${hex(addrDip.value, 3)}, 0x${hex(dataDip.value)})`, ard.writeEEPROM(addrDip.value, dataDip.value)) });
    const readBtn = new Button({ label: 'readEEPROM(address)', onClick: () => start(`readEEPROM(0x${hex(addrDip.value, 3)})`, ard.readEEPROM(addrDip.value)) });
    const eraseBtn = new Button({ label: 'Erase (setup’s first loop)', title: 'writeEEPROM(address, 0xff) for all 2048 addresses', onClick: () => start('setup(): erase', ard.eraseAll(), 'fast') });
    const progBtn = new Button({ label: 'Program the hex digits', onClick: () => start('setup(): program data[]', ard.programTable(HEX_CA, false), 'fast') });
    const printBtn = new Button({ label: 'printContents()', onClick: () => start('printContents()', ard.printContents(), 'fast') });
    const stepBtn = new Button({ label: 'Step', title: 'One step (a pin change)', onClick: () => { setSpeed('step'); stepOnce(); } });
    const lineBtn = new Button({ label: 'Next line', title: 'Run until the highlighted line changes', onClick: () => { setSpeed('step'); const l = cur?.line; let n = 0; while (task && n++ < 100 && stepOnce() && cur?.line === l); } });
    const stopBtn = new Button({ label: 'Stop', kind: 'ghost', onClick: () => { task = null; doneMsg = `${taskName} stopped.`; } });
    const freshBtn = new Button({ label: 'Fresh chip (all FF)', kind: 'danger', onClick: () => { task = null; ard = new ArduinoProgrammer(); ard.forgetInputMode = bugT.value; cur = null; doneMsg = 'New, erased EEPROM; serial monitor cleared.'; lanes.forEach((l) => (l.length = 0)); } });
    const speedSel = select(SPEEDS, speed, (v) => (speed = v), 'speed');
    const setSpeed = (v: Speed) => {
      speed = v;
      const el = speedSel.querySelector('select');
      if (el) el.value = v;
    };
    const bugT = new Toggle({ label: 'Bug: forget pinMode(INPUT) in readEEPROM', onChange: (v) => (ard.forgetInputMode = v) });
    const timeText = h('span', { class: 'mono small dim' });
    const pageText = h('div', { class: 'small dim' });
    const taskBadge = badge();

    // ---- hardware views ----
    const pinLed = (p: number, name: string) => {
      const led = new Led(p === WRITE_EN ? 'red' : 'yellow', name);
      return { led, el: ledCell(led, name) };
    };
    const pData = pinLed(SHIFT_DATA, 'D2 DATA');
    const pClk = pinLed(SHIFT_CLK, 'D3 CLK');
    const pLatch = pinLed(SHIFT_LATCH, 'D4 LATCH');
    const pWe = pinLed(WRITE_EN, 'D13 W̅E̅');
    const dLeds = Array.from({ length: 8 }, (_, i) => new Led('green', `D${12 - i}`));
    const modeSpans = Array.from({ length: 8 }, () => h('span', { class: 'pmode' }, 'in'));
    const dPins = h('span', { class: 'ledbar-leds' }, dLeds.map((l, i) => h('span', { class: 'led-cell' }, l.el, h('span', { class: 'led-caption' }, `D${12 - i}`), modeSpans[i])));
    const caps = ['QH', 'QG', 'QF', 'QE', 'QD', 'QC', 'QB', 'QA'];
    const u1Shift = ledRow(caps, 'yellow');
    const u1Out = ledRow(['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0'], 'green');
    const u2Shift = ledRow(caps, 'yellow');
    const u2Out = ledRow(['O̅E̅', '–', '–', '–', '–', 'A10', 'A9', 'A8'], ['red', 'green', 'green', 'green', 'green', 'green', 'green', 'green']);
    const addrBar = new LedBar({ bits: 11, color: 'green', formats: ['hex'], label: 'address' });
    const oeLed = new Led('red', 'O̅E̅');
    const weLed = new Led('red', 'W̅E̅');
    const ioRow = ledRow(['I/O7', '6', '5', '4', '3', '2', '1', 'I/O0'], 'red');
    const ioText = h('span', { class: 'mono small dim' });

    // ---- logic analyser ----
    const WIN = 160;
    const lanes: Level[][] = Array.from({ length: 5 }, () => []);
    const scope = new Scope(
      [
        { label: 'D2 SHIFT_DATA', color: '#fbbf24' },
        { label: 'D3 SHIFT_CLK', color: '#60a5fa' },
        { label: 'D4 SHIFT_LATCH', color: '#c084fc' },
        { label: 'O̅E̅ (595 #2 QH)', color: '#f472b6' },
        { label: 'D13 W̅E̅', color: '#f87171' },
      ],
      { width: 640, laneHeight: 34 },
    );
    const sample = () => {
      const v: Level[] = [ard.pin[SHIFT_DATA], ard.pin[SHIFT_CLK], ard.pin[SHIFT_LATCH], ard.sr.oeN, ard.pin[WRITE_EN]];
      v.forEach((x, i) => {
        lanes[i].push(x);
        if (lanes[i].length > WIN) lanes[i].shift();
      });
    };

    const stepOnce = (): boolean => {
      if (!task) return false;
      const r = task.next();
      if (r.done) {
        doneMsg = `${taskName} finished after ${events} steps${ard.lastRead && taskName.startsWith('readEEPROM') ? `: returned 0x${hex(ard.lastRead.data)}` : ''}.`;
        task = null;
        return false;
      }
      cur = r.value;
      events++;
      sample();
      return true;
    };

    const render = () => {
      // code highlight
      const idx = cur ? (LINE_INDEX.get(cur.line) ?? -1) : -1;
      if (idx !== curLineIdx) {
        if (curLineIdx >= 0) lineEls[curLineIdx].classList.remove('cur');
        curLineIdx = idx;
        if (idx >= 0) {
          lineEls[idx].classList.add('cur');
          const el = lineEls[idx];
          const top = el.offsetTop - code.clientHeight / 2;
          if (el.offsetTop < code.scrollTop + 20 || el.offsetTop > code.scrollTop + code.clientHeight - 30) code.scrollTop = Math.max(0, top);
        }
      }
      setText(evNote, cur?.note ?? '');
      setText(explain, doneMsg && !task ? doneMsg : cur ? HELP[cur.line] ?? '' : 'Pick something to run: write one byte first and step through it slowly to watch the address shift into the 595s.');
      taskBadge.set(task ? `running ${taskName}` : doneMsg ? 'idle' : 'ready', task ? 'on' : '');
      setText(timeText, `Arduino time ${ard.us >= 1e6 ? `${(ard.us / 1e6).toFixed(2)} s` : ard.us >= 1000 ? `${(ard.us / 1000).toFixed(1)} ms` : `${Math.round(ard.us)} µs`} · ${events} steps`);
      // serial
      if (ard.serial.length !== serialLen) {
        serialLen = ard.serial.length;
        serial.textContent = ard.serial;
        serial.scrollTop = serial.scrollHeight;
      }
      // pins
      pData.led.set(ard.pin[SHIFT_DATA]);
      pClk.led.set(ard.pin[SHIFT_CLK]);
      pLatch.led.set(ard.pin[SHIFT_LATCH]);
      pWe.led.set(ard.pin[WRITE_EN]);
      const io = ard.ioLevels();
      [...io].reverse().forEach((l, i) => dLeds[i].set(l));
      modeSpans.forEach((sp, i) => {
        const out = ard.mode[EEPROM_D0 + 7 - i] === 'OUTPUT';
        setText(sp, out ? 'out' : 'in');
        setClass(sp, 'out', out);
      });
      // shift registers
      u1Shift.setValue(ard.sr.u1.shift);
      u1Out.setValue(ard.sr.u1.latch);
      u2Shift.setValue(ard.sr.u2.shift);
      u2Out.setValue(ard.sr.u2.latch);
      // EEPROM
      addrBar.set(ard.sr.address);
      oeLed.set(ard.sr.oeN);
      weLed.set(ard.weN);
      ioRow.set([...io].reverse());
      const driver = ard.sr.oeN === 0 && ard.weN === 1 ? 'EEPROM drives' : 'EEPROM outputs off';
      const arduinoDrives = io.some((_, b) => ard.mode[EEPROM_D0 + b] === 'OUTPUT');
      setText(ioText, io.includes('X') ? 'CONTENTION: Arduino and EEPROM both drive the lines' : `${driver}${arduinoDrives ? ', Arduino drives' : ''}`);
      const page = ard.sr.address & 0x700;
      setText(pageText, `page 0x${hex(page, 3)}-0x${hex(page + 255, 3)}, the one the shift registers are addressing (A10-A8 = ${(page >> 8).toString(2).padStart(3, '0')}). printContents() only ever dumps page 0x000.`);
      dump.update(ard.rom.mem, page, ard.sr.address, ard.lastWrite?.addr ?? -1);
      scope.draw(lanes, { window: WIN });
    };

    d.add(
      animate((dt) => {
        acc += dt;
        if (task && speed !== 'step') {
          if (speed === 'instant') {
            let n = 0;
            while (task && n++ < 400_000) stepOnce();
            acc = 0;
          } else if (speed === 'fast') {
            for (let n = 0; n < 900 && task; n++) stepOnce();
            acc = 0;
          } else {
            const iv = speed === 'slow' ? 333 : 40;
            while (acc >= iv && task) {
              acc -= iv;
              stepOnce();
            }
            if (acc > 1000) acc = 0;
          }
        } else acc = 0;
        render();
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        h(
          'div',
          { class: 'lab-stack' },
          panel('Run the sketch', { accent: 'blue' }, row(addrDip.el), row(dataDip.el), row(writeBtn.el, readBtn.el), row(eraseBtn.el, progBtn.el, printBtn.el), row(speedSel, stepBtn.el, lineBtn.el, stopBtn.el), row(taskBadge.el, timeText), bugT.el, freshBtn.el),
          panel('eeprom-programmer.ino', { accent: 'gray', subtitle: 'after Ben Eater’s sketch (MIT licence)' }, code, evNote, explain),
          panel('Serial monitor', { accent: 'gray', subtitle: '57600 baud' }, serial),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            'Shift registers',
            { accent: 'yellow', chips: '74HC595 ×2 (SRCLR̅ = VCC, OE̅ = GND)' },
            note('D2 → SER of #1 · #1 QH′ → SER of #2 · D3 clocks both shift registers · D4 latches both outputs.'),
            row(h('span', { class: 'mo-label' }, '#1 shift'), u1Shift.el),
            row(h('span', { class: 'mo-label' }, '#1 outputs'), u1Out.el),
            row(h('span', { class: 'mo-label' }, '#2 shift'), u2Shift.el),
            row(h('span', { class: 'mo-label' }, '#2 outputs'), u2Out.el),
          ),
          panel(
            'Arduino pins and the EEPROM',
            { accent: 'green', chips: 'Arduino Nano, 28C16 (C̅E̅ = GND)' },
            h('div', { class: 'pinrow' }, pData.el, pClk.el, pLatch.el, pWe.el),
            row(h('span', { class: 'mo-label' }, 'data pins'), dPins),
            row(addrBar.el, ledCell(oeLed, 'O̅E̅'), ledCell(weLed, 'W̅E̅')),
            row(h('span', { class: 'mo-label' }, 'I/O lines'), ioRow.el),
            ioText,
            note('The data pins switch direction: OUTPUT while writing (the Arduino drives the I/O lines with O̅E̅ high) and INPUT while reading (the EEPROM drives them with O̅E̅ low). Turn on the bug above and read a byte to see them fight.'),
          ),
          panel('Logic analyser', { accent: 'gray', subtitle: 'one sample per step, not to scale in time' }, scope.el, note('writeEEPROM pulses W̅E̅ low for about 1 µs, then waits delay(10) = 10 ms for the chip’s write cycle. Most of the time spent programming goes on those delays.')),
          panel('EEPROM contents', { accent: 'gray', subtitle: 'hex dump of one 256-byte page' }, pageText, dump.el),
        ),
      ),
    );
    render();
    return d.dispose;
  },
});
