'use strict';
// Tests for linux desktop integration. Run: npm test
//
// The bar is "never strand the user and never crash startup": every D-Bus and
// portal interaction must degrade to today's behaviour when tools, portal, or a
// tray host are missing.

const test = require('node:test');
const assert = require('node:assert');

const di = require('./desktop-integration.js');

test('parseNameHasOwner accepts gdbus and dbus-send affirmative replies', () => {
  assert.strictEqual(di.parseNameHasOwner('(true,)'), true);
  assert.strictEqual(di.parseNameHasOwner('( true )'), true);
  assert.strictEqual(di.parseNameHasOwner('method return time=1.2 sender=:1.1 -> destination=:1.2 boolean true'), true);
});

test('parseNameHasOwner rejects negative and empty replies', () => {
  assert.strictEqual(di.parseNameHasOwner('(false,)'), false);
  assert.strictEqual(di.parseNameHasOwner('boolean false'), false);
  assert.strictEqual(di.parseNameHasOwner(''), false);
  assert.strictEqual(di.parseNameHasOwner(null), false);
});

test('detectDesktop spots GNOME in either env var', () => {
  assert.strictEqual(di.detectDesktop({ XDG_CURRENT_DESKTOP: 'GNOME' }).isGnome, true);
  assert.strictEqual(di.detectDesktop({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }).isGnome, true);
  assert.strictEqual(di.detectDesktop({ DESKTOP_SESSION: 'gnome' }).isGnome, true);
  assert.strictEqual(di.detectDesktop({ XDG_CURRENT_DESKTOP: 'KDE' }).isGnome, false);
  assert.strictEqual(di.detectDesktop({}).isGnome, false);
});

test('hasStatusNotifierWatcher never throws and returns a stable shape', () => {
  di.resetWatcherCache();
  const r = di.hasStatusNotifierWatcher();
  assert.strictEqual(typeof r.present, 'boolean');
  assert.ok(r.method === null || typeof r.method === 'string');
  // Cached: the second call is the same object, no second D-Bus round-trip.
  assert.strictEqual(di.hasStatusNotifierWatcher(), r);
  di.resetWatcherCache();
});

test('hasAppIndicatorLib never throws and returns a stable shape', () => {
  const r = di.hasAppIndicatorLib();
  assert.strictEqual(typeof r.present, 'boolean');
  assert.ok(Array.isArray(r.found));
});

test('requestBackground never rejects, even where no portal exists', async () => {
  const r = await di.requestBackground({ log: { log() {}, warn() {}, debug() {} } });
  assert.strictEqual(typeof r.ok, 'boolean');
});

test('autostart file path honours XDG_CONFIG_HOME', () => {
  const p = di.autostartFilePath({ XDG_CONFIG_HOME: '/tmp/wai-test-config' });
  assert.strictEqual(p, '/tmp/wai-test-config/autostart/waincognito.desktop');
  const home = di.autostartFilePath({});
  assert.ok(home.endsWith('/.config/autostart/waincognito.desktop'), `got: ${home}`);
});

test('desktop entry is a valid-looking autostart file', () => {
  const entry = di.buildDesktopEntry('/opt/WAIncognito.AppImage');
  assert.ok(entry.startsWith('[Desktop Entry]\n'), 'header first');
  assert.ok(entry.includes('Type=Application'), 'type');
  assert.ok(entry.includes('Exec=/opt/WAIncognito.AppImage'), 'exec line');
  assert.ok(entry.includes('X-GNOME-Autostart-enabled=true'), 'GNOME flag');
});

test('autostart file round-trips through write and remove', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wai-autostart-'));
  const file = path.join(dir, 'autostart', 'waincognito.desktop');
  assert.strictEqual(di.writeAutostartFile(file, di.buildDesktopEntry('/x')), true);
  assert.strictEqual(fs.readFileSync(file, 'utf8').includes('Exec=/x'), true);
  assert.strictEqual(di.removeAutostartFile(file), true);
  assert.strictEqual(fs.existsSync(file), false);
  assert.strictEqual(di.removeAutostartFile(file), true); // absent is success
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- notification entry
// The file name is the join key the notification daemon matches on, so it is derived
// from the app id and nothing else. Getting this wrong reproduces the original symptom:
// no popup, no error, no trace.

test('applications dir honours XDG_DATA_HOME', () => {
  const p = di.applicationsDir({ XDG_DATA_HOME: '/tmp/wai-test-data' });
  assert.strictEqual(p, '/tmp/wai-test-data/applications');
  const home = di.applicationsDir({});
  assert.ok(home.endsWith('/.local/share/applications'), `got: ${home}`);
});

test('notification entry names the app id and declares InstantMessaging', () => {
  const entry = di.buildNotificationEntry({
    appId: 'com.wa-incognito.app',
    exec: '/opt/WAIncognito.AppImage',
    iconName: 'waincognito',
    name: 'Whatsapp Incognito',
    comment: 'Be invisible on WhatsApp Web',
  });
  assert.ok(entry.startsWith('[Desktop Entry]\n'), 'header first');
  assert.ok(entry.includes('Type=Application'), 'type');
  assert.ok(entry.includes('Exec=/opt/WAIncognito.AppImage'), 'exec line');
  assert.ok(entry.includes('Icon=waincognito'), 'icon line');
  // Without a StartupWMClass the daemon cannot tie the entry to the running window.
  assert.ok(entry.includes('StartupWMClass=com.wa-incognito.app'), 'startup wm class');
  assert.ok(entry.includes('Categories=Network;InstantMessaging;'), 'categories');
  // It exists for notification identity, not to add a second launcher to the menus.
  assert.ok(entry.includes('NoDisplay=true'), 'hidden from menus');
});

test('ensureNotificationEntry writes the entry under the app id, and is idempotent', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wai-notif-'));
  const env = { XDG_DATA_HOME: dir };
  const args = {
    env, appId: 'com.wa-incognito.app', exec: '/x', iconName: 'waincognito',
    name: 'Whatsapp Incognito', comment: 'c',
  };
  assert.strictEqual(di.ensureNotificationEntry(args), true);
  const file = path.join(dir, 'applications', 'com.wa-incognito.app.desktop');
  assert.strictEqual(fs.existsSync(file), true, 'written as <appId>.desktop');

  // Re-running is the normal case (every launch) and must be a no-op, not an error.
  const first = fs.statSync(file).mtimeMs;
  assert.strictEqual(di.ensureNotificationEntry(args), true);
  assert.strictEqual(fs.statSync(file).mtimeMs, first, 'unchanged entry is not rewritten');

  // A changed app id / exec is picked up on the next launch without an uninstall.
  assert.strictEqual(di.ensureNotificationEntry({ ...args, exec: '/y' }), true);
  assert.ok(fs.readFileSync(file, 'utf8').includes('Exec=/y'), 'stale entry is refreshed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unwritable location reports failure instead of throwing', () => {
  // A read-only home must not stop the app from starting; the caller only logs.
  // A file where a directory is expected fails fast with ENOTDIR. Deliberately NOT
  // /proc/self: mkdir under procfs hangs indefinitely here, which wedges the suite.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wai-ro-'));
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a directory', 'utf8');
  const bad = di.ensureNotificationEntry({
    env: { XDG_DATA_HOME: blocker },
    appId: 'com.wa-incognito.app', exec: '/x', iconName: 'waincognito',
    name: 'n', comment: 'c',
  });
  assert.strictEqual(bad, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
