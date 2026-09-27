// Page-world shim. Injected by app/electron/preload.js BEFORE any upstream file.
//
// Purpose: let core/ and lib/ run with ZERO API shims beyond the two functions they
// actually use (verified by exhaustive grep of core/ and lib/):
//
//   chrome.runtime.getURL(path)            4 call sites, all images/*.svg
//   browser.runtime.sendMessage({name:...}) 15 call sites, only getOptions/setOptions
//
// Everything else they touch (indexedDB, localStorage, fetch, DOM) is native here.
//
// THREE ORDERING FACTS make this work, all verified against the code:
//
//  1. ui.js:12 does `if (chrome != undefined) { var browser = chrome; }`. So `chrome`
//     must exist before ui.js evaluates, or ui.js throws on `browser.runtime`.
//  2. C4: WhatsApp serves a strict CSP. A <script src>, <link>, or fetch() to any
//     scheme the shell owns is refused. So images are inlined as data: URIs and
//     stylesheets are injected as an inline <style> (style-src allows 'unsafe-inline').
//  3. getOptions must answer SYNCHRONOUSLY. ui.js:23 passes a callback but reads the
//     result immediately after; a round-trip to the main process would race it. So
//     prefs are baked in as a literal at build time and kept in a local object.
//
// This file is a build input, not a build output. scripts/build.mjs substitutes the
// four build-time literals marked below (assets, prefs, version, bundle order) and then
// the preload evaluates the result via webFrame.executeJavaScript, which is CSP-exempt.
//
// Do not spell a placeholder token literally anywhere else in this file, including in
// comments: the substitution is a first-occurrence replace, so a token in prose would be
// consumed before the real one in code and the build would emit a broken shim. The
// build asserts that no token survives, so a mistake here fails loudly.
(function () {
  'use strict';

  var ASSETS = __WAI_ASSETS__;        // { "images/phone.svg": "data:image/svg+xml;base64,..." }
  var PREFS = __WAI_PREFS__;          // defaults, deep-copied and mutable
  var VERSION = __WAI_VERSION__;
  var ORDER = __WAI_ORDER__;          // { critical: [...], rest: [...], ui: [...], deferred: [...] }

  var host = window.__WAI_IPC__ || null;   // contextBridge handle, may be absent
  var loaded = { critical: false, rest: false, ui: false, deferred: false };

  // ---------------------------------------------------------------- failure banner
  // A dead hook must never be able to look like a working one. Everything that can
  // fail visibly calls this.
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
  // Read by app/electron/watchdog.js on a MAIN-PROCESS timer. A page-side interval is
  // exactly what we cannot trust here, because a throttled or suspended page timer is
  // the failure mode we are defending against.
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

  function prefsHash() {
    // Stable hash so the shell can detect a lost prefs write without shipping values.
    var s = Object.keys(PREFS).sort().map(function (k) { return k + '=' + PREFS[k]; }).join('|');
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  }
  state.prefsEcho = prefsHash();

  // Socket liveness: ws_hook replaces the WebSocket constructor, so we can watch the
  // native constructor to learn the real readyState. We do not wrap send/receive.
  function bindSocket() {
    try {
      var Native = window.__WAI_NATIVE_WS__;
      if (!Native || !Native.prototype) return;
      var desc = Object.getOwnPropertyDescriptor(Native.prototype, 'readyState');
      if (!desc || !desc.get) return;
      Object.defineProperty(Native.prototype, 'readyState', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
          var v = desc.get.call(this);
          if (v !== state.socketState) { state.socketState = v; state.socketSince = Date.now(); }
          return v;
        }
      });
    } catch (e) { /* non-fatal: we just lose socket reporting */ }
  }

  // Called by the preload once the main bundle has been evaluated.
  function arm() {
    gen++;
    state.generation = gen;
    try {
      if (typeof window.wsHook === 'object' && window.wsHook) {
        var before = window.wsHook.before, after = window.wsHook.after;
        if (typeof before === 'function') {
          window.wsHook.before = function () { framesOut++; state.framesOut = framesOut; state.lastFrameAt = Date.now(); return before.apply(this, arguments); };
        }
        if (typeof after === 'function') {
          window.wsHook.after = function () { framesIn++; state.framesIn = framesIn; state.lastFrameAt = Date.now(); return after.apply(this, arguments); };
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
    bindSocket();
    return gen;
  }

  // ---------------------------------------------------------------- runtime API
  function getURL(path) {
    var p = String(path == null ? '' : path).replace(/^\/+/, '');
    if (Object.prototype.hasOwnProperty.call(ASSETS, p)) return ASSETS[p];
    // Unknown asset: a transparent 1x1 beats a CSP-rejected request that silently
    // leaves a broken icon in the menu.
    return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }

  function handleMessage(msg, respond) {
    msg = msg || {};
    try {
      if (msg.name === 'getOptions') {
        // Synchronous by design (see header note 3). background.js "ratifies" this by
        // immediately sending it back as setOptions, so mirror that harmlessly.
        respond(PREFS);
        return;
      }
      if (msg.name === 'setOptions') {
        var patch = {};
        for (var k in msg) { if (k !== 'name' && Object.prototype.hasOwnProperty.call(msg, k)) patch[k] = msg[k]; }
        // fromPage: core/ui.js dispatches onOptionsUpdate itself right after every tick
        // handler, so dispatching again here would run each listener twice per click.
        applyPrefs(patch, true);
        if (host && host.setPrefs) { try { host.setPrefs(patch); } catch (e) {} }
        respond(PREFS);
        return;
      }
    } catch (e) { /* fall through to the empty response below */ }
    respond({});
  }

  /**
   * Mutate PREFS and, unless the change came from the page itself, tell the page.
   *
   * Why the event matters as much as the assignment: the globals that decide whether a
   * receipt is actually blocked — readConfirmationsHookEnabled, saveDeletedMsgsHookEnabled,
   * showDeviceTypesEnabled, autoReceiptOnReplay (core/interception.js) and
   * allowStatusDownload (core/status_download.js) — are read by core/node_handler.js on
   * every decoded stanza, and the ONLY thing that ever mutates them is core/injected_ui.js's
   * `onOptionsUpdate` listener. So a pref pushed from the tray or the native settings menu
   * used to update PREFS and nothing else: it was written to prefs.json and ignored by the
   * page until the next document load. A checkbox that lies about the one thing the app
   * exists to do is the worst outcome in this project, so the push dispatches.
   *
   * A push that lands before the ui bundle is injected is not lost: core/ui.js reads
   * getOptions at document_idle and dispatches the full set itself, so the listener sees
   * the new values on the same load.
   *
   * @param {object} patch
   * @param {boolean} [fromPage]  true when this round-trip originated in core/ui.js
   */
  function applyPrefs(patch, fromPage) {
    var applied = {};
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(PREFS, k)) continue;   // reject unknown keys
      var v = patch[k];
      if (k === 'safetyDelay') {
        v = parseInt(v, 10);
        if (isNaN(v) || v < 0 || v > 30) v = PREFS.safetyDelay;          // ui.js:1119 allows 0-30
      } else if (typeof PREFS[k] === 'boolean') {
        v = !!v;
      }
      PREFS[k] = v;
      applied[k] = v;
    }
    state.prefsEcho = prefsHash();
    if (!fromPage) notifyOptionsUpdate(applied);
  }

  /**
   * Dispatch the same event and payload shape core/ui.js produces, so the existing
   * enforcement listeners need no change and no second convention exists.
   *
   * A listener that throws surfaces as an uncaught page error and is reported by the
   * preload's diagnostics hook, which is correct rather than noisy: a listener that cannot
   * apply a pref is a protection failure, and this project would rather say so loudly than
   * let a broken enforcement path look healthy.
   */
  function notifyOptionsUpdate(options) {
    try {
      document.dispatchEvent(new CustomEvent('onOptionsUpdate', { detail: JSON.stringify(options) }));
    } catch (e) {
      if (host && host.reportFailure) { try { host.reportFailure('options update', String((e && e.message) || e)); } catch (e2) {} }
    }
  }

  var runtime = {
    getURL: getURL,
    sendMessage: function (msg, cb) {
      if (typeof msg === 'function') { cb = msg; msg = {}; }
      if (typeof cb !== 'function') cb = null;
      var responded = false;
      var respond = function (v) { if (responded) return; responded = true; if (cb) cb(v); };
      try { handleMessage(msg, respond); }
      catch (e) { respond({}); }
      if (!responded) respond({});
    },
    // Present so feature-detecting code does not explode. Not used by core/.
    getManifest: function () { return { version: VERSION }; },
    id: 'waincognito-electron'
  };

  // `chrome` can pre-exist in some builds; merge rather than clobber.
  window.chrome = Object.assign(window.chrome || {}, { runtime: runtime });
  window.browser = Object.assign(window.browser || {}, { runtime: runtime });

  // ---------------------------------------------------------------- host surface
  // The preload and the main process talk to the page exclusively through this.
  window.__WAI__ = {
    version: VERSION,
    order: ORDER,
    loaded: loaded,
    state: function () {
      return {
        generation: state.generation, hookAlive: state.hookAlive,
        socketState: state.socketState, socketSince: state.socketSince,
        framesIn: state.framesIn, framesOut: state.framesOut, lastFrameAt: state.lastFrameAt,
        prefsEcho: state.prefsEcho, href: state.href, error: state.error
      };
    },
    arm: arm,
    markLoaded: function (which) { loaded[which] = true; },
    // Used by preload for the phase machine: page asks, host answers.
    isUiReady: function () { return document.readyState !== 'loading'; },
    getPrefs: function () { return Object.assign({}, PREFS); },
    // Not a bare `applyPrefs` reference: this is the HOST path (preload's wai:prefs push,
    // and the fallback right after the shim evaluates), so it must dispatch the update
    // event. fromPage is deliberately left unset.
    setPrefs: function (patch) { applyPrefs(patch); },
    reportFailure: reportFailure,
    clearFailure: clearFailure,
    /**
     * Open the page's own options panel, for when the shell has no native menu to offer.
     * core/ui.js answers synchronously through window.__WAI_PANEL_OPEN_RESULT__, so this
     * returns whether the panel actually opened rather than whether the event was sent.
     */
    openOptions: function () {
      try {
        window.__WAI_PANEL_OPEN_RESULT__ = false;
        document.dispatchEvent(new CustomEvent('onOpenIncognitoOptions'));
        return window.__WAI_PANEL_OPEN_RESULT__ === true;
      } catch (e) {
        return false;
      }
    }
  };

  // Announce. The preload resolves its injection barrier on this, which is what lets it
  // prove the document_start payload really executed in the page world before any of
  // WhatsApp's own code (C1) rather than assuming it.
  if (host && host.booted) {
    try { host.booted({ href: location.href, userAgent: navigator.userAgent, version: VERSION }); } catch (e) {}
  }
})();
