import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/breadboard/examples';
import { hzFromPot } from '../src/breadboard/boards/clock.board';
import { circuitExhibit, computerExhibit, exampleExhibit, exhibitHash, parseExhibitHash, speedDial, type Exhibit, type Pointer } from '../src/vr/exhibits';
import { buildComputerModel, type ComputerModel, type ControlHit } from '../src/vr/model';

/** A press and release, as a click on a control. */
const click = (e: Exhibit, hit: ControlHit) => e.begin(hit)?.end(true);

/** A stand-in model that records what an exhibit shows on it. */
function recorder() {
  const shown = { leds: new Map<string, boolean>(), segs: new Map<string, number>(), controls: new Map<string, number>() };
  const model = {
    setLed: (id: string, on: boolean) => shown.leds.set(id, on),
    setSeg7: (id: string, byte: number) => shown.segs.set(id, byte),
    setControl: (id: string, v: number) => shown.controls.set(id, v),
  } as unknown as ComputerModel;
  return { model, shown };
}

describe('what the VR page shows, from its #hash', () => {
  it('reads the computer, an example, or a circuit from a share link', () => {
    expect(parseExhibitHash('')).toEqual({ kind: 'computer' });
    expect(parseExhibitHash('#example/counter')).toEqual({ kind: 'example', id: 'counter' });
    expect(parseExhibitHash('#example/no-such-thing')).toEqual({ kind: 'computer' });
    expect(parseExhibitHash('#c1.abc')).toEqual({ kind: 'circuit', code: 'c1.abc' });
    expect(parseExhibitHash('#/sandbox/c1.abc')).toEqual({ kind: 'circuit', code: 'c1.abc' }); // the sandbox's own link
    for (const h of ['#example/sr-latch', '#c1.xyz']) expect(exhibitHash(parseExhibitHash(h))).toBe(h);
    expect(exhibitHash({ kind: 'computer' })).toBe('');
  });
});

describe('a sandbox circuit in VR', () => {
  it('runs the SR latch: S sets Q, which stays on, and R resets it', () => {
    const e = circuitExhibit('SR latch', EXAMPLES.find((x) => x.id === 'sr-latch')!.build());
    const q = () => e.sim().ledLit('D1');
    expect(q()).toBe(false);
    const s = e.begin({ part: 'SW1' })!;
    expect(q()).toBe(true);
    const { model, shown } = recorder();
    e.show(model);
    expect(shown.controls.get('SW1')).toBe(1); // the button shows pressed
    expect(shown.leds.get('D1')).toBe(true);
    s.end(true);
    expect(q()).toBe(true);
    click(e, { part: 'SW2' });
    expect(q()).toBe(false);
  });

  it('loads the DIP switches into the register with LOAD', () => {
    const e = exampleExhibit('register') as ReturnType<typeof circuitExhibit>;
    click(e, { part: 'SW1', bit: 0 });
    click(e, { part: 'SW1', bit: 2 });
    expect(e.describe({ part: 'SW1', bit: 2 }, 'screen')).toBe('D0-D3 switch 3: ON');
    const lit = () => [1, 2, 3, 4].map((k) => e.sim().ledLit(`D${k}`));
    const before = lit();
    click(e, { part: 'SW2' }); // LOAD
    expect(lit()).not.toEqual(before);
    const { model, shown } = recorder();
    e.show(model);
    expect(shown.controls.get('SW1')).toBe(0b101);
  });

  it('builds a model with something to point at for every button and switch of every example', () => {
    for (const ex of EXAMPLES) {
      const e = exampleExhibit(ex.id);
      const model = buildComputerModel(e.layout);
      const controls = e.layout.parts.filter((p) => p.kind === 'button' || p.kind === 'slide' || p.kind === 'dip');
      for (const p of controls) expect(model.hitTargets.some((t) => t.userData.part === p.id), `${ex.id} ${p.id}`).toBe(true);
      expect(() => e.show(model)).not.toThrow();
      expect(e.frame(16)).toBe(true); // runs from the start
    }
  });

  it('pauses, steps and resets from its panel buttons', () => {
    const e = exampleExhibit('sr-latch');
    const action = (label: string) => e.actions.find((a) => a.label() === label)!;
    expect(e.status()[0]).toBe('1 chip · 2 LEDs · 2 buttons');
    action('Pause').run();
    expect(e.status()[1]).toMatch(/^paused · 40 gate delays per frame/);
    e.frame(16);
    expect(e.frame(16)).toBe(false); // nothing to show while paused
    action('Faster').run();
    expect(e.status()[1]).toMatch(/80 gate delays/);
    click(e, { part: 'SW1' });
    action('Reset').run();
    expect((e as ReturnType<typeof circuitExhibit>).sim().ledLit('D1')).toBe(false);
  });
});

describe('the computer in VR', () => {
  it('works its board controls like the breadboard view', () => {
    const e = computerExhibit();
    expect(e.machine.mode).toBe('auto');
    expect(e.describe({ part: 'clock/SW2' }, 'screen')).toBe('SW2 auto/manual: auto');
    click(e, { part: 'clock/SW2' });
    expect(e.machine.mode).toBe('manual');
    expect(e.describe({ part: 'clock/SW2' }, 'screen')).toBe('SW2 auto/manual: manual');
    const c0 = e.machine.computer.cycles;
    click(e, { part: 'clock/SW1' });
    click(e, { part: 'clock/SW1' });
    expect(e.machine.computer.cycles).toBeGreaterThan(c0);
    // a drag (not a click) does not flip a switch
    e.begin({ part: 'mar/SW6' })!.end(false);
    expect(e.machine.computer.programMode).toBe(false);
    click(e, { part: 'mar/SW6' });
    expect(e.machine.computer.programMode).toBe(true);
    expect(e.describe({ part: 'mar/SW6' }, 'screen')).toBe('SW6 program/run: program');
    expect(e.describe({ part: 'clock/RV1' }, 'vr')).toMatch(/^RV1 speed · hold the trigger and twist · .* Hz$/);
  });

  it('says on a pot how what has the controls turns it: the mouse, a controller, a gamepad, a TV remote', () => {
    const e = computerExhibit();
    const how = (by: Pointer) => e.describe({ part: 'clock/RV1' }, by).split(' · ')[1];
    expect(how('screen')).toBe('drag up or down');
    expect(how('vr')).toBe('hold the trigger and twist');
    expect(how('pad')).toBe('hold A, then the right stick left or right');
    expect(how('remote')).toBe('OK to hold, then ← and →, OK or Back to let go');
    expect(e.labels!({ part: 'clock/RV1' }, 'remote').every((l) => l.includes('OK to hold'))).toBe(true);
  });

  it('names the labels a pot can show, so the one over it is as wide as the widest from the start', () => {
    const e = computerExhibit();
    const labels = e.labels!({ part: 'clock/RV1' }, 'vr');
    expect(labels).toContain('RV1 speed · hold the trigger and twist · 480 Hz');
    expect(labels).toContain('RV1 speed · hold the trigger and twist · 0.72 Hz');
    const longest = Math.max(...labels.map((l) => l.length));
    for (let t = 0; t <= 1; t += 0.01) {
      speedDial.set(e.machine, t);
      expect(e.describe({ part: 'clock/RV1' }, 'vr').length).toBeLessThanOrEqual(longest);
    }
    expect(e.labels!({ part: 'clock/SW2' }, 'vr')).toEqual([]); // only a pot's label changes while it's held
  });

  it('keeps the status line still while the speed and output change (fixed-width fields)', () => {
    const e = computerExhibit();
    const fields = () => e.status()[1].split(' · ').slice(0, 3).map((f) => f.length);
    const first = fields();
    for (const hz of [0.72, 13, 480, 500_000]) {
      e.machine.setHz(hz);
      e.machine.computer.out = hz === 480 ? 173 : 7;
      expect(fields()).toEqual(first);
    }
    expect(e.status()[1]).toMatch(/^running at 500 kHz · T\d · OUT {3}7 · cycle \d+$/);
  });

  it('spreads the speed evenly over RV1, a decade per ~100° of twist', () => {
    const e = computerExhibit();
    const m = e.machine;
    speedDial.set(m, 0);
    expect(m.hz).toBeCloseTo(hzFromPot(0)); // ~480 Hz, as Ben's pot turned fully fast
    speedDial.set(m, 1);
    expect(m.hz).toBeCloseTo(hzFromPot(1)); // ~0.72 Hz
    speedDial.set(m, 0.5);
    expect(m.hz).toBeCloseTo(Math.sqrt(hzFromPot(0) * hzFromPot(1))); // halfway, on a log scale: ~19 Hz
    expect(speedDial.get(m)).toBeCloseTo(0.5);
    // a twist of a tenth of the travel (27°) changes the speed by the same factor anywhere
    const turned = (from: number) => {
      speedDial.set(m, from);
      const hz = m.hz;
      e.begin({ part: 'clock/RV1' })!.turn!(-0.1);
      return m.hz / hz;
    };
    expect(turned(0.15)).toBeCloseTo(turned(0.85));
    expect(turned(0.15)).toBeGreaterThan(1.8); // and faster, as on the board
    expect(turned(0.15)).toBeLessThan(2.1);
    // beyond 480 Hz (Faster on the panel) the knob rests at the fast end
    m.setHz(10_000);
    expect(speedDial.get(m)).toBe(0);
  });
});
