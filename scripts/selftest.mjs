#!/usr/bin/env node
// `pnpm selftest` — run the REAL app and print what the real window received.
//
// Runs the actual production path (injection + session policy), unlike scripts/doctor.cjs
// which builds its own bare window. That distinction matters: a bare-window probe reported
// "OK" while the real app was still showing WhatsApp's browser-gate page, because the
// browser was constructed before the user agent was applied and had already captured the
// stock Electron UA.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

spawnSync(process.execPath, ['scripts/kill-stale.mjs'], { cwd: ROOT, stdio: 'inherit' });

const r = spawnSync(join(ROOT, 'node_modules/.bin/electron'), ['.'], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: Number(process.env.WAI_SELFTEST_WAIT || 15000) + 30000,
  env: { ...process.env, WAI_SELFTEST: '1' },
});

const out = `${r.stdout || ''}`;
const noise = /GetVSync|gl_surface|nss_util|libva|dbus|Fontconfig|zygote|GPU process|Network service|Gtk:/;
for (const l of out.split('\n')) if (l.trim() && !noise.test(l)) console.log(l);

const status = r.status;
console.log('\n== result ==');
if (status === 0) console.log('  HEALTHY — WhatsApp served the app.');
else if (status === 1) console.log('  GATED — WhatsApp is refusing this client. Read the text dump above.');
else console.log(`  NOTHING RENDERED (exit ${status}). Read the text dump above.`);
process.exit(status === 0 ? 0 : 1);
