import { Circuit } from '../../logic/circuit';
import { Button, Scope, Slider, Toggle, note, panel, readouts, row } from '../../ui/components';
import { Disposer, h, setText } from '../../ui/dom';
import { Schematic } from '../../ui/schematic';
import { MetastabilityGuard, callout, netRecorder, stepLoop, truthTable } from '../latches/_shared';
import { defineLab } from '../types';
import { JK_ROWS, LS76_PINS, LS76_ROWS, jkRow, ls76, ls76Row, masterSlaveJK } from './_shared';

const RATE = 150;
const WINDOW = 520;

export default defineLab({
  id: 'master-slave-jk',
  title: 'Master-slave JK flip-flop',
  summary:
    'Two latches in a row fix the race. The master listens while CLK is high; the slave listens while CLK is low, through an inverter. The JK feedback comes from the slave, which is frozen while the master is open, so with J = K = 1 the flip-flop toggles exactly once per clock however long the clock stays high. The output changes when the clock falls.',
  mount(root) {
    const d = new Disposer();
    const c = new Circuit();
    const J = c.input('J', 1);
    const K = c.input('K', 1);
    const CLK = c.input('CLK', 0);
    const ms = masterSlaveJK(c, J, K, CLK);
    const Qm = ms.master.Q, Qmn = ms.master.Qn, Q = ms.slave.Q, Qn = ms.slave.Qn;
    c.settle();
    const guards = [new MetastabilityGuard(c, ms.master, ms.Sm, ms.Rm), new MetastabilityGuard(c, ms.slave, ms.Ss, ms.Rs)];

    let slow = false;
    let auto = true;
    let half = 70;
    let phase = 0;
    let togglesThisCycle = 0, lastCycleToggles = -1;
    let prevQ = Q.value, prevClk = 0;

    // ---- schematic ----
    const sch = new Schematic(c, { width: 660, height: 312 });
    sch.el.setAttribute('viewBox', '-20 0 660 312');
    const aK = sch.gate('AND', [140, 70], { inputs: 3, label: '74LS11', output: ms.Rm });
    const aJ = sch.gate('AND', [140, 200], { inputs: 3, label: '74LS11', output: ms.Sm });
    const mQ = sch.gate('NOR', [240, 80], { label: '74LS02', output: Qm });
    const mQn = sch.gate('NOR', [240, 190], { label: '74LS02', output: Qmn });
    const sR = sch.gate('AND', [400, 72.5], { label: '74LS08', output: ms.Rs });
    const sS = sch.gate('AND', [400, 197.5], { label: '74LS08', output: ms.Ss });
    const gQ = sch.gate('NOR', [500, 80], { label: '74LS02', output: Q });
    const gQn = sch.gate('NOR', [500, 190], { label: '74LS02', output: Qn });
    const inv = sch.gate('NOT', [310, 270], { label: '74LS04', output: ms.CLKn });
    // inputs
    sch.wire(K, [40, 70], aK.inputs[1]);
    sch.wire(J, [40, 200], aJ.inputs[1]);
    sch.wire(CLK, [40, 135], [110, 135]);
    sch.wire(CLK, [110, 82], [110, 270], inv.inputs[0]);
    sch.wire(CLK, [110, 82], aK.inputs[2]);
    sch.wire(CLK, [110, 188], aJ.inputs[0]);
    sch.dot(CLK, [110, 135]);
    sch.dot(CLK, [110, 188]);
    // master latch
    sch.wire(ms.Rm, aK.output, [210, 70], [210, 72.5], mQ.inputs[0]);
    sch.wire(ms.Sm, aJ.output, [210, 200], [210, 197.5], mQn.inputs[1]);
    sch.wire(Qm, mQ.output, [335, 80], [360, 205], sS.inputs[1]);
    sch.wire(Qmn, mQn.output, [335, 190], [360, 65], sR.inputs[0]);
    sch.wire(Qm, [302, 80], [302, 106], [216, 152], [216, mQn.inputs[0].y], mQn.inputs[0]);
    sch.wire(Qmn, [314, 190], [314, 164], [222, 118], [222, mQ.inputs[1].y], mQ.inputs[1]);
    sch.dot(Qm, [302, 80]);
    sch.dot(Qmn, [314, 190]);
    // ~CLK to the slave
    sch.wire(ms.CLKn, inv.output, [378, 270], [378, 80], sR.inputs[1]);
    sch.wire(ms.CLKn, [378, 190], sS.inputs[0]);
    sch.dot(ms.CLKn, [378, 190]);
    sch.text('~CLK', [384, 250], { anchor: 'start', size: 11, class: 'gate-label' });
    // slave latch
    sch.wire(ms.Rs, sR.output, gQ.inputs[0]);
    sch.wire(ms.Ss, sS.output, gQn.inputs[1]);
    sch.wire(Q, gQ.output, [606, 80]);
    sch.wire(Qn, gQn.output, [606, 190]);
    sch.wire(Q, [562, 80], [562, 106], [474, 152], [474, gQn.inputs[0].y], gQn.inputs[0]);
    sch.wire(Qn, [572, 190], [572, 164], [482, 118], [482, gQ.inputs[1].y], gQ.inputs[1]);
    sch.dot(Q, [562, 80]);
    sch.dot(Qn, [572, 190]);
    // JK feedback from the slave
    sch.wire(Q, [592, 80], [592, 22], [118, 22], [118, aK.inputs[0].y], aK.inputs[0]);
    sch.wire(Qn, [598, 190], [598, 306], [118, 306], [118, aJ.inputs[2].y], aJ.inputs[2]);
    sch.dot(Q, [592, 80]);
    sch.dot(Qn, [598, 190]);
    sch.probe(Qm, [322, 80], { label: 'Qm', color: 'yellow', labelSide: 'top' });
    sch.probe(Qmn, [324, 190], { label: 'Q̅m', color: 'yellow', labelSide: 'bottom' });
    sch.probe(Q, [614, 80], { label: 'Q', color: 'red', labelSide: 'top' });
    sch.probe(Qn, [614, 190], { label: 'Q̅', color: 'red', labelSide: 'bottom' });
    sch.text('master: open while CLK = 1', [190, 10], { size: 11, class: 'gate-label' });
    sch.text('slave: open while CLK = 0', [490, 10], { size: 11, class: 'gate-label' });
    sch.switch(K, [40, 70], { label: 'K', onToggle: () => setK(K.value !== 1) });
    sch.switch(J, [40, 200], { label: 'J', onToggle: () => setJ(J.value !== 1) });
    sch.switch(CLK, [40, 135], { label: 'CLK', momentary: true });
    d.add(sch.autoUpdate());

    // ---- widgets ----
    const rec = netRecorder([CLK, J, K, Qm, Q], WINDOW);
    const scope = new Scope(
      [
        { label: 'CLK', color: '#60a5fa' },
        { label: 'J', color: '#fbbf24' },
        { label: 'K', color: '#c084fc' },
        { label: 'Qm (master)', color: '#facc15' },
        { label: 'Q (slave = output)', color: '#f87171' },
      ],
      { width: 640, laneHeight: 40 },
    );
    const tt = truthTable(['J', 'K', 'Q after the clock', ''], JK_ROWS);
    const status = callout();
    const kv = readouts(['Q changes in the last clock cycle']);
    const setJ = (v: boolean) => { c.set(J, v ? 1 : 0); jToggle.set(v); };
    const setK = (v: boolean) => { c.set(K, v ? 1 : 0); kToggle.set(v); };
    const jToggle = new Toggle({ label: 'J', value: true, onChange: setJ });
    const kToggle = new Toggle({ label: 'K', value: true, onChange: setK });
    const clkBtn = new Button({ label: 'Hold the clock high', kind: 'primary', onPress: () => { auto = false; autoToggle.set(false); c.set(CLK, 1); }, onRelease: () => c.set(CLK, 0) });
    const autoToggle = new Toggle({ label: 'Auto clock', value: true, onChange: (v) => { auto = v; if (!v) c.set(CLK, 0); } });
    const periodSlider = new Slider({ label: 'Clock period', min: 40, max: 300, step: 10, value: half * 2, format: (v) => `${v} gate delays`, onInput: (v) => (half = Math.round(v / 2)) });
    const slowToggle = new Toggle({ label: 'Slow motion', onChange: (v) => (slow = v) });

    // ---- the 74LS76 on its own (flip-flop 1 wired up, flip-flop 2 unused) ----
    const c76 = new Circuit();
    const J1 = c76.input('1J', 1), K1 = c76.input('1K', 1), CLK1 = c76.input('1CLK', 0);
    const PRE1 = c76.input('1PRE̅', 1), CLR1 = c76.input('1CLR̅', 1);
    const VCC76 = c76.input('VCC', 1), GND76 = c76.input('GND', 0);
    const Q1 = c76.net('1Q', 0), Q1n = c76.net('1Q̅', 1);
    ls76(c76, { J: J1, K: K1, CLK: CLK1, PRE: PRE1, CLR: CLR1, Q: Q1, Qn: Q1n }, () => 1, 'U1A');
    c76.settle();
    let last76 = 'Pulse 1CLK (pin 1): Q changes when the clock falls. PRE̅ and CLR̅ act at once, without the clock.';
    const act76 = (n: typeof J1) => {
      const before = Q1.value;
      const clkFell = n === CLK1 && CLK1.value === 1;
      c76.toggle(n);
      c76.settle();
      if (n === CLK1) last76 = clkFell ? `1CLK fell: the flip-flop acted on J = ${J1.value}, K = ${K1.value}, so Q went ${before} → ${Q1.value}.` : '1CLK rose: nothing happens yet; the 74LS76 changes on the falling edge (the bubble on its clock pin).';
      else if (n === PRE1 || n === CLR1) last76 = `${n.name} = ${n.value}: preset and clear are asynchronous, so Q = ${Q1.value} straight away.`;
      else last76 = `J = ${J1.value}, K = ${K1.value}: on the next falling edge of 1CLK the flip-flop will ${['hold', 'reset', 'set', 'toggle'][jkRow(J1.value, K1.value)]}${PRE1.value === 1 && CLR1.value === 1 ? '' : ' (once PRE̅ and CLR̅ are both high again)'}.`;
      update76();
    };
    const sch76 = new Schematic(c76, { width: 440, height: 236 });
    const pinNet: Record<number, typeof J1 | undefined> = { 1: CLK1, 2: PRE1, 3: CLR1, 4: J1, 5: VCC76, 13: GND76, 14: Q1n, 15: Q1, 16: K1 };
    const pin = (n: number) => ({ name: `${n} ${LS76_PINS[n]}`, net: pinNet[n], bubble: n === 1 || n === 6 || n === 2 || n === 3 || n === 7 || n === 8 });
    const chip76 = sch76.chip({ x: 160, y: 24 }, { label: '74LS76', sublabel: 'dual JK', width: 140, height: 190, left: [1, 2, 3, 4, 5, 6, 7, 8].map(pin), right: [16, 15, 14, 13, 12, 11, 10, 9].map(pin) });
    const inputs76: [number, typeof J1, string, boolean][] = [[1, CLK1, 'CLK', true], [2, PRE1, 'PRE̅', false], [3, CLR1, 'CLR̅', false], [4, J1, 'J', false]];
    for (const [p, net, label, momentary] of inputs76) {
      const at = chip76.left[p - 1];
      sch76.wire(net, [112, at.y], at);
      sch76.switch(net, [112, at.y], { label, momentary, onToggle: act76 });
    }
    sch76.wire(VCC76, chip76.left[4], [128, chip76.left[4].y]);
    sch76.text('+5 V', [124, chip76.left[4].y], { anchor: 'end', size: 10, class: 'gate-label' });
    // K (pin 16) comes round from a switch above the chip
    const k16 = chip76.right[0];
    sch76.wire(K1, [112, 10], [336, 10], [336, k16.y], k16);
    sch76.switch(K1, [112, 10], { label: 'K', onToggle: act76 });
    sch76.wire(Q1, chip76.right[1], [362, chip76.right[1].y]);
    sch76.probe(Q1, [370, chip76.right[1].y], { label: 'Q', color: 'red' });
    sch76.wire(Q1n, chip76.right[2], [362, chip76.right[2].y]);
    sch76.probe(Q1n, [370, chip76.right[2].y], { label: 'Q̅', color: 'red' });
    sch76.wire(GND76, chip76.right[3], [330, chip76.right[3].y]);
    sch76.text('GND', [334, chip76.right[3].y], { anchor: 'start', size: 10, class: 'gate-label' });
    sch76.text('flip-flop 2 (pins 6-12) unused here', [230, 230], { size: 10, class: 'gate-label' });
    d.add(sch76.autoUpdate());
    const tt76 = truthTable(['PRE̅', 'CLR̅', 'CLK', 'J', 'K', 'Q', ''], LS76_ROWS);
    const status76 = callout();
    const update76 = () => {
      tt76.set(ls76Row(PRE1.value, CLR1.value, J1.value, K1.value));
      const both = PRE1.value === 0 && CLR1.value === 0;
      setText(status76, both ? 'PRE̅ and CLR̅ are both low: Q and Q̅ are both forced high. Never do this in normal use (both must be high to count).' : last76);
    };
    d.add(c76.onChange(update76));
    update76();

    const update = () => {
      tt.set(jkRow(J.value, K.value));
      kv.set('Q changes in the last clock cycle', lastCycleToggles < 0 ? '—' : `${lastCycleToggles}`);
      const toggle = J.value === 1 && K.value === 1;
      let msg: string;
      if (auto) msg = `While CLK is high the master is open and the slave is closed: the master looks at J, K and the slave's outputs, which cannot change, so it changes at most once. When CLK falls the master closes, ~CLK opens the slave, and the slave copies the master. ${toggle ? 'With J = K = 1, Q toggles exactly once per clock, on the falling edge.' : 'Q changes only on falling edges.'} Turn off the auto clock and hold the clock high as long as you like.`;
      else if (CLK.value === 1) msg = `CLK is high: the master is open and the slave is closed (~CLK = 0). The master's AND gates see J, K and the slave's outputs, which cannot change now${toggle ? `, so with J = K = 1 the master flips to the opposite of Q exactly once: Qm = ${Qm.value}. Hold the clock as long as you like, nothing races` : `: Qm = ${Qm.value}`}.`;
      else msg = `CLK is low: the master is closed and ~CLK = 1 opens the slave, which copies the master: Q = Qm = ${Q.value}. The output changes when the clock falls (a falling-edge flip-flop, drawn with a bubble on the clock input).`;
      setText(status, msg);
    };

    d.add(
      stepLoop({
        rate: () => RATE,
        slow: () => slow,
        step: () => {
          if (auto && ++phase >= half) {
            phase = 0;
            c.set(CLK, CLK.value === 1 ? 0 : 1);
          }
          c.step();
          for (const g of guards) g.check();
          if (Q.value !== prevQ) togglesThisCycle++;
          prevQ = Q.value;
          const clk = CLK.value === 1 ? 1 : 0;
          if (clk && !prevClk) {
            lastCycleToggles = togglesThisCycle;
            togglesThisCycle = 0;
          }
          prevClk = clk;
          rec.sample();
        },
        frame: () => {
          scope.draw(rec.samples, { window: WINDOW });
          update();
        },
      }),
    );

    root.append(
      h(
        'div',
        { class: 'lab-grid two' },
        panel(
          'Master-slave JK flip-flop',
          { accent: 'red', chips: '74LS11 (3-input AND) · 74LS02 ×2 latches · 74LS08 · 74LS04' },
          sch.el,
          row(jToggle.el, kToggle.el, clkBtn.el, autoToggle.el),
          row(periodSlider.el, slowToggle.el),
          note('Yellow LEDs: the master latch. Red LEDs: the slave, which is the output. Hold CLK in the drawing or with the button: Qm flips once, Q waits for the falling edge.'),
        ),
        h(
          'div',
          { class: 'lab-stack' },
          panel('Truth table', { accent: 'gray' }, tt.el, status, kv.el),
          panel('Timing diagram', { accent: 'gray' }, scope.el, note('Qm changes right after CLK rises; Q follows when CLK falls. Even with a clock pulse hundreds of gate delays long there is only one change per cycle.')),
        ),
      ),
      h(
        'div',
        { class: 'lab-grid two' },
        panel('On a chip: 74LS76', { accent: 'red', chips: '74LS76: two JK flip-flops, falling-edge clock, asynchronous active-low PRE̅ and CLR̅' }, sch76.el, note('Click J, K, PRE̅ and CLR̅ in the drawing; hold CLK and let go to clock it. The bubbles mark the active-low pins and the falling-edge clock.')),
        h(
          'div',
          { class: 'lab-stack' },
          panel('74LS76 function table', { accent: 'gray' }, tt76.el, status76),
          note('Ben ends the video with this chip: the next video chains its flip-flops into a binary counter. eater.net notes that the 74LS76 is hard to find; the 74LS107 works the same but has a different pinout and no preset.'),
        ),
      ),
    );
    update();
    return d.dispose;
  },
});
