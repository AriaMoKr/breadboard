import { describe, expect, it } from 'vitest';
import { hallwayUrl, hallwayViews, readVisit, wayBack } from 'common/door.js';
import { BREADBOARD_ID, DEFAULT_GLOW, DOOR, doorOf, keptDoor } from '../src/vr/hallway';

// The door contract itself is AriaMoKr/common's door.js, tested there. Here: what breadboard
// passes it, and the doorway back as breadboard keeps it.
const ORIGIN = 'https://ariamokr.github.io';
/** A door's link, as the Hallway's README ("Going in") shows one. */
const door = (back: string) => `?from=hallway&back=${encodeURIComponent(back)}&dx=0.12&yaw=-8&pitch=-3&dw=1.1&dh=2.25&glow=d8543f`;
const HALLWAY_BACK = 'https://ariamokr.github.io/hallway/?from=breadboard';
/** The way back as main.ts asks for it. */
const way = (search: string) => wayBack(search, BREADBOARD_ID, { origin: ORIGIN, always: false });

describe('the way back, as breadboard asks for it', () => {
  it('is the Hallway, in front of this door, from the Hallway’s door', () => {
    expect(way(door(HALLWAY_BACK))).toMatchObject({ url: HALLWAY_BACK, label: '← Hallway', hallway: true });
    expect(way('?from=hallway')?.url).toBe(hallwayUrl('breadboard'));
    expect(new URL(hallwayUrl(BREADBOARD_ID)).searchParams.get('from')).toBe('breadboard');
  });

  it('is none for a visit that came through no door (the main page’s link, a bookmark)', () => {
    expect(way('')).toBeNull();
    expect(way('?debug')).toBeNull();
  });

  it('shows the Hallway’s view of this door', () => {
    expect(hallwayViews(way('?from=hallway')!, BREADBOARD_ID)).toEqual({ views: 'https://ariamokr.github.io/hallway/views/views.json', id: 'breadboard' });
  });
});

describe('the doorway back, kept for the tab', () => {
  it('has the link’s size and glow, or the Hallway’s', () => {
    const k = doorOf(way(door(HALLWAY_BACK))!, readVisit(door(HALLWAY_BACK)));
    expect([k.glow, k.width, k.height]).toEqual(['#d8543f', 1.1, 2.25]);
    expect(doorOf(k.way, readVisit('?from=hallway'))).toEqual({ way: k.way, glow: DEFAULT_GLOW, width: DOOR.width, height: DOOR.height });
  });

  it('is checked when read back', () => {
    const k = doorOf(way(door(HALLWAY_BACK))!, readVisit(door(HALLWAY_BACK)));
    expect(keptDoor(JSON.stringify(k))).toEqual(k);
    expect(keptDoor(JSON.stringify({ ...k, glow: 'red', width: 9 }))).toEqual({ ...k, glow: DEFAULT_GLOW, width: DOOR.width });
    const { host: _, ...noHost } = k.way; // kept before the way back had a host
    for (const bad of [null, 'not json', '{}', JSON.stringify({ way: { ...k.way, url: 'javascript:x' } }), JSON.stringify({ way: { ...k.way, name: '' } }), JSON.stringify({ ...k, way: noHost })]) expect(keptDoor(bad)).toBeNull();
  });
});
