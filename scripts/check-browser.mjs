// Browser checks for what the unit tests can't see (npm run check:browser):
// every page renders without errors, phones get no sideways scrolling and fingertip-sized
// controls, the sticky toolbar, parts drawer and tap-to-zoom work, the two computer pages share
// one machine, sandbox links round-trip, and the breadboard view keeps its frame rate.
// With --dist it checks the built site instead (run `npm run build` first), plus the download
// link, install support and offline use. Needs Node 22+ and an installed Chrome, Edge or Chromium.
import { createServer, preview } from 'vite';
import { launchChrome, sleep } from './lib/chrome.mjs';

const dist = process.argv.includes('--dist');
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push(true);
    console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
  } catch (e) {
    results.push(false);
    console.log(`  FAIL  ${name}\n        ${String(e.message).replace(/\n/g, '\n        ')}`);
  }
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}

// Controls allowed below 24 px on phones, and why.
const SMALL_OK = [
  ['.cj-lab .quad rect', 'EEPROM map cells: a 16 x 16 grid across the phone'],
  ['.hexdec .seg', 'thin segments; a transparent stroke widens their hit area'],
];

const server = dist
  ? await preview({ logLevel: 'warn', preview: { host: '127.0.0.1', port: 4174 } })
  : await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 5174 } });
if (!dist) await server.listen();
const base = server.resolvedUrls.local[0];
console.log(`Checking ${dist ? 'the built site (dist/)' : 'the dev server'} at ${base}`);

const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  const errors = [];
  page.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
  page.on('Runtime.consoleAPICalled', (p) => p.type === 'error' && errors.push(p.args.map((a) => a.value ?? a.description).join(' ')));
  page.on('Log.entryAdded', (p) => p.entry.level === 'error' && errors.push(`${p.entry.text} ${p.entry.url ?? ''}`.trim()));
  for (const domain of ['Runtime', 'Log', 'Page', 'Network']) await page.send(`${domain}.enable`);

  const visitAll = async (routes, inspect) => {
    const problems = [];
    for (const route of routes) {
      const before = errors.length;
      const found = await page.evaluate(`(async () => {
        location.hash = ${JSON.stringify(route)};
        await new Promise((r) => setTimeout(r, 600));
        return (${inspect})();
      })()`);
      const errs = errors.slice(before);
      if (errs.length) problems.push(`${route}: ${errs.join(' | ')}`);
      if (found) problems.push(`${route}: ${found}`);
    }
    return problems;
  };

  // ---- desktop ------------------------------------------------------------------------
  console.log('Desktop (1280 x 800, mouse)');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.goto(base);
  const routes = await page.evaluate(`['#/', '#/breadboard', '#/sandbox', ...new Set([...document.querySelectorAll('.sidebar a[href^="#/lab/"]')].map((a) => a.getAttribute('href').split('/').slice(0, 3).join('/')))]`);

  await check(`every page renders without errors (${routes.length} pages)`, async () => {
    const problems = await visitAll(routes, `() => {
      const text = document.getElementById('content')?.innerText ?? '';
      return text.length < 80 || /Loading/.test(text.slice(0, 200)) ? 'nothing rendered' : '';
    }`);
    assert(!problems.length, problems.join('\n'));
  });

  if (dist) {
    await check('sidebar offers the zip download', async () => {
      const text = await page.evaluate(`document.querySelector('.nav-download')?.innerText.replace(/\\n/g, ' ')`);
      assert(text, 'no "Download for offline use" link');
      return text;
    });
  }

  await check('computer page and breadboard view share one computer', async () => {
    const r = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      location.hash = '#/'; await wait(800);
      const step = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Step instruction'));
      step.click(); step.click();
      const cycles = (s) => Number(s.match(/cycles (\\d+)/)[1]);
      const here = cycles(document.querySelector('.toolbar .status').textContent);
      location.hash = '#/breadboard'; await wait(1000);
      return { here, there: cycles(document.querySelector('.toolbar .status').textContent) };
    })()`);
    assert(r.here > 0 && r.there === r.here, `cycles ${r.here} on the computer page, ${r.there} on the breadboard view`);
    return `${r.here} cycles on both`;
  });

  await check('a sandbox link opens the same circuit', async () => {
    const r = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      localStorage.clear();
      location.hash = '#/sandbox'; await wait(1000);
      const parts = () => JSON.parse(localStorage.getItem('breadboard-sandbox-v1') || '{"parts":[]}').parts.length;
      const sel = document.querySelector('.toolbar select');
      sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(300);
      const made = parts();
      let link = '';
      navigator.clipboard.writeText = async (t) => { link = t; };
      const btn = (l) => [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === l);
      btn('Share link').click(); await wait(300);
      btn('Clear').click(); await wait(100);
      location.href = link; await wait(1200);
      return { made, loaded: parts(), hash: location.hash, length: link.length };
    })()`);
    assert(r.made > 0 && r.loaded === r.made, `${r.made} parts shared, ${r.loaded} loaded`);
    assert(r.hash === '#/sandbox', `the code stayed in the address (${r.hash.slice(0, 30)}…)`);
    return `${r.made} parts in a ${r.length}-character link`;
  });

  await check('breadboard view keeps its frame rate while running', async () => {
    const measure = async () => {
      await page.goto(`${base}#/breadboard`); // a fresh page: the 40 pages above leave garbage behind
      return page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const fps = (ms) => new Promise((res) => {
          let n = 0; const t0 = performance.now();
          (function f(t) { n++; if (t - t0 < ms) requestAnimationFrame(f); else res(Math.round(n / (ms / 1000))); })(t0);
        });
        location.hash = '#/breadboard'; await wait(1000);
        const pick = [...document.querySelectorAll('.bb-program select')].find((s) => [...s.options].some((o) => o.value === 'count-by-3'));
        pick.value = 'count-by-3'; pick.dispatchEvent(new Event('change', { bubbles: true })); await wait(200);
        const idle = await fps(1500);
        const input = document.querySelector('.toolbar .slider input');
        input.value = '1000'; input.dispatchEvent(new Event('input', { bubbles: true }));
        const btn = (l) => [...document.querySelectorAll('.toolbar button')].find((b) => b.innerText.trim() === l);
        btn('Run').click(); await wait(400);
        const running = Math.max(await fps(2000), await fps(2000)); // the better of two, against noise
        btn('Stop')?.click();
        return { idle, running };
      })()`);
    };
    // Before the fix it ran at ~20% of the idle rate (any LED change repainted the whole scene).
    // A busy machine can dip below 30% once, so a low result is measured again before failing.
    const ok = (r) => r.running >= 0.3 * r.idle;
    let r = await measure();
    const first = r;
    if (!ok(r)) r = await measure();
    assert(ok(r), `${r.running} fps running at 500 kHz, ${r.idle} fps idle: below 30% (twice; first ${first.running}/${first.idle})`);
    return `${r.running} fps running at 500 kHz, ${r.idle} idle${r === first ? '' : ` (measured again; first ${first.running}/${first.idle})`}`;
  });

  const vrPage = async () => {
    const r = await page.evaluate(`(async () => {
      const cycle = () => Number((document.getElementById('vr-status').textContent.match(/cycle (\\d+)/) ?? [])[1] ?? -1);
      const a = cycle();
      await new Promise((r) => setTimeout(r, 1500));
      return { counts: JSON.parse(document.body.dataset.ready ?? 'null'), a, b: cycle(), title: document.title };
    })()`);
    assert(r.counts?.chips === 49 && r.counts.leds > 80, `model: ${JSON.stringify(r.counts)}`);
    assert(r.b > r.a, `the clock did not run (cycle ${r.a} -> ${r.b})`);
    return r;
  };
  await check('VR view: the computer is built in 3D and runs', async () => {
    const before = errors.length;
    await page.goto(`${base}vr.html`, 3000);
    const r = await vrPage();
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return `${r.counts.chips} chips, ${r.counts.leds} LEDs, ${r.counts.meshes} meshes; cycle ${r.a} -> ${r.b}`;
  });

  // ---- phone --------------------------------------------------------------------------
  console.log('Phone (375 x 812, touch)');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(base); // reload, so touch layouts are chosen

  await check('phones: no page scrolls sideways, every control is at least 24 px', async () => {
    const problems = await visitAll(routes, `() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth) out.push('page is ' + document.documentElement.scrollWidth + ' px wide');
      const allowed = ${JSON.stringify(SMALL_OK.map(([sel]) => sel))};
      const clickable = (e) => e.matches('button, select, summary, label.toggle, [role=button], [role=switch]') || (e instanceof SVGElement && getComputedStyle(e).cursor === 'pointer');
      const small = new Map();
      for (const e of document.querySelectorAll('#content *')) {
        if (!clickable(e) || e.closest('.bb-viewport') || allowed.some((s) => e.matches(s))) continue;
        if (e.parentElement instanceof SVGElement && clickable(e.parentElement)) continue;
        const r = e.getBoundingClientRect();
        const px = Math.min(r.width, r.height);
        if (!px || px >= 24) continue;
        const cls = typeof e.className === 'string' ? e.className : e.className.baseVal;
        const key = e.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/)[0] : '');
        small.set(key, Math.min(small.get(key) ?? 99, Math.round(px)));
      }
      for (const [k, px] of small) out.push(k + ' is ' + px + ' px');
      return out.join(', ');
    }`);
    assert(!problems.length, problems.join('\n'));
    return `allowed smaller: ${SMALL_OK.map(([s, why]) => `${s} (${why})`).join('; ')}`;
  });

  await check('phones: the computer toolbar stays under the top bar', async () => {
    const r = await page.evaluate(`(async () => {
      location.hash = '#/'; await new Promise((r) => setTimeout(r, 800));
      scrollTo(0, 1500); await new Promise((r) => setTimeout(r, 200));
      const top = document.querySelector('.workbench-toolbar').getBoundingClientRect().top;
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      scrollTo(0, 0);
      return { top: Math.round(top), bar: Math.round(bar) };
    })()`);
    assert(Math.abs(r.top - r.bar) <= 2, `toolbar at ${r.top} px, top bar ends at ${r.bar} px`);
  });

  await check('phones: the sandbox parts drawer starts closed', async () => {
    const r = await page.evaluate(`(async () => {
      location.hash = '#/sandbox'; await new Promise((r) => setTimeout(r, 1000));
      return { open: document.querySelector('.sb-drawer').open, board: Math.round(document.querySelector('.bb-viewport').getBoundingClientRect().top + scrollY) };
    })()`);
    assert(!r.open, 'drawer is open');
    assert(r.board < 520, `board starts ${r.board} px down`);
    return `board starts ${r.board} px down`;
  });

  await check('phones: a tap on the zoomed-out breadboard zooms in instead of flipping a switch', async () => {
    const r = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      location.hash = '#/breadboard'; await wait(1000);
      const svg = document.querySelector('.bb-svg');
      svg.closest('.bb-viewport').scrollIntoView({ block: 'center' }); await wait(200);
      const pxPerUnit = () => svg.closest('.bb-viewport').getBoundingClientRect().width / Number(svg.getAttribute('viewBox').split(' ')[2]);
      const run = () => [...document.querySelectorAll('.toolbar button')].find((b) => /^(Run|Stop)$/.test(b.innerText.trim()))?.innerText.trim();
      const slide = [...document.querySelectorAll('.bb-slide')].find((g) => g.querySelector('title')?.textContent.includes('SW2'));
      const hit = slide.querySelector('.bb-hit');
      const tap = () => {
        const r = hit.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
        hit.dispatchEvent(new PointerEvent('pointerdown', o));
        hit.dispatchEvent(new PointerEvent('pointerup', o));
        hit.dispatchEvent(new MouseEvent('click', o));
      };
      const before = { zoom: pxPerUnit(), run: run() };
      tap(); await wait(1200);
      const zoomed = { zoom: pxPerUnit(), run: run() };
      tap(); await wait(300);
      return { before, zoomed, after: run() };
    })()`);
    assert(r.zoomed.zoom >= 20 && r.before.zoom < 20, `zoom ${r.before.zoom.toFixed(1)} -> ${r.zoomed.zoom.toFixed(1)} px per hole`);
    assert(r.zoomed.run === r.before.run, 'the first tap flipped the switch');
    assert(r.after !== r.zoomed.run, 'the second tap did not flip the switch');
    return `${r.before.zoom.toFixed(1)} -> ${r.zoomed.zoom.toFixed(1)} px per hole, then the switch flips`;
  });

  // ---- built site: install and offline ---------------------------------------------------
  if (dist) {
    console.log('Install and offline');
    await check('Chrome can install it as an app', async () => {
      await page.goto(base);
      await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
      const { installabilityErrors } = await page.send('Page.getInstallabilityErrors');
      assert(!installabilityErrors.length, installabilityErrors.map((e) => e.errorId).join(', '));
    });
    await check('it works offline after the first visit', async () => {
      await page.goto(base); // now controlled by the service worker
      assert(await page.evaluate('!!navigator.serviceWorker.controller'), 'the service worker does not control the page');
      await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      try {
        await page.goto(`${base}#/breadboard`, 2000);
        const r = await page.evaluate(`({ title: document.title, chips: document.querySelectorAll('.bb-chip').length })`);
        assert(r.chips > 40, `offline: "${r.title}", ${r.chips} chips drawn`);
        await page.goto(`${base}vr.html`, 3000);
        const vr = await vrPage();
        return `"${r.title}" with ${r.chips} chips, and "${vr.title}", offline`;
      } finally {
        await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      }
    });
  }
  page.close();
} finally {
  await chrome.close();
  await (server.close?.() ?? server.httpServer?.close());
}

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
