#!/usr/bin/env node
// Package the built extension directories into loadable, submittable zips.
//
//   node scripts/package-ext.mjs                     both browsers
//   node scripts/package-ext.mjs --browser=firefox   one browser
//   node scripts/package-ext.mjs --out=/tmp/x.zip    explicit output (used by A20)
//
// WHY THIS EXISTS
// --------------
// `scripts/build.mjs` only ever wrote UNPACKED directories. The only zip in this project
// was produced by .github/workflows/release.yml, which means `pnpm build` gave you
// something you can side-load into Chrome or `about:debugging` in Firefox, but NOT the
// artefact you would actually submit to AMO — and no way to reproduce a release locally.
//
// WHY IT MIRRORS THE WORKFLOW RATHER THAN INVENTING ITS OWN FORMAT
// ---------------------------------------------------------------
// The README promises "the zips are reproducible: the same commit always produces the same
// bytes, so you can tell a real change from noise by comparing checksums." A zip embeds
// each entry's mtime, its permission bits and its ordering, so a packer that differs from
// the workflow's in any of those three produces a different checksum for identical input —
// which does not break anything, but destroys the only mechanism anyone has for telling a
// real change from noise. So this reproduces release.yml exactly:
//
//   EPOCH=$(git log -1 --format=%ct); find "$SRC" -exec touch -d "@$EPOCH" {} +
//   ( cd "$SRC" && find . -type f -print0 | LC_ALL=C sort -z | TZ=UTC xargs -0 zip -X -9 -q OUT )
//
// The one deliberate difference: the file list is produced by Node instead of
// `find | sort -z | xargs`, because that lets this script guarantee a single `zip`
// invocation for any file count rather than relying on xargs' argument limit, and lets it
// refuse to package a directory containing something it did not expect. Byte-for-byte
// equality with the workflow is asserted per-run, not assumed — see A20 in
// scripts/verify-bundles.mjs, which packs twice and compares checksums.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'extension');
const OUTDIR = join(ROOT, 'release', 'extensions');

const BROWSERS = ['chrome', 'firefox'];

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const argOf = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
};
const flag = (name) => argv.includes(`--${name}`);

if (flag('help') || flag('h')) {
  console.log(`
  Package the built extension directories into zips.

    node scripts/package-ext.mjs [--browser=chrome|firefox] [--out=PATH] [--no-xpi]

  Output lands in release/extensions/ by default. Firefox additionally gets an .xpi,
  which is the same bytes under the name AMO expects.

  Run \`npm run build\` (or build:chrome / build:firefox) first — this packages whatever
  is already in dist/extension/, it does not build.
`);
  process.exit(0);
}

const browserArg = argOf('browser');
const explicitOut = argOf('out');
const makeXpi = !flag('no-xpi');

if (browserArg && !BROWSERS.includes(browserArg)) {
  console.error(`package-ext: unknown --browser=${browserArg}. Use one of: ${BROWSERS.join(', ')}`);
  process.exit(1);
}
const targets = browserArg ? [browserArg] : BROWSERS;

// ---------------------------------------------------------------- helpers

/** Every file under `dir`, as `./`-prefixed relative paths, in LC_ALL=C byte order. */
function fileList(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) out.push(`./${child}`);
      // Symlinks are deliberately not followed. A link into the repo would either loop or
      // pull a file the browser would not resolve the same way; refusing beats guessing.
      else out.push(`UNSUPPORTED:${child}`);
    }
  };
  walk('');
  // LC_ALL=C: byte order, not the caller's locale. `sort -z` in the workflow is pinned the
  // same way, and a locale-sensitive sort would silently reorder entries on a machine with
  // a different LANG — changing the checksum with no input change.
  return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

const human = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * The commit timestamp, used as the mtime for every entry.
 *
 * Falls back to a constant when git cannot answer (a tarball export, a fresh repo). The
 * zip is still deterministic; it is just pinned to a fixed instant rather than the commit.
 */
function epoch() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (/^\d+$/.test(out)) return { value: out, source: 'commit' };
  } catch { /* not a repo, or no commits yet */ }
  return { value: '315532800', source: 'fallback (1980-01-01)' };
}

function version() {
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  if (!m.version) throw new Error('manifest.json has no version');
  return m.version;
}

// ---------------------------------------------------------------- pack

const EPOCH = epoch();
const VERSION = version();
let totalBytes = 0;

if (!explicitOut) mkdirSync(OUTDIR, { recursive: true });

for (const browser of targets) {
  const src = join(DIST, browser);

  if (!existsSync(src)) {
    console.error(`package-ext: ${relative(ROOT, src)} does not exist.`);
    console.error(`  Run \`npm run build:${browser}\` first — this packages, it does not build.`);
    process.exit(1);
  }
  if (!existsSync(join(src, 'manifest.json'))) {
    console.error(`package-ext: ${relative(ROOT, src)}/manifest.json is missing; the build produced no loadable extension.`);
    process.exit(1);
  }

  const files = fileList(src);
  const unsupported = files.filter((f) => f.startsWith('UNSUPPORTED:'));
  if (unsupported.length) {
    console.error(`package-ext: ${relative(ROOT, src)} contains entries that are not regular files:`);
    for (const u of unsupported) console.error(`  ${u.slice('UNSUPPORTED:'.length)}`);
    console.error('  Refusing to package rather than shipping a link the browser would resolve differently.');
    process.exit(1);
  }
  if (!files.length) {
    console.error(`package-ext: ${relative(ROOT, src)} is empty.`);
    process.exit(1);
  }

  // Reproducible bytes: normalise every mtime to the commit date before zipping.
  for (const f of files) {
    try { execFileSync('touch', ['-d', `@${EPOCH.value}`, join(src, f)]); } catch { /* best effort */ }
  }

  const out = explicitOut || join(OUTDIR, `WAIncognito-${VERSION}-${browser}.zip`);
  if (existsSync(out)) rmSync(out, { force: true });

  // -X strips the extra attribute block, -9 is max compression. Order comes from stdin so
  // it is exactly the byte order computed above, independent of the filesystem.
  execFileSync('zip', ['-X', '-9', '-q', out, '-@'], {
    input: files.join('\n') + '\n',
    cwd: src,
    env: { ...process.env, TZ: 'UTC' },
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  const bytes = statSync(out).size;
  totalBytes += bytes;

  // An .xpi is the same archive under the name AMO expects; a copy, not a re-zip, so the
  // two are guaranteed identical.
  if (!explicitOut && browser === 'firefox' && makeXpi) {
    copyFileSync(out, out.replace(/\.zip$/, '.xpi'));
  }

  console.log(`  ${browser.padEnd(8)} ${relative(ROOT, out)}  (${files.length} files, ${human(bytes)})`);
}

if (!explicitOut) {
  console.log(`\n  version ${VERSION}  mtime ${EPOCH.value} (${EPOCH.source})`);
  console.log(`  total ${human(totalBytes)}`);
  if (EPOCH.source !== 'commit') {
    console.log('  \x1b[33mnote:\x1b[0m mtime fell back to a constant, so this zip will not match CI byte-for-byte.');
  }
  console.log('\n  Load unpacked:  Chrome -> dist/extension/chrome    Firefox -> dist/extension/firefox');
  console.log('  Submit to AMO:  release/extensions/*.xpi');
}
