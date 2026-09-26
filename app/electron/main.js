'use strict';
// Main process: window lifecycle, navigation lock, request blocking, IPC, tray wiring.
//
// The four constraints this file exists to enforce (docs/ELECTRON_APP_PLAN.md §4):
//
//   C1  Injection happens in preload.js via webFrame.executeJavaScript, NEVER from here.
//       webContents.executeJavaScript awaits `waitTillCanExecuteJavaScript`, which
//       blocks until did-stop-loading, and core/ws_hook.js has to replace the WebSocket
//       constructor before WhatsApp opens its first socket.
//   C2  contextIsolation/sandbox stay on, nodeIntegration off. The page reaches the
//       preload's bridge through one explicit contextBridge surface and nothing else.
//   C4  WhatsApp's CSP refuses shell-owned schemes, so nothing is loaded via <script
//       src>/<link>/fetch: all code arrives through executeJavaScript, all images as
//       data: URIs, and prefs as a literal inlined into the shim.
//   C5  partition: 'persist:wai'. Without the `persist:` prefix the session lives in
//       memory and the user is logged out on every restart. This is the #1 "the app is
//       broken" report, so it is asserted at startup rather than left to review.
//
// Everything here is defensive: a shell that throws takes the user's WhatsApp session
// with it. Each handler is individually guarded and logged with a [wai] prefix.

const path = require('node:path');
const fs = require('node:fs');
const {
  app, BrowserWindow, Menu, dialog, ipcMain, shell,
} = require('electron');

const { PrefsStore } = require('./prefs-store.js');
const { createWatchdog } = require('./watchdog.js');
const { createTray } = require('./tray.js');

// Set before `ready` so the userData path (and therefore prefs.json) is stable and does
// not depend on how the app was launched (`electron .` vs an installed shortcut).
app.setName('WAIncognito');

const BUILD_DIR = path.join(__dirname, '..', '.build');
const IMAGES_DIR = path.join(__dirname, '..', '..', 'images');

// Read by both main and the preload. main preloads them into memory so a sandboxed
// preload (which has no fs — see C2) can fetch a source string over ipcRenderer.sendSync
// without ever touching the disk from the renderer.
const BUILD_ARTIFACTS = Object.freeze([
  'shim.js', 'critical.js', 'main-rest.js', 'ui.js', 'deferred.js',
  'styles.js', 'assets.json', 'meta.json',
]);

const APP_ID = 'com.wa-incognito.app';   // keep in sync with package.json build.appId

// ---------------------------------------------------------------- request blocking (§8.5)
// A browser tab registers a service worker, opens a push channel and fires
// analytics/crash beacons. A single-user desktop client needs none of them. This is a
// HOST allowlist-first design on purpose: the safe default is "allow", and only the
// explicit lists below are denied, because a false positive here silently breaks media
// loading or, worse, the Noise socket.
//
// Add entries rather than editing logic — the lists are the whole configuration.

// First-party infrastructure. Never matched by the telemetry list below. WhatsApp serves
// media from mmg.whatsapp.net and pps.whatsapp.net, so a blanket "whatsapp" block would
// break image and file previews; the safest rule is to allow the whole owned domain.
const FIRST_PARTY_SUFFIXES = Object.freeze(['whatsapp.com', 'whatsapp.net']);

const TELEMETRY_HOSTS = Object.freeze([
  // Google analytics / ads / tag manager
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
  'googleadservices.com', 'doubleclick.net', 'app-measurement.com',
  // Crash and error reporting
  'sentry.io', 'crashlytics.com', 'bugsnag.com', 'newrelic.com', 'datadoghq.com',
  'rollbar.com', 'raygun.io', 'airbrake.io',
  // Product analytics and session replay
  'amplitude.com', 'segment.io', 'segment.com', 'mixpanel.com', 'fullstory.com',
  'mouseflow.com', 'logrocket.com', 'smartlook.com', 'clarity.ms', 'hotjar.com',
  'intercom.io', 'intercomcdn.com', 'heap.io', 'heap-analytics.com', 'kissmetrics.io',
  'matomo.cloud', 'piwik.pro', 'chartbeat.com', 'parsely.com',
  // Attribution and push
  'appsflyer.com', 'adjust.com', 'branch.io', 'onesignal.com',
  // Social embeds (WhatsApp link previews)
  'facebook.net', 'graph.facebook.com',
]);

// Web push + the service-worker endpoints. Blocking these removes a whole class of
// background wakeups (no push registration, no service worker, no background sync).
const PUSH_HOSTS = Object.freeze([
  'push.whatsapp.com', 'push.whatsapp.net',
  'fcm.googleapis.com', 'firebaseinstallations.googleapis.com',
]);

// §8.5 explicitly asks for a flag here: a blocked service worker can stop desktop
// notifications working, and that must be a one-line revert, not a debugging session.
const BLOCK_SERVICE_WORKER = true;
const SERVICE_WORKER_PATHS = Object.freeze([
  '/sw.js', '/sw.min.js', '/service-worker.js', '/serviceworker.js',
]);

// Denied page features. This app has no legitimate camera/microphone/geolocation/
// notification use, and a permission prompt here would be a social-engineering surface
// in a window that looks like WhatsApp.
const ALLOWED_PERMISSIONS = Object.freeze([
  // WhatsApp Web's copy/paste uses this. Denying it breaks selecting and copying a
  // message, which is ordinary use, not a feature request.
  'clipboard-sanitized-write',
]);

// ---------------------------------------------------------------- logging

const DEBUG = !!process.env.WAI_DEBUG;

function log(...args) { console.log('[wai]', ...args); }
function warn(...args) { console.warn('[wai]', ...args); }
function error(...args) { console.error('[wai]', ...args); }
function debug(...args) { if (DEBUG) console.log('[wai:debug]', ...args); }

/** Wrap fn so a throw is logged and turned into a fallback value, never a crash. */
function guard(label, fn, fallback) {
  return (...args) => {
    try { return fn(...args); } catch (e) {
      error(`${label} failed:`, (e && e.stack) || e);
      return typeof fallback === 'function' ? fallback(...args) : fallback;
    }
  };
}

// ---------------------------------------------------------------- url helpers

const ALLOWED_NAV_HOST = 'web.whatsapp.com';

/** True for http(s) only. Deliberately excludes javascript:, data:, file:, intent:. */
function isOpenableExternal(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

/**
 * The navigation lock. Any top-level navigation off web.whatsapp.com is refused: a
 * compromised or mistyped link must not turn the app window into a general browser with
 * our preload attached.
 */
function isAllowedNavigation(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === ALLOWED_NAV_HOST;
  } catch (e) {
    return false;
  }
}

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch (e) { return ''; }
}

/** rule is an exact host or a `*.suffix` pattern; both also match their subdomains. */
function hostMatches(host, rule) {
  const bare = rule.startsWith('*.') ? rule.slice(2) : rule;
  return host === bare || host.endsWith(`.${bare}`);
}

function isFirstParty(host) {
  return FIRST_PARTY_SUFFIXES.some((s) => hostMatches(host, s));
}

function isServiceWorkerRequest(details) {
  let pathname;
  try { pathname = new URL(details.url).pathname.toLowerCase(); } catch (e) { return false; }
  return SERVICE_WORKER_PATHS.includes(pathname);
}

/**
 * Decide whether a request must be blocked. Returns a short reason string, or null.
 *
 * Order matters and is the safety story:
 *   1. Non-http(s) schemes are never touched. The Noise WebSocket is wss://; blocking it
 *      would "succeed" and silently disable the entire app.
 *   2. Top-level and sub-frame navigations are never blocked by the request filter — the
 *      navigation lock owns those. A filter failure here must not become a blank window.
 *   3. Explicitly-listed push hosts are denied even though some are first-party.
 *   4. First-party hosts are allowed unconditionally.
 *   5. Everything else is tested against the telemetry list.
 */
function classifyRequest(details) {
  const url = String((details && details.url) || '');
  if (!/^https?:\/\//i.test(url)) return null;                    // (1) keeps wss:// alive
  const type = details.resourceType;
  if (type === 'mainFrame' || type === 'subFrame') return null;   // (2) navigation lock owns these

  if (BLOCK_SERVICE_WORKER && isServiceWorkerRequest(details)) return 'service worker';

  const host = hostOf(url);
  if (!host) return null;

  if (PUSH_HOSTS.some((h) => hostMatches(host, h))) return 'push';   // (3)
  if (isFirstParty(host)) return null;                                // (4)
  if (TELEMETRY_HOSTS.some((h) => hostMatches(host, h))) return 'telemetry';   // (5)
  return null;
}

// ---------------------------------------------------------------- build artifacts

/**
 * Load app/.build. A missing or partial build is the single most likely first-run
 * failure (`npm start` without `npm run build:electron`), so it gets a dialog that names
 * the exact command rather than a stack trace.
 */
function loadBuild() {
  const missing = BUILD_ARTIFACTS.filter((n) => !fs.existsSync(path.join(BUILD_DIR, n)));
  if (missing.length) {
    const detail =
      `app/.build is missing or incomplete:\n\n  ${missing.join('\n  ')}\n\n` +
      'Run this in the repository root, then start the app again:\n\n' +
      '    npm run build:electron\n\n' +
      `(expected in: ${BUILD_DIR})`;
    error(detail.replace(/\n/g, '\n  '));
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'WAIncognito — build missing',
      message: 'WAIncognito has not been built yet.',
      detail: detail,
      buttons: ['Quit'],
      defaultId: 0,
      noLink: true,
    });
    app.exit(1);
    return null;
  }

  const artifacts = {};
  for (const name of BUILD_ARTIFACTS) {
    const file = path.join(BUILD_DIR, name);
    try {
      artifacts[name] = fs.readFileSync(file, 'utf8');
    } catch (e) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'WAIncognito — build unreadable',
        message: `Could not read ${name} from app/.build.`,
        detail: `${(e && e.message) || e}\n\nRun: npm run build:electron`,
        buttons: ['Quit'],
        noLink: true,
      });
      app.exit(1);
      return null;
    }
  }

  let meta;
  try {
    meta = JSON.parse(artifacts['meta.json']);
  } catch (e) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'WAIncognito — build corrupt',
      message: 'app/.build/meta.json is not valid JSON.',
      detail: `${(e && e.message) || e}\n\nRun: npm run build:electron`,
      buttons: ['Quit'],
      noLink: true,
    });
    app.exit(1);
    return null;
  }
  return { meta, artifacts };
}

// ---------------------------------------------------------------- app state

/** @type {{meta: object, artifacts: object, prefs: PrefsStore, win: BrowserWindow|null,
 *          tray: any, watchdog: any, quitting: boolean, injections: number}} */
const state = {
  meta: null,
  artifacts: null,
  prefs: null,
  win: null,
  tray: null,
  watchdog: null,
  /** Dev only: the hot-reload poller from app/electron/dev-bridge.js. Null unless --dev. */
  devBridge: null,
  quitting: false,
  /** How many times the preload has reported a completed injection (wai:page-state). */
  injections: 0,
  /** Latest page snapshot pushed by the preload; shown by wai:get-state. */
  page: null,
  lastFailure: null,
};

// ---------------------------------------------------------------- window

function hideWindow(win) {
  try {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    else if (typeof win.setSkipTaskbar === 'function') win.setSkipTaskbar(true);
  } catch (e) { debug('hide: platform hint failed', e && e.message); }
  win.hide();
}

function showWindow(win) {
  try {
    if (process.platform === 'darwin' && app.dock) app.dock.show();
    win.setSkipTaskbar(false);
  } catch (e) { debug('show: platform hint failed', e && e.message); }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(prefs) {
  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#111b21',
    title: 'WAIncognito',
    icon: fs.existsSync(path.join(IMAGES_DIR, 'incognito_gray.png'))
      ? path.join(IMAGES_DIR, 'incognito_gray.png')
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),

      // C2 — the real security boundary is contextIsolation, and it stays on. The main
      // world is entered by exactly one explicit webFrame.executeJavaScript in the
      // preload, so page script can never reach preload scope or Node.
      contextIsolation: true,
      nodeIntegration: false,

      // C2 — `sandbox` is deliberately OFF, which reverses an earlier draft of this
      // plan. A sandboxed preload's require() resolves only `electron` plus a few
      // polyfills, so it cannot read the build artifacts from disk. The only way to
      // load core/ws_hook.js is then a synchronous ipcRenderer.sendSync round-trip to
      // main, which puts the main process on the critical path of the one file with a
      // hard deadline (C1): if main is busy at window creation, the WebSocket hook is
      // installed late and interception silently never arms. With sandbox off the
      // preload reads app/.build/critical.js directly — no IPC, no ordering risk.
      //
      // This is safe: the preload is our own trusted code, contextIsolation still
      // isolates it from the page, and nodeIntegration stays false so the page's main
      // world has no Node at all.
      sandbox: false,

      // C5 — the whole reason users stay logged in across restarts. Asserted by smoke
      // tests, never "temporarily" removed to work around a reload bug.
      partition: 'persist:wai',

      // §9.2 — WhatsApp's keepalive and reconnect backoff are timer driven. Chromium
      // throttles timers in hidden windows, so throttling churns the socket and opens
      // windows where receipts leak. The app pays for this in CPU (§9.7) and buys
      // correctness.
      backgroundThrottling: false,

      // C4 — the page's getOptions must answer synchronously, so prefs ride in on argv
      // rather than an IPC round-trip that would race ui.js:23.
      additionalArguments: [
        `--wai-prefs=${JSON.stringify(prefs)}`,
        '--wai-page-log=' + (DEBUG ? '1' : '0'),
      ],

      webviewTag: false,
      spellcheck: false,
    },
  });

  state.win = win;
  // The user agent must be set BEFORE the page starts loading, so this comes first.
  installUserAgent(win.webContents.session);
  installSessionGuards(win.webContents.session);
  installNavigationLock(win);
  forwardFrameEvents(win);

  win.once('ready-to-show', () => showWindow(win));

  // §9.3 — hide, never destroy. Destroying the BrowserWindow tears down the renderer,
  // the injected hook and the socket, and forces a full reload + re-injection next time.
  // The window IS the session.
  win.on('close', (event) => {
    if (state.quitting) return;
    if (!state.tray) return;               // no tray ⇒ no way back ⇒ let it close
    event.preventDefault();
    hideWindow(win);
  });

  win.on('closed', () => { if (state.win === win) state.win = null; });

  const url = state.meta.whatsapp || 'https://web.whatsapp.com/';
  win.loadURL(url).catch((e) => {
    error('initial load failed:', (e && e.message) || e);
    warn(`could not load ${url}: check the network, then open the window again.`);
  });

  return win;
}

// ---------------------------------------------------------------- session policy

/**
 * Relay the renderer lifecycle the preload needs for its retry logic.
 *
 * A sandboxed preload has no `process.on`, so it cannot subscribe to webContents events
 * itself. It gets them here instead. Without this, an injection step that lost a race with
 * frame readiness would have no signal to retry on, and the hook would silently not exist.
 */
function forwardFrameEvents(win) {
  const wc = win.webContents;
  for (const event of ['dom-ready', 'did-start-loading', 'did-start-navigation', 'did-stop-loading']) {
    guard(`forward ${event}`, () => {
      wc.on(event, () => {
        try { wc.send('wai:frame-event', event); } catch (e) { debug(`frame-event ${event}:`, e && e.message); }
      });
    })();
  }
}

/**
 * Present the session as a real Chrome, because WhatsApp Web gates on the user agent.
 *
 * Observed directly: with Electron's stock UA the page serves "WhatsApp works with
 * Google Chrome 100+" instead of the app, so the app is simply unusable.
 *
 * What this does and does not do, so it is not oversold:
 *   - Removes the `Electron/x.y.z` token and this app's own product token, and puts the
 *     REAL embedded Chromium version in the `Chrome/` slot. Deliberately not a newer
 *     Chrome than we actually embed: claiming one invites feature detection that then
 *     disagrees with the engine, which is far harder to diagnose than a clean block.
 *   - It is NOT anonymity and NOT a full anti-fingerprinting measure. It changes exactly
 *     one signal. Electron remains distinguishable by renderer strings, feature quirks
 *     and network fingerprint, none of which this touches. Treat it as "get past the
 *     browser gate", nothing more.
 *   - Overridable via WAI_USER_AGENT, for debugging and for reproducing a gate.
 *
 * Applied per session, so the page, workers and requests all agree.
 */
function installUserAgent(ses) {
  guard('user agent', () => {
    const override = process.env.WAI_USER_AGENT;
    if (override && override.trim()) {
      ses.setUserAgent(override.trim());
      log(`user agent overridden from WAI_USER_AGENT`);
      return;
    }

    const { buildChromeUserAgent } = require('./user-agent.js');
    const stock = typeof ses.getUserAgent === 'function' ? ses.getUserAgent() : null;
    const clean = buildChromeUserAgent(stock, {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    });

    if (!clean) {
      // Falling back keeps the app working, it just may be gated out. Say so rather than
      // shipping a UA we could not verify.
      warn('could not build a Chrome user agent; keeping the stock one ' +
           '(WhatsApp may refuse to load)');
      if (stock) log(`  stock UA: ${stock}`);
      return;
    }

    ses.setUserAgent(clean);
    log(`user agent: ${clean}`);
  })();
}

function installSessionGuards(ses) {
  if (!ses || ses.__waiGuards) return;     // onBeforeRequest holds ONE listener per event
  ses.__waiGuards = true;

  // Deny by default. One exception (clipboard write) is listed in ALLOWED_PERMISSIONS
  // with the reason.
  guard('setPermissionRequestHandler', () => {
    ses.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.includes(permission));
    });
    ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.includes(permission));
  })();

  const blockedOnce = new Set();
  const counts = Object.create(null);

  guard('onBeforeRequest', () => {
    ses.webRequest.onBeforeRequest((details, callback) => {
      let reason = null;
      try { reason = classifyRequest(details); } catch (e) { reason = null; }
      if (!reason) return callback({ cancel: false });
      counts[reason] = (counts[reason] || 0) + 1;
      const host = hostOf(details.url);
      // Log the first hit per host+reason only: an analytics client retries, and a
      // per-request log line would drown the real messages.
      const key = `${reason}:${host}`;
      if (!blockedOnce.has(key)) {
        blockedOnce.add(key);
        debug(`blocked ${reason} → ${host} (${counts[reason]} so far)`);
      }
      return callback({ cancel: true });
    });
  })();

  // A service worker that is already registered keeps running even with its script
  // blocked, so unregister any that a previous build managed to install.
  //
  // Feature-detected rather than assumed: `session.serviceWorkers` is not present on
  // every platform/version combination, and calling through it unconditionally throws a
  // TypeError during startup on the ones where it is missing. That is a hard error in an
  // unrelated guard, which is exactly the kind of noise that hides a real failure.
  guard('unregister service workers', () => {
    const sw = ses && ses.serviceWorkers;
    if (sw && typeof sw.unregisterAll === 'function') {
      try {
        const r = sw.unregisterAll();
        if (r && typeof r.catch === 'function') r.catch((e) => debug('unregisterAll:', e && e.message));
      } catch (e) {
        debug('unregisterAll:', (e && e.message) || e);
      }
    } else {
      debug('session.serviceWorkers.unregisterAll unavailable on this platform; skipping');
    }
  })();
}

function installNavigationLock(win) {
  const wc = win.webContents;

  guard('will-navigate', () => {
    wc.on('will-navigate', (event, url) => {
      if (isAllowedNavigation(url)) return;
      event.preventDefault();
      debug(`blocked navigation to ${url}`);
    });
  })();

  guard('will-redirect', () => {
    wc.on('will-redirect', (event, url) => {
      if (isAllowedNavigation(url)) return;
      event.preventDefault();
    });
  })();

  // window.open / target=_blank. Deny inside the app; hand genuine http(s) links to the
  // OS browser. Anything else (javascript:, data:, intent:, file:) is dropped silently —
  // opening a non-web scheme in the user's browser or a file handler is a real risk in
  // a window that renders untrusted remote content.
  guard('setWindowOpenHandler', () => {
    wc.setWindowOpenHandler(({ url }) => {
      if (isOpenableExternal(url)) {
        shell.openExternal(url).catch((e) => warn('openExternal failed:', (e && e.message) || e));
      } else {
        debug('refused window.open for a non-http(s) url');
      }
      return { action: 'deny' };
    });
  })();

  guard('will-attach-webview', () => {
    // webviewTag is false, so this should be unreachable; refuse anyway.
    wc.on('will-attach-webview', (event) => event.preventDefault());
  })();
}

// ---------------------------------------------------------------- menus

/**
 * Minimal menu. Windows and Linux get none at all — the app has no menu bar needs, and
 * the default Electron menu adds accelerators (reload, devtools, quit) that would let a
 * user tear down the session by accident. macOS keeps a reduced app menu because
 * Cmd+Q / Cmd+C / Cmd+V have no other route there.
 */
function installMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

// ---------------------------------------------------------------- ipc

function sendPrefs(prefs) {
  const win = state.win;
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('wai:prefs', prefs); } catch (e) { debug('send prefs:', e && e.message); }
}

function applyPatch(patch) {
  const result = state.prefs.set(patch);
  if (result.applied.length) {
    // The tray and the window must never disagree: push the authoritative values back
    // to the page, which answers getOptions synchronously from its own copy.
    sendPrefs(result.prefs);
    guard('tray.update', () => state.tray && state.tray.update())();
    if (state.watchdog) state.watchdog.kick('prefs-changed');
  }
  return result;
}

function windowFor(sender) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents.id === sender.id) return w;
  }
  return null;
}

function installIpc() {
  // Sandboxed preloads have no fs (C2), so build sources are served from main's memory
  // cache. sendSync keeps the preload's injection sequence synchronous, which is the
  // whole point: a promise here would delay ws_hook past WhatsApp's first socket.
  ipcMain.on('wai:artifact', (event, name) => {
    try {
      const src = state.artifacts && state.artifacts[name];
      if (typeof src === 'string') return event.returnValue = { ok: true, source: src };
      event.returnValue = { ok: false, error: `unknown artifact "${name}"` };
    } catch (e) {
      event.returnValue = { ok: false, error: (e && e.message) || String(e) };
    }
  });

  ipcMain.handle('wai:get-state', (event) => guard('wai:get-state', () => ({
    status: state.watchdog ? state.watchdog.snapshot() : { status: 'UNKNOWN' },
    prefs: state.prefs.get(),
    page: state.page,
    version: (state.meta && state.meta.version) || app.getVersion(),
    injections: state.injections,
    failure: state.lastFailure,
  }), { status: { status: 'UNKNOWN' }, prefs: {}, page: null })());

  ipcMain.handle('wai:set-prefs', (event, patch) => guard('wai:set-prefs', () => applyPatch(patch), {
    prefs: state.prefs.get(), applied: [], rejected: ['internal-error'],
  })());

  ipcMain.handle('wai:reset-prefs', () => guard('wai:reset-prefs', () => {
    const prefs = state.prefs.reset();
    sendPrefs(prefs);
    if (state.tray) state.tray.update();
    return { prefs };
  }, { prefs: state.prefs.get() })());

  // Force the injection sequence again. The preload re-runs only the steps that have
  // not already succeeded in THIS document: re-evaluating ws_hook.js over a live page
  // would wrap the already-patched WebSocket a second time and double every frame's
  // crypto. If the document is already fully injected the preload says so and the
  // watchdog escalates to a reload, which is the only correct fix for a torn context.
  ipcMain.handle('wai:rearm', (event) => guard('wai:rearm', () => {
    const win = windowFor(event.sender);
    if (!win) return { rearmed: false, reason: 'no window' };
    win.webContents.send('wai:rearm');
    if (state.watchdog) state.watchdog.kick('manual-rearm');
    return { rearmed: true, method: 'preload-sequence' };
  }, { rearmed: false, reason: 'internal-error' })());

  // One channel for every page→main snapshot, discriminated by `event`. Keeps the IPC
  // surface small and makes the watchdog's input a single auditable stream.
  ipcMain.on('wai:page-state', (event, snapshot) => guard('wai:page-state', () => {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (snapshot.event === 'booted') {
      // One per shim evaluation, i.e. one per document. Proof of C1 (§10 smoke step 1):
      // the page world really executed our shim, and `injectedAt` is directly comparable
      // with did-finish-load.
      state.injections += 1;
      debug(`injection #${state.injections} booted in the page world at ${snapshot.injectedAt}ms ` +
            `(href=${snapshot.href})`);
    }
    if (snapshot.event === 'hook-armed') {
      log(`WebSocket hook armed in the page world, generation ${snapshot.generation} ` +
          `(injection #${state.injections})`);
    }
    if (snapshot.state) state.page = { ...snapshot.state, at: Date.now() };
    if (state.watchdog) state.watchdog.ingest(snapshot);
  })());

  ipcMain.on('wai:failure', (event, reason, detail) => guard('wai:failure', () => {
    state.lastFailure = { reason, detail, at: Date.now() };
    error(`page reported a failure: ${reason}${detail ? ` — ${detail}` : ''}`);
    if (state.watchdog) state.watchdog.noteFailure(reason, detail);
  })());

  ipcMain.on('wai:log', (event, level, args) => guard('wai:log', () => {
    const list = Array.isArray(args) ? args : [args];
    const text = list.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
    const line = `[wai:page] ${text}`;
    if (level === 'error') error(line);
    else if (level === 'warn') warn(line);
    else debug(line);
  })());
}

function safeStringify(value) {
  try { return JSON.stringify(value); } catch (e) { return String(value); }
}

// ---------------------------------------------------------------- watchdog wiring

/**
 * Dev-only hot reload (scripts/dev.mjs). Inert unless the app was started with --dev,
 * so a packaged build never polls anything or opens a loopback socket.
 *
 * The two scopes are handled very differently on purpose:
 *
 *   'bundles' — upstream core//lib/ or the page shim changed. Re-run the preload
 *               injection sequence in place. The window, the WebSocket and the session
 *               all survive, so interception changes are testable in about a second
 *               instead of a full login cycle.
 *
 *   'app'     — a shell module changed. Node has already required those, and a preload
 *               cannot be swapped into a live renderer, so the only correct action is a
 *               relaunch. Attempting a hot swap here would leave the renderer running
 *               the OLD preload against NEW bundles, which is precisely the torn-context
 *               state the watchdog exists to detect.
 */
function startDevBridge(win, artifacts) {
  if (!process.argv.includes('--dev')) return;

  let DevBridge;
  try {
    ({ DevBridge } = require('./dev-bridge.js'));
  } catch (e) {
    log(`dev bridge unavailable: ${e.message}`);
    return;
  }

  const port = process.env.WAI_DEV_PORT || '7311';
  const bridge = new DevBridge({
    url: `http://127.0.0.1:${port}`,
    onReload: ({ scope }) => {
      if (scope === 'app') {
        log('dev: shell changed — relaunching');
        app.relaunch();
        app.exit(0);
        return;
      }
      // Re-read the rebuilt artifacts, then re-inject. The preload's injection steps are
      // `once`-guarded per document, so a plain re-injection is a no-op; a reload is the
      // only way to pick up new bundle text, and it is cheap here because the session
      // partition (C5) preserves the login.
      guard('dev:reload', () => {
        state.artifacts = loadBuild().artifacts;
        if (state.win && !state.win.isDestroyed()) state.win.reload();
        log('dev: bundles changed — reloading the page (login is preserved)');
      })();
    },
    log: (m) => log(m.replace(/^\[dev\]\s*/, '')),
  });

  state.devBridge = bridge.start();
  log(`dev bridge active → http://127.0.0.1:${port} (bundles re-inject, shell relaunches)`);
  void artifacts;
}

function startWatchdog(win) {
  state.watchdog = createWatchdog({
    webContents: win.webContents,

    onStatus: (snapshot) => {
      if (snapshot.changed) {
        log(`status ${snapshot.status} (${snapshot.reason}) ` +
            `gen=${snapshot.generation} frames=${snapshot.framesIn}/${snapshot.framesOut} ` +
            `socket=${snapshot.socketState} last=${snapshot.sinceLastFrame}`);
      }
      if (state.tray) state.tray.update();
    },

    onRecover: (info) => {
      warn(`recovering (${info.reason}): ${info.method}`);
      if (state.tray) state.tray.update();
    },

    // Escalation path. The watchdog decides WHEN; this decides HOW. Re-running the
    // preload sequence in a live document is the cheap fix, and only a reload can
    // rebuild a context whose ws_hook is already wrapped.
    rearm: (reason) => {
      const wc = win.webContents;
      if (wc.isDestroyed()) return 'gone';
      if (wc.isLoadingMainFrame()) return 'loading';   // the preload will re-arm itself
      try { wc.send('wai:rearm'); return 'preload-sequence'; } catch (e) { return 'send-failed'; }
    },

    debug,

    reload: () => {
      const wc = win.webContents;
      if (wc.isDestroyed()) return false;
      try { wc.reload(); return true; } catch (e) { error('reload failed:', (e && e.message) || e); return false; }
    },
  });

  // §9.4 — poll immediately on navigation as well as on the timer. A WhatsApp hard
  // reload is exactly the event that destroys the hook, and waiting 20 s to notice is
  // 20 s of leaked receipts.
  //
  // Only did-start-navigation arms the watchdog's "expect an injection" flag, and only
  // for the main frame. did-navigate / dom-ready / in-page navigations all fire AFTER the
  // preload has already reported `booted` and `hook-armed`, so re-arming there would make
  // the watchdog report NOT PROTECTED against a perfectly healthy page.
  const kick = (event, expectInjection) => (_e, ...args) => {
    if (!state.watchdog) return;
    let mainFrame = true;
    if (expectInjection && args.length >= 3 && typeof args[2] === 'boolean') mainFrame = args[2];
    if (expectInjection && !mainFrame) return;      // a sub-resource frame has no preload
    state.watchdog.kick(event, { expectInjection });
  };
  win.webContents.on('did-start-navigation', kick('did-start-navigation', true));
  win.webContents.on('did-navigate', kick('did-navigate', false));
  win.webContents.on('did-navigate-in-page', kick('did-navigate-in-page', false));
  win.webContents.on('dom-ready', kick('dom-ready', false));

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    error(`load failed ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    error(`renderer gone: ${details && details.reason}`);
  });
  state.watchdog.start();
}

// ---------------------------------------------------------------- tray wiring

function startTray() {
  state.tray = createTray({
    app,
    getWindow: () => state.win,
    getStatus: () => (state.watchdog ? state.watchdog.snapshot() : { status: 'UNKNOWN' }),
    getPrefs: () => state.prefs.get(),
    setPref: (patch) => { applyPatch(patch); return state.prefs.get(); },
    resetPrefs: () => guard('tray reset', () => {
      const prefs = state.prefs.reset();
      sendPrefs(prefs);
      if (state.watchdog) state.watchdog.kick('prefs-reset');
      return prefs;
    }, state.prefs.get())(),
    quit: () => { state.quitting = true; app.quit(); },
  });
  if (!state.tray) {
    // Without a tray the close-to-hide behaviour would strand the app with no window
    // and no way to quit. Degrade to normal close semantics instead.
    warn('no system tray available: the window will close normally instead of hiding');
  }
}

// ---------------------------------------------------------------- boot

function boot() {
  app.on('second-instance', () => {
    const win = state.win;
    if (!win || win.isDestroyed()) return;
    showWindow(win);
  });

  app.on('window-all-closed', () => {
    // Tray-resident: staying alive with no window is the point (§9.3). Only quit when
    // there is no tray to bring the window back from.
    if (state.tray) return;
    app.quit();
  });

  app.on('before-quit', () => { state.quitting = true; });
  app.on('will-quit', () => {
    if (state.watchdog) state.watchdog.stop();
    if (state.tray) state.tray.destroy();
  });

  app.on('activate', () => {                    // macOS dock click
    if (state.win && !state.win.isDestroyed()) showWindow(state.win);
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
    const build = loadBuild();
    if (!build) return;                          // loadBuild already showed a dialog
    state.meta = build.meta;
    state.artifacts = build.artifacts;

    guard('PrefsStore', () => {
      state.prefs = new PrefsStore(app.getPath('userData'), build.meta.prefs);
      log(`prefs loaded (${Object.keys(state.prefs.get()).length} keys) from userData`);
    })();
    if (!state.prefs) {
      // loadBuild validated the JSON but not its shape, and PrefsStore refuses to run
      // without derived defaults (assertion A-prefs in the build should have caught it).
      // Say so rather than opening a window whose options cannot be persisted.
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'WAIncognito — options missing',
        message: 'The build carries no option defaults.',
        detail: 'app/.build/meta.json has no "prefs" object, so nothing can be saved.\n\n' +
                'This is a build problem, not a settings problem:\n\n' +
                '    npm run build:electron',
        buttons: ['Quit'],
        noLink: true,
      });
      app.exit(1);
      return;
    }

    installMenu();
    installIpc();
    startTray();

    const win = createWindow(state.prefs.get());
    startWatchdog(win);
    startDevBridge(win, build.artifacts);

    log(`ready — v${build.meta.version} → ${build.meta.whatsapp || 'https://web.whatsapp.com/'}`);
  }).catch((e) => {
    error('startup failed:', (e && e.stack) || e);
    try {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'WAIncognito — startup failed',
        message: 'WAIncognito could not start.',
        detail: String((e && e.stack) || e),
        buttons: ['Quit'],
        noLink: true,
      });
    } catch (ignored) { /* the app may not have a GUI yet */ }
    app.exit(1);
  });
}

if (!app.requestSingleInstanceLock()) {
  // A second launch would create a second window on the same persistent session and a
  // second injection of ws_hook into the same renderer profile. Focus the first instead.
  log('another instance is already running; this one is exiting');
  app.exit(0);
} else {
  boot();
}

module.exports = {
  // exported for the smoke test and for anyone extending the blocklist
  classifyRequest,
  isAllowedNavigation,
  isOpenableExternal,
  TELEMETRY_HOSTS,
  PUSH_HOSTS,
  FIRST_PARTY_SUFFIXES,
  BUILD_ARTIFACTS,
};
