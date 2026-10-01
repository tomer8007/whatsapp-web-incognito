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
  app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeImage, nativeTheme, desktopCapturer, screen,
} = require('electron');

// ---------------------------------------------------------------- Wayland (must be before app loads)
// Ported from WhatsLNX, minus its ELECTRON_DISABLE_SANDBOX env-var handling: this app passes
// the equivalent switch itself, unconditionally, a few lines below (see "Linux sandbox" for
// why that is the default rather than an opt-in). The three switches here are kept: without
// ozone-platform-hint=auto Electron picks XWayland on a Wayland session, and
// WaylandWindowDecorations is what gives the window real client-side decorations.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations,WebRTCPipeWireCapturer');
}

// ---------------------------------------------------------------- Linux sandbox (must be before app loads)
//
// Chromium needs `chrome-sandbox` to be owned by root with mode 4755. An npm/pnpm install
// unpacks it as the invoking user, so it never is, and Chromium normally falls back to the
// unprivileged namespace sandbox. Where that fallback is unavailable — a container, a
// restricted VM, any seccomp/AppArmor profile that blocks unshare(CLONE_NEWUSER) — Chromium
// aborts before a window exists:
//
//   [FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc] The SUID sandbox helper binary
//   was found, but is not configured correctly. Rather than run without sandboxing I'm
//   aborting now.
//
// The alternative is a sudo chown/chmod of a file inside node_modules, which is not something
// an app can ask of its user at every launch and which a reinstall undoes anyway. So the
// zygote sandbox is off by default on Linux and this line is the whole of it.
//
// WHAT THAT COSTS, stated plainly: --no-sandbox drops the zygote boundary for the entire
// process, so utility processes are not contained. The per-renderer `sandbox: false` in
// createWindow (C2) is a separate and much narrower decision — it covers the one renderer that
// loads our bundles — and it is unchanged. The surface this actually matters for is the
// WhatsApp page itself, which already runs unsandboxed, and which this app deliberately points
// at web.whatsapp.com and nothing else (see isAllowedNavigation).
//
// Windows and macOS are untouched: this switch is Linux-only, and on those platforms the
// platform sandbox is a real boundary that nothing here disables.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}

// stdout/stderr are closed when the app is launched from a dock/dash/desktop file
// (no terminal) or from an AppImage with its output pipes shut. A bare
// console.log/warn/error then throws EPIPE synchronously, and Electron turns that
// into the "A JavaScript error occurred in the main process" dialog. Logging must
// never be able to crash the shell, so every console method is made non-throwing
// and async pipe errors are swallowed here, once, for the whole main process
// (this also covers tray.js / prefs-store.js, which share this console object).
(function installSafeConsole() {
  for (const stream of [process.stdout, process.stderr]) {
    try {
      stream.on('error', () => { /* EPIPE on a closed pipe: ignore */ });
    } catch (e) { /* ignore */ }
  }
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
    const orig = console[method];
    if (typeof orig !== 'function') continue;
    console[method] = (...args) => {
      try { orig(...args); } catch (e) { /* logging must never throw */ }
    };
  }
})();

const { PrefsStore } = require('./prefs-store.js');
const { createWatchdog } = require('./watchdog.js');
const { createTray, labelOf, counters } = require('./tray.js');
const { buildSettingsTemplate, numericRanges } = require('./settings-menu.js');
const desktopIntegration = require('./desktop-integration.js');

// Set before `ready` so the userData path (and therefore prefs.json) is stable and does
// not depend on how the app was launched (`electron .` vs an installed shortcut).
//
// This is the ONE place the name is deliberately kept without a space, and it is not a
// branding choice: setName is what names the userData directory, so this string is a
// directory key. It is what ~/.config/WAIncognito/prefs.json is called today, and
// changing it would orphan every existing user's saved preferences — interception
// settings, safety delay and all — with no migration to recover them. The user-visible
// name is "Whatsapp Incognito"; this is the folder it lands in.
app.setName('WAIncognito');

const BUILD_DIR = path.join(__dirname, '..', '.build');
const IMAGES_DIR = path.join(__dirname, '..', '..', 'images');

// Same icon as the extension (manifest.json `icons` + `action.default_icon`):
// images/icon_128_blue.png. app/packaging/icon.{png,ico,icns} is generated from it
// for the installers; the window/tray use the source PNG directly so dev
// (`electron .`) and packaged builds show the same branding.
const WINDOW_ICON_CANDIDATES = Object.freeze([
  path.join(IMAGES_DIR, 'icon_128_blue.png'),
  path.join(IMAGES_DIR, 'icon_128_reshaped.png'),
  path.join(IMAGES_DIR, 'incognito_gray.png'),
]);

// A string path inside app.asar is not reliably readable by the native window
// manager on Linux, so resolve to a decoded NativeImage (which `icon` also
// accepts) instead of a path. Falls back to undefined rather than a broken path.
function resolveWindowIcon() {
  for (const file of WINDOW_ICON_CANDIDATES) {
    try {
      if (!fs.existsSync(file)) continue;
      const img = nativeImage.createFromPath(file);
      if (img && typeof img.isEmpty === 'function' && !img.isEmpty()) return img;
    } catch (e) { /* try next */ }
  }
  return undefined;
}

// Read by both main and the preload. main preloads them into memory so a sandboxed
// preload (which has no fs — see C2) can fetch a source string over ipcRenderer.sendSync
// without ever touching the disk from the renderer.
const BUILD_ARTIFACTS = Object.freeze([
  'shim.js', 'critical.js', 'main-rest.js', 'ui.js', 'deferred.js',
  'styles.js', 'assets.json', 'meta.json',
]);

const APP_ID = 'com.wa-incognito.app';   // keep in sync with package.json build.appId

// Shell-only defaults, merged over the interception defaults derived from
// background.js at build time (scripts/build.mjs). They live here — NOT in
// background.js — so the extension never sees them: there is no autostart
// concept in a browser tab. The page ignores unknown keys by design
// (shim.js applyPrefs / core/ui.js use explicit keys), so letting this flow
// through sendPrefs/LIVE_PREFS needs no page change.
const SHELL_DEFAULTS = Object.freeze({
  // Start automatically on login. Applied by applyAutostart(): native login
  // items on Windows/macOS, xdg-desktop-portal Background + an XDG autostart
  // file fallback on Linux.
  autostart: false,
});

// ---------------------------------------------------------------- window state persistence (task 10)
// Saved separately from PrefsStore (which owns interception prefs) to keep concerns clean.
// Falls back to defaults on any read error so a corrupt file never blocks startup.
const WIN_STATE_DEFAULTS = { width: 1280, height: 880, x: undefined, y: undefined, maximized: false };

function loadWindowState() {
  try {
    const file = require('node:path').join(app.getPath('userData'), 'window-state.json');
    const raw = require('node:fs').readFileSync(file, 'utf8');
    const s = JSON.parse(raw);
    return {
      width:     (typeof s.width === 'number' && s.width >= 400) ? s.width : WIN_STATE_DEFAULTS.width,
      height:    (typeof s.height === 'number' && s.height >= 300) ? s.height : WIN_STATE_DEFAULTS.height,
      x:         (typeof s.x === 'number') ? s.x : undefined,
      y:         (typeof s.y === 'number') ? s.y : undefined,
      maximized: s.maximized === true,
    };
  } catch (e) { return { ...WIN_STATE_DEFAULTS }; }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const state = {
      width:     win.isMaximized() ? WIN_STATE_DEFAULTS.width : bounds.width,
      height:    win.isMaximized() ? WIN_STATE_DEFAULTS.height : bounds.height,
      x:         win.isMaximized() ? undefined : bounds.x,
      y:         win.isMaximized() ? undefined : bounds.y,
      maximized: win.isMaximized(),
    };
    const file = require('node:path').join(app.getPath('userData'), 'window-state.json');
    require('node:fs').writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) { debug('saveWindowState failed:', e && e.message); }
}

// ---------------------------------------------------------------- window position clamping (task 8, from WhatsLNX)
// Prevent a window from opening off-screen after a monitor is disconnected.
function clampWindowPosition(x, y, width, height) {
  if (x == null || y == null) return { x: undefined, y: undefined };
  const displays = screen.getAllDisplays();
  const MARGIN = 50;
  const visible = displays.some((d) => {
    const wa = d.workArea;
    return x >= wa.x - MARGIN && x < wa.x + wa.width && y >= wa.y - MARGIN && y < wa.y + wa.height;
  });
  if (visible) return { x, y };
  const primary = screen.getPrimaryDisplay().workArea;
  return { x: primary.x + 50, y: primary.y + 50 };
}

// ---------------------------------------------------------------- deep link handler (task 7, from WhatsLNX)
// The deep link parser lives in its own module so it can be unit tested — it is the only
// thing between an OS-supplied URI and a loadURL call. See deep-link.js.
const { buildDeepLinkUrl, isDeepLink } = require('./deep-link');

let _pendingDeepLink = null;

function handleDeepLink(url) {
  const target = buildDeepLinkUrl(url);
  if (!target) return;
  const win = state.win;
  if (!win || win.isDestroyed()) { _pendingDeepLink = target; return; }
  win.webContents.loadURL(target).catch((e) => warn('deep link load failed:', e && e.message));
  showWindow(win);
}

/**
 * Take the queued deep link, if any, and navigate to it. Clears the slot BEFORE awaiting
 * the load so a second caller cannot pick up the same URL and navigate twice.
 *
 * There is exactly one caller — the window's ready-to-show. An earlier revision also
 * consumed it from did-finish-load, and the two raced: whichever lost left the URL
 * unconsumed until the window was already on screen, at which point the late consumer
 * fired a second loadURL and the user watched the app visibly reload after it appeared.
 * ready-to-show is the correct and only moment — showWindow has run by then, so the
 * navigation happens behind a window that is already up.
 */
function consumePendingDeepLink(win) {
  const target = _pendingDeepLink;
  if (!target) return;
  _pendingDeepLink = null;
  win.webContents.loadURL(target).catch((e) => warn('deep link load failed:', e && e.message));
}

// C5: the session partition. Declared once because TWO places need it and they must not
// drift — `session.fromPartition(PARTITION)` to configure the UA before the window exists,
// and `webPreferences.partition` to attach the window to it. Getting these out of sync
// means configuring a session the window does not use, which fails silently.
const PARTITION = 'persist:wai';

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
//
// Reverted to false on evidence. Blocking web.whatsapp.com/sw.js also broke WhatsApp's
// bootloader pipeline, and the PDF viewer stalled on a permanent spinner as a result:
// its lazily-loaded modules (WAWebTPPdfViewerContextMenu and friends) came back
// ERR_ABORTED and never recovered. Images were unaffected, which is why this looked
// like a document-viewer problem rather than an asset-pipeline one.
const BLOCK_SERVICE_WORKER = false;
const SERVICE_WORKER_PATHS = Object.freeze([
  '/sw.js', '/sw.min.js', '/service-worker.js', '/serviceworker.js',
]);

// WhatsApp Web legitimately needs these page features. Everything else stays denied.
// Without these, WhatsApp's own permission popups (notifications, microphone for
// voice notes/calls, camera for calls, screen-share, location, clipboard) never
// appear and the feature silently stays blocked.
const ALLOWED_PERMISSIONS = Object.freeze([
  // Message/call notification popups. This is the "allow notifications" prompt.
  'notifications',
  // Voice notes, voice/video calls (older Electron uses 'media', newer splits it).
  'media',
  'audio-capture',
  'video-capture',
  // Screen-share in calls.
  'display-capture',
  // Audio output selection for calls.
  'speaker-selection',
  // WhatsApp Web's copy/paste uses this. Denying it breaks selecting and copying a
  // message, which is ordinary use, not a feature request.
  'clipboard-read',
  'clipboard-sanitized-write',
  // Media viewer / video calls.
  'fullscreen',
  // Keep the login/session alive.
  'persistent-storage',
  'background-sync',
  'storage-access',
  // Location messages.
  'geolocation',
  // Presence / keep-alive helpers WhatsApp checks.
  'idle-detection',
  'screen-wake-lock',
  // Popups, emoji/file pickers and call windows.
  'pointerLock',
  'window-management',
  'local-fonts',
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
//
// The navigation lock and the window.open policy live in url-policy.js so they can be
// tested directly — main.js calls app.commandLine.appendSwitch at module scope and cannot
// be required from `node --test`. Re-exported below, since they were part of this file's
// public surface before.

const { ALLOWED_NAV_HOST, isAllowedNavigation, isOpenableExternal, isInAppViewer } =
  require('./url-policy');

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
      title: 'Whatsapp Incognito — build missing',
      message: 'Whatsapp Incognito has not been built yet.',
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
        title: 'Whatsapp Incognito — build unreadable',
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
      title: 'Whatsapp Incognito — build corrupt',
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
 *          tray: any, watchdog: any, quitting: boolean, backgroundNotified: boolean, injections: number}} */
const state = {
  meta: null,
  artifacts: null,
  prefs: null,
  win: null,
  tray: null,
  watchdog: null,
  /** Dev only: the hot-reload poller from app/electron/dev-bridge.js. Null unless --dev. */
  devBridge: null,
  /** The rewritten Chrome UA, kept so createWindow can also apply it per-webContents. */
  userAgent: null,
  quitting: false,
  /** Whether the one-time "running in the background" hint was shown. */
  backgroundNotified: false,
  /** How many times the preload has reported a completed injection (wai:page-state). */
  injections: 0,
  /** Latest page snapshot pushed by the preload; shown by wai:get-state. */
  page: null,
  /** Whether a native settings popup is currently on screen (key auto-repeat guard). */
  settingsOpen: false,
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

/**
 * No-tray fallback (GNOME without an AppIndicator host). Hiding would strand the
 * app — no tray to click back from — and quitting would stop protection. So the
 * window minimizes to the dock/taskbar instead: one click away, session alive.
 * Relaunching the app also reopens it via the second-instance handler.
 */
function minimizeToTaskbar(win) {
  guard('minimize to taskbar', () => {
    try { win.setSkipTaskbar(false); } catch (e) { /* keep it listed */ }
    if (!win.isMinimized()) win.minimize();
  })();
  notifyBackgroundOnce();
}

/** One-time hint so the minimized window is not mistaken for a quit. */
function notifyBackgroundOnce() {
  if (state.backgroundNotified) return;
  state.backgroundNotified = true;
  guard('background notification', () => {
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'Whatsapp Incognito',
      body: 'Running in the background. Click the dock icon or launch the app again to reopen.',
    });
    n.on('click', () => {
      const win = state.win;
      if (win && !win.isDestroyed()) showWindow(win);
    });
    n.show();
  })();
}

function createWindow(prefs) {
  // Task 10: restore saved size/position; task 8: clamp to visible screen
  const winState = loadWindowState();
  const { x: cx, y: cy } = clampWindowPosition(winState.x, winState.y, winState.width, winState.height);

  // Task 11: set background color to match OS theme so there's no white flash on launch
  const isDark = nativeTheme.shouldUseDarkColors;
  const bgColor = isDark ? '#111b21' : '#ffffff';

  const win = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    x: cx,
    y: cy,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: bgColor,
    title: 'Whatsapp Incognito',
    // Task 9: hide the menu bar by default (user can press Alt to reveal on Win/Linux)
    autoHideMenuBar: true,
    icon: resolveWindowIcon(),
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
      partition: PARTITION,

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

  // Belt and braces: the session UA is applied before the window is constructed (see
  // app.whenReady), but a per-webContents override guarantees the renderer cannot have
  // captured the stock UA regardless of construction order. Must be before loadURL.
  if (state.userAgent) {
    try { win.webContents.setUserAgent(state.userAgent); }
    catch (e) { warn(`per-webContents user agent failed: ${(e && e.message) || e}`); }
  }

  installNavigationLock(win);
  installSettingsShortcut(win);
  forwardFrameEvents(win);

  win.once('ready-to-show', () => {
    if (winState.maximized) win.maximize();
    showWindow(win);
    consumePendingDeepLink(win);
  });

  // §9.3 — hide, never destroy. Destroying the BrowserWindow tears down the renderer,
  // the injected hook and the socket, and forces a full reload + re-injection next time.
  // The window IS the session.
  win.on('close', (event) => {
    // Task 10: always save position/size before hiding or closing
    saveWindowState(win);
    if (state.quitting) return;
    if (state.tray) {
      event.preventDefault();
      hideWindow(win);
      return;
    }
    // No tray (GNOME with no AppIndicator host): hiding strands the app and
    // quitting stops protection, so minimize to the dock/taskbar instead.
    if (process.platform === 'linux') {
      event.preventDefault();
      minimizeToTaskbar(win);
      return;
    }
    // No tray and not Linux: no way back, so let the window close normally.
  });

  win.on('closed', () => { if (state.win === win) state.win = null; });

  // No did-finish-load deep-link consumer. It duplicated ready-to-show's, and the two
  // raced into a visible second load; consumePendingDeepLink has a single caller now.
  // A deep link that arrives while the window is already up never queues at all —
  // handleDeepLink sees a live window and navigates directly.

  // Tray badge: keep the unread count in step with the page title's "(N)" prefix.
  // The title is not used directly — the shared helper re-reads it so both this and the
  // notification path derive the count exactly one way.
  win.on('page-title-updated', () => updateBadgeFromTitle());

  const url = state.meta.whatsapp || 'https://web.whatsapp.com/';
  win.loadURL(url).catch((e) => {
    error('initial load failed:', (e && e.message) || e);
    warn(`could not load ${url}: check the network, then open the window again.`);
  });

  if (process.env.WAI_SELFTEST) runSelfTest(win);

  return win;
}

/**
 * In-app self test. Prints what the REAL window got and exits.
 *
 *   WAI_SELFTEST=1 electron .        (or: pnpm selftest)
 *
 * This exists because a standalone probe proved insufficient. A probe creates its own
 * window with its own webPreferences and none of the production session policy, so it can
 * report "WhatsApp loaded fine" while the real app — which injects into the page AND
 * applies request filtering — shows a gate. Only a check that runs the actual production
 * path can distinguish "WhatsApp serves us" from "WhatsApp serves us, and then we broke
 * it ourselves".
 *
 * Exit code: 0 healthy, 1 gated/blank, 2 nothing rendered.
 */
function runSelfTest(win) {
  const wait = Number(process.env.WAI_SELFTEST_WAIT || 15000);
  setTimeout(async () => {
    const q = (code) => win.webContents.executeJavaScript(code)
      .catch((e) => `<threw: ${(e && e.message) || e}>`);

    const ua = await q('navigator.userAgent');
    const title = await q('document.title');
    const href = await q('location.href');
    const text = String(await q('((document.body && document.body.innerText) || "").trim()'));
    const scripts = await q('document.scripts.length');
    const hook = await q('typeof window.wsHook === "object" && typeof window.wsHook.before === "function"');
    const wai = await q('typeof window.__WAI__');
    const globals = await q('[typeof pako, typeof Pbf, typeof Tether, typeof Drop, typeof swal].join(",")');
    const banner = await q('(function(){var b=document.getElementById("wai-failure-banner");return b&&b.style.display!=="none"?b.textContent.slice(0,200):""})()');

    console.log('\n===== SELF TEST (real window) =====');
    console.log(`  url            ${href}`);
    console.log(`  title          ${JSON.stringify(title)}`);
    console.log(`  page sees UA   ${ua}`);
    console.log(`  scripts        ${scripts}`);
    console.log(`  wsHook.before  ${hook}`);
    console.log(`  window.__WAI__ ${wai}`);
    console.log(`  pako,Pbf,Tether,Drop,swal = ${globals}`);
    console.log(`  text length    ${text.length}`);
    if (banner) console.log(`  FAILURE BANNER ${banner}`);
    console.log('  ---- visible text ----');
    console.log(text.slice(0, 400).split('\n').map((l) => `  | ${l}`).join('\n') || '  | (empty)');
    console.log('=====\n');

    let code = 0;
    if (/log in|phone number|verify your phone|scan to log in|qr code/i.test(text)) code = 0;
    else if (/chrome|update your browser|not supported|supported browser|too old/i.test(text)) code = 1;
    else if (text.length < 40) code = 2;
    app.exit(code);
  }, wait);
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
  // Engine-age gate, checked BEFORE anything else. Learned the hard way: with Electron 33
  // (Chromium 130) WhatsApp refused to load and served a browser-upgrade page, with
  // nothing in our own logs to explain it. One explicit line here beats that silence.
  const { assessEngine, buildChromeUserAgent } = require('./user-agent.js');
  const engine = assessEngine(process.versions.chrome);
  if (engine.ok) {
    log(`engine ok — Chromium ${engine.major} (floor ${engine.minMajor}), Electron ${process.versions.electron}`);
  } else {
    error(`UNSUPPORTED ENGINE: ${engine.reason}`);
  }

  guard('user agent', () => {
    const override = process.env.WAI_USER_AGENT;
    if (override && override.trim()) {
      ses.setUserAgent(override.trim());
      state.userAgent = override.trim();
      log(`user agent overridden from WAI_USER_AGENT`);
      return;
    }

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
    state.userAgent = clean;
    log(`user agent: ${clean}`);
  })();
}

function installSessionGuards(ses) {
  if (!ses || ses.__waiGuards) return;     // onBeforeRequest holds ONE listener per event
  ses.__waiGuards = true;

  // Allow-what-WhatsApp-needs, deny everything else. Supports both the legacy
  // (webContents, permission, callback, details) and current
  // (permission, requestDetails, callback) Electron signatures.
  //
  // The permission name is read out of whichever argument is an object carrying a
  // string `permission` field, rather than trusting the positional guess. Guessing by
  // type left a real request arriving as "[object Object]" — which matches no entry in
  // ALLOWED_PERMISSIONS and so was silently denied, taking WhatsApp's own prompt with it.
  const permissionNameOf = (candidates) => {
    for (const c of candidates) {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object' && typeof c.permission === 'string') return c.permission;
    }
    return '';
  };
  guard('setPermissionRequestHandler', () => {
    const decide = (permission) => ALLOWED_PERMISSIONS.includes(permission);
    ses.setPermissionRequestHandler((a, b, c) => {
      const permission = permissionNameOf([a, b, c]);
      const callback = [a, b, c].find((x) => typeof x === 'function');
      const allow = decide(permission);
      debug(`permission request "${permission}" → ${allow ? 'granted' : 'denied'}`);
      try { if (callback) callback(allow); } catch (e) { debug('permission callback:', e && e.message); }
    });
    // Same shape: (webContents, permission, requestingOrigin, details). The permission is
    // whichever argument names one — never the webContents object itself.
    ses.setPermissionCheckHandler((...args) => decide(permissionNameOf(args)));
  })();

  // Camera/mic/speaker device grant. Without this, allowing 'audio-capture' /
  // 'video-capture' alone still leaves getUserMedia with no device, so the
  // microphone/camera popup never resolves.
  guard('setDevicePermissionHandler', () => {
    if (typeof ses.setDevicePermissionHandler === 'function') {
      ses.setDevicePermissionHandler((details) => {
        const type = details && details.deviceType;
        if (type === 'camera' || type === 'microphone' || type === 'speaker') return true;
        return false;
      });
    }
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

  // ---- Screen sharing via desktopCapturer (from WhatsLNX) ----
  // Cache the selected source for 5 minutes so the portal doesn't reopen mid-call.
  guard('setDisplayMediaRequestHandler', () => {
    if (typeof ses.setDisplayMediaRequestHandler !== 'function') return;
    let cachedScreenSource = null;
    let cacheTimer = null;
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
      if (cachedScreenSource) {
        callback({ video: cachedScreenSource });
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        });
        if (sources.length > 0) {
          const src = sources.find((s) => s.id.startsWith('screen')) || sources[0];
          cachedScreenSource = src;
          if (cacheTimer) clearTimeout(cacheTimer);
          cacheTimer = setTimeout(() => { cachedScreenSource = null; }, 300000);
          callback({ video: src });
        } else {
          callback({});
        }
      } catch (err) {
        error('[display-media] getSources failed:', (err && err.message) || err);
        callback({});
      }
    });
  })();

  // ---- Native save dialog for downloads (from WhatsLNX) ----
  // Intercept every download and show a native save-as dialog instead of Chromium's
  // default download shelf/panel. Falls back to the user's Downloads folder.
  guard('will-download', () => {
    ses.on('will-download', (event, item) => {
      const defaultPath = path.join(app.getPath('downloads'), item.getFilename());
      const savePath = dialog.showSaveDialogSync(state.win || null, {
        defaultPath,
        title: 'Save File',
      });
      if (savePath) {
        item.setSavePath(savePath);
      } else {
        item.cancel();
      }
    });
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

  // window.open / target=_blank.
  //
  // Three cases, in order:
  //   1. WhatsApp's own viewer (blob:/data:) opens as a window. It must, or document
  //      previews do nothing at all — see isInAppViewer. The window is deliberately
  //      stripped of our preload in overrideBrowserWindowOptions: a spawned window
  //      inherits webPreferences from its opener, and with `sandbox: false` (see
  //      createWindow) an inherited preload would run with Node in a window rendering
  //      untrusted remote content. That is the exact risk the navigation lock below
  //      exists to prevent, so the viewer window gets none of our machinery.
  //   2. Genuine http(s) links (web.whatsapp.com, article links) go to the OS browser.
  //   3. Everything else — javascript:, intent:, file: — is dropped silently. Handing a
  //      non-web scheme to the OS opens a file handler on attacker-chosen input.
  guard('setWindowOpenHandler', () => {
    wc.setWindowOpenHandler(({ url }) => {
      if (isInAppViewer(url)) {
        debug('allowing WhatsApp viewer window for', String(url).slice(0, 60));
        return {
          action: 'allow',
          // This window exists only to render what WhatsApp just handed us, so it gets
          // none of our machinery. Clearing `preload` is the load-bearing part and it IS
          // honoured: a window.open child otherwise inherits the opener's preload, which
          // with `sandbox: false` (see createWindow) would run with Node attached to a
          // window rendering untrusted remote content — the exact risk the navigation
          // lock below exists to prevent.
          //
          // `sandbox: true` is honoured here too (verified on 44.4.5: the spawned window
          // reports sandbox:true, no preload, and window.__WAI_IPC__ undefined).
          overrideBrowserWindowOptions: {
            webPreferences: {
              preload: undefined,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webviewTag: false,
            },
          },
        };
      }
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
  // The app menu role is left alone: it is localized by the OS and carries the canonical
  // macOS items, and hand-rolling it to insert one row would quietly lose that. So Settings
  // is its own top-level menu instead — a normal macOS shape, and purely additive.
  //
  // The row carries no accelerator on purpose: installSettingsShortcut already handles Cmd+,
  // on all three platforms, and one route is one route.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Settings', submenu: [{ label: 'Settings…', click: () => openSettings() }] },
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
    if (result.applied.includes('autostart')) applyAutostart(result.prefs.autostart);
    if (state.watchdog) state.watchdog.kick('prefs-changed');
  }
  return result;
}

/**
 * Restore every default. One function for both callers (the tray row and the settings menu),
 * because a reset that only some entry points perform is a reset that sometimes leaves the
 * tray checkmarks lying.
 *
 * The tray refresh lives here rather than in each caller: applyPatch refreshes the tray on
 * every ordinary change, and a reset must not be the one path where the two disagree.
 */
function resetAllPrefs() {
  return guard('reset prefs', () => {
    // Captured before the reset, because reset() mutates in place — comparing against a
    // get() afterwards would always be equal and the check would be dead. It matters: a
    // reset that leaves autostart on in the OS while prefs.json says false is exactly the
    // "a saved pref that was never applied" case applyAutostart's own comment warns about.
    const autostartBefore = state.prefs.get().autostart;
    const prefs = state.prefs.reset();
    sendPrefs(prefs);
    guard('tray.update', () => state.tray && state.tray.update())();
    if (prefs.autostart !== autostartBefore) applyAutostart(prefs.autostart);
    if (state.watchdog) state.watchdog.kick('prefs-reset');
    return prefs;
  }, state.prefs.get())();
}

// ---------------------------------------------------------------- settings

/**
 * Ask the page to open the options panel it injects into WhatsApp's own menu bar.
 *
 * The fallback, not the primary: the native menu below is better in every way that matters
 * (it cannot break when WhatsApp renames a class, it holds every setting including the four
 * the panel never offered, and it needs no injected HTML at all). But a native menu is not
 * always available — no display, a failed grab, a platform whose window manager refuses the
 * popup — and "you cannot change your settings" is a much worse outcome than the old panel.
 * So when native is not there, this is what the user gets instead.
 *
 * @returns {boolean} whether the request was delivered to a live page
 */
function requestPageOptions() {
  const win = state.win;
  if (!win || win.isDestroyed()) return false;
  try {
    win.webContents.send('wai:open-options');
    return true;
  } catch (e) {
    warn(`could not ask the page for its options panel: ${(e && e.message) || e}`);
    return false;
  }
}

/**
 * Open the settings, natively if possible and from the page otherwise.
 *
 * A popup Menu rather than a settings BrowserWindow: no second window, no web UI, no
 * bundler — the same meaning of "light" docs/ARCHITECTURE.md §7 gives it. It closes on each
 * click, exactly as the tray does, which is what a native menu does.
 *
 * The guard around the whole body is the fallback trigger, not just error containment: if
 * building or showing the menu throws at all, the user still gets somewhere to change a
 * setting. A native failure is precisely when the panel is worth having.
 */
function openSettings() {
  // Holding the shortcut down auto-repeats keyDown, and popup() on an open menu stacks
  // another one on top. One menu at a time; the popup callback is what reopens the door.
  if (state.settingsOpen) return false;
  try {
    const win = state.win;
    // A popup anchored to a hidden window has nowhere to appear (tray-only mode, after the
    // window was closed), which misbehaves on Windows. So only parent it while it is really
    // visible, and say so rather than trusting it to work.
    const visible = !!(win && !win.isDestroyed() && win.isVisible());
    if (win && !visible) debug('settings menu opened without a visible parent window');

    const status = state.watchdog ? state.watchdog.snapshot() : { status: 'UNKNOWN' };
    const items = buildSettingsTemplate({
      prefs: state.prefs.get(),
      header: [`Status: ${labelOf(status).long}`, counters(status)],
      apply: (patch) => applyPatch(patch),
      reset: resetAllPrefs,
      // main.js is the only place that can hand Electron's Menu in; the builder itself
      // touches no Electron API, so it is testable under bare `node --test`.
      Menu,
    });
    const menu = Menu.buildFromTemplate(items);
    state.settingsOpen = true;
    menu.popup(visible ? { window: win, callback: closed } : { callback: closed });
    return true;
  } catch (e) {
    state.settingsOpen = false;
    warn(`native settings menu failed (${(e && e.message) || e}); falling back to the page's panel`);
    if (!requestPageOptions()) {
      // Neither surface. Say so on screen rather than leaving the user hunting.
      guard('settings unavailable dialog', () => dialog.showMessageBox({
        type: 'warning',
        title: 'Whatsapp Incognito — settings unavailable',
        message: 'The settings menu could not be opened.',
        detail: 'Neither the native menu nor the in-page options panel could be shown.\n\n' +
                'Options can still be changed by editing prefs.json in the app\'s user data folder.',
        buttons: ['OK'],
        noLink: true,
      }))();
    }
    return false;
  }
}

function closed() { state.settingsOpen = false; }

/**
 * Ctrl/Cmd+, on every platform.
 *
 * `before-input-event` rather than a menu-bar accelerator because the app deliberately has
 * no menu bar on Windows and Linux (installMenu sets null there, so the default Electron
 * menu cannot offer reload/devtools/quit and tear the session down by accident), and
 * `autoHideMenuBar` means there is nothing to hang an accelerator off. This is the one
 * keyboard route to settings that exists on all three platforms.
 */
function installSettingsShortcut(win) {
  guard('settings shortcut', () => {
    win.webContents.on('before-input-event', (_event, input) => {
      guard('settings shortcut input', () => {
        if (!input || input.type !== 'keyDown' || input.key !== ',') return;
        const accel = process.platform === 'darwin' ? input.meta : input.control;
        if (!accel || input.alt || input.shift) return;
        input.preventDefault();      // do not also hand Ctrl+, to WhatsApp Web
        openSettings();
      })();
    });
  })();
}

// ---------------------------------------------------------------- autostart

/**
 * Apply the `autostart` pref on every platform. Runs at startup and whenever
 * the tray checkbox changes it — a saved pref that is never applied is worse
 * than no pref, because the checkbox would lie.
 */
function applyAutostart(enabled) {
  const on = enabled === true;
  guard('login item', () => {
    // Native API on Windows/macOS. No-op elsewhere (guarded, never throws).
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: on });
    }
  })();
  if (process.platform !== 'linux') return;
  // Portal first: sandbox-aware and registers the app in GNOME Settings → Apps.
  // Plain XDG autostart file as fallback when no portal answers, and always
  // cleaned up on disable so a stale file cannot resurrect the app.
  desktopIntegration.requestBackground({ autostart: on, log: { log, warn, debug } })
    .then((r) => {
      if (!r.ok || !on) guard('autostart file', () => syncAutostartFile(on))();
    })
    .catch(() => guard('autostart file', () => syncAutostartFile(on))());
}

function syncAutostartFile(on) {
  const file = desktopIntegration.autostartFilePath();
  if (!on) return desktopIntegration.removeAutostartFile(file);
  // Inside an AppImage the image itself is the executable; in dev (`electron .`)
  // re-launch the app path with the current runtime.
  const execCmd = process.env.APPIMAGE || `"${process.execPath}" "${app.getAppPath()}"`;
  return desktopIntegration.writeAutostartFile(file, desktopIntegration.buildDesktopEntry(execCmd));
}

/**
 * Give the notification daemon something to match a popup against.
 *
 * `app.setAppUserModelId` above only supplies our half of the identity. On Linux the other
 * half is a `.desktop` file named after that same id, and without it gnome-shell drops
 * the notification — silently, with no error anywhere, which is exactly what was
 * happening. electron-builder ships one for installed/AppImage builds but nothing else
 * does, so a dev run, an extracted AppImage, or any unpackaged run had none.
 *
 * Deliberately NOT gated on the autostart pref and not user-visible: this is a
 * notification-plumbing file, not a launcher. Runs on every Linux start, rewrites only
 * on change, and a failure is a debug line — notifications being broken is bad, but not
 * being able to write to $XDG_DATA_HOME is not a reason to refuse to start.
 */
function syncNotificationEntry() {
  if (process.platform !== 'linux') return true;
  const execCmd = process.env.APPIMAGE || `"${process.execPath}" "${app.getAppPath()}"`;
  const ok = desktopIntegration.ensureNotificationEntry({
    appId: APP_ID,
    exec: execCmd,
    iconName: 'waincognito',
    name: 'Whatsapp Incognito',
    comment: 'Be invisible on WhatsApp Web',
  });
  if (!ok) {
    debug('notification entry not written — notifications may be dropped by the desktop daemon');
  } else {
    debug(`notification entry ensured at ${desktopIntegration.applicationsDir()}/${APP_ID}.desktop`);
  }
  return ok;
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

  // Note: there is deliberately no `wai:reset-prefs` handler. The tray resets prefs
  // through a direct function reference, so an IPC route for it had zero callers — an
  // unused privileged channel is worse than no channel.

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
    if (snapshot.event === 'options-panel') {
      // The native settings menu failed and we fell back to the panel the page injects into
      // WhatsApp's own menu bar. "Unavailable" means that anchor was not found — the panel is
      // injected, not native, so it breaks when WhatsApp renames a class. Worth a real log
      // line: it is the difference between "the fallback worked" and "there is no settings
      // UI at all right now", and only this channel can tell them apart.
      if (snapshot.opened) log('settings: using the in-page options panel (native menu unavailable)');
      else warn('settings: the in-page options panel is unavailable too — no settings UI is showing');
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

  // Native notifications relayed from the preload's window.Notification override.
  ipcMain.on('wai:notification', (event, data) => guard('wai:notification', () => {
    if (!data || typeof data !== 'object') return;
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: String(data.title || 'Whatsapp Incognito'),
      body: String(data.body || ''),
      // Honoured rather than hardcoded false. WhatsApp sets silent:true for the
      // conversation the user is already looking at; forcing sound there is the whole
      // reason people mute the app and then miss the messages they muted it for.
      silent: data.silent === true,
    });
    n.on('click', () => {
      const win = state.win;
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    n.show();
    // Refresh the badge. A message arriving is the most likely moment for the page title
    // to have just gained its "(N)" prefix, and Electron's own badge is per-platform
    // (Unity on Linux) so the title is not always in step with the tray icon.
    updateBadgeFromTitle();
  })());
}

/**
 * WhatsApp Web encodes its unread count as a "(N) WhatsApp" title prefix. Re-read it and
 * push the count to the tray and the OS badge.
 *
 * This was duplicated: the page-title-updated handler and the notification handler each
 * inlined the same regex and parseInt. Two copies drift, and the notification copy read
 * the title a second time for a value the title handler had already seen.
 */
function updateBadgeFromTitle() {
  try {
    const win = state.win;
    if (!win || win.isDestroyed()) return;
    const title = typeof win.webContents.getTitle === 'function' ? win.webContents.getTitle() : '';
    const match = title && title.match(/^\((\d+)\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    if (state.tray && typeof state.tray.updateBadge === 'function') state.tray.updateBadge(count);
  } catch (e) {
    debug('updateBadgeFromTitle failed:', (e && e.message) || e);
  }
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
  // No render-process-gone listener here on purpose. installCrashRecovery registers an
  // app-level one that logs the same reason AND recreates the window; keeping a
  // webContents-level logger alongside it produced two log lines for one crash and made
  // it look like two independent failures.
  state.watchdog.start();
}

// ---------------------------------------------------------------- crash recovery (from WhatsLNX)

/**
 * Renderer crash → recreate the window so the user gets back into WhatsApp.
 * GPU crash → relaunch the whole app (GPU process cannot be replaced in place).
 * Both are guarded so a crash in the handler cannot cascade.
 */
function installCrashRecovery() {
  app.on('render-process-gone', guard('render-process-gone', (_event, webContents, details) => {
    error(`renderer gone: ${details && details.reason} — recreating window`);
    const win = state.win;
    if (win && !win.isDestroyed() && win.webContents === webContents) {
      try { win.destroy(); } catch (e) { /* already gone */ }
      state.win = null;
    }
    // Give the GPU process a moment to settle before opening a fresh window
    setTimeout(() => {
      guard('crash:recreate-window', () => {
        const prefs = state.prefs ? state.prefs.get() : {};
        const newWin = createWindow(prefs);
        startWatchdog(newWin);
      })();
    }, 500);
  }));

  app.on('child-process-gone', guard('child-process-gone', (_event, details) => {
    if (details && details.type === 'GPU') {
      error(`GPU process gone: ${details.reason} — relaunching`);
      app.relaunch();
      app.exit(0);
    }
  }));
}

// ---------------------------------------------------------------- tray wiring

function startTray() {
  state.tray = createTray({
    app,
    getWindow: () => state.win,
    getStatus: () => (state.watchdog ? state.watchdog.snapshot() : { status: 'UNKNOWN' }),
    getPrefs: () => state.prefs.get(),
    setPref: (patch) => { applyPatch(patch); return state.prefs.get(); },
    resetPrefs: resetAllPrefs,
    openSettings,
    quit: () => { state.quitting = true; app.quit(); },
  });
  if (!state.tray) {
    // Without a tray there is nothing to reopen a hidden window from. On Linux the
    // close handler minimizes to the dock/taskbar instead (see minimizeToTaskbar),
    // so background protection keeps working tray-less, Windows-style.
    warn('no system tray available: the window will minimize to the dock instead of hiding');
    return;
  }
  // On Linux a successfully created Tray can still render nowhere: GNOME has no
  // legacy systray, and without the AppIndicator extension there is no
  // StatusNotifier watcher on the session bus. Detect that explicitly — an
  // invisible-but-non-null tray would hide the window on close with no way back.
  // (Inside an AppImage the host /lib is still visible, so a missing *library* is
  // rarely the cause; a missing *watcher* is. Both are logged for diagnosis.)
  if (process.platform === 'linux') {
    guard('tray watcher check', () => {
      const watcher = desktopIntegration.hasStatusNotifierWatcher();
      if (watcher.present) {
        debug(`StatusNotifier watcher present (${watcher.method})`);
        return;
      }
      const lib = desktopIntegration.hasAppIndicatorLib();
      warn('no StatusNotifier watcher on D-Bus: the tray icon has nowhere to render. ' +
        'Enable the GNOME "AppIndicator and KStatusNotifierItem Support" extension. ' +
        `(indicator lib ${lib.present ? `found (${lib.found.join(', ')})` : 'NOT found'}; ` +
        `desktop=${desktopIntegration.detectDesktop().raw || 'unknown'}). ` +
        'Closing the window will quit instead of hiding until a watcher appears.');
      try { state.tray.destroy(); } catch (e) { /* ignore */ }
      state.tray = null;
    })();
  }
}

// ---------------------------------------------------------------- boot

function boot() {
  // Task 7: register whatsapp:// protocol handler (before app.whenReady for Linux/macOS)
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient('whatsapp', process.execPath, [require('node:path').resolve(__dirname, '../..')]);
  } else {
    app.setAsDefaultProtocolClient('whatsapp');
  }
  // Check for a deep link on cold start (argv)
  const coldUrl = process.argv.find(isDeepLink);
  if (coldUrl) _pendingDeepLink = buildDeepLinkUrl(coldUrl) || null;

  app.on('second-instance', (_event, argv) => {
    const win = state.win;
    if (!win || win.isDestroyed()) return;
    showWindow(win);
    // Task 7: handle deep link from second launch
    const url = argv.find(isDeepLink);
    if (url) handleDeepLink(url);
  });

  // macOS: opened-url event for protocol links
  app.on('open-url', (_event, url) => { handleDeepLink(url); });

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
    // The notification daemon matches notifications to an installed application by its
    // desktop id. Windows needs this for the taskbar grouping; Linux needs it for
    // gnome-shell to attribute the popup to us at all — without it the notification is
    // silently dropped, which is why nothing appeared. Harmless on macOS, where the id is
    // read from the bundle instead.
    if (process.platform !== 'darwin') app.setAppUserModelId(APP_ID);
    const build = loadBuild();
    if (!build) return;                          // loadBuild already showed a dialog
    state.meta = build.meta;
    state.artifacts = build.artifacts;

    guard('PrefsStore', () => {
      // The numeric bounds come from the settings table, so the range a value is validated
      // against and the set of values the menu offers cannot drift apart.
      state.prefs = new PrefsStore(
        app.getPath('userData'),
        { ...build.meta.prefs, ...SHELL_DEFAULTS },
        undefined,
        numericRanges(),
      );
      log(`prefs loaded (${Object.keys(state.prefs.get()).length} keys) from userData`);
    })();
    if (!state.prefs) {
      // loadBuild validated the JSON but not its shape, and PrefsStore refuses to run
      // without derived defaults (assertion A-prefs in the build should have caught it).
      // Say so rather than opening a window whose options cannot be persisted.
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Whatsapp Incognito — options missing',
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
    installCrashRecovery();

    // C6/C5: the session must be configured BEFORE the BrowserWindow exists.
    //
    // Ordering bug, found by the in-app self test (WAI_SELFTEST=1): the user agent was
    // being set after `new BrowserWindow(...)`, and the renderer had already captured the
    // stock Electron UA. So our log cheerfully printed a clean Chrome UA while the page
    // received
    //   ...WAIncognito/2.5.6 Chrome/152... Electron/44.4.5 Safari/537.36
    // and WhatsApp served its browser-gate page. A standalone probe missed this entirely
    // because it happened to set the UA before creating its window.
    //
    // So: resolve the partition session first, apply the UA, and only then build the window.
    const appSession = require('electron').session.fromPartition(PARTITION);
    installUserAgent(appSession);
    installSessionGuards(appSession);

    startTray();

    // Task 11: sync window background color when OS theme changes (avoids white flash on theme toggle)
    nativeTheme.on('updated', () => {
      const win = state.win;
      if (!win || win.isDestroyed()) return;
      guard('theme-update', () => {
        win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111b21' : '#ffffff');
      })();
    });

    // Apply the saved autostart pref (portal + login items + XDG fallback).
    applyAutostart(state.prefs.get().autostart);

    // Notifications on Linux need a desktop entry to be attributable at all. Unconditional
    // (not tied to autostart) and best effort.
    guard('notification entry', () => syncNotificationEntry())();

    const win = createWindow(state.prefs.get());
    startWatchdog(win);
    startDevBridge(win, build.artifacts);

    log(`ready — v${build.meta.version} → ${build.meta.whatsapp || 'https://web.whatsapp.com/'}`);
  }).catch((e) => {
    error('startup failed:', (e && e.stack) || e);
    try {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Whatsapp Incognito — startup failed',
        message: 'Whatsapp Incognito could not start.',
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
  //
  // The --dev case is called out because it fails in a way that looks like the dev loop is
  // broken: the instance that holds the lock was started WITHOUT --dev, so it never loaded
  // app/electron/dev-bridge.js and never polls the dev server. Every save would rebuild and
  // inject into a window that is not listening, and the only symptom is nothing happening.
  if (process.argv.includes('--dev')) {
    warn('another instance is already running and it was NOT started with --dev, so it will '
       + 'not pick up dev rebuilds. Quit it from the tray, then run `pnpm dev` again.');
  }
  log('another instance is already running; this one is exiting');
  app.exit(0);
} else {
  boot();
}

module.exports = {
  // exported for the smoke test and for anyone extending the blocklist
  classifyRequest,
  isInAppViewer,
  isAllowedNavigation,
  isOpenableExternal,
  TELEMETRY_HOSTS,
  PUSH_HOSTS,
  FIRST_PARTY_SUFFIXES,
  BUILD_ARTIFACTS,
};
