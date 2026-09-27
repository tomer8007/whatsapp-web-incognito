#!/usr/bin/env node
// One-shot debug run: stop stale instances, build, verify, test, launch, and report.
//
//   pnpm one            full: kill -> env -> build -> assertions -> tests -> real app
//   pnpm one --no-test  skip the unit tests
//   pnpm one --no-app   everything except the real-window check (CI-friendly)
//
// Why this exists: "it's not working" is not a diagnosis, and the failure modes we have
// actually hit all look identical from the outside —
//
//   - a stale hidden instance (close-to-hide) makes a relaunch look like a crash
//   - a stale Electron/Chromium after an upgrade looks exactly like "the fix did nothing"
//   - WhatsApp's browser gate vs. its version gate are visually similar pages
//   - a UMD vendor bundle failing to register looks like a healthy app that blocks nothing
//
// So this prints a verdict instead of leaving it to interpretation.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SKIP_TEST = argv.includes('--no-test');
const SKIP_APP = argv.includes('--no-app');

const BOLD = '\x1b[1m', DIM = '\x1b[2m', RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', OFF = '\x1b[0m';
const step = (n, msg) => console.log(`\n${BOLD}[${n}]${OFF} ${msg}`);
const ok = (msg) => console.log(`  ${GREEN}ok${OFF}   ${msg}`);
const bad = (msg) => console.log(`  ${RED}FAIL${OFF} ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}warn${OFF} ${msg}`);

let failures = 0;

/** Run a step, stream a one-line verdict. */
function run(label, cmd, args, { optional = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 << 20 });
  if (r.status === 0) { ok(label); return true; }
  if (optional) { warn(`${label} (skipped/failed, continuing)`); return false; }
  bad(label);
  const noise = /GLES|gl_surface|GetVSync|nss_util|libva|dbus|Fontconfig|zygote|GPU process|Network service/;
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split('\n')
    .filter((l) => l.trim() && !noise.test(l))
    .slice(-14);
  for (const l of lines) console.log(`       ${l}`);
  failures++;
  return false;
}

console.log(`${BOLD}WAIncognito one-shot debug run${OFF}  ${new Date().toISOString()}`);

// ---------------------------------------------------------------- 1. environment
step(1, 'environment');
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const want = (pkg.devDependencies?.electron || '').replace(/^[^\d]*/, '');
  let have = 'not installed';
  try { have = JSON.parse(readFileSync(join(ROOT, 'node_modules/electron/package.json'), 'utf8')).version; } catch { /* absent */ }

  // The embedded Chromium is what actually matters, and it is not in package.json.
  // Ask the binary via doctor --version rather than hardcoding a major->Chromium mapping,
  // which would rot silently every time Electron skips or reorders a milestone.
  let chromium = 'unknown';
  try {
    const probe = spawnSync(join(ROOT, 'node_modules/.bin/electron'),
      ['--no-sandbox', 'scripts/doctor.cjs', '--version'],
      { cwd: ROOT, encoding: 'utf8', timeout: 90000 });
    const m = (probe.stdout || '').match(/"chromium"\s*:\s*"([^"]+)"/);
    if (m) chromium = m[1];
  } catch { /* reported as unknown below */ }

  console.log(`  electron wanted ${want}   installed ${have}`);
  console.log(`  chromium  ${chromium}`);
  if (want && have && !have.startsWith(want.replace(/\.\d+$/, ''))) {
    warn(`installed Electron (${have}) does not match package.json (${want}) — run \`pnpm install\``);
  }
  const major = parseInt(chromium.split('.')[0], 10);
  if (Number.isFinite(major) && major < 140) {
    bad(`Chromium ${major} is too old for WhatsApp Web. Upgrade: pnpm add -D electron@latest`);
    failures++;
    console.log('       This is what produces a "please update your browser" page with nothing in the logs.');
  } else if (Number.isFinite(major)) {
    ok(`Chromium ${major} is recent enough`);
  }
}

// ---------------------------------------------------------------- 2. stale instances
step(2, 'stale instances');
{
  const r = spawnSync(process.execPath, ['scripts/kill-stale.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const said = (r.stdout || '').trim();
  if (/no stale/.test(said)) ok('none running');
  else console.log(said.split('\n').map((l) => `       ${l}`).join('\n'));
}

// ---------------------------------------------------------------- 3. build
step(3, 'build');
run('bundles built', process.execPath, ['scripts/build.mjs']);

// ---------------------------------------------------------------- 4. assertions
step(4, 'build assertions');
{
  const r = spawnSync(process.execPath, ['scripts/verify-bundles.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const m = (r.stdout || '').match(/(\d+) passed, (\d+) failed/);
  if (r.status === 0 && m) ok(`${m[1]} assertions`);
  else {
    bad(`${m ? m[2] : '?'} assertion(s) failed`);
    for (const l of (r.stdout || '').split('\n').filter((x) => /FAIL/.test(x))) console.log(`       ${l.replace(/\x1b\[[0-9;]*m/g, '')}`);
    failures++;
  }
}

// ---------------------------------------------------------------- 5. unit tests
if (!SKIP_TEST) {
  step(5, 'unit tests');
  run('prefs store + dev bridge + user agent', process.execPath, ['--test', 'app/electron/*.test.js']);
}

// ---------------------------------------------------------------- 6. the real thing
//
// Order matters here. Two different questions, and a bare probe cannot answer both:
//
//   "is WhatsApp reachable at all?"  -> doctor.cjs builds its own minimal window.
//   "does the REAL app work?"        -> only the real app, with its real injection and
//                                        real session policy, can answer this.
//
// That distinction is not academic. The user agent was rewritten correctly and our own log
// printed a clean Chrome UA, while the real page still received the stock Electron UA —
// because the BrowserWindow was constructed before the session UA was applied. The bare
// probe set the UA before creating its window, so it saw the right UA and reported OK.
// A probe that does not run the production path cannot catch an ordering bug in the
// production path.
if (!SKIP_APP) {
  step(6, 'the real app, real window');
  console.log('  launching with WAI_SELFTEST=1; the app reports what its own window received.\n');
  const r = spawnSync(join(ROOT, 'node_modules/.bin/electron'), ['.'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: Number(process.env.WAI_SELFTEST_WAIT || 15000) + 40000,
    env: { ...process.env, WAI_SELFTEST: '1' },
  });

  const noise = /GetVSync|gl_surface|nss_util|libva|dbus|Fontconfig|zygote|GPU process|Network service|Gtk:/;
  for (const l of (r.stdout || '').split('\n')) {
    if (l.trim() && !noise.test(l)) console.log(`  ${l}`);
  }

  if (r.status === 0) ok('WhatsApp served the app to the real window');
  else if (r.status === 1) { bad('GATED — WhatsApp is refusing this client. Read the text dump above.'); failures++; }
  else { bad(`nothing rendered (exit ${r.status}). Read the text dump above.`); failures++; }
}

// ---------------------------------------------------------------- 7. verdict
console.log(`\n${BOLD}== verdict ==${OFF}`);
if (failures === 0) {
  console.log(`  ${GREEN}everything passed${OFF}`);
  console.log(`\n  Launch it with:  ${BOLD}pnpm start${OFF}`);
  console.log(`  Quit from the tray, NOT the X button — closing the window leaves a hidden`);
  console.log(`  process holding the single-instance lock, and the next launch will just focus it.\n`);
  process.exit(0);
}
console.log(`  ${RED}${failures} check(s) failed${OFF} — see above\n`);
process.exit(1);
