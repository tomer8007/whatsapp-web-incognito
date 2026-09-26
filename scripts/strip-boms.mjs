#!/usr/bin/env node
// One-time source cleanup: strip UTF-8 BOMs.
//
// A BOM is legal JS mid-script (it reads as whitespace) but is not something to rely on
// at a concatenation seam, and a BOM ahead of a JSON literal breaks JSON.parse. The build
// already strips BOMs when reading (scripts/build.mjs readSource), so this is about
// leaving the source itself clean rather than about the bundles.
//
// Idempotent. Affects only files that actually have a BOM.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|json|css|html|svg)$/.test(e.name)) out.push(p);
  }
  return out;
}

const roots = ['core', 'lib', 'app', 'styles.css', 'manifest.json', 'background.js', 'core_injection.js']
  .map((r) => join(ROOT, r))
  .filter((p) => {
    try { return statSync(p); } catch { return false; }
  });

let n = 0;
for (const p of roots) {
  const files = statSync(p).isDirectory() ? walk(p) : [p];
  for (const f of files) {
    const buf = readFileSync(f);
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      writeFileSync(f, buf.subarray(3));
      console.log(`  stripped BOM  ${relative(ROOT, f)}`);
      n++;
    }
  }
}
console.log(n ? `\nstripped ${n} BOM(s).` : 'no BOMs found.');
