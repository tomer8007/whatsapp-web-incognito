#!/usr/bin/env node
// Stop stale WAIncognito app instances (and dev watchers) holding the single-instance lock.
//
//   node scripts/kill.mjs           stop stale WAIncognito/Electron instances
//   node scripts/kill.mjs --dry     list what would be stopped, stop nothing
//   node scripts/kill.mjs --all     also stop dev watchers (scripts/dev.mjs)
//
// Why this exists: closing the app window hides the shell to the tray instead of
// quitting. The hidden process then holds the single-instance lock, so the next launch
// only focuses it and prints "another instance is already running" — which reads exactly
// like a crash. This script ends that ambiguity: it finds WAIncognito's own Electron
// processes and stops them.

import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ALL = argv.includes('--all');

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', OFF = '\x1b[0m';
const ok = (msg) => console.log(`  ${GREEN}ok${OFF}   ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}warn${OFF} ${msg}`);

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

/** WAIncognito app instances: electron processes whose command line names the app. */
function isOurApp(cmd) {
  if (!cmd) return false;
  const c = cmd.toLowerCase();
  if (!c.includes('electron')) return false;
  return c.includes('waincognito') || c.includes('whatsapp-web-incognito') || c.includes('wai-test');
}

/** Dev watchers: `node scripts/dev.mjs` processes (the 'watch' script). */
function isWatcher(cmd) {
  if (!cmd) return false;
  const c = cmd.toLowerCase();
  return c.includes('scripts/dev.mjs');
}

console.log('stopping stale WAIncognito instance(s)');
const procs = listProcesses();
const ours = procs.filter((p) => isOurApp(p.cmd) && !SELF.has(p.pid));
const watchers = ALL ? procs.filter((p) => isWatcher(p.cmd) && !SELF.has(p.pid)) : [];
const targets = [...ours, ...watchers];

if (!targets.length) { ok('none running'); process.exit(0); }

console.log(`  found ${targets.length} stale process(es):`);
for (const p of targets) {
  const short = p.cmd.length > 96 ? `${p.cmd.slice(0, 96)}...` : p.cmd;
  console.log(`       ${String(p.pid).padStart(7)}  ${short}`);
}

if (DRY) {
  warn('--dry: nothing stopped');
  process.exit(0);
}

let stopped = 0;
for (const p of targets) {
  if (killPid(p.pid)) {
    stopped++;
    console.log(`  stopped ${p.pid}`);
  } else {
    console.log(`  could not stop ${p.pid} (already gone, or not permitted)`);
  }
}

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

console.log(`  stopped ${stopped} process(es)`);
