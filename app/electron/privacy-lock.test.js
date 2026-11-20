'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { hashPin, PrivacyIdleLock } = require('../../shared/privacy_lock.js');

test('hashPin hashes the PIN string with SHA-256 into hex', async () => {
  const hashHex = await hashPin('1234');
  // sha256("1234")
  assert.strictEqual(hashHex, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
});

test('idle timer re-arms on activity and locks after the idle window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const state = { locked: false };
  const lock = new PrivacyIdleLock({
    onLock: () => { state.locked = true; },
    isLocked: () => state.locked,
    isEnabled: () => true,
    getIdleMinutes: () => 5,
  });

  // Initial start
  lock.arm();

  // Advance 4 minutes
  t.mock.timers.tick(4 * 60 * 1000);
  assert.strictEqual(state.locked, false);

  // Reset timer (simulating user activity)
  lock.markActivity();

  // Advance 4 minutes (total 8 from start, but we reset at 4)
  t.mock.timers.tick(4 * 60 * 1000);
  assert.strictEqual(state.locked, false);

  // Advance 2 more minutes (total 6 since last reset)
  t.mock.timers.tick(2 * 60 * 1000);
  assert.strictEqual(state.locked, true);

  t.mock.timers.reset();
});

test('the lock does not arm or fire while disabled, and disarm clears the timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const state = { locked: false, enabled: false };
  const lock = new PrivacyIdleLock({
    onLock: () => { state.locked = true; },
    isLocked: () => state.locked,
    isEnabled: () => state.enabled,
    getIdleMinutes: () => 5,
  });

  lock.arm();
  t.mock.timers.tick(10 * 60 * 1000);
  assert.strictEqual(state.locked, false, 'disabled: never locks');

  state.enabled = true;
  lock.arm();
  assert.ok(lock.timer !== null, 'armed while enabled');

  lock.lockNow();
  assert.strictEqual(state.locked, true);
  lock.disarm();
  assert.strictEqual(lock.timer, null);

  t.mock.timers.reset();
});
