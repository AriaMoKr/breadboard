import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Carry, Twist, twistAngle } from '../src/vr/carry';

/** A controller at a position, pointing along -z and turned `yaw` about the vertical. */
const hand = (x: number, y: number, z: number, yaw = 0) => {
  const h = new THREE.Object3D();
  h.position.set(x, y, z);
  h.rotation.y = yaw;
  return h;
};
const close = (a: THREE.Vector3, b: THREE.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-9);

describe('carrying the computer in VR', () => {
  const setup = () => {
    const thing = new THREE.Object3D();
    thing.position.set(0, 0.77, -0.72);
    thing.scale.setScalar(0.004);
    return { thing, carry: new Carry(thing, 0.002, 0.032) };
  };

  it('follows one hand as if held', () => {
    const { thing, carry } = setup();
    const h = hand(0.2, 1, -0.3);
    carry.grip([h]);
    h.position.x += 0.1;
    h.position.y += 0.05;
    carry.follow([h]);
    close(thing.position, new THREE.Vector3(0.1, 0.82, -0.72));
    expect(thing.scale.x).toBeCloseTo(0.004);
    // a quarter turn of the hand swings it round the hand, a quarter turn too: the offset from
    // the hand, (x, z) = (-0.2, -0.42), becomes (-0.42, +0.2)
    h.rotation.y = Math.PI / 2;
    carry.follow([h]);
    close(thing.position, new THREE.Vector3(0.3 - 0.42, 0.82, -0.3 + 0.2));
    expect(thing.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2))).toBeLessThan(1e-9);
  });

  it('scales with the distance between two hands, about the point between them', () => {
    const { thing, carry } = setup();
    const a = hand(-0.1, 1, -0.72), b = hand(0.1, 1, -0.72);
    carry.grip([a, b]);
    a.position.x = -0.2;
    b.position.x = 0.2;
    carry.follow([a, b]);
    expect(thing.scale.x).toBeCloseTo(0.008);
    close(thing.position, new THREE.Vector3(0, 1 - 2 * 0.23, -0.72)); // twice as far below the hands
  });

  it('turns with the line between two hands, and keeps within its size limits', () => {
    const { thing, carry } = setup();
    const a = hand(-0.1, 0.77, -0.72), b = hand(0.1, 0.77, -0.72);
    carry.grip([a, b]);
    // swing the hands a quarter turn about the point between them
    a.position.set(0, 0.77, -0.82);
    b.position.set(0, 0.77, -0.62);
    carry.follow([a, b]);
    expect(Math.abs(new THREE.Euler().setFromQuaternion(thing.quaternion).y)).toBeCloseTo(Math.PI / 2);
    close(thing.position, new THREE.Vector3(0, 0.77, -0.72));
    b.position.z = 10; // pulled very far apart: no bigger than the limit
    carry.follow([a, b]);
    expect(thing.scale.x).toBeCloseTo(0.032);
  });

  it('carries on with the other hand when one lets go, and stops with none', () => {
    const { thing, carry } = setup();
    const a = hand(-0.1, 1, -0.72), b = hand(0.1, 1, -0.72);
    carry.grip([a, b]);
    carry.grip([b]); // a let go
    b.position.y += 0.1;
    carry.follow([b]);
    expect(thing.position.y).toBeCloseTo(0.87);
    carry.grip([]);
    b.position.y += 0.1;
    carry.follow([]);
    expect(thing.position.y).toBeCloseTo(0.87);
  });
});

describe('turning a pot by twisting the controller', () => {
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const turn = (axis: THREE.Vector3, deg: number) => new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));
  /** A controller turned `yaw` and pitched `pitch` (negative: pointing down), twisted `roll` about its ray. */
  const aim = (yaw: number, pitch: number, roll = 0) => turn(Y, yaw).multiply(turn(X, pitch)).multiply(turn(Z, roll));

  /** Twist from 0 to `roll` in small steps, as frames do, and see how far the knob turned. */
  const knob = (yaw: number, pitch: number, roll: number) => {
    const t = new Twist(aim(yaw, pitch));
    for (let k = 1; k <= 30; k++) t.update(aim(yaw, pitch, (roll * k) / 30));
    return t.turned;
  };

  it('turns the knob with the hand, 1:1 over its 270° travel, clockwise up', () => {
    expect(knob(0, 0, -135)).toBeCloseTo(0.5); // clockwise, seen along the ray
    expect(knob(0, 0, 90)).toBeCloseTo(-1 / 3);
  });

  it('measures the twist about the ray even pointing straight down at a knob on the table', () => {
    // Euler angles lose it there: pointing straight down, a twist reads as yaw, not roll
    const e = new THREE.Euler().setFromQuaternion(aim(30, -90, -45), 'YXZ');
    expect(e.z).toBeCloseTo(0);
    for (const pitch of [0, -45, -70, -89, -90]) expect(knob(30, pitch, -45), `pitch ${pitch}°`).toBeCloseTo(1 / 6);
  });

  it('ends where it started when the ray swings around and comes back', () => {
    const t = new Twist(aim(0, -60));
    t.update(aim(25, -40));
    t.update(aim(-10, -75, 5));
    expect(t.update(aim(0, -60))).toBeCloseTo(0);
    expect(t.update(aim(0, -60, -27))).toBeCloseTo(0.1);
  });

  it('gives the twist part of a rotation, in (-180°, 180°]', () => {
    expect(THREE.MathUtils.radToDeg(twistAngle(aim(10, -30), aim(10, -30, 170)))).toBeCloseTo(170);
    expect(THREE.MathUtils.radToDeg(twistAngle(aim(10, -30), aim(10, -30, 190)))).toBeCloseTo(-170);
  });
});
