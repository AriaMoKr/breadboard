import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOW, DOOR, HALLWAY_URL, doorOf, hallwayViews, keptDoor, leaveUrl, readVisit, viewParams, wayBack, withoutVisit } from '../src/vr/hallway';

const ORIGIN = 'https://ariamokr.github.io';
/** A door's link, as the Hallway's README ("Going in") shows one. */
const door = (back: string, extra = '') =>
  `?from=hallway&back=${encodeURIComponent(back)}&dx=0.12&yaw=-8&pitch=-3&dw=1.1&dh=2.25&glow=d8543f${extra}`;
const HALLWAY_BACK = 'https://ariamokr.github.io/hallway/?from=breadboard';

describe('the way back to the Hallway', () => {
  it('leads where the door says, named the Hallway', () => {
    const w = wayBack(door(HALLWAY_BACK), ORIGIN);
    expect(w).toEqual({ url: HALLWAY_BACK, label: '← Hallway', title: 'Back to the Hallway (ariamokr.github.io)', name: 'Hallway', hallway: true });
  });

  it('is the Hallway on this page’s own origin too (a Hallway served next to it), or on another dev server here', () => {
    expect(wayBack(door('http://127.0.0.1:5174/hallway/?from=breadboard'), 'http://127.0.0.1:5174')?.label).toBe('← Hallway');
    expect(wayBack(door('http://localhost:8088/?from=breadboard'), 'http://localhost:5173')?.hallway).toBe(true);
    expect(wayBack(door('http://localhost:8088/?from=breadboard'), ORIGIN)?.hallway).toBe(false);
  });

  it('names anywhere else by its host', () => {
    expect(wayBack(door('https://example.org/garden/'), ORIGIN)).toEqual({ url: 'https://example.org/garden/', label: '← example.org', title: 'Back to https://example.org/garden/', name: 'example.org', hallway: false });
    // `from=hallway` doesn't make another site the Hallway
    expect(wayBack(`?back=${encodeURIComponent('https://ariamokr.github.io/hallway/')}`, ORIGIN)?.label).toBe('← ariamokr.github.io');
  });

  it('goes to the Hallway when the door gives no address back', () => {
    expect(wayBack('?from=hallway', ORIGIN)?.url).toBe(HALLWAY_URL);
    expect(new URL(HALLWAY_URL).searchParams.get('from')).toBe('breadboard'); // the Hallway's id for this door
  });

  it('takes only http(s) addresses', () => {
    expect(wayBack(door('javascript:alert(1)'), ORIGIN)?.url).toBe(HALLWAY_URL);
    expect(wayBack('?back=javascript%3Aalert(1)', ORIGIN)).toBeNull();
    expect(wayBack('?back=not%20a%20url', ORIGIN)).toBeNull();
  });

  it('is none for a visit that came through no door', () => {
    expect(wayBack('', ORIGIN)).toBeNull();
    expect(wayBack('?debug', ORIGIN)).toBeNull();
  });

  it('takes what the door added off the address, keeping the rest and the shared session', () => {
    const href = `${ORIGIN}/breadboard/vr.html${door(HALLWAY_BACK, '&debug&room=k3vd-q8hn')}#example/counter`;
    expect(withoutVisit(href)).toBe('/breadboard/vr.html?debug&room=k3vd-q8hn#example/counter');
    expect(withoutVisit(`${ORIGIN}/breadboard/vr.html#c1.abc`)).toBe('/breadboard/vr.html#c1.abc');
  });

  it('leads back in the shared session, or out of any', () => {
    const w = wayBack(door(`${HALLWAY_BACK}&room=old`), ORIGIN)!;
    expect(leaveUrl(w, 'k3vd-q8hn')).toBe(`${HALLWAY_BACK}&room=k3vd-q8hn`);
    expect(leaveUrl(w, null)).toBe(HALLWAY_BACK);
  });
});

describe('the door the visitor came through', () => {
  it('reads where and how they went through', () => {
    const v = readVisit(door(HALLWAY_BACK));
    expect(v.from).toBe('hallway');
    expect(v.dx).toBe(0.12);
    expect(v.yaw).toBeCloseTo((-8 * Math.PI) / 180);
    expect(v.pitch).toBeCloseTo((-3 * Math.PI) / 180);
    expect([v.dw, v.dh, v.glow]).toEqual([1.1, 2.25, '#d8543f']);
  });

  it('keeps numbers in range and drops nonsense', () => {
    const v = readVisit('?dx=9&yaw=-400&pitch=abc&dw=0.1&dh=&glow=red');
    expect([v.dx, v.yaw, v.pitch, v.dw, v.dh, v.glow]).toEqual([1.2, -Math.PI / 2, null, 0.7, null, null]);
    expect(readVisit('').from).toBeNull();
  });

  it('is kept for the tab, checked when read back', () => {
    const k = doorOf(wayBack(door(HALLWAY_BACK), ORIGIN)!, readVisit(door(HALLWAY_BACK)));
    expect(keptDoor(JSON.stringify(k))).toEqual(k);
    expect(doorOf(k.way, readVisit('?from=hallway'))).toEqual({ way: k.way, glow: DEFAULT_GLOW, width: DOOR.width, height: DOOR.height });
    expect(keptDoor(JSON.stringify({ ...k, glow: 'red', width: 9 }))).toEqual({ ...k, glow: DEFAULT_GLOW, width: DOOR.width });
    for (const bad of [null, 'not json', '{}', JSON.stringify({ way: { ...k.way, url: 'javascript:x' } }), JSON.stringify({ way: { ...k.way, name: '' } })]) expect(keptDoor(bad)).toBeNull();
  });
});

describe('the Hallway’s view of its door to here', () => {
  it('is published next to the Hallway the way back leads to', () => {
    expect(hallwayViews(wayBack(door(HALLWAY_BACK), ORIGIN)!)).toEqual({ views: 'https://ariamokr.github.io/hallway/views/views.json', id: 'breadboard' });
    expect(hallwayViews(wayBack('?from=hallway', ORIGIN)!)?.id).toBe('breadboard');
    expect(hallwayViews(wayBack(door('https://example.org/garden/'), ORIGIN)!)).toBeNull();
  });

  it('is hung as views.json says, when that is sensible', () => {
    const entry = { image: 'breadboard.jpg', depth: 2.94, pictureHeight: 6.5, eye: 1.6, horizon: 0.6154, aspect: 2 };
    expect(viewParams(entry)).toEqual(entry);
    const { aspect: _, ...noAspect } = entry;
    expect(viewParams(noAspect)?.aspect).toBe(2);
    for (const bad of [null, {}, { ...entry, image: '' }, { ...entry, depth: 0 }, { ...entry, horizon: 2 }, { ...entry, eye: '1.6' }]) expect(viewParams(bad)).toBeNull();
  });
});
