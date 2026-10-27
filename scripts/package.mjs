/**
 * Builds the distributable ZIP, used both as the GitHub Release asset and as a
 * Chrome Web Store submission, refusing to produce one that would fail review.
 *
 * The checks below mirror the pre-submission checklist in the product plan. They
 * run here rather than in a document because a checklist that is not executed is
 * a checklist that eventually is not followed.
 *
 * The archive is reproducible: the same dist/ always yields a byte-identical
 * ZIP, so a published checksum can be re-derived from the tagged source.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const DIST = 'dist';
const OUTPUT_DIR = 'release';

// Only files a browser loads belong in the package. Anything else (source maps,
// TypeScript, test fixtures, editor or OS metadata) means the build leaked.
const ALLOWED_EXTENSIONS = ['.js', '.css', '.html', '.json', '.png'];

// Every entry is stamped with this time so archives do not differ by build time.
// Honours the SOURCE_DATE_EPOCH convention; 2026-01-01T00:00:00Z otherwise.
const FIXED_TIMESTAMP = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 1767225600) * 1000);

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

// A prerelease such as 1.0.0-beta.1 is carried in version_name, because
// Chrome's `version` field accepts integers only.
check(
  'manifest version matches package.json',
  (manifest.version_name ?? manifest.version) === pkg.version && pkg.version.startsWith(manifest.version),
  `${manifest.version_name ?? manifest.version} vs ${pkg.version}`,
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

const unexpected = files.filter(
  (file) =>
    !ALLOWED_EXTENSIONS.some((extension) => file.endsWith(extension)) || basename(file).startsWith('.'),
);
check('only runtime file types are included', unexpected.length === 0, unexpected.join(', '));

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

const entries = files.map((file) => relative(DIST, file)).sort();
for (const file of files) {
  utimesSync(file, FIXED_TIMESTAMP, FIXED_TIMESTAMP);
}

// Zipping from inside dist/ keeps manifest.json at the archive root, which is
// what Chrome requires. `-X` omits the macOS extended attributes that would
// otherwise appear as stray files in the extracted copy, `-D` omits directory
// entries, and the sorted list on stdin (`-@`) fixes the entry order. ZIP
// stores local time, so TZ=UTC keeps timestamps identical across machines.
execFileSync('zip', ['-X', '-D', '-q', relative(DIST, zipPath), '-@'], {
  cwd: DIST,
  input: `${entries.join('\n')}\n`,
  env: { ...process.env, TZ: 'UTC' },
});

const archive = readFileSync(zipPath);
const digest = createHash('sha256').update(archive).digest('hex');
writeFileSync(`${zipPath}.sha256`, `${digest}  ${basename(zipPath)}\n`);
writeFileSync(join(OUTPUT_DIR, `exactpdf-${pkg.version}.files.txt`), `${entries.join('\n')}\n`);

console.log(`\n  ${zipPath} (${(archive.length / 1024).toFixed(0)} kB, ${files.length} files)`);
console.log(`  sha256 ${digest}\n`);
console.log('  Inspect the file list beside the ZIP before publishing.\n');
