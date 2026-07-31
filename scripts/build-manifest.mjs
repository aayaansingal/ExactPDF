/**
 * Emits dist/manifest.json from src/manifest.config.ts and package.json, then
 * tidies the HTML Vite produced.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// The config is TypeScript, so transpile it to a temporary ES module first.
const bundled = await build({
  entryPoints: ['src/manifest.config.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});

const source = bundled.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { buildManifest } = await import(moduleUrl);

// Set only by `npm run build:e2e`; never by `npm run build` or `npm run package`.
const e2eHostAccess = process.env.EXACTPDF_E2E === '1';
const manifest = buildManifest(pkg.version, { e2eHostAccess });

if (e2eHostAccess) {
  console.log('  NOTE: end-to-end build - host access added for automation, do not ship this package');
}
writeFileSync('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`  dist/manifest.json (v${pkg.version}, ${manifest.permissions.length} permissions)`);

/**
 * Vite marks its emitted tags `crossorigin`, which is meaningful for a website
 * served over HTTP but only adds noise inside an extension package, where every
 * asset is same-origin by construction. Removing it keeps the shipped HTML as
 * plain as a reviewer would expect.
 */
function tidyHtml(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      tidyHtml(path);
    } else if (entry.endsWith('.html')) {
      const cleaned = readFileSync(path, 'utf8').replace(/\s+crossorigin(=".*?")?/g, '');
      writeFileSync(path, cleaned);
      console.log(`  tidied ${path}`);
    }
  }
}

tidyHtml('dist');
