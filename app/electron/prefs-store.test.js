'use strict';
// Unit tests for the prefs store. Run: node --test app/electron/
//
// The store is the only piece of the shell with real logic and no Electron dependency,
// so it is the one piece that can be tested without a window.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PrefsStore, coerce } = require('./prefs-store.js');
const meta = require('../.build/meta.json');

const DEFAULTS = meta.prefs;   // derived from background.js by the build

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wai-prefs-'));
}

test('defaults come from background.js and are complete', () => {
  assert.strictEqual(Object.keys(DEFAULTS).length, 9);
  assert.strictEqual(DEFAULTS.readConfirmationsHook, true);
  assert.strictEqual(DEFAULTS.safetyDelay, 0);
  for (const [k, v] of Object.entries(DEFAULTS)) {
    assert.ok(['boolean', 'number'].includes(typeof v), `${k} has unexpected type ${typeof v}`);
  }
});

test('a fresh store returns exactly the defaults', () => {
  const s = new PrefsStore(tmpdir(), DEFAULTS);
  assert.deepStrictEqual(s.get(), DEFAULTS);
});

test('a partial patch is applied and persisted across a reload', () => {
  const dir = tmpdir();
  const a = new PrefsStore(dir, DEFAULTS);
  const r = a.set({ readConfirmationsHook: false, safetyDelay: 7 });
  assert.deepStrictEqual(r.applied, ['readConfirmationsHook', 'safetyDelay']);
  assert.deepStrictEqual(r.rejected, []);

  const b = new PrefsStore(dir, DEFAULTS);   // simulates an app restart
  assert.strictEqual(b.get().readConfirmationsHook, false);
  assert.strictEqual(b.get().safetyDelay, 7);
  // untouched keys keep their defaults
  assert.strictEqual(b.get().showDeviceTypes, true);
});

test('unknown keys are rejected, not stored', () => {
  const s = new PrefsStore(tmpdir(), DEFAULTS);
  const r = s.set({ totallyBogusKey: 1, onlineUpdatesHook: true });
  assert.deepStrictEqual(r.applied, ['onlineUpdatesHook']);
  assert.deepStrictEqual(r.rejected, ['totallyBogusKey']);
  assert.ok(!('totallyBogusKey' in s.get()));
});

test('a corrupt prefs file is quarantined, not silently ignored', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'prefs.json');
  fs.writeFileSync(file, '{ this is not json');
  const s = new PrefsStore(dir, DEFAULTS);
  assert.deepStrictEqual(s.get(), DEFAULTS, 'should fall back to defaults');
  assert.ok(fs.existsSync(`${file}.corrupt`), 'previous file should be kept for recovery');
});

test('a missing prefs file is not treated as corruption', () => {
  const dir = tmpdir();
  const s = new PrefsStore(dir, DEFAULTS);
  assert.deepStrictEqual(s.get(), DEFAULTS);
  assert.ok(!fs.existsSync(path.join(dir, 'prefs.json.corrupt')));
});

test('a key added by a newer upstream release picks up its default', () => {
  const dir = tmpdir();
  fs.writeFileSync(
    path.join(dir, 'prefs.json'),
    JSON.stringify({ version: 1, prefs: { readConfirmationsHook: false } })
  );
  const s = new PrefsStore(dir, DEFAULTS);
  const got = s.get();
  assert.strictEqual(got.readConfirmationsHook, false, 'stored value should win');
  assert.strictEqual(got.allowStatusDownload, DEFAULTS.allowStatusDownload, 'missing key gets default');
});

test('safetyDelay is clamped to the 0-30 range ui.js offers', () => {
  assert.strictEqual(coerce(0, 999, 0), 0, 'out of range keeps the current value');
  assert.strictEqual(coerce(0, -5, 3), 3, 'negative keeps the current value');
  assert.strictEqual(coerce(0, 30, 0), 30, 'upper bound is allowed');
  assert.strictEqual(coerce(0, '12', 0), 12, 'numeric strings are accepted');
  assert.strictEqual(coerce(0, 'abc', 4), undefined, 'garbage is rejected');
});

test('boolean coercion rejects non-boolean junk', () => {
  assert.strictEqual(coerce(true, 'true', true), true);
  assert.strictEqual(coerce(false, 'false', false), false);
  assert.strictEqual(coerce(true, 42, true), undefined);
});

test('a wrong-typed value is rejected and the stored value survives', () => {
  const dir = tmpdir();
  const s = new PrefsStore(dir, DEFAULTS);
  s.set({ onlineUpdatesHook: true });
  const r = s.set({ onlineUpdatesHook: 'nonsense' });
  assert.deepStrictEqual(r.rejected, ['onlineUpdatesHook']);
  assert.strictEqual(s.get().onlineUpdatesHook, true, 'previous value must survive');
});

test('get() returns a copy that cannot mutate internal state', () => {
  const s = new PrefsStore(tmpdir(), DEFAULTS);
  const snapshot = s.get();
  snapshot.readConfirmationsHook = false;
  assert.strictEqual(s.get().readConfirmationsHook, true);
});

test('reset() restores every default', () => {
  const dir = tmpdir();
  const s = new PrefsStore(dir, DEFAULTS);
  s.set({ readConfirmationsHook: false, safetyDelay: 12, saveDeletedMsgs: true });
  s.reset();
  assert.deepStrictEqual(s.get(), DEFAULTS);
  assert.deepStrictEqual(new PrefsStore(dir, DEFAULTS).get(), DEFAULTS, 'and persists it');
});

test('the constructor refuses to run without derived defaults', () => {
  assert.throws(() => new PrefsStore(tmpdir(), null), /defaults/);
  assert.throws(() => new PrefsStore(null, DEFAULTS), /userDataDir/);
});

test('no temp file is left behind after a write', () => {
  const dir = tmpdir();
  const s = new PrefsStore(dir, DEFAULTS);
  s.set({ safetyDelay: 3 });
  assert.ok(!fs.existsSync(path.join(dir, 'prefs.json.tmp')), 'tmp file should be renamed away');
});
