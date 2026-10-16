import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { MODULE_BOARDS } from '../breadboard/boards';
import { composeComputer } from '../breadboard/computer-layout';
import { Machine } from '../sim/machine';
import { PROGRAMS } from '../sim/programs';
import { buildComputerModel } from './model';
import { ControlPanel } from './panel';
import { boardTexture, labelTexture } from './textures';
import './vr.css';

/**
 * VR view: the breadboard computer on a table, run live by the simulator. In a headset
 * (WebXR, "Enter VR") you point at the control panel behind the table with a controller and
 * pull the trigger; on a screen you orbit with the mouse or a finger and click the panel.
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
model.root.scale.setScalar(UNIT);
model.root.position.set(0, TABLE_TOP + 2.6 * UNIT, TABLE_Z);
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
let dirty = true;
machine.onChange(() => (dirty = true));

const fmtHz = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toPrecision(3)} kHz` : `${+hz.toPrecision(2)} Hz`);
const running = () => machine.running && machine.mode === 'auto';

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
    { label: () => 'Fit view', run: () => homeView() },
  ],
  'Breadboard 8-bit',
);
panel.group.position.set(0, TABLE_TOP + 0.3, TABLE_Z - 0.62);
panel.group.rotation.x = -0.12;
scene.add(panel.group);

function sync() {
  const c = machine.computer;
  for (const id of ledIds) model.setLed(id, composed.live.leds[id](c, machine));
  for (const id of segIds) model.setSeg7(id, composed.live.seg7[id](c, machine));
  const lines = [
    PROGRAMS[program].title,
    `${c.halted ? 'halted' : running() ? 'running' : 'stopped'} at ${fmtHz(machine.hz)} · T${c.step} · cycle ${c.cycles} · OUT ${c.out}`,
  ];
  panel.setStatus(lines);
  panel.refresh();
  statusEl.textContent = lines.join(' · ');
}


// ---- pointing: mouse / finger on screen, controller rays in VR ----
const raycaster = new THREE.Raycaster();
const pick = (): THREE.Object3D | null => raycaster.intersectObjects(panel.targets, false)[0]?.object ?? null;
const fromPointer = (e: PointerEvent) => {
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return pick();
};
let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
    const hit = fromPointer(e);
    if (hit) panel.press(hit);
  }
  down = null;
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && !down) {
    const hit = fromPointer(e);
    panel.setHover(hit);
    renderer.domElement.style.cursor = hit ? 'pointer' : '';
  }
});

const rays: { ctrl: THREE.XRTargetRaySpace; line: THREE.Line }[] = [];
for (const i of [0, 1]) {
  const ctrl = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: '#8ab8ff' }));
  line.scale.z = 3;
  ctrl.add(line);
  ctrl.addEventListener('select', () => {
    raycaster.setFromXRController(ctrl);
    const hit = pick();
    if (hit) panel.press(hit);
  });
  scene.add(ctrl);
  rays.push({ ctrl, line });
}
function pointControllers() {
  let hover: THREE.Object3D | null = null;
  for (const { ctrl, line } of rays) {
    raycaster.setFromXRController(ctrl);
    const hit = raycaster.intersectObjects(panel.targets, false)[0];
    line.scale.z = hit ? hit.distance : 3;
    hover ??= hit?.object ?? null;
  }
  panel.setHover(hover);
}

// ---- loop ----
addEventListener('resize', () => {
  fitLens();
  renderer.setSize(innerWidth, innerHeight);
});
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  machine.frame(now - last);
  last = now;
  if (dirty) {
    dirty = false;
    sync();
  }
  if (renderer.xr.isPresenting) pointControllers();
  else controls.update();
  renderer.render(scene, camera);
});
document.body.dataset.ready = JSON.stringify(model.counts);

// Built site only: offline use, as on the main page (scripts/sw-dist.mjs).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
