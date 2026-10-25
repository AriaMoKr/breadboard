// Renders the pictures that show this site elsewhere, with headless Chrome (npm run preview-image):
// * public/social-preview.jpg: the breadboard view close up, the picture of index.html's link
//   preview (og:image) and of the repository's social preview on GitHub (Settings → Social preview,
//   uploaded by hand);
// * public/hallway-preview.jpg: the VR view's room as the Hallway (https://ariamokr.github.io/hallway/)
//   shows it through this site's door (the Hallway's door entry names it as its `preview`), also
//   the picture of vr.html's link preview.
// Run it again after changing the breadboard view or the VR room; the JPEGs are committed.
// `--back <m>` takes the VR room from that far behind its start (by default where a visitor coming
// through the Hallway's door arrives: breadboardVR.preview), `--dir <folder>` writes both elsewhere.
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
// The part of the breadboard view's layout shown (x y w h, in 0.1" pitches, as the SVG's viewBox):
// both columns of boards across their middle rows, from the RAM and B register down to the decimal
// display and the top of the step counter and flags, with the bus between them.
const SITE_VIEW = '-4 71 188 94';

const save = (name, jpeg, what) => {
  const bytes = Buffer.from(jpeg, 'base64');
  writeFileSync(join(dir, name), bytes);
  console.log(`${join(dir, name)}  ${what}, ${(bytes.length / 1024).toFixed(0)} kB`);
};

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 5175, strictPort: true } });
await server.listen();
const base = server.resolvedUrls.local[0];
const chrome = await launchChrome();
try {
  // 1280 x 640: GitHub's size for a social preview, and 2:1 as a large link card shows it.
  const site = await chrome.newPage();
  await site.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: 1, mobile: false });
  await site.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await site.goto(`${base}#/breadboard`, 3000);
  // A set moment, so the picture is the same each time: Ben's 28 + 14 program (the default) run
  // through its OUT, so the display shows 42, then one clock pulse into the next fetch. The board's
  // SVG then fills the window, showing SITE_VIEW.
  await site.evaluate(`(() => {
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
    Object.assign(svg.style, { position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', zIndex: 10000, background: getComputedStyle(document.body).backgroundColor });
  })()`);
  await sleep(300); // the view fits itself to its new size first, so the crop comes after
  await site.evaluate(`document.querySelector('.bb-svg').setAttribute('viewBox', ${JSON.stringify(SITE_VIEW)})`);
  await sleep(400); // a frame drawn
  const shot = await site.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  save('social-preview.jpg', shot.data, '1280 x 640, the breadboard view');

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
