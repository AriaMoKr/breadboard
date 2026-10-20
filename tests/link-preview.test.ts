import { describe, expect, it } from 'vitest';

// The link-preview tags (Open Graph, X/Twitter) of each page: absolute URLs into the GitHub Pages
// copy, saying what the page itself says, with a picture that is in public/ at the size they give.
const SITE = 'https://ariamokr.github.io/breadboard/';
const pages = import.meta.glob<string>(['../index.html', '../vr.html'], { query: '?raw', import: 'default', eager: true });
// the pictures as data: URLs
const pictures = import.meta.glob<string>('../public/*.jpg', { query: '?inline', import: 'default', eager: true });

/** The page's <meta> tags, by `property` or `name`, and its <title>. */
function head(page: string) {
  const html = pages[`../${page}`];
  const meta = new Map<string, string>();
  for (const m of html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g)) meta.set(m[1], m[2]);
  return { meta, title: /<title>([^<]*)<\/title>/.exec(html)?.[1] };
}

/** Width and height of a JPEG (a data: URL), from its start-of-frame segment. */
function jpegSize(dataUrl: string): [number, number] {
  const b = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  for (let i = 2; i + 9 < b.length; i += 2 + u16(i + 2)) {
    const marker = b[i + 1];
    if (b[i] === 0xff && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [u16(i + 7), u16(i + 5)];
  }
  throw new Error('no frame size');
}

describe('link previews', () => {
  it.each([
    ['index.html', SITE],
    ['vr.html', `${SITE}vr.html`],
  ])('%s says what the page says, with its picture', (page, url) => {
    const { meta, title } = head(page);
    expect(meta.get('og:type')).toBe('website');
    expect(meta.get('og:site_name')).toBe('Breadboard 8-bit');
    expect(meta.get('og:title')).toBe(title);
    expect(meta.get('og:description')).toBe(meta.get('description'));
    expect(meta.get('og:url')).toBe(url);
    expect(meta.get('twitter:card')).toBe('summary_large_image');
    expect(meta.get('og:image:alt')?.length).toBeGreaterThan(20);

    const image = meta.get('og:image')!;
    expect(image.startsWith(SITE)).toBe(true);
    const picture = pictures[`../public/${image.slice(SITE.length)}`];
    expect(picture).toBeDefined();
    expect(jpegSize(picture)).toEqual([Number(meta.get('og:image:width')), Number(meta.get('og:image:height'))]);
  });
});
