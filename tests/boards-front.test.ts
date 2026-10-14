import { describe, expect, it } from 'vitest';
import bus from '../src/breadboard/boards/bus.board';
import clock, { hzFromPot, potFromHz } from '../src/breadboard/boards/clock.board';
import pc from '../src/breadboard/boards/pc.board';
import { BUS_W, ROW, composeComputer } from '../src/breadboard/computer-layout';
import { RAIL_COLUMNS, holeXY, toScene } from '../src/breadboard/geometry';
import { layoutBounds, partPins, validateLayout, type Layout, type ModuleBoardDef, type Part } from '../src/breadboard/layout';
import { GND_NET, VCC_NET, buildNets, pinNet, unpoweredChips, type Netlist } from '../src/breadboard/nets';
import { BreadboardSim } from '../src/breadboard/sim/engine';
import { Machine } from '../src/sim/machine';

// ---------------------------------------------------------------------------
// helpers

const partsOf = <K extends Part['kind']>(L: Layout, kind: K) => L.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind);
const portNames = (L: Layout) => new Set(partsOf(L, 'port').map((p) => p.name));

/** Every part leg on the net of (part, pin), as "U3.7" / "R1.a" (wires and ports left out). */
function pinsOnNet(L: Layout, nets: Netlist, partId: string, pin: string | number): string[] {
  const id = pinNet(L, nets, partId, pin);
  const out: string[] = [];
  for (const p of L.parts) {
    if (p.kind === 'wire' || p.kind === 'port' || p.kind === 'text') continue;
    for (const pp of partPins(p)) if (nets.netOf(p.board, pp.hole) === id) out.push(`${p.id}.${p.kind === 'chip' ? pp.number : pp.name}`);
  }
  return out;
}

function staticChecks(def: ModuleBoardDef) {
  const L = def.layout;
  const nets = buildNets(L);
  expect(validateLayout(L)).toEqual([]);
  expect(unpoweredChips(L, nets)).toEqual([]);
  expect(nets.shorted).toBe(false);
  // every LED is bound to the simulator, every binding is to a real part
  const leds = partsOf(L, 'led').map((p) => p.id).sort();
  expect(Object.keys(def.live.leds).sort()).toEqual(leds);
  for (const id of Object.keys(def.live.controls)) expect(L.parts.some((p) => p.id === id && ['button', 'slide', 'dip', 'pot'].includes(p.kind))).toBe(true);
  // every interactive part has a binding
  for (const p of L.parts) if (['button', 'slide', 'dip', 'pot'].includes(p.kind)) expect(def.live.controls[p.id], p.id).toBeDefined();
  return nets;
}

const sceneY = (L: Layout, p: Part & { hole: string }) => toScene(L.boards.find((b) => b.id === p.board)!.place, holeXY(p.hole)).y;

// ---------------------------------------------------------------------------
// Clock

describe('clock board', () => {
  const L = clock.layout;
  const nets = staticChecks(clock);
  const net = (u: string, p: string | number) => pinNet(L, nets, u, p);

  it('has Ben’s chips, one board at the module origin, and exposes CLK, ~CLK and HLT', () => {
    const chips = Object.fromEntries(partsOf(L, 'chip').map((p) => [p.id, p.chip]));
    expect(chips).toEqual({ U1: 'NE555', U2: 'NE555', U3: 'NE555', U4: '74LS04', U5: '74LS08', U6: '74LS32' });
    expect(L.boards).toHaveLength(1);
    expect(L.boards[0].place).toMatchObject({ x: 0, y: 0 });
    expect([...portNames(L)].sort()).toEqual(['CLK', 'HLT', '~CLK']);
    expect(partsOf(L, 'chip').find((p) => p.id === 'U1')!.params).toEqual({ mode: 'astable', halfPeriod: 2000 });
    expect(partsOf(L, 'chip').find((p) => p.id === 'U2')!.params).toEqual({ mode: 'monostable', pulseWidth: 1500 });
    expect(partsOf(L, 'chip').find((p) => p.id === 'U3')!.params).toEqual({ mode: 'bistable' });
  });

  it('U1 astable: R1, R2 + RV1, C6, C5, RESET high', () => {
    const dis = net('U1', 'DIS'), thr = net('U1', 'THR');
    expect(net('U1', 'TRIG')).toBe(thr);
    expect(net('U1', '~RESET')).toBe(VCC_NET);
    expect([net('R1', 'a'), net('R1', 'b')].sort()).toEqual([VCC_NET, dis].sort());
    // R2 from DIS to the pot wiper; the pot's pin 1 on THR/TRIG, pin 3 open
    const wiper = net('RV1', 'wiper');
    expect([net('R2', 'a'), net('R2', 'b')].sort()).toEqual([dis, wiper].sort());
    expect(net('RV1', 'a')).toBe(thr);
    expect(pinsOnNet(L, nets, 'RV1', 'b')).toEqual(['RV1.b']); // pin 3 open
    expect([net('C6', 'a'), net('C6', 'b')]).toEqual([thr, GND_NET]); // + on the timing node
    expect(partsOf(L, 'capacitor').find((p) => p.id === 'C6')).toMatchObject({ farads: 1e-6, polarized: true });
    expect([net('C5', 'a'), net('C5', 'b')]).toEqual([net('U1', 'CV'), GND_NET]);
    expect(partsOf(L, 'pot')[0]).toMatchObject({ id: 'RV1', ohms: 1e6 });
  });

  it('U2 monostable: R3 pull-up, SW1 to GND, R4/C3 timing, C2 on CV', () => {
    const trig = net('U2', 'TRIG'), thr = net('U2', 'THR');
    expect(net('U2', 'DIS')).toBe(thr);
    expect(net('U2', '~RESET')).toBe(VCC_NET);
    expect([net('R3', 'a'), net('R3', 'b')]).toEqual([trig, VCC_NET]);
    expect([net('R4', 'a'), net('R4', 'b')]).toEqual([thr, VCC_NET]);
    expect([net('C3', 'a'), net('C3', 'b')]).toEqual([thr, GND_NET]);
    expect([net('C2', 'a'), net('C2', 'b')]).toEqual([net('U2', 'CV'), GND_NET]);
    expect([net('SW1', 'a'), net('SW1', 'b')].sort()).toEqual([GND_NET, trig].sort());
    // pressing the button grounds TRIG
    const pressed = buildNets(L, { buttons: new Set(['SW1']) });
    expect(pinNet(L, pressed, 'U2', 'TRIG')).toBe(GND_NET);
    const ohms = Object.fromEntries(partsOf(L, 'resistor').map((p) => [p.id, p.ohms]));
    expect(ohms).toMatchObject({ R1: 1000, R2: 1000, R3: 1000, R4: 1e6, R5: 1000, R6: 1000, R7: 220 });
    const farads = Object.fromEntries(partsOf(L, 'capacitor').map((p) => [p.id, p.farads]));
    expect(farads).toEqual({ C2: 1e-8, C3: 1e-7, C4: 1e-8, C5: 1e-8, C6: 1e-6 });
  });

  it('U3 bistable: R5/R6 pull-ups, SW2 common to GND, THR to GND, DIS open', () => {
    const trig = net('U3', 'TRIG'), reset = net('U3', '~RESET');
    expect([net('R5', 'a'), net('R5', 'b')]).toEqual([trig, VCC_NET]);
    expect([net('R6', 'a'), net('R6', 'b')]).toEqual([reset, VCC_NET]);
    expect(net('U3', 'THR')).toBe(GND_NET);
    expect([net('C4', 'a'), net('C4', 'b')]).toEqual([net('U3', 'CV'), GND_NET]);
    expect(pinsOnNet(L, nets, 'U3', 'DIS')).toEqual(['U3.7']);
    // SW2: a -> RESET (position 0, manual), b -> TRIG (position 1, auto), common -> GND
    expect(net('SW2', 'a')).toBe(reset);
    expect(net('SW2', 'b')).toBe(trig);
    expect(pinNet(L, nets, 'SW2', 'common')).toBe(GND_NET);
    expect(pinNet(L, buildNets(L, { slides: new Map([['SW2', 1]]) }), 'U3', 'TRIG')).toBe(GND_NET);
    expect(pinNet(L, buildNets(L, { slides: new Map([['SW2', 0]]) }), 'U3', '~RESET')).toBe(GND_NET);
  });

  it('clock logic: CLK = ((AST & SEL) | (MONO & !SEL)) & !HLT, ~CLK = !CLK', () => {
    expect(net('U5', '1A')).toBe(net('U1', 'OUT')); // U5A = AST & SEL
    expect(net('U5', '1B')).toBe(net('U3', 'OUT'));
    expect(net('U4', '1A')).toBe(net('U3', 'OUT')); // U4A = !SEL
    expect(net('U5', '2A')).toBe(net('U2', 'OUT')); // U5B = MONO & !SEL
    expect(net('U5', '2B')).toBe(net('U4', '1Y'));
    expect(net('U6', '1A')).toBe(net('U5', '1Y')); // U6A = U5A | U5B
    expect(net('U6', '1B')).toBe(net('U5', '2Y'));
    expect(net('U4', '4A')).toBe('port:HLT'); // U4D = !HLT
    expect(net('U5', '3A')).toBe(net('U6', '1Y')); // U5C = U6A & U4D = CLK
    expect(net('U5', '3B')).toBe(net('U4', '4Y'));
    expect(net('U5', '3Y')).toBe('port:CLK');
    expect(net('U4', '6A')).toBe('port:CLK'); // U4F = ~CLK
    expect(net('U4', '6Y')).toBe('port:~CLK');
    // the internal nets really are distinct
    const internal = [net('U1', 'OUT'), net('U2', 'OUT'), net('U3', 'OUT'), net('U4', '1Y'), net('U5', '1Y'), net('U5', '2Y'), net('U6', '1Y'), net('U4', '4Y')];
    expect(new Set(internal).size).toBe(internal.length);
    for (const n of internal) expect([VCC_NET, GND_NET].includes(n) || n.startsWith('port:')).toBe(false);
  });

  it('unused gate inputs are tied to GND', () => {
    for (const [u, pins] of [['U4', ['2A', '3A', '5A']], ['U5', ['4A', '4B']], ['U6', ['2A', '2B', '3A', '3B', '4A', '4B']]] as const)
      for (const p of pins) expect(net(u, p), `${u}.${p}`).toBe(GND_NET);
  });

  it('LEDs: blue D1 (220R) on CLK and one on each 555 output, cathodes on GND', () => {
    const leds = partsOf(L, 'led');
    expect(leds.map((p) => p.id).sort()).toEqual(['D1', 'D_AST', 'D_BI', 'D_MONO']);
    expect(leds.every((p) => p.color === 'blue')).toBe(true);
    for (const p of leds) expect(net(p.id, 'cathode')).toBe(GND_NET);
    const via = (r: string, led: string, src: string) => expect([net(r, 'a'), net(r, 'b')].sort()).toEqual([src, net(led, 'anode')].sort());
    via('R7', 'D1', 'port:CLK');
    via('R_AST', 'D_AST', net('U1', 'OUT'));
    via('R_MONO', 'D_MONO', net('U2', 'OUT'));
    via('R_BI', 'D_BI', net('U3', 'OUT'));
    expect(Object.keys(clock.live.leds)).toHaveLength(4);
    expect(Object.keys(clock.live.controls).sort()).toEqual(['RV1', 'SW1', 'SW2']);
  });

  it('live bindings drive the Machine like Ben’s front panel', () => {
    const m = new Machine();
    const c = m.computer;
    const ctl = clock.live.controls;
    const sw1 = ctl.SW1 as Extract<typeof ctl.SW1, { kind: 'button' }>;
    const sw2 = ctl.SW2 as Extract<typeof ctl.SW2, { kind: 'slide' }>;
    const rv1 = ctl.RV1 as Extract<typeof ctl.RV1, { kind: 'pot' }>;
    const led = (id: string) => clock.live.leds[id](c, m);
    // manual mode: a press is a rising edge, the release the falling edge
    m.setMode('manual');
    expect(sw2.get(m)).toBe(0);
    expect(led('D_BI')).toBe(false);
    sw1.press(m);
    expect(c.clk).toBe(1);
    expect(led('D1')).toBe(true);
    expect(led('D_MONO')).toBe(true);
    expect(led('D_AST')).toBe(false);
    sw1.release!(m);
    expect(c.clk).toBe(0);
    expect(led('D1')).toBe(false);
    // auto: the slide starts the astable, the button does nothing
    sw2.set(m, 1);
    expect(m.mode).toBe('auto');
    expect(m.running).toBe(true);
    expect(sw2.get(m)).toBe(1);
    expect(led('D_BI')).toBe(true);
    sw1.press(m);
    expect(c.clk).toBe(0);
    sw2.set(m, 0);
    expect(m.mode).toBe('manual');
    expect(sw2.get(m)).toBe(0);
    // speed pot: f = 1.44 / ((1k + 2(1k + t·1M)) · 1uF)
    expect(hzFromPot(0)).toBeCloseTo(480, 0);
    expect(hzFromPot(1)).toBeCloseTo(0.719, 3);
    rv1.set(m, 0.25);
    expect(m.hz).toBeCloseTo(hzFromPot(0.25), 6);
    expect(rv1.get(m)).toBeCloseTo(0.25, 6);
    m.setHz(2);
    expect(rv1.get(m)).toBeCloseTo(potFromHz(2), 9);
    m.setHz(1000);
    expect(rv1.get(m)).toBe(0); // clamped
    m.setHz(0.1);
    expect(rv1.get(m)).toBe(1);
  });

  it('simulates on the chip-level engine: step button, auto clock, HLT', () => {
    const sim = new BreadboardSim(L);
    sim.setPort('HLT', 0);
    sim.step(20);
    expect(sim.problems()).toEqual([]);
    // manual (SW2 at 0): CLK low until the step button fires the one-shot
    expect(sim.portLevel('CLK')).toBe(0);
    expect(sim.portLevel('~CLK')).toBe(1);
    expect(sim.ledLit('D_BI')).toBe(false);
    sim.press('SW1');
    sim.step(20);
    expect(sim.portLevel('CLK')).toBe(1);
    expect(sim.portLevel('~CLK')).toBe(0);
    expect(sim.ledLit('D1')).toBe(true);
    expect(sim.ledLit('D_MONO')).toBe(true);
    sim.release('SW1');
    sim.step(400);
    expect(sim.portLevel('CLK')).toBe(1); // the 1500-delay pulse is still running
    sim.step(1200);
    expect(sim.portLevel('CLK')).toBe(0);
    expect(sim.ledLit('D1')).toBe(false);
    // auto: CLK follows the astable (half period 2000)
    sim.setSlide('SW2', 1);
    sim.step(20);
    expect(sim.ledLit('D_BI')).toBe(true);
    const seen: number[] = [];
    let edges = 0;
    let last = sim.portLevel('CLK');
    for (let t = 0; t < 80; t++) {
      sim.step(100);
      const l = sim.portLevel('CLK');
      if (l !== last) edges++;
      last = l;
      seen.push(l === 1 ? 1 : 0);
      expect(l === 0 || l === 1).toBe(true);
      expect(sim.portLevel('~CLK')).toBe(l === 1 ? 0 : 1);
      expect(sim.ledLit('D1')).toBe(l === 1);
      expect(sim.ledLit('D_AST')).toBe(sim.pinLevel('U1', 'OUT') === 1);
    }
    expect(edges).toBeGreaterThanOrEqual(3); // 8000 delays = two periods
    expect(seen).toContain(0);
    expect(seen).toContain(1);
    // the step button does nothing in auto mode
    // HLT holds CLK low
    sim.setPort('HLT', 1);
    sim.step(20);
    for (let t = 0; t < 50; t++) {
      sim.step(100);
      expect(sim.portLevel('CLK')).toBe(0);
      expect(sim.portLevel('~CLK')).toBe(1);
    }
    sim.setPort('HLT', 0);
    edges = 0;
    last = sim.portLevel('CLK');
    for (let t = 0; t < 60; t++) {
      sim.step(100);
      if (sim.portLevel('CLK') !== last) edges++;
      last = sim.portLevel('CLK');
    }
    expect(edges).toBeGreaterThanOrEqual(2);
    // back to manual: the astable no longer reaches CLK
    sim.setSlide('SW2', 0);
    sim.step(20);
    for (let t = 0; t < 50; t++) {
      sim.step(100);
      expect(sim.portLevel('CLK')).toBe(0);
    }
    expect(sim.problems()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Program counter

describe('program counter board', () => {
  const L = pc.layout;
  const nets = staticChecks(pc);
  const net = (u: string, p: string | number) => pinNet(L, nets, u, p);

  it('is wired like Ben’s schematic', () => {
    expect(L.boards).toHaveLength(1);
    expect(L.boards[0].place).toMatchObject({ x: 0, y: 0 });
    expect(Object.fromEntries(partsOf(L, 'chip').map((p) => [p.id, p.chip]))).toEqual({ U35: '74LS161', U36: '74LS245' });
    expect(net('U35', '~MR')).toBe('port:~CLR');
    expect(net('U35', 'CP')).toBe('port:CLK');
    expect(net('U35', 'CEP')).toBe('port:CE');
    expect(net('U35', 'CET')).toBe('port:CE');
    expect(net('U35', '~PE')).toBe('port:~J');
    expect(net('U36', 'DIR')).toBe(GND_NET); // B -> A
    expect(net('U36', '~OE')).toBe('port:~CO');
    for (let k = 0; k < 4; k++) {
      expect(net('U35', `P${k}`)).toBe(`port:BUS${k}`);
      expect(net('U36', `A${8 - k}`)).toBe(`port:BUS${k}`);
      const q = net('U35', `Q${k}`);
      expect(q.startsWith('port:') || q === VCC_NET || q === GND_NET).toBe(false);
      expect(net('U36', `B${8 - k}`)).toBe(q);
      expect(net(`D${82 + k}`, 'anode')).toBe(q);
      expect(net(`D${82 + k}`, 'cathode')).toBe(GND_NET);
      expect(net('U36', `B${k + 1}`)).toBe(GND_NET); // unused inputs
    }
    expect(new Set([0, 1, 2, 3].map((k) => net('U35', `Q${k}`))).size).toBe(4);
    expect(pinsOnNet(L, nets, 'U35', 'TC')).toEqual(['U35.15']); // unused
    expect([...portNames(L)].sort()).toEqual(['BUS0', 'BUS1', 'BUS2', 'BUS3', 'CE', 'CLK', '~CLR', '~CO', '~J'].sort());
  });

  it('has 4 green LEDs bound to the PC bits', () => {
    const leds = partsOf(L, 'led');
    expect(leds).toHaveLength(4);
    expect(leds.every((p) => p.color === 'green')).toBe(true);
    // MSB on the left
    const x = (id: string) => holeXY(leds.find((p) => p.id === id)!.anode).x;
    expect(x('D85')).toBeLessThan(x('D84'));
    expect(x('D83')).toBeLessThan(x('D82'));
    const m = new Machine();
    for (const v of [0, 5, 10, 15]) {
      m.computer.pc = v;
      for (let k = 0; k < 4; k++) expect(pc.live.leds[`D${82 + k}`](m.computer, m)).toBe(((v >> k) & 1) === 1);
    }
  });

  it('counts, loads, clears and drives the bus on the chip-level engine', () => {
    const sim = new BreadboardSim(L);
    const value = () => [0, 1, 2, 3].reduce((v, k) => v | ((sim.ledLit(`D${82 + k}`) ? 1 : 0) << k), 0);
    sim.setPort('CLK', 0);
    sim.setPort('~CLR', 0);
    sim.setPort('CE', 0);
    sim.setPort('~J', 1);
    sim.setPort('~CO', 1);
    sim.settle();
    expect(value()).toBe(0);
    sim.setPort('~CLR', 1);
    sim.pulse('CLK');
    expect(value()).toBe(0); // CE low: hold
    sim.setPort('CE', 1);
    for (let i = 1; i <= 17; i++) {
      sim.pulse('CLK');
      expect(value()).toBe(i & 15); // wraps 15 -> 0
    }
    // CO: the 245 puts the count on BUS0-3
    expect(sim.portLevel('BUS0')).toBe('Z');
    sim.setPort('~CO', 0);
    sim.settle();
    expect([0, 1, 2, 3].map((k) => sim.portLevel(`BUS${k}`))).toEqual([1, 0, 0, 0]); // 17 & 15 = 1
    sim.setPort('~CO', 1);
    sim.settle();
    expect(sim.portLevel('BUS0')).toBe('Z');
    // J: load BUS0-3 on the rising edge (load beats count)
    sim.setPort('~J', 0);
    [0, 1, 0, 1].forEach((bit, k) => sim.setPort(`BUS${k}`, bit as 0 | 1));
    sim.pulse('CLK');
    for (let k = 0; k < 4; k++) sim.setPort(`BUS${k}`, null);
    sim.setPort('~J', 1);
    expect(value()).toBe(10);
    // asynchronous clear
    sim.setPort('~CLR', 0);
    sim.settle();
    expect(value()).toBe(0);
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bus

describe('bus', () => {
  const L = bus.layout;
  const nets = staticChecks(bus);
  const signal = L.boards.filter((b) => b.rails === 'signal');

  it('is 8 rail lines on boards turned 90°, inside the bus slot', () => {
    expect(signal).toHaveLength(4);
    for (const b of L.boards) expect(b.place.rotate).toBe(90);
    const bounds = layoutBounds(L);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.w).toBeLessThanOrEqual(BUS_W);
    expect(bounds.h).toBeGreaterThanOrEqual(7 * ROW); // the full height of the scene
    const railBit: Record<string, number> = { 'hi:bn': 7, 'hi:bp': 6, 'hi:tp': 5, 'hi:tn': 4, 'lo:bn': 3, 'lo:bp': 2, 'lo:tp': 1, 'lo:tn': 0 };
    for (const b of signal) {
      const half = b.id.includes('hi') ? 'hi' : 'lo';
      for (const r of ['tn', 'tp', 'bp', 'bn']) expect(nets.netOf(b.id, `${r}${RAIL_COLUMNS[0]}`)).toBe(`port:BUS${railBit[`${half}:${r}`]}`);
    }
    // the two halves of the bus line up: BUS7 on the left ... BUS0 on the right
    const x = (bit: number) => {
      const p = partsOf(L, 'port').find((q) => q.name === `BUS${bit}` && q.board.startsWith('bus-'))!;
      return toScene(L.boards.find((b) => b.id === p.board)!.place, holeXY(p.hole)).x;
    };
    for (let bit = 7; bit > 0; bit--) expect(x(bit)).toBeLessThan(x(bit - 1));
  });

  it('exposes every bit to both module columns in each module row', () => {
    const ports = partsOf(L, 'port').filter((p) => signal.some((b) => b.id === p.board));
    expect(ports).toHaveLength(5 * 16);
    for (let row = 0; row < 5; row++) {
      const inRow = ports.filter((p) => {
        const y = sceneY(L, p);
        return y > row * ROW && y < row * ROW + 18;
      });
      for (const side of ['bottom', 'top'] as const) expect(inRow.filter((p) => p.side === side).map((p) => p.name).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((k) => `BUS${k}`));
      // tags at one height never point the same way from neighbouring rails
      const ys = new Map<number, number>();
      for (const p of inRow) ys.set(sceneY(L, p), (ys.get(sceneY(L, p)) ?? 0) + 1);
      expect([...ys.values()].every((n) => n === 2)).toBe(true);
    }
  });

  it('has 10k pull-downs R8-R15 and red LEDs with 220R on a real GND rail', () => {
    const leds = L.boards.find((b) => b.id === 'bus-leds')!;
    expect(leds.rails ?? 'power').toBe('power');
    for (let k = 0; k < 8; k++) {
      const r = partsOf(L, 'resistor').find((p) => p.id === `R${8 + k}`)!;
      expect(r.ohms).toBe(10_000);
      expect(r.board).toBe('bus-leds');
      expect([pinNet(L, nets, r.id, 'a'), pinNet(L, nets, r.id, 'b')]).toEqual([`port:BUS${k}`, GND_NET]);
      expect(r.b.startsWith('tn')).toBe(true); // in the GND rail itself
      const d = partsOf(L, 'led').find((p) => p.id === `D${74 + k}`)!;
      expect(d.color).toBe('red');
      expect(d.cathode.startsWith('bn')).toBe(true);
      expect(pinNet(L, nets, d.id, 'cathode')).toBe(GND_NET);
      const rb = partsOf(L, 'resistor').find((p) => p.id === `RB${k}`)!;
      expect(rb.ohms).toBe(220);
      expect([pinNet(L, nets, rb.id, 'a'), pinNet(L, nets, rb.id, 'b')]).toEqual([`port:BUS${k}`, pinNet(L, nets, d.id, 'anode')]);
    }
    expect(partsOf(L, 'led')).toHaveLength(8);
    expect(Object.keys(bus.live.leds)).toHaveLength(8);
    const m = new Machine();
    m.computer.setManualControl(0); // no module drives the bus ...
    m.computer.busInput = 0xa5; // ... except these test switches
    expect(m.computer.bus.value).toBe(0xa5);
    for (let k = 0; k < 8; k++) expect(bus.live.leds[`D${74 + k}`](m.computer, m)).toBe(((0xa5 >> k) & 1) === 1);
    m.computer.busInput = null; // undriven: the pull-downs make it 0
    for (let k = 0; k < 8; k++) expect(bus.live.leds[`D${74 + k}`](m.computer, m)).toBe(false);
  });

  it('pulls undriven lines low and lights the LED of a driven line (engine)', () => {
    const sim = new BreadboardSim(L);
    sim.settle();
    for (let k = 0; k < 8; k++) {
      expect(sim.portLevel(`BUS${k}`)).toBe(0);
      expect(sim.ledLit(`D${74 + k}`)).toBe(false);
    }
    sim.setPort('BUS5', 1);
    sim.settle();
    for (let k = 0; k < 8; k++) expect(sim.ledLit(`D${74 + k}`)).toBe(k === 5);
    sim.setPort('BUS5', null);
    sim.settle();
    expect(sim.ledLit('D79')).toBe(false);
    expect(sim.problems({ floatingInputs: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Together

describe('PC on the bus', () => {
  it('joins by port name: CO shows the count on the bus LEDs', () => {
    const scene = composeComputer([pc, bus]);
    expect(validateLayout(scene.layout)).toEqual([]);
    const sim = new BreadboardSim(scene.layout);
    sim.setPort('CLK', 0);
    sim.setPort('~CLR', 0);
    sim.setPort('CE', 1);
    sim.setPort('~J', 1);
    sim.setPort('~CO', 1);
    sim.step(20);
    sim.setPort('~CLR', 1);
    for (let i = 0; i < 6; i++) sim.pulse('CLK');
    sim.setPort('~CO', 0);
    sim.step(20);
    const busValue = () => [0, 1, 2, 3, 4, 5, 6, 7].reduce((v, k) => v | ((sim.ledLit(`bus/D${74 + k}`) ? 1 : 0) << k), 0);
    expect(busValue()).toBe(6);
    sim.setPort('~CO', 1);
    sim.step(20);
    expect(busValue()).toBe(0);
  });
});
