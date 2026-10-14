import type { Lab } from './types';

// Every src/labs/**/*.lab.ts file default-exports a Lab.
const modules = import.meta.glob<{ default: Lab }>('./**/*.lab.ts', { eager: true });

export const LABS = new Map<string, Lab>();
for (const [path, mod] of Object.entries(modules)) {
  const lab = mod.default;
  if (!lab?.id) {
    console.warn(`Lab module ${path} has no default export`);
    continue;
  }
  if (LABS.has(lab.id)) console.warn(`Duplicate lab id "${lab.id}" in ${path}`);
  LABS.set(lab.id, lab);
}
