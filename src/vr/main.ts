import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { MODULE_BOARDS } from '../breadboard/boards';
import { composeComputer } from '../breadboard/computer-layout';
import { Machine } from '../sim/machine';
import { PROGRAMS } from '../sim/programs';
import { Carry, twist } from './carry';
import { buildComputerModel, type ControlHit } from './model';
import { ControlPanel, Tooltip } from './panel';
import { boardTexture, labelTexture } from './textures';
import './vr.css';

/**
 * VR view: the breadboard computer on a table, run live by the simulator. In a headset
 * (WebXR, "Enter VR") you point with a controller and pull the trigger, at the control panel
 * behind the table or at the switches and buttons on the boards; the grip buttons pick the
 * computer up (both grips: pull apart to make it bigger). On a screen you orbit with the mouse or
 * a finger and click the panel and the boards.
 */

const UNIT = 0.00254 * 1.5; // one breadboard pitch (0.1") in metres, at 1.5x real size
const TABLE_TOP = 0.76;
const TABLE_Z = -0.72; // the user starts at the origin, facing -z

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

// ---- the computer ----
const composed = composeComputer([...MODULE_BOARDS.values()]);
const model = buildComputerModel(composed.layout, { boardTexture: boardTexture(renderer.capabilities.getMaxAnisotropy()), label: labelTexture });
const ON_TABLE = new THREE.Vector3(0, TABLE_TOP + 2.6 * UNIT, TABLE_Z);
/** Back on the table at 1.5x, after being picked up in VR. */
function putBack() {
  model.root.position.copy(ON_TABLE);
  model.root.quaternion.identity();
  model.root.scale.setScalar(UNIT);
}
putBack();
scene.add(model.root);

const machine = new Machine({ microcodeVersion: 'flags' });
let program = PROGRAMS.findIndex((p) => p.id === 'count-by-3');
const load = (i: number) => {
  program = (i + PROGRAMS.length) % PROGRAMS.length;
  const wasRunning = machine.running && machine.mode === 'auto';
  machine.loadSource(PROGRAMS[program].source);
  if (wasRunning) machine.start();
};
load(program);
machine.setHz(4);
machine.start();

const ledIds = Object.keys(composed.live.leds);
const segIds = Object.keys(composed.live.seg7);
const live = composed.live.controls;
const parts = new Map(composed.layout.parts.map((p) => [p.id, p]));
let dirty = true;
machine.onChange(() => (dirty = true));

const fmtHz = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toPrecision(3)} kHz` : `${+hz.toPrecision(2)} Hz`);
const running = () => machine.running && machine.mode === 'auto';
const inVR = () => renderer.xr.isPresenting;

// ---- control panel, standing behind the table like a monitor ----
const panel = new ControlPanel(
  [
    { label: () => (running() ? 'Stop' : 'Run'), run: () => (running() ? machine.stop() : machine.start()), primary: true },
    { label: () => 'Pulse', run: () => machine.pulse() },
    { label: () => 'Step', run: () => machine.stepInstruction() },
    { label: () => 'Reset', run: () => machine.reset() },
    { label: () => 'Slower', run: () => machine.setHz(Math.max(0.5, machine.hz / 2)) },
    { label: () => 'Faster', run: () => machine.setHz(Math.min(500_000, machine.hz * 2)) },
    { label: () => 'Program ▸', run: () => load(program + 1) },
    { label: () => (inVR() ? 'Put back' : 'Fit view'), run: () => (putBack(), inVR() || homeView()) },
  ],
  'Breadboard 8-bit',
);
panel.group.position.set(0, TABLE_TOP + 0.3, TABLE_Z - 0.62);
panel.group.rotation.x = -0.12;
scene.add(panel.group);

// ---- the switches, buttons and pot on the boards, as in the breadboard view ----

/** What pressing a control does until it is let go: `end(click)` with click = not dragged. */
interface Hold {
  end(click: boolean): void;
  /** Pots: turn by `by` (a whole turn is 1) from where the hold started. */
  turn?(by: number): void;
}

function begin(hit: ControlHit): Hold | null {
  const ctl = live[hit.part];
  const changed = () => machine.changed();
  switch (ctl?.kind) {
    case 'button':
      ctl.press(machine);
      model.setControl(hit.part, 1);
      changed();
      return {
        end() {
          ctl.release?.(machine);
          model.setControl(hit.part, 0);
          changed();
        },
      };
    case 'slide':
      return { end: (click) => click && (ctl.set(machine, ctl.get(machine) ? 0 : 1), changed()) };
    case 'dip':
      return { end: (click) => click && (ctl.set(machine, ctl.get(machine) ^ (1 << (hit.bit ?? 0))), changed()) };
    case 'pot': {
      const t0 = ctl.get(machine);
      return { end() {}, turn: (by) => (ctl.set(machine, Math.max(0, Math.min(1, t0 + by))), changed()) };
    }
  }
  return null;
}

function describe(hit: ControlHit): string {
  const ctl = live[hit.part];
  const name = parts.get(hit.part)?.label ?? hit.part.split('/').pop()!;
  switch (ctl?.kind) {
    case 'slide': {
      const pos = ctl.get(machine);
      return `${name}: ${ctl.positions?.[pos] ?? `position ${pos}`}`;
    }
    case 'dip': {
      const k = hit.bit ?? 0;
      return `${name} switch ${k + 1}: ${(ctl.get(machine) >> k) & 1 ? 'ON' : 'off'}`;
    }
    case 'pot': {
      const value = hit.part === 'clock/RV1' ? fmtHz(machine.hz) : `${Math.round(ctl.get(machine) * 100)}%`;
      return `${name}: ${value} · ${inVR() ? 'hold the trigger and twist' : 'drag up or down'}`;
    }
    case 'button':
      return `${name} · push`;
  }
  return name;
}

function sync() {
  const c = machine.computer;
  for (const id of ledIds) model.setLed(id, composed.live.leds[id](c, machine));
  for (const id of segIds) model.setSeg7(id, composed.live.seg7[id](c, machine));
  for (const [id, ctl] of Object.entries(live)) if (ctl.kind !== 'button') model.setControl(id, ctl.get(machine));
  const lines = [
    PROGRAMS[program].title,
    `${c.halted ? 'halted' : running() ? 'running' : 'stopped'} at ${fmtHz(machine.hz)} · T${c.step} · cycle ${c.cycles} · OUT ${c.out}`,
  ];
  panel.setStatus(lines);
  panel.refresh();
  statusEl.textContent = lines.join(' · ');
  showTip();
}

// ---- pointing: mouse / finger on screen, controller rays in VR ----
const raycaster = new THREE.Raycaster();
const targets: THREE.Object3D[] = [...panel.targets, ...model.hitTargets];
const pick = (): THREE.Intersection | undefined => raycaster.intersectObjects(targets, false)[0];
const hitOf = (o: THREE.Object3D | null | undefined): ControlHit | null => (o && model.hitTargets.includes(o as THREE.Mesh) ? (o.userData as ControlHit) : null);
const isPanel = (o: THREE.Object3D | null | undefined) => !!o && panel.targets.includes(o as THREE.Mesh);

const tooltip = new Tooltip();
scene.add(tooltip.sprite);
let hovered: THREE.Object3D | null = null;
const box = new THREE.Box3();
function showTip() {
  const hit = hitOf(hovered);
  if (!hit) return tooltip.hide();
  box.setFromObject(hovered!);
  const at = box.getCenter(new THREE.Vector3()).setY(box.max.y + 0.004);
  tooltip.show(describe(hit), at);
}
function hover(o: THREE.Object3D | null) {
  hovered = o;
  panel.setHover(o);
  model.setHover(o);
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
    if (isPanel(o)) panel.press(o!);
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

// VR controllers: the trigger points and presses, the grip picks the computer up (both grips:
// pull apart to make it bigger, from half to 8 times the size on the table).
const carry = new Carry(model.root, 0.5 * UNIT, 8 * UNIT);
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
    else if (isPanel(o)) panel.press(o!);
  });
  ctrl.addEventListener('selectend', () => {
    ray.hold?.hold.end(true);
    ray.hold = null;
  });
  ctrl.addEventListener('squeezestart', () => {
    if (!holding.includes(ctrl)) holding.push(ctrl);
    carry.grip(holding);
  });
  ctrl.addEventListener('squeezeend', () => {
    const at = holding.indexOf(ctrl);
    if (at >= 0) holding.splice(at, 1);
    carry.grip(holding);
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
  else showTip(); // follow the computer while it is carried
}
renderer.xr.addEventListener('sessionstart', () => (dirty = true));
renderer.xr.addEventListener('sessionend', () => {
  holding.length = 0;
  carry.grip(holding);
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
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  machine.frame(now - last);
  if (inVR()) {
    carry.follow(holding);
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
document.body.dataset.ready = JSON.stringify(model.counts);

// For the browser check (scripts/check-browser.mjs) and the console: the machine, and where on
// the screen a control is (the middle of its hit box's top; DIP switches by bit).
Object.assign(window, {
  breadboardVR: {
    machine,
    screenPoint(part: string, bit?: number) {
      const o = model.hitTargets.find((t) => t.userData.part === part && (bit === undefined || t.userData.bit === bit));
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
