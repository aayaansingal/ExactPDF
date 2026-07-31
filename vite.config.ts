import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/**
 * Builds everything that Chrome loads as an ES module: the MV3 service worker
 * and the three extension pages. Content scripts cannot be ES modules when
 * injected with `chrome.scripting.executeScript({ files })`, so they are built
 * separately as IIFE bundles by `scripts/build-content.mjs`.
 */
export default defineConfig({
  plugins: [preact()],
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome120',
    // Store review is easier when the shipped bundle is readable.
    minify: false,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        preview: resolve(__dirname, 'src/preview/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        background: resolve(__dirname, 'src/background/serviceWorker.ts'),
        renderWorker: resolve(__dirname, 'src/pdf/renderWorker.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
