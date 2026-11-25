// Page-world shim. Injected by app/electron/preload.js BEFORE any upstream file.
//
// Purpose: let core/ and shared/ run with a tiny runtime API shim covering:
//   - chrome.runtime.getURL(path)            inlined data: URIs (C4 CSP-safe)
//   - browser.runtime.sendMessage({name:...}) synchronous prefs, whitelist, notes, export
//
// THREE ORDERING FACTS make this work:
//  1. ui.js checks `chrome` -> `browser` before executing.
//  2. C4: WhatsApp serves a strict CSP, so images are data: URIs and styles are inline.
//  3. getOptions answers SYNCHRONOUSLY from BOOTSTRAP (or build-time defaults fallback)
//     and stays live-synced via preload pushes.
//
// This file is a build input, not a build output. scripts/build.mjs substitutes the
// four build-time literals marked below (assets, prefs, version, bundle order) and then
// the preload evaluates window.__WAI_BOOTSTRAP__ and the result via webFrame.executeJavaScript.
//
// Do not spell a placeholder token literally anywhere else in this file, including in
// comments: the substitution is a first-occurrence replace.
(function () {
  'use strict';

  var ASSETS = __WAI_ASSETS__;        // { "images/phone.svg": "data:image/svg+xml;base64,..." }
  var BUILD_DEFAULTS = __WAI_PREFS__; // shared defaults from shared/settings_schema.js
  var VERSION = __WAI_VERSION__;
  var ORDER = __WAI_ORDER__;          // { critical: [...], rest: [...], ui: [...], deferred: [...] }

  var host = window.__WAI_IPC__ || null;   // contextBridge handle, may be absent
  var loaded = { critical: false, rest: false, ui: false, deferred: false };

  var BOOT = (window.__WAI_BOOTSTRAP__ && typeof window.__WAI_BOOTSTRAP__ === 'object')
    ? window.__WAI_BOOTSTRAP__
    : null;
  var PREFS = Object.assign({}, BUILD_DEFAULTS);
  var WHITELIST = Object.assign({}, (BOOT && BOOT.whitelist && typeof BOOT.whitelist === 'object') ? BOOT.whitelist : {});
  var NOTES = Object.assign({}, (BOOT && BOOT.notes && typeof BOOT.notes === 'object') ? BOOT.notes : {});

  // ---------------------------------------------------------------- failure banner
  var banner = null;
  function reportFailure(reason, detail) {
    try {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'wai-failure-banner';
        banner.setAttribute('style', [
          'position:fixed', 'z-index:2147483647', 'left:0', 'right:0', 'bottom:0',
          'background:#7f1d1d', 'color:#fff', 'font:13px/1.5 system-ui,sans-serif',
          'padding:10px 14px', 'white-space:pre-wrap', 'box-shadow:0 -2px 12px rgba(0,0,0,.4)'
        ].join(';'));
        (document.body || document.documentElement).appendChild(banner);
      }
      banner.textContent = 'WAIncognito is NOT protecting you: ' + reason +
        (detail ? '\n' + detail : '') +
        '\nOpen the app window and check its status. Receipts may be leaking.';
      banner.style.display = 'block';
    } catch (e) { /* nothing left to do */ }
    if (host && host.reportFailure) { try { host.reportFailure(reason, detail || ''); } catch (e) {} }
  }
  function clearFailure() {
    try { if (banner) banner.style.display = 'none'; } catch (e) {}
  }

  // ---------------------------------------------------------------- liveness
  var gen = 0;
  var framesIn = 0, framesOut = 0, lastFrameAt = 0;
  var state = {
    booted: true,
    href: location.href,
    userAgent: navigator.userAgent,
    generation: 0,
    loaded: loaded,
    hookAlive: false,
    socketState: -1,
    socketSince: 0,
    framesIn: 0,
    framesOut: 0,
    lastFrameAt: 0,
    prefsEcho: 0,
    version: VERSION,
    error: null
  };

  function normalizeJid(jid) {
    var WAIJidUtils = (typeof window.WAIJidUtils === 'object' && window.WAIJidUtils) ? window.WAIJidUtils : null;
    if (WAIJidUtils && typeof WAIJidUtils.normalizeJid === 'function') {
      return WAIJidUtils.normalizeJid(jid);
    }
    // WAIJidUtils is loaded right after the shim, so by the time any message is
    // handled this branch is unreachable; keep a plain pass-through here.
    if (!jid || typeof jid !== 'string') return '';
    return jid;
  }

  function coercePrefValue(k, v) {
    if (!Object.prototype.hasOwnProperty.call(BUILD_DEFAULTS, k)) return undefined;
    if (typeof window.WAISettingsSchema === 'object' && window.WAISettingsSchema &&
        typeof window.WAISettingsSchema.coerceSetting === 'function') {
      return window.WAISettingsSchema.coerceSetting(k, v, PREFS[k]);
    }
    var def = BUILD_DEFAULTS[k];
    if (k === 'safetyDelay') {
      var sd = parseInt(v, 10);
      if (isNaN(sd)) return undefined;
      if (sd < 0 || sd > 30) return PREFS.safetyDelay;
      return sd;
    }
    if (k === 'privacyScreenLockIdleMinutes') {
      var mins = parseInt(v, 10);
      if (isNaN(mins)) return undefined;
      if (mins < 1 || mins > 60) return PREFS.privacyScreenLockIdleMinutes;
      return mins;
    }
    if (k === 'privacyScreenLockPIN') {
      if (typeof v !== 'string') return undefined;
      var trimmed = v.trim();
      if (trimmed === '') return '';
      var isHexSha256 = (typeof window.WAISettingsSchema === 'object' && window.WAISettingsSchema && window.WAISettingsSchema.SHA256_HEX_RE)
      ? window.WAISettingsSchema.SHA256_HEX_RE
      : /^[a-f0-9]{64}$/i;
    return isHexSha256.test(trimmed) ? trimmed.toLowerCase() : undefined;
    }
    if (typeof def === 'boolean') {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    }
    if (typeof def === 'number') {
      var n = parseInt(v, 10);
      return isNaN(n) ? undefined : n;
    }
    if (typeof def === 'string') {
      return typeof v === 'string' ? v : undefined;
    }
    return v;
  }

  function prefsHash() {
    var s = Object.keys(PREFS).sort().map(function (k) { return k + '=' + String(PREFS[k]); }).join('|');
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  }

  if (BOOT && BOOT.prefs && typeof BOOT.prefs === 'object') {
    for (var bk in BOOT.prefs) {
      if (!Object.prototype.hasOwnProperty.call(BOOT.prefs, bk)) continue;
      var bv = coercePrefValue(bk, BOOT.prefs[bk]);
      if (bv !== undefined) PREFS[bk] = bv;
    }
  }
  state.prefsEcho = prefsHash();

  // Socket liveness lives in the tracker artifact (app/electron/socket_tracker.js,
  // built to app/.build/socket-tracker.js and injected as an artifact by the
  // preload before the shim). The shim keeps the copies the watchdog reads.
  function syncSocketState()
  {
    var tracker = (typeof WAISocketTracker === 'object' && WAISocketTracker) ? WAISocketTracker : null;
    if (!tracker || typeof tracker.socketState !== 'number') return;
    if (tracker.socketState !== state.socketState)
    {
      state.socketState = tracker.socketState;
      state.socketSince = tracker.socketSince;
    }
  }

  function readSocket()
  {
    if (typeof WAISocketTracker === 'object' && WAISocketTracker) WAISocketTracker.readSocket();
    syncSocketState();
  }

  function arm() {
    gen++;
    state.generation = gen;
    try {
      if (typeof window.wsHook === 'object' && window.wsHook) {
        var before = window.wsHook.before, after = window.wsHook.after;
        if (typeof before === 'function') {
          window.wsHook.before = function () { framesOut++; state.framesOut = framesOut; state.lastFrameAt = Date.now(); readSocket(); return before.apply(this, arguments); };
        }
        if (typeof after === 'function') {
          window.wsHook.after = function () { framesIn++; state.framesIn = framesIn; state.lastFrameAt = Date.now(); readSocket(); return after.apply(this, arguments); };
        }
        state.hookAlive = typeof window.wsHook.before === 'function' && typeof window.wsHook.after === 'function';
        if (state.hookAlive) { clearFailure(); if (host && host.hookArmed) { try { host.hookArmed(gen); } catch (e) {} } }
        else reportFailure('the WebSocket hook did not arm', 'wsHook.before/after missing');
      } else {
        reportFailure('the WebSocket hook did not arm', 'window.wsHook is not an object');
      }
    } catch (e) {
      reportFailure('the WebSocket hook threw while arming', String(e && e.message || e));
    }
    if (typeof WAISocketTracker === 'object' && WAISocketTracker) WAISocketTracker.bindSocket();
    readSocket();
    return gen;
  }

  // ---------------------------------------------------------------- runtime API
  function getURL(path) {
    var p = String(path == null ? '' : path).replace(/^\/+/, '');
    if (Object.prototype.hasOwnProperty.call(ASSETS, p)) return ASSETS[p];
    return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }

  function notifyEvent(name, payload) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) }));
    } catch (e) {
      if (host && host.reportFailure) {
        try { host.reportFailure(name, String((e && e.message) || e)); } catch (e2) {}
      }
    }
  }

  function notifyOptionsUpdate(options) {
    notifyEvent('onOptionsUpdate', options);
  }

  function applyPrefs(patch, fromPage) {
    if (!patch || typeof patch !== 'object') return {};
    var applied = {};
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(BUILD_DEFAULTS, k)) continue;
      var v = coercePrefValue(k, patch[k]);
      if (v === undefined) continue;
      PREFS[k] = v;
      applied[k] = v;
    }
    state.prefsEcho = prefsHash();
    if (!fromPage && Object.keys(applied).length > 0) notifyOptionsUpdate(applied);
    return applied;
  }

  function handleMessage(msg, respond) {
    msg = msg || {};
    try {
      if (msg.name === 'getOptions') {
        respond(Object.assign({}, PREFS));
        return false;
      }
      if (msg.name === 'setOptions') {
        var patch = {};
        for (var k in msg) {
          if (k !== 'name' && Object.prototype.hasOwnProperty.call(msg, k)) patch[k] = msg[k];
        }
        var applied = applyPrefs(patch, true);
        if (host && host.setPrefs) { try { host.setPrefs(applied); } catch (e) {} }
        respond(Object.assign({}, PREFS));
        return false;
      }
      if (msg.name === 'resetOptions') {
        applyPrefs(Object.assign({}, BUILD_DEFAULTS), true);
        if (host && host.resetPrefs) { try { host.resetPrefs(); } catch (e) {} }
        respond(Object.assign({}, PREFS));
        return false;
      }
      if (msg.name === 'getInitialState') {
        respond({
          options: Object.assign({}, PREFS),
          contactWhitelistRules: Object.assign({}, WHITELIST),
          ephemeralNotes: Object.assign({}, NOTES),
        });
        return false;
      }
      if (msg.name === 'getContactWhitelist') {
        respond(Object.assign({}, WHITELIST));
        return false;
      }
      if (msg.name === 'setContactWhitelistRule') {
        var jid = normalizeJid(msg.jid);
        var rule = msg.rule;
        if (jid && (rule === 'always' || rule === 'never' || rule === 'default')) {
          if (rule === 'default') delete WHITELIST[jid];
          else WHITELIST[jid] = rule;
          if (host && host.setWhitelistRule) {
            try { host.setWhitelistRule({ jid: jid, rule: rule }); } catch (e) {}
          }
        }
        respond(Object.assign({}, WHITELIST));
        return false;
      }
      if (msg.name === 'getEphemeralNotes') {
        respond(Object.assign({}, NOTES));
        return false;
      }
      if (msg.name === 'setEphemeralNote') {
        var noteJid = normalizeJid(msg.jid);
        if (noteJid) {
          var val = msg.note;
          if (val === null || val === undefined || val === '') delete NOTES[noteJid];
          else NOTES[noteJid] = String(val);
          if (host && host.setNote) {
            try { host.setNote({ jid: noteJid, note: val }); } catch (e) {}
          }
        }
        respond(Object.assign({}, NOTES));
        return false;
      }
      if (msg.name === 'deleteEphemeralNote') {
        var delJid = normalizeJid(msg.jid);
        if (delJid) {
          delete NOTES[delJid];
          if (host && host.deleteNote) {
            try { host.deleteNote({ jid: delJid }); } catch (e) {}
          }
        }
        respond(Object.assign({}, NOTES));
        return false;
      }
      if (msg.name === 'clearEphemeralNotes') {
        NOTES = {};
        if (host && host.clearNotes) {
          try { host.clearNotes(); } catch (e) {}
        }
        respond({});
        return false;
      }
      if (msg.name === 'exportEphemeralChat') {
        if (host && typeof host.exportEphemeralChat === 'function') {
          var res = host.exportEphemeralChat(msg);
          if (res && typeof res.then === 'function') {
            res.then(
              function (out) { respond(out || { ok: true }); },
              function (err) { respond({ ok: false, error: String((err && err.message) || err) }); }
            );
            return true;
          }
          respond(res || { ok: false, unsupported: true });
          return false;
        }
        respond({ ok: false, unsupported: true });
        return false;
      }
    } catch (e) { /* fall through to empty response below */ }
    respond({});
    return false;
  }

  var runtime = {
    getURL: getURL,
    sendMessage: function (msg, cb) {
      if (typeof msg === 'function') { cb = msg; msg = {}; }
      if (typeof cb !== 'function') cb = null;
      var responded = false;
      var isAsync = false;
      var respond = function (v) { if (responded) return; responded = true; if (cb) cb(v); };
      try { isAsync = handleMessage(msg, respond) === true; }
      catch (e) { respond({}); }
      if (!isAsync && !responded) respond({});
    },
    getManifest: function () { return { version: VERSION }; },
    id: 'waincognito-electron'
  };

  window.chrome = Object.assign(window.chrome || {}, { runtime: runtime });
  window.browser = Object.assign(window.browser || {}, { runtime: runtime });

  // ---------------------------------------------------------------- host surface
  window.__WAI__ = {
    version: VERSION,
    order: ORDER,
    loaded: loaded,
    state: function () {
      syncSocketState();
      return {
        generation: state.generation, hookAlive: state.hookAlive,
        socketState: state.socketState, socketSince: state.socketSince,
        framesIn: state.framesIn, framesOut: state.framesOut, lastFrameAt: state.lastFrameAt,
        prefsEcho: state.prefsEcho, href: state.href, error: state.error
      };
    },
    arm: arm,
    markLoaded: function (which) { loaded[which] = true; },
    isUiReady: function () { return document.readyState !== 'loading'; },
    getPrefs: function () { return Object.assign({}, PREFS); },
    setPrefs: function (patch) { applyPrefs(patch); },
    getWhitelist: function () { return Object.assign({}, WHITELIST); },
    setWhitelist: function (rules) {
      if (!rules || typeof rules !== 'object') return;
      WHITELIST = Object.assign({}, rules);
      notifyEvent('onContactWhitelistUpdate', WHITELIST);
    },
    getNotes: function () { return Object.assign({}, NOTES); },
    setNotes: function (notes) {
      if (!notes || typeof notes !== 'object') return;
      NOTES = Object.assign({}, notes);
      notifyEvent('onEphemeralNotesUpdate', NOTES);
    },
    reportFailure: reportFailure,
    clearFailure: clearFailure,
    openOptions: function (opts) {
      try {
        window.__WAI_PANEL_OPEN_RESULT__ = false;
        var init = (opts && typeof opts === 'object') ? { detail: JSON.stringify(opts) } : undefined;
        document.dispatchEvent(new CustomEvent('onOpenIncognitoOptions', init));
        return window.__WAI_PANEL_OPEN_RESULT__ === true;
      } catch (e) {
        return false;
      }
    }
  };

  if (host && host.booted) {
    try { host.booted({ href: location.href, userAgent: navigator.userAgent, version: VERSION }); } catch (e) {}
  }
})();
