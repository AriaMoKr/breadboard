import { describe, expect, it } from 'vitest';
import { HALLWAY_URL, wayBack, withoutVisit } from '../src/vr/hallway';

const ORIGIN = 'https://ariamokr.github.io';
/** A door's link, as the Hallway's README ("Going in") shows one. */
const door = (back: string, extra = '') =>
  `?from=hallway&back=${encodeURIComponent(back)}&dx=0.12&yaw=-8&pitch=-3&dw=1.1&dh=2.25&glow=d8543f${extra}`;

describe('the way back to the Hallway', () => {
  it('leads where the door says, named the Hallway', () => {
    const w = wayBack(door('https://ariamokr.github.io/hallway/?from=breadboard'), ORIGIN);
    expect(w).toEqual({ url: 'https://ariamokr.github.io/hallway/?from=breadboard', label: '← Hallway', title: 'Back to the Hallway (ariamokr.github.io)' });
  });

  it('is the Hallway on this page’s own origin too (a Hallway served next to it)', () => {
    expect(wayBack(door('http://127.0.0.1:5174/hallway/?from=breadboard'), 'http://127.0.0.1:5174')?.label).toBe('← Hallway');
  });

  it('names anywhere else by its host', () => {
    expect(wayBack(door('https://example.org/garden/'), ORIGIN)).toEqual({ url: 'https://example.org/garden/', label: '← example.org', title: 'Back to https://example.org/garden/' });
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

  it('takes what the door added off the address, keeping the rest', () => {
    const href = `${ORIGIN}/breadboard/vr.html${door('https://ariamokr.github.io/hallway/?from=breadboard', '&debug')}#example/counter`;
    expect(withoutVisit(href)).toBe('/breadboard/vr.html?debug#example/counter');
    expect(withoutVisit(`${ORIGIN}/breadboard/vr.html#c1.abc`)).toBe('/breadboard/vr.html#c1.abc');
  });
});
