import { Circuit, type Level, type Net } from '../../logic/circuit';
import { bin, hex } from '../../sim/assembler';
import { Button, DipSwitch, Led, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, h, setClass, setText } from '../../ui/dom';
import { Schematic, switchPitch } from '../../ui/schematic';
import { defineLab } from '../types';
import { Ls189, ls189Mode } from './_shared';
import { ledRow, makeTable, scopedStyle } from './_ui';

const CSS = `
.ram-intro .cellgrid td.bit { width: 26px; }
.ram-intro .cellgrid td.bit.on { font-weight: 700; }
.ram-intro .cellgrid td.wl .led { width: 10px; height: 10px; }
.ram-intro .cellgrid tr.current td.bit { background: color-mix(in srgb, var(--accent-2) 22%, transparent); }
`;

export default defineLab({
  id: 'ram-intro',
  title: 'RAM intro: the 74LS189',
  summary:
    'RAM is a stack of registers with an address decoder in front: the address picks exactly one word, and a write signal stores the data inputs into it. Ben uses the 74LS189, a 16 × 4-bit static RAM. Its quirk: the outputs show the complement of what is stored, and they float while you write. Set an address and data, hold W̅E̅ low to write, then let go and read it back through the 74LS04 that turns the outputs right side up again.',
  mount(root) {
    const d = new Disposer();
    d.add(scopedStyle(root, CSS));
    root.classList.add('ram-intro');

    // ---- the chips (U25 = low nibble, drawn; U24 = high nibble, in the 16-byte panel) ----
    const low = new Ls189();
    const high = new Ls189();
    low.randomize();
    high.randomize();

    const c = new Circuit();
    const A = [0, 1, 2, 3].map((i) => c.input(`A${i}`, 0));
    const D = [1, 2, 3, 4].map((i) => c.input(`D${i}`, 0));
    const E = [5, 6, 7, 8].map((i) => c.input(`D${i}`, 0)); // data inputs of the high-nibble chip
    const WEn = c.input('W̅E̅', 1);
    const CSn = c.input('C̅S̅', 0);
    const On = [1, 2, 3, 4].map((i) => c.net(`O̅${i}`, 'Z'));
    const Q = [1, 2, 3, 4].map((i) => c.net(`Q${i}`, 0));
    const Pn = [5, 6, 7, 8].map((i) => c.net(`O̅${i}`, 'Z'));
    const P = [5, 6, 7, 8].map((i) => c.net(`Q${i}`, 0));
    const bit = (l: Level): 0 | 1 => (l === 0 ? 0 : 1); // floating TTL inputs read high
    const add189 = (chip: Ls189, data: Net[], outs: Net[], name: string) =>
      c.add({
        kind: '74LS189',
        name,
        inputs: [...A, ...data, WEn, CSn],
        outputs: outs,
        evaluate: (l) => {
          const addr = bit(l[0]) | (bit(l[1]) << 1) | (bit(l[2]) << 2) | (bit(l[3]) << 3);
          const dv = bit(l[4]) | (bit(l[5]) << 1) | (bit(l[6]) << 2) | (bit(l[7]) << 3);
          return chip.apply(addr, dv, bit(l[9]), bit(l[8])) as Level[];
        },
      });
    add189(low, D, On, 'U25');
    add189(high, E, Pn, 'U24');
    On.forEach((o, i) => c.not(o, Q[i]));
    Pn.forEach((o, i) => c.not(o, P[i]));
    c.settle();

    // ---- schematic ----
    const chipH = 11 * switchPitch(); // 10 switched pins on the left
    const grow = chipH - 220; // 0 with a mouse; touch screens space the switches out
    const sch = new Schematic(c, { width: 520, height: 268 + grow });
    const leftPins = [
      { name: '1 A0', net: A[0] }, { name: '15 A1', net: A[1] }, { name: '14 A2', net: A[2] }, { name: '13 A3', net: A[3] },
      { name: '4 D1', net: D[0] }, { name: '6 D2', net: D[1] }, { name: '10 D3', net: D[2] }, { name: '12 D4', net: D[3] },
      { name: '3 W̅E̅', net: WEn, bubble: true }, { name: '2 C̅S̅', net: CSn, bubble: true },
    ];
    const chip = sch.chip([150, 20], {
      label: '74LS189',
      sublabel: 'U25 · bits 3-0',
      width: 124,
      height: chipH,
      left: leftPins,
      right: [5, 7, 9, 11].map((p, i) => ({ name: `O̅${i + 1} ${p}`, net: On[i], bubble: true })),
    });
    const refresh = () => {
      c.settle();
      sch.update();
      update();
    };
    const toggleNet = (n: Net) => {
      c.toggle(n);
      syncDips();
      refresh();
    };
    leftPins.forEach((p, i) => {
      const y = chip.left[i].y;
      sch.wire(p.net, [100, y], chip.left[i]);
      sch.switch(p.net, [100, y], { label: p.name.split(' ')[1], onToggle: toggleNet });
    });
    On.forEach((o, i) => {
      const y = chip.right[i].y;
      const g = sch.gate('NOT', [372, y], { output: Q[i] });
      sch.wire(o, chip.right[i], g.inputs[0]);
      sch.probe(o, [322, y], { label: `O̅${i + 1}`, color: 'red', labelSide: 'top' });
      sch.wire(Q[i], g.output, [452, y]);
      sch.probe(Q[i], [460, y], { label: `bit ${i}`, color: 'red' });
    });
    sch.text('74LS04', [390, 240 + grow], { class: 'cap', size: 11 });
    sch.text('pin 16 = +5 V · pin 8 = GND', [212, 256 + grow], { class: 'cap', size: 10 });
    d.add(sch.autoUpdate());

    // ---- front-panel controls ----
    const busVal = (nets: Net[]) => nets.reduce((v, n, i) => v | ((n.value === 1 ? 1 : 0) << i), 0);
    const setNets = (nets: Net[], v: number) => nets.forEach((n, i) => c.set(n, ((v >> i) & 1) as 0 | 1));
    const addrDip = new DipSwitch({ bits: 4, label: 'address', onChange: (v) => { setNets(A, v); refresh(); } });
    const dataDip = new DipSwitch({ bits: 4, label: 'data (U25)', onChange: (v) => { setNets(D, v); refresh(); } });
    const hiDip = new DipSwitch({ bits: 4, label: 'data (U24)', onChange: (v) => { setNets(E, v); refresh(); } });
    const syncDips = () => {
      if (addrDip.value !== busVal(A)) addrDip.set(busVal(A));
      if (dataDip.value !== busVal(D)) dataDip.set(busVal(D));
      csToggle.set(CSn.value === 1);
    };
    const writeBtn = new Button({
      label: 'Hold to write (W̅E̅ low)',
      kind: 'primary',
      onPress: () => { c.set(WEn, 0); refresh(); },
      onRelease: () => { c.set(WEn, 1); refresh(); },
    });
    const csToggle = new Toggle({ label: 'C̅S̅ high (chip not selected)', onChange: (v) => { c.set(CSn, v ? 1 : 0); refresh(); } });
    // Re-evaluate the chips after their cells changed behind the circuit's back
    // (deselect and reselect: no write happens while C̅S̅ is high).
    const forceEval = () => {
      const v = CSn.value === 1 ? 1 : 0;
      c.set(CSn, 1);
      c.settle();
      c.set(CSn, v);
      refresh();
    };
    const rawLeds = ledRow(['O̅4', 'O̅3', 'O̅2', 'O̅1'], 'red');
    const outLeds = ledRow(['b3', 'b2', 'b1', 'b0'], 'red');
    const rawText = h('span', { class: 'mono dim' });
    const outText = h('span', { class: 'mono dim' });

    // ---- truth table ----
    const tt = makeTable(['C̅S̅', 'W̅E̅', 'operation', 'outputs O̅1-O̅4'], [
      ['0', '0', 'write D1-D4 into the addressed word', 'high-Z (floating)'],
      ['0', '1', 'read the addressed word', 'complement of stored data'],
      ['1', 'X', 'not selected', 'high-Z (floating)'],
    ]);
    const status = h('div', { class: 'callout' });

    // ---- the 16 x 4 cell grid with decoder word lines ----
    const wordLeds = Array.from({ length: 16 }, (_, i) => new Led('yellow', `word line ${i}`));
    const grid = makeTable(
      ['word line', 'addr', 'D4', 'D3', 'D2', 'D1', 'hex'],
      Array.from({ length: 16 }, (_, a) => [wordLeds[a].el, bin(a, 4), '', '', '', '', '']),
      { class: 'compact cellgrid' },
    );
    grid.cells.forEach((r) => { r[0].classList.add('wl'); for (let k = 2; k <= 5; k++) r[k].classList.add('bit'); });

    // ---- 16 bytes from two chips ----
    const bytes = makeTable(
      ['addr', 'U24 (bits 7-4)', 'U25 (bits 3-0)', 'byte'],
      Array.from({ length: 16 }, (_, a) => [String(a), '', '', '']),
      { class: 'compact' },
    );
    const hiRaw = ledRow(['O̅8', 'O̅7', 'O̅6', 'O̅5'], 'red');
    const byteLeds = ledRow(['7', '6', '5', '4', '3', '2', '1', '0'], 'red');

    const update = () => {
      const csN = CSn.value === 1 ? 1 : 0;
      const weN = WEn.value === 1 ? 1 : 0;
      const mode = ls189Mode(csN, weN);
      const addr = busVal(A);
      const data = busVal(D);
      const stored = low.cells[addr];
      tt.highlight(mode === 'write' ? 0 : mode === 'read' ? 1 : 2);
      const raw = [...On].reverse().map((n) => n.value);
      rawLeds.set(raw);
      outLeds.set([...Q].reverse().map((n) => n.value));
      setText(rawText, raw.map((l) => (l === 'Z' ? 'z' : String(l))).join(''));
      setText(outText, [...Q].reverse().map((n) => String(n.value)).join(''));
      const comp = bin(~stored & 15, 4);
      setText(
        status,
        mode === 'disabled'
          ? 'C̅S̅ is high, so the chip is not selected and all four outputs float (dashed). The 74LS04 inputs float too, and a floating TTL input reads 1, so the LEDs after the inverters go dark. Ben ties C̅S̅ to ground.'
          : mode === 'write'
            ? `W̅E̅ is low: the 189 writes ${bin(data, 4)} into address ${addr}, and keeps writing for as long as W̅E̅ stays low. Try flipping a data switch now: the cell follows it. During the write the outputs float, so the LEDs after the 74LS04 read 0000.`
            : `Reading address ${addr} (${bin(addr, 4)}). The cell holds ${bin(stored, 4)}, but the 189's outputs show its complement ${comp}. That is just how this chip works. The 74LS04 inverts each line again, so the LEDs show ${bin(stored, 4)}.`,
      );
      for (let a = 0; a < 16; a++) {
        wordLeds[a].set(a === addr && mode !== 'disabled');
        const v = low.cells[a];
        for (let k = 0; k < 4; k++) {
          const cell = grid.cells[a][2 + k];
          const b = (v >> (3 - k)) & 1;
          setText(cell, String(b));
          setClass(cell, 'on', b === 1);
        }
        setText(grid.cells[a][6], hex(v, 1));
        const hb = high.cells[a];
        setText(bytes.cells[a][1], bin(hb, 4));
        setText(bytes.cells[a][2], bin(v, 4));
        setText(bytes.cells[a][3], `0x${hex((hb << 4) | v)}`);
      }
      grid.highlight(addr);
      bytes.highlight(addr);
      hiRaw.set([...Pn].reverse().map((n) => n.value));
      byteLeds.set([...[...P].reverse(), ...[...Q].reverse()].map((n) => n.value));
      setText(wordText, `Decoder: address ${bin(addr, 4)} → word line ${addr}${mode === 'disabled' ? ' (chip deselected)' : ''}`);
    };
    const wordText = h('div', { class: 'mono small dim' });

    const power = new Button({ label: 'Power cycle (random contents)', title: 'Static RAM comes up full of junk', onClick: () => { low.randomize(); high.randomize(); forceEval(); } });

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            '74LS189: 16 words × 4 bits',
            { accent: 'red', chips: '74LS189, 74LS04' },
            sch.el,
            row(addrDip.el, dataDip.el),
            row(writeBtn.el, csToggle.el),
            row(h('span', { class: 'mo-label' }, 'raw outputs'), rawLeds.el, rawText),
            row(h('span', { class: 'mo-label' }, 'after 74LS04'), outLeds.el, outText),
            row(power.el),
            note('Click the switches in the drawing or use the DIP switches. Wires: red = high, blue = low, dashed = floating (high-Z).'),
            note('The “outputs float during a write” behaviour follows the 74F189 datasheet that Ben links on eater.net. Exactly what his 74LS189 parts output while writing isn’t documented.'),
          ),
          panel('What the chip is doing', { accent: 'gray' }, tt.el, status),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            'Inside: address decoder and cells',
            { accent: 'yellow', subtitle: 'U25, the chip on the left' },
            wordText,
            grid.el,
            note('The 4 address bits and their complements feed 16 AND gates, so exactly one word line is high. Each cell is a latch like the D latch from video 7: it stores its bit line when its word line and the write signal are both active. All 16 words share the same 4 data lines in and out.'),
            note('This is static RAM (flip-flops): it holds its data as long as it has power, with no refresh. Dynamic RAM stores each bit as charge on a tiny capacitor, which is cheaper and denser but leaks away and has to be refreshed constantly.'),
          ),
          panel(
            'Two 189s make 16 bytes',
            { accent: 'red', chips: '74LS189 ×2 (U24, U25)' },
            note('A 4-bit address gives 2⁴ = 16 locations, and each 189 stores 4 bits at each one. Ben puts two chips side by side with their address lines, W̅E̅ and C̅S̅ wired together: U25 stores the low nibble, U24 the high nibble, so every address holds one byte: 16 × 8 bits = 16 bytes.'),
            row(hiDip.el, h('span', { class: 'mo-label' }, 'U24 raw'), hiRaw.el),
            row(h('span', { class: 'mo-label' }, 'byte read'), byteLeds.el),
            bytes.el,
          ),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
