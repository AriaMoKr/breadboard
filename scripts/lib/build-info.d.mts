// Types for build-info.mjs, which vite.config.ts imports.
export function sourceDate(): Date | null;
export function buildInfo(): { commit: string; time: string; modified: boolean };
