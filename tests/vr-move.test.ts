import { describe, expect, it } from 'vitest';
// (The VR movement choice, hallway.nav, is AriaMoKr/common's nav.js, tested there.)
import { AimStick, KEY, PAD, SNAP, TurnStick, aimDir, aimOf, clampStep, clampWalk, headYaw, keyTilt, padLook, padWalk, standable, turnedAbout, walkDelta, wrapAngle, type Rect } from '../src/vr/move';

const ROOM: Rect = { x0: -6, x1: 6, z0: -6, z1: 6 };
const TABLE: Rect = { x0: -0.7, x1: 0.7, z0: -1.4, z1: -0.1 };

describe('moving about the room', () => {
  it('walks the way the head faces, the stick’s forward being up', () => {
    const [dx, dz] = walkDelta(0, -1, 0, -1, 0.5); // facing -z, stick forward
    expect([dx, dz].map((v) => +v.toFixed(6))).toEqual([0, -0.5]);
    const [rx, rz] = walkDelta(1, 0, 0, -1, 0.5); // stick right: to the right, +x
    expect([+rx.toFixed(6), +rz.toFixed(6)]).toEqual([0.5, 0]);
    expect(walkDelta(0.1, -0.05, 0, -1, 1)).toEqual([0, 0]); // inside the dead zone
  });

  it('stays in the room and slides along the table instead of into it', () => {
    expect(clampWalk(0, 0, 9, 0, ROOM, [TABLE])).toEqual([6, 0]);
    expect(clampWalk(0, 0.2, 0, -0.5, ROOM, [TABLE])).toEqual([0, 0.2]); // straight at it: stays
    expect(clampWalk(0.5, 0.2, 0.6, -0.5, ROOM, [TABLE])).toEqual([0.6, 0.2]); // slides sideways
    expect(clampWalk(0, -0.5, 0, 0.5, ROOM, [TABLE])).toEqual([0, 0.5]); // already in it (walked in for real): out
  });

  it('jumps only to where a head can stand', () => {
    expect(standable(2, 0, ROOM, [TABLE])).toBe(true);
    expect(standable(0, -0.7, ROOM, [TABLE])).toBe(false);
    expect(standable(7, 0, ROOM, [TABLE])).toBe(false);
  });

  it('turns about the head, so the visitor turns in place', () => {
    // the rig 1 m behind the head (+z); turned 90° to the left, it is 1 m to the head's right (+x)
    const [x, z] = turnedAbout(0, 1, 0, 0, Math.PI / 2);
    expect([+x.toFixed(6), +z.toFixed(6)]).toEqual([1, 0]);
    expect(headYaw(0, -1)).toBeCloseTo(0);
    expect(headYaw(-1, 0)).toBeCloseTo(Math.PI / 2); // facing -x is turned to the left
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
  });

  it('snaps 30° a push, or turns while the stick is held', () => {
    const t = new TurnStick();
    expect(t.turn(1, 0.016, 'snap')).toBe(-SNAP); // right: a step to the right
    expect(t.turn(1, 0.016, 'snap')).toBe(0); // held: no more
    expect(t.turn(0.1, 0.016, 'snap')).toBe(0); // let go
    expect(t.turn(-0.8, 0.016, 'snap')).toBe(SNAP);
    expect(t.turn(-1, 0.5, 'smooth')).toBeCloseTo(0.8);
    expect(t.turn(0.1, 0.5, 'smooth')).toBe(0);
  });

  it('aims a jump while the left stick is forward, and jumps on letting go', () => {
    const a = new AimStick();
    expect(a.update(0)).toBeNull();
    expect(a.update(-0.9)).toBe('aim');
    expect(a.update(-0.5)).toBe('aim'); // still past the release point
    expect(a.update(0)).toBe('jump');
    expect(a.update(0)).toBeNull();
  });
});

describe('a gamepad on a screen', () => {
  const round = (v: number[]) => v.map((x) => +x.toFixed(6) + 0); // + 0: no -0

  it('reads a view’s yaw and pitch from where it looks, and back', () => {
    expect(round(aimOf(0, 0, -1))).toEqual([0, 0]); // facing -z, level
    expect(round(aimOf(-1, 0, 0))).toEqual([round([Math.PI / 2])[0], 0]); // turned left
    const [yaw, pitch] = aimOf(0.3, -0.4, -0.5);
    const d = aimDir(yaw, pitch);
    const l = Math.hypot(0.3, -0.4, -0.5);
    expect(round(d)).toEqual(round([0.3 / l, -0.4 / l, -0.5 / l]));
  });

  it('walks the way the view faces, the stick’s forward being up', () => {
    expect(round(padWalk(0, -1, 0, 0.5))).toEqual([0, -0.5]); // facing -z, stick forward
    expect(round(padWalk(1, 0, 0, 0.5))).toEqual([0.5, 0]); // stick right: +x
    expect(round(padWalk(0, -1, Math.PI / 2, 1))).toEqual([-1, 0]); // turned left, facing -x
  });

  it('looks with the right stick, to the left for left and up for up, the pitch kept within bounds', () => {
    const [yaw, pitch] = padLook(0, -0.5, -1, -1, 0.1, -1.2, -0.05);
    expect(+yaw.toFixed(6)).toBe(+(PAD.turn * 0.1).toFixed(6));
    expect(+pitch.toFixed(6)).toBe(+(-0.5 + PAD.pitch * 0.1).toFixed(6));
    expect(padLook(0, -0.1, 0, -1, 1, -1.2, -0.05)[1]).toBe(-0.05); // no higher than hi
    expect(padLook(0, -1.1, 0, 1, 1, -1.2, -0.05)[1]).toBe(-1.2); // no lower than lo
  });

  it('stops at a bound, but leaves alone what is already beyond it', () => {
    expect(clampStep(1, 0.5, 0, 1.2)).toBe(1.2);
    expect(clampStep(0.1, -0.5, 0, 1.2)).toBe(0);
    expect(clampStep(1.5, 0.2, 0, 1.2)).toBe(1.5); // already above: no higher
    expect(clampStep(1.5, -0.2, 0, 1.2)).toBe(1.3); // but back down freely
    expect(clampStep(-0.3, -0.1, 0, 1.2)).toBe(-0.3);
  });
});

describe('a TV remote’s arrows', () => {
  const deg = (s: number) => (s * PAD.turn * 180) / Math.PI;
  it('turns 1.5° a tap, walks 2 cm and turns a held pot 2% of its travel', () => {
    expect(deg(keyTilt(0, KEY.turn))).toBeCloseTo(1.5);
    expect(keyTilt(0, KEY.walk) * PAD.walk).toBeCloseTo(0.02);
    expect(keyTilt(0, KEY.knob) * PAD.knob).toBeCloseTo(0.02);
    expect(deg(keyTilt(0.15, KEY.turn))).toBeLessThan(2); // a quick press is still about a tap
  });
  it('goes on slowly while a key is held, then faster, at full tilt after KEY.full', () => {
    const speed = (t: number) => (keyTilt(t + 0.001, 0) - keyTilt(t, 0)) / 0.001;
    expect(speed(0.1)).toBeLessThan(0.05);
    expect(speed(0.4)).toBeGreaterThan(speed(0.2));
    expect(speed(KEY.full)).toBeCloseTo(1, 2);
    expect(speed(3)).toBeCloseTo(1, 5);
    expect(deg(keyTilt(1, KEY.turn))).toBeGreaterThan(45); // the long way round, still quick
    expect(keyTilt(-0.01, KEY.turn)).toBe(KEY.turn); // a frame's clock just before the key's
  });
});
