// Renders the pictures that show this site elsewhere, with headless Chrome (npm run preview-image):
// * public/social-preview.jpg: the site's name over its three builds, each as its page shows it
//   (Ben's computer on its breadboards, the TV Typewriter's TV showing what its memory holds, and
//   Moritz's oscillator with its scope), the picture of index.html's link preview (og:image) and of
//   the repository's social preview on GitHub (Settings → Social preview, uploaded by hand);
// * public/hallway-preview.jpg: the VR view's room as the Hallway (https://ariamokr.github.io/hallway/)
//   shows it through this site's door (the Hallway's door entry names it as its `preview`), also
//   the picture of vr.html's link preview.
// Run it again after changing the breadboard view, those two labs or the VR room; the JPEGs are
// committed. `--back <m>` takes the VR room from that far behind its start (by default where a
// visitor coming through the Hallway's door arrives: breadboardVR.preview), `--dir <folder>`
// writes both elsewhere.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchChrome, sleep } from 'common/tools/chrome.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BACK = arg('--back', null);
const dir = arg('--dir', fileURLToPath(new URL('../public/', import.meta.url)));
// 1280 x 640: GitHub's size for a social preview, and 2:1 as a large link card shows it. Each
// build's picture in it is PIC_W x PIC_H, taken from its page at twice that.
const SITE_W = 1280, SITE_H = 640, PIC_W = 376, PIC_H = 336;
// The part of the breadboard view's layout shown (x, y and width, in 0.1" pitches, as the SVG's
// viewBox; the height follows the picture's): the computer's right column from the B register
// down to the decimal display, with the bus beside it.
const BEN_VIEW = [96, 68.5, 86];
// The builds as the picture names them, with the colours of their LEDs on the home page. Ben's
// boards fill their frame; the TV and the oscillator stand in theirs.
const BUILDS = [
  { name: 'Ben Eater’s 8-bit computer', source: 'his YouTube series, video by video', led: '#ff3b3b', fill: true },
  { name: 'Don Lancaster’s TV Typewriter', source: 'Radio-Electronics, September 1973', led: '#35e06b' },
  { name: 'Moritz Klein’s synth', source: 'his “For Beginners” videos', led: '#ffd23f' },
];

const save = (name, jpeg, what) => {
  const bytes = Buffer.from(jpeg, 'base64');
  writeFileSync(join(dir, name), bytes);
  console.log(`${join(dir, name)}  ${what}, ${(bytes.length / 1024).toFixed(0)} kB`);
};

/** The site's picture: its name and what it is, then each build's pictures (PNGs, base64) with its name and source. */
const compose = (pictures) => `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${SITE_W}px; height: ${SITE_H}px; overflow: hidden; background: #111318; color: #e6e8ee; font-family: 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif; }
  .led { flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--c); box-shadow: 0 0 14px var(--c); }
  header { position: absolute; left: 48px; right: 48px; top: 40px; }
  h1 { margin: 0; display: flex; align-items: center; gap: 18px; font-size: 46px; line-height: 1.15; letter-spacing: -0.01em; }
  header p { margin: 8px 0 0 36px; font-size: 23px; color: #9aa3b5; }
  main { position: absolute; left: 48px; right: 48px; top: 176px; display: grid; grid-template-columns: repeat(3, ${PIC_W}px); justify-content: space-between; }
  figure { margin: 0; min-width: 0; }
  .pic { box-sizing: border-box; width: ${PIC_W}px; height: ${PIC_H}px; padding: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 1px solid #2f3542; border-radius: 12px; background: #1d212a; overflow: hidden; }
  .pic.fill { padding: 0; }
  .pic img { display: block; max-width: 100%; max-height: 100%; min-height: 0; }
  h2 { margin: 16px 0 0; display: flex; align-items: center; gap: 12px; font-size: 22px; white-space: nowrap; }
  h2 .led { width: 14px; height: 14px; }
  figure p { margin: 4px 0 0 26px; font-size: 18px; color: #9aa3b5; white-space: nowrap; }
</style>
<header><h1><i class="led" style="--c: #ff3b3b"></i>Breadboard Workshop</h1><p>Breadboard builds, part for part, in your browser, with a lab for each stage</p></header>
<main>${BUILDS.map(
  (b, i) =>
    `<figure><div class="pic${b.fill ? ' fill' : ''}">${pictures[i].map((png) => `<img alt="" src="data:image/png;base64,${png}">`).join('')}</div><h2><i class="led" style="--c: ${b.led}"></i>${b.name}</h2><p>${b.source}</p></figure>`,
).join('')}</main>`;

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 5175, strictPort: true } });
await server.listen();
const base = server.resolvedUrls.local[0];
const chrome = await launchChrome();
try {
  /** A tab the size of a desktop's window, dark, drawn at twice its size (sharp when the picture scales it down), on `route`. */
  const open = async (route, settleMs) => {
    const page = await chrome.newPage();
    await page.send('Page.bringToFront');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await page.goto(`${base}${route}`, settleMs);
    return page;
  };
  /** A PNG of what an element shows on its page. */
  const shot = async (page, selector) => {
    const box = await page.evaluate(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e) throw new Error(${JSON.stringify(`nothing on the page matches ${selector}`)});
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    })()`);
    await sleep(300);
    return (await page.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 }, captureBeyondViewport: true })).data;
  };

  // Ben's computer: the breadboard view at a set moment, so the picture is the same each time: his
  // 28 + 14 program (the default) run through its OUT, so the display shows 42, then one clock pulse
  // into the next fetch. Its SVG then takes the picture's size, showing BEN_VIEW.
  const ben = await open('#/breadboard', 3000);
  await ben.evaluate(`(() => {
    const press = (label) => {
      const b = [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(label));
      if (!b) throw new Error('no ' + label + ' button on the breadboard view');
      b.click();
    };
    press('Reset');
    for (let i = 0; i < 3; i++) press('Step instruction');
    press('Clock pulse');
    const svg = document.querySelector('.bb-svg');
    if (!svg) throw new Error('no board on the breadboard view');
    document.documentElement.style.overflow = 'hidden';
    scrollTo(0, 0);
    Object.assign(svg.style, { position: 'fixed', left: 0, top: 0, width: '${PIC_W}px', height: '${PIC_H}px', zIndex: 10000, background: getComputedStyle(document.body).backgroundColor });
  })()`);
  await sleep(300); // the view fits itself to its new size first, so the crop comes after
  const view = [...BEN_VIEW, (BEN_VIEW[2] * PIC_H) / PIC_W].map((n) => +n.toFixed(2)).join(' ');
  await ben.evaluate(`document.querySelector('.bb-svg').setAttribute('viewBox', ${JSON.stringify(view)})`);
  await sleep(400); // a frame drawn
  const computer = (await ben.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: PIC_W, height: PIC_H, scale: 1 } })).data;

  // The TV Typewriter: the character generator's TV with the memory's first text on it, once the
  // TV holds the picture still (its fields start on the sync pulses) and has drawn a frame whole since.
  const tvt = await open('#/lab/tvt-chargen', 2000);
  const frame = await tvt.evaluate(`(async () => {
    for (let i = 0; i < 900; i++) {
      const text = document.body.innerText, m = /here a frame takes ([\\d.]+) s/.exec(text);
      if (m && /holding the picture still/.test(text)) return Number(m[1]);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the TV did not hold the picture still in 90 s');
  })()`);
  await sleep(1500 * frame + 500);
  const tv = await shot(tvt, '.tvt-tv');

  // Moritz's oscillator: the oscillator core's last step (the core, a buffer, AC coupling and a
  // divider to a jack), once its 1 µF has settled, and the scope's sawtooths.
  const vco = await open('#/lab/oscillator-core', 2500);
  await vco.evaluate(`(() => {
    const step = document.querySelector('.lab-root select');
    if (!step) throw new Error('no steps on the oscillator core lab');
    step.value = step.options[step.options.length - 1].value;
    step.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(4000);
  const circuit = await shot(vco, '.lab-root svg.schematic');
  const scope = await shot(vco, '.lab-root .scope');

  // All three under the site's name.
  const site = await chrome.newPage();
  await site.send('Page.bringToFront');
  await site.send('Emulation.setDeviceMetricsOverride', { width: SITE_W, height: SITE_H, deviceScaleFactor: 1, mobile: false });
  await site.evaluate(`document.open(); document.write(${JSON.stringify(compose([[computer], [tv], [circuit, scope]]))}); document.close();`);
  const over = await site.evaluate(`Promise.all([...document.images].map((i) => i.decode())).then(() => document.fonts.ready).then(() =>
    [...document.querySelectorAll('figure')].flatMap((f) => [...f.querySelectorAll('h2, p')].filter((e) => e.scrollWidth > f.clientWidth).map((e) => e.textContent)))`);
  if (over.length) throw new Error(`wider than its picture: ${over.join(', ')}`);
  await sleep(200);
  const shotSite = await site.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  save('social-preview.jpg', shotSite.data, `${SITE_W} x ${SITE_H}, the three builds`);

  const vr = await chrome.newPage();
  await vr.goto(`${base}vr.html`, 3000);
  // The computer stopped after the program's first few outputs, for the same reason.
  const jpeg = await vr.evaluate(`(() => {
    const m = breadboardVR.machine;
    m.stop();
    m.reset();
    for (let i = 0; i < 40; i++) m.stepInstruction();
    return breadboardVR.preview(2048${BACK === null ? '' : `, ${Number(BACK)}`});
  })()`);
  save('hallway-preview.jpg', jpeg.slice(jpeg.indexOf(',') + 1), `2048 x 1024, the VR room${BACK === null ? '' : ` from ${BACK} m behind its start`}`);
} finally {
  await chrome.close();
  await server.close();
}
