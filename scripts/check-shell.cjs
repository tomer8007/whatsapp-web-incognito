#!/usr/bin/env node
// Offline sanity check for the Electron shell, run without electron installed.
//
//   1. every file parses
//   2. every require() target resolves to a node builtin, 'electron', or a local file
//
// (2) is the check that actually matters here: electron is a devDependency and is not
// installed in this tree, so `require('./main.js')` cannot run — but a typo'd path to a
// local module (prefs-store.js, watchdog.js, tray.js) or a misspelled builtin would only
// surface at launch, inside a window the user cannot see past.

const { readFileSync, existsSync, statSync } = require('node:fs');
const { join, dirname, resolve, relative } = require('node:path');
const { builtinModules } = require('node:module');
const { execFileSync } = require('node:child_process');

const ROOT = resolve(__dirname, '..');
const FILES = ['main.js', 'preload.js', 'watchdog.js', 'tray.js', 'prefs-store.js'];
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

let failures = 0;
const say = (ok, msg) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
};

for (const name of FILES) {
  const file = join(ROOT, 'app', 'electron', name);
  console.log(`\napp/electron/${name}`);

  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    say(true, 'parses');
  } catch (e) {
    say(false, `parse error: ${String(e.stderr || e).split('\n').slice(0, 3).join(' ')}`);
    continue;
  }

  const src = readFileSync(file, 'utf8');
  const requires = new Set();
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) requires.add(m[1]);
  // The sandboxed preload must not reach for node builtins at all (C2).
  const guarded = /try\s*\{\s*\w+\s*=\s*require\(/.test(src);

  for (const spec of requires) {
    if (spec === 'electron') { say(true, "require('electron') — resolved by the runtime"); continue; }
    if (BUILTINS.has(spec)) {
      if (name === 'preload.js' && !guarded) say(false, `require('${spec}') is not available in a sandboxed preload`);
      else say(true, `require('${spec}') — node builtin`);
      continue;
    }
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = resolve(dirname(file), spec);
      const exists = existsSync(target) || existsSync(`${target}.js`) || existsSync(join(target, 'index.js'));
      say(exists, `require('${spec}') → ${exists ? relative(ROOT, target) : 'MISSING'}`);
      continue;
    }
    say(false, `require('${spec}') — unresolved bare specifier`);
  }
}

console.log(failures ? `\n${failures} problem(s)` : '\nall shell files parse and every require resolves');
process.exit(failures ? 1 : 0);
