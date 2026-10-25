// Renders public/icons/icon.svg to the PNG app icons with headless Chrome (npm run icons).
// Run it again after changing the SVG; the PNGs are committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchChrome } from 'common/tools/chrome.mjs';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = readFileSync(`${dir}icon.svg`, 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const BG = '#111318';

// "full bleed": no transparent corners and the drawing inside the middle 80%, as Android's
// maskable icons and iOS (which rounds the corners itself) want.
const fullBleed = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/>` +
  `<svg x="51.2" y="51.2" width="409.6" height="409.6" viewBox="0 0 512 512">${inner}</svg></svg>`;
const plain = (size) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);

const ICONS = [
  ['icon-192.png', 192, plain],
  ['icon-512.png', 512, plain],
  ['icon-maskable-512.png', 512, fullBleed],
  ['apple-touch-icon.png', 180, fullBleed],
];

const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [file, size, make] of ICONS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const html = `<!doctype html><html style="overflow:hidden"><body style="margin:0;background:transparent"><style>svg{display:block}</style>${make(size)}</body></html>`;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, 300);
    const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    writeFileSync(`${dir}${file}`, Buffer.from(shot.data, 'base64'));
    console.log(`public/icons/${file}  ${size}x${size}`);
  }
  page.close();
} finally {
  await chrome.close();
}
