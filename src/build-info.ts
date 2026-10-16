/** Set by vite.config.ts from git (scripts/lib/build-info.mjs). */
declare const __BUILD__: { commit: string; time: string; modified: boolean };

/**
 * Which version this is: "6e935a6 · Oct 15, 2026, 8:30 PM", the commit it was built from and the
 * commit's date in local time. "modified" when built with uncommitted changes, "dev" on the dev
 * server (where it is the commit the server started at).
 */
export function buildLabel(): string {
  const { commit, time, modified } = __BUILD__;
  const date = time ? new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return [commit + (modified ? ' (modified)' : ''), date, import.meta.env.DEV ? 'dev' : ''].filter(Boolean).join(' · ') || 'unknown version';
}
