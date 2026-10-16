import * as THREE from 'three';

/**
 * Carrying an object with VR controllers (the grip buttons). One hand: the object follows that
 * hand as if held. Two hands: it moves and turns (about the vertical) with the point between
 * them and scales with their distance, like stretching it. Call `grip` whenever the set of hands
 * holding it changes and `follow` every frame. The object must sit directly in the scene, and
 * have a uniform scale.
 */
export class Carry {
  private one: THREE.Matrix4 | null = null;
  private two: { mid: THREE.Vector3; dist: number; yaw: number; pos: THREE.Vector3; quat: THREE.Quaternion; scale: number } | null = null;

  /** `minScale` / `maxScale`: how far two hands may shrink or grow it. */
  constructor(private object: THREE.Object3D, private minScale: number, private maxScale: number) {}

  /** The hands holding it now (none, one, or two; more are ignored): start from where all are. */
  grip(hands: THREE.Object3D[]) {
    const o = this.object;
    o.updateMatrixWorld();
    this.one = this.two = null;
    if (hands.length === 1) {
      hands[0].updateMatrixWorld();
      this.one = hands[0].matrixWorld.clone().invert().multiply(o.matrixWorld);
    } else if (hands.length >= 2) {
      const [a, b] = at(hands);
      this.two = { mid: a.clone().add(b).multiplyScalar(0.5), dist: Math.max(0.01, a.distanceTo(b)), yaw: yaw(a, b), pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.x };
    }
  }

  follow(hands: THREE.Object3D[]) {
    const o = this.object;
    if (this.one && hands.length === 1) {
      hands[0].updateMatrixWorld();
      held.multiplyMatrices(hands[0].matrixWorld, this.one).decompose(o.position, o.quaternion, o.scale);
    } else if (this.two && hands.length >= 2) {
      const g = this.two;
      const [a, b] = at(hands);
      const scale = Math.max(this.minScale, Math.min(this.maxScale, (g.scale * a.distanceTo(b)) / g.dist));
      const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw(a, b) - g.yaw);
      const mid = a.add(b).multiplyScalar(0.5);
      o.position.copy(g.pos).sub(g.mid).multiplyScalar(scale / g.scale).applyQuaternion(turn).add(mid);
      o.quaternion.copy(turn).multiply(g.quat);
      o.scale.setScalar(scale);
    }
  }
}

/**
 * Turning a knob by twisting the controller, as if holding the knob: the twist about the
 * controller's own pointing axis (its -z, the ray) since the trigger was pulled, whatever way it
 * points, and however the ray swings meanwhile (Euler angles lose it pointing straight down, at a
 * knob on a table). `update` takes the controller's world rotation and gives how far the knob has
 * turned, where its full 270° travel is 1, clockwise (as seen along the ray) up. The knob follows
 * the hand 1:1, so a longer turn takes a second grip, as on a real one; a wrist can't turn past
 * the ±180° where the angle would wrap.
 */
export class Twist {
  private from = new THREE.Quaternion();
  turned = 0;

  constructor(from: THREE.Quaternion) {
    this.from.copy(from);
  }

  update(now: THREE.Quaternion): number {
    return (this.turned = -twistAngle(this.from, now) / KNOB_TRAVEL);
  }
}

/** A potentiometer's travel: 270°. */
const KNOB_TRAVEL = 1.5 * Math.PI;

/**
 * The part of the rotation from `from` to `to` that is about the rotated object's own z axis, in
 * radians (-π, π]: counterclockwise as seen from its +z side, so for a controller as seen from
 * behind it, along its ray (swing-twist decomposition of the relative rotation).
 */
export function twistAngle(from: THREE.Quaternion, to: THREE.Quaternion): number {
  const r = from.clone().invert().multiply(to); // the rotation in the object's own frame
  const a = 2 * Math.atan2(r.z, r.w);
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const UP = new THREE.Vector3(0, 1, 0);
const held = new THREE.Matrix4();
const at = (hands: THREE.Object3D[]) => hands.slice(0, 2).map((h) => h.getWorldPosition(new THREE.Vector3()));
const yaw = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.x - a.x, b.z - a.z);
