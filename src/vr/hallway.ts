/**
 * The Hallway (https://ariamokr.github.io/hallway/, github.com/AriaMoKr/hallway): a WebXR corridor
 * whose doors lead to other places, this VR view behind one of them (its id: "breadboard"). A door
 * opens vr.html?from=hallway&back=<the way back>&dx=…&yaw=…&pitch=…&dw=…&dh=…&glow=…[&room=…] (its
 * README, "Going in"), and the way back is a link to `back` (README, "Linking back"), shown as a
 * doorway in the room with the Hallway seen through it (README, "The view from your door"). Pure:
 * main.ts reads and keeps it, door.ts builds the doorway.
 */

/** This view's id in the Hallway: its door is `breadboard`, and the way back is ?from=breadboard. */
export const BREADBOARD_ID = 'breadboard';
/** The Hallway, in front of this view's door. */
export const HALLWAY_URL = 'https://ariamokr.github.io/hallway/?from=breadboard';

/** What a door adds to the address (the Hallway's README, "Going in"). `room` stays: it names the shared session. */
export const VISIT_PARAMS = ['from', 'back', 'dx', 'yaw', 'pitch', 'dw', 'dh', 'glow'] as const;

/** The doorway back when the link gives no size or colour: the Hallway's doorways, and the red of its door to here. */
export const DOOR = { width: 1.1, height: 2.25 };
export const DEFAULT_GLOW = '#d8543f';

export interface WayBack {
  url: string;
  /** On the button and the link: "← Hallway", or "← <host>" for anywhere else. */
  label: string;
  /** The tooltip: where it leads. */
  title: string;
  /** On the doorway's sign: "Hallway", or the host. */
  name: string;
  /** Whether it is the Hallway (then the doorway shows the Hallway's view of its door here). */
  hallway: boolean;
}

/** How the visitor came through the door; each null when the link doesn't give it, or gives nonsense. */
export interface Visit {
  from: string | null;
  /** Where they went through: metres from the doorway's middle, + to their right as they face in. */
  dx: number | null;
  /** Which way they faced and looked, in radians from straight in: + to the left, + up. */
  yaw: number | null;
  pitch: number | null;
  /** The doorway's width and height, metres. */
  dw: number | null;
  dh: number | null;
  /** The doorway's colour, '#rrggbb'. */
  glow: string | null;
}

const DEG = Math.PI / 180;

/** A number parameter, kept between lo and hi, or null when it is missing or not a number. */
function number(q: URLSearchParams, key: string, lo: number, hi: number): number | null {
  const s = q.get(key);
  if (s === null || s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
}

/** What the door's link says about the visit (the Hallway's README, "Going in"). */
export function readVisit(search: string): Visit {
  const q = new URLSearchParams(search);
  const yaw = number(q, 'yaw', -90, 90);
  const pitch = number(q, 'pitch', -89, 89);
  const glow = q.get('glow');
  return {
    from: q.get('from'),
    dx: number(q, 'dx', -1.2, 1.2),
    yaw: yaw === null ? null : yaw * DEG,
    pitch: pitch === null ? null : pitch * DEG,
    dw: number(q, 'dw', 0.7, 2.4),
    dh: number(q, 'dh', 1.9, 3.2),
    glow: glow && /^[0-9a-f]{6}$/i.test(glow) ? `#${glow.toLowerCase()}` : null,
  };
}

/** Whether an origin is a development server on this machine (the Hallway's and this view's, on their own ports). */
function local(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * The way back from a door's link, or null for a visit that didn't come through one. It leads to
 * `back` when that is an http(s) address, else (`from=hallway` alone) to the Hallway. It is called
 * the Hallway only when it is: `from=hallway`, on this page's origin or the Hallway's (or, while
 * developing, both on this machine). Anywhere else is named by its host, so a link cannot send
 * visitors somewhere unsaid.
 * @param origin this page's origin (location.origin)
 */
export function wayBack(search: string, origin: string): WayBack | null {
  const q = new URLSearchParams(search);
  const from = q.get('from');
  let url: URL | null = null;
  try {
    url = q.get('back') ? new URL(q.get('back')!) : null;
  } catch {
    url = null;
  }
  if (url && url.protocol !== 'https:' && url.protocol !== 'http:') url = null;
  if (!url) return from === 'hallway' ? { url: HALLWAY_URL, label: '← Hallway', title: 'Back to the Hallway, whose doors lead to other places', name: 'Hallway', hallway: true } : null;
  const hallway = from === 'hallway' && (url.origin === origin || url.origin === new URL(HALLWAY_URL).origin || (local(url.origin) && local(origin)));
  return hallway
    ? { url: url.href, label: '← Hallway', title: `Back to the Hallway (${url.host})`, name: 'Hallway', hallway: true }
    : { url: url.href, label: `← ${url.host}`, title: `Back to ${url.href}`, name: url.host, hallway: false };
}

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
  const w = (o.way && typeof o.way === 'object' ? o.way : {}) as Record<string, unknown>;
  if (typeof w.url !== 'string' || !/^https?:\/\//.test(w.url)) return null;
  for (const key of ['label', 'title', 'name']) if (typeof w[key] !== 'string' || !w[key]) return null;
  const size = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : fallback);
  return {
    way: { url: w.url, label: w.label as string, title: w.title as string, name: w.name as string, hallway: w.hallway === true },
    glow: typeof o.glow === 'string' && /^#[0-9a-f]{6}$/.test(o.glow) ? o.glow : DEFAULT_GLOW,
    width: size(o.width, 0.7, 2.4, DOOR.width),
    height: size(o.height, 1.9, 3.2, DOOR.height),
  };
}

/**
 * The address without what a door added: read once, so a reload, Back or a shared link doesn't
 * arrive again (README, "Going in"). Path, other parameters (?debug, ?room=) and the hash stay.
 */
export function withoutVisit(href: string): string {
  const u = new URL(href);
  // the other parameters as written (URLSearchParams would turn ?debug into ?debug=)
  const kept = u.search.slice(1).split('&').filter((p) => p && !(VISIT_PARAMS as readonly string[]).includes(decodeURIComponent(p.split('=')[0])));
  return u.pathname + (kept.length ? `?${kept.join('&')}` : '') + u.hash;
}

/** The address the way back opens: in the shared session `room`, or out of any (README, "Linking back"). */
export function leaveUrl(way: WayBack, room: string | null): string {
  const u = new URL(way.url);
  if (room) u.searchParams.set('room', room);
  else u.searchParams.delete('room');
  return u.href;
}

/**
 * Where the Hallway publishes the view out of its door to here (README, "The view from your door"):
 * { views (views.json's address), id (the door's) }, or null when the way back is not the Hallway.
 */
export function hallwayViews(way: WayBack): { views: string; id: string } | null {
  if (!way.hallway) return null;
  const u = new URL(way.url);
  return { views: new URL('views/views.json', u).href, id: u.searchParams.get('from') || BREADBOARD_ID };
}

/** How the Hallway's view of a door is hung behind an opening (its views.json): metres, its width over its height. */
export interface ViewParams {
  image: string;
  depth: number;
  pictureHeight: number;
  eye: number;
  horizon: number;
  aspect: number;
}

/** An entry of the Hallway's views.json, checked: sizes in sensible ranges, else null (as vrlbry and outside check it). */
export function viewParams(entry: unknown): ViewParams | null {
  const e = entry as Record<string, unknown> | null;
  if (!e || typeof e !== 'object' || typeof e.image !== 'string' || !e.image) return null;
  const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : null);
  const depth = n(e.depth, 0.3, 30), pictureHeight = n(e.pictureHeight, 0.5, 40), eye = n(e.eye, 0, 3);
  const horizon = n(e.horizon, 0, 1), aspect = n(e.aspect ?? 2, 0.25, 8);
  if (depth === null || pictureHeight === null || eye === null || horizon === null || aspect === null) return null;
  return { image: e.image, depth, pictureHeight, eye, horizon, aspect };
}
