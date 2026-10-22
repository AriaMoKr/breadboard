import { describe, expect, it } from 'vitest';
// (The VR movement choice, hallway.nav, is AriaMoKr/common's nav.js, tested there.)
import { AimStick, SNAP, TurnStick, clampWalk, headYaw, standable, turnedAbout, walkDelta, wrapAngle, type Rect } from '../src/vr/move';

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
