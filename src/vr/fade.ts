import * as THREE from 'three';

/**
 * A fade to and from black around the viewer's head: a small sphere on the camera, drawn over
 * everything (outside's and the Hallway's fade.js). A teleport in VR blinks with it, and going
 * back through the door fades out.
 */
export class Fade {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private value: number;
  private target: number;
  private rate = 1;
  private done: (() => void) | null = null;

  constructor(camera: THREE.Object3D, value = 0) {
    const material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, opacity: value });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), material);
    this.mesh.renderOrder = 1e6;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fade';
    camera.add(this.mesh);
    this.value = this.target = value;
    this.apply();
  }

  /** Fades to `target` (0 clear, 1 black) over `seconds`, then calls `done`. */
  to(target: number, seconds: number, done: (() => void) | null = null) {
    this.target = target;
    this.rate = Math.abs(target - this.value) / Math.max(seconds, 1e-3);
    this.done = done;
    if (target === this.value) this.finish();
  }

  /** Sets it at once. */
  set(value: number) {
    this.value = this.target = value;
    this.done = null;
    this.apply();
  }

  update(dt: number) {
    if (this.value === this.target) return;
    const step = this.rate * dt;
    if (Math.abs(this.target - this.value) <= step) this.value = this.target;
    else this.value += Math.sign(this.target - this.value) * step;
    this.apply();
    if (this.value === this.target) this.finish();
  }

  private finish() {
    const done = this.done;
    this.done = null;
    done?.();
  }

  private apply() {
    this.mesh.material.opacity = this.value;
    this.mesh.visible = this.value > 0.001;
  }
}
