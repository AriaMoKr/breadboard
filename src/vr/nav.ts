/**
 * How the visitor moves in VR (the Hallway's README, "Moving about"): `move` smooth (the left
 * stick walks) or teleport (it aims a jump), `turn` snap (the right stick turns 30° a push) or
 * smooth. Chosen on the room's panel and kept in this browser under the Hallway's own key, which
 * every site on ariamokr.github.io can read: one choice for the Hallway and the places behind its
 * doors (as its settings.js and outside's). Pure apart from the storage passed in.
 */

export const NAV_KEY = 'hallway.nav';
export interface Nav {
  move: 'smooth' | 'teleport';
  turn: 'snap' | 'smooth';
}
const CHOICES = { move: ['smooth', 'teleport'], turn: ['snap', 'smooth'] } as const;
export const NAV_DEFAULTS: Nav = { move: 'smooth', turn: 'snap' };

/** A complete, valid setting from whatever was stored (unknown or missing values: the defaults). */
export function normalizeNav(value: unknown): Nav {
  const out = { ...NAV_DEFAULTS };
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if ((CHOICES.move as readonly unknown[]).includes(v.move)) out.move = v.move as Nav['move'];
  if ((CHOICES.turn as readonly unknown[]).includes(v.turn)) out.turn = v.turn as Nav['turn'];
  return out;
}

export function loadNav(storage: Storage | null): Nav {
  try {
    return normalizeNav(JSON.parse(storage?.getItem(NAV_KEY) ?? 'null'));
  } catch {
    return { ...NAV_DEFAULTS };
  }
}

export function saveNav(storage: Storage | null, nav: Nav) {
  try {
    storage?.setItem(NAV_KEY, JSON.stringify(normalizeNav(nav)));
  } catch {
    // storage blocked (a private window): the choice lasts this visit
  }
}
