import { keptWay, type Visit, type WayBack } from 'common/door.js';

/**
 * This VR view behind a door of the Hallway (https://ariamokr.github.io/hallway/,
 * github.com/AriaMoKr/hallway), as the places behind its doors share it: the door contract (a
 * door's link, the way back, the view from the door) is AriaMoKr/common's `door.js` (its README),
 * used by main.ts with this door's id. What is breadboard's own is here: that id, and the doorway
 * back as kept for the tab. Pure.
 */

/** This view's door id in the Hallway: its door is `breadboard`, and the way back is ?from=breadboard. */
export const BREADBOARD_ID = 'breadboard';

/** The doorway back when the link gives no size or colour: the Hallway's doorways, and the red of its door to here. */
export const DOOR = { width: 1.1, height: 2.25 };
export const DEFAULT_GLOW = '#d8543f';

/** The way back and its doorway, kept for this tab (a reload, or the main page and back). */
export interface KeptDoor {
  way: WayBack;
  glow: string;
  width: number;
  height: number;
}

/** The doorway a visit came through, as kept: the link's size and glow, or the defaults. */
export function doorOf(way: WayBack, visit: Visit): KeptDoor {
  return { way, glow: visit.glow ?? DEFAULT_GLOW, width: visit.dw ?? DOOR.width, height: visit.dh ?? DOOR.height };
}

/** A doorway kept in sessionStorage (as JSON), checked; null when it isn't one. */
export function keptDoor(json: string | null): KeptDoor | null {
  let k: unknown;
  try {
    k = JSON.parse(json ?? 'null');
  } catch {
    return null;
  }
  const o = (k && typeof k === 'object' ? k : {}) as Record<string, unknown>;
  const way = keptWay(JSON.stringify(o.way ?? null));
  if (!way) return null;
  const size = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : fallback);
  return {
    way,
    glow: typeof o.glow === 'string' && /^#[0-9a-f]{6}$/.test(o.glow) ? o.glow : DEFAULT_GLOW,
    width: size(o.width, 0.7, 2.4, DOOR.width),
    height: size(o.height, 1.9, 3.2, DOOR.height),
  };
}
