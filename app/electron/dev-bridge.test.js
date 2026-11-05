'use strict';
// Tests for the dev hot-reload decision logic. Run: npm test
//
// The rule that actually matters: a shell edit must NEVER be hot-injected, because a
// live renderer would keep the old preload while running new bundles — the torn-context
// state the watchdog exists to catch. These tests pin that down.

const test = require('node:test');
const assert = require('node:assert');

const { DevBridge, classifyChange, normalizeChange } = require('./dev-bridge.js');

test('upstream core/ and lib/ edits are hot (re-inject, no relaunch)', () => {
  assert.strictEqual(classifyChange(['core/interception.js']).scope, 'bundles');
  assert.strictEqual(classifyChange(['lib/pako.js']).scope, 'bundles');
  assert.strictEqual(classifyChange(['core/parsing/protobuf/WAProto.js']).scope, 'bundles');
});

test('the page shim is hot, because it is bundled rather than loaded as shell code', () => {
  assert.strictEqual(classifyChange(['app/electron/shim.js']).scope, 'bundles');
});

test('styles.css and manifest.json are hot', () => {
  assert.strictEqual(classifyChange(['styles.css']).scope, 'bundles');
  assert.strictEqual(classifyChange(['manifest.json']).scope, 'bundles');
});

test('shell edits force a relaunch', () => {
  for (const f of ['app/electron/main.js', 'app/electron/preload.js',
                   'app/electron/watchdog.js', 'app/electron/tray.js',
                   'app/electron/prefs-store.js']) {
    assert.strictEqual(classifyChange([f]).scope, 'app', `${f} should force a relaunch`);
  }
});

test('package.json forces a relaunch (dependencies, main entry)', () => {
  assert.strictEqual(classifyChange(['package.json']).scope, 'app');
});

test('a shell edit wins even when mixed with bundle edits', () => {
  // The dangerous case: if bundles won, the renderer would hot-inject new page code
  // while still running the old preload.
  const r = classifyChange(['core/ui.js', 'app/electron/preload.js']);
  assert.strictEqual(r.scope, 'app');
  assert.match(r.reason, /preload\.js/);
});

test('a shell edit wins over the patch record too', () => {
  assert.strictEqual(classifyChange(['patches/manifest.json', 'app/electron/main.js']).scope, 'app');
});

test('irrelevant files are ignored rather than triggering a reload storm', () => {
  for (const f of ['docs/ELECTRON_APP_PLAN.md', 'README.md', '.gitignore',
                   'app/electron/prefs-store.test.js']) {
    assert.strictEqual(classifyChange([f]).scope, 'none', `${f} should be ignored`);
  }
});

test('an empty change list is a no-op', () => {
  assert.strictEqual(classifyChange([]).scope, 'none');
  assert.strictEqual(classifyChange(null).scope, 'none');
  assert.strictEqual(classifyChange(undefined).scope, 'none');
});

test('a dev server that sends a raw changed[] list is understood', () => {
  assert.deepStrictEqual(
    normalizeChange({ changed: ['core/interception.js'] }),
    { scope: 'bundles', reason: 'bundles: core/interception.js' }
  );
});

test('a dev server that sends an explicit scope is trusted', () => {
  assert.deepStrictEqual(
    normalizeChange({ scope: 'app', reason: 'manual' }),
    { scope: 'app', reason: 'manual' }
  );
});

test('junk from the dev server is ignored, not thrown', () => {
  for (const junk of [null, undefined, 'hello', 42, {}, { scope: 'nonsense' }]) {
    assert.strictEqual(normalizeChange(junk), null);
  }
});

// ---------------------------------------------------------------- DevBridge

test('a bundles change triggers onReload exactly once per change', async () => {
  const seen = [];
  let reply = { changed: ['core/interception.js'] };
  const bridge = new DevBridge({
    url: 'http://127.0.0.1:1/',
    onReload: (c) => seen.push(c.scope),
    fetchImpl: async () => ({ ok: true, json: async () => reply }),
    setTimeoutImpl: () => 0,
  });

  await bridge.tick();
  assert.deepStrictEqual(seen, ['bundles']);

  // Same change again must not re-fire: the dev server only reports a new list on a
  // real edit, and a repeating change would reload in a loop.
  reply = { changed: ['core/interception.js'] };
  await bridge.tick();
  assert.deepStrictEqual(seen, ['bundles'], 'an unchanged list must not re-trigger');
});

test('a dead dev server never crashes the app and backs off quietly', async () => {
  let logged = 0;
  const bridge = new DevBridge({
    url: 'http://127.0.0.1:1',
    onReload: () => { throw new Error('must not be called'); },
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    setTimeoutImpl: () => 0,
    log: () => { logged++; },
  });

  for (let i = 0; i < 12; i++) await bridge.tick();
  assert.ok(logged <= 1, `expected at most one warning, got ${logged}`);
});

test('a throwing reload handler is contained', async () => {
  const bridge = new DevBridge({
    url: 'http://127.0.0.1:1',
    onReload: () => { throw new Error('handler exploded'); },
    fetchImpl: async () => ({ ok: true, json: async () => ({ scope: 'bundles' }) }),
    setTimeoutImpl: () => 0,
    log: () => {},
  });
  await bridge.tick();   // must not reject
});

test('stop() halts polling', async () => {
  let polls = 0;
  const bridge = new DevBridge({
    url: 'http://127.0.0.1:1',
    onReload: () => {},
    fetchImpl: async () => { polls++; return { ok: true, json: async () => ({}) }; },
    setTimeoutImpl: () => 0,
  });
  bridge.start();
  bridge.stop();
  await bridge.tick();
  assert.strictEqual(polls, 0, 'tick() after stop() must be inert');
});

test('a non-ok response is treated as no change', async () => {
  let fired = 0;
  const bridge = new DevBridge({
    url: 'http://127.0.0.1:1',
    onReload: () => { fired++; },
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    setTimeoutImpl: () => 0,
  });
  assert.strictEqual(await bridge.tick(), null);
  assert.strictEqual(fired, 0);
});
