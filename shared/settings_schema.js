;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else { root.WAISettingsSchema = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

  var GROUPS = Object.freeze([
    Object.freeze({ id: 'privacy', label: 'Privacy' }),
    Object.freeze({ id: 'messages', label: 'Messages' }),
    Object.freeze({ id: 'timing', label: 'Timing' }),
    Object.freeze({ id: 'app', label: 'App' }),
  ]);

  var SETTINGS = Object.freeze([
    Object.freeze({
      key: 'readConfirmationsHook',
      label: 'Block read receipts',
      caption: "Don't send read receipts",
      note: 'Blocks outgoing "read" ticks globally. Use "Mark as read" to send receipts manually.',
      type: 'boolean',
      default: true,
      group: 'privacy',
      scope: 'shared',
      quick: true,
      globalBinding: 'readConfirmationsHookEnabled',
    }),
    Object.freeze({
      key: 'onlineUpdatesHook',
      label: 'Block online / last seen',
      caption: 'Hide "Online" and "Last Seen"',
      note: 'Blocks initial presence probes; active replies may still reveal brief availability.',
      type: 'boolean',
      default: false,
      group: 'privacy',
      scope: 'shared',
      quick: true,
      globalBinding: 'onlineUpdatesHookEnabled',
    }),
    Object.freeze({
      key: 'typingUpdatesHook',
      label: 'Block typing indicators',
      caption: 'Hide "Typing..." and recording indicators',
      type: 'boolean',
      default: false,
      group: 'privacy',
      scope: 'shared',
      quick: true,
      globalBinding: 'typingUpdatesHookEnabled',
    }),
    Object.freeze({
      key: 'privacyScreenLockEnabled',
      label: 'Privacy Screen Lock',
      caption: 'Lock WhatsApp Web after inactivity or via shortcut',
      note: 'Requires entering a 4-digit local PIN to unlock after idle timeout.',
      type: 'boolean',
      default: false,
      group: 'privacy',
      scope: 'shared',
    }),
    Object.freeze({
      key: 'privacyScreenLockPIN',
      label: 'Privacy Screen Lock PIN',
      caption: '4-digit unlock PIN (stored as SHA-256 hash)',
      type: 'secret-hash',
      default: '',
      pinLength: 4,
      group: 'privacy',
      scope: 'shared',
      dependsOn: Object.freeze({ key: 'privacyScreenLockEnabled', value: true }),
    }),
    Object.freeze({
      key: 'privacyScreenLockIdleMinutes',
      label: 'Privacy Screen Lock Idle Minutes',
      caption: 'Auto-lock delay after inactivity',
      type: 'integer',
      default: 5,
      min: 1,
      max: 60,
      choices: Object.freeze([1, 5, 10, 15, 30, 60]),
      unit: 'minutes',
      group: 'privacy',
      scope: 'shared',
      dependsOn: Object.freeze({ key: 'privacyScreenLockEnabled', value: true }),
    }),
    Object.freeze({
      key: 'saveDeletedMsgs',
      label: 'Restore deleted messages',
      caption: 'Save deleted messages locally',
      note: 'Keeps revoked messages visible locally with a deleted indicator.',
      type: 'boolean',
      default: true,
      group: 'messages',
      scope: 'shared',
      globalBinding: 'saveDeletedMsgsHookEnabled',
    }),
    Object.freeze({
      key: 'showDeviceTypes',
      label: 'Show message device type',
      caption: 'Show phone or desktop badge on messages',
      type: 'boolean',
      default: true,
      group: 'messages',
      scope: 'shared',
      globalBinding: 'showDeviceTypesEnabled',
    }),
    Object.freeze({
      key: 'autoReceiptOnReplay',
      label: 'Auto-send receipts on reply',
      caption: 'Send pending read receipts automatically when replying',
      type: 'boolean',
      default: true,
      group: 'messages',
      scope: 'shared',
      globalBinding: 'autoReceiptOnReplay',
    }),
    Object.freeze({
      key: 'allowStatusDownload',
      label: 'Allow status downloading',
      caption: 'Show download button on photo and video statuses',
      type: 'boolean',
      default: true,
      group: 'messages',
      scope: 'shared',
      globalBinding: 'allowStatusDownload',
    }),
    Object.freeze({
      key: 'stealthVoiceNotes',
      label: 'Stealth voice notes',
      caption: 'Block "played" receipts on voice messages',
      type: 'boolean',
      default: false,
      group: 'messages',
      scope: 'shared',
      globalBinding: 'stealthVoiceNotesEnabled',
    }),
    Object.freeze({
      key: 'mediaAutoDownloadGuard',
      label: 'Media auto-download guard',
      caption: 'Hold automatic media fetching in incognito chats',
      type: 'boolean',
      default: false,
      group: 'messages',
      scope: 'shared',
      globalBinding: 'mediaAutoDownloadGuardEnabled',
    }),
    Object.freeze({
      key: 'showReadWarning',
      label: 'Warn before sending a receipt',
      caption: 'Highlight chats when read receipts are about to be sent',
      type: 'boolean',
      default: true,
      group: 'messages',
      scope: 'shared',
      globalBinding: 'showReadWarning',
    }),
    Object.freeze({
      key: 'safetyDelay',
      label: 'Safety delay',
      caption: 'Wait before sending manual read receipts so you can cancel',
      note: 'Applies when read receipts are blocked and you explicitly mark a chat read or reply.',
      type: 'integer',
      default: 0,
      min: 0,
      max: 30,
      choices: Object.freeze([0, 5, 10, 15, 20, 30]),
      unit: 'seconds',
      group: 'timing',
      scope: 'shared',
      globalBinding: 'safetyDelay',
    }),
    Object.freeze({
      key: 'autostart',
      label: 'Start automatically on login',
      caption: 'Launch desktop app automatically when signing in',
      type: 'boolean',
      default: false,
      group: 'app',
      scope: 'shell',
    }),
  ]);

  var BY_KEY = {};
  for (var i = 0; i < SETTINGS.length; i++) {
    BY_KEY[SETTINGS[i].key] = SETTINGS[i];
  }

  function getSpec(key) {
    return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? BY_KEY[key] : null;
  }

  function specsFor(scope) {
    var mode = scope || 'shared';
    if (mode === 'all') return SETTINGS.slice();
    return SETTINGS.filter(function (s) { return s.scope === mode; });
  }

  function allKeys(scope) {
    return specsFor(scope).map(function (s) { return s.key; });
  }

  function defaults(scope) {
    var specs = specsFor(scope || 'shared');
    var out = {};
    for (var j = 0; j < specs.length; j++) {
      out[specs[j].key] = specs[j].default;
    }
    return out;
  }

  function settingsFor(prefs) {
    if (!prefs || typeof prefs !== 'object') return [];
    return SETTINGS.filter(function (s) {
      return Object.prototype.hasOwnProperty.call(prefs, s.key);
    });
  }

  function quickToggles() {
    return SETTINGS.filter(function (s) { return s.quick === true; });
  }

  function numericRanges(scope) {
    var specs = scope === undefined ? SETTINGS : specsFor(scope);
    var out = {};
    for (var j = 0; j < specs.length; j++) {
      var s = specs[j];
      if (s.type !== 'integer' && (!s.choices || !s.choices.length)) continue;
      var min = typeof s.min === 'number' && isFinite(s.min)
        ? s.min
        : (s.choices && s.choices.length ? Math.min.apply(null, s.choices) : 0);
      var max = typeof s.max === 'number' && isFinite(s.max)
        ? s.max
        : (s.choices && s.choices.length ? Math.max.apply(null, s.choices) : 30);
      out[s.key] = { min: min, max: max };
    }
    return out;
  }

  function choiceLabel(value, spec) {
    if (value === 0) return 'Off';
    var unit = spec && spec.unit ? spec.unit : 'seconds';
    if (value === 1) {
      if (unit === 'minutes') return '1 minute';
      if (unit === 'seconds') return '1 second';
    }
    return value + ' ' + unit;
  }

  function coerceSetting(specOrKey, value, currentValue) {
    var spec = typeof specOrKey === 'string' ? getSpec(specOrKey) : specOrKey;
    if (!spec) return undefined;

    if (spec.type === 'boolean') {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    }

    if (spec.type === 'integer') {
      var n = typeof value === 'number' ? value : parseInt(value, 10);
      if (!isFinite(n)) return undefined;
      n = Math.trunc(n);
      var min = typeof spec.min === 'number' && isFinite(spec.min)
        ? spec.min
        : (spec.choices && spec.choices.length ? Math.min.apply(null, spec.choices) : 0);
      var max = typeof spec.max === 'number' && isFinite(spec.max)
        ? spec.max
        : (spec.choices && spec.choices.length ? Math.max.apply(null, spec.choices) : 30);
      if (n < min || n > max) {
        return currentValue !== undefined ? currentValue : spec.default;
      }
      return n;
    }

    if (spec.type === 'secret-hash') {
      if (typeof value !== 'string') return undefined;
      var trimmed = value.trim();
      if (trimmed === '') return '';
      if (SHA256_HEX_RE.test(trimmed)) return trimmed.toLowerCase();
      return undefined;
    }

    return value === undefined ? currentValue : value;
  }

  function validatePatch(patch, currentPrefs, scope) {
    var mode = scope || 'shared';
    var base = defaults(mode);
    var next = {};
    var k;
    for (k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) {
        next[k] = (currentPrefs && Object.prototype.hasOwnProperty.call(currentPrefs, k))
          ? coerceSetting(k, currentPrefs[k], base[k])
          : base[k];
        if (next[k] === undefined) next[k] = base[k];
      }
    }

    var applied = [];
    var rejected = [];
    var validatedPatch = {};
    if (!patch || typeof patch !== 'object') {
      return { prefs: next, patch: validatedPatch, applied: applied, rejected: rejected };
    }

    var keys = Object.keys(patch);
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      var spec = getSpec(key);
      if (!spec || (mode !== 'all' && spec.scope !== mode)) {
        rejected.push(key);
        continue;
      }
      var coerced = coerceSetting(spec, patch[key], next[key]);
      if (coerced === undefined) {
        rejected.push(key);
        continue;
      }
      next[key] = coerced;
      validatedPatch[key] = coerced;
      applied.push(key);
    }

    return { prefs: next, patch: validatedPatch, applied: applied, rejected: rejected };
  }

  return {
    GROUPS: GROUPS,
    SETTINGS: SETTINGS,
    getSpec: getSpec,
    specsFor: specsFor,
    allKeys: allKeys,
    defaults: defaults,
    settingsFor: settingsFor,
    quickToggles: quickToggles,
    numericRanges: numericRanges,
    choiceLabel: choiceLabel,
    coerceSetting: coerceSetting,
    validatePatch: validatePatch,
    SHA256_HEX_RE: SHA256_HEX_RE,
  };
});
