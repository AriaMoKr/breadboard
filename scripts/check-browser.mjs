// Browser checks for what the unit tests can't see (npm run check:browser):
// every page renders without errors, phones get no sideways scrolling and fingertip-sized
// controls, the sticky toolbar, parts drawer and tap-to-zoom work, the two computer pages share
// one machine, sandbox links round-trip, the breadboard view keeps its frame rate, and the VR
// view builds the computer, runs it and answers the mouse on its boards' switches and buttons.
// With --dist it checks the built site instead (run `npm run build` first), plus the download
// link, install support and offline use; with --url <address> it checks a deployed copy the same
// way, such as https://example.com/breadboard/. Needs Node 22+ and an installed Chrome, Edge or
// Chromium.
import { createServer, preview } from 'vite';
import { launchChrome, sleep } from './lib/chrome.mjs';

const urlAt = process.argv.indexOf('--url');
const url = urlAt > 0 ? process.argv[urlAt + 1]?.replace(/\/?$/, '/') : '';
if (urlAt > 0 && !/^https?:\/\//.test(url ?? '')) {
  console.error('--url needs an address, such as --url https://example.com/breadboard/');
  process.exit(2);
}
const dist = process.argv.includes('--dist') || !!url;
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

const server = url
  ? null
  : dist
    ? await preview({ logLevel: 'warn', preview: { host: '127.0.0.1', port: 4174 } })
    : await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 5174 } });
if (!dist) await server.listen();
const base = url || server.resolvedUrls.local[0];
console.log(`Checking ${url ? 'the site' : dist ? 'the built site (dist/)' : 'the dev server'} at ${base}`);

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

  // Real mouse events (Chrome's input pipeline) for what a dispatched event can't show: which
  // element the click goes to, after a drag or a pointer capture.
  const mouse = (type, { x, y }, extra = {}) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (p, clickCount = 1) => {
    await mouse('mouseMoved', p, { button: 'none', buttons: 0 });
    await mouse('mousePressed', p, { clickCount });
    await mouse('mouseReleased', p, { clickCount });
    await sleep(60);
  };

  // In the sandbox: the saved board's parts, a tool by its title, a hole and an element on the screen.
  const emptySandbox = async () => {
    await page.goto(`${base}#/sandbox`);
    await page.evaluate(`localStorage.removeItem('breadboard-sandbox-v1'); location.reload()`);
    await sleep(1500);
  };
  const saved = () => page.evaluate(`JSON.parse(localStorage.getItem('breadboard-sandbox-v1') || '{"parts":[]}').parts`);
  const parts = async () => (await saved()).map((p) => p.kind).join(' ');
  const centre = (selector) => page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  const tool = async (title) => click(await centre(`.sb-tool[title^="${title}"]`));
  const ROW_Y = { tn: 0.9, tp: 1.9, a: 3.5, b: 4.5, c: 5.5, d: 6.5, e: 7.5, f: 10.5, g: 11.5, h: 12.5, i: 13.5, j: 14.5, bp: 16.1, bn: 17.1 }; // geometry.ts
  const hole = (row, col) => page.evaluate(`(() => {
    const svg = document.querySelector('.bb-svg'), p = svg.createSVGPoint();
    p.x = ${col + 0.5}; p.y = ${ROW_Y[row]};
    const s = p.matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  })()`);

  await check('sandbox: a click on a hole places the part in hand, a drag pans instead', async () => {
    await emptySandbox();
    await tool('74LS00');
    await click(await hole('f', 10));
    const chip = await parts();
    assert(chip === 'chip', `a click on f10 with the 74LS00 in hand placed: "${chip}"`);
    await tool('red wire');
    await click(await hole('a', 3));
    await click(await hole('a', 8));
    const wire = await parts();
    assert(wire === 'chip wire', `two clicks with a wire in hand placed: "${wire}"`);
    // a drag from a hole pans the board and places nothing
    const from = await hole('a', 20);
    await mouse('mouseMoved', from, { button: 'none', buttons: 0 });
    await mouse('mousePressed', from);
    for (let dx = 10; dx <= 80; dx += 10) await mouse('mouseMoved', { x: from.x + dx, y: from.y });
    await mouse('mouseReleased', { x: from.x + 80, y: from.y });
    await sleep(60);
    const moved = (await hole('a', 20)).x - from.x;
    const dragged = await parts();
    assert(Math.abs(moved - 80) < 2, `an 80 px drag moved the board ${moved.toFixed(1)} px`);
    assert(dragged === 'chip wire', `the drag placed something: "${dragged}"`);
    await tool('Slide switch');
    await click(await hole('a', 30));
    await tool('4-position DIP');
    await click(await hole('f', 40));
    const switches = await parts();
    assert(switches === 'chip wire slide dip', `a slide and a DIP switch by clicks: "${switches}"`);
    // Delete takes switches too, whose own click handlers would flip them
    await tool('Remove parts');
    for (const part of ['[data-part^="U"]', '.bb-slide', '.bb-dip']) await click(await centre(`.bb-svg ${part}`));
    const left = await parts();
    assert(left === 'wire', `clicks on the chip and the switches with Delete left: "${left}"`);
    return 'a 74LS00, a wire and two switches by clicks, an 80 px pan, the chip and switches deleted';
  });

  await check('sandbox: switches stay where they were set when the circuit changes', async () => {
    await emptySandbox();
    await tool('Slide switch');
    await click(await hole('a', 30));
    await tool('4-position DIP');
    await click(await hole('f', 40));
    const knobs = () => page.evaluate(`[...document.querySelectorAll('.bb-svg .bb-slide-knob, .bb-svg .bb-dip-knob')].map((k) => k.getAttribute('x') + ',' + k.getAttribute('y')).join(' ')`);
    const before = await knobs();
    await tool('Operate switches');
    await click(await centre('.bb-svg .bb-slide .bb-hit'));
    await click(await centre('.bb-svg .bb-dip .bb-hit'));
    const flipped = await knobs();
    assert(flipped !== before, 'the clicks flipped neither switch');
    await tool('red wire'); // a change to the circuit: the board and the simulator are built anew
    await click(await hole('a', 3));
    await click(await hole('a', 8));
    const after = await knobs();
    assert(after === flipped, `placing a wire put the switches back: ${flipped} -> ${after}`);
    await tool('Operate switches');
    await click(await centre('.bb-svg .bb-slide .bb-hit'));
    await click(await centre('.bb-svg .bb-dip .bb-hit'));
    const back = await knobs();
    assert(back === before, `the next clicks didn't flip them back: ${before} -> ${back}`);
    return 'a slide and a DIP switch flipped, kept through a new wire, flipped back';
  });

  await check('sandbox: Step pauses the circuit and moves it on to the next change', async () => {
    await emptySandbox();
    await page.evaluate(`(() => {
      const pick = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'counter'));
      pick.value = 'counter'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    const state = () => page.evaluate(`({
      t: Number(document.querySelector('.toolbar span[title^="Time in the simulation"]').textContent.replace(/[^0-9]/g, '')),
      leds: [...document.querySelectorAll('.bb-svg [data-part^="D"]')].map((g) => +g.classList.contains('on')).join(''),
      run: [...document.querySelectorAll('.toolbar button')].find((b) => /^(Pause|Run)$/.test(b.innerText.trim())).innerText.trim(),
      status: document.querySelector('.sb-status').textContent,
    })`);
    const stepButton = await page.evaluate(`(() => {
      const r = [...document.querySelectorAll('.toolbar button')].find((b) => b.innerText.trim() === 'Step').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await click(stepButton);
    const first = await state();
    assert(first.run === 'Run', `Step left it running (the button says ${first.run})`);
    assert(/^Step: \d+ nets? changed/.test(first.status), `after Step: "${first.status}"`);
    await sleep(300);
    const still = await state();
    assert(still.t === first.t, `paused, the time went on: ${first.t} -> ${still.t}`);
    // the S key steps too; the 555's next edge is at most a half period away, the LEDs follow
    let steps = 0, now = still;
    while (now.leds === first.leds && steps < 400) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', text: 's' });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS' });
      steps++;
      now = await state();
    }
    assert(now.leds !== first.leds, `${steps} steps from t = ${first.t} to ${now.t} changed no LED (${now.leds})`);
    return `t = ${first.t} after Step, held while paused; ${steps} steps (S key) to t = ${now.t}, LEDs ${first.leds} -> ${now.leds}`;
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

  await check('VR view: the switches, buttons and pot on the boards work with the mouse', async () => {
    // real mouse events, aimed with the page's breadboardVR.screenPoint
    const at = (part, bit) => page.evaluate(`breadboardVR.screenPoint(${JSON.stringify(part)}${bit === undefined ? '' : `, ${bit}`})`);
    const state = () => page.evaluate(`(() => { const m = breadboardVR.machine, c = m.computer; return { mode: m.mode, cycles: c.cycles, data: c.dipData, hz: m.hz }; })()`);
    const s0 = await state();
    // From the home view: data switches 1 and 8 on the RAM board (each about 3 px wide here).
    await click(await at('ram/SW3', 0));
    await click(await at('ram/SW3', 7));
    const s1 = await state();
    assert((s0.data ^ s1.data) === 0x81, `SW3 switches 1 and 8 changed the data switches from ${s0.data} to ${s1.data}`);
    // Double-click the clock board's pot to look closer, then switch to manual and step twice.
    const pot = await at('clock/RV1');
    await click(pot);
    await click(pot, 2);
    await sleep(600);
    const near = await at('clock/RV1');
    assert(Math.hypot(near.x - pot.x, near.y - pot.y) > 20, 'double-clicking the board did not move the view closer');
    await click(await at('clock/SW2'));
    const s2 = await state();
    assert(s0.mode === 'auto' && s2.mode === 'manual', `SW2 left the clock in ${s2.mode} mode`);
    await click(await at('clock/SW1'));
    await click(await at('clock/SW1'));
    const s3 = await state();
    assert(s3.cycles === s2.cycles + 2, `two presses of SW1 ran ${s3.cycles - s2.cycles} clock cycles`);
    // Drag the pot down: faster, and the view stays put.
    await mouse('mouseMoved', near, { button: 'none', buttons: 0 });
    await mouse('mousePressed', near);
    for (let dy = 5; dy <= 45; dy += 5) await mouse('mouseMoved', { x: near.x, y: near.y + dy });
    await mouse('mouseReleased', { x: near.x, y: near.y + 45 });
    await sleep(300);
    const s4 = await state();
    const after = await at('clock/RV1');
    assert(s4.hz > s3.hz, `dragging RV1 down took the clock from ${s3.hz} to ${s4.hz} Hz`);
    assert(Math.hypot(after.x - near.x, after.y - near.y) < 1, 'dragging the pot also turned the view');
    return `SW3 switches, SW2 to manual, SW1 x2 = 2 cycles, RV1 ${s3.hz} -> ${Math.round(s4.hz)} Hz`;
  });

  await check('VR view: a sandbox circuit opens from the sandbox and runs, buttons and all', async () => {
    const before = errors.length;
    await page.goto(`${base}#/sandbox`);
    await page.evaluate(`(async () => {
      const pick = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'sr-latch'));
      pick.value = 'sr-latch'; pick.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('View in VR')).click();
    })()`);
    await sleep(3000); // vr.html loads
    const opened = await page.evaluate(`({ url: location.pathname + location.hash.slice(0, 4), ready: JSON.parse(document.body.dataset.ready ?? 'null') })`);
    assert(opened.url.endsWith('vr.html#c1.') && opened.ready?.exhibit === 'circuit' && opened.ready.chips === 1 && opened.ready.leds === 2, `opened ${opened.url}: ${JSON.stringify(opened.ready)}`);
    // S (SW1) sets the latch: Q (D1) on
    const lit = (id) => page.evaluate(`breadboardVR.exhibit.sim().ledLit(${JSON.stringify(id)})`);
    const q0 = await lit('D1');
    const s = await page.evaluate(`breadboardVR.screenPoint('SW1')`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: s.x, y: s.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    const q1 = await lit('D1');
    assert(!q0 && q1, `pressing S took Q from ${q0} to ${q1}`);
    // another exhibit by its link: the counter example counts by itself
    const counting = await page.evaluate(`(async () => {
      location.hash = '#example/counter';
      await new Promise((r) => setTimeout(r, 800));
      const leds = () => breadboardVR.exhibit.layout.parts.filter((p) => p.kind === 'led').map((p) => +breadboardVR.exhibit.sim().ledLit(p.id)).join('');
      const seen = new Set();
      for (let i = 0; i < 20; i++) { seen.add(leds()); await new Promise((r) => setTimeout(r, 100)); }
      return { ready: JSON.parse(document.body.dataset.ready), title: document.title, seen: seen.size };
    })()`);
    assert(counting.ready.exhibit === 'example/counter' && counting.seen > 2, `counter: ${JSON.stringify(counting)}`);
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return `SR latch from the sandbox: S lit Q; "${counting.title}" showed ${counting.seen} LED patterns in 2 s`;
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

  await check('phones: in the sandbox a tap zooms in, the next tap on a hole places the part', async () => {
    await page.evaluate(`localStorage.removeItem('breadboard-sandbox-v1'); location.hash = '#/sandbox'; location.reload()`);
    await sleep(1500);
    // real taps (Chrome's input pipeline: touch, pointer and click events)
    const tap = async (p) => {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(500);
    };
    const centre = (selector) => page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    const f10 = () => page.evaluate(`(() => {
      const svg = document.querySelector('.bb-svg'), p = svg.createSVGPoint();
      p.x = 10.5; p.y = 10.5; // geometry.ts
      const s = p.matrixTransform(svg.getScreenCTM());
      return { x: s.x, y: s.y, pxPerHole: svg.getScreenCTM().a };
    })()`);
    await tap(await centre('.sb-drawer summary'));
    await tap(await centre('.sb-tool[title^="74LS00"]'));
    await centre('.bb-viewport');
    const far = await f10();
    await tap(far);
    const near = await f10();
    const parts = () => page.evaluate(`JSON.parse(localStorage.getItem('breadboard-sandbox-v1') || '{"parts":[]}').parts.map((p) => p.kind).join(' ')`);
    const zoomed = await parts();
    assert(near.pxPerHole >= 20 && far.pxPerHole < 20, `the first tap zoomed ${far.pxPerHole.toFixed(1)} -> ${near.pxPerHole.toFixed(1)} px per hole`);
    assert(zoomed === '', `the zooming tap placed: "${zoomed}"`);
    await tap(near);
    const placed = await parts();
    assert(placed === 'chip', `a tap on f10 with the 74LS00 in hand placed: "${placed}"`);
    return `${far.pxPerHole.toFixed(1)} -> ${near.pxPerHole.toFixed(1)} px per hole, then a 74LS00 on f10`;
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
  if (server) await (server.close?.() ?? server.httpServer?.close());
}

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
