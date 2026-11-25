;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else { root.WAIPrivacyLock = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // SHA-256 of a 4-digit PIN, as hex — the form shared/settings_schema.js coerces
  // "secret-hash" values into and the Electron shim validates on save.
  function hashPin(pin) {
    if (typeof pin !== 'string') pin = (pin == null ? '' : String(pin));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  // Idle-timer state machine for the page privacy screen lock (core/ui.js).
  // Pure state + callbacks so it can be tested under node:test with mocked timers.
  function PrivacyIdleLock(deps) {
    deps = deps || {};
    this.onLock = typeof deps.onLock === 'function' ? deps.onLock : function () {};
    this.isLocked = deps.isLocked || function () { return false; };
    this.isEnabled = deps.isEnabled || function () { return false; };
    this.getIdleMinutes = deps.getIdleMinutes || function () { return 5; };
    this.timer = null;
  }

  PrivacyIdleLock.prototype.disarm = function () {
    clearTimeout(this.timer);
    this.timer = null;
  };

  PrivacyIdleLock.prototype.arm = function () {
    this.disarm();
    if (!this.isEnabled() || this.isLocked()) return;
    var self = this;
    this.timer = setTimeout(function () { self.lockNow(); }, this.getIdleMinutes() * 60 * 1000);
  };

  PrivacyIdleLock.prototype.markActivity = function () {
    this.arm();
  };

  PrivacyIdleLock.prototype.lockNow = function () {
    if (!this.isLocked() && this.isEnabled()) this.onLock();
  };

  return { hashPin: hashPin, PrivacyIdleLock: PrivacyIdleLock };
});
