// What a build is made from: the commit and its date. The zip (zip-dist.mjs) dates its files
// with it, and the pages show it (vite.config.ts defines __BUILD__). Both come from the commit,
// not the clock, so building the same commit twice gives the same files.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Output of a git command in the project, or '' without git or outside a checkout. */
function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** SOURCE_DATE_EPOCH when set (the reproducible-builds convention), else the last commit's time, else null. */
export function sourceDate() {
  for (const s of [process.env.SOURCE_DATE_EPOCH, git('log', '-1', '--format=%ct')]) {
    const seconds = Number(s || NaN);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return null;
}

/** The short commit id ('' without git), its date (ISO, '' if unknown), and whether tracked files have uncommitted changes. */
export function buildInfo() {
  return {
    commit: git('rev-parse', '--short', 'HEAD'),
    time: sourceDate()?.toISOString() ?? '',
    modified: git('status', '--porcelain', '--untracked-files=no') !== '',
  };
}
