import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  // One JS and one CSS file, so a plain `wget --mirror` of the deployed site gets all of it
  // (wget only follows links in HTML and CSS, not chunks loaded with import()).
  build: {
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
