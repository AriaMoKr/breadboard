import * as THREE from 'three';
import { viewParams } from 'common/door.js';
import { openingGeometry, placePortal, portalMaterial, setView, type PortalMaterial } from './portal';

/**
 * The doorway back to where the visitor came from (the Hallway): a free-standing doorframe in the
 * room behind where they arrive, facing the table, its sign over it, glowing in the door's colour.
 * Through it the Hallway shows itself as seen from its door to here (its README, "The view from
 * your door"); until that loads, or without it, the opening shows the way back's name on its glow.
 * Pointing at it (or clicking it) leads back, and so does stepping through it (main.ts).
 */

/** How a picture hangs before the view is loaded: as the Hallway hangs a door's preview (its hall.js PICTURE). */
const PICTURE = { depth: 2.4, pictureHeight: 3, eye: 1.6, horizon: 0.56, aspect: 2 };
/** How far past the opening's plane the head must be to have gone through. */
const THRESHOLD = 0.06;
const FRAME = 0.12; // the jambs' and lintel's width

export interface Doorway {
  group: THREE.Group;
  /** The opening: what a pointer hits to go through. */
  portal: THREE.Mesh<THREE.BufferGeometry, PortalMaterial>;
  /** Shows the Hallway's view of its door: true once it is up. */
  loadView(source: { views: string; id: string }): Promise<boolean>;
  /** Per frame: the veil drifts, and the doorway brightens when pointed at or stood near. */
  update(dt: number, head: THREE.Vector3, hover: boolean): void;
  /** Whether the head (world position) has gone through the opening from the room since the last call that said so. */
  crossed(head: THREE.Vector3): boolean;
}

/** A canvas texture, sRGB. */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** What the opening shows until the view loads, or for good without one: the name on a dim glow, as the Hallway's previewFallback. */
function fallbackTexture(name: string, glow: string): THREE.CanvasTexture {
  return canvasTexture(1024, 512, (g) => {
    const grad = g.createRadialGradient(512, 300, 20, 512, 300, 560);
    grad.addColorStop(0, `${glow}66`);
    grad.addColorStop(1, '#0d0f13');
    g.fillStyle = '#0d0f13';
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#e8e2d6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 64px system-ui, sans-serif';
    g.fillText(name, 512, 300, 360);
  });
}

/** The sign over the door: its name, light on dark, edged in the glow. */
function signTexture(name: string, glow: string): THREE.CanvasTexture {
  return canvasTexture(512, 160, (g) => {
    g.fillStyle = '#1b1e25';
    g.fillRect(0, 0, 512, 160);
    g.strokeStyle = glow;
    g.lineWidth = 6;
    g.strokeRect(9, 9, 494, 142);
    g.fillStyle = '#efe9dc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 68px system-ui, sans-serif';
    g.fillText(name, 256, 84, 440);
  });
}

/**
 * The doorway, its opening `width` x `height` with its sill's middle at (0, 0, z), facing -z (into
 * the room, where the visitor arrives), glowing in `glow`, `name` on its sign.
 */
export function buildDoorway({ width, height, z, glow, name, anisotropy }: { width: number; height: number; z: number; glow: string; name: string; anisotropy: number }): Doorway {
  const group = new THREE.Group();
  group.name = 'doorway';
  group.position.z = z;
  group.rotation.y = Math.PI; // its +z faces the room

  const wood = new THREE.MeshStandardMaterial({ color: '#3b3029', roughness: 0.75 });
  const box = (w: number, h: number, d: number, x: number, y: number, zz: number, material: THREE.Material = wood) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, zz);
    group.add(m);
    return m;
  };
  const depth = 0.16;
  for (const s of [-1, 1]) box(FRAME, height + FRAME, depth, s * (width / 2 + FRAME / 2), (height + FRAME) / 2, 0);
  box(width + 2 * FRAME, FRAME, depth, 0, height + FRAME / 2, 0);
  box(width + 2 * FRAME + 0.06, 0.03, depth + 0.1, 0, 0.015, 0); // the threshold
  // Behind the opening, a dark panel: from behind, a closed door.
  box(width, height, 0.02, 0, height / 2, -depth / 2 + 0.01, new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.9 }));

  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.26), new THREE.MeshBasicMaterial({ map: signTexture(name, glow) }));
  sign.position.set(0, height + FRAME + 0.2, depth / 2 + 0.002);
  group.add(sign);

  const fallback = fallbackTexture(name, glow);
  const portal = new THREE.Mesh(openingGeometry(width, height), portalMaterial(fallback, width, height, PICTURE, glow));
  portal.name = 'portal';
  portal.position.z = depth / 2 - 0.02;
  group.add(portal);
  placePortal(portal);

  let glowing = 0;
  let time = 0;
  let armed = false; // the head was in the room, in front of the opening's plane

  return {
    group,
    portal,
    async loadView(source) {
      try {
        const res = await fetch(source.views, { cache: 'no-cache' });
        const v = res.ok ? viewParams(((await res.json()) as { views?: Record<string, unknown> })?.views?.[source.id]) : null;
        if (!v) throw new Error(res.ok ? `no view for door ${source.id}` : `HTTP ${res.status}`);
        const map = await new THREE.TextureLoader().loadAsync(new URL(v.image, res.url).href);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = anisotropy;
        setView(portal.material, map, v);
        fallback.dispose();
        return true;
      } catch (err) {
        console.info(`breadboard: no view through the doorway from ${source.views} (${(err as Error).message})`);
        return false;
      }
    },
    update(dt, head, hover) {
      const near = z - head.z < 1.8 && head.z < z && Math.abs(head.x) < 1.6;
      const target = hover ? 1 : near ? 0.45 : 0;
      glowing += (target - glowing) * (1 - Math.exp(-dt * 7));
      time += dt;
      portal.material.uniforms.uGlow.value = glowing;
      portal.material.uniforms.uTime.value = time;
    },
    crossed(head) {
      if (head.z < z) {
        armed = true;
        return false;
      }
      if (!armed || head.z < z + THRESHOLD) return false;
      armed = false; // through, or round the frame: either way, not again until back in the room
      return Math.abs(head.x) < width / 2 && head.y < height + 0.3;
    },
  };
}
