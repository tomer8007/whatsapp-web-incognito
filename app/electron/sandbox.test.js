'use strict';
// Unit tests for app/electron/sandbox.js — the SUID helper check behind the
// `--no-sandbox` decision. No Electron imports, so this runs under plain
// `node --test`. File-system cases go through a temp dir; the uid matrix uses
// fake stats because only root can chown.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  sandboxHelperPath,
  isHelperStatConfigured,
  isSandboxHelperConfigured,
} = require('./sandbox.js');

test('helper lives next to the executable', () => {
  assert.equal(
    sandboxHelperPath('/opt/Whatsapp Incognito/waincognito'),
    '/opt/Whatsapp Incognito/chrome-sandbox',
  );
});

test('only root-owned 4755 counts as configured', () => {
  assert.equal(isHelperStatConfigured({ uid: 0, mode: 0o1004755 }), true);
  assert.equal(isHelperStatConfigured({ uid: 0, mode: 0o100755 }), false); // the .deb bug: root but 755
  assert.equal(isHelperStatConfigured({ uid: 1000, mode: 0o1004755 }), false); // setuid but not root
  assert.equal(isHelperStatConfigured({ uid: 1000, mode: 0o100755 }), false); // dev checkout
  assert.equal(isHelperStatConfigured(null), false);
  assert.equal(isHelperStatConfigured({}), false);
});

test('missing helper is not configured, never throws', () => {
  assert.equal(
    isSandboxHelperConfigured(path.join(os.tmpdir(), 'wai-no-such-dir', 'electron')),
    false,
  );
});

test('real file modes are read honestly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wai-sandbox-'));
  const fakeExec = path.join(dir, 'waincognito');
  fs.writeFileSync(fakeExec, 'x');
  const helper = path.join(dir, 'chrome-sandbox');
  fs.writeFileSync(helper, 'x');
  fs.chmodSync(helper, 0o755);
  // Running as non-root the uid check fails; as root the mode check fails.
  // Either way a plain 755 helper must NOT read as configured.
  assert.equal(isSandboxHelperConfigured(fakeExec), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
