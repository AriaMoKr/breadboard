import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Carry, twist } from '../src/vr/carry';

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
  it('turns it up for a clockwise twist (the roll goes down), end to end in half a turn', () => {
    expect(twist(0, -Math.PI / 2)).toBeCloseTo(0.5);
    expect(twist(0, Math.PI / 4)).toBeCloseTo(-0.25);
  });

  it('does not jump where the roll angle wraps round from +180° to -180°', () => {
    expect(twist(3.0, -3.0)).toBeCloseTo(-(2 * Math.PI - 6) / Math.PI);
  });
});
