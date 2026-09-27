'use strict';
// Preload: the C1 bridge and the C3-ordered injection sequence.
//
// WHY THIS FILE EXISTS AT ALL (docs/ELECTRON_APP_PLAN.md §4 C1)
// ------------------------------------------------------------
// core/ws_hook.js must replace the WebSocket constructor BEFORE WhatsApp opens its first
// socket. Electron's `webContents.executeJavaScript` cannot do that: its implementation
// (lib/browser/api/web-contents.ts) begins with
//
//     const waitTillCanExecuteJavaScript = async (webContents) => {
//       if (webContents.getURL() && !webContents.isLoadingMainFrame()) return
//       return new Promise((resolve) => { webContents.once('did-stop-loading', resolve) })
//     }
//
// i.e. it blocks until `did-stop-loading`. A preload runs before the web contents begin
// loading, which is the exact `document_start` equivalent of the manifest's
// `run_at: document_start` — and `webFrame.executeJavaScript` from the preload has NO
// such gate and evaluates in the PAGE'S MAIN WORLD. That pair is the only correct one:
//   - NOT webContents.executeJavaScript  (load-gated, too late)
//   - NOT executeJavaScriptInIsolatedWorld (wrong world; upstream code must see the page's
//     own globals, and the shim's window.chrome must be the page's window.chrome)
//
// WHY THE STEPS ARE SEPARATE CALLS (C3)
// -------------------------------------
// Concatenating the main and ui groups into one string makes the LAST top-level
// `initialize` declaration win for the whole script, so interception.js's call silently
// invoked ui.js's version, the WebSocket hook never armed, and nothing errored. Separate
// calls also preserve the ordering guarantee that the single shared UIClassNames exists
// before ui.js reads it. Do not "simplify" this.
//
// WHY EVERYTHING IS DEFENSIVE
// ---------------------------
// A hard reload (WhatsApp does this on updates) destroys the injected context. The
// sequence must be repeatable, every step individually recoverable, and every failure has
// to be visible — a dead hook that looks alive is the worst outcome in this project.

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// C2/sandbox: a sandboxed preload's `require` resolves `electron` and a tiny builtin
// list (events, timers, url) — `fs` is NOT available. So try a direct read first (it is
// what an unsandboxed dev run gets, and it keeps this file usable there) and fall back to
// main's in-memory copy over a synchronous IPC. The fallback is what actually runs in the
// shipped app, and it must stay synchronous: an async artifact read would delay
// ws_hook past WhatsApp's first socket, reintroducing C1 through the back door.
let fs = null;
try { fs = require('fs'); } catch (e) { fs = null; }

// app/.build sits one level up from app/electron. Concatenated rather than
// path.join'd because `path` is not a guaranteed builtin in the sandbox either.
const BUILD_DIR = `${__dirname}/../.build/`;

// ------------------------------------------------------------------ logging

const PAGE_LOG = argValue('wai-page-log') === '1';

function forward(level, args) {
  try { ipcRenderer.send('wai:log', level, Array.prototype.slice.call(args)); } catch (e) { /* renderer is going away */ }
}
function fail(where, e) { forward('error', [`injection step "${where}" failed:`, (e && e.stack) || e]); }
function log(...a) { forward('warn', a); }
function debug(...a) { if (PAGE_LOG) forward('debug', a); }

function argValue(name) {
  const prefix = `--${name}=`;
  try {
    const hit = process.argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
  } catch (e) { return null; }
}

// ------------------------------------------------------------------ artifacts

const artifactCache = Object.create(null);

function readArtifact(name) {
  if (typeof artifactCache[name] === 'string') return artifactCache[name];
  let src = null;
  if (fs) {
    try { src = fs.readFileSync(`${BUILD_DIR}${name}`, 'utf8'); } catch (e) { src = null; }
  }
  if (src === null) {
    // sendSync (not invoke): the injection sequence is a synchronous ordering guarantee,
    // and a promise would let the page's own scripts run first.
    //
    // The only artifact on the pre-socket path is critical.js at 2.7 KB, so the 1.3 MB
    // main-rest transfer below it costs nothing that matters: the WebSocket constructor
    // is already replaced by the time it happens. Cached per preload instance, so it is
    // once per document rather than once per retry.
    let reply = null;
    try { reply = ipcRenderer.sendSync('wai:artifact', name); } catch (e) { reply = null; }
    if (reply && reply.ok && typeof reply.source === 'string') src = reply.source;
  }
  if (src === null) {
    throw new Error(`build artifact ${name} is unavailable. Run: npm run build:electron`);
  }
  artifactCache[name] = src;
  return src;
}

// ------------------------------------------------------------------ prefs (C4)

// The page's getOptions must answer SYNCHRONOUSLY: ui.js:23 passes a callback but reads
// the result immediately after, so a round-trip to the main process would race it. The
// live values therefore ride in on argv (main sets
// `additionalArguments: ['--wai-prefs=' + JSON.stringify(livePrefs)]`) and are inlined
// into the shim source as a literal before it is evaluated.
const LIVE_PREFS = (() => {
  const raw = argValue('wai-prefs');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    log('could not parse --wai-prefs; the page will start on build-time defaults');
    return null;
  }
})();

/**
 * Swap the build-time defaults baked into the generated shim for the live values.
 * Returns the source plus whether the substitution actually matched — a silent no-op here
 * would leave a user's saved prefs ignored with nothing to show for it.
 */
function withLivePrefs(src) {
  if (!LIVE_PREFS) return { source: src, substituted: false };
  const literal = `var PREFS = ${JSON.stringify(LIVE_PREFS, null, 2)};`;
  // The build emits `var PREFS = {` … `};` from JSON.stringify(meta.prefs, null, 2) and
  // the object is flat (booleans and one number), so the first `};` closes it.
  const replaced = src.replace(/var PREFS = \{[\s\S]*?\};/, literal);
  return { source: replaced, substituted: replaced !== src };
}

// ------------------------------------------------------------------ state

/** Per-preload-instance state. A hard reload creates a NEW preload, so these reset. */
const state = {
  /** Sequence attempt counter, reported so §10 smoke step 1 can prove the ordering. */
  attempt: 0,
  /** step name → true once it has succeeded in THIS document. */
  done: Object.create(null),
  /** Page-world arm() is called at most once per document. */
  armed: false,
  running: false,
  queued: false,
  bridgeReady: false,
  injectedAt: 0,
  generation: 0,
};

function sendSnapshot(event, extra) {
  try {
    ipcRenderer.send('wai:page-state', {
      event,
      attempt: state.attempt,
      injectedAt: state.injectedAt || null,
      generation: state.generation || 0,
      steps: Object.keys(state.done).filter((k) => state.done[k]),
      ...(extra || {}),
    });
  } catch (e) { /* renderer is going away */ }
}

// ------------------------------------------------------------------ step 1: the bridge

/**
 * The only thing the page world can see. Exactly the four functions the shim calls, plus
 * a readState() probe for the preload's own reporting. ipcRenderer is deliberately not
 * exposed: a page that can reach the main process can do anything, and the whole point of
 * C2 is that it cannot.
 */
function installBridge() {
  if (state.bridgeReady) return;
  contextBridge.exposeInMainWorld('__WAI_IPC__', {
    /** The shim announces itself at the end of its IIFE. */
    booted: (info) => {
      state.generation = 0;
      sendSnapshot('booted', {
        // Recorded here, inside the page world's execution of the shim, because that is
        // the timestamp §10 smoke step 1 needs: it is directly comparable with
        // did-finish-load, and it proves the shim ran in the page world rather than in
        // the isolated world where it would have been useless (C1).
        injectedAt: Date.now(),
        href: (info && info.href) || null,
        userAgent: (info && info.userAgent) || null,
        version: (info && info.version) || null,
      });
    },

    /** The shim confirms wsHook.before/after were actually wrapped. */
    hookArmed: (generation) => {
      state.generation = generation;
      sendSnapshot('hook-armed', { generation });
    },

    /** The page changed an option; persist it. */
    setPrefs: (patch) => {
      try {
        return ipcRenderer.invoke('wai:set-prefs', patch);
      } catch (e) {
        log('setPrefs invoke failed:', (e && e.message) || e);
        return null;
      }
    },

    /** The page raised the visible failure banner. */
    reportFailure: (reason, detail) => {
      try { ipcRenderer.send('wai:failure', String(reason), String(detail || '')); } catch (e) { /* ignore */ }
    },

    /** Relay a notification from the page world to the main process Notification API. */
    sendNotification: (data) => {
      try { ipcRenderer.send('wai:notification', data); } catch (e) { /* ignore */ }
    },

    /**
     * The page's liveness snapshot. In the isolated world `window.__WAI__` is invisible,
     * so the preload has to ask the page to evaluate it. Resolves to null when the shim
     * is not there — that is the NOT_PROTECTED case, not an error.
     */
    readState: () => webFrame.executeJavaScript('window.__WAI__ && window.__WAI__.state()')
      .catch(() => null),
  });
  state.bridgeReady = true;
}

// ------------------------------------------------------------------ steps

/**
 * Capture the native WebSocket constructor BEFORE core/ws_hook.js reassigns the global.
 * The shim reads window.__WAI_NATIVE_WS__ to learn the real readyState for the socket
 * status, which is how the watchdog can tell "connected" from "quiet" (§9.4).
 */
const NATIVE_WS_SRC = 'window.__WAI_NATIVE_WS__ = window.__WAI_NATIVE_WS__ || window.WebSocket;';

/**
 * Forward only what is cheap and high-signal: uncaught errors always, the page console
 * only when explicitly enabled. core/ runs with WALogs = true and logs per frame, so an
 * unconditional console forward would be an IPC firehose competing with the very socket
 * we are trying to protect.
 */
const DIAG_SRC = `(function () {
  if (window.__WAI_DIAG__) return;
  window.__WAI_DIAG__ = { errors: 0, rejections: 0, console: 0 };
  var emit = function (kind, args) {
    window.__WAI_DIAG__[kind]++;
    try { if (window.__WAI_IPC__ && window.__WAI_IPC__.reportFailure) {
      window.__WAI_IPC__.reportFailure('uncaught ' + kind, String(args[0] || args));
    } } catch (e) {}
  };
  window.addEventListener('error', function (e) { emit('errors', [e && e.message]); });
  window.addEventListener('unhandledrejection', function (e) { emit('rejections', [e && e.reason]); });
  if (window.__WAI_LOG_PAGE__) {
    ['log', 'info', 'warn', 'error'].forEach(function (k) {
      var orig = console[k];
      console[k] = function () {
        try { if (window.__WAI_IPC__ && window.__WAI_IPC__.log) {
          window.__WAI_IPC__.log.apply(null, [k].concat(Array.prototype.slice.call(arguments)));
        } } catch (e) {}
        return orig.apply(console, arguments);
      };
    });
  }
})();`;

function evaluate(name, code) {
  return webFrame.executeJavaScript(code).then(
    (value) => { state.done[name] = true; debug(`step ${name} ok`); return value; },
    (e) => { state.done[name] = false; fail(name, e); throw e; },
  );
}

function callPage(name, code) {
  // Used for calls that are idempotent by construction (setPrefs, arm on a fresh page).
  return webFrame.executeJavaScript(code).then(
    (value) => { state.done[name] = true; return value; },
    (e) => { state.done[name] = false; fail(name, e); return null; },
  );
}

/**
 * Run a step only if it has not already succeeded in THIS document. This is the whole
 * safety property of the retry path: see runSequence's note below.
 */
function once(name, fn) {
  return function () {
    if (state.done[name]) return null;
    return fn();
  };
}

/**
 * The ordered sequence. Every step is a separate page-world call; every step runs at most
 * once per document.
 *
 * Retry policy matters for safety, not just robustness: re-evaluating core/ws_hook.js in
 * a live document would wrap the ALREADY-PATCHED WebSocket a second time, so every frame
 * would be decrypted twice and the shim's arm() would double-count its frame counters.
 * A step that succeeded is therefore never re-run, and a document whose ws_hook already
 * ran is repaired by reloading (the watchdog's escalation), not by re-injecting.
 */
function runSequence(reason) {
  if (state.running) { state.queued = true; return; }
  state.running = true;
  state.attempt += 1;
  const startedAt = Date.now();
  // Set before the first page-world call so the shim's `booted` (which fires during that
  // call) can already report it. Host clock, so it is comparable with did-finish-load.
  if (!state.injectedAt) state.injectedAt = startedAt;

  const steps = [
    // 1. The bridge has to exist before the shim runs: the shim captures
    //    window.__WAI_IPC__ at IIFE entry and calls host.booted() at the end.
    once('bridge', () => { installBridge(); state.done.bridge = true; }),

    // 1b. THE HARD DEADLINE, taken as early as possible. Do not "tidy" this order.
    //     core/ws_hook.js is 2.6 KB and references nothing from the shim (verified: no
    //     chrome./browser./__WAI__ use), so it needs no predecessor. Every step hoisted
    //     above `critical` is an extra async hop through the renderer added to the one
    //     deadline that decides whether interception silently works at all (C1).
    once('nativeWs', () => evaluate('nativeWs', NATIVE_WS_SRC)),
    once('critical', () => evaluate('critical', readArtifact('critical.js'))),

    // 2. window.chrome/browser + window.__WAI__ + the failure banner. Required before
    //    the ui group (ui.js:12 aliases `browser` from `chrome`), not before ws_hook.
    once('shim', () => {
      const { source, substituted } = withLivePrefs(readArtifact('shim.js'));
      return evaluate('shim', source).then(() => {
        if (!substituted) {
          // Defensive: if the build ever stops emitting a substitutable PREFS literal,
          // push the live values in immediately after instead of silently running on
          // defaults. Still synchronous, so ui.js:23 cannot race it.
          debug('PREFS literal not found in the built shim; applying live prefs after eval');
          return callPage('prefsFallback', `window.__WAI__ && window.__WAI__.setPrefs(${JSON.stringify(LIVE_PREFS || {})});`);
        }
        return null;
      });
    }),

    once('diagnostics', () => evaluate('diagnostics', DIAG_SRC)),

    // 3. C4: the page CSP refuses shell-owned schemes, so CSS arrives as one inline
    //    <style> (style-src permits 'unsafe-inline') rather than a <link>.
    once('styles', () => evaluate('styles', readArtifact('styles.js'))),

    // 4. The remaining 1.3 MB of the main group. Separate call, same reason as above:
    //    concatenating the groups changes hoisting semantics (C3), and keeping them
    //    separate is also what guarantees the single shared UIClassNames exists before
    //    ui.js reads it. The socket is already patched by now, so the size costs nothing
    //    that matters.
    once('mainRest', () => evaluate('mainRest', readArtifact('main-rest.js'))),

    // 5. moduleraid, which needs WhatsApp's webpack registry and self-polls for it.
    once('deferred', () => evaluate('deferred', readArtifact('deferred.js'))),

    // 7. Wrap wsHook.before/after for frame counters and confirm the hook is alive.
    //    Once per document (see the retry policy above). A failed arm IS retried: the
    //    alternative is that a transient executeJavaScript failure leaves the app
    //    unprotected until a reload, and the only way a retry can double-wrap is for
    //    arm() itself to have thrown between its two assignments. The watchdog's
    //    NOT_PROTECTED → reload is the backstop if that ever happens.
    once('arm', () => {
      if (state.armed) return null;
      return callPage('arm', 'window.__WAI__ && window.__WAI__.arm()').then((gen) => {
        if (gen == null) { fail('arm', new Error('window.__WAI__ is missing')); return null; }
        state.armed = true;
        state.generation = gen;
        state.injectedAt = state.injectedAt || Date.now();
        return null;
      });
    }),
  ];

  const main = (function next(i) {
    if (i >= steps.length) return Promise.resolve();
    return Promise.resolve()
      .then(steps[i])
      .catch(() => null)          // one failure must not skip the remaining steps
      .then(() => next(i + 1));
  })(0);

  const release = () => {
    state.running = false;
    debug(`sequence (${reason}) done in ${Date.now() - startedAt}ms; ` +
          `steps ok: ${Object.keys(state.done).filter((k) => state.done[k]).join(',')}`);
    if (state.queued) { state.queued = false; runSequence(`${reason}:queued`); }
  };

  main.then(release, (e) => { fail('sequence', e); release(); });

  // The ui group is a separate phase (§6.3) and deliberately OUTSIDE the main sequence's
  // lock. Holding the lock across the wait for DOMContentLoaded would mean a lifecycle
  // signal arriving in that window could only queue, so the steps that actually failed
  // would sit unretried until the document was parsed — which is exactly the situation in
  // which a retry is needed. Ordering is unaffected: `main` has already run arm().
  main
    .then(scheduleUi, () => null)
    .then(injectUi, () => null)
    .then(() => null, (e) => fail('ui', e));

  return main;
}

/**
 * The ui group replaces the two `document_idle` content scripts. It must run AFTER the
 * main group (it reads the shared UIClassNames the main bundle created) and only once the
 * document is parsed.
 *
 * Check-then-subscribe, not subscribe-then-wait: DOMContentLoaded does not fire again
 * once readyState has passed 'loading', so subscribing unconditionally would hang the ui
 * group forever in the common case where the preload is fast.
 */
function scheduleUi() {
  if (state.done.ui) return Promise.resolve();
  let ready = false;
  try { ready = document.readyState !== 'loading'; } catch (e) { ready = false; }

  if (!ready) {
    return new Promise((resolve) => {
      const onReady = () => { try { document.removeEventListener('DOMContentLoaded', onReady); } catch (e) {} resolve(); };
      try { document.addEventListener('DOMContentLoaded', onReady, { once: true }); } catch (e) { resolve(); }
      // Belt and braces: a poll catches a listener that never fires, e.g. because the
      // document was replaced between the check and the subscribe.
      const started = Date.now();
      const poll = setInterval(() => {
        let nowReady = false;
        try { nowReady = document.readyState !== 'loading'; } catch (e) { nowReady = true; }
        if (nowReady || Date.now() - started > 20000) { clearInterval(poll); resolve(); }
      }, 50);
    });
  }
  return Promise.resolve();
}

function injectUi() {
  if (state.done.ui) return Promise.resolve();
  return callPage('ui', readArtifact('ui.js')).then(() => { sendSnapshot('ui-loaded'); });
}

// Execution order, kept as a single source of truth so the retry policy's "still
// pending" report can never drift from the sequence itself. `nativeWs` and `critical`
// come first because ws_hook.js has the only hard deadline (C1).
const STEP_ORDER = ['bridge', 'nativeWs', 'critical', 'shim', 'diagnostics', 'styles', 'mainRest', 'deferred', 'arm', 'ui'];

function pendingSteps() {
  return STEP_ORDER.filter((k) => !state.done[k]);
}

/**
 * Re-run only what has not succeeded yet. Safe: ws_hook is never re-run.
 *
 * Once both arm() and the ui group have landed, a same-document navigation destroys
 * nothing and a cross-document one creates a brand new preload with an empty `done` map —
 * so the "already complete" case here is always a redundant signal, and doing work in
 * response to it would be pure noise.
 */
function retryMissing(reason) {
  if (state.armed && state.done.ui) return false;
  debug(`retrying missing steps: ${pendingSteps().join(',') || '(none)'} (${reason})`);
  runSequence(reason);
  return true;
}

// ------------------------------------------------------------------ host messages

ipcRenderer.on('wai:prefs', (_event, prefs) => {
  if (!prefs || typeof prefs !== 'object') return;
  callPage('prefs', `window.__WAI__ && window.__WAI__.setPrefs(${JSON.stringify(prefs)});`);
  debug('prefs pushed to the page');
});

ipcRenderer.on('wai:rearm', () => { retryMissing('host-rearm'); });

// The renderer lifecycle signal, forwarded by main because a sandboxed preload has no
// `process.on`. This is what makes a first attempt's failure recoverable: without it, a
// step that lost a race with frame readiness would never be retried and the hook would
// silently not exist.
ipcRenderer.on('wai:frame-event', (_event, name) => { retryMissing(name); });

// ------------------------------------------------------------------ notification interception (from WhatsLNX)
// Override window.Notification so WhatsApp Web's own notification calls are routed to
// the main process Notification API, which works correctly on every OS including Linux
// with DBus-based notification daemons. This runs in the ISOLATED world (preload scope),
// so we inject into the page world via a tiny evaluate call once the bridge is ready.
//
// Two interception points:
//   1. window.Notification constructor — the standard browser notifications API
//   2. ServiceWorkerRegistration.prototype.showNotification — WA sometimes calls this
//      from its service worker
//
// NEITHER path calls through. Relaying AND invoking the original is what the first
// revision of this port did, which is the opposite of what its own comment claimed:
// every message arrived twice, once from the Electron Notification in main and once from
// Chromium's own. So this is a replacement, not a proxy — which also means a message
// shown before the patch lands (the injection races the page's first paint) is simply
// lost, rather than arriving twice. Losing one is the better failure.
const NOTIFICATION_INTERCEPT_SRC = `(function () {
  if (window.__WAI_NOTIF_PATCHED__) return;
  window.__WAI_NOTIF_PATCHED__ = true;
  var _OriginalNotification = window.Notification;

  // WhatsApp de-dupes its own banners by the 'tag' option, reusing one to replace a
  // message already on screen. Chromium honours that; the Electron Notification we
  // relay to does not, because it has no notion of a tag. Without this the user gets one
  // native popup per update to a conversation they are already looking at, so the tag is
  // tracked here and a repeat within the window is dropped.
  var _lastTag = null;
  var _lastTagAt = 0;
  var TAG_TTL = 5000;

  function relay(title, options) {
    options = options || {};
    var tag = options.tag || '';
    if (tag) {
      var now = Date.now();
      if (tag === _lastTag && (now - _lastTagAt) < TAG_TTL) return;
      _lastTag = tag;
      _lastTagAt = now;
    }
    try {
      if (window.__WAI_IPC__ && window.__WAI_IPC__.sendNotification) {
        window.__WAI_IPC__.sendNotification({
          title: title || 'Whatsapp Incognito',
          body: options.body || '',
          iconUrl: options.icon || '',
          silent: options.silent === true,
          tag: tag,
        });
      }
    } catch (e) {}
  }

  window.Notification = function (title, options) {
    relay(title, options);
    // Return a stand-in so WA Web's .close() / .onclick assignment does not throw.
    return { close: function () {}, onclick: null, onerror: null };
  };
  window.Notification.requestPermission = function () { return Promise.resolve('granted'); };
  // Only the accessor. Assigning window.Notification.permission first and then defining
  // the same property was the second bug here: the plain assignment is silently dropped
  // on a function object in some engines and the defineProperty wins anyway, so the
  // first line was dead weight pretending to grant permission.
  Object.defineProperty(window.Notification, 'permission', {
    get: function () { return 'granted'; },
    configurable: true,
  });
  if (_OriginalNotification) window.Notification.prototype = _OriginalNotification.prototype;

  if ('ServiceWorkerRegistration' in window && ServiceWorkerRegistration.prototype.showNotification) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      // Relay only. Calling the original here as well is what produced the duplicate.
      relay(title, options);
      return Promise.resolve();
    };
  }
})();`;

// Inject the notification interceptor as soon as the main sequence finishes.
// We piggyback on the existing 'wai:page-state' + frame-event flow: after 'booted',
// evaluate the interceptor. This is safe to re-run (idempotent guard at top of IIFE).
ipcRenderer.on('wai:page-state', (_event, snapshot) => {
  if (snapshot && snapshot.event === 'booted') {
    webFrame.executeJavaScript(NOTIFICATION_INTERCEPT_SRC).catch(() => {});
  }
});

// ------------------------------------------------------------------ go

// Top of the preload, before the document's own scripts. C1: the whole reason this file
// is a preload and not a post-load hook.
retryMissing('preload');
