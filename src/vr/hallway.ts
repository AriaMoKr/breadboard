/**
 * The Hallway (https://ariamokr.github.io/hallway/, github.com/AriaMoKr/hallway): a WebXR corridor
 * whose doors lead to other places, this VR view behind one of them (its id: "breadboard"). A door
 * opens vr.html?from=hallway&back=<the way back>&dx=…&yaw=… (its README, "Going in"), and the way
 * back is a link to `back` (README, "Linking back"). Pure: main.ts reads and keeps it.
 */

/** The Hallway, in front of this view's door. */
export const HALLWAY_URL = 'https://ariamokr.github.io/hallway/?from=breadboard';

/** What a door adds to the address (the Hallway's README, "Going in"). */
export const VISIT_PARAMS = ['from', 'back', 'dx', 'yaw', 'pitch', 'dw', 'dh', 'glow'] as const;

export interface WayBack {
  url: string;
  /** On the button and the link: "← Hallway", or "← <host>" for anywhere else. */
  label: string;
  /** The tooltip: where it leads. */
  title: string;
}

/**
 * The way back from a door's link, or null for a visit that didn't come through one. It leads to
 * `back` when that is an http(s) address, else (`from=hallway` alone) to the Hallway. It is called
 * the Hallway only when it is: `from=hallway`, on this page's origin or the Hallway's. Anywhere
 * else is named by its host, so a link cannot send visitors somewhere unsaid.
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
  if (!url) return from === 'hallway' ? { url: HALLWAY_URL, label: '← Hallway', title: 'Back to the Hallway, whose doors lead to other places' } : null;
  const hallway = from === 'hallway' && (url.origin === origin || url.origin === new URL(HALLWAY_URL).origin);
  return hallway
    ? { url: url.href, label: '← Hallway', title: `Back to the Hallway (${url.host})` }
    : { url: url.href, label: `← ${url.host}`, title: `Back to ${url.href}` };
}

/**
 * The address without what a door added: read once, so a reload, Back or a shared link doesn't
 * arrive again (README, "Going in"). Path, other parameters (?debug) and the hash stay.
 */
export function withoutVisit(href: string): string {
  const u = new URL(href);
  // the other parameters as written (URLSearchParams would turn ?debug into ?debug=)
  const kept = u.search.slice(1).split('&').filter((p) => p && !(VISIT_PARAMS as readonly string[]).includes(p.split('=')[0]));
  return u.pathname + (kept.length ? `?${kept.join('&')}` : '') + u.hash;
}
