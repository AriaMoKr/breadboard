import type { Lab } from '../labs/types';

/**
 * Lab loading for the app, by id: an `import()` of each `*.lab.ts`. On the dev
 * server a lab loads when it is first opened; the build inlines them all into
 * the page's one JS file (vite.config.ts), so a wget mirror gets every lab. Files are
 * keyed by name (`<lab-id>.lab.ts`); tests/computer.test.ts checks that every
 * file name matches the id it registers. (src/labs/registry.ts still offers
 * the eager map for tests and tools.)
 */
const loaders = import.meta.glob<{ default: Lab }>('../labs/**/*.lab.ts');

const byId = new Map<string, () => Promise<{ default: Lab }>>();
for (const [path, load] of Object.entries(loaders)) {
  const m = path.match(/([^/]+)\.lab\.ts$/);
  if (m) byId.set(m[1], load);
}

const cache = new Map<string, Lab>();

/** Whether a lab file exists for this id. */
export const hasLab = (id: string) => byId.has(id);

/** A lab that has already been loaded, if any. */
export const loadedLab = (id: string): Lab | undefined => cache.get(id);

/** Forget loaded labs (tests use this to exercise the loading path again). */
export const clearLabCache = () => cache.clear();

/** Load a lab module (cached). Resolves to undefined if there is no such lab or it fails to load. */
export async function loadLab(id: string): Promise<Lab | undefined> {
  const hit = cache.get(id);
  if (hit) return hit;
  const load = byId.get(id);
  if (!load) return undefined;
  try {
    const lab = (await load()).default;
    if (!lab?.id) {
      console.warn(`Lab module ${id}.lab.ts has no default export`);
      return undefined;
    }
    if (lab.id !== id) console.warn(`Lab file ${id}.lab.ts registers id "${lab.id}"`);
    cache.set(id, lab);
    return lab;
  } catch (err) {
    console.error(err);
    return undefined;
  }
}
