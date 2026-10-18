// Real-input checks (npm run check:input), slower than check:browser (a few minutes). On every
// page, on a desktop with a mouse and on a phone with touch:
// - every control the app listens to answers a real click or tap at the middle of what shows of
//   it. Chrome's input pipeline decides where a real click goes: a pointer captured by something
//   else, a layout change between press and release or something on top sends it elsewhere,
//   which an event dispatched to the control itself can't show;
// - while the computer runs, no control moves back and forth (text that grows may push it once),
//   so a tap can't land on whatever moved under the finger.
// With --url <address> it checks a deployed copy instead of the dev server, with --page <text>
// only the pages whose route has that text in it (--page microcode). SAMPLE=<n> tries n controls
// of each kind on a page (default 3). Needs Node 22+ and Chrome, Edge or Chromium.
import { createServer } from 'vite';
import { launchChrome, sleep } from './lib/chrome.mjs';

const urlAt = process.argv.indexOf('--url');
const url = urlAt > 0 ? process.argv[urlAt + 1]?.replace(/\/?$/, '/') : '';
if (urlAt > 0 && !/^https?:\/\//.test(url ?? '')) {
  console.error('--url needs an address, such as --url https://example.com/breadboard/');
  process.exit(2);
}
const SAMPLE = Number(process.env.SAMPLE ?? 3);
const pageAt = process.argv.indexOf('--page');
const onlyPage = pageAt > 0 ? process.argv[pageAt + 1] : '';
const MODES = {
  desktop: { metrics: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, input: 'a real click' },
  phone: { metrics: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }, touch: true, slop: 10, input: 'a real tap' },
};

// Before the app loads: note which elements get click and pointer listeners, and when they run.
const INSTRUMENT = `(() => {
  const TYPES = new Set(['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']);
  const wrappers = new WeakMap();
  const listening = new Map();
  window.__fired = [];
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const wrapperOf = (fn, type, o, make) => {
    if (!fn || (typeof fn !== 'function' && typeof fn.handleEvent !== 'function')) return fn;
    let m = wrappers.get(fn);
    if (!m) wrappers.set(fn, (m = new Map()));
    const k = type + (typeof o === 'boolean' ? o : !!o?.capture);
    if (!m.has(k) && make) m.set(k, function (e) {
      window.__fired.push({ el: e.currentTarget, type: e.type, trusted: e.isTrusted });
      return typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e);
    });
    return m.get(k) ?? fn;
  };
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (!TYPES.has(type) || !(this instanceof Element)) return add.call(this, type, fn, o);
    if (!listening.has(this)) listening.set(this, new Set());
    listening.get(this).add(type);
    return add.call(this, type, wrapperOf(fn, type, o, true), o);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    return remove.call(this, type, TYPES.has(type) ? wrapperOf(fn, type, o, false) : fn, o);
  };
  window.__typesOf = (e) => [...(listening.get(e) ?? [])];
  window.__listening = () => [...listening.keys()].filter((e) => e.isConnected);
  // where the control being tried is when the press arrives
  add.call(window, 'pointerdown', () => { const r = window.__trying?.getBoundingClientRect(); if (r) window.__pressedAt = [r.x, r.y]; }, true);
})();`;

const DESCRIBE = `(e) => {
  if (!e) return 'nothing';
  const cls = (typeof e.className === 'string' ? e.className : e.className?.baseVal ?? '').trim();
  const title = e.querySelector?.(':scope > title')?.textContent ?? e.getAttribute?.('title') ?? '';
  const text = (e.innerText ?? e.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 30);
  return e.tagName.toLowerCase() + (cls ? '.' + cls.split(/\\s+/).join('.') : '') + (title ? ' [' + title.slice(0, 40) + ']' : text ? ' "' + text + '"' : '');
}`;

// The controls to try, in page order: SAMPLE of each kind (tag and class, under the same kind of
// parent). Closed <details> are opened first, so what's in them is tried too.
const COLLECT = `(async () => {
  for (const d of document.querySelectorAll('details:not([open])')) d.open = true;
  await new Promise((r) => setTimeout(r, 300));
  const pathOf = (e) => {
    const steps = [];
    for (; e !== document.body; e = e.parentElement) steps.unshift('*:nth-child(' + ([...e.parentElement.children].indexOf(e) + 1) + ')');
    return 'body > ' + steps.join(' > ');
  };
  const kinds = new Map();
  for (const e of window.__listening()) {
    if (e.closest('[disabled]')) continue;
    const key = e.parentElement?.tagName + '>' + e.tagName + '.' + (typeof e.className === 'string' ? e.className : e.className?.baseVal);
    if (!kinds.has(key)) kinds.set(key, []);
    kinds.get(key).push(e);
  }
  const targets = [];
  for (const all of kinds.values()) {
    const step = Math.max(1, all.length / ${SAMPLE});
    for (let i = 0; i < all.length && i < ${SAMPLE} * step; i += step) targets.push({ e: all[Math.floor(i)], path: pathOf(all[Math.floor(i)]) });
  }
  targets.sort((a, b) => (a.e.compareDocumentPosition(b.e) & 4 ? -1 : 1));
  window.__targets = targets;
  // a control re-rendered since is found again by its place in the page
  window.__live = (i) => {
    const t = targets[i];
    const again = t.e.isConnected ? t.e : document.querySelector(t.path);
    if (again && window.__typesOf(again).length) t.e = again;
    return t.e;
  };
  return targets.length;
})()`;

// Scroll control i into view; where to click: the middle of what shows of it.
const PREPARE = (i, slop = 0) => `(async () => {
  if (!window.__targets) return { skip: 'reloaded' };
  const d = ${DESCRIBE};
  const e = window.__live(${i});
  if (!e.isConnected) return { skip: 'gone' };
  // stop what an earlier click set running, so nothing moves by itself during this one (that's
  // for STEADY): here a click must go where it's aimed
  for (const b of document.querySelectorAll('#content button')) if (b !== e && /^(Stop|Pause)$/.test(b.innerText.trim())) b.click();
  e.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = e.getBoundingClientRect();
  if ((!r.width && !r.height) || !e.checkVisibility({ visibilityProperty: true })) return { skip: 'hidden' };
  let box = { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(innerWidth, r.right), b: Math.min(innerHeight, r.bottom) };
  for (let a = e.parentElement; a; a = a.parentElement) {
    if (/visible/.test(getComputedStyle(a).overflow) && a.tagName !== 'svg') continue;
    const ar = a.getBoundingClientRect();
    box = { l: Math.max(box.l, ar.left), t: Math.max(box.t, ar.top), r: Math.min(box.r, ar.right), b: Math.min(box.b, ar.bottom) };
  }
  if (box.r - box.l < 1 || box.b - box.t < 1) return { skip: 'out of view' };
  const x = (box.l + box.r) / 2, y = (box.t + box.b) / 2;
  const hit = document.elementFromPoint(x, y);
  if (hit?.closest(':disabled')) return { skip: 'disabled' }; // no click, by design
  // a control inside it there (or, for a finger, within reach: Chrome moves a tap onto the nearest
  // control) gets the click instead, and is tried on its own
  const inner = (a) => a !== e && (window.__typesOf(a).length || a.matches('button, input, select, label, a[href]'));
  for (const a of [...e.querySelectorAll('*')].filter(inner)) {
    const ar = a.getBoundingClientRect();
    if (ar.width && x > ar.left - ${slop} && x < ar.right + ${slop} && y > ar.top - ${slop} && y < ar.bottom + ${slop}) return { skip: 'a control in the middle' };
  }
  window.__fired.length = 0;
  window.__trying = e;
  window.__pressedAt = null;
  const vp = e.closest('.bb-viewport');
  window.__before = { href: location.href, view: vp?.querySelector('svg')?.getAttribute('viewBox'), at: [r.x, r.y] };
  return { x, y, what: d(e), shared: !e.closest('#content'), inViewport: !!vp, covered: hit && !e.contains(hit) ? d(hit) : '' };
})()`;

// Which of control i's listeners ran for that click, and whether it zoomed or left the page.
const RESULT = (i) => `(() => {
  if (!window.__targets) return { reloaded: true, missed: [] };
  const e = window.__targets[${i}].e;
  const ran = new Set(window.__fired.filter((f) => f.el === e && f.trusted).map((f) => f.type));
  const vp = e.closest('.bb-viewport');
  const [x, y] = window.__pressedAt ?? window.__before.at;
  return {
    missed: window.__typesOf(e).filter((t) => !ran.has(t)),
    zoomed: !!vp && vp.querySelector('svg')?.getAttribute('viewBox') !== window.__before.view,
    // it moved before the press came (text growing above it); moving after is the press's doing
    early: Math.hypot(x - window.__before.at[0], y - window.__before.at[1]) > 2,
    left: location.href !== window.__before.href,
  };
})()`;

// Start the computer (where there is a Run button; some pages run a clock of their own), let the
// first change settle, then watch for 2.5 s which controls move back to where they were before.
const STEADY = `(async () => {
  const d = ${DESCRIBE};
  const content = document.getElementById('content');
  const run = [...content.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Run');
  run?.click();
  await new Promise((r) => setTimeout(r, 700));
  const controls = [...content.querySelectorAll('button, input, select, summary, [role=button], [tabindex], .sch-switch, .bb-hit')].filter((e) => e.checkVisibility());
  const boxes = [...content.querySelectorAll('*')].filter((e) => !(e instanceof SVGElement));
  const at = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.left + scrollX) + ',' + Math.round(r.top + scrollY); };
  const size = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
  const seen = new Map(controls.map((e) => [e, [at(e)]]));
  const sizes = new Map(boxes.map((e) => [e, [size(e)]]));
  const back = new Set(), resized = new Set();
  const t0 = performance.now();
  while (performance.now() - t0 < 2500) {
    await new Promise((r) => requestAnimationFrame(r));
    for (const [e, s] of seen) {
      const p = at(e);
      if (!e.isConnected || p === s[s.length - 1]) continue;
      if (s.includes(p)) back.add(e);
      s.push(p);
    }
    for (const [e, s] of sizes) {
      const z = size(e);
      if (!e.isConnected || z === s[s.length - 1]) continue;
      if (s.includes(z)) resized.add(e);
      s.push(z);
    }
  }
  if (run) [...content.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Stop')?.click();
  const inner = [...resized].filter((e) => ![...resized].some((o) => o !== e && e.contains(o)));
  return back.size ? \`\${back.size} of \${controls.length} controls move back and forth, such as \${[...back].slice(0, 3).map((e) => d(e) + ' (' + seen.get(e).slice(0, 3).join(' ') + ')').join(', ')}; changing size: \${inner.slice(0, 5).map((e) => d(e) + ' (' + sizes.get(e).slice(0, 3).join(' ') + ')').join(', ')}\` : '';
})()`;

/** Both checks on every page in one mode, in its own Chrome. */
async function checkMode(name, base) {
  const mode = MODES[name];
  const chrome = await launchChrome();
  const missed = [], moving = [], skipped = {};
  let tried = 0, loads = 0;
  try {
    const page = await chrome.newPage();
    for (const domain of ['Runtime', 'Page']) await page.send(`${domain}.enable`);
    page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}));
    await page.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });
    await page.send('Emulation.setDeviceMetricsOverride', mode.metrics);
    if (mode.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const press = async ({ x, y }) => {
      if (mode.touch) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await sleep(80);
    };
    const ev = (expr) => page.evaluate(expr).catch((e) => ({ skip: 'error', missed: [], error: e.message }));
    const open = async (route) => {
      await page.evaluate('localStorage.clear()').catch(() => {});
      await page.goto(`${base}?load=${++loads}${route}`, 1200); // a new query: a fresh load of the app
    };
    await open('#/');
    const routes = await page.evaluate(`['#/', '#/breadboard', '#/sandbox', '#/more', ...new Set([...document.querySelectorAll('.sidebar a[href^="#/lab/"]')].map((a) => a.getAttribute('href').split('/').slice(0, 3).join('/')))]`);
    const sharedDone = new Set();
    const pages = routes.filter((r) => r.includes(onlyPage));
    for (const route of pages) {
      await open(route);
      const count = await page.evaluate(COLLECT);
      for (let i = 0; i < count; i++) {
        let at = await ev(PREPARE(i, mode.slop));
        if (at.skip === 'reloaded') {
          await open(route);
          await page.evaluate(COLLECT);
          at = await ev(PREPARE(i, mode.slop));
        }
        if (!at.skip && at.shared && sharedDone.has(at.what)) continue; // top bar and sidebar: once
        if (!at.skip && mode.touch && at.inViewport) {
          // a tap on a zoomed-out board zooms in (on purpose), so zoom out first and tap twice
          await ev(`window.__live(${i}).closest('.bb-viewport').parentElement.querySelector('.bb-zoom button[title="Show everything"]')?.click()`);
          await sleep(400);
          at = await ev(PREPARE(i, mode.slop));
        }
        if (at.skip) {
          skipped[at.skip] = (skipped[at.skip] ?? 0) + 1;
          continue;
        }
        await press(at);
        let r = await ev(RESULT(i));
        // zoomed in by the tap, or pushed before the press by text growing above it (STEADY is
        // for that): again
        if ((r.zoomed || r.early) && r.missed.length) {
          await sleep(r.zoomed ? 700 : 300);
          const again = await ev(PREPARE(i, mode.slop));
          if (!again.skip) {
            await press((at = again));
            r = await ev(RESULT(i));
          }
        }
        tried++;
        if (r.missed.length) missed.push(`${route}  ${at.what}: its ${r.missed.join('/')} listener didn't run${at.covered ? `; ${at.covered} is on top` : ''}`);
        if (at.shared) sharedDone.add(at.what);
        if (r.reloaded || r.left || at.shared) {
          await open(route); // the sidebar may be open over the page now
          await page.evaluate(COLLECT);
        }
      }
      await open(route);
      const steady = await ev(STEADY);
      if (steady) moving.push(`${route}  ${steady.error ?? steady}`);
    }
    page.close();
    return { name, mode, pages: pages.length, tried, skipped, missed, moving };
  } finally {
    await chrome.close();
  }
}

const server = url ? null : await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 5175 } });
await server?.listen();
const base = url || server.resolvedUrls.local[0];
console.log(`Checking ${url ? 'the site' : 'the dev server'} at ${base} with real input (a few minutes)`);
const t0 = Date.now();
let failed = 0;
try {
  for (const r of await Promise.all(Object.keys(MODES).map((name) => checkMode(name, base)))) {
    const skips = Object.entries(r.skipped).map(([why, n]) => `${n} ${why}`).join(', ');
    const pages = `${r.pages} page${r.pages === 1 ? '' : 's'}`;
    console.log(`${r.name[0].toUpperCase() + r.name.slice(1)} (${r.mode.metrics.width} x ${r.mode.metrics.height})`);
    const report = (problems, ok) => {
      if (problems.length) failed++;
      console.log(problems.length ? `  FAIL  ${ok}\n        ${problems.join('\n        ')}` : `  ok    ${ok}`);
    };
    report(r.missed, `every control answers ${r.mode.input} (${r.tried} on ${pages}; skipped ${skips || 'none'})`);
    report(r.moving, `no control moves back and forth while the computer runs (${pages})`);
  }
} finally {
  await server?.close();
}
console.log(failed ? `\n${failed} of 4 checks failed (${Math.round((Date.now() - t0) / 1000)} s).` : `\nAll 4 checks passed (${Math.round((Date.now() - t0) / 1000)} s).`);
process.exit(failed ? 1 : 0);
