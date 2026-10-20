/**
 * Moving about the room in VR, as in the Hallway and outside (their controls.js), so it feels the
 * same on both sides of a door: the left stick walks the way the head faces (move 'smooth') or,
 * pushed forward, aims that hand's ray at the floor for a jump on letting go (move 'teleport'); the
 * right stick turns 30° a push (turn 'snap') or while held (turn 'smooth'), about the head. The
 * trigger at the floor jumps there too. Pure: the numbers and the rules, for main.ts and the tests.
 */

export const XR_WALK = 1.8; // metres per second at full stick
export const SNAP = Math.PI / 6;
export const SMOOTH_TURN = 1.6; // radians per second at full stick
/** A stick closer to its middle than this does nothing. */
export const DEAD = 0.15;

/** A rectangle on the floor (metres, x0 < x1, z0 < z1). */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const inRect = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

/** Whether a head can stand at (x, z): in the room, clear of every obstacle. */
export function standable(x: number, z: number, room: Rect, obstacles: Rect[]): boolean {
  return x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1 && !obstacles.some((r) => inRect(r, x, z));
}

/**
 * Where a head walking from (fromX, fromZ) towards (x, z) ends up: kept in the room, and sliding
 * along an obstacle rather than into it. A head already inside one (walked in for real) may move
 * anywhere, so it can get out.
 */
export function clampWalk(fromX: number, fromZ: number, x: number, z: number, room: Rect, obstacles: Rect[]): [number, number] {
  x = Math.min(room.x1, Math.max(room.x0, x));
  z = Math.min(room.z1, Math.max(room.z0, z));
  const blocked = (px: number, pz: number) => obstacles.some((r) => inRect(r, px, pz));
  if (blocked(fromX, fromZ) || !blocked(x, z)) return [x, z];
  if (!blocked(x, fromZ)) return [x, fromZ];
  if (!blocked(fromX, z)) return [fromX, z];
  return [fromX, fromZ];
}

/**
 * How far a walk moves the head in a step: the stick (ax right, ay down, as a gamepad's axes),
 * relative to the head's forward (fx, fz) on the floor, `step` metres at full tilt.
 */
export function walkDelta(ax: number, ay: number, fx: number, fz: number, step: number): [number, number] {
  if (Math.hypot(ax, ay) <= DEAD) return [0, 0];
  const l = Math.hypot(fx, fz) || 1;
  fx /= l;
  fz /= l;
  // right of forward (fx, fz) is (-fz, fx); the stick pushed forward is ay < 0
  return [(-fz * ax - fx * ay) * step, (fx * ax - fz * ay) * step];
}

/** The way a head looks, as a yaw: 0 facing -z, + turned to the left (three.js's rotation.y). */
export function headYaw(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ);
}

/** An angle brought into (-π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Where the rig goes when it turns by `angle` about the head, so the viewer turns in place. */
export function turnedAbout(rigX: number, rigZ: number, headX: number, headZ: number, angle: number): [number, number] {
  const ox = rigX - headX, oz = rigZ - headZ;
  const c = Math.cos(angle), s = Math.sin(angle);
  return [headX + ox * c + oz * s, headZ - ox * s + oz * c];
}

/** The right stick: how far to turn now (radians, + to the left), a step a push (snap) or while held (smooth). */
export class TurnStick {
  private armed = true;

  turn(ax: number, dt: number, mode: 'snap' | 'smooth'): number {
    if (mode === 'smooth') return Math.abs(ax) > DEAD ? -ax * SMOOTH_TURN * dt : 0;
    if (this.armed && Math.abs(ax) > 0.6) {
      this.armed = false;
      return -Math.sign(ax) * SNAP;
    }
    if (Math.abs(ax) < 0.3) this.armed = true;
    return 0;
  }
}

/** The left stick in teleport mode: 'aim' while pushed forward, then 'jump' once on letting go, else null. */
export class AimStick {
  aiming = false;

  update(ay: number): 'aim' | 'jump' | null {
    if (ay < -0.6) this.aiming = true;
    else if (this.aiming && ay > -0.3) {
      this.aiming = false;
      return 'jump';
    }
    return this.aiming ? 'aim' : null;
  }
}
