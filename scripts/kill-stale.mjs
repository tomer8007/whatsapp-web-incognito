#!/usr/bin/env node
// Kill stale app instances.
//
// This exists because of a genuinely nasty trap in this app. The shell hides on
// window-close and stays resident (so the WhatsApp session is not lost), which means a
// user who clicks the X leaves an INVISIBLE process running. Relaunching then only
// focuses that hidden window via the single-instance lock, and prints
//
//     [wai] another instance is already running; this one is exiting
//
// which reads exactly like a crash. Worse, that hidden process is still running whatever
// Electron/Chromium/bundles it was started with, so after an upgrade it looks like the
// fix "did nothing". This script ends that ambiguity.
//
//   node scripts/kill-stale.mjs          report and kill
//   node scripts/kill-stale.mjs --dry    report only
//   node scripts/kill-stale.mjs --all    also kill leftover dev servers / watchers

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ALL = argv.includes('--all');

const isWindows = process.platform === 'win32';

/** Our own pid, plus our parent, so we never kill the shell that invoked us. */
const SELF = new Set([process.pid, process.ppid].filter(Boolean));

/** Read a process table as [{pid, cmd}]. */
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
  // SIGTERM first so the app can close cleanly, which avoids leaving a corrupt prefs file.
  const term = spawnSync('kill', ['-TERM', String(pid)], { encoding: 'utf8' });
  return term.status === 0;
}

/** Does this command line look like a WAIncognito Electron process? */
function isOurApp(cmd) {
  if (!cmd) return false;
  const c = cmd.toLowerCase();
  if (!c.includes('electron')) return false;
  // Must be OUR electron, not some unrelated project's.
  return c.includes('waincognito') || c.includes('whatsapp-web-incognito') || c.includes('wai-test');
}

function isDevServer(cmd) {
  return /scripts[/\\]dev\.mjs/.test(cmd || '');
}

const procs = listProcesses();

// ---------------------------------------------------------------- report

const ours = procs.filter((p) => isOurApp(p.cmd) && !SELF.has(p.pid));
const devs = ALL ? procs.filter((p) => isDevServer(p.cmd) && !SELF.has(p.pid)) : [];

if (!ours.length && !devs.length) {
  console.log('no stale WAIncognito processes found. nothing to do.');
  process.exit(0);
}

console.log(`\nfound ${ours.length + devs.length} process(es) to stop:\n`);
for (const p of [...ours, ...devs]) {
  const kind = isDevServer(p.cmd) ? 'dev server' : 'app';
  const short = p.cmd.length > 96 ? `${p.cmd.slice(0, 96)}...` : p.cmd;
  console.log(`  ${String(p.pid).padStart(7)}  ${kind.padEnd(10)}  ${short}`);
}
console.log('');

if (DRY) {
  console.log('dry run. re-run without --dry to stop them.');
  process.exit(0);
}

// ---------------------------------------------------------------- kill

const targets = [...ours, ...devs];
let stopped = 0;
for (const p of targets) {
  if (killPid(p.pid)) {
    stopped++;
    console.log(`  stopped ${p.pid}`);
  } else {
    console.log(`  could not stop ${p.pid} (already gone, or not permitted)`);
  }
}

// Give SIGTERM a moment, then force anything still alive.
if (!isWindows) {
  spawnSync('sleep', ['1']);
  for (const p of targets) {
    const alive = spawnSync('kill', ['-0', String(p.pid)], { encoding: 'utf8' }).status === 0;
    if (alive) {
      spawnSync('kill', ['-KILL', String(p.pid)], { encoding: 'utf8' });
      console.log(`  force-killed ${p.pid}`);
    }
  }
}

console.log(`\nstopped ${stopped} process(es). safe to run \`pnpm start\` now.`);

// Report the engine we are about to launch, because "which Chromium is this?" is the
// question that matters after an upgrade.
try {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const v = pkg.devDependencies?.electron || 'unknown';
  console.log(`\nthis checkout will launch Electron ${v.replace(/^[^\d]*/, '')}`);
  if (!existsSync(resolve(ROOT, 'app/.build/meta.json'))) {
    console.log('note: app/.build is missing — run `pnpm build:electron` first.');
  }
} catch { /* reporting only */ }
