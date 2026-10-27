// Browser checks for what the unit tests can't see (npm run check:browser):
// every page renders without errors, phones get no sideways scrolling and fingertip-sized
// controls, the sticky toolbar, parts drawer and tap-to-zoom work, the two computer pages share
// one machine, sandbox links round-trip, the breadboard view keeps its frame rate, and the VR
// view builds the computer, runs it and answers the mouse on its boards' switches and buttons,
// answers a gamepad and a TV's remote (?tv=emulate), and axe-core finds no accessibility problem
// (WCAG 2.2 AA and its best practices) on any page.
// With --dist it checks the built site instead (run `npm run build` first), plus the download
// link, install support and offline use; with --url <address> it checks a deployed copy the same
// way, such as https://example.com/breadboard/. --only <text> runs just the checks whose names
// have it. Needs Node 22+ and an installed Chrome, Edge or Chromium.
import { readFileSync } from 'node:fs';
import { createServer, preview } from 'vite';
import { launchChrome, sleep } from 'common/tools/chrome.mjs';

const urlAt = process.argv.indexOf('--url');
const url = urlAt > 0 ? process.argv[urlAt + 1]?.replace(/\/?$/, '/') : '';
if (urlAt > 0 && !/^https?:\/\//.test(url ?? '')) {
  console.error('--url needs an address, such as --url https://example.com/breadboard/');
  process.exit(2);
}
const dist = process.argv.includes('--dist') || !!url;
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt > 0 ? (process.argv[onlyAt + 1] ?? '') : '';
const results = [];
async function check(name, fn) {
  if (only && !name.includes(only)) return;
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
  // (not the dev server's own: Chrome closing Vite's live-reload socket as a page goes into the back-forward cache)
  page.on('Log.entryAdded', (p) => p.entry.level === 'error' && !/^WebSocket .* Page entered Back-Forward Cache/.test(p.entry.text) && errors.push(`${p.entry.text} ${p.entry.url ?? ''}`.trim()));
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
  const routes = await page.evaluate(`['#/', '#/breadboard', '#/sandbox', '#/more', ...new Set([...document.querySelectorAll('.sidebar a[href^="#/lab/"]')].map((a) => a.getAttribute('href').split('/').slice(0, 3).join('/')))]`);

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

  await check('sandbox: Move drags parts, moves a wire or just one end, and leaves switches as set', async () => {
    await emptySandbox();
    await tool('74LS00');
    await click(await hole('f', 10));
    await tool('red wire');
    await click(await hole('a', 3));
    await click(await hole('a', 12));
    await tool('Slide switch');
    await click(await hole('a', 30));
    const knob = () => page.evaluate(`document.querySelector('.bb-svg .bb-slide-knob').getAttribute('x')`);
    const knob0 = await knob();
    const drag = async (from, to) => {
      await mouse('mouseMoved', from, { button: 'none', buttons: 0 });
      await mouse('mousePressed', from);
      for (let i = 1; i <= 8; i++) await mouse('mouseMoved', { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 });
      await mouse('mouseReleased', to);
      await sleep(80);
    };
    const by = async (p, rows, cols) => { // a point moved by whole rows and columns
      const a = await hole('a', 10), b = await hole(rows === 2 ? 'c' : 'a', 10 + cols);
      return { x: p.x + b.x - a.x, y: p.y + b.y - a.y };
    };
    const get = async (prefix) => (await saved()).find((p) => p.id.startsWith(prefix));
    await tool('Move parts');
    // the chip, dragged ten columns to the right
    const chipAt = await centre('.bb-svg [data-part^="U"]');
    await drag(chipAt, await by(chipAt, 0, 10));
    const chip = await get('U');
    assert(chip.col === 20, `the chip dragged ten columns went to column ${chip.col}`);
    // one end of the wire: a click on it, a click on the new hole
    await click(await hole('a', 12));
    await click(await hole('a', 15));
    const end = await get('W');
    assert(end.a === 'a3' && end.b === 'a15', `the end at a12 put on a15 made the wire ${end.a}-${end.b}`);
    // the whole wire: picked up between its ends, put down two rows lower
    const mid = await page.evaluate(`(() => { const r = document.querySelector('.bb-svg [data-part^="W"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await click(mid);
    await click(await by(mid, 2, 0));
    const whole = await get('W');
    assert(whole.a === 'c3' && whole.b === 'c15', `the wire put two rows lower went to ${whole.a}-${whole.b}`);
    // a switch is dragged, not flipped
    const slideAt = await centre('.bb-svg .bb-slide');
    await drag(slideAt, await by(slideAt, 0, 10));
    const slide = await get('SW');
    assert(slide.a === 'a40' && (await knob()) === knob0, `the slide switch went to ${slide.a} (knob ${knob0} -> ${await knob()})`);
    // Esc puts back what is in hand; Undo takes a move back
    await click(await centre('.bb-svg [data-part^="U"]'));
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await click(await hole('f', 40));
    assert((await get('U')).col === 20, 'the chip moved after Esc');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2 });
    await sleep(80);
    assert((await get('SW')).a === 'a30', 'Undo did not take the switch back');
    return 'a chip dragged, a wire end and a whole wire moved by clicks, a switch dragged unflipped, Esc and Undo';
  });

  await check('sandbox: Step pauses the circuit and moves it on to the next change', async () => {
    await emptySandbox();
    await page.evaluate(`(() => {
      const pick = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'counter'));
      pick.value = 'counter'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    const state = () => page.evaluate(`({
      t: Number(/t = ([0-9,]+)/.exec(document.querySelector('.sb-status').textContent)?.[1].replace(/,/g, '') ?? NaN),
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
    assert(/^Step: \d+ nets? changed, .* on · t = [0-9,]+$/.test(first.status), `after Step: "${first.status}"`);
    await sleep(500); // running, the counter's LEDs change several times in that
    const still = await state();
    assert(still.leds === first.leds, `paused, the LEDs went on: ${first.leds} -> ${still.leds}`);
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

  await check('VR view: the wires between boards show and hide by kind, on the panel and in the Wires menu', async () => {
    // As the breadboard view's "Wires between boards": the bus at first, then a real click on the
    // wires panel's Data, and on the Bus checkbox in the bar's Wires menu; a sandbox circuit has none.
    const before = errors.length;
    const click = async (at) => {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await sleep(300);
    };
    const rectOf = (sel) => page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const state = () => page.evaluate(`({ links: breadboardVR.links, panel: breadboardVR.panelLabels().filter((l) => /^(Bus|Clock|Control|Data):/.test(l)), menu: [...document.querySelectorAll('.vr-wires input')].filter((i) => i.checked).map((i) => i.value) })`);
    await page.goto(`${base}vr.html`, 3000);
    const s0 = await state();
    const n = await page.evaluate('JSON.parse(document.body.dataset.ready).links');
    assert(JSON.stringify(s0.links) === '{"bus":true,"clock":false,"control":false,"data":false}' && s0.menu.join() === 'bus' && n > 100, `at first: ${JSON.stringify(s0)}, ${n} wires`);
    const at = await page.evaluate(`(breadboardVR.look([0.55, 1.35, 0.15], [1.05, 1.15, -0.45]), breadboardVR.panelPoint('Data: Off'))`);
    assert(at, 'no "Data: Off" on the wires panel');
    const under = await page.evaluate(`document.elementFromPoint(${at.x}, ${at.y})?.tagName`);
    assert(under === 'CANVAS', `the wires panel's Data is under a ${under}`);
    await click(at);
    const s1 = await state();
    assert(s1.links.data && s1.panel.includes('Data: On') && s1.menu.join() === 'bus,data', `after Data on the panel: ${JSON.stringify(s1)}`);
    await click(await rectOf('.vr-wires > summary'));
    await click(await rectOf('.vr-wires input[value=bus]'));
    const s2 = await state();
    assert(!s2.links.bus && s2.panel.includes('Bus: Off') && s2.menu.join() === 'data', `after Bus in the menu: ${JSON.stringify(s2)}`);
    await page.goto(`${base}vr.html#example/counter`, 3000);
    const none = await page.evaluate(`({ links: breadboardVR.links, hidden: document.querySelector('.vr-wires').hidden, panel: breadboardVR.panelLabels().some((l) => /^(Bus|Data):/.test(l)) })`);
    assert(JSON.stringify(none.links) === '{}' && none.hidden && !none.panel, `a sandbox circuit: ${JSON.stringify(none)}`);
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return `${n} wires in four kinds, the bus at first; Data on from the panel, Bus off from the menu; none for a sandbox circuit`;
  });

  await check('VR view: a gamepad looks, walks, rises, presses what its dot is on, and hands back to the mouse', async () => {
    // A stand-in pad (navigator.getGamepads, standard mapping) on a screen: the right stick looks,
    // the left one walks, the right trigger rises, B flies home, A presses what the dot in the
    // middle is on (aimed with breadboardVR.face, as the right stick would) and turns a pot held
    // with the right stick; a real mouse move hands the view back.
    const before = errors.length;
    await page.goto(`${base}vr.html`, 3000);
    await page.evaluate(`(() => {
      const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      window.testPad = pad;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
      dispatchEvent(new Event('gamepadconnected'));
    })()`);
    const view = () => page.evaluate(`(() => { const c = breadboardVR.camera, d = c.getWorldDirection(c.position.clone()), dot = document.querySelector('.vr-aim'); return { eye: c.position.toArray(), yaw: Math.atan2(-d.x, -d.z), pad: breadboardVR.pad, dot: !dot.hidden && dot.classList.contains('on') ? 'on' : !dot.hidden ? 'shown' : 'hidden', hint: document.querySelector('.vr-hint').textContent }; })()`);
    const state = () => page.evaluate(`(() => { const m = breadboardVR.machine; return { mode: m.mode, cycles: m.computer.cycles, hz: m.hz, data: breadboardVR.links.data }; })()`);
    const axes = (a) => page.evaluate(`testPad.axes = ${JSON.stringify(a)}`);
    const button = (i, v) => page.evaluate(`testPad.buttons[${i}] = { pressed: ${v > 0.5}, touched: ${v > 0}, value: ${v} }`);
    const hold = async (set, ms) => {
      await set(1);
      await sleep(ms);
      await set(0);
      await sleep(150);
    };
    const v0 = await view();
    assert(!v0.pad.active && v0.dot === 'hidden' && !v0.hint.startsWith('Gamepad'), `before the pad is used: ${JSON.stringify(v0)}`);
    await hold((v) => axes([0, 0, v, 0]), 400); // the right stick, right
    const v1 = await view();
    assert(v1.pad.active && v1.dot !== 'hidden' && v1.hint.startsWith('Gamepad') && v1.yaw < v0.yaw - 0.5, `after the right stick: ${JSON.stringify(v1)}`);
    await hold((v) => axes([0, -v, 0, 0]), 500); // the left stick, forward
    const v2 = await view();
    const [dx, dz] = [v2.eye[0] - v1.eye[0], v2.eye[2] - v1.eye[2]];
    const ahead = -Math.sin(v1.yaw) * dx - Math.cos(v1.yaw) * dz;
    assert(ahead > 0.3 && Math.hypot(dx, dz) < ahead * 1.05, `the left stick walked (${dx.toFixed(2)}, ${dz.toFixed(2)}) facing ${v1.yaw.toFixed(2)}`);
    await hold((v) => button(7, v), 300); // the right trigger
    const v3 = await view();
    assert(v3.eye[1] > v2.eye[1] + 0.1, `the right trigger took the eye from ${v2.eye[1]} to ${v3.eye[1]} m`);
    await hold((v) => button(1, v), 150); // B
    await sleep(900);
    const v4 = await view();
    assert(Math.hypot(...v4.eye.map((x, i) => x - v0.eye[i])) < 0.01 && Math.abs(v4.yaw - v0.yaw) < 0.01, `B went to ${JSON.stringify(v4.eye)}, not home ${JSON.stringify(v0.eye)}`);
    // A on the clock's switch, twice on its button, and held on its pot while the right stick turns it
    const s0 = await state();
    const aim = async (what) => {
      assert(await page.evaluate(`breadboardVR.face(${JSON.stringify(what)})`), `no ${what}`);
      await sleep(150);
      const v = await view();
      assert(v.pad.on === what && v.dot === 'on', `aimed at ${what}, the dot is on ${v.pad.on} (${v.dot})`);
    };
    await aim('clock/SW2');
    await hold((v) => button(0, v), 150);
    const manual = await state();
    await aim('clock/SW1');
    await hold((v) => button(0, v), 150);
    await hold((v) => button(0, v), 150);
    const s1 = await state();
    assert(s0.mode === 'auto' && manual.mode === 'manual' && s1.cycles === manual.cycles + 2, `A on SW2 and twice on SW1: ${JSON.stringify(s0)} -> ${JSON.stringify(manual)} -> ${JSON.stringify(s1)}`);
    await aim('clock/RV1');
    const v5 = await view();
    await button(0, 1);
    await sleep(100);
    await hold((v) => axes([0, 0, -v, 0]), 400);
    const held = (await view()).pad.holding;
    await button(0, 0);
    await sleep(150);
    const s2 = await state();
    const v6 = await view();
    assert(held && s2.hz !== s1.hz && Math.abs(v6.yaw - v5.yaw) < 1e-6, `A held on RV1 and the right stick: ${s1.hz} -> ${s2.hz} Hz, held ${held}, the view turned ${v6.yaw - v5.yaw}`);
    // A on the wires panel's Data
    await page.evaluate(`breadboardVR.look([0.55, 1.35, 0.15], [1.05, 1.15, -0.45])`);
    await aim('Data: Off');
    await hold((v) => button(0, v), 150);
    const s3 = await state();
    assert(s3.data, 'A on "Data: Off" left the data wires hidden');
    // a real mouse move hands the view back
    for (const x of [300, 320]) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 300, button: 'none', buttons: 0 });
    await sleep(150);
    const v7 = await view();
    assert(!v7.pad.active && v7.dot === 'hidden' && !v7.hint.startsWith('Gamepad'), `after the mouse moved: ${JSON.stringify(v7)}`);
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return `looked ${(v0.yaw - v1.yaw).toFixed(2)} rad, walked ${ahead.toFixed(2)} m, rose ${(v3.eye[1] - v2.eye[1]).toFixed(2)} m, B home; A: SW2 to manual, SW1 x2 = 2 cycles, RV1 ${Math.round(s1.hz)} -> ${Math.round(s2.hz)} Hz, Data on; the mouse took it back`;
  });

  // The Hallway's TV app's page (common's tv.js, README "The TV app"), in this browser with
  // ?tv=emulate: 960 x 540 at a pixel ratio of 2, and real key presses as the remote sends them
  // (WebView's keys come with an empty code). hallwayTV.back() and .menu() are what the app calls
  // on Back and Menu; in the card (the bar) Escape stands in for Back.
  const VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27 };
  /** The remote's key `key`, held `ms`: OK is Enter, which also types a return (a button's click). */
  const remoteKey = async (key, ms = 60) => {
    const k = { key, code: key === 'Escape' ? 'Escape' : '', windowsVirtualKeyCode: VK[key], nativeVirtualKeyCode: VK[key] };
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await sleep(ms);
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    await sleep(150);
  };
  const tvView = () =>
    page.evaluate(`(() => {
      const c = breadboardVR.camera, d = c.getWorldDirection(c.position.clone()), dot = document.querySelector('.vr-aim'), a = document.activeElement;
      const focus = a === document.querySelector('#vr-root canvas') ? 'view' : a === document.body ? 'none' : (a.type === 'checkbox' || a.type === 'radio' ? a.closest('label').textContent : a.textContent).trim();
      return { eye: c.position.toArray(), yaw: Math.atan2(-d.x, -d.z), pad: breadboardVR.pad, card: breadboardVR.remote.inCard, focus, dot: !dot.hidden && dot.classList.contains('on') ? 'on' : !dot.hidden ? 'shown' : 'hidden', hint: document.querySelector('.vr-hint').textContent, tip: breadboardVR.tip };
    })()`);
  const tvAim = async (what) => {
    assert(await page.evaluate(`breadboardVR.face(${JSON.stringify(what)})`), `no ${what}`);
    await sleep(150);
    const v = await tvView();
    assert(v.pad.on === what && v.dot === 'on', `aimed at ${what}, the dot is on ${v.pad.on} (${v.dot})`);
  };
  /**
   * A board control taken with taps of the remote's left: from the view turned `right` taps to the
   * right of `part`, which taps of left leave the dot on it (a run of two or more: it can't be
   * stepped over, and from beside it a tap or two lands on it).
   */
  const sweep = async (part, right = 6, left = 12) => {
    assert(await page.evaluate(`breadboardVR.face(${JSON.stringify(part)})`), `no ${part}`);
    await sleep(150);
    for (let i = 0; i < right; i++) await remoteKey('ArrowRight');
    const on = [];
    for (let i = 0; i < left; i++) {
      await remoteKey('ArrowLeft');
      on.push((await tvView()).pad.on === part);
    }
    return on.map((x) => (x ? 'x' : '.')).join('');
  };
  /** From just beside `part` (a tap of right too far), the taps of left that land the dot on it. */
  const landOn = async (part) => {
    assert(await page.evaluate(`breadboardVR.face(${JSON.stringify(part)})`), `no ${part}`);
    await sleep(150);
    let off = 0;
    while ((await tvView()).pad.on === part && off < 8) await remoteKey('ArrowRight'), off++;
    let taps = 0;
    while ((await tvView()).pad.on !== part && taps < 8) await remoteKey('ArrowLeft'), taps++;
    const v = await tvView();
    assert(v.pad.on === part && v.dot === 'on' && taps <= 2, `${part}: ${off} taps of right off it, then ${taps} of left: the dot is on ${v.pad.on}`);
    return taps;
  };
  /** The bottom of the bar's own controls (not the TV's hint, fixed at the foot), the view's top, the panel's box, and how far the dot is from the view's middle. */
  const tvFrame = () =>
    page.evaluate(`(() => {
      const c = document.querySelector('#vr-root canvas').getBoundingClientRect(), d = document.querySelector('.vr-aim').getBoundingClientRect();
      const bar = Math.max(...[...document.querySelector('.vr-bar').children].filter((e) => !e.classList.contains('vr-hint') && e.offsetParent).map((e) => e.getBoundingClientRect().bottom));
      return { bar, view: c.top, panel: breadboardVR.panelBox(), dot: Math.hypot(d.left + d.width / 2 - (c.left + c.width / 2), d.top + d.height / 2 - (c.top + c.height / 2)) };
    })()`);
  /** In the card: up or down (dir) from control to control until the focus is on `text`. */
  const focusTo = async (text, dir = 'ArrowDown') => {
    for (let i = 0; i < 16; i++) {
      const v = await tvView();
      if (v.focus === text) return;
      await remoteKey(dir);
    }
    throw new Error(`${dir} never came to ${text} (at ${(await tvView()).focus})`);
  };

  await check('VR view on a TV (?tv=emulate): the room below the bar, the remote walks and turns (a tap a little), OK presses what the dot is on (or just beside), Back steps back, and Menu reaches every panel button', async () => {
    const before = errors.length;
    await page.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 2, mobile: false });
    await page.goto(`${base}vr.html?tv=emulate`, 3000);
    const state = () => page.evaluate(`(() => { const m = breadboardVR.machine; return { ...(m && { mode: m.mode, running: m.running, cycles: m.computer.cycles, step: m.computer.step, hz: m.hz }), program: breadboardVR.exhibit.status()[0], exhibit: JSON.parse(document.body.dataset.ready).exhibit, links: breadboardVR.links, access: breadboardVR.access, open: [...document.querySelectorAll('.vr-menu')].filter((d) => d.open).map((d) => d.querySelector('summary').textContent) }; })()`);
    const page0 = await page.evaluate(`({ tv: document.documentElement.classList.contains('tv'), vrButton: !!document.getElementById('VRButton'), panel: breadboardVR.panelLabels(), app: typeof hallwayTV?.menu + ' ' + typeof hallwayTV?.back })`);
    assert(page0.tv && !page0.vrButton && !page0.panel.some((l) => /VR$/.test(l)) && page0.app === 'function function', `the TV's page: ${JSON.stringify(page0)}`);
    const v0 = await tvView();
    assert(v0.focus === 'view' && !v0.card && v0.dot !== 'hidden' && v0.hint.startsWith('Arrows'), `walking at first: ${JSON.stringify(v0)}`);
    // the room below the bar, the dot in its middle: at the table the panel's title is clear of the
    // bar's, and still when a shared session's invitation makes the bar two rows
    const f0 = await tvFrame();
    await page.evaluate(`document.querySelector('.vr-invite').textContent = 'Invite: example.com/breadboard/vr.html?room=check-browser'`);
    await sleep(300);
    const f1 = await tvFrame();
    await page.evaluate(`document.querySelector('.vr-invite').textContent = ''`);
    await sleep(300);
    const apart = (f) => f.view >= f.bar && f.panel.top >= f.view && f.dot < 1;
    assert(apart(f0) && apart(f1) && f1.bar > f0.bar + 20 && (await tvFrame()).view === f0.view, `the bar, the view and the panel: ${JSON.stringify([f0, f1])}`);
    // up walks, left turns: a tap a little, held faster and faster
    await remoteKey('ArrowUp', 1000);
    const v1 = await tvView();
    const [dx, dz] = [v1.eye[0] - v0.eye[0], v1.eye[2] - v0.eye[2]];
    const ahead = -Math.sin(v0.yaw) * dx - Math.cos(v0.yaw) * dz;
    assert(ahead > 0.3 && Math.hypot(dx, dz) < ahead * 1.05, `up walked (${dx.toFixed(2)}, ${dz.toFixed(2)}) facing ${v0.yaw.toFixed(2)}`);
    await remoteKey('ArrowLeft', 1000);
    const v2 = await tvView();
    assert(v2.yaw > v1.yaw + 0.5, `left turned from ${v1.yaw.toFixed(2)} to ${v2.yaw.toFixed(2)}`);
    await remoteKey('ArrowLeft');
    const tapTurn = ((await tvView()).yaw - v2.yaw) * (180 / Math.PI);
    await remoteKey('ArrowUp');
    const tapWalk = Math.hypot(...(await tvView()).eye.map((x, i) => x - v2.eye[i]));
    assert(tapTurn > 1 && tapTurn < 2 && tapWalk > 0.015 && tapWalk < 0.03, `a tap turned ${tapTurn.toFixed(2)}°, walked ${tapWalk.toFixed(3)} m`);
    // Back walking: home to the table, and there it is the app's (back a page)
    const back1 = await page.evaluate('hallwayTV.back()');
    await sleep(900);
    const v3 = await tvView();
    const back2 = await page.evaluate('hallwayTV.back()');
    assert(back1 === true && Math.hypot(...v3.eye.map((x, i) => x - v0.eye[i])) < 0.01 && back2 === false, `Back: ${back1}, to ${JSON.stringify(v3.eye)} (home ${JSON.stringify(v0.eye)}), then ${back2}`);
    // RV1 and SW2, small, taken with taps: neither can be stepped over (the dot takes the nearest
    // control just beside it, a tap turning 1.5°)
    const swept = { RV1: await sweep('clock/RV1'), SW2: await sweep('clock/SW2') };
    assert(Object.values(swept).every((on) => /xx/.test(on)), `taps of left past RV1 and SW2 (x: the dot on it): ${JSON.stringify(swept)}`);
    // OK on the clock's switch, twice on its button, on its pot (held: right turns it, OK lets go), and on the panel's Run
    const s0 = await state();
    const landed = [await landOn('clock/SW2')];
    await remoteKey('Enter');
    const manual = await state();
    await tvAim('clock/SW1');
    await remoteKey('Enter');
    await remoteKey('Enter');
    const s1 = await state();
    assert(s0.mode === 'auto' && manual.mode === 'manual' && s1.cycles === manual.cycles + 2, `OK on SW2 and twice on SW1: ${JSON.stringify([s0.mode, manual.mode, manual.cycles, s1.cycles])}`);
    landed.push(await landOn('clock/RV1'));
    const v4 = await tvView();
    assert(/^RV1 speed · OK to hold, then ← and →, OK or Back to let go · /.test(v4.tip), `RV1's label: ${v4.tip}`);
    await remoteKey('Enter');
    const held = (await tvView()).pad.holding;
    await remoteKey('ArrowRight', 400);
    const s2 = await state();
    const v5 = await tvView();
    await remoteKey('Enter');
    const v6 = await tvView();
    assert(held && s2.hz !== s1.hz && Math.abs(v5.yaw - v4.yaw) < 1e-6 && !v6.pad.holding, `OK on RV1 and right: ${s1.hz} -> ${s2.hz} Hz, held ${held} then ${v6.pad.holding}, the view turned ${v5.yaw - v4.yaw}`);
    await tvAim('Run');
    await remoteKey('Enter');
    await sleep(600);
    const s3 = await state();
    assert(s3.running && s3.mode === 'auto' && s3.cycles > s2.cycles, `OK on the panel's Run: ${JSON.stringify(s3)}`);
    // Menu: into the bar, the card; Controls has the panel's buttons, each pressed with OK
    await page.evaluate('hallwayTV.menu()');
    const c0 = await tvView();
    assert(c0.card && c0.focus === '← Breadboard 8-bit' && c0.dot === 'hidden' && c0.hint.startsWith('Up, down'), `Menu: ${JSON.stringify(c0)}`);
    await focusTo('Controls');
    await remoteKey('Enter');
    const labels = await page.evaluate(`[...document.querySelectorAll('.vr-controls button')].map((b) => b.textContent)`);
    const panel = await page.evaluate(`breadboardVR.panelLabels().slice(0, ${labels.length})`);
    assert(labels.join() === panel.join() && labels.join() === 'Stop,Pulse,Step,Reset,Slower,Faster,Program ▸,Next ▸,Fit view', `the Controls menu ${labels.join()}, the panel ${panel.join()}`);
    const did = [];
    const press = async (label, test) => {
      await focusTo(label);
      const a = await state();
      await remoteKey('Enter');
      const b = await state();
      assert(test(a, b), `${label}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      did.push(label);
    };
    await press('Stop', (a, b) => a.running && !b.running);
    assert((await tvView()).focus === 'Run', 'Stop did not become Run');
    await press('Pulse', (a, b) => b.cycles === a.cycles + 1);
    await press('Step', (a, b) => b.cycles > a.cycles && b.step === 0);
    await press('Reset', (a, b) => a.cycles > 0 && b.cycles === 0);
    await press('Slower', (a, b) => Math.abs(b.hz - a.hz / 2) < 1e-6);
    await press('Faster', (a, b) => Math.abs(b.hz - a.hz * 2) < 1e-6);
    await press('Program ▸', (a, b) => b.program !== a.program);
    await focusTo('Fit view');
    await page.evaluate('breadboardVR.look([0.5, 1.1, 0.3], [0.2, 0.9, -0.5])');
    await press('Fit view', () => true);
    const home = await tvView();
    assert(Math.hypot(...home.eye.map((x, i) => x - v0.eye[i])) < 0.01, `Fit view went to ${JSON.stringify(home.eye)}`);
    // the Wires and Comfort menus: a checkbox ticked with OK, a choice made with right and left
    await focusTo('Wires');
    await remoteKey('Enter');
    await press('Bus', (a, b) => a.links.bus && !b.links.bus);
    await press('Bus', (a, b) => !a.links.bus && b.links.bus);
    await focusTo('Comfort');
    await remoteKey('Enter');
    await focusTo('Follow the system');
    const m0 = await state();
    await remoteKey('ArrowRight');
    const m1 = await state();
    await remoteKey('ArrowLeft');
    const m2 = await state();
    assert(m0.access.motion === 'system' && m1.access.motion === 'reduce' && m2.access.motion === 'system' && m1.open.join() === 'Comfort', `Motion with right and left: ${[m0, m1, m2].map((m) => m.access.motion + '/' + m.open.join())}`);
    await press('Comfort vignette while the sticks move you in VR', (a, b) => b.access.vignette !== a.access.vignette);
    await press('Comfort vignette while the sticks move you in VR', (a, b) => b.access.vignette !== a.access.vignette);
    // Back (Escape here) walks again, the menu folded away; Menu comes back to its button
    await remoteKey('Escape');
    const w = await tvView();
    const wOpen = (await state()).open;
    await page.evaluate('hallwayTV.menu()');
    const c1 = await tvView();
    assert(w.focus === 'view' && !w.card && w.dot !== 'hidden' && !wOpen.length && c1.card && c1.focus === 'Comfort', `Back: ${w.focus}, open ${wOpen.join()}; Menu again: ${c1.focus}`);
    // Next ▸ last: the next exhibit, the focus staying on it
    await focusTo('Controls', 'ArrowUp');
    await remoteKey('Enter');
    await press('Next ▸', (a, b) => a.exhibit === 'computer' && b.exhibit.startsWith('example/'));
    const n = await tvView();
    assert(n.card && n.focus === 'Next ▸', `after Next ▸ the focus is on ${n.focus}`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return `the panel ${Math.round(f0.panel.top - f0.bar)} px below the bar; walked ${ahead.toFixed(2)} m, turned ${(v2.yaw - v1.yaw).toFixed(2)} rad, a tap ${tapTurn.toFixed(1)}° and ${(tapWalk * 100).toFixed(1)} cm; Back home then the app's; taps past RV1 ${swept.RV1}, SW2 ${swept.SW2}, landed on with ${landed.join(' and ')}; OK: SW2 to manual, SW1 x2 = 2 cycles, RV1 ${Math.round(s1.hz)} -> ${Math.round(s2.hz)} Hz, Run; Menu: ${did.join(', ')}, and Motion with right and left`;
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

  await check('VR view: a door of the Hallway leads in, and its way back out', async () => {
    // A door's link (common's README, "Going in"): "← Hallway" on the bar and the panel, the doorway
    // back in the room (src/vr/door.ts), what the door added off the address, a session granted on
    // arrival asked for at once. Its way back: on this machine a page of this site, which common's
    // door.js counts as the Hallway between two dev servers (the doorway, finding no views.json
    // there, shows its name). Checking a deployed copy, only the Hallway's own page is the
    // Hallway: the way back is the real one (its view of the door shows through the doorway), and
    // going there is answered here with a stand-in page, so its own app doesn't run in the check.
    const before = errors.length;
    const back = url ? 'https://ariamokr.github.io/hallway/?from=breadboard' : `${base}#/more`;
    if (url) {
      page.on('Fetch.requestPaused', (p) =>
        page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><title>Hallway</title><link rel="icon" href="data:,">').toString('base64') }),
      );
      await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://ariamokr.github.io/hallway/*', resourceType: 'Document' }] });
    }
    await page.goto(`${base}vr.html?from=hallway&back=${encodeURIComponent(back)}&dx=0.12&yaw=-8&pitch=-3&dw=1.1&dh=2.25&glow=d8543f`, 3000);
    const r = await page.evaluate(`(async () => {
      const a = document.querySelector('.vr-bar a.vr-hallway');
      let asked = null; // no WebXR in this browser: nothing to grant
      if (navigator.xr) {
        asked = [];
        navigator.xr.requestSession = (mode) => (asked.push(mode), new Promise(() => {}));
        navigator.xr.dispatchEvent(new Event('sessiongranted'));
        await new Promise((r) => setTimeout(r, 100));
      }
      return { link: a && [a.textContent, a.href], search: location.search, panel: breadboardVR.panelLabels(), asked, door: breadboardVR.door?.group.name ?? null };
    })()`);
    assert(r.link?.[0] === '← Hallway' && r.link[1] === back, `the bar's link: ${JSON.stringify(r.link)}`);
    assert(r.search === '', `the address kept ${r.search}`);
    assert(r.panel.includes('← Hallway'), `the panel: ${r.panel.join(', ')}`);
    assert(!r.asked || r.asked.join() === 'immersive-vr', `on sessiongranted it asked for ${JSON.stringify(r.asked)}`);
    assert(r.door === 'doorway', 'no doorway back in the room');
    // the way back lasts the visit (this tab), and a real click on the panel's corner button takes
    // it, and one on the doorway (turned to face it)
    const clickAt = async (what, at) => {
      assert(at, `no ${what}`);
      const under = await page.evaluate(`document.elementFromPoint(${at.x}, ${at.y})?.tagName`);
      assert(under === 'CANVAS', `the ${what} is under a ${under}`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await sleep(1500);
      const went = await page.evaluate('location.href');
      assert(went === back, `the ${what} went to ${went}`);
    };
    await page.goto(`${base}vr.html`, 3000);
    await clickAt(`panel's corner button`, await page.evaluate(`breadboardVR.panelPoint('← Hallway')`));
    await page.goto(`${base}vr.html`, 3000);
    await clickAt('doorway', await page.evaluate(`(breadboardVR.look([0, 1.55, -0.5], [0, 1.25, 1.8]), breadboardVR.doorPoint())`));
    // through no door, no way back
    await page.evaluate('sessionStorage.clear()');
    await page.goto(`${base}vr.html`, 3000);
    const none = await page.evaluate(`({ way: breadboardVR.way, link: !!document.querySelector('.vr-hallway'), panel: breadboardVR.panelLabels(), door: !!breadboardVR.door })`);
    assert(!none.way && !none.link && !none.panel.includes('← Hallway') && !none.door, `through no door, yet ${JSON.stringify(none)}`);
    if (url) await page.send('Fetch.disable');
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return `"← Hallway" on the bar and the panel and a doorway back, the address cleaned, ${r.asked ? 'a granted session asked for, ' : ''}kept on reload, taken by clicks on the panel and the doorway; none through no door`;
  });

  await check('VR view on a TV, through a door of the Hallway: the way back on the bar, OK through the doorway, and Back from the table to the door', async () => {
    // As the door's link brings the TV app in (with ?tv=emulate added here: the app's own user
    // agent says it there), from a page standing for the Hallway; a gamepad's B is Back too, and
    // at the table it goes back a page, as the app's Back does when hallwayTV.back() says false.
    const before = errors.length;
    const back = url ? 'https://ariamokr.github.io/hallway/?from=breadboard' : `${base}#/more`;
    if (url) {
      page.on('Fetch.requestPaused', (p) =>
        page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><title>Hallway</title><link rel="icon" href="data:,">').toString('base64') }),
      );
      await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://ariamokr.github.io/hallway/*', resourceType: 'Document' }] });
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 2, mobile: false });
    await page.evaluate('sessionStorage.clear()');
    await page.goto(back, 1000);
    await page.goto(`${base}vr.html?from=hallway&back=${encodeURIComponent(back)}&dx=0.12&yaw=-8&pitch=-3&dw=1.1&dh=2.25&glow=d8543f&tv=emulate`, 3500);
    const r = await page.evaluate(`(async () => {
      let asked = null; // the TV's page asks for no session, granted or not
      if (navigator.xr) {
        asked = [];
        navigator.xr.requestSession = (mode) => (asked.push(mode), new Promise(() => {}));
        navigator.xr.dispatchEvent(new Event('sessiongranted'));
        await new Promise((r) => setTimeout(r, 100));
      }
      return { search: location.search, tv: breadboardVR.tv, door: !!breadboardVR.door, panel: breadboardVR.panelLabels(), asked };
    })()`);
    assert(r.search === '?tv=emulate' && r.tv && r.door && r.panel.includes('← Hallway') && !r.asked?.length, `arriving: ${JSON.stringify(r)}`);
    await page.evaluate('hallwayTV.menu()');
    const c = await tvView();
    await remoteKey('Escape');
    assert(c.card && c.focus === '← Hallway' && (await tvView()).focus === 'view', `Menu: the first stop is ${c.focus}`);
    // walk on, then B (a stand-in pad) home to the table and, there, back a page: to the door
    const v0 = await tvView();
    await remoteKey('ArrowUp', 800);
    const v1 = await tvView();
    assert(Math.hypot(v1.eye[0] - v0.eye[0], v1.eye[2] - v0.eye[2]) > 0.2, `up walked from ${JSON.stringify(v0.eye)} to ${JSON.stringify(v1.eye)}`);
    await page.evaluate(`(() => {
      const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      window.testPad = pad;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
      dispatchEvent(new Event('gamepadconnected'));
    })()`);
    const b = async () => {
      await page.evaluate(`testPad.buttons[1] = { pressed: true, touched: true, value: 1 }`);
      await sleep(150);
      // gone back a page already, the pad with it: nothing to let go of
      await page.evaluate(`window.testPad && (testPad.buttons[1] = { pressed: false, touched: false, value: 0 })`).catch(() => {});
      await sleep(900);
    };
    await b();
    const home = await page.evaluate(`({ href: location.href, eye: breadboardVR.camera.position.toArray(), canGoBack: navigation.canGoBack })`);
    await b();
    const went = await page.evaluate('location.href');
    assert(home.href.includes('vr.html') && home.canGoBack && went === back, `B: ${JSON.stringify(home)}, then B went to ${went}`);
    // OK on the doorway goes through it
    await page.goto(`${base}vr.html?tv=emulate`, 3000);
    await page.evaluate(`breadboardVR.look([0, 1.55, -0.5], [0, 1.25, 1.8])`);
    await sleep(150);
    const d = await tvView();
    assert(d.pad.on === 'doorway', `looking at the doorway, the dot is on ${d.pad.on}`);
    await remoteKey('Enter');
    await sleep(1500);
    const through = await page.evaluate('location.href');
    assert(through === back, `OK on the doorway went to ${through}`);
    if (url) await page.send('Fetch.disable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return `"← Hallway" the bar's first stop, no session asked for; walked, B home then back a page to the door; OK through the doorway`;
  });

  // IWER (vr.html?xr=emulate) is on the dev server only: a build leaves it out.
  if (!dist)
    await check('VR view (emulated Quest 3): arriving at the door, walking, turning, a jump, and back out through it', async () => {
      // The Hallway's door link again; then in the emulated headset: lined up where the door says,
      // the left stick walks (stopping at the table), the right one snaps 30°, a jump aimed at the
      // floor (move: teleport), and a step back through the doorway leads back (src/vr/move.ts, door.ts).
      const before = errors.length;
      const back = `${base}#/more`;
      await page.evaluate('sessionStorage.clear()');
      await page.goto(`${base}vr.html?xr=emulate&from=hallway&back=${encodeURIComponent(back)}&dx=0.2&yaw=10`, 3000);
      const at = await page.evaluate(`(() => { const b = document.getElementById('VRButton'); const r = b.getBoundingClientRect(); return { text: b.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      assert(at.text === 'ENTER VR', `the VR button says ${at.text}`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await sleep(1000);
      const pose = () => page.evaluate(`(() => {
        const c = breadboardVR.camera, h = c.getWorldPosition(c.position.clone()), d = c.getWorldDirection(c.position.clone());
        return { x: +h.x.toFixed(2), z: +h.z.toFixed(2), yaw: Math.round(Math.atan2(-d.x, -d.z) * 180 / Math.PI) };
      })()`);
      const stick = async (hand, x, y, ms) => {
        await page.evaluate(`breadboardVR.xrDevice.controllers.${hand}.updateAxes('thumbstick', ${x}, ${y})`);
        await sleep(ms);
        await page.evaluate(`breadboardVR.xrDevice.controllers.${hand}.updateAxes('thumbstick', 0, 0)`);
        await sleep(200);
      };
      const arrived = await pose();
      assert(Math.abs(arrived.x - 0.2) < 0.03 && Math.abs(arrived.z - 1.2) < 0.03 && Math.abs(arrived.yaw - 10) <= 1, `arrived at ${JSON.stringify(arrived)}, not at the door (0.2, 1.2), turned 10°`);
      await stick('left', 0, -1, 1500); // walk forward, into the table
      const walked = await pose();
      assert(Math.abs(walked.yaw - 10) <= 1 && Math.abs(walked.z + 0.07) < 0.03, `walked to ${JSON.stringify(walked)}: not stopped at the table's near edge (z -0.07)`);
      await stick('right', 1, 0, 150); // a push right: 30° to the right
      const turned = await pose();
      assert(Math.abs(turned.yaw + 20) <= 1 && Math.abs(turned.x - walked.x) < 0.01 && Math.abs(turned.z - walked.z) < 0.01, `a snap turn: ${JSON.stringify(turned)}`);
      // a jump: the left controller aimed down at the floor to the right, the stick forward, let go
      await page.evaluate(`(() => {
        const v = breadboardVR, l = v.xrDevice.controllers.left;
        v.nav.move = 'teleport';
        const q = new v.camera.quaternion.constructor().setFromEuler(new v.camera.rotation.constructor(-0.6, -1.2, 0, 'YXZ'));
        l.quaternion.set(q.x, q.y, q.z, q.w);
      })()`);
      await stick('left', 0, -1, 500);
      await sleep(400);
      const jumped = await pose();
      assert(Math.hypot(jumped.x - turned.x, jumped.z - turned.z) > 1, `no jump: ${JSON.stringify(jumped)}`);
      // in front of the doorway, then a step back through it
      await page.evaluate(`(() => {
        const v = breadboardVR, d = v.xrDevice.position;
        v.rig.rotation.set(0, 0, 0);
        v.rig.position.set(-d.x, 0, 1.4 - d.z);
      })()`);
      await sleep(300);
      await page.evaluate('breadboardVR.xrDevice.position.z += 0.6');
      await sleep(1500);
      const went = await page.evaluate('location.href');
      assert(went === back, `a step back through the doorway went to ${went}`);
      const errs = errors.slice(before);
      assert(!errs.length, errs.join('\n'));
      return `at the door turned ${arrived.yaw}°, walked to the table (z ${walked.z}), snapped to ${turned.yaw}°, jumped ${Math.hypot(jumped.x - turned.x, jumped.z - turned.z).toFixed(1)} m, out through the doorway`;
    });

  await check('high contrast (forced colours): the LEDs, switches, toggles and lit signals keep their states, the open tab and the current page are marked', async () => {
    // A contrast theme (Windows') replaces background colours, which is how the simulator draws its
    // state: the hardware keeps its own colours there and the marks of state take Highlight (styles.css).
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: 'dark' }] });
    await page.goto(`${base}#/`, 300);
    await page.send('Page.reload');
    await sleep(2000);
    const r = await page.evaluate(`(async () => {
      const bg = (e, p) => (e ? getComputedStyle(e, p).backgroundColor : 'none');
      const settle = () => new Promise((r) => setTimeout(r, 300)); // past the track's transition
      const pair = (sel, p) => { const all = [...document.querySelectorAll(sel)]; return [bg(all.find((e) => e.classList.contains('on')), p), bg(all.find((e) => !e.classList.contains('on')), p)]; };
      const toggle = document.querySelector('.toggle input'), track = toggle.nextElementSibling;
      const was = toggle.checked;
      toggle.checked = false;
      await settle();
      const off = bg(track), knob = bg(track.querySelector('.toggle-knob'));
      toggle.checked = true;
      await settle();
      const on = bg(track);
      toggle.checked = was;
      const tab = (sel) => { const t = document.querySelector(sel); return getComputedStyle(t).borderBottomColor + ' ' + getComputedStyle(t).borderBottomWidth; };
      return {
        forced: matchMedia('(forced-colors: active)').matches,
        led: pair('.led'), bit: pair('.bit', '::before'), sig: pair('.sig'),
        dip: [bg(document.querySelector('.dip-bank')), bg(document.querySelector('.dip-knob'))],
        toggle: [off, on, knob],
        tab: [tab('.tabs [aria-selected=true]'), tab('.tabs [aria-selected=false]')],
        current: getComputedStyle(document.querySelector('.sidebar [aria-current=page]')).outlineStyle,
      };
    })()`);
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    assert(r.forced, 'forced colours not emulated');
    const differ = (name, [a, b]) => assert(a !== b && a !== 'none' && b !== 'none', `${name}: on ${a}, off ${b}`);
    differ('an LED', r.led);
    differ('a memory bit', r.bit);
    differ('a control signal', r.sig);
    differ('a toggle (its track)', [r.toggle[1], r.toggle[0]]);
    assert(r.toggle[2] !== r.toggle[0], `a toggle's knob is the colour of its track: ${r.toggle.join(', ')}`);
    assert(r.dip[0] === 'rgb(192, 57, 43)' && r.dip[1] !== r.dip[0], `the DIP switches: ${r.dip.join(', ')}`);
    differ('the open tab', r.tab);
    assert(r.current === 'solid', `the current page is not outlined (${r.current})`);
    return `LEDs ${r.led[0]} / ${r.led[1]}, a lit signal ${r.sig[0]}, the open tab ${r.tab[0]}`;
  });

  await check('comfort settings: a choice made in the Hallway (hallway.access) holds, and less motion stills the page', async () => {
    // As the Hallway keeps them (common's access.js): less motion and seated chosen there. The 2D
    // page stops its own transitions but not the computer's LEDs; the VR view comes through the
    // door straight to the table (no glide), holds the doorway's veil, and shows the choice on its
    // panel and in its Comfort settings. The choice is taken off again after.
    const before = errors.length;
    await page.evaluate(`localStorage.setItem('hallway.access', JSON.stringify({ motion: 'reduce', vignette: true, seated: true }))`);
    await page.goto(`${base}#/`, 300);
    await page.send('Page.reload'); // the page may only have changed its #hash: load it again, to read the setting
    await sleep(2000);
    const flat = await page.evaluate(`(() => { const t = (sel) => getComputedStyle(document.querySelector(sel)).transitionDuration; return { cls: document.documentElement.classList.contains('reduce-motion'), btn: t('.btn'), led: t('.led') }; })()`);
    assert(flat.cls && flat.btn === '0s' && flat.led !== '0s', `the 2D page with less motion: ${JSON.stringify(flat)}`);
    await page.evaluate('sessionStorage.clear()');
    await page.goto(`${base}vr.html?from=hallway&back=${encodeURIComponent(`${base}#/more`)}&dx=0.2&yaw=10`, 500);
    const where = `breadboardVR.camera.position.toArray().map((n) => +n.toFixed(2)).join()`;
    const early = await page.evaluate(where);
    const veil = await page.evaluate('breadboardVR.door.portal.material.uniforms.uTime.value');
    await sleep(2800);
    const late = await page.evaluate(where);
    const vr = await page.evaluate(`({ veil: breadboardVR.door.portal.material.uniforms.uTime.value, panel: breadboardVR.panelLabels().filter((l) => /^(Motion|Seated|Vignette):/.test(l)), radio: document.querySelector('.vr-access input[name=vr-motion]:checked')?.value, seated: document.querySelector('.vr-access input[name=vr-seated]').checked })`);
    await page.evaluate(`localStorage.removeItem('hallway.access')`);
    assert(early === late, `the view glided from ${early} to ${late}`);
    assert(veil === vr.veil, `the doorway's veil moved: uTime ${veil} -> ${vr.veil}`);
    assert(vr.panel.join() === 'Vignette: On,Seated: On,Motion: Less' && vr.radio === 'reduce' && vr.seated, `the VR view shows ${JSON.stringify(vr)}`);
    const errs = errors.slice(before);
    assert(!errs.length, errs.join('\n'));
    return 'the 2D page still but its LEDs, the VR view at the table at once with its veil held, the choice on its panel and in its settings';
  });

  await check('accessibility: axe-core finds nothing on any page, in either theme, nor in the VR view', async () => {
    // Deque's axe-core (a devDependency, put into each page), with the rules of WCAG 2.2 AA and
    // its best practices: contrast, target sizes, names, roles, headings, landmarks. Each page is
    // checked dark and light (prefers-color-scheme, switched without a reload).
    const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
    const run = `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(tags)} }, resultTypes: ['violations'] }).then((r) => r.violations.flatMap((v) => v.nodes.map((n) => v.id + ' ' + n.target.join(' '))))`;
    const scheme = (value) => page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
    // No transitions: a colour caught fading (a signal badge lighting up, the theme switching)
    // would be judged at a halfway shade nobody reads.
    const still = `document.head.append(Object.assign(document.createElement('style'), { textContent: '*, *::before, *::after { transition: none !important; animation: none !important; }' }))`;
    const problems = [];
    const both = async (where) => {
      for (const value of ['dark', 'light']) {
        await scheme(value);
        await sleep(60);
        for (const p of await page.evaluate(run)) problems.push(`${where} (${value}): ${p}`);
      }
    };
    await page.goto(base, 2000);
    await page.evaluate(axe);
    await page.evaluate(still);
    for (const route of routes) {
      await page.evaluate(`location.hash = ${JSON.stringify(route)}`);
      await sleep(600);
      await both(route);
    }
    await page.evaluate('sessionStorage.clear()');
    await page.goto(`${base}vr.html`, 3000);
    await page.evaluate(axe);
    await page.evaluate(still);
    await both('vr.html');
    await page.evaluate(`document.querySelector('.vr-controls').open = true`);
    await both('vr.html, Controls open');
    await page.goto(`${base}vr.html?tv=emulate`, 3000);
    await page.evaluate(axe);
    await page.evaluate(still);
    await both('vr.html?tv=emulate');
    await page.evaluate(`hallwayTV.menu(), document.querySelector('.vr-controls').open = true`);
    await both('vr.html?tv=emulate, in the card');
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    const shown = problems.slice(0, 25);
    assert(!problems.length, shown.join('\n') + (problems.length > shown.length ? `\n… and ${problems.length - shown.length} more` : ''));
    return `${routes.length} pages and the VR view (its menus, and on a TV), each dark and light`;
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

  await check('phones: Move takes a wire end by taps and a chip by a finger drag, without panning', async () => {
    const board = { boards: [{ id: 'bb1', place: { x: 0, y: 0 }, title: 'Sandbox' }], parts: [{ id: 'U1', board: 'bb1', kind: 'chip', chip: '74LS00', col: 10 }, { id: 'W1', board: 'bb1', kind: 'wire', color: 'red', a: 'a3', b: 'a12' }] };
    await page.evaluate(`localStorage.setItem('breadboard-sandbox-v1', ${JSON.stringify(JSON.stringify(board))}); location.hash = '#/sandbox'; location.reload()`);
    await sleep(1500);
    const touch = (type, p) => page.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    const tap = async (p) => {
      await touch('touchStart', p);
      await touch('touchEnd');
      await sleep(500);
    };
    const middle = (selector) => page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    const get = async (id) => (await saved()).find((p) => p.id === id);
    await tap(await middle('.sb-drawer summary'));
    await tap(await middle('.sb-tool[title^="Move parts"]'));
    await middle('.bb-viewport');
    await tap(await hole('a', 12)); // zoomed out: this one zooms in
    await tap(await hole('a', 12)); // the wire's end
    await tap(await hole('a', 15));
    const wire = await get('W1');
    assert(wire.a === 'a3' && wire.b === 'a15', `taps on the end at a12, then on a15, made the wire ${wire.a}-${wire.b}`);
    const from = await middle('.bb-svg [data-part="U1"]');
    const a10 = await hole('a', 10), a13 = await hole('a', 13);
    await touch('touchStart', from);
    for (let i = 1; i <= 8; i++) await touch('touchMove', { x: from.x + ((a13.x - a10.x) * i) / 8, y: from.y });
    await touch('touchEnd');
    await sleep(300);
    const chip = await get('U1');
    const a10after = await hole('a', 10);
    assert(chip.col === 13, `a finger drag of three columns put the chip at column ${chip.col}`);
    assert(Math.abs(a10after.x - a10.x) < 1 && Math.abs(a10after.y - a10.y) < 1, 'the drag panned the board');
    return 'the end at a12 put on a15 by taps, the chip dragged from column 10 to 13, the board still';
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

  await check('narrow phones: no page scrolls sideways at 320 px, and the VR view’s menus stay on screen', async () => {
    // The narrowest phones in use (320 x 568), every page; and the VR view's menus opened on a phone
    // upright and on its side (667 x 375), where the bar wraps and puts their buttons on the left.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await page.goto(`${base}#/`, 300);
    await page.send('Page.reload');
    await sleep(1500);
    const problems = await visitAll(routes, `() => (document.documentElement.scrollWidth > innerWidth ? 'page is ' + document.documentElement.scrollWidth + ' px wide' : '')`);
    const menus = [];
    for (const [w, ht] of [[320, 568], [667, 375]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: ht, deviceScaleFactor: 2, mobile: true });
      await page.goto(`${base}vr.html`, 2500);
      for (const [sel, name] of [['.vr-controls', 'Controls'], ['.vr-access', 'Comfort'], ['.vr-wires', 'Wires']]) {
        const m = await page.evaluate(`(async () => {
          const d = document.querySelector('${sel}');
          d.open = true;
          await new Promise((r) => setTimeout(r, 200));
          const rs = [d.querySelector('.vr-menu-body'), ...d.querySelectorAll('input, legend')].map((e) => e.getBoundingClientRect());
          const m = { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) };
          d.open = false;
          return m;
        })()`);
        // within the screen's 16 px margins (half a pixel's rounding allowed)
        if (m.left < 15.5 || m.right > w - 15.5 || m.bottom > ht) problems.push(`vr.html at ${w} x ${ht}: the ${name} menu runs to ${JSON.stringify(m)}`);
        menus.push(`${name} at ${w} x ${ht}: ${Math.round(m.left)}..${Math.round(m.right)}`);
      }
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await page.goto(base, 1500);
    assert(!problems.length, problems.join('\n'));
    return `${routes.length} pages; ${menus.join(', ')}`;
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
