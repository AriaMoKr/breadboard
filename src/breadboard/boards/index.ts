import type { ModuleBoardDef } from '../layout';

// Every src/breadboard/boards/*.board.ts default-exports a ModuleBoardDef.
const modules = import.meta.glob<{ default: ModuleBoardDef }>('./*.board.ts', { eager: true });

export const MODULE_BOARDS = new Map<string, ModuleBoardDef>();
for (const [path, mod] of Object.entries(modules)) {
  const def = mod.default;
  if (!def?.id) {
    console.warn(`Board module ${path} has no default export`);
    continue;
  }
  MODULE_BOARDS.set(def.id, def);
}
