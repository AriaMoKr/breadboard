import type { Layout } from './layout';

/**
 * Sandbox circuits in a link: the layout as JSON, deflated and base64url encoded behind a
 * version prefix, e.g. `#/sandbox/c1.q1ZKz...`. It travels in the URL's #hash, so it never
 * reaches a server.
 */
const PREFIX = 'c1.';

export async function encodeLayout(layout: Layout): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(layout));
  return PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The layout in a code from `encodeLayout`; throws if it isn't one. */
export async function decodeLayout(code: string): Promise<Layout> {
  if (!code.startsWith(PREFIX)) throw new Error('not a circuit link');
  const json = await pipe(fromBase64Url(code.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
  const layout = JSON.parse(new TextDecoder().decode(json)) as Layout;
  if (!Array.isArray(layout?.boards) || !Array.isArray(layout?.parts)) throw new Error('not a layout');
  return layout;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
