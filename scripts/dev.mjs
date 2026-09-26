#!/usr/bin/env node
// Dev loop: watch -> rebuild -> verify -> tell the running app to reload.
//
//   node scripts/dev.mjs            watch (default)
//   node scripts/dev.mjs --once     build + verify + print, no watcher, no server
//   node scripts/dev.mjs --no-verify skip the assertion pass on each rebuild
//   node scripts/dev.mjs --port N    (default 7311)
//
// How the reload reaches the app: this process runs a tiny HTTP server on loopback and
// the app polls it (app/electron/dev-bridge.js). That keeps the dependency arrow pointing
// one way — the dev server never needs to know an app is running, so you can edit files
// with or without the app open.
//
// What "hot" means is decided by classifyChange() in the dev bridge, and the two cases
// are genuinely different:
//
//   upstream core/ or lib/ edit  -> rebuild bundles, re-inject the page in place.
//                                   The window, the WebSocket and the login all survive,
//                                   so interception tweaks are testable in seconds.
//   app/electron/*.js edit      -> full relaunch. A preload cannot be swapped into a
//                                   live renderer, and pretending otherwise leaves a
//                                   renderer on the old preload with new bundles.

import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const PORT = Number(opt('port') || process.env.WAI_DEV_PORT || 7311);
const HOST = '127.0.0.1';
const RUN_VERIFY = !flag('no-verify');

/** Directories whose contents are page-world code, i.e. hot-reloadable. */
const HOT_DIRS = ['core', 'lib', 'images'];
/** Individual files that feed the bundles. */
const HOT_FILES = ['styles.css', 'manifest.json', 'background.js', 'core_injection.js', 'app/electron/shim.js'];

/** Files whose changes mean "restart the app", watched but classified elsewhere. */
const SHELL_FILES = [
  'app/electron/main.js', 'app/electron/preload.js', 'app/electron/watchdog.js',
  'app/electron/tray.js', 'app/electron/prefs-store.js', 'app/electron/dev-bridge.js',
  'package.json',
];

// ---------------------------------------------------------------- build

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'pipe', ...opts });
    let out = '', err = '';
    p.stdout?.on('data', (d) => { out += d; });
    p.stderr?.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ code, out, err }));
    p.on('error', (e) => res({ code: 1, out, err: String(e.message) }));
  });
}

async function buildElectron() {
  const r = await run(process.execPath, ['scripts/build.mjs', '--target=electron']);
  if (r.code !== 0) {
    console.error(`\n  BUILD FAILED\n${indent(r.err || r.out)}`);
    return false;
  }
  return true;
}

async function verify() {
  const r = await run(process.execPath, ['scripts/verify-bundles.mjs']);
  if (r.code !== 0) {
    // Print only the failures; a wall of green is noise on every rebuild.
    const lines = (r.out + r.err).split('\n').filter((l) => /FAIL|passed,/.test(l));
    console.error(`  VERIFY FAILED\n${indent(lines.join('\n') || r.err)}`);
    return false;
  }
  const m = (r.out.match(/(\d+) passed, (\d+) failed/) || []);
  console.log(`  verify ok (${m[1] || '?'} assertions)`);
  return true;
}

const indent = (s) => String(s).trim().split('\n').map((l) => `    ${l}`).join('\n');

// ---------------------------------------------------------------- rebuild cycle

let pending = null;
let building = false;
let lastChange = null;   // { files: string[], at: number } reported to the app

function scheduleRebuild(files) {
  // Coalesce: a burst of saves (or a branch switch touching 20 files) must produce ONE
  // rebuild and ONE reload, not twenty.
  const set = new Set([...(pending?.files || []), ...files]);
  pending = { files: [...set] };
  if (building) return;
  setTimeout(runRebuild, 60);
}

async function runRebuild() {
  if (building || !pending) return;
  building = true;
  const files = pending.files;
  pending = null;

  const t0 = Date.now();
  const built = await buildElectron();
  let ok = built;
  if (built && RUN_VERIFY) ok = await verify();

  if (ok) {
    lastChange = { files, at: Date.now() };
    console.log(`  rebuilt in ${Date.now() - t0}ms  (${files.length} file(s))`);
  } else {
    // Do not publish a change: the app should keep running the last good bundles rather
    // than reload into a broken build.
    console.log('  holding off on reload until the build is green');
  }

  building = false;
  if (pending) setTimeout(runRebuild, 60);
}

// ---------------------------------------------------------------- dev server

let server = null;

function startServer() {
  server = createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    res.setHeader('access-control-allow-origin', '*');

    if (url === '/ping') {
      // Report each change exactly once. The client dedups too, but not repeating is
      // cheaper and makes `curl` useful for debugging what the app is being told.
      if (lastChange && req.headers['x-wai-seq'] !== String(lastChange.at)) {
        const body = JSON.stringify({ changed: lastChange.files, seq: lastChange.at });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
        lastChange = null;
        return;
      }
      res.writeHead(204, { 'x-wai-idle': '1' });
      res.end();
      return;
    }

    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, root: ROOT, verify: RUN_VERIFY }));
      return;
    }

    res.writeHead(404).end();
  });

  server.on('error', (e) => {
    console.error(`  dev server failed: ${e.message}`);
    console.error(`  Is another dev server already on port ${PORT}? Pass --port N to move it.`);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`  dev server  http://${HOST}:${PORT}  (curl ${HOST}:${PORT}/ping)`);
  });
}

// ---------------------------------------------------------------- watching

function watchPath(p, onChange, label) {
  if (!existsSync(p)) return;
  try {
    const w = watch(p, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = `${label}/${String(filename).split(/[\\/]/).join('/')}`;
      // Editor swap files and build noise are not edits.
      if (/(^|\/)(\..*|.*\.tmp|.*~)$/.test(rel)) return;
      onChange([rel]);
    });
    w.on('error', (e) => console.error(`  watch error on ${label}: ${e.message}`));
  } catch (e) {
    console.error(`  could not watch ${label}: ${e.message}`);
  }
}

function startWatching() {
  for (const d of HOT_DIRS) watchPath(join(ROOT, d), (f) => scheduleRebuild(f), d);
  for (const f of HOT_FILES) {
    if (existsSync(join(ROOT, f))) watch(join(ROOT, f), () => scheduleRebuild([f]));
  }
  for (const f of SHELL_FILES) {
    if (existsSync(join(ROOT, f))) watch(join(ROOT, f), () => scheduleRebuild([f]));
  }
  watchPath(join(ROOT, 'patches'), (f) => scheduleRebuild(f), 'patches');
  console.log(`  watching    ${HOT_DIRS.length} dirs, ${HOT_FILES.length + SHELL_FILES.length} files, patches/`);
}

// ---------------------------------------------------------------- cli

if (flag('once')) {
  const built = await buildElectron();
  if (built && RUN_VERIFY) await verify();
  process.exit(0);
}

console.log(`\nWAIncognito dev  (root: ${relative(process.cwd(), ROOT) || '.'})`);
const first = await buildElectron();
if (first && RUN_VERIFY) await verify();
if (!first) console.log('  starting the watcher anyway; it will pick up the next save');

startServer();
startWatching();

console.log('\n  Start the app in another terminal:  npm start -- --dev');
console.log('  Edits to core/ or lib/ re-inject the live page. Edits to app/electron/*.js relaunch.\n');

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log('\n  dev server stopped'); process.exit(0); });
}
