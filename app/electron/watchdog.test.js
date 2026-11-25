'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');

const {
  createWatchdog,
  STATUS,
  PROBE,
  DEFAULT_POLL_MS,
  DEFAULT_SOCKET_CLOSED_MS,
  DEFAULT_NAV_GRACE_MS,
} = require('./watchdog.js');

test('watchdog: requires webContents on construction', () => {
  assert.throws(() => createWatchdog(), /webContents is required/);
  assert.throws(() => createWatchdog({}), /webContents is required/);
});

test('watchdog: PROBE script is valid javascript', () => {
  assert.doesNotThrow(() => {
    new vm.Script(PROBE);
  });
});

test('watchdog: classifies missing answer as NOT_PROTECTED', async () => {
  const fakeWc = {
    executeJavaScript: async () => null,
    reload: () => {},
  };
  const wd = createWatchdog({ webContents: fakeWc });
  const snapshot = await wd.pollNow();
  assert.strictEqual(snapshot.status, STATUS.NOT_PROTECTED);
  assert.match(snapshot.reason, /no-page-state/);
  wd.destroy();
});

test('watchdog: classifies missing shim as NOT_PROTECTED', async () => {
  const fakeWc = {
    executeJavaScript: async () => ({ ok: true, hasWai: false, state: null }),
    reload: () => {},
  };
  const wd = createWatchdog({ webContents: fakeWc });
  const snapshot = await wd.pollNow();
  assert.strictEqual(snapshot.status, STATUS.NOT_PROTECTED);
  assert.strictEqual(snapshot.reason, 'shim missing (document replaced, or injection lost)');
  wd.destroy();
});

test('watchdog: classifies unwrapped hook as NOT_PROTECTED', async () => {
  const fakeWc = {
    executeJavaScript: async () => ({
      ok: true,
      hasWai: true,
      state: { generation: 1, hookAlive: false },
      vendorAlive: true,
    }),
    reload: () => {},
  };
  const wd = createWatchdog({ webContents: fakeWc });
  const snapshot = await wd.pollNow();
  assert.strictEqual(snapshot.status, STATUS.NOT_PROTECTED);
  assert.strictEqual(snapshot.reason, 'wsHook is not wrapped');
  wd.destroy();
});

test('watchdog: CRIT-04 detects missing vendor libraries (pako, Pbf)', async () => {
  const fakeWc = {
    executeJavaScript: async () => ({
      ok: true,
      hasWai: true,
      state: { generation: 1, hookAlive: true },
      vendorAlive: false,
    }),
    reload: () => {},
  };
  const wd = createWatchdog({ webContents: fakeWc });
  const snapshot = await wd.pollNow();
  assert.strictEqual(snapshot.status, STATUS.NOT_PROTECTED);
  assert.strictEqual(snapshot.reason, 'vendor dependencies missing');
  wd.destroy();
});

test('watchdog: classifies healthy state as PROTECTED', async () => {
  const fakeWc = {
    executeJavaScript: async () => ({
      ok: true,
      hasWai: true,
      state: { generation: 1, hookAlive: true, socketState: 1 },
      vendorAlive: true,
      wd: { blocked: 3, interceptionWorking: true },
    }),
    reload: () => {},
  };
  const wd = createWatchdog({ webContents: fakeWc });
  const snapshot = await wd.pollNow();
  assert.strictEqual(snapshot.status, STATUS.PROTECTED);
  assert.strictEqual(snapshot.reason, 'hook armed');
  assert.strictEqual(snapshot.blocked, 3);
  assert.strictEqual(snapshot.interceptionWorking, true);
  wd.destroy();
});

test('watchdog: detects socket closed beyond threshold as RECONNECTING', async () => {
  let currentTime = 10000;
  const fakeWc = {
    executeJavaScript: async () => ({
      ok: true,
      hasWai: true,
      state: { generation: 1, hookAlive: true, socketState: 3 },
      vendorAlive: true,
    }),
    reload: () => {},
  };
  const wd = createWatchdog({
    webContents: fakeWc,
    socketClosedMs: 5000,
    now: () => currentTime,
  });

  // First poll when closed
  let snapshot = await wd.pollNow();
  // Initially within grace period
  assert.strictEqual(snapshot.status, STATUS.PROTECTED);

  // Advance time beyond threshold
  currentTime += 6000;
  snapshot = await wd.pollNow();
  assert.strictEqual(snapshot.status, STATUS.RECONNECTING);
  assert.strictEqual(snapshot.reason, 'socket closed');
  wd.destroy();
});
