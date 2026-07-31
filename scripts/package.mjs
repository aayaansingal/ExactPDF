/**
 * Builds a Chrome Web Store submission ZIP, refusing to produce one that would
 * fail review.
 *
 * The checks below mirror the pre-submission checklist in the product plan. They
 * run here rather than in a document because a checklist that is not executed is
 * a checklist that eventually is not followed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const OUTPUT_DIR = 'release';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const failures = [];

function check(description, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${description}`);
  } else {
    console.log(`  FAIL  ${description}${detail === '' ? '' : ` - ${detail}`}`);
    failures.push(description);
  }
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

console.log(`\nVerifying ${DIST}/ for submission\n`);

const files = walk(DIST);
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));

check(
  'manifest version matches package.json',
  manifest.version === pkg.version,
  `${manifest.version} vs ${pkg.version}`,
);

check('manifest is version 3', manifest.manifest_version === 3);

check(
  'permissions are limited to the documented set',
  JSON.stringify(manifest.permissions) ===
    JSON.stringify(['activeTab', 'scripting', 'storage', 'contextMenus']),
  JSON.stringify(manifest.permissions),
);

check(
  'no host permissions are declared',
  manifest.host_permissions === undefined,
  JSON.stringify(manifest.host_permissions),
);

check(
  'no source maps are included',
  !files.some((file) => file.endsWith('.map')),
  files.filter((file) => file.endsWith('.map')).join(', '),
);

const scripts = files.filter((file) => file.endsWith('.js'));
const sources = scripts.map((file) => readFileSync(file, 'utf8'));

check(
  'no development or localhost endpoints',
  !sources.some((source) => /localhost:\d|127\.0\.0\.1|0\.0\.0\.0/.test(source)),
);

check(
  'no remotely loaded code',
  !sources.some((source) => /\bimportScripts\s*\(|new\s+Function\s*\(|\beval\s*\(/.test(source)),
);

check(
  'every icon size is present',
  ['16', '32', '48', '128'].every((size) => files.includes(join(DIST, 'icons', `icon-${size}.png`))),
);

check(
  'declared entry points exist',
  [manifest.action?.default_popup, manifest.options_page, manifest.background?.service_worker]
    .filter(Boolean)
    .every((path) => files.includes(join(DIST, path))),
);

check(
  'a restrictive content security policy is set',
  (manifest.content_security_policy?.extension_pages ?? '').includes("script-src 'self'"),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed. Package not written.\n`);
  process.exit(1);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const zipPath = join(OUTPUT_DIR, `exactpdf-${pkg.version}.zip`);
rmSync(zipPath, { force: true });

// Zipping from inside dist/ keeps manifest.json at the archive root, which is
// what Chrome requires. `-X` omits the macOS extended attributes that would
// otherwise appear as stray files in the reviewer's extracted copy.
execFileSync('zip', ['-r', '-X', '-q', relative(DIST, zipPath), '.'], { cwd: DIST });

const { size } = statSync(zipPath);
console.log(`\n  ${zipPath} (${(size / 1024).toFixed(0)} kB, ${files.length} files)\n`);

writeFileSync(
  join(OUTPUT_DIR, `exactpdf-${pkg.version}.files.txt`),
  `${files
    .map((file) => relative(DIST, file))
    .sort()
    .join('\n')}\n`,
);
console.log('  Inspect the file list beside the ZIP before submitting.\n');
