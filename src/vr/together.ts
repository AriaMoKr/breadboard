import * as THREE from 'three';
import { loadIdentity } from 'layersharedsession/identity.js';
import { newRoom } from 'layersharedsession/room.js';
import { INTERP_DELAY_MS, PART, PART_LENGTH, emptyPose, hasPart, latestPose, samplePose, setPart } from 'layersharedsession/pose.js';
import type { Peer, Session } from 'layersharedsession/session.js';
import { BREADBOARD_ID as PAGE_ID } from './hallway';

/**
 * The shared session of the Hallway and the places behind its doors (the Hallway's README,
 * "Together"; AriaMoKr/layersharedsession, peer to peer over WebRTC with Trystero, finding the
 * others through public Nostr relays). Its room is in the address (?room=), so the address is the
 * invitation; the Hallway's door brings it here and the way back carries it on, so the visitor
 * stays in it. This page is `breadboard` in the session. The others in it who are here are drawn: a
 * head with a visor on its front, a hand per tracked controller, a ring on the floor and their
 * name. As outside's together.js, in TypeScript.
 *
 * The session module (and Trystero under it) is only imported when a session starts. In a build
 * it is part of vr.html's one JS file, but none of it runs, and nothing is sent, without one.
 */

/** The app id every site in the session uses (and layersharedsession's test page, which can watch). */
export const APP_ID = 'ariamokr-layersharedsession-test';
/** After this long without a relay, the status says so. */
const RELAY_PATIENCE_MS = 10_000;

/** What the session's status says, from how it stands (pure, for the panel, the page and the tests). */
export function sessionStatus(s: { online: boolean; joined: boolean; relays: number; slow: boolean; here: number; away: number }): string {
  if (!s.online) return 'Offline';
  if (!s.joined || !s.relays) return s.slow ? "Can't reach the relays" : 'Connecting…';
  if (!s.here && !s.away) return 'Waiting for others';
  const parts = [];
  if (s.here) parts.push(`${s.here} here`);
  if (s.away) parts.push(`${s.away} elsewhere`);
  return parts.join(', ');
}

const storage = (name: 'sessionStorage' | 'localStorage'): Storage | null => {
  try {
    return window[name];
  } catch {
    return null;
  }
};

/** A box whose faces are shaded as if lit from above (an unlit material, as the Hallway's). */
function shadedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const shade = [0.78, 0.78, 1, 0.55, 0.88, 0.88]; // +x, -x, +y, -y, +z, -z, 4 vertices each
  const colors: number[] = [];
  for (const s of shade) for (let i = 0; i < 4; i++) colors.push(s, s, s);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

const headGeometry = shadedBox(0.2, 0.24, 0.22);
const visorGeometry = shadedBox(0.17, 0.06, 0.02).translate(0, 0.02, -0.115);
const handGeometry = shadedBox(0.06, 0.04, 0.12);
const ringGeometry = new THREE.RingGeometry(0.2, 0.25, 32).rotateX(-Math.PI / 2);
const visorMaterial = new THREE.MeshBasicMaterial({ color: '#15110c', vertexColors: true });

function labelSprite(text: string, color: string): THREE.Sprite {
  const size = 44;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const font = `600 ${size}px system-ui, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + size;
  const h = Math.ceil(size * 1.6);
  canvas.width = w;
  canvas.height = h;
  g.font = font; // resizing the canvas resets the context
  g.fillStyle = `${color}d9`;
  g.beginPath();
  g.roundRect(0, 0, w, h, h / 2);
  g.fill();
  g.fillStyle = '#1a1208';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set((0.1 * w) / h, 0.1, 1);
  return sprite;
}

interface Avatar {
  peerId: string;
  group: THREE.Group;
  head: THREE.Mesh;
  hands: THREE.Mesh[];
  ring: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
  label: THREE.Sprite | null;
  name: string | null;
  color: string | null;
  page: string | null;
}

/** A controller and its input source (for its handedness), as main.ts has them. */
export interface Hand {
  controller: THREE.Object3D;
  source: XRInputSource | null;
}

export class Together {
  /** The room joined, or kept while paused (going through a door); null out of any. */
  room: string | null = null;
  private paused = false;
  private session: Session | null = null;
  private joining = 0; // which join is current: a slow import must not join a room left since
  private startedAt = 0;
  private slowTimer = 0;
  private readonly group = new THREE.Group();
  private readonly avatars: Avatar[] = []; // index loops, no allocation per frame
  private readonly pose = emptyPose();
  private readonly sample = emptyPose();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  onChange = () => {};
  onNotice = (_text: string) => {};

  constructor(private o: { scene: THREE.Scene; camera: THREE.Camera; renderer: THREE.WebGLRenderer; hands: () => Hand[] }) {
    this.group.name = 'visitors';
    o.scene.add(this.group);
    addEventListener('online', () => this.onChange());
    addEventListener('offline', () => this.onChange());
  }

  /** In a session (joined, or joining). */
  get active(): boolean {
    return !!this.room && !this.paused;
  }

  /** The address that brings others into the session: this page with only ?room=. */
  get inviteLink(): string {
    if (!this.room) return '';
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', this.room);
    return url.href;
  }

  /** How many others are here, and elsewhere in the session. */
  company(): { here: number; away: number } {
    let here = 0, away = 0;
    for (const p of this.session?.peers.values() ?? []) {
      if (p.page === PAGE_ID) here++;
      else if (p.page) away++;
    }
    return { here, away };
  }

  /** How the session is going, in words (empty out of one). */
  status(): string {
    if (!this.active) return '';
    return sessionStatus({ online: navigator.onLine !== false, joined: !!this.session, relays: this.session?.relays.open ?? 0, slow: performance.now() - this.startedAt > RELAY_PATIENCE_MS, ...this.company() });
  }

  /** Starts a session in `room` (a new one by default), and puts the room in the address. */
  start(room = newRoom()) {
    this.leaveSession();
    this.room = room;
    this.paused = false;
    this.setAddress(room);
    void this.join();
    this.onChange();
  }

  /** Leaves the session and takes the room out of the address. */
  stop() {
    this.leaveSession();
    this.room = null;
    this.paused = false;
    this.setAddress(null);
    this.onChange();
  }

  /** Leaves for now, keeping the room: going through the door (its link carries the room on). */
  pause() {
    if (!this.active) return;
    this.leaveSession();
    this.paused = true;
    this.onChange();
  }

  /** Back after a pause (the door's navigation didn't happen, or Back restored this page). */
  resume() {
    if (!this.paused || !this.room) return;
    this.paused = false;
    void this.join();
    this.onChange();
  }

  private async join() {
    const ticket = ++this.joining;
    this.startedAt = performance.now();
    clearTimeout(this.slowTimer);
    this.slowTimer = window.setTimeout(() => this.onChange(), RELAY_PATIENCE_MS + 100); // "can't reach the relays", if still none
    const { joinSession } = await import('layersharedsession/session.js');
    if (ticket !== this.joining || !this.active) return;
    const identity = loadIdentity(storage('sessionStorage'), storage('localStorage'));
    const s = joinSession({ appId: APP_ID, room: this.room!, page: PAGE_ID, identity, storage: storage('sessionStorage') });
    this.session = s;
    s.on('join', (p) => {
      this.show(p);
      this.onNotice(p.page === PAGE_ID ? `${p.name} is here` : `${p.name} is in the session, in ${p.page}`);
      this.onChange();
    });
    s.on('update', (p) => {
      const a = this.show(p);
      if (a.page !== p.page && p.page === PAGE_ID) this.onNotice(`${p.name} came in to the computer`);
      a.page = p.page;
      this.onChange();
    });
    s.on('leave', (p) => {
      this.drop(p.peerId);
      this.onNotice(`${p.name || 'Someone'} left the session`);
      this.onChange();
    });
    s.on('relays', () => this.onChange());
    this.onChange();
  }

  private leaveSession() {
    this.joining++;
    clearTimeout(this.slowTimer);
    if (!this.session) return;
    void this.session.leave();
    this.session = null;
    while (this.avatars.length) this.drop(this.avatars[0].peerId);
  }

  private setAddress(room: string | null) {
    const url = new URL(location.href);
    if (room) url.searchParams.set('room', room);
    else url.searchParams.delete('room');
    history.replaceState(history.state, '', url.href);
  }

  /** The avatar for a visitor, made or relabelled. */
  private show(peer: Peer): Avatar {
    let a = this.avatars.find((x) => x.peerId === peer.peerId);
    if (!a) {
      const material = new THREE.MeshBasicMaterial({ color: peer.color, vertexColors: true });
      const ringMaterial = new THREE.MeshBasicMaterial({ color: peer.color, transparent: true, opacity: 0.55, depthWrite: false });
      const head = new THREE.Mesh(headGeometry, material);
      head.add(new THREE.Mesh(visorGeometry, visorMaterial));
      const hands = [new THREE.Mesh(handGeometry, material), new THREE.Mesh(handGeometry, material)];
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      const group = new THREE.Group();
      group.name = `visitor ${peer.peerId}`;
      group.visible = false;
      group.add(head, hands[0], hands[1], ring);
      this.group.add(group);
      a = { peerId: peer.peerId, group, head, hands, ring, material, ringMaterial, label: null, name: null, color: null, page: peer.page };
      this.avatars.push(a);
    }
    const name = peer.name || '…';
    if (a.name !== name || a.color !== peer.color) {
      if (a.label) {
        a.group.remove(a.label);
        a.label.material.map?.dispose();
        a.label.material.dispose();
      }
      a.label = labelSprite(name, peer.color);
      a.group.add(a.label);
      a.material.color.set(peer.color);
      a.ringMaterial.color.set(peer.color);
      a.name = name;
      a.color = peer.color;
    }
    return a;
  }

  private drop(peerId: string) {
    const i = this.avatars.findIndex((x) => x.peerId === peerId);
    if (i < 0) return;
    const a = this.avatars[i];
    this.avatars.splice(i, 1);
    this.group.remove(a.group);
    a.material.dispose();
    a.ringMaterial.dispose();
    if (a.label) {
      a.label.material.map?.dispose();
      a.label.material.dispose();
    }
  }

  /** Per frame: sends where the head and hands are (at most 15 times a second), and places the others. */
  update(now: number) {
    const s = this.session;
    if (!s) return;
    const { camera, renderer } = this.o;
    camera.getWorldPosition(this.pos);
    camera.getWorldQuaternion(this.quat);
    setPart(this.pose, PART.head, this.pos, this.quat);
    setPart(this.pose, PART.left, null);
    setPart(this.pose, PART.right, null);
    if (renderer.xr.isPresenting) {
      const hands = this.o.hands();
      for (let i = 0; i < hands.length; i++) {
        const side = hands[i].source?.handedness;
        if (side !== 'left' && side !== 'right') continue;
        hands[i].controller.getWorldPosition(this.pos);
        hands[i].controller.getWorldQuaternion(this.quat);
        setPart(this.pose, side === 'left' ? PART.left : PART.right, this.pos, this.quat);
      }
    }
    s.setPose(this.pose);
    s.tick();

    for (let i = 0; i < this.avatars.length; i++) {
      const a = this.avatars[i];
      const peer = s.peers.get(a.peerId);
      const p = peer && peer.page === PAGE_ID && latestPose(peer.buffer) ? samplePose(peer.buffer, now - INTERP_DELAY_MS, this.sample) : null;
      if (!p || !hasPart(p, PART.head)) {
        a.group.visible = false;
        continue;
      }
      a.group.visible = true;
      a.head.position.fromArray(p, 0);
      a.head.quaternion.fromArray(p, 3);
      for (let h = 0; h < 2; h++) {
        const part = h === 0 ? PART.left : PART.right;
        const hand = a.hands[h];
        hand.visible = hasPart(p, part);
        if (!hand.visible) continue;
        hand.position.fromArray(p, part * PART_LENGTH);
        hand.quaternion.fromArray(p, part * PART_LENGTH + 3);
      }
      a.ring.position.set(p[0], 0.01, p[2]);
      a.label!.position.set(p[0], p[1] + 0.25, p[2]);
    }
  }
}
