import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { decodeLayout } from '../breadboard/share';
import { Carry, twist } from './carry';
import { EXAMPLE_IDS, circuitExhibit, computerExhibit, exampleExhibit, exhibitHash, parseExhibitHash, type Exhibit, type ExhibitChoice, type Hold } from './exhibits';
import { BOARD_T, buildComputerModel, disposeTree, type ComputerModel, type ControlHit } from './model';
import { ControlPanel, Tooltip } from './panel';
import { boardTexture, labelTexture } from './textures';
import './vr.css';

/**
 * VR view: the breadboard computer on a table, run live by the simulator, or a circuit from the
 * sandbox (vr.html#c1.… from a share link, or #example/<id>). In a headset (WebXR, "Enter VR")
 * you point with a controller and pull the trigger, at the control panel behind the table or at
 * the switches and buttons on the boards; the grip buttons pick the boards up (both grips: pull
 * apart to make them bigger). On a screen you orbit with the mouse or a finger and click the
 * panel and the boards. "Next ▸" on the panel goes through the computer and the examples.
 */

const UNIT = 0.00254 * 1.5; // one breadboard pitch (0.1") in metres, at 1.5x real size
const TABLE_TOP = 0.76;
const TABLE_Z = -0.72; // the user starts at the origin, facing -z
const TITLE = document.title;

const host = document.getElementById('vr-root')!;
const statusEl = document.getElementById('vr-status')!;

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  statusEl.textContent = 'This browser cannot show 3D graphics (WebGL is off or unavailable).';
  throw new Error('no WebGL');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
host.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
const inVR = () => renderer.xr.isPresenting;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111318');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);
const HOME = { eye: new THREE.Vector3(0, 1.3, -0.02), target: new THREE.Vector3(0, TABLE_TOP + 0.1, TABLE_Z - 0.2) };
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.15;
controls.maxDistance = 4;
controls.maxPolarAngle = Math.PI * 0.49; // stay above the floor
/** A wider lens on tall (portrait) screens, so less of the table is cut off at the sides. */
const fitLens = () => {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 66 : 50;
  camera.updateProjectionMatrix();
};
/** The home view, pulled back on narrow screens until the table fits across as on a 16:10 one. */
function homeView() {
  fitLens();
  const want = Math.tan(THREE.MathUtils.degToRad(25)) * 1.6 * 0.85;
  const shown = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  camera.position.copy(HOME.target).addScaledVector(HOME.eye.clone().sub(HOME.target), Math.max(1, want / shown));
  controls.target.copy(HOME.target);
  controls.update();
}
homeView();

// ---- room ----
scene.add(new THREE.HemisphereLight('#dfe6ff', '#2a2420', 1.4));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(0.8, 3, 1.2);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: '#1a1d24', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(14, 28, '#2c3240', '#222731');
grid.position.y = 0.001;
scene.add(grid);
const wood = new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 0.7 });
const table = new THREE.Group();
const top = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.04, 1.0), wood);
top.position.y = TABLE_TOP - 0.02;
table.add(top);
for (const [x, z] of [[-0.5, -0.44], [0.5, -0.44], [-0.5, 0.44], [0.5, 0.44]]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE_TOP - 0.04, 0.05), wood);
  leg.position.set(x, (TABLE_TOP - 0.04) / 2, z);
  table.add(leg);
}
table.position.z = TABLE_Z;
scene.add(table);

// ---- what is on the table: the exhibit, its model, and its control panel ----
const boardTex = boardTexture(renderer.capabilities.getMaxAnisotropy()); // shared by every model
let exhibit: Exhibit | null = null;
let choice: ExhibitChoice = { kind: 'computer' };
let model: ComputerModel | null = null;
let panel: ControlPanel | null = null;
let home = UNIT; // the model's scale on the table
let carry: Carry | null = null;
let targets: THREE.Object3D[] = [];
let notice = '';
let dirty = true;

/** What "Next ▸" goes through: the computer, the sandbox's examples, and first a shared circuit when the link had one. */
const order: ExhibitChoice[] = [{ kind: 'computer' }, ...EXAMPLE_IDS.map((id): ExhibitChoice => ({ kind: 'example', id }))];
const indexOf = (c: ExhibitChoice) => order.findIndex((o) => exhibitHash(o) === exhibitHash(c));

/** Back on the table at its home size, after being picked up in VR. */
function putBack() {
  if (!model) return;
  model.root.position.set(0, TABLE_TOP + BOARD_T * home, TABLE_Z);
  model.root.quaternion.identity();
  model.root.scale.setScalar(home);
}

async function open(c: ExhibitChoice) {
  try {
    if (c.kind === 'circuit') {
      const layout = await decodeLayout(c.code);
      if (indexOf(c) < 0) order.unshift(c);
      setExhibit(circuitExhibit('Shared circuit', layout), c);
    } else setExhibit(c.kind === 'example' ? exampleExhibit(c.id) : computerExhibit(), c);
  } catch (e) {
    setExhibit(computerExhibit(), { kind: 'computer' });
    notice = `The link has no circuit in it (${(e as Error).message}).`;
  }
}

function setExhibit(next: Exhibit, c: ExhibitChoice) {
  // let go of whatever the old one had in hand, and free its model and panel
  press?.hold?.end(false);
  press = null;
  for (const ray of rays) ray.hold = null;
  if (model) {
    scene.remove(model.root);
    disposeTree(model.root, [boardTex]);
  }
  if (panel) {
    scene.remove(panel.group);
    disposeTree(panel.group);
  }
  exhibit = next;
  choice = c;
  notice = '';
  model = buildComputerModel(next.layout, { boardTexture: boardTex, label: labelTexture });
  // 1.5x real size; small circuits bigger, to cover some of the table (up to 6x)
  home = Math.min(4 * UNIT, Math.max(UNIT, 0.62 / Math.max(model.size.w, model.size.d)));
  putBack();
  scene.add(model.root);
  carry = new Carry(model.root, 0.5 * home, 8 * home);
  carry.grip(holding);

  panel = new ControlPanel(
    [
      ...next.actions,
      { label: () => 'Next ▸', run: () => void open(order[(indexOf(choice) + 1) % order.length]) },
      { label: () => (inVR() ? 'Put back' : 'Fit view'), run: () => (putBack(), inVR() || homeView()) },
    ],
    next.title,
  );
  panel.group.position.set(0, TABLE_TOP + 0.3, TABLE_Z - 0.62);
  panel.group.rotation.x = -0.12;
  scene.add(panel.group);
  targets = [...panel.targets, ...model.hitTargets];
  hover(null);

  history.replaceState(null, '', location.pathname + location.search + exhibitHash(c));
  document.title = c.kind === 'computer' ? TITLE : `${next.title} · ${TITLE}`;
  document.body.dataset.ready = JSON.stringify({ exhibit: c.kind === 'example' ? `example/${c.id}` : c.kind, ...model.counts });
  dirty = true;
}

function sync() {
  if (!exhibit || !model || !panel) return;
  exhibit.show(model);
  const lines = exhibit.status();
  panel.setStatus(lines);
  panel.refresh();
  statusEl.textContent = [notice, ...lines].filter(Boolean).join(' · ');
  showTip();
}

// ---- pointing: mouse / finger on screen, controller rays in VR ----
const raycaster = new THREE.Raycaster();
const pick = (): THREE.Intersection | undefined => raycaster.intersectObjects(targets, false)[0];
const hitOf = (o: THREE.Object3D | null | undefined): ControlHit | null => (o && model?.hitTargets.includes(o as THREE.Mesh) ? (o.userData as ControlHit) : null);
const isPanel = (o: THREE.Object3D | null | undefined) => !!o && !!panel?.targets.includes(o as THREE.Mesh);
const begin = (hit: ControlHit): Hold | null => exhibit?.begin(hit) ?? null;

const tooltip = new Tooltip();
scene.add(tooltip.sprite);
let hovered: THREE.Object3D | null = null;
const box = new THREE.Box3();
function showTip() {
  const hit = hitOf(hovered);
  if (!hit || !exhibit) return tooltip.hide();
  box.setFromObject(hovered!);
  const at = box.getCenter(new THREE.Vector3()).setY(box.max.y + 0.004);
  tooltip.show(exhibit.describe(hit, inVR()), at);
}
function hover(o: THREE.Object3D | null) {
  hovered = o;
  panel?.setHover(o);
  model?.setHover(o);
  showTip();
}

// Screen. A press on a board control is the control's: OrbitControls (listening on the canvas)
// must not also turn the view, so this listens on the canvas's parent, in the capture phase.
const fromPointer = (e: MouseEvent) => {
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return pick()?.object ?? null;
};
let press: { x: number; y: number; id: number; hold: Hold | null } | null = null;
host.addEventListener(
  'pointerdown',
  (e) => {
    if (press) {
      if (e.pointerType === 'touch' && e.pointerId !== press.id) return; // a second finger: pinch-zooming
      press.hold?.end(false); // a press whose release never came
    }
    const o = fromPointer(e);
    const hit = hitOf(o);
    controls.enabled = !hit;
    fly = null;
    press = { x: e.clientX, y: e.clientY, id: e.pointerId, hold: hit ? begin(hit) : null };
    if (hit) renderer.domElement.setPointerCapture(e.pointerId);
    hover(o);
  },
  true,
);
renderer.domElement.addEventListener('pointermove', (e) => {
  if (press?.hold?.turn && e.pointerId === press.id) return press.hold.turn((press.y - e.clientY) / 150);
  if (e.pointerType === 'mouse' && !press) {
    const o = fromPointer(e);
    if (o !== hovered) hover(o);
    renderer.domElement.style.cursor = o ? 'pointer' : '';
  }
});
const finish = (e: PointerEvent, cancelled: boolean) => {
  if (!press || e.pointerId !== press.id) return;
  const click = !cancelled && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8;
  if (press.hold) press.hold.end(click);
  else if (click) {
    const o = fromPointer(e);
    if (isPanel(o)) panel!.press(o!);
  }
  press = null;
  controls.enabled = true;
};
renderer.domElement.addEventListener('pointerup', (e) => finish(e, false));
renderer.domElement.addEventListener('pointercancel', (e) => finish(e, true));

// Double-click (or double-tap) the boards to fly three times closer to that spot: on a screen the
// switches are small from the home view.
let fly: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null;
renderer.domElement.addEventListener('dblclick', (e) => {
  if (!model) return;
  fromPointer(e);
  const spot = raycaster.intersectObject(model.root, true)[0]?.point;
  if (!spot) return;
  const dist = Math.max(controls.minDistance, camera.position.distanceTo(controls.target) / 3);
  const eye = spot.clone().add(camera.position.clone().sub(controls.target).setLength(dist));
  fly = { from: [camera.position.clone(), controls.target.clone()], to: [eye, spot], t: 0 };
});
function flyOn(ms: number) {
  if (!fly) return;
  fly.t = Math.min(1, fly.t + ms / 350);
  const k = 1 - (1 - fly.t) ** 3; // ease out
  camera.position.lerpVectors(fly.from[0], fly.to[0], k);
  controls.target.lerpVectors(fly.from[1], fly.to[1], k);
  if (fly.t === 1) fly = null;
}

// VR controllers: the trigger points and presses, the grip picks the boards up (both grips: pull
// apart to make them bigger, from half to 8 times their size on the table).
const holding: THREE.XRTargetRaySpace[] = [];
const rollOf = (ctrl: THREE.Object3D) => new THREE.Euler().setFromQuaternion(ctrl.quaternion, 'YXZ').z;
const rays: { ctrl: THREE.XRTargetRaySpace; line: THREE.Line; hold: { hold: Hold; roll0: number } | null }[] = [];
for (const i of [0, 1]) {
  const ctrl = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: '#8ab8ff' }));
  line.scale.z = 3;
  ctrl.add(line);
  const ray = { ctrl, line, hold: null as { hold: Hold; roll0: number } | null };
  ctrl.addEventListener('selectstart', () => {
    raycaster.setFromXRController(ctrl);
    const o = pick()?.object;
    const hit = hitOf(o);
    const hold = hit && begin(hit);
    if (hold) ray.hold = { hold, roll0: rollOf(ctrl) };
    else if (isPanel(o)) panel!.press(o!);
  });
  ctrl.addEventListener('selectend', () => {
    ray.hold?.hold.end(true);
    ray.hold = null;
  });
  ctrl.addEventListener('squeezestart', () => {
    if (!holding.includes(ctrl)) holding.push(ctrl);
    carry?.grip(holding);
  });
  ctrl.addEventListener('squeezeend', () => {
    const at = holding.indexOf(ctrl);
    if (at >= 0) holding.splice(at, 1);
    carry?.grip(holding);
  });
  scene.add(ctrl);
  rays.push(ray);
}
function pointControllers() {
  let over: THREE.Object3D | null = null;
  for (const ray of rays) {
    const { ctrl, line, hold } = ray;
    if (hold?.hold.turn) hold.hold.turn(twist(hold.roll0, rollOf(ctrl))); // a pot turns with the wrist
    raycaster.setFromXRController(ctrl);
    const hit = pick();
    line.scale.z = hit ? hit.distance : 3;
    over ??= hit?.object ?? null;
  }
  if (over !== hovered) hover(over);
  else showTip(); // follow the boards while they are carried
}
renderer.xr.addEventListener('sessionstart', () => (dirty = true));
renderer.xr.addEventListener('sessionend', () => {
  holding.length = 0;
  carry?.grip(holding);
  for (const ray of rays) ray.hold = null;
  putBack(); // the screen view looks at the table
  homeView();
  dirty = true;
});

// ---- loop ----
addEventListener('resize', () => {
  fitLens();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('hashchange', () => void open(parseExhibitHash(location.hash)));
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (exhibit?.frame(now - last)) dirty = true;
  if (inVR()) {
    carry?.follow(holding);
    pointControllers();
  } else {
    flyOn(now - last);
    controls.update();
  }
  last = now;
  if (dirty) {
    dirty = false;
    sync();
  }
  renderer.render(scene, camera);
});
void open(parseExhibitHash(location.hash));

// For the browser check (scripts/check-browser.mjs) and the console: what is on the table, the
// computer's machine when that is it, and where on the screen a control is (the middle of its hit
// box's top; DIP switches by bit).
Object.assign(window, {
  breadboardVR: {
    get exhibit() {
      return exhibit;
    },
    get machine() {
      return exhibit && 'machine' in exhibit ? exhibit.machine : undefined;
    },
    screenPoint(part: string, bit?: number) {
      const o = model?.hitTargets.find((t) => t.userData.part === part && (bit === undefined || t.userData.bit === bit));
      if (!o) return null;
      scene.updateMatrixWorld(); // also before the first frame
      camera.updateMatrixWorld();
      const b = new THREE.Box3().setFromObject(o);
      const p = b.getCenter(new THREE.Vector3()).setY(b.max.y).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
  },
});

// Built site only: offline use, as on the main page (scripts/sw-dist.mjs).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
