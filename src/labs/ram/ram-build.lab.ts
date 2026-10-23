import { Circuit, type Level, type Net } from '../../logic/circuit';
import { bin, disassemble, hex } from '../../sim/assembler';
import { Button, DipSwitch, Led, LedBar, Toggle, note, panel, row } from '../../ui/components';
import { Disposer, animate, h, setClass, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { defineLab } from '../types';
import { RamModule, type RamModuleInputs } from './_shared';
import { busLine, ledCell, liveText, makeTable, scopedStyle, setBusState, stepList } from './_ui';

type P2 = readonly [number, number];

const CSS = `
.ram-build .flash td { background: color-mix(in srgb, var(--led-red) 28%, transparent) !important; }
`;

/** How long a clock pulse stays high and how long the RC pulse lasts, stretched so you can see them (ms). */
const PULSE_MS = 320;
const EDGE_MS = 110;

export default defineLab({
  id: 'ram-build',
  title: 'Building the RAM module',
  summary:
    'Over three videos Ben turns two 74LS189s into the computer’s 16-byte memory. A 74LS173 memory address register (MAR) latches an address from the bus on MI. 74LS157 multiplexers pick where the address, the data and the write signal come from: DIP switches and a WRITE button in program mode, or the MAR, the bus and RI ANDed with the clock in run mode. Two 74LS04s undo the 189s’ inverted outputs and a 74LS245 puts the byte on the bus on RO. Try both workflows below.',
  mount(root) {
    const d = new Disposer();
    d.add(scopedStyle(root, CSS));
    root.classList.add('ram-build');

    const ram = new RamModule();
    ram.randomize();

    // ---- front-panel state ----
    const st = {
      prog: true,
      dipAddr: 0,
      dipData: 0,
      writeBtn: false,
      busDrive: false,
      busSw: 0,
      mi: false,
      ri: false,
      ro: false,
      clk: 0 as 0 | 1,
      edge: 0 as 0 | 1,
      rc: true,
    };
    let clkFallAt = 0;
    let edgeEndAt = 0;
    let now = 0;
    let flashAddr = -1;
    let flashUntil = 0;
    // workflow progress
    const progDone = { addr: false, data: false, write: false };
    const runDone = { mar: false, write: false, read: false };

    const inputs = (): RamModuleInputs => ({
      prog: st.prog,
      dipAddr: st.dipAddr,
      dipData: st.dipData,
      writeBtn: st.writeBtn,
      bus: st.busDrive ? st.busSw : null,
      mi: st.mi,
      ri: st.ri,
      ro: st.ro,
      clkToNand: st.rc ? st.edge : st.clk,
    });

    // ---- nets (single-bit control lines, coloured by level) ----
    const c = new Circuit();
    const nMIn = c.input('M̅I̅', 1);
    const nCLK = c.input('CLK', 0);
    const nSEL = c.input('PROG', 0);
    const nBTN = c.input('WRITE', 1);
    const nRI = c.input('RI', 0);
    const nCK2 = c.input('CLK→NAND', 0);
    const nNAND = c.input('NAND', 1);
    const nWEn = c.input('W̅E̅', 1);
    const nROn = c.input('R̅O̅', 1);

    // ---- schematic ----
    const sch = new Schematic(c, { width: 545, height: 482 });
    const bus = (pts: P2[]) => busLine(sch, pts);
    const stub = (net: Net, from: { x: number; y: number }, dy: number, label: string) => {
      sch.wire(net, from, [from.x, from.y + dy]);
      sch.text(label, [from.x, from.y + dy + (dy > 0 ? 8 : -8)], { size: 10, class: 'cap' });
    };
    const busMain = bus([[24, 30], [24, 462]]);
    sch.text('BUS', [24, 16], { size: 12 });
    const tBus = liveText(sch, [32, 474]);

    // Row A: address
    sch.chip([90, 14], { label: 'addr DIP', width: 80, height: 32, right: [{ name: '' }] });
    const mar = sch.chip([70, 62], { label: '74LS173', sublabel: 'MAR', width: 120, height: 56, left: [{ name: 'D0-3' }], right: [{ name: 'Q0-3' }], bottom: [{ name: 'E̅', net: nMIn, bubble: true }, { name: 'CLK', net: nCLK }] });
    const amux = sch.chip([230, 30], { label: '74LS157', sublabel: 'address', width: 96, height: 72, left: [{ name: 'A' }, { name: 'B' }], right: [{ name: 'Y' }], bottom: [{ name: 'S', net: nSEL }] });
    const bBusMar = bus([[24, 90], [58, 90]]);
    const bDipA = bus([[182, 30], [200, 30], [200, 54], [218, 54]]);
    const bMarQ = bus([[202, 90], [210, 90], [210, 78], [218, 78]]);
    const bAddr = bus([[338, 66], [445, 66], [445, 148]]);
    stub(nMIn, mar.bottom[0], 10, 'M̅I̅');
    stub(nCLK, mar.bottom[1], 10, 'CLK');
    stub(nSEL, amux.bottom[0], 8, '');
    const tDipA = liveText(sch, [186, 24]);
    const tMar = liveText(sch, [130, 54], { anchor: 'middle' });
    const tAddr = liveText(sch, [350, 58]);

    // Row B: data
    sch.chip([90, 156], { label: 'data DIP', width: 80, height: 32, right: [{ name: '' }] });
    const dmux = sch.chip([230, 166], { label: '74LS157', sublabel: 'data ×2', width: 96, height: 72, left: [{ name: 'A' }, { name: 'B' }], right: [{ name: 'Y' }], bottom: [{ name: 'S', net: nSEL }] });
    sch.chip([390, 160], { label: '74LS189 ×2', sublabel: 'U24 / U25', width: 110, height: 120, top: [{ name: 'A0-3' }], left: [{ name: 'D' }, { name: 'W̅E̅', net: nWEn, bubble: true }], right: [{ name: 'O̅' , bubble: true }] });
    const bDipD = bus([[182, 172], [200, 172], [200, 190], [218, 190]]);
    const bBusD = bus([[24, 214], [218, 214]]);
    const bDataIn = bus([[338, 202], [358, 202], [358, 200], [378, 200]]);
    stub(nSEL, dmux.bottom[0], 8, '');
    const tDipD = liveText(sch, [186, 166]);
    const tDataIn = liveText(sch, [342, 192]);

    // Row C: write enable
    const nand = sch.gate('NAND', [130, 330], { output: nNAND, label: '74LS00' });
    const wmux = sch.chip([230, 300], { label: '74LS157', sublabel: 'write', width: 96, height: 72, left: [{ name: 'A' }, { name: 'B' }], right: [{ name: 'Y' }], bottom: [{ name: 'S', net: nSEL }] });
    sch.wire(nBTN, [110, 290], [205, 290], [205, wmux.left[0].y], wmux.left[0]);
    sch.probe(nBTN, [104, 290], { label: 'WRITE btn', labelSide: 'left', color: 'yellow' });
    sch.wire(nRI, [60, nand.inputs[0].y], nand.inputs[0]);
    sch.probe(nRI, [54, nand.inputs[0].y], { label: 'RI', labelSide: 'top', color: 'blue' });
    sch.wire(nCK2, [60, nand.inputs[1].y], nand.inputs[1]);
    const tCk2 = liveText(sch, [40, nand.inputs[1].y + 34], { class: 'cap', size: 10 });
    sch.wire(nNAND, nand.output, [200, nand.output.y], [200, wmux.left[1].y], wmux.left[1]);
    sch.wire(nWEn, wmux.right[0], [362, wmux.right[0].y], [362, 240], [378, 240]);
    stub(nSEL, wmux.bottom[0], 8, 'S = PROG/RUN');

    // Row D: outputs back to the bus
    const bRaw = bus([[512, 220], [526, 220], [526, 450], [482, 450]]);
    sch.chip([392, 426], { label: '74LS04', sublabel: '×2', width: 78, height: 48, right: [{ name: '' }], left: [{ name: '' }] });
    const t245 = sch.chip([160, 426], { label: '74LS245', width: 96, height: 48, right: [{ name: 'A' }], left: [{ name: 'B' }], top: [{ name: 'O̅E̅', net: nROn, bubble: true }] });
    const bInv = bus([[380, 450], [268, 450]]);
    const bOut = bus([[148, 450], [24, 450]]);
    stub(nROn, t245.top[0], -12, 'R̅O̅');
    const tRaw = liveText(sch, [430, 414], { anchor: 'middle', class: 'cap', size: 10 });
    const tLeds = liveText(sch, [324, 437], { anchor: 'middle' });
    d.add(sch.autoUpdate());

    // ---- controls ----
    const redLed = new Led('red', 'Program mode');
    const greenLed = new Led('green', 'Run mode');
    const progToggle = new Toggle({ label: 'Program mode', value: st.prog, onLabel: 'PROG', offLabel: 'RUN', title: 'SPDT switch SW6 on the PROG line (select of all four 74LS157s)', onChange: (v) => { st.prog = v; st.writeBtn = false; } });
    const addrDip = new DipSwitch({ bits: 4, label: 'address', onChange: (v) => { st.dipAddr = v; if (st.prog) progDone.addr = true; } });
    const dataDip = new DipSwitch({ bits: 8, label: 'data', onChange: (v) => { st.dipData = v; if (st.prog) progDone.data = true; } });
    const writeBtn = new Button({ label: 'WRITE', kind: 'primary', title: 'Push button SW4: pulls the 157 A input low (program mode)', onPress: () => { st.writeBtn = true; }, onRelease: () => { st.writeBtn = false; } });
    const busDip = new DipSwitch({ bits: 8, label: 'bus switches', onChange: (v) => { st.busSw = v; } });
    const busToggle = new Toggle({ label: 'Drive bus', title: 'Connect the switches to the bus, like Ben’s jumper wires', onChange: (v) => { st.busDrive = v; } });
    const miT = new Toggle({ label: 'MI', title: 'Memory address register in', onChange: (v) => { st.mi = v; } });
    const riT = new Toggle({ label: 'RI', title: 'RAM in (write on the clock pulse)', onChange: (v) => { st.ri = v; } });
    const roT = new Toggle({ label: 'RO', title: 'RAM out (74LS245 drives the bus)', onChange: (v) => { st.ro = v; } });
    const rcT = new Toggle({ label: 'RC edge detector on CLK (video 23)', value: st.rc, title: 'Without it (video 22) the NAND sees CLK itself and RAM writes for the whole high phase', onChange: (v) => { st.rc = v; } });
    const clockEdge = () => {
      if (st.clk === 1) return;
      st.clk = 1;
      st.edge = 1;
      edgeEndAt = now + EDGE_MS;
      const inp = inputs();
      if (ram.clockEdge(inp) && !st.prog) runDone.mar = true;
    };
    const clockFall = () => {
      st.clk = 0;
      // The falling edge pushes the RC node below 0 V, so a pulse that is
      // still running ends here too.
      st.edge = 0;
    };
    const holdClk = new Button({ label: 'CLK (hold)', title: 'Hold the clock high', onPress: () => { clockEdge(); clkFallAt = Infinity; }, onRelease: () => clockFall() });
    const pulseClk = new Button({ label: 'Clock pulse', title: 'One clock pulse', onClick: () => { clockEdge(); clkFallAt = now + PULSE_MS; } });
    const power = new Button({ label: 'Power cycle', title: 'RAM and MAR come up with random contents', onClick: () => ram.randomize() });

    const clkLed = new Led('blue', 'CLK');
    const addrLeds = new LedBar({ bits: 4, color: 'yellow', formats: ['bin'], title: 'Address at the RAM (74LS157 output)' });
    const ramLeds = new LedBar({ bits: 8, color: 'red', formats: ['bin', 'hex'], title: 'RAM output after the 74LS04s' });
    const busLeds = new LedBar({ bits: 8, color: 'red', title: 'Bus' });
    const busText = h('span', { class: 'mono dim small' });
    const marText = h('span', { class: 'mono dim small' });

    const memTable = makeTable(['addr', 'binary', 'hex', 'as code'], Array.from({ length: 16 }, (_, a) => [String(a), '', '', '']), { class: 'compact' });

    const progSteps = stepList([
      'Flip the switch to PROGRAM: the red LED lights and the 157s select the DIP switches and the WRITE button.',
      'Set an address on the 4 address switches. The yellow LEDs follow them straight away.',
      'Set a byte on the 8 data switches.',
      'Press WRITE. The red LEDs now show the byte stored at that address.',
    ]);
    const runSteps = stepList([
      'Flip the switch to RUN: the green LED lights and the 157s select the MAR, the bus and RI · CLK.',
      'Drive an address onto the bus with the bus switches, turn on MI and give a clock pulse: the MAR loads bits 0-3.',
      'Turn MI off, put a byte on the bus, turn on RI and give a clock pulse: the byte is written to RAM[MAR].',
      'Stop driving the bus and turn on RO: the 74LS245 puts the stored byte on the bus.',
    ]);
    const status = h('div', { class: 'callout' });

    let lastProg = st.prog;
    const update = () => {
      if (st.prog !== lastProg) {
        lastProg = st.prog;
        Object.assign(progDone, { addr: false, data: false, write: false });
        Object.assign(runDone, { mar: false, write: false, read: false });
      }
      const inp = inputs();
      if (ram.settle(inp)) {
        const sg0 = ram.signals(inp);
        flashAddr = sg0.addr;
        flashUntil = now + 250;
        if (st.prog) progDone.write = true;
        else runDone.write = true;
      }
      const sg = ram.signals(inp);
      if (!st.prog && st.ro && !st.busDrive && !sg.writing) runDone.read = true;

      // nets
      const set = (n: Net, v: Level) => c.set(n, v);
      set(nMIn, st.mi ? 0 : 1);
      set(nCLK, st.clk);
      set(nSEL, sg.select);
      set(nBTN, st.writeBtn ? 0 : 1);
      set(nRI, st.ri ? 1 : 0);
      set(nCK2, inp.clkToNand);
      set(nNAND, sg.nand);
      set(nWEn, sg.weN);
      set(nROn, st.ro ? 0 : 1);
      tCk2(st.rc ? 'CLK → RC (0.01 µF, 1 kΩ)' : 'CLK');

      // bus paths
      setBusState(busMain, sg.contention ? 'bad' : sg.busLevel === null ? 'off' : 'active');
      setBusState(bBusMar, st.mi ? 'active' : 'idle');
      setBusState(bDipA, st.prog ? 'active' : 'off');
      setBusState(bMarQ, st.prog ? 'off' : 'active');
      setBusState(bAddr, 'active');
      setBusState(bDipD, st.prog ? 'active' : 'off');
      setBusState(bBusD, st.prog ? 'off' : 'active');
      setBusState(bDataIn, sg.writing ? 'active' : 'idle');
      setBusState(bRaw, sg.writing ? 'off' : 'active');
      setBusState(bInv, 'active');
      setBusState(bOut, st.ro ? (sg.contention ? 'bad' : 'active') : 'off');
      const busStr = sg.busLevel === null ? 'floating (reads 0xFF)' : `0x${hex(sg.busLevel)}${sg.contention ? ' contention!' : ''}`;
      tBus(busStr);
      tDipA(bin(st.dipAddr, 4));
      tMar(`MAR = ${bin(ram.mar, 4)}`);
      tAddr(`A = ${bin(sg.addr, 4)}`);
      tDipD(bin(st.dipData, 8));
      tDataIn(`D = 0x${hex(sg.dataIn)}`);
      tRaw(sg.writing ? 'O̅ floating (write)' : `O̅ = ${sg.raw.slice().reverse().join('')}`);
      tLeds(bin(sg.leds, 8));

      // panel widgets
      redLed.set(st.prog);
      greenLed.set(!st.prog);
      clkLed.set(st.clk === 1);
      addrLeds.set(sg.addr);
      ramLeds.set(sg.leds);
      if (sg.busLevel === null) busLeds.setLevels(Array(8).fill('Z'));
      else if (sg.contention) {
        const clash = (sg.busOut ?? 0) ^ st.busSw;
        busLeds.setLevels(Array.from({ length: 8 }, (_, i) => ((clash >> (7 - i)) & 1 ? 'X' : (sg.busLevel! >> (7 - i)) & 1) as Level));
      }
      else busLeds.set(sg.busLevel);
      setText(busText, busStr);
      setText(marText, `MAR (inside the 173) = ${bin(ram.mar, 4)}`);
      setClass(addrDip.el, 'dim', !st.prog);
      setClass(dataDip.el, 'dim', !st.prog);
      writeBtn.setDisabled(!st.prog);
      setClass(busDip.el, 'dim', !st.busDrive);

      for (let a = 0; a < 16; a++) {
        const v = ram.ram[a];
        const cells = memTable.cells[a];
        setText(cells[1], bin(v, 8));
        setText(cells[2], `0x${hex(v)}`);
        setText(cells[3], disassemble(v));
        setClass(memTable.rows[a], 'flash', a === flashAddr && now < flashUntil);
      }
      memTable.highlight(sg.addr);

      progSteps.set([st.prog, st.prog && progDone.addr, st.prog && progDone.data, st.prog && progDone.write], !st.prog ? 0 : !progDone.addr ? 1 : !progDone.data ? 2 : !progDone.write ? 3 : -1);
      runSteps.set([!st.prog, !st.prog && runDone.mar, !st.prog && runDone.write, !st.prog && runDone.read], st.prog ? 0 : !runDone.mar ? 1 : !runDone.write ? 2 : !runDone.read ? 3 : -1);

      let msg: string;
      if (sg.contention) msg = 'Both the bus switches and the RAM’s 74LS245 (RO) are driving the bus at once. Where they disagree the low output wins (orange). Turn one of them off.';
      else if (st.prog && sg.writing) msg = `Program mode, WRITE held: the button pulls the write 157’s A input low, so W̅E̅ is low and both 189s store the data switches (0x${hex(st.dipData)}) at address ${sg.addr} for as long as you hold it. Their outputs float meanwhile, so the red LEDs go dark.`;
      else if (st.prog) msg = `Program mode: the 157s pass the DIP switches through, so the RAM address is ${bin(sg.addr, 4)} and the data inputs see ${bin(st.dipData, 8)}. RI and the clock can’t write in this mode (the MAR still loads on MI, but nobody is listening to it).`;
      else if (sg.writing) msg = `Run mode: RI is on and the clock${st.rc ? '’s RC edge pulse' : ''} is high, so the NAND output and W̅E̅ are low. The bus value ${sg.busLevel === null ? '(floating, read as 1s) 0xFF' : `0x${hex(sg.busLevel)}`} is being written to address ${sg.addr} (from the MAR).`;
      else if ((st.mi || st.ri) && sg.busLevel === null) msg = `Nothing drives the bus. Floating TTL inputs read as 1, so a clock pulse now would ${st.mi ? 'load 1111 into the MAR' : ''}${st.mi && st.ri ? ' and ' : ''}${st.ri ? 'write 0xFF into RAM' : ''}. Ben later adds pull-down resistors to the bus for exactly this reason.`;
      else if (st.mi && st.ri) msg = 'MI and RI together: on the clock edge the MAR loads the bus, and then the write happens at the NEW address. Normally only one of them is used per clock cycle.';
      else if (st.mi) msg = `MI is on: on the next rising clock edge the MAR latches bus bits 0-3 (${bin((sg.busLevel ?? 0xff) & 15, 4)}). The yellow LEDs show it because in run mode the 157 selects the MAR.`;
      else if (st.ri) msg = `RI is on: the next clock pulse makes the NAND output low, pulling W̅E̅ low, and the bus (0x${hex(sg.busLevel ?? 0xff)}) is stored at address ${sg.addr}.`;
      else if (st.ro) msg = `RO is on: the 74LS245 copies the red LEDs (RAM[${sg.addr}] = 0x${hex(sg.leds)}) onto the bus.`;
      else msg = `Run mode: the RAM address comes from the MAR (${bin(ram.mar, 4)}), and the red LEDs always show what is stored there. Use MI, RI and RO with clock pulses to move data over the bus.`;
      setText(status, msg);
    };

    d.add(
      animate((dt) => {
        now += dt;
        if (st.clk === 1 && now >= clkFallAt) clockFall();
        if (st.edge === 1 && now >= edgeEndAt) st.edge = 0;
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
            'RAM module (chip level)',
            { accent: 'red', chips: '74LS173, 74LS157 ×4, 74LS189 ×2, 74LS04 ×2, 74LS245, 74LS00' },
            sch.el,
            h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background: var(--accent-2)' }), 'path in use'), h('span', null, h('i', { style: 'background: var(--fg-faint)' }), 'idle'), h('span', null, h('i', { style: 'background: var(--wire-1)' }), 'high'), h('span', null, h('i', { style: 'background: var(--wire-0)' }), 'low')),
            note('Thick lines carry 4 or 8 bits; dashed ones are not selected by the multiplexers. Thin lines are single control signals.'),
          ),
          panel('What is happening', { accent: 'gray' }, status, h('h3', { class: 'sub-head' }, 'Program mode'), progSteps.el, h('h3', { class: 'sub-head' }, 'Run mode'), runSteps.el),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel(
            'Front panel',
            { accent: 'yellow' },
            row(progToggle.el, h('span', { class: 'mo-mode-leds' }, ledCell(redLed, 'PROG'), ledCell(greenLed, 'RUN'))),
            row(addrDip.el, h('span', { class: 'mo-label' }, 'address LEDs'), addrLeds.el),
            row(dataDip.el, writeBtn.el),
            row(h('span', { class: 'mo-label' }, 'RAM LEDs'), ramLeds.el),
            row(power.el, marText),
          ),
          panel(
            'Bus and control signals',
            { accent: 'blue', subtitle: 'test wiring before the control logic exists' },
            row(busToggle.el, busDip.el),
            row(h('span', { class: 'mo-label' }, 'bus'), busLeds.el, busText),
            row(miT.el, riT.el, roT.el),
            row(ledCell(clkLed, 'CLK'), pulseClk.el, holdClk.el),
            rcT.el,
          ),
          panel('Memory contents', { accent: 'gray', subtitle: 'highlighted row = address at the RAM' }, memTable.el),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
