/**
 * Builds content scripts as self-contained IIFE bundles.
 *
 * Chrome injects these with `chrome.scripting.executeScript({ files })`, which
 * runs them as classic scripts -- ES module output would fail at load. esbuild
 * wraps each entry point independently, so one call produces one bundle per
 * capture mode and nothing is shared through a runtime chunk loader.
 */
import { build } from 'esbuild';

const ENTRY_POINTS = {
  'content/elementPicker': 'src/content/elementPicker.ts',
  'content/regionPicker': 'src/content/regionPicker.ts',
  'content/pageController': 'src/content/pageController.ts',
  'content/documentExtractor': 'src/content/documentExtractor.ts',
};

const result = await build({
  entryPoints: Object.entries(ENTRY_POINTS).map(([out, entry]) => ({ out, in: entry })),
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
  legalComments: 'inline',
  logLevel: 'info',
  metafile: true,
});

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  console.log(`  ${file} ${(meta.bytes / 1024).toFixed(1)} kB`);
}
