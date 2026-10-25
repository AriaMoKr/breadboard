import { describe, expect, it } from 'vitest';
import { roomFromUrl } from 'layersharedsession/room.js';
import type { Peer, Session } from 'layersharedsession/session.js';
import { APP_ID, noticeText, sessionStatus, startTogether, statusOf } from '../src/vr/together';
import { leaveUrl, wayBack, withoutVisit } from 'common/door.js';
import { BREADBOARD_ID } from '../src/vr/hallway';

const standing = { online: true, loaded: true, relays: 2, slow: false, failed: 0, here: 0, nearby: 0, away: 0, connecting: 0 };
const peer = (name: string | null, page: string | null) => ({ peerId: `p-${name}`, memberId: null, name, color: '#888888', page }) as Peer;

describe('the shared session', () => {
  it('says how it is going, as the Hallway words it', () => {
    expect(sessionStatus({ ...standing, loaded: false })).toBe('Connecting…');
    expect(sessionStatus({ ...standing, relays: 0 })).toBe('Connecting…');
    expect(sessionStatus({ ...standing, relays: 0, slow: true })).toBe("Can't reach the relays");
    expect(sessionStatus({ ...standing, online: false })).toBe('Offline');
    expect(sessionStatus(standing)).toBe('Waiting for others');
    expect(sessionStatus({ ...standing, here: 2 })).toBe('2 here');
    expect(sessionStatus({ ...standing, here: 1, away: 3 })).toBe('1 here, 3 elsewhere');
    expect(sessionStatus({ ...standing, away: 1 })).toBe('1 elsewhere');
    expect(sessionStatus({ ...standing, connecting: 1 })).toBe('Connecting to 1 visitor…');
    expect(sessionStatus({ ...standing, failed: 2 })).toBe("Couldn't connect to 2 visitors");
    expect(sessionStatus({ ...standing, relays: 0, here: 1 })).toBe('1 here'); // met already, relays or not
  });

  it('words what happens in it, here and elsewhere', () => {
    expect(noticeText({ kind: 'join', peer: peer('Ann', BREADBOARD_ID) })).toBe('Ann is here');
    expect(noticeText({ kind: 'join', peer: peer('Ann', 'hallway') })).toBe('Ann is in the session, in hallway');
    expect(noticeText({ kind: 'arrive', peer: peer('Ann', BREADBOARD_ID), from: 'hallway' })).toBe('Ann came in to the computer');
    expect(noticeText({ kind: 'leave', peer: peer(null, null) })).toBe('Someone left the session');
    expect(noticeText({ kind: 'wave', peer: peer('Bo', BREADBOARD_ID) })).toBe('Bo waved');
    expect(noticeText({ kind: 'wave', peer: peer('Bo', 'hallway') })).toBe('Bo waved, in hallway');
  });

  it('runs on the layer’s controller as this page, its notices worded', async () => {
    // a stand-in for session.js: what together.js reads of a session, and a way to raise its events
    const on = new Map<string, ((p: unknown) => void)[]>();
    const joined: { appId: string; page: string; room: string }[] = [];
    const peers = new Map<string, Peer>();
    const session = {
      peers,
      relays: { open: 2 },
      on: (type: string, fn: (p: unknown) => void) => (on.set(type, [...(on.get(type) ?? []), fn]), () => {}),
      channel: () => ({ send: async () => {}, on: () => () => {} }),
      setPose() {},
      tick() {},
      leave: async () => {},
    } as unknown as Session;
    const raise = (type: string, p: Peer) => on.get(type)?.forEach((fn) => fn(p));
    const said: string[] = [];
    const together = startTogether({
      scene: null,
      camera: null,
      renderer: null,
      hands: () => [],
      say: (text) => said.push(text),
      joinSession: (o) => (joined.push({ appId: o.appId, page: o.page, room: o.room }), session),
    });
    expect(statusOf(together)).toBe('');
    together.start('k3vd-q8hn');
    await new Promise((r) => setTimeout(r));
    expect(joined).toEqual([{ appId: APP_ID, page: BREADBOARD_ID, room: 'k3vd-q8hn' }]);
    expect(statusOf(together)).toBe('Waiting for others');
    const ann = peer('Ann', 'hallway');
    peers.set(ann.peerId, ann);
    raise('join', ann);
    ann.page = BREADBOARD_ID;
    raise('update', ann);
    expect(said).toEqual(['Ann is in the session, in hallway', 'Ann came in to the computer']);
    expect(statusOf(together)).toBe('1 here');
    await together.stop();
    expect(statusOf(together)).toBe('');
  });

  it('is the Hallway’s: the same app id, so its visitors and the test page meet those here', () => {
    expect(APP_ID).toBe('ariamokr-layersharedsession-test');
  });

  it('comes in through the Hallway’s door and goes back out with the visitor', () => {
    const link = `https://ariamokr.github.io/breadboard/vr.html?from=hallway&back=${encodeURIComponent('https://ariamokr.github.io/hallway/?from=breadboard&room=k3vd-q8hn')}&dx=0&room=k3vd-q8hn`;
    // the door's parameters come off the address, the room stays and is joined
    const kept = `https://ariamokr.github.io${withoutVisit(link)}`;
    expect(roomFromUrl(kept)).toBe('k3vd-q8hn');
    // the way back carries the room, as it is now
    const way = wayBack(new URL(link).search, BREADBOARD_ID, { origin: 'https://ariamokr.github.io', always: false })!;
    expect(roomFromUrl(leaveUrl(way, 'k3vd-q8hn'))).toBe('k3vd-q8hn');
    expect(roomFromUrl(leaveUrl(way, null))).toBeNull(); // left the session here: out of it there too
  });
});
