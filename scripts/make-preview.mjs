// Renders the VR view's room as the Hallway (https://ariamokr.github.io/hallway/) shows it through
// this site's door, to public/hallway-preview.jpg, with headless Chrome (npm run preview-image).
// The Hallway's door entry names it as its `preview`. Run it again after changing the VR room; the
// JPEG is committed. `--back <m>` stands that far behind the start, `--out <file>` writes elsewhere.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchChrome } from './lib/chrome.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
// From the start (0 m) the panel fills the picture and the table is below it; 1.2 m back the whole
// table and the computer on it are in the picture's lower middle, which a doorway shows best.
const BACK = Number(arg('--back', '1.2'));
const out = arg('--out', fileURLToPath(new URL('../public/hallway-preview.jpg', import.meta.url)));

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 5175, strictPort: true } });
await server.listen();
const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}vr.html`, 3000);
  // A set moment rather than wherever the clock had got to, so the picture is the same each time:
  // the computer stopped after the program's first few outputs.
  const jpeg = await page.evaluate(`(() => {
    const m = breadboardVR.machine;
    m.stop();
    m.reset();
    for (let i = 0; i < 40; i++) m.stepInstruction();
    return breadboardVR.preview(2048, ${BACK});
  })()`);
  const bytes = Buffer.from(jpeg.slice(jpeg.indexOf(',') + 1), 'base64');
  writeFileSync(out, bytes);
  console.log(`${out}  2048 x 1024, ${(bytes.length / 1024).toFixed(0)} kB, from ${BACK} m behind the start`);
} finally {
  await chrome.close();
  await server.close();
}
