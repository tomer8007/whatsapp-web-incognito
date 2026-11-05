#!/usr/bin/env node
// One-shot debug run: stop stale instances, build, verify, test, launch, and report.
//
//   pnpm one            full: kill -> env -> build -> package -> assertions -> tests -> app
//   pnpm one --no-test  skip the unit tests
//   pnpm one --no-app   everything except the real-window check (CI-friendly)
//   pnpm one --no-package  skip extension zip packaging (faster for app-only debugging)
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
const SKIP_PACKAGE = argv.includes('--no-package') || SKIP_APP;

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

// ---------------------------------------------------------------- kill stale
// The shell hides on window-close and stays resident (so the WhatsApp session is not
// lost), which means a user who clicks the X leaves an INVISIBLE process running.
// Relaunching then only focuses that hidden window via the single-instance lock, and
// prints "another instance is already running; this one is exiting" — which reads
// exactly like a crash. This ends that ambiguity.

const isWindows = process.platform === 'win32';
const SELF = new Set([process.pid, process.ppid].filter(Boolean));

function listProcesses() {
  if (isWindows) {
    const r = spawnSync('wmic', ['process', 'get', 'ProcessId,CommandLine', '/format:csv'], { encoding: 'utf8' });
    const out = [];
    for (const line of (r.stdout || '').split('\n').slice(1)) {
      const m = line.match(/^([^,]+),(\d+),(.*)$/);
      if (m) out.push({ pid: Number(m[2]), cmd: m[3] });
    }
    return out;
  }
  const r = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', maxBuffer: 8 << 20 });
  const out = [];
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m) out.push({ pid: Number(m[1]), cmd: m[2] });
  }
  return out;
}

function killPid(pid) {
  if (isWindows) return spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' }).status === 0;
  const term = spawnSync('kill', ['-TERM', String(pid)], { encoding: 'utf8' });
  return term.status === 0;
}

function isOurApp(cmd) {
  if (!cmd) return false;
  const c = cmd.toLowerCase();
  if (!c.includes('electron')) return false;
  return c.includes('waincognito') || c.includes('whatsapp-web-incognito') || c.includes('wai-test');
}

function killStale() {
  const procs = listProcesses();
  const ours = procs.filter((p) => isOurApp(p.cmd) && !SELF.has(p.pid));

  if (!ours.length) { ok('none running'); return; }

  console.log(`  found ${ours.length} stale process(es):`);
  for (const p of ours) {
    const short = p.cmd.length > 96 ? `${p.cmd.slice(0, 96)}...` : p.cmd;
    console.log(`       ${String(p.pid).padStart(7)}  ${short}`);
  }

  let stopped = 0;
  for (const p of ours) {
    if (killPid(p.pid)) {
      stopped++;
      console.log(`  stopped ${p.pid}`);
    } else {
      console.log(`  could not stop ${p.pid} (already gone, or not permitted)`);
    }
  }

  if (!isWindows) {
    spawnSync('sleep', ['1']);
    for (const p of ours) {
      const alive = spawnSync('kill', ['-0', String(p.pid)], { encoding: 'utf8' }).status === 0;
      if (alive) {
        spawnSync('kill', ['-KILL', String(p.pid)], { encoding: 'utf8' });
        console.log(`  force-killed ${p.pid}`);
      }
    }
  }

  console.log(`  stopped ${stopped} process(es)`);
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
killStale();

// ---------------------------------------------------------------- 3. build
step(3, 'build');
run('bundles built', process.execPath, ['scripts/build.mjs']);

// ---------------------------------------------------------------- 4. package
//
// Before the assertions, not after. A18/A19/A20 check the zip that anyone actually
// installs, so there has to BE a zip by the time they run — otherwise they silently skip
// and the one artefact nobody can reproduce locally goes untested on every `pnpm check`.
// Skipped with --no-package (or --no-app, which implies it) for faster app-only debugging.
if (!SKIP_PACKAGE) {
  step(4, 'package extension');
  run('extension zips built', process.execPath, ['scripts/package-ext.mjs']);
}

// ---------------------------------------------------------------- 5. assertions
step(5, 'build assertions');
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

// ---------------------------------------------------------------- 6. unit tests
if (!SKIP_TEST) {
  step(6, 'unit tests');
  run('prefs store + dev bridge + user agent', process.execPath, ['--test', 'app/electron/*.test.js']);
}

// ---------------------------------------------------------------- 7. the real thing
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
  step(7, 'the real app, real window');
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
