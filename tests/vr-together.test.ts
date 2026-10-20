import { describe, expect, it } from 'vitest';
import { roomFromUrl } from 'layersharedsession/room.js';
import { APP_ID, sessionStatus } from '../src/vr/together';
import { leaveUrl, wayBack, withoutVisit } from '../src/vr/hallway';

const standing = { online: true, joined: true, relays: 2, slow: false, here: 0, away: 0 };

describe('the shared session', () => {
  it('says how it is going, as the Hallway words it', () => {
    expect(sessionStatus({ ...standing, joined: false })).toBe('Connecting…');
    expect(sessionStatus({ ...standing, relays: 0 })).toBe('Connecting…');
    expect(sessionStatus({ ...standing, relays: 0, slow: true })).toBe("Can't reach the relays");
    expect(sessionStatus({ ...standing, online: false })).toBe('Offline');
    expect(sessionStatus(standing)).toBe('Waiting for others');
    expect(sessionStatus({ ...standing, here: 2 })).toBe('2 here');
    expect(sessionStatus({ ...standing, here: 1, away: 3 })).toBe('1 here, 3 elsewhere');
    expect(sessionStatus({ ...standing, away: 1 })).toBe('1 elsewhere');
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
    const way = wayBack(new URL(link).search, 'https://ariamokr.github.io')!;
    expect(roomFromUrl(leaveUrl(way, 'k3vd-q8hn'))).toBe('k3vd-q8hn');
    expect(roomFromUrl(leaveUrl(way, null))).toBeNull(); // left the session here: out of it there too
  });
});
