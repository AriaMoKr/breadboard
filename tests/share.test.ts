import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/breadboard/examples';
import { decodeLayout, encodeLayout } from '../src/breadboard/share';

describe('sandbox circuit links', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: round-trips through a short, URL-safe code`, async () => {
      const layout = ex.build();
      const code = await encodeLayout(layout);
      expect(code).toMatch(/^c1\.[A-Za-z0-9_-]+$/);
      expect(code.length).toBeLessThan(JSON.stringify(layout).length / 2);
      expect(await decodeLayout(code)).toEqual(layout);
    });
  }

  it('rejects codes that are not circuits', async () => {
    await expect(decodeLayout('hello')).rejects.toThrow(/not a circuit link/);
    await expect(decodeLayout('c1.!!!')).rejects.toThrow();
    const notLayout = await encodeLayout({ boards: 'x' } as never);
    await expect(decodeLayout(notLayout)).rejects.toThrow(/not a layout/);
  });
});
