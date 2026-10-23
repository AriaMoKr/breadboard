import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { decodeLayout } from '../breadboard/share';
import { buildLabel } from '../build-info';
import { Carry, Twist } from './carry';
import { EXAMPLE_IDS, circuitExhibit, computerExhibit, exampleExhibit, exhibitHash, parseExhibitHash, type Exhibit, type ExhibitChoice, type Hold } from './exhibits';
import { buildDoorway } from './door';
import { Fade } from 'common/fade.js';
import { hallwayViews, leaveUrl, readVisit, wayBack, withoutVisit } from 'common/door.js';
import { loadNav, saveNav, type Nav } from 'common/nav.js';
import { BREADBOARD_ID, DOOR, doorOf, keptDoor } from './hallway';
import { BOARD_T, buildComputerModel, disposeTree, type ComputerModel, type ControlHit } from './model';
import { AimStick, TurnStick, XR_WALK, clampWalk, headYaw, standable, turnedAbout, walkDelta, wrapAngle, type Rect } from './move';
import { ControlPanel, Tooltip } from './panel';
import { boardTexture, labelTexture } from './textures';
import { Together } from './together';
import { roomFromUrl } from 'layersharedsession/room.js';
import './vr.css';

/**
 * VR view: the breadboard computer on a table, run live by the simulator, or a circuit from the
 * sandbox (vr.html#c1.… from a share link, or #example/<id>). In a headset (WebXR, "Enter VR")
 * you point with a controller and pull the trigger, at the control panel behind the table or at
 * the switches and buttons on the boards; the grip buttons pick the boards up (both grips: pull
 * apart to make them bigger); the sticks walk and turn, as in the Hallway (move.ts, common's
 * nav.js, and the room's panel left of the table). On a screen you orbit with the mouse or a
 * finger and click the panel and the boards. "Next ▸" on the panel goes through the computer and
 * the examples.
 */

const UNIT = 0.00254 * 1.5; // one breadboard pitch (0.1") in metres, at 1.5x real size
const TABLE_TOP = 0.76;
const TABLE_Z = -0.72; // the user starts at the origin, facing -z
const TITLE = document.title;

const host = document.getElementById('vr-root')!;
const statusEl = document.getElementById('vr-status')!;

// On the dev server, vr.html?xr=emulate emulates a Quest 3 with Meta's IWER, before anything asks
// navigator.xr (Chromium has a native one even without a headset, so it is replaced). A build
// leaves this out: import.meta.env.DEV is false there, and the import goes with it.
let xrDevice: import('iwer').XRDevice | null = null;
if (import.meta.env.DEV && new URLSearchParams(location.search).get('xr') === 'emulate') {
  const { XRDevice, metaQuest3 } = await import('iwer');
  xrDevice = new XRDevice(metaQuest3);
  xrDevice.installRuntime({ forceInstall: true });
  console.info('breadboard: IWER WebXR emulation installed (Meta Quest 3)');
}

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
// For screen readers the 3D view is one picture, named by what is on the table (setExhibit).
renderer.domElement.setAttribute('role', 'img');
host.appendChild(renderer.domElement);
const vrButton = VRButton.createButton(renderer); // "Enter VR" on the page; the panel's VR button clicks it too
document.body.appendChild(vrButton);
const inVR = () => renderer.xr.isPresenting;
// three's button offers the browser a session when it is made (for the browser's own Enter VR,
// navigator.xr.offerSession), and its Exit VR offers another. After a session the button started,
// the first offer is still open and a second cancels it, with a warning in the console: so leave
// such a session by ending it, and through the button only one that took the browser's offer.
// A session taken from a grant (takeGranted, below) is this page's own too.
let clicked = false;
let fromButton = false;
vrButton.addEventListener('click', () => (clicked = !inVR()));
const exitVR = () => (fromButton ? void renderer.xr.getSession()?.end() : vrButton.click());
let vrSupported = false;
void navigator.xr?.isSessionSupported('immersive-vr').then((ok) => {
  vrSupported = ok;
  dirty = true;
}, () => {});
document.querySelector('.vr-bar')?.append(Object.assign(document.createElement('span'), { className: 'vr-build', title: 'The commit this was built from, and its date', textContent: buildLabel() }));

// ---- the way back, when a door of the Hallway led here (common's door.js, hallway.ts, door.ts) ----
// What the door added to the address is read once and taken off it. The way back and its doorway
// (size, glow) stay for this tab (a reload, or the main page and back) in sessionStorage. It is on
// the page's bar, in the panel's corner, and a doorway in the room behind where the visitor
// arrives, with the Hallway seen through it; taken in VR, Quest Browser can keep the visitor in VR
// on the Hallway's side.
const DOOR_KEY = 'breadboard:door';
const visit = readVisit(location.search);
// Visited without a door (the main page's link, a bookmark), there is no way back: always: false.
const found = wayBack(location.search, BREADBOARD_ID, { origin: location.origin, always: false });
const kept = (() => {
  try {
    if (!found) return keptDoor(sessionStorage.getItem(DOOR_KEY));
    const k = doorOf(found, visit);
    sessionStorage.setItem(DOOR_KEY, JSON.stringify(k));
    return k;
  } catch {
    return found && doorOf(found, visit); // no storage (a private window, blocked site data): the way back lasts this page only
  }
})();
const way = kept?.way ?? null;
const unvisited = withoutVisit(location.href);
if (unvisited !== location.pathname + location.search + location.hash) history.replaceState(null, '', unvisited);
let leaving = false;
let leaveTimer = 0;
/** Back through the door: in VR after a moment of black, as the Hallway goes through its doors. */
function go() {
  if (!way || leaving) return;
  leaving = true;
  // The link carries the shared session's room on; leaving it now lets the others see the visitor
  // go at once (the fade gives the leaving message time to go out).
  const url = leaveUrl(way, together.room);
  together.pause();
  if (inVR()) fade.to(1, 0.3, () => location.assign(url));
  else location.assign(url);
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(cameBack, 12000); // still here: the navigation was stopped or failed
}
/** Here again after going back (the browser's back/forward cache, or a navigation that didn't happen). */
function cameBack() {
  leaving = false;
  clearTimeout(leaveTimer);
  fade.to(0, 0.6);
  together.resume();
}
addEventListener('pageshow', (e) => {
  if (e.persisted) cameBack();
});
// Leaving another way (the bar's link, the address bar, closing the tab): out of the session too.
addEventListener('pagehide', () => together.pause());
const wayLink = way && Object.assign(document.createElement('a'), { className: 'vr-hallway', href: way.url, title: way.title, textContent: way.label });
if (wayLink) document.querySelector('.vr-bar')?.prepend(wayLink);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111318');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);
// The camera and the controllers ride on a rig: in VR it is where the visitor stands in the room
// and which way the room is turned for them. On a screen it stays at the origin.
const rig = new THREE.Group();
rig.name = 'rig';
rig.add(camera);
scene.add(rig);
const fade = new Fade(camera, 0);
const head = new THREE.Vector3(); // the camera's world position, and the way it looks
const facing = new THREE.Vector3();
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
/** The home view's eye and target, pulled back on narrow screens until the table fits across as on a 16:10 one. */
function homePose(): [THREE.Vector3, THREE.Vector3] {
  fitLens();
  const want = Math.tan(THREE.MathUtils.degToRad(25)) * 1.6 * 0.85;
  const shown = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  return [HOME.target.clone().addScaledVector(HOME.eye.clone().sub(HOME.target), Math.max(1, want / shown)), HOME.target.clone()];
}
function homeView() {
  const [eye, target] = homePose();
  camera.position.copy(eye);
  controls.target.copy(target);
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

// The doorway back stands behind the start, facing the table. Coming through it, the visitor
// arrives where the Hallway's picture of this room is taken (preview(), below), so the room
// carries on from what the doorway showed: dx to the side, turned by yaw, as they went through.
// From the start (0 m) the panel would fill that picture with the table below it; 1.2 m back the
// whole table and the computer on it are in its lower middle, which a doorway shows best.
const DOOR_Z = 1.8;
const ARRIVE_Z = 1.2;
const anisotropy = renderer.capabilities.getMaxAnisotropy();
const door = kept && buildDoorway({ width: kept.width, height: kept.height, z: DOOR_Z, glow: kept.glow, name: kept.way.name, anisotropy });
if (door) {
  scene.add(door.group);
  const views = hallwayViews(kept.way, BREADBOARD_ID);
  if (views) void door.loadView(views);
}
const jamb = (kept?.width ?? DOOR.width) / 2 - 0.25;

// Where a head can go in VR (move.ts): the floor, round the table, with a hand's breadth to spare.
const ROOM: Rect = { x0: -6.6, x1: 6.6, z0: -6.6, z1: 6.6 };
const OBSTACLES: Rect[] = [{ x0: -0.56 - 0.15, x1: 0.56 + 0.15, z0: TABLE_Z - 0.5 - 0.15, z1: TABLE_Z + 0.5 + 0.15 }];

// The room's own panel, left of the table, as the Hallway has one on its wall: how to move in VR,
// kept as the Hallway keeps it (common's nav.js), so the choice is the same on both sides of its doors.
const store = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();
const nav: Nav = loadNav(store);
// The shared session (together.ts): an address with ?room= (an invitation, or the Hallway's door
// in a session) joins it, below; the room's panel and the page's bar start and leave one.
const together = new Together({ scene, camera, renderer, hands: () => rays.map((r) => ({ controller: r.ctrl, source: r.source })) });
function setNav(next: Partial<Nav>) {
  Object.assign(nav, next);
  saveNav(nav, store);
  for (const ray of rays) ray.aim.aiming = false;
  showRoom();
}
const roomPanel = new ControlPanel(
  [
    { label: () => `Move: ${nav.move === 'smooth' ? 'Smooth' : 'Teleport'}`, run: () => setNav({ move: nav.move === 'smooth' ? 'teleport' : 'smooth' }) },
    { label: () => `Turn: ${nav.turn === 'snap' ? 'Snap' : 'Smooth'}`, run: () => setNav({ turn: nav.turn === 'snap' ? 'smooth' : 'snap' }) },
    { label: () => (together.active ? 'Leave session' : 'Start session'), run: () => toggleSession() },
  ],
  'Moving about · Together',
);
roomPanel.group.position.set(-1.05, 1.2, -0.45);
roomPanel.group.lookAt(0, 1.45, 0.4);
scene.add(roomPanel.group);
/** The panel's status: in a session how it goes and its invitation, else what the sticks do. */
function showRoom() {
  roomPanel.refresh();
  roomPanel.setStatus(
    together.active
      ? [`Together: ${together.status()}`, together.inviteLink.replace(/^https?:\/\//, '')]
      : [nav.move === 'smooth' ? 'Left stick: walk the way you face' : 'Left stick forward: aim; let go: jump', nav.turn === 'snap' ? 'Right stick: turn 30° a push' : 'Right stick: turn while held'],
  );
}
function toggleSession() {
  if (together.active) {
    together.stop();
    toast('You left the shared session');
  } else {
    together.start();
    toast(inVR() ? 'Shared session started: its link is on the room’s panel' : 'Shared session started: Copy invite link brings others in');
  }
}
// On a screen, the session on the page's bar: start it, and in one, how it goes, the invitation to
// copy, and leaving it.
const bar = document.querySelector('.vr-bar');
const sessionBox = Object.assign(document.createElement('span'), { className: 'vr-together' });
const sessionState = Object.assign(document.createElement('span'), { className: 'vr-together-status' });
const sessionButton = Object.assign(document.createElement('button'), { type: 'button' });
const copyButton = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copy invite link' });
sessionButton.addEventListener('click', toggleSession);
copyButton.addEventListener('click', () => {
  navigator.clipboard.writeText(together.inviteLink).then(() => toast('Invite link copied'), () => toast(`Copy this link: ${together.inviteLink}`));
});
sessionBox.append(sessionState, copyButton, sessionButton);
bar?.querySelector('.vr-build')?.before(sessionBox);
function showSession() {
  showRoom();
  sessionButton.textContent = together.active ? 'Leave' : 'Start shared session';
  sessionButton.title = together.active ? 'Leave the shared session' : 'Share this room: others who open its link see you here, and in the Hallway';
  copyButton.hidden = !together.active;
  sessionState.textContent = together.active ? `Together: ${together.status()}` : '';
  if (wayLink && way) wayLink.href = leaveUrl(way, together.room);
}
together.onChange = showSession;
together.onNotice = (text) => toast(text);
showSession();
/** Where a visitor coming through the door now stands and faces (yaw + to the left), or null. */
let arrival = found ? { x: Math.min(jamb, Math.max(-jamb, visit.dx ?? 0)), yaw: visit.yaw ?? 0, pitch: visit.pitch ?? 0 } : null;

// ---- what is on the table: the exhibit, its model, and its control panel ----
const boardTex = boardTexture(anisotropy); // shared by every model
let exhibit: Exhibit | null = null;
let choice: ExhibitChoice = { kind: 'computer' };
let model: ComputerModel | null = null;
let panel: ControlPanel | null = null;
let home = UNIT; // the model's scale on the table
let carry: Carry | null = null;
let targets: THREE.Object3D[] = [];
let notice = '';
let toastText = '';
let toastTimer = 0;
let dirty = true;
/** A message on the status line for a few seconds. */
function toast(text: string) {
  toastText = text;
  statusDue = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastText = '';
    statusDue = true;
  }, 4000);
}

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
      // In a headset, the way out without the system menu. A click on it counts as the user's
      // gesture that a browser wants before it starts VR, so on a screen it enters VR.
      { label: () => (inVR() ? 'Exit VR' : 'Enter VR'), run: () => (inVR() ? exitVR() : vrButton.click()), disabled: () => !inVR() && !vrSupported },
    ],
    next.title,
    buildLabel(),
    way ? { label: () => way.label, run: go } : undefined,
  );
  panel.group.position.set(0, TABLE_TOP + 0.3, TABLE_Z - 0.62);
  panel.group.rotation.x = -0.12;
  scene.add(panel.group);
  targets = [...panel.targets, ...roomPanel.targets, ...model.hitTargets, ...(door ? [door.portal] : [])];
  hover(null);

  history.replaceState(null, '', location.pathname + location.search + exhibitHash(c));
  document.title = c.kind === 'computer' ? TITLE : `${next.title} · ${TITLE}`;
  renderer.domElement.setAttribute('aria-label', c.kind === 'computer' ? "Ben Eater's 8-bit computer on a table, in 3D, with its control panel behind it" : `${next.title}, a breadboard circuit on a table, in 3D, with its control panel behind it`);
  document.body.dataset.ready = JSON.stringify({ exhibit: c.kind === 'example' ? `example/${c.id}` : c.kind, ...model.counts });
  dirty = true;
}

function sync() {
  if (!exhibit || !model || !panel) return;
  exhibit.show(model);
  statusDue = true;
  panel.refresh();
  showTip();
}

// The status changes every frame while the clock runs fast; its text is redrawn at most ten times a
// second (on the panel each redraw is a texture to upload, and nobody reads a count that fast).
let statusDue = false;
let statusAt = -Infinity;
function syncStatus(now: number) {
  if (!statusDue || now - statusAt < 100 || !exhibit || !panel) return;
  statusDue = false;
  statusAt = now;
  const lines = exhibit.status();
  panel.setStatus(lines);
  statusEl.textContent = [toastText || notice, ...lines].filter(Boolean).join(' · ');
}

// ---- pointing: mouse / finger on screen, controller rays in VR ----
const raycaster = new THREE.Raycaster();
const pick = (): THREE.Intersection | undefined => raycaster.intersectObjects(targets, false)[0];
const hitOf = (o: THREE.Object3D | null | undefined): ControlHit | null => (o && model?.hitTargets.includes(o as THREE.Mesh) ? (o.userData as ControlHit) : null);
/** The panel (the exhibit's, or the room's) whose button `o` is, or null. */
const panelOf = (o: THREE.Object3D | null | undefined) => (o ? ([panel, roomPanel].find((p) => p?.targets.includes(o as THREE.Mesh)) ?? null) : null);
const isPanel = (o: THREE.Object3D | null | undefined) => !!panelOf(o);
const isDoor = (o: THREE.Object3D | null | undefined) => !!door && o === door.portal;
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
  const ex = exhibit;
  tooltip.show(ex.describe(hit, inVR()), at, hovered, () => ex.labels?.(hit, inVR()) ?? []);
}
function hover(o: THREE.Object3D | null) {
  hovered = o;
  panel?.setHover(o);
  roomPanel.setHover(o);
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
    if (isPanel(o)) panelOf(o)!.press(o!);
    else if (isDoor(o)) go();
  }
  press = null;
  controls.enabled = true;
};
renderer.domElement.addEventListener('pointerup', (e) => finish(e, false));
renderer.domElement.addEventListener('pointercancel', (e) => finish(e, true));

// Double-click (or double-tap) the boards to fly three times closer to that spot: on a screen the
// switches are small from the home view. (Coming through the door, the view flies home the same way.)
let fly: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number; ms: number; wait: number } | null = null;
renderer.domElement.addEventListener('dblclick', (e) => {
  if (!model) return;
  fromPointer(e);
  const spot = raycaster.intersectObject(model.root, true)[0]?.point;
  if (!spot) return;
  const dist = Math.max(controls.minDistance, camera.position.distanceTo(controls.target) / 3);
  const eye = spot.clone().add(camera.position.clone().sub(controls.target).setLength(dist));
  fly = { from: [camera.position.clone(), controls.target.clone()], to: [eye, spot], t: 0, ms: 350, wait: 0 };
});
function flyOn(ms: number) {
  if (!fly) return;
  if (fly.wait > 0) return void (fly.wait -= ms);
  fly.t = Math.min(1, fly.t + ms / fly.ms);
  const k = 1 - (1 - fly.t) ** 3; // ease out
  camera.position.lerpVectors(fly.from[0], fly.to[0], k);
  controls.target.lerpVectors(fly.from[1], fly.to[1], k);
  if (fly.t === 1) fly = null;
}
// Through the door on a screen: the view starts where the doorway showed the room from, looking as
// the visitor did, then flies to the table.
if (arrival) {
  const a = arrival;
  const eye = new THREE.Vector3(a.x, 1.6, ARRIVE_Z);
  const ahead = new THREE.Vector3(-Math.sin(a.yaw) * Math.cos(a.pitch), Math.sin(a.pitch), -Math.cos(a.yaw) * Math.cos(a.pitch));
  const target = eye.clone().addScaledVector(ahead, 2);
  camera.position.copy(eye);
  controls.target.copy(target);
  controls.update();
  fly = { from: [eye, target], to: homePose(), t: 0, ms: 1600, wait: 700 };
}

// VR controllers: the trigger points and presses, the grip picks the boards up (both grips: pull
// apart to make them bigger, from half to 8 times their size on the table).
const holding: THREE.XRTargetRaySpace[] = [];
/** A control held with the trigger: what it does, the hit box (it stays the hovered one), and the wrist's twist for pots. */
type Held = { hold: Hold; object: THREE.Object3D; twist: Twist };
/**
 * A controller: its ray, the control its trigger holds, its input source (handedness, sticks), and
 * the teleport its left stick aims (move 'teleport') with where on the floor it lands, ringed.
 */
type Ray = { ctrl: THREE.XRTargetRaySpace; line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; hold: Held | null; source: XRInputSource | null; aim: AimStick; target: THREE.Vector3 | null; ring: THREE.Mesh };
const rays: Ray[] = [];
const RAY_COLOR = '#8ab8ff', AIM_COLOR = '#ffd27a';
const ringGeometry = new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2);
const turnStick = new TurnStick();
for (const i of [0, 1]) {
  const ctrl = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: RAY_COLOR }));
  line.scale.z = 3;
  ctrl.add(line);
  const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: AIM_COLOR, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.visible = false;
  scene.add(ring);
  const ray: Ray = { ctrl, line, hold: null, source: null, aim: new AimStick(), target: null, ring };
  ctrl.addEventListener('connected', (e) => (ray.source = e.data));
  ctrl.addEventListener('disconnected', () => (ray.source = null));
  ctrl.addEventListener('selectstart', () => {
    raycaster.setFromXRController(ctrl);
    const picked = pick();
    const o = picked?.object;
    const hit = hitOf(o);
    const hold = hit && begin(hit);
    debugLog('trigger', { hand: i, on: hit ? `${hit.part}${hit.bit === undefined ? '' : `#${hit.bit}`}` : isPanel(o) ? `panel: ${panelOf(o)!.labelOf(o!)}` : isDoor(o) ? 'doorway' : 'nothing', m: picked && +picked.distance.toFixed(3) });
    if (hold) ray.hold = { hold, object: o!, twist: new Twist(ctrl.quaternion) };
    else if (isPanel(o)) panelOf(o)!.press(o!);
    else if (isDoor(o)) go();
    else {
      // at the floor (not just past a switch by the table's edge): a jump there
      const at = floorTarget(ctrl);
      camera.getWorldPosition(head);
      if (at && Math.hypot(at.x - head.x, at.z - head.z) > 0.6) teleport(at.x, at.z);
    }
  });
  ctrl.addEventListener('selectend', () => {
    ray.hold?.hold.end(true);
    ray.hold = null;
  });
  ctrl.addEventListener('squeezestart', () => {
    if (!holding.includes(ctrl)) holding.push(ctrl);
    carry?.grip(holding);
    debugLog('grip', { hand: i, hands: holding.length });
  });
  ctrl.addEventListener('squeezeend', () => {
    const at = holding.indexOf(ctrl);
    if (at >= 0) holding.splice(at, 1);
    carry?.grip(holding);
    debugLog('grip', { hand: i, hands: holding.length, scale: model && +(model.root.scale.x / home).toFixed(2) });
  });
  rig.add(ctrl); // with the visitor, wherever the rig stands
  rays.push(ray);
}
function pointControllers() {
  let over: THREE.Object3D | null = null;
  for (const ray of rays) {
    const { ctrl, line, hold } = ray;
    if (hold?.hold.turn) {
      // a pot turns with the wrist
      hold.hold.turn(hold.twist.update(ctrl.quaternion));
      debugTwist(ctrl, hold);
    }
    if (ray.aim.aiming) {
      // aiming a jump: the ray to the floor, a ring where it lands (none where one can't stand)
      ray.target = floorTarget(ctrl);
      line.scale.z = ray.target ? ray.target.distanceTo(raycaster.ray.origin) : 3;
      line.material.color.set(ray.target ? AIM_COLOR : RAY_COLOR);
      ray.ring.visible = !!ray.target;
      if (ray.target) ray.ring.position.set(ray.target.x, 0.005, ray.target.z);
      continue;
    }
    ray.ring.visible = false;
    line.material.color.set(RAY_COLOR);
    raycaster.setFromXRController(ctrl);
    const hit = pick();
    line.scale.z = hit ? hit.distance : 3;
    over ??= hold?.object ?? hit?.object ?? null; // a held control keeps its label, wherever the ray swings
  }
  if (over !== hovered) hover(over);
  else showTip(); // follow the boards while they are carried
}

// ---- moving about in VR (move.ts; how, from nav) ----
const solids = () => ([table, model?.root, panel?.group, roomPanel.group, door?.group] as (THREE.Object3D | undefined)[]).filter((o): o is THREE.Object3D => !!o);
/** Where a controller's ray meets the floor, if a head can stand there and nothing is in the way; else null. */
function floorTarget(ctrl: THREE.Object3D): THREE.Vector3 | null {
  raycaster.setFromXRController(ctrl as THREE.XRTargetRaySpace);
  const r = raycaster.ray;
  if (r.direction.y > -0.02) return null;
  const t = -r.origin.y / r.direction.y;
  if (t > 12) return null;
  const blocked = raycaster.intersectObjects(solids(), true)[0];
  if (blocked && blocked.distance < t) return null;
  const at = r.at(t, new THREE.Vector3());
  return standable(at.x, at.z, ROOM, OBSTACLES) ? at : null;
}
/** Turns the rig by `angle` (+ to the left) about the head, so the visitor turns in place. */
function turnAboutHead(angle: number) {
  camera.getWorldPosition(head);
  [rig.position.x, rig.position.z] = turnedAbout(rig.position.x, rig.position.z, head.x, head.z, angle);
  rig.rotation.y += angle;
}
/** Moves the rig so the head goes to (x, z): as far as the room lets a walk go, or straight there. */
function moveHead(x: number, z: number, walk = true) {
  camera.getWorldPosition(head);
  const [cx, cz] = walk ? clampWalk(head.x, head.z, x, z, ROOM, OBSTACLES) : [x, z];
  rig.position.x += cx - head.x;
  rig.position.z += cz - head.z;
}
/** A jump: a moment of black hides it. */
function teleport(x: number, z: number) {
  fade.to(1, 0.08, () => {
    moveHead(x, z, false);
    fade.to(0, 0.2);
  });
}
/** The sticks, every frame in VR: the right one turns, the left one walks or aims a jump. */
function moveWithSticks(dt: number) {
  for (const ray of rays) {
    const pad = ray.source?.gamepad;
    if (!pad || pad.axes.length < 2) continue;
    const ax = pad.axes.length >= 4 ? pad.axes[2] : pad.axes[0];
    const ay = pad.axes.length >= 4 ? pad.axes[3] : pad.axes[1];
    if (ray.source!.handedness === 'right') {
      const angle = turnStick.turn(ax, dt, nav.turn);
      if (angle) turnAboutHead(angle);
    } else if (nav.move === 'teleport') {
      if (ray.aim.update(ay) === 'jump' && ray.target) teleport(ray.target.x, ray.target.z);
    } else {
      camera.getWorldDirection(facing);
      const [dx, dz] = walkDelta(ax, ay, facing.x, facing.z, XR_WALK * dt);
      camera.getWorldPosition(head);
      if (dx || dz) moveHead(head.x + dx, head.z + dz);
    }
  }
}
// Entering VR, the headset is lined up a moment later (once it has a pose) with where the visitor
// enters: at the door, turned as they went through, when they came through it just now; else at
// the start, facing the table.
let entry = { x: 0, z: 0, yaw: 0 };
let recenter = 0;
function lineUp() {
  camera.getWorldDirection(facing);
  turnAboutHead(wrapAngle(entry.yaw - headYaw(facing.x, facing.z)));
  moveHead(entry.x, entry.z, false);
}

renderer.xr.addEventListener('sessionstart', () => {
  fromButton = clicked;
  clicked = false;
  dirty = true;
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  entry = arrival ? { x: arrival.x, z: ARRIVE_Z, yaw: arrival.yaw } : { x: 0, z: 0, yaw: 0 };
  arrival = null;
  recenter = 2;
  debugLog('session', { vr: true, from: fromButton ? 'button' : 'browser' });
});

// With ?debug in the URL, what the controllers do goes to the console as "[vr] …" lines: to see
// it from a headset, connect over adb (chrome://inspect, or the DevTools protocol).
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugLog = (what: string, data: object) => DEBUG && console.info(`[vr] ${what} ${JSON.stringify(data)}`);
let debugAt = 0;
function debugTwist(ctrl: THREE.Object3D, held: Held) {
  if (!DEBUG || performance.now() - debugAt < 100) return;
  debugAt = performance.now();
  const e = new THREE.Euler().setFromQuaternion(ctrl.quaternion, 'YXZ');
  const deg = (r: number) => Math.round(THREE.MathUtils.radToDeg(r));
  debugLog('twist', { turned: +held.twist.turned.toFixed(3), pitch: deg(e.x), yaw: deg(e.y), roll: deg(e.z), shows: exhibit?.describe(held.object.userData as ControlHit, true) });
}
// Once a second in VR: how evenly the frames came (slow: more than 1.5 frames apart), our CPU
// time per frame (the simulation, pointing, handing the frame to WebGL), and how many times the
// label and the panel's status were redrawn (each a texture upload).
const perf = { at: 0, frames: 0, slow: 0, worst: 0, cpu: 0, cpuMax: 0, labels: 0, statuses: 0 };
function debugPerf(start: number, gap: number) {
  if (!DEBUG || !inVR()) return void (perf.at = 0);
  const now = performance.now();
  if (!perf.at) return void Object.assign(perf, { at: now, frames: 0, slow: 0, worst: 0, cpu: 0, cpuMax: 0, labels: tooltip.draws, statuses: panel?.statusDraws ?? 0 });
  const frameMs = 1000 / ((renderer.xr.getSession() as (XRSession & { frameRate?: number }) | null)?.frameRate ?? 72);
  perf.frames++;
  if (gap > 1.5 * frameMs) perf.slow++;
  perf.worst = Math.max(perf.worst, gap);
  perf.cpu += now - start;
  perf.cpuMax = Math.max(perf.cpuMax, now - start);
  if (now - perf.at < 1000) return;
  debugLog('perf', {
    fps: Math.round((perf.frames * 1000) / (now - perf.at)),
    slow: perf.slow,
    worstMs: +perf.worst.toFixed(1),
    cpuMs: +(perf.cpu / perf.frames).toFixed(1),
    cpuMaxMs: +perf.cpuMax.toFixed(1),
    labelDraws: tooltip.draws - perf.labels,
    statusDraws: Math.max(0, (panel?.statusDraws ?? 0) - perf.statuses),
    twisting: rays.some((r) => r.hold),
  });
  perf.at = 0; // the next second
}
renderer.xr.addEventListener('sessionend', () => {
  debugLog('session', { vr: false });
  holding.length = 0;
  carry?.grip(holding);
  for (const ray of rays) {
    ray.hold = null;
    ray.aim.aiming = false;
    ray.ring.visible = false;
  }
  if (!leaving) fade.set(0);
  rig.position.set(0, 0, 0); // the screen view orbits from the origin
  rig.rotation.set(0, 0, 0);
  putBack(); // the screen view looks at the table
  homeView();
  setTimeout(fitScreen); // once three.js has given the canvas back
  dirty = true;
});

// ---- loop ----
function fitScreen() {
  if (renderer.xr.isPresenting) return; // the headset sets the size; done again when VR ends
  fitLens();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fitScreen);
addEventListener('hashchange', () => void open(parseExhibitHash(location.hash)));
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  if (exhibit?.frame(now - last)) dirty = true;
  if (inVR()) {
    if (recenter > 0 && --recenter === 0) lineUp();
    else if (!leaving) moveWithSticks(dt);
  }
  if (door) {
    camera.getWorldPosition(head);
    door.update(dt, head, isDoor(hovered));
    if (inVR() && door.crossed(head)) go(); // walked or stepped back through it (on a screen the orbit may swing through it)
  }
  fade.update(dt);
  together.update(now);
  if (inVR()) {
    carry?.follow(holding);
    pointControllers();
  } else {
    flyOn(now - last);
    controls.update();
  }
  const gap = now - last;
  last = now;
  if (dirty) {
    dirty = false;
    sync();
  }
  syncStatus(now);
  renderer.render(scene, camera);
  debugPerf(now, gap);
});
void open(parseExhibitHash(location.hash));
// An invitation, or the Hallway's door in a shared session, names a room: join it.
const invited = roomFromUrl(location.href);
if (invited) together.start(invited);

// Walked in from another page's immersive session (a door of the Hallway): Quest Browser can grant
// this page a session without a click (sessiongranted; vr.html notes one that came before this
// script ran). It is taken at once, as Enter VR would, so the visitor stays in VR: a grant lasts
// about 5 s from the page's start (the Hallway's README, "Linking back").
const SESSION: XRSessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'layers'] }; // what three's VRButton asks for
const early = window as { breadboardXrGranted?: boolean };
function takeGranted() {
  early.breadboardXrGranted = false;
  if (inVR() || !navigator.xr) return;
  clicked = true; // this page's own session, so Exit VR ends it (exitVR)
  navigator.xr.requestSession('immersive-vr', SESSION).then(
    (session) => renderer.xr.setSession(session),
    (e) => {
      clicked = false;
      debugLog('granted', { error: String(e) });
    },
  );
}
if (early.breadboardXrGranted) takeGranted();
navigator.xr?.addEventListener('sessiongranted', takeGranted);

// For the browser check (scripts/check-browser.mjs) and the console: what is on the table, the
// computer's machine when that is it, and where on the screen a control is (the middle of its hit
// box's top; DIP switches by bit) or a button of the panel.
function onScreen(o: THREE.Object3D, point: (box: THREE.Box3) => THREE.Vector3) {
  scene.updateMatrixWorld(); // also before the first frame
  camera.updateMatrixWorld();
  const p = point(new THREE.Box3().setFromObject(o)).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
}
Object.assign(window, {
  breadboardVR: {
    get exhibit() {
      return exhibit;
    },
    get machine() {
      return exhibit && 'machine' in exhibit ? exhibit.machine : undefined;
    },
    /** Where "← Hallway" leads (hallway.ts), or null; the door's link, read; the doorway back (door.ts), or null. */
    way,
    visit,
    door,
    /** In VR: where the visitor stands and which way the room is turned for them. */
    rig,
    /** How the visitor moves in VR (common's nav.js), as the room's panel shows it. */
    nav,
    /** The shared session (together.ts). */
    together,
    camera,
    /** IWER's emulated headset (?xr=emulate on the dev server), else null. */
    xrDevice,
    /** Where on the screen the doorway's opening is (its middle), or null without one. */
    doorPoint: () => (door ? onScreen(door.portal, (b) => b.getCenter(new THREE.Vector3())) : null),
    /** Looks from `eye` at `target` on the screen (metres, [x, y, z]), as dragging the view would. */
    look(eye: [number, number, number], target: [number, number, number]) {
      fly = null;
      camera.position.set(...eye);
      controls.target.set(...target);
      controls.update();
    },
    /** The panel's buttons, by label. */
    panelLabels: () => [panel, roomPanel].flatMap((p) => (p ? p.targets.map((t) => p.labelOf(t)) : [])),
    screenPoint(part: string, bit?: number) {
      const o = model?.hitTargets.find((t) => t.userData.part === part && (bit === undefined || t.userData.bit === bit));
      return o ? onScreen(o, (b) => b.getCenter(new THREE.Vector3()).setY(b.max.y)) : null;
    },
    /** Where on the screen the panel's button with this label is (its middle). */
    panelPoint(label: string) {
      const o = [panel, roomPanel].flatMap((p) => (p ? p.targets.filter((t) => p.labelOf(t) === label) : []))[0];
      return o ? onScreen(o, (b) => b.getCenter(new THREE.Vector3())) : null;
    },
    /**
     * The room as the Hallway's doorway shows it, as a JPEG data URL, `width` x `width` / 2
     * (scripts/make-preview.mjs writes it to public/hallway-preview.jpg). The Hallway hangs a door's
     * picture 2.4 m behind the opening, 3 m tall and twice as wide, its horizon at 0.56 of its height
     * and at eye height, 1.6 m (its hall.js, PICTURE): so this is the view from 1.6 m up, looking
     * straight in, through that frame. `back`: how far behind the start (the origin) it is taken;
     * by default where a visitor coming through the door arrives, in front of the doorway back.
     */
    preview(width = 2048, back = ARRIVE_Z) {
      const P = { depth: 2.4, height: 3, eye: 1.6, horizon: 0.56 };
      const cam = new THREE.PerspectiveCamera();
      cam.position.set(0, P.eye, back);
      cam.updateMatrixWorld();
      const k = 0.05 / P.depth; // the frame, moved to the near plane
      cam.projectionMatrix.makePerspective(-P.height * k, P.height * k, (1 - P.horizon) * P.height * k, -P.horizon * P.height * k, 0.05, 50);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      hover(null);
      sync();
      statusAt = -Infinity; // the panel's status now, not at its next redraw
      syncStatus(performance.now());
      renderer.setPixelRatio(1);
      renderer.setSize(width, width / 2, false);
      renderer.render(scene, cam);
      const jpeg = renderer.domElement.toDataURL('image/jpeg', 0.85); // read before the page composites it
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      fitScreen();
      return jpeg;
    },
  },
});

// Built site only: offline use, as on the main page (scripts/sw-dist.mjs).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
