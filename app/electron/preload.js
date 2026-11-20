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

// app/.build and app/electron/page-hooks relative to preload. Concatenated rather than
// path.join'd because `path` is not a guaranteed builtin in the sandbox either.
const BUILD_DIR = `${__dirname}/../.build/`;
const HOOKS_DIR = `${__dirname}/page-hooks/`;

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

const hookCache = Object.create(null);

function readHook(name) {
  if (typeof hookCache[name] === 'string') return hookCache[name];
  let src = null;
  if (fs) {
    try { src = fs.readFileSync(`${HOOKS_DIR}${name}`, 'utf8'); } catch (e) { src = null; }
  }
  if (src === null) {
    let reply = null;
    try { reply = ipcRenderer.sendSync('wai:hook', name); } catch (e) { reply = null; }
    if (reply && reply.ok && typeof reply.source === 'string') src = reply.source;
  }
  if (src === null) {
    throw new Error(`page hook ${name} is unavailable`);
  }
  hookCache[name] = src;
  return src;
}

// ------------------------------------------------------------------ prefs & bootstrap (C4)

// The page's getOptions must answer SYNCHRONOUSLY: ui.js passes a callback and reads
// the result immediately after, so an async round-trip to main would race it.
// Initial prefs ride in on argv; on launch or reload we also read live state via sendSync
// AFTER critical.js has armed WebSocket interception (C1).
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

function readBootstrap() {
  const boot = { prefs: LIVE_PREFS || {}, whitelist: {}, notes: {} };
  try {
    const reply = ipcRenderer.sendSync('wai:bootstrap');
    if (reply && typeof reply === 'object') {
      if (reply.prefs && typeof reply.prefs === 'object') boot.prefs = reply.prefs;
      if (reply.whitelist && typeof reply.whitelist === 'object') boot.whitelist = reply.whitelist;
      if (reply.notes && typeof reply.notes === 'object') boot.notes = reply.notes;
    }
  } catch (e) { /* fall back to argv prefs + empty maps */ }
  return boot;
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
 * The only thing the page world can see. Exactly the functions the shim calls.
 * ipcRenderer is deliberately not exposed: a page that can reach the main process
 * can do anything, and the whole point of C2 is that it cannot.
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

    resetPrefs: () => {
      try { return ipcRenderer.invoke('wai:reset-prefs'); }
      catch (e) { log('resetPrefs invoke failed:', (e && e.message) || e); return null; }
    },

    getWhitelist: () => {
      try { return ipcRenderer.invoke('wai:whitelist-get'); }
      catch (e) { return null; }
    },

    setWhitelistRule: (payload) => {
      try { return ipcRenderer.invoke('wai:whitelist-set', payload); }
      catch (e) { return null; }
    },

    getNotes: () => {
      try { return ipcRenderer.invoke('wai:notes-get'); }
      catch (e) { return null; }
    },

    setNote: (payload) => {
      try { return ipcRenderer.invoke('wai:notes-set', payload); }
      catch (e) { return null; }
    },

    deleteNote: (payload) => {
      try { return ipcRenderer.invoke('wai:notes-delete', payload); }
      catch (e) { return null; }
    },

    clearNotes: () => {
      try { return ipcRenderer.invoke('wai:notes-clear'); }
      catch (e) { return null; }
    },

    exportEphemeralChat: (payload) => {
      try { return ipcRenderer.invoke('wai:export-ephemeral-chat', payload); }
      catch (e) { return null; }
    },

    /** The page raised the visible failure banner. */
    reportFailure: (reason, detail) => {
      try { ipcRenderer.send('wai:failure', String(reason), String(detail || '')); } catch (e) { /* ignore */ }
    },

    log: (level, ...args) => {
      forward(level || 'log', args);
    },

    /** Relay a notification from the page world to the main process Notification API. */
    sendNotification: (data) => {
      try { ipcRenderer.send('wai:notification', data); } catch (e) { /* ignore */ }
    },
  });
  state.bridgeReady = true;
}

// ------------------------------------------------------------------ steps

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
    // 1. The bridge has to exist before any hook or shim runs (C2).
    once('bridge', () => { installBridge(); state.done.bridge = true; }),

    // 1b. THE HARD DEADLINE, taken as early as possible (C1).
    once('nativeWs', () => evaluate('nativeWs', readHook('native-ws.js'))),
    // 1b2. Socket liveness tracker for the shim (state()/self-test read it).
    once('socketTracker', () => evaluate('socketTracker', readArtifact('socket-tracker.js'))),
    once('critical', () => evaluate('critical', readArtifact('critical.js'))),

    // 1c. Take over window.Notification early using the bridge.
    once('notifications', () => callPage('notifications', readHook('notifications.js'))),

    // 2. Synchronous bootstrap + shim (C4: zero regex substitution).
    once('bootstrap', () => evaluate('bootstrap', `window.__WAI_BOOTSTRAP__ = ${JSON.stringify(readBootstrap())};`)),
    once('shim', () => evaluate('shim', readArtifact('shim.js'))),

    once('diagnostics', () => evaluate('diagnostics', (PAGE_LOG ? 'window.__WAI_LOG_PAGE__ = true;\n' : '') + readHook('diagnostics.js'))),

    // 3. C4: the page CSP refuses shell-owned schemes, so CSS arrives as one inline
    //    <style> (style-src permits 'unsafe-inline') rather than a <link>.
    once('styles', () => evaluate('styles', readArtifact('styles.js'))),

    // 4. The remaining 1.3 MB of the main group. Separate call, same reason as above:
    //    concatenating the groups changes hoisting semantics (C3), and keeping them
    //    separate is also what guarantees the single shared UIClassNames exists before
    //    ui.js reads it. The socket is already patched by now, so the size costs nothing
    //    that matters.
    once('mainRest', () => evaluate('mainRest', readArtifact('main-rest.js'))),

    // Deferred scripts (none right now; the group exists so future deferred deps
    // can land without reordering the critical path).
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
const STEP_ORDER = [
  'bridge', 'nativeWs', 'socketTracker', 'critical', 'notifications',
  'bootstrap', 'shim', 'diagnostics', 'styles', 'mainRest', 'deferred', 'arm', 'ui',
];

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

// The shell's fallback when it has no native menu to offer: ask the page to open the options
// panel it injects into WhatsApp's menu bar. callPage, not evaluate — this asks the page to
// do something rather than injecting anything, and a page that has not finished loading has
// no panel to open, so a null answer is the expected case, not a failure to report.
//
// The answer goes back over wai:page-state rather than a new channel: main cannot ask the
// page itself (C1 — webContents.executeJavaScript is load-gated), so without this the shell
// would know it had asked but not whether anything appeared, and "unavailable" is exactly
// the case worth being able to diagnose.
ipcRenderer.on('wai:open-options', (_event, opts) => {
  callPage('openOptions', `window.__WAI__ && window.__WAI__.openOptions(${JSON.stringify(opts || {})})`)
    .then((opened) => {
      debug(`page options panel: ${opened === true ? 'opened' : 'unavailable'}`);
      sendSnapshot('options-panel', { opened: opened === true });
    });
});

ipcRenderer.on('wai:whitelist', (_event, rules) => {
  if (!rules || typeof rules !== 'object') return;
  callPage('whitelist', `window.__WAI__ && window.__WAI__.setWhitelist && window.__WAI__.setWhitelist(${JSON.stringify(rules)});`);
});

ipcRenderer.on('wai:notes', (_event, notes) => {
  if (!notes || typeof notes !== 'object') return;
  callPage('notes', `window.__WAI__ && window.__WAI__.setNotes && window.__WAI__.setNotes(${JSON.stringify(notes)});`);
});

// The renderer lifecycle signal, forwarded by main because a sandboxed preload has no
// `process.on`. This is what makes a first attempt's failure recoverable: without it, a
// step that lost a race with frame readiness would never be retried and the hook would
// silently not exist.
ipcRenderer.on('wai:frame-event', (_event, name) => { retryMissing(name); });

// ------------------------------------------------------------------ go

// Top of the preload, before the document's own scripts. C1: the whole reason this file
// is a preload and not a post-load hook.
retryMissing('preload');
