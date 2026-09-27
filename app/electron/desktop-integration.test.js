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
