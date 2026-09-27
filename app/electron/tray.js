'use strict';
// Tray: the honest status display, plus the three hook toggles (§9.6).
//
// WHY THE TRAY IS THE POINT
// -------------------------
// Running in the background is only worth it if the app is doing something for you, and
// the single most useful thing it can do is stop the §2.3 failure from being invisible: a
// tray that always shows a reassuring static icon is worse than no tray, because it
// actively misinforms. So the status line is derived from the watchdog and is allowed to
// say NOT PROTECTED. §9.7 is the other half of the bargain — a live socket is not free,
// and the counters below are what makes that visible instead of surprising.
//
// A hook toggle must also be a round-trip through the real persistence path
// (tray → main → PrefsStore → preload → page), so the tray and the window can never
// disagree and the path is exercised every time (§10 step 6).

const path = require('node:path');
const { Menu, Tray, nativeImage } = require('electron');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'images');
const DEBUG_LOG = !!process.env.WAI_DEBUG;

// SVG first (it is what the extension ships and it scales to any tray density), PNG
// second. A tray icon that fails to load is an invisible app, so the fallbacks are
// explicit and each failure is logged rather than swallowed.
// PNG first, and not as a preference — as a measured requirement.
//
// On Electron 44.4.5 / Chromium 152, nativeImage.createFromPath returns an EMPTY image
// (isEmpty() === true, size 0x0) for every SVG in images/, while all four PNGs load at
// 128x128. createFromPath resolves empty rather than throwing, so an SVG-first list
// silently burns candidates and logs warnings on every launch. Measured, not assumed:
//
//   incognito_gray.png        empty=false 128x128
//   incognito.png             empty=false 128x128
//   icon_128_reshaped.png     empty=false 128x128
//   icon_128_blue.png         empty=false 128x128
//   incognito_gray_hollow.svg empty=true  0x0
//
// The SVGs stay last as a fallback for platforms that do accept them.
// Same icon as the extension and the window (manifest.json `icons` +
// `action.default_icon` → images/icon_128_blue.png, which
// app/packaging/icon.{png,ico,icns} is generated from). Blue first so the
// native app matches the other ones; gray PNGs stay as fallbacks.
const ICON_CANDIDATES = [
  'icon_128_blue.png',
  'icon_128_reshaped.png',
  'incognito_gray.png',
  'incognito.png',
  'incognito_gray_hollow.svg',
  'incognito.svg',
];

// The three toggles, in the order a user cares about them: the one that leaks identity
// (read receipts) first, then the two presence features.
const TOGGLES = [
  { key: 'readConfirmationsHook', label: 'Block read receipts' },
  { key: 'onlineUpdatesHook', label: 'Block online / last seen' },
  { key: 'typingUpdatesHook', label: 'Block typing indicators' },
];

// `long` is the menu row — it has room, and it must say what receipts are doing. `short`
// is the tooltip and the log-friendly form. Both name the state; neither softens it.
const LABEL = {
  PROTECTED: { short: 'Protected', long: 'Protected' },
  RECONNECTING: { short: 'Reconnecting', long: 'Reconnecting — receipts are NOT blocked right now' },
  NOT_PROTECTED: { short: 'NOT PROTECTED', long: 'NOT PROTECTED — receipts may be leaking' },
  UNKNOWN: { short: 'Starting up…', long: 'Starting up…' },
};

function humanDuration(ms) {
  if (ms == null) return 'never';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * @param {object} opts
 * @param {object} opts.app          Electron app (for the platform check)
 * @param {() => object} opts.getWindow   the live BrowserWindow, or null
 * @param {() => object} opts.getStatus   watchdog snapshot
 * @param {(patch: object) => object} opts.setPref  main → PrefsStore → page
 * @param {() => object} opts.getPrefs
 * @param {() => void} opts.quit
 * @param {object} [opts.Menu] [opts.Tray] [opts.nativeImage] injectable, for tests
 */
function createTray(opts) {
  const { app, getWindow, getStatus, setPref, getPrefs, quit } = opts;
  if (typeof getWindow !== 'function') throw new Error('createTray: getWindow is required');

  const MenuCtor = opts.Menu || Menu;
  const TrayCtor = opts.Tray || Tray;
  const image = opts.nativeImage || nativeImage;

  // ---------------------------------------------------------------- icon

  function loadIcon() {
    // Linux trays want ~22px, Windows/macOS ~16px. nativeImage.resize() returns a
    // NEW image (it does not mutate in place), so the return value must be used —
    // returning the original 128px PNG renders as a broken oversized tray icon.
    const target = process.platform === 'linux' ? 22 : 16;
    for (const name of ICON_CANDIDATES) {
      const file = path.join(IMAGES_DIR, name);
      try {
        const img = image.createFromPath(file);
        // createFromPath resolves empty rather than throwing for an unreadable file, so
        // the emptiness check is the real test, not the absence of an exception.
        if (img && typeof img.isEmpty === 'function' && !img.isEmpty()) {
          try {
            const sized = img.resize({ width: target, height: target });
            if (sized && typeof sized.isEmpty === 'function' && !sized.isEmpty()) {
              return { img: sized, name };
            }
          } catch (e) { /* fall through to the unresized image */ }
          return { img, name };
        }
        warn(`tray icon ${name} did not load (empty image)`);
      } catch (e) {
        warn(`tray icon ${name} failed: ${(e && e.message) || e}`);
      }
    }
    warn('no tray icon could be loaded; the tray will be blank but still functional');
    try { return { img: image.createEmpty(), name: '(empty)' }; } catch (e) { return { img: null, name: '(none)' }; }
  }

  const { img, name: iconName } = loadIcon();
  if (DEBUG_LOG) {
    try { console.log('[wai] tray icon:', iconName); } catch (e) { /* stdout may be closed */ }
  }

  // ---------------------------------------------------------------- menu

  function buildMenu() {
    const status = safeStatus();
    const prefs = safePrefs();
    const items = [
      // The honest status line. Two disabled rows rather than one so the counters stay
      // readable; they are the evidence that the app is doing something while hidden.
      { label: `Status: ${labelOf(status).long}`, enabled: false },
      { label: counters(status), enabled: false },
    ];

    if (status.reason) items.push({ label: `Why: ${status.reason}`, enabled: false });
    if (status.recovering) items.push({ label: 'Recovering…', enabled: false });

    items.push({ type: 'separator' });
    items.push({
      label: 'Open WAIncognito',
      click: () => {
        try {
          const win = getWindow();
          if (!win || win.isDestroyed()) { warn('no window to show'); return; }
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        } catch (e) {
          warn(`could not open the window: ${(e && e.message) || e}`);
        }
      },
    });

    items.push({ type: 'separator' });
    for (const t of TOGGLES) {
      items.push({
        label: t.label,
        type: 'checkbox',
        checked: prefs[t.key] === true,
        click: () => {
          try {
            // Everything a checkbox menu does is: ask main to persist, and main pushes
            // the new values to the page. The tray never writes prefs itself.
            setPref({ [t.key]: prefs[t.key] !== true });
          } catch (e) {
            warn(`could not change ${t.key}: ${(e && e.message) || e}`);
          }
          update();
        },
      });
    }

    items.push({ type: 'separator' });
    // Shell-only pref (main.js SHELL_DEFAULTS, not background.js): start on login.
    // Same round-trip as the hook toggles — tray → main → PrefsStore — except main
    // applies it to the OS (applyAutostart) while the page ignores the unknown key.
    items.push({
      label: 'Start automatically on login',
      type: 'checkbox',
      checked: prefs.autostart === true,
      click: () => {
        try {
          setPref({ autostart: prefs.autostart !== true });
        } catch (e) {
          warn(`could not change autostart: ${(e && e.message) || e}`);
        }
        update();
      },
    });

    items.push({ type: 'separator' });
    items.push({
      label: 'Reset options to defaults',
      click: () => {
        try {
          if (opts.resetPrefs) opts.resetPrefs();
        } catch (e) {
          warn(`could not reset prefs: ${(e && e.message) || e}`);
        }
        update();
      },
    });
    items.push({ type: 'separator' });
    items.push({ label: 'Quit WAIncognito', click: () => { try { quit(); } catch (e) { warn('quit failed', e); } } });

    return MenuCtor.buildFromTemplate(items);
  }

  function counters(status) {
    const bits = [`${status.framesIn || 0} in / ${status.framesOut || 0} out`];
    if (status.blocked) bits.push(`${status.blocked} receipts blocked`);
    if (status.heldChats) bits.push(`${status.heldChats} held for replay`);
    bits.push(`last frame ${humanDuration(status.sinceLastFrame)} ago`);
    if (status.recoveries) bits.push(`${status.recoveries} recoveries`);
    return bits.join(' · ');
  }

  function toolTip(status) {
    return [
      `WAIncognito — ${labelOf(status).short}`,
      status.reason || '',
      `${status.framesIn || 0} frames in / ${status.framesOut || 0} out`,
      status.blocked ? `${status.blocked} receipts blocked` : '',
      status.status === 'PROTECTED' ? '' : 'Receipts are not being protected.',
    ].filter(Boolean).join('\n');
  }

  function labelOf(status) {
    return LABEL[status.status] || { short: String(status.status || 'UNKNOWN'), long: String(status.status || 'UNKNOWN') };
  }

  function safeStatus() {
    try {
      const s = typeof getStatus === 'function' ? getStatus() : null;
      return s && typeof s === 'object' ? s : { status: 'UNKNOWN' };
    } catch (e) {
      return { status: 'UNKNOWN', reason: `status unavailable: ${(e && e.message) || e}` };
    }
  }

  function safePrefs() {
    try {
      const p = typeof getPrefs === 'function' ? getPrefs() : null;
      return p && typeof p === 'object' ? p : {};
    } catch (e) {
      return {};
    }
  }

  // ---------------------------------------------------------------- tray

  let tray = null;
  try {
    tray = new TrayCtor(img);
  } catch (e) {
    warn(`could not create the tray: ${(e && e.message) || e}`);
    return null;                     // main degrades to normal close semantics
  }

  // Measured on Electron 44.4.5 (Chromium 152):
  //   typeof tray.setMenu        -> 'undefined'   (throws if called)
  //   typeof tray.setContextMenu -> 'function'
  //   typeof tray.setToolTip     -> 'function'
  // So setContextMenu is the API that actually exists, and setMenu is probed only as a
  // fallback for older Electron. Hard-coding setMenu threw on every single status change.
  const setMenuCompat = (t, menu) => {
    if (typeof t.setContextMenu === 'function') return t.setContextMenu(menu);
    if (typeof t.setMenu === 'function') return t.setMenu(menu);
    return undefined;   // no menu API at all: leave the tray as-is rather than throw
  };

  function update() {
    if (!tray || (typeof tray.isDestroyed === 'function' && tray.isDestroyed())) return;
    try {
      // Only the menu is rebuilt. Rebuilding the icon would drop the platform's
      // animation and re-decode the file on every status change.
      setMenuCompat(tray, buildMenu());
      if (typeof tray.setToolTip === 'function') tray.setToolTip(toolTip(safeStatus()));
    } catch (e) {
      warn(`tray update failed: ${(e && e.message) || e}`);
    }
  }

  // macOS: a left click on the tray icon should do the obvious thing.
  if (app && process.platform === 'darwin' && typeof tray.on === 'function') {
    tray.on('click', () => {
      const win = getWindow();
      if (win && !win.isDestroyed()) { win.show(); win.focus(); }
    });
  }

  update();

  return {
    tray,
    update,
    /** Force a refresh, e.g. after prefs were written by the page's own options menu. */
    refresh: update,
    destroy() {
      try { if (tray && !(tray.isDestroyed && tray.isDestroyed())) tray.destroy(); } catch (e) { /* ignore */ }
      tray = null;
    },
  };
}

module.exports = { createTray };

function warn(...args) {
  // The main process may have no stdout (dock/desktop launch); a throwing warn
  // here would take the tray down with it. main.js installs a global safe-console
  // shim, but tray.js is also loaded by tests, so stay non-throwing on its own.
  try { console.warn('[wai:tray]', ...args); } catch (e) { /* ignore */ }
}
