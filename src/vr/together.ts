import * as THREE from 'three';
import { createAvatars, readPose, type Hand } from 'layersharedsession/avatars.js';
import { loadIdentity } from 'layersharedsession/identity.js';
import { emptyPose } from 'layersharedsession/pose.js';
import { newRoom } from 'layersharedsession/room.js';
import type { Session } from 'layersharedsession/session.js';
import { BREADBOARD_ID as PAGE_ID } from './hallway';

/**
 * The shared session of the Hallway and the places behind its doors (the Hallway's README,
 * "Together"; AriaMoKr/layersharedsession, peer to peer over WebRTC with Trystero, finding the
 * others through public Nostr relays). Its room is in the address (?room=), so the address is the
 * invitation; the Hallway's door brings it here and the way back carries it on, so the visitor
 * stays in it. This page is `breadboard` in the session. The others in it who are here are drawn
 * by the layer's avatars (avatars.js), as on the other sites: a head with a visor on its front, a
 * hand per tracked controller, a ring on the floor and their name.
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

export class Together {
  /** The room joined, or kept while paused (going through a door); null out of any. */
  room: string | null = null;
  private paused = false;
  private session: Session | null = null;
  private joining = 0; // which join is current: a slow import must not join a room left since
  private startedAt = 0;
  private slowTimer = 0;
  private readonly avatars;
  private readonly pose = emptyPose();
  private readonly isHere = (p: { page: string | null }) => p.page === PAGE_ID;
  onChange = () => {};
  onNotice = (_text: string) => {};

  /** `hands`: the controllers and their input sources (for their handedness), as main.ts has them. */
  constructor(private o: { scene: THREE.Scene; camera: THREE.Camera; renderer: THREE.WebGLRenderer; hands: () => Hand[] }) {
    this.avatars = createAvatars({ parent: o.scene });
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
      this.avatars.show(p);
      this.onNotice(p.page === PAGE_ID ? `${p.name} is here` : `${p.name} is in the session, in ${p.page}`);
      this.onChange();
    });
    s.on('update', (p) => {
      // renamed, recoloured, or on another page: the avatar keeps the page it last saw
      const a = this.avatars.show(p);
      if (a.page !== p.page && p.page === PAGE_ID) this.onNotice(`${p.name} came in to the computer`);
      a.page = p.page;
      this.onChange();
    });
    s.on('leave', (p) => {
      this.avatars.drop(p.peerId);
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
    this.avatars.clear();
  }

  private setAddress(room: string | null) {
    const url = new URL(location.href);
    if (room) url.searchParams.set('room', room);
    else url.searchParams.delete('room');
    history.replaceState(history.state, '', url.href);
  }

  /** Per frame: sends where the head and hands are (at most 15 times a second), and places the others who are here. */
  update(now: number) {
    const s = this.session;
    if (!s) return;
    s.setPose(readPose(this.o.camera, this.o.renderer.xr.isPresenting ? this.o.hands() : null, this.pose));
    s.tick();
    this.avatars.place(now, s.peers, this.isHere);
  }
}
