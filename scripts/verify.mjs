// npm run verify: everything that should pass before a commit or a push, in order, stopping at
// the first failure. The unit tests, the build (it typechecks first), then the browser checks on
// the built site, which include all of the dev-server checks plus download, install and offline.
// Each step is the npm script of that name, so this follows any change to them.
import { spawnSync } from 'node:child_process';

const steps = [
  ['unit tests', ['test']],
  ['typecheck and build', ['build']],
  ['browser checks on the built site', ['check:browser', '--', '--dist']],
];

// Under `npm run`, npm_execpath is npm's own script: running it with this Node needs no shell
// on any platform. Run directly (node scripts/verify.mjs), fall back to npm on the PATH.
const npm = (args) =>
  process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, 'run', ...args], { stdio: 'inherit' })
    : spawnSync('npm', ['run', ...args], { stdio: 'inherit', shell: true });

const secs = (ms) => `${Math.round(ms / 100) / 10} s`;
const start = performance.now();
for (const [i, [name, args]] of steps.entries()) {
  const tag = `[${i + 1}/${steps.length}] ${name}`;
  console.log(`\n${tag}: npm run ${args.join(' ')}`);
  const t = performance.now();
  const r = npm(args);
  if (r.status !== 0) {
    const rest = steps.slice(i + 1).map(([n]) => n);
    console.log(`\n${tag} FAILED${r.error ? `: ${r.error.message}` : ` (exit ${r.status ?? r.signal})`}.`);
    if (rest.length) console.log(`Not run: ${rest.join(', ')}.`);
    process.exit(r.status || 1);
  }
  console.log(`${tag}: passed in ${secs(performance.now() - t)}`);
}
console.log(`\nVerified in ${secs(performance.now() - start)}: ${steps.map(([n]) => n).join(', ')}.`);
