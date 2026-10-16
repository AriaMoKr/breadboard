import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHIPS } from '../breadboard/catalog';
import { BOARD_H, BOARD_W, ROW_Y, colX, dipRows, holeXY } from '../breadboard/geometry';
import { layoutBounds, partPins, type BoardSpec, type Layout, type Part } from '../breadboard/layout';
import { LED_COLORS, WIRE_COLORS } from '../breadboard/render';

/**
 * The breadboard computer as a three.js model, built from the same Layout as the breadboard
 * view. Lengths are in breadboard pitch units (0.1"); the caller scales the root. Static parts
 * are merged into one mesh per material (few draw calls, for VR headsets); LEDs and display
 * segments are instanced so lighting one is a colour change. Buttons, switches and pots keep
 * their moving pieces apart, with hit boxes to point at (`hitTargets`).
 */

/**
 * Board thickness and part heights, in pitch units above the board's top surface. The root's
 * origin is on the boards' top, so it sits BOARD_T above the table for them to rest on it.
 */
export const BOARD_T = 2.6;
const WIRE_Y = 0.3;
const LED_Y = 1.25;

export interface ModelOptions {
  /** Texture for the board tops (holes, rails); plain boards without it. */
  boardTexture?: THREE.Texture;
  /** Text label texture (chip names, board titles); none without it. */
  label?: (text: string) => THREE.Texture;
}

/** What a hit box stands for (its `userData`): a part, and for a DIP switch which switch. */
export interface ControlHit {
  part: string;
  /** DIP switches: switch k is bit k-1. */
  bit?: number;
}

export interface ComputerModel {
  root: THREE.Group;
  /** Width (x) and depth (z) in pitch units; the model is centred on the origin. */
  size: { w: number; d: number };
  setLed(id: string, on: boolean): void;
  setSeg7(id: string, byte: number): void;
  /**
   * Invisible boxes over every button, slide switch and pot, and one per DIP switch: what a
   * pointer ray can hit (`userData` is a `ControlHit`). The hovered one shows as a glow.
   */
  hitTargets: THREE.Mesh[];
  /** Show a part's state: slide 0 | 1, DIP bits (bit k-1 = switch k ON), pot 0..1, button 1 = pressed. */
  setControl(id: string, value: number): void;
  setHover(hit: THREE.Object3D | null): void;
  counts: { boards: number; chips: number; leds: number; wires: number; seg7: number; meshes: number; controls: number };
}

const mat = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...opts });

/** Free the GPU memory of everything under `root` (a model or panel no longer shown), except `keep` (shared textures). */
export function disposeTree(root: THREE.Object3D, keep: THREE.Texture[] = []) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const m of [mesh.material ?? []].flat()) {
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map && !keep.includes(map)) map.dispose();
      m.dispose();
    }
    (o as THREE.InstancedMesh).dispose?.();
  });
}

/** Board-local (x, y) to the model's (x, y-up, z) through the board's placement. */
function boardMatrix(b: BoardSpec): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (b.place.rotate === 90) {
    // toScene: (x, y) -> (px + H - y, py + x): a quarter turn about the vertical axis
    m.makeRotationY(-Math.PI / 2).setPosition(b.place.x + BOARD_H, 0, b.place.y);
  } else m.makeTranslation(b.place.x, 0, b.place.y);
  return m;
}

/** Box between two board-local corners (any order), from height y0 to y1. */
function box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0));
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Cylinder of radius r from point a to point b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 6): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 1e-4);
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildComputerModel(layout: Layout, opts: ModelOptions = {}): ComputerModel {
  const root = new THREE.Group();
  root.name = 'breadboard-computer';
  const bounds = layoutBounds(layout);
  const inner = new THREE.Group();
  inner.position.set(-(bounds.x + bounds.w / 2), 0, -(bounds.y + bounds.h / 2));
  root.add(inner);

  // static geometry, collected per material and merged at the end
  const materials = new Map<string, THREE.Material>();
  const pieces = new Map<string, THREE.BufferGeometry[]>();
  const add = (key: string, material: () => THREE.Material, g: THREE.BufferGeometry, m: THREE.Matrix4) => {
    if (!materials.has(key)) materials.set(key, material());
    g.applyMatrix4(m);
    // merging needs the same attributes everywhere: positions and normals only
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const list = pieces.get(key) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    pieces.set(key, list);
  };
  const boards = new Map(layout.boards.map((b) => [b.id, b]));
  const counts = { boards: layout.boards.length, chips: 0, leds: 0, wires: 0, seg7: 0, meshes: 0, controls: 0 };

  // interactive parts: their moving pieces (caps, knobs, levers, the pot's slot) and hit boxes,
  // one group per part, all under `controlsGroup`
  const controlsGroup = new THREE.Group();
  controlsGroup.name = 'controls';
  const hitTargets: THREE.Mesh[] = [];
  const controls = new Map<string, (value: number) => void>();
  const hitMaterial = new THREE.MeshBasicMaterial({ color: '#8ab8ff', transparent: true, opacity: 0.3, depthWrite: false });
  const piece = (key: string, material: () => THREE.Material, g: THREE.BufferGeometry) => {
    if (!materials.has(key)) materials.set(key, material());
    return new THREE.Mesh(g, materials.get(key));
  };
  const control = (p: Part, m: THREE.Matrix4, set: (value: number) => void, ...pieces: THREE.Object3D[]) => {
    const g = new THREE.Group();
    g.applyMatrix4(m);
    g.add(...pieces);
    controlsGroup.add(g);
    controls.set(p.id, set);
    counts.controls++;
    return g;
  };
  /** A hit box from board-local corner (x0, z0) to (x1, z1), from the board up to height y1. */
  const hitBox = (g: THREE.Group, hit: ControlHit, x0: number, z0: number, x1: number, z1: number, y1: number) => {
    const mesh = new THREE.Mesh(box(x0, z0, x1, z1, 0, y1), hitMaterial);
    mesh.visible = false; // raycasting ignores visibility: hit boxes are hit, and only drawn on hover
    mesh.userData = hit;
    g.add(mesh);
    hitTargets.push(mesh);
  };

  // ---- boards: one textured box each ----
  const boardSide = mat('#d9d7ce');
  const boardTop = opts.boardTexture ? new THREE.MeshStandardMaterial({ map: opts.boardTexture, roughness: 0.8 }) : mat('#ecebe4', { roughness: 0.8 });
  const boardGeo = box(0, 0, BOARD_W, BOARD_H, -BOARD_T, 0);
  for (const b of layout.boards) {
    const mesh = new THREE.Mesh(boardGeo, [boardSide, boardSide, boardTop, boardSide, boardSide, boardSide]);
    mesh.applyMatrix4(boardMatrix(b));
    inner.add(mesh);
    if (b.title && opts.label) {
      const tex = opts.label(b.title);
      const aspect = tex.image ? (tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height : 6;
      const h = 1.5;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(1 + (h * aspect) / 2, 0.02, -1.1); // on the table, just above the board's top edge
      const holder = new THREE.Group();
      holder.add(plane);
      holder.applyMatrix4(boardMatrix(b));
      inner.add(holder);
    }
  }

  // ---- dynamic parts ----
  const leds: { id: string; color: THREE.Color; pos: THREE.Vector3 }[] = [];
  const segs: { id: string; matrices: THREE.Matrix4[] }[] = [];

  for (const p of layout.parts) {
    const b = boards.get(p.board);
    if (!b) continue;
    const m = boardMatrix(b);
    buildPart(p, m);
  }

  function buildPart(p: Part, m: THREE.Matrix4) {
    const at = (hole: string, y = 0) => { const h = holeXY(hole); return v(h.x, y, h.y); };
    switch (p.kind) {
      case 'chip': {
        counts.chips++;
        const pins = partPins(p).map((pin) => ({ ...pin, ...holeXY(pin.hole) }));
        const xs = pins.map((q) => q.x), zs = pins.map((q) => q.y);
        const x0 = Math.min(...xs) - 0.5, x1 = Math.max(...xs) + 0.5;
        const z0 = Math.min(...zs) + 0.45, z1 = Math.max(...zs) - 0.45;
        add('chip', () => mat('#24262c', { roughness: 0.5 }), box(x0, z0, x1, z1, 0.4, 1.7), m);
        for (const q of pins) {
          const toward = q.y < (z0 + z1) / 2 ? 1 : -1;
          add('leg', () => mat('#c9ccd2', { metalness: 0.7, roughness: 0.35 }), box(q.x - 0.16, q.y - 0.1 * toward, q.x + 0.16, q.y + 0.55 * toward, -0.3, 0.8), m);
        }
        const p1 = pins.find((q) => q.number === 1)!;
        add('chip-dot', () => mat('#40434b'), new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12).translate(p1.x + (p1.x < (x0 + x1) / 2 ? 0.4 : -0.4), 1.72, p1.y + (p1.y < (z0 + z1) / 2 ? 0.75 : -0.75)), m);
        if (opts.label) {
          const text = `${p.label ? `${p.label} ` : ''}${CHIPS[p.chip]?.id ?? p.chip}`;
          const tex = opts.label(text);
          const w = Math.min(x1 - x0 - 0.6, (z1 - z0 - 0.2) * ((tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height));
          const h = w / ((tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height);
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
          plane.rotation.x = -Math.PI / 2;
          if (p.rotated) plane.rotation.z = Math.PI;
          plane.position.set((x0 + x1) / 2, 1.72, (z0 + z1) / 2);
          const holder = new THREE.Group();
          holder.add(plane);
          holder.applyMatrix4(m);
          inner.add(holder);
        }
        return;
      }
      case 'wire': {
        counts.wires++;
        const pts = [holeXY(p.a), ...(p.via ?? []).map(([x, y]) => ({ x, y })), holeXY(p.b)];
        const key = `wire-${p.color}`;
        const material = () => mat(WIRE_COLORS[p.color] ?? '#888', { roughness: 0.45 });
        for (let i = 0; i < pts.length - 1; i++) add(key, material, rod(v(pts[i].x, WIRE_Y, pts[i].y), v(pts[i + 1].x, WIRE_Y, pts[i + 1].y), 0.13, 5), m);
        for (const e of [pts[0], pts[pts.length - 1]]) add(key, material, rod(v(e.x, -0.4, e.y), v(e.x, WIRE_Y + 0.13, e.y), 0.13, 5), m);
        return;
      }
      case 'led': {
        counts.leds++;
        const a = holeXY(p.anode), k = holeXY(p.cathode);
        const dist = Math.hypot(k.x - a.x, k.y - a.y);
        const t = dist > 2.2 ? Math.min(0.5, 0.9 / dist) : 0.5; // as in the 2D view: near the anode on long spans
        const c = v(a.x + (k.x - a.x) * t, LED_Y, a.y + (k.y - a.y) * t);
        for (const end of [a, k]) add('lead', () => mat('#a9adb4', { metalness: 0.6, roughness: 0.4 }), rod(v(end.x, -0.3, end.y), v(c.x, LED_Y - 0.3, c.z), 0.06, 4), m);
        leds.push({ id: p.id, color: new THREE.Color(LED_COLORS[p.color] ?? '#ff2a1a'), pos: c.applyMatrix4(m) });
        return;
      }
      case 'seg7': {
        counts.seg7++;
        const [top, bottom] = dipRows(6);
        const x0 = colX(p.col) - 0.48, x1 = colX(p.col + 4) + 0.48;
        const z0 = ROW_Y[top] - 0.45, z1 = ROW_Y[bottom] + 0.45;
        add('seg7', () => mat('#1c1c1f', { roughness: 0.4 }), box(x0, z0, x1, z1, 0, 1.4), m);
        const cx = (x0 + x1) / 2 - 0.15, cz = (z0 + z1) / 2, w = 2.3, hh = 2.4, th = 0.38;
        // a b c d e f g dp, as the segment bits in displaySegments
        const rects: [number, number, number, number][] = [
          [cx, cz - hh, w - 0.6, th], [cx + w / 2, cz - hh / 2, th, hh - 0.5], [cx + w / 2, cz + hh / 2, th, hh - 0.5], [cx, cz + hh, w - 0.6, th],
          [cx - w / 2, cz + hh / 2, th, hh - 0.5], [cx - w / 2, cz - hh / 2, th, hh - 0.5], [cx, cz, w - 0.6, th], [cx + w / 2 + 0.35, cz + hh, 0.4, 0.4],
        ];
        segs.push({ id: p.id, matrices: rects.map(([x, z, sx, sz]) => new THREE.Matrix4().compose(v(x, 1.43, z), new THREE.Quaternion(), v(sx, 0.06, sz)).premultiply(m)) });
        return;
      }
      case 'resistor':
      case 'capacitor': {
        const a = at(p.a), b2 = at(p.b);
        const mid = a.clone().add(b2).multiplyScalar(0.5);
        const lead = () => mat('#a9adb4', { metalness: 0.6, roughness: 0.4 });
        if (p.kind === 'resistor') {
          const dir = b2.clone().sub(a).normalize();
          const half = Math.min(1, Math.max(0.4, a.distanceTo(b2) / 2 - 0.4));
          const e0 = mid.clone().addScaledVector(dir, -half).setY(0.55), e1 = mid.clone().addScaledVector(dir, half).setY(0.55);
          add('resistor', () => mat('#d8c49a'), rod(e0, e1, 0.36, 10), m);
          add('lead', lead, rod(a.clone().setY(-0.3), e0, 0.06, 4), m);
          add('lead', lead, rod(b2.clone().setY(-0.3), e1, 0.06, 4), m);
        } else {
          const top = v(mid.x, p.polarized ? 2.0 : 1.3, mid.z);
          add(p.polarized ? 'cap-elec' : 'cap', () => mat(p.polarized ? '#233a7a' : '#e3a33a'), p.polarized ? new THREE.CylinderGeometry(0.55, 0.55, 1.8, 14).translate(mid.x, 1.1, mid.z) : new THREE.CylinderGeometry(0.55, 0.55, 0.3, 14).rotateX(Math.PI / 2).translate(mid.x, 1.0, mid.z), m);
          add('lead', lead, rod(a.clone().setY(-0.3), top.clone().setY(0.4), 0.06, 4), m);
          add('lead', lead, rod(b2.clone().setY(-0.3), top.clone().setY(0.4), 0.06, 4), m);
        }
        return;
      }
      case 'button': {
        const c = at(p.a).add(at(p.b)).multiplyScalar(0.5);
        add('button', () => mat('#2b2d33'), box(c.x - 0.7, c.z - 0.7, c.x + 0.7, c.z + 0.7, 0, 0.7), m);
        const cap = piece('button-cap', () => mat('#111214'), new THREE.CylinderGeometry(0.42, 0.42, 0.45, 14));
        cap.position.set(c.x, 0.9, c.z);
        const g = control(p, m, (down) => (cap.position.y = down ? 0.62 : 0.9), cap);
        hitBox(g, { part: p.id }, c.x - 1, c.z - 1, c.x + 1, c.z + 1, 1.6);
        return;
      }
      case 'slide': {
        const a = at(p.a), b2 = at(p.b), c = at(p.common);
        const horizontal = Math.abs(b2.x - a.x) >= Math.abs(b2.z - a.z);
        const hx = horizontal ? Math.abs(b2.x - a.x) / 2 + 0.6 : 0.55, hz = horizontal ? 0.55 : Math.abs(b2.z - a.z) / 2 + 0.6;
        add('slide', () => mat('#33363d'), box(c.x - hx, c.z - hz, c.x + hx, c.z + hz, 0, 0.9), m);
        // position 1 puts the knob towards b, as in the 2D view
        const toB = b2.clone().sub(a).normalize();
        const knob = piece('slide-knob', () => mat('#dcdcdc'), horizontal ? new THREE.BoxGeometry(1, 0.4, 0.6) : new THREE.BoxGeometry(0.6, 0.4, 1));
        const set = (pos: number) => knob.position.copy(c).addScaledVector(toB, pos ? 0.6 : -0.6).setY(1.1);
        set(p.initial ?? 0);
        const g = control(p, m, set, knob);
        hitBox(g, { part: p.id }, c.x - hx - 0.2, c.z - hz - 0.2, c.x + hx + 0.2, c.z + hz + 0.2, 1.8);
        return;
      }
      case 'dip': {
        const xa = colX(p.col) - 0.5, xb = colX(p.col + p.positions - 1) + 0.5;
        add('dip', () => mat('#c8302a'), box(xa, ROW_Y.e - 0.1, xb, ROW_Y.f + 0.1, 0, 1.0), m);
        const levers = Array.from({ length: p.positions }, (_, k) => {
          const lever = piece('dip-lever', () => mat('#f4f4f4'), new THREE.BoxGeometry(0.44, 0.25, 0.9));
          lever.position.set(colX(p.col + k), 1.125, 0);
          return lever;
        });
        // ON (bit set) is the row-e side, where the 2D view prints "ON"
        const set = (bits: number) => levers.forEach((l, k) => (l.position.z = (bits >> k) & 1 ? ROW_Y.e + 0.85 : ROW_Y.f - 0.85));
        set(0);
        const g = control(p, m, set, ...levers);
        // only as high as the levers: a ray at one lever from the side must not enter its neighbour's box first
        for (let k = 0; k < p.positions; k++) {
          const x = colX(p.col + k);
          hitBox(g, { part: p.id, bit: k }, x - 0.5, ROW_Y.e - 0.1, x + 0.5, ROW_Y.f + 0.1, 1.3);
        }
        return;
      }
      case 'pot': {
        const pins = [at(p.a), at(p.wiper), at(p.b)];
        const c = pins.reduce((s, q) => s.add(q), v(0, 0, 0)).multiplyScalar(1 / 3);
        add('pot', () => mat('#2f62c8'), box(c.x - 1.1, c.z - 1.1, c.x + 1.1, c.z + 1.1, 0, 1.0), m);
        add('pot-rotor', () => mat('#f0f0ee'), new THREE.CylinderGeometry(0.8, 0.8, 0.3, 18).translate(c.x, 1.15, c.z), m);
        // the slot turns from -135° (t = 0) to +135° (t = 1), clockwise seen from above, as in 2D
        const slot = piece('pot-slot', () => mat('#5a5f69'), new THREE.BoxGeometry(0.14, 0.05, 1.4));
        slot.position.set(c.x, 1.32, c.z);
        const set = (t: number) => (slot.rotation.y = -THREE.MathUtils.degToRad(-135 + 270 * Math.max(0, Math.min(1, t))));
        set(0.5);
        const g = control(p, m, set, slot);
        hitBox(g, { part: p.id }, c.x - 2, c.z - 2, c.x + 2, c.z + 2, 1.8); // bigger than the pot: easier to hit with a ray
        return;
      }
      default:
        return; // ports and silkscreen text: nothing to model
    }
  }

  // ---- merge static pieces ----
  for (const [key, list] of pieces) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials.get(key));
    mesh.name = key;
    inner.add(mesh);
  }

  // ---- LEDs: dome + additive glow, both instanced ----
  const domeGeo = new THREE.SphereGeometry(0.5, 14, 10);
  const domes = new THREE.InstancedMesh(domeGeo, new THREE.MeshBasicMaterial(), Math.max(1, leds.length));
  const glows = new THREE.InstancedMesh(new THREE.SphereGeometry(1.15, 14, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }), Math.max(1, leds.length));
  domes.count = glows.count = leds.length;
  const ledIndex = new Map<string, number>();
  const ledOn: boolean[] = [];
  const off = (c: THREE.Color) => c.clone().multiplyScalar(0.2);
  const black = new THREE.Color(0, 0, 0);
  leds.forEach((l, i) => {
    const mtx = new THREE.Matrix4().makeTranslation(l.pos.x, l.pos.y, l.pos.z);
    domes.setMatrixAt(i, mtx);
    glows.setMatrixAt(i, mtx);
    domes.setColorAt(i, off(l.color));
    glows.setColorAt(i, black);
    ledIndex.set(l.id, i);
    ledOn.push(false);
  });
  domes.name = 'led-domes';
  glows.name = 'led-glows';
  inner.add(domes, glows);

  // ---- 7-segment displays: one instanced mesh of segments ----
  const SEG_ON = new THREE.Color('#ff3420'), SEG_OFF = new THREE.Color('#3a1512');
  const segMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), Math.max(1, segs.length * 8));
  segMesh.count = segs.length * 8;
  const segIndex = new Map<string, { at: number; value: number }>();
  segs.forEach((s, i) => {
    s.matrices.forEach((mtx, k) => {
      segMesh.setMatrixAt(i * 8 + k, mtx);
      segMesh.setColorAt(i * 8 + k, SEG_OFF);
    });
    segIndex.set(s.id, { at: i * 8, value: 0 });
  });
  segMesh.name = 'seg7-segments';
  inner.add(segMesh, controlsGroup);

  counts.meshes = inner.children.length;
  const SEG_BITS = [0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01, 0x80];
  let hovered: THREE.Object3D | null = null;
  return {
    root,
    size: { w: bounds.w, d: bounds.h },
    counts,
    hitTargets,
    setControl: (id, value) => controls.get(id)?.(value),
    setHover(hit) {
      if (hovered) hovered.visible = false;
      hovered = hit && hitTargets.includes(hit as THREE.Mesh) ? hit : null;
      if (hovered) hovered.visible = true;
    },
    setLed(id, on) {
      const i = ledIndex.get(id);
      if (i === undefined || ledOn[i] === on) return;
      ledOn[i] = on;
      domes.setColorAt(i, on ? leds[i].color : off(leds[i].color));
      glows.setColorAt(i, on ? leds[i].color : black);
      domes.instanceColor!.needsUpdate = true;
      glows.instanceColor!.needsUpdate = true;
    },
    setSeg7(id, byte) {
      const s = segIndex.get(id);
      if (!s || s.value === byte) return;
      s.value = byte;
      SEG_BITS.forEach((bit, k) => segMesh.setColorAt(s.at + k, (byte & bit) !== 0 ? SEG_ON : SEG_OFF));
      segMesh.instanceColor!.needsUpdate = true;
    },
  };
}
