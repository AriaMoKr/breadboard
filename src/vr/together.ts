import type * as THREE from 'three';
import type { Hand } from 'layersharedsession/avatars.js';
import type { JoinOptions, Session } from 'layersharedsession/session.js';
import { createTogether, type Company, type Condition, type Notice, type Together } from 'layersharedsession/together.js';
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
 * The layer's controller (together.js) runs it: starting and leaving, stepping out for the door
 * and back, the room in the address, the poses, who is here, and waves. This file words it. The
 * session module (and Trystero under it) is only imported when a session starts. In a build it is
 * part of vr.html's one JS file, but none of it runs, and nothing is sent, without one.
 */

/** The app id every site in the session uses (and layersharedsession's test page, which can watch). */
export const APP_ID = 'ariamokr-layersharedsession-test';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the session's status says, from how it stands (condition() and company()), as the Hallway words it (pure, for the panel, the page and the tests). */
export function sessionStatus(s: Condition & Company): string {
  if (!s.online) return 'Offline';
  if (s.here || s.away) {
    const parts = [];
    if (s.here) parts.push(`${s.here} here`);
    if (s.away) parts.push(`${s.away} elsewhere`);
    return parts.join(', ');
  }
  if (s.connecting) return `Connecting to ${plural(s.connecting, 'visitor')}…`;
  if (!s.loaded || !s.relays) return s.slow ? "Can't reach the relays" : 'Connecting…';
  if (s.failed) return `Couldn't connect to ${plural(s.failed, 'visitor')}`;
  return 'Waiting for others';
}

/** A notice from the session, in words for the page's toast (pure). */
export function noticeText({ kind, peer }: Notice): string {
  const name = peer.name || 'Someone';
  const elsewhere = peer.page && peer.page !== PAGE_ID ? `, in ${peer.page}` : '';
  switch (kind) {
    case 'join':
      return elsewhere ? `${name} is in the session${elsewhere}` : `${name} is here`;
    case 'arrive':
      return `${name} came in to the computer`;
    case 'leave':
      return `${name} left the session`;
    case 'wave':
      return `${name} waved${elsewhere}`;
  }
}

/**
 * This page's session: the layer's controller with breadboard's app id and page, drawing the
 * others in `scene` (none without one), its notices worded for `say`. `hands`: the controllers and
 * their input sources (for their handedness), as main.ts has them. `joinSession`: a stand-in for
 * session.js, for tests.
 */
export function startTogether(o: {
  scene: THREE.Object3D | null;
  camera: THREE.Camera | null;
  renderer: { xr: { isPresenting: boolean } } | null;
  hands: () => Hand[];
  say: (text: string) => void;
  joinSession?: (o: JoinOptions) => Session;
}): Together {
  const together = createTogether({ appId: APP_ID, page: PAGE_ID, camera: o.camera, renderer: o.renderer, hands: o.hands, avatars: o.scene && { parent: o.scene }, joinSession: o.joinSession });
  together.on('notice', (n) => o.say(noticeText(n)));
  return together;
}

/** How the session is going, in words: empty out of one. */
export const statusOf = (together: Together): string => (together.active ? sessionStatus({ ...together.condition(), ...together.company() }) : '');
