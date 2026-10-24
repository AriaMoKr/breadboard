import { ACCESS_KEY, loadAccess, motionQuery, reduceMotion, watchMotion } from 'common/access.js';

/**
 * Less motion on the page: the visitor's choice, kept under `hallway.access` by the Hallway and the
 * places behind its doors (common's access.js), else the system's own setting. While it holds, the
 * root element has the class `reduce-motion`, which the styles read to still what isn't the
 * simulation itself (sliding knobs and drawers, fading buttons, pulses), and the breadboard view's
 * zoom jumps instead of gliding (viewer.ts). It follows a change made in another tab, the system
 * setting changing, and a page coming back from the back/forward cache.
 */
export function followMotion(root: HTMLElement = document.documentElement) {
  const storage = (() => {
    try {
      return localStorage;
    } catch {
      return null; // storage blocked: the system's setting alone
    }
  })();
  const query = motionQuery();
  const apply = () => root.classList.toggle('reduce-motion', reduceMotion(loadAccess(storage), query));
  apply();
  watchMotion(apply, query);
  addEventListener('storage', (e) => {
    if (e.key === ACCESS_KEY || e.key === null) apply();
  });
  addEventListener('pageshow', (e) => {
    if (e.persisted) apply();
  });
}

/** Whether the page is moving less now (followMotion's class). */
export const lessMotion = () => document.documentElement.classList.contains('reduce-motion');
