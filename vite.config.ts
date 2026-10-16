import { defineConfig } from 'vitest/config';

// `npm run build` runs two builds into dist/: the app (index.html), then with `--mode vr` the VR
// view (vr.html), so the app doesn't carry three.js. Each is one JS and one CSS file, so a plain
// `wget --mirror` of the deployed site gets all of it (wget only follows links in HTML and CSS,
// not chunks loaded with import()), and Rollup only makes one file from one entry page.
export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173 },
  build: {
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1500,
    emptyOutDir: mode !== 'vr', // the VR build adds to the app's dist/
    rollupOptions: {
      input: mode === 'vr' ? 'vr.html' : 'index.html',
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
}));
