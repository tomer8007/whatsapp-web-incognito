'use strict';
// Linux desktop integration: StatusNotifier watcher detection + Background portal.
//
// WHY THIS FILE EXISTS
// --------------------
// On GNOME there is no legacy systray. The only "modern tray" is StatusNotifier
// (SNI) over D-Bus, shown by the AppIndicator shell extension. Two different
// things must BOTH be present and they fail differently:
//
//   1. The client library (libayatana-appindicator3 / libappindicator3), which
//      Electron dlopen()s at runtime. Inside an AppImage the host /lib is still
//      visible, so this is rarely the problem — but when it IS missing,
//      `new Tray()` throws and tray.js already degrades to null.
//   2. A watcher/host on the session bus (org.kde.StatusNotifierWatcher) — i.e.
//      the GNOME extension actually running. When THIS is missing, `new Tray()`
//      SUCCEEDS but the icon renders nowhere, and main.js would hide the window
//      on close with no way back. That is the strand users report as
//      "tray doesn't work on GNOME".
//
// So: detect (2) explicitly over D-Bus, and request Background permission via
// xdg-desktop-portal so the app can keep running (and appear in GNOME Settings)
// even where no tray host exists. Everything here is best-effort and guarded:
// no D-Bus tools, no portal, non-Linux — all degrade to today's behaviour.

const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WATCHER_NAMES = Object.freeze([
  'org.kde.StatusNotifierWatcher',
  'org.freedesktop.StatusNotifierWatcher',
]);

const LIB_NAMES = Object.freeze([
  'libayatana-appindicator3.so.1',
  'libappindicator3.so.1',
]);

let watcherCache = null; // { present, method } | null

function detectDesktop(env) {
  const e = env || process.env;
  const raw = String((e && (e.XDG_CURRENT_DESKTOP || e.DESKTOP_SESSION)) || '');
  const lower = raw.toLowerCase();
  return {
    raw,
    sessionType: String((e && e.XDG_SESSION_TYPE) || '').toLowerCase(),
    isGnome: lower.includes('gnome'),
  };
}

/** True for a gdbus/dbus NameHasOwner reply meaning "owned". Exported for tests. */
function parseNameHasOwner(output) {
  const s = String(output || '');
  if (/\(\s*true\s*,?\s*\)/.test(s)) return true;   // gdbus: "(true,)"
  if (/boolean\s+true/i.test(s)) return true;       // dbus-send: "boolean true"
  return false;
}

function runGdbusHasOwner(name) {
  const r = spawnSync('gdbus', [
    'call', '--session',
    '--dest', 'org.freedesktop.DBus',
    '--object-path', '/org/freedesktop/DBus',
    '--method', 'org.freedesktop.DBus.NameHasOwner', name,
  ], { encoding: 'utf8', timeout: 1500 });
  if (r.error) return null;                          // ENOENT: no gdbus here
  if (typeof r.status === 'number' && r.status !== 0) return false;
  return parseNameHasOwner(r.stdout);
}

function runDbusSendHasOwner(name) {
  const r = spawnSync('dbus-send', [
    '--session', '--print-reply',
    '--dest=org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus.NameHasOwner',
    `string:${name}`,
  ], { encoding: 'utf8', timeout: 1500 });
  if (r.error) return null;
  if (typeof r.status === 'number' && r.status !== 0) return false;
  return parseNameHasOwner(r.stdout);
}

/**
 * Is any StatusNotifier watcher on the session bus? Sync, cached, ~ms. Never
 * throws; { present:false, method:null } means "no tools / no watcher", and the
 * caller must treat it as "no tray host".
 */
function hasStatusNotifierWatcher() {
  if (watcherCache) return watcherCache;
  let result = { present: false, method: null };
  try {
    for (const name of WATCHER_NAMES) {
      let hit = runGdbusHasOwner(name);
      if (hit === null) hit = runDbusSendHasOwner(name);
      if (hit === true) { result = { present: true, method: name }; break; }
      if (hit === null && result.method === null) result = { present: false, method: null };
    }
  } catch (e) { result = { present: false, method: null }; }
  watcherCache = result;
  return result;
}

/** For tests / re-probing. */
function resetWatcherCache() { watcherCache = null; }

/**
 * Diagnostic only: is the AppIndicator client library visible to this process?
 * Electron dlopen()s it, so `ldd` on the binary proves nothing — check the
 * loader cache plus well-known paths instead.
 */
function hasAppIndicatorLib() {
  const found = [];
  try {
    const r = spawnSync('ldconfig', ['-p'], { encoding: 'utf8', timeout: 2000 });
    const out = String((r && r.stdout) || '');
    for (const lib of LIB_NAMES) {
      if (out.includes(lib)) found.push(lib);
    }
    if (found.length) return { present: true, found, via: 'ldconfig' };
  } catch (e) { /* fall through to path probe */ }
  try {
    const dirs = ['/lib/x86_64-linux-gnu', '/usr/lib/x86_64-linux-gnu', '/lib64', '/usr/lib64', '/lib', '/usr/lib'];
    for (const lib of LIB_NAMES) {
      for (const d of dirs) {
        try { if (fs.existsSync(`${d}/${lib}`)) found.push(`${d}/${lib}`); } catch (e) { /* next */ }
      }
    }
  } catch (e) { /* ignore */ }
  return { present: found.length > 0, found, via: found.length ? 'path' : 'none' };
}

/**
 * Ask xdg-desktop-portal to let the app run in the background (and register it
 * in GNOME Settings → Apps). Fire-and-forget: resolves promptly, never rejects,
 * logs through the injected hooks. No-op off Linux or without gdbus.
 *
 * @param {object} [opts]
 * @param {string} [opts.reason]
 * @param {boolean} [opts.autostart]  default false; the caller passes the
 *   `autostart` pref. (An earlier revision used a WAI_PORTAL_AUTOSTART env flag;
 *   that is gone — the tray checkbox owns this now.)
 * @param {object} [opts.log]  { log, warn, debug }
 */
function requestBackground(opts) {
  const o = opts || {};
  const log = (o.log && o.log.log) || (() => {});
  const warn = (o.log && o.log.warn) || (() => {});
  const debug = (o.log && o.log.debug) || (() => {});
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      resolve({ ok, detail });
    };
    try {
      if (process.platform !== 'linux') return finish(false, 'not linux');
      const autostart = o.autostart === true;
      const reason = o.reason ||
        'Whatsapp Incognito keeps your WhatsApp session alive in the background so read receipts stay blocked';
      const options = `{'reason': <'${reason.replace(/'/g, "\\'")}'>, 'autostart': <${autostart ? 'true' : 'false'}>}`;
      const args = [
        'call', '--session',
        '--dest', 'org.freedesktop.portal.Desktop',
        '--object-path', '/org/freedesktop/portal/desktop',
        '--method', 'org.freedesktop.portal.Desktop.RequestBackground',
        '', options,
      ];
      debug(`portal RequestBackground (autostart=${autostart})`);
      const child = spawn('gdbus', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const kill = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
        finish(false, 'timed out (no portal?)');
      }, 6000);
      if (kill.unref) kill.unref();
      child.stdout.on('data', (d) => { out += String(d); });
      child.stderr.on('data', (d) => { err += String(d); });
      child.on('error', (e) => {
        clearTimeout(kill);
        debug(`portal request unavailable: ${(e && e.message) || e}`);
        finish(false, (e && e.message) || String(e));
      });
      child.on('close', (code) => {
        clearTimeout(kill);
        if (code === 0) {
          log(`background permission requested (${out.trim().slice(0, 80) || 'handle ok'})`);
          finish(true, out.trim());
        } else {
          warn(`background portal request failed (code ${code}): ${err.trim().slice(0, 160) || out.trim().slice(0, 160)}`);
          finish(false, err.trim() || out.trim());
        }
      });
    } catch (e) {
      try { warn(`background portal request failed: ${(e && e.message) || e}`); } catch (ignored) { /* ignore */ }
      finish(false, (e && e.message) || String(e));
    }
  });
}

module.exports = {
  detectDesktop,
  parseNameHasOwner,
  hasStatusNotifierWatcher,
  resetWatcherCache,
  hasAppIndicatorLib,
  requestBackground,
  autostartFilePath,
  buildDesktopEntry,
  writeAutostartFile,
  removeAutostartFile,
  applicationsDir,
  buildNotificationEntry,
  ensureNotificationEntry,
  WATCHER_NAMES,
};

/**
 * Where this user's autostart entry lives. Exported (with an env override for
 * tests) so main.js and tests agree on the path.
 */
function autostartFilePath(env) {
  const e = env || process.env;
  const configHome = (e && e.XDG_CONFIG_HOME) || path.join(os.homedir(), '.config');
  return path.join(configHome, 'autostart', 'waincognito.desktop');
}

/** XDG autostart entry. execCmd is already shell-quoted by the caller. */
function buildDesktopEntry(execCmd) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Whatsapp Incognito',
    'Comment=Whatsapp Incognito — starts on login when enabled in the tray menu',
    `Exec=${execCmd}`,
    'Icon=waincognito',
    'Terminal=false',
    'Categories=Network;InstantMessaging;',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Write (mkdir -p + write) the autostart file. Returns true on success. */
function writeAutostartFile(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/** Remove the autostart file. Returns true when nothing remains (incl. already absent). */
function removeAutostartFile(file) {
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------ notification entry

/**
 * Where a per-user desktop entry lives: `~/.local/share/applications`, per the XDG base
 * directory spec. `XDG_DATA_HOME` wins when set. Exported (with an env override for
 * tests) for the same reason as the autostart path.
 */
function applicationsDir(env) {
  const e = env || process.env;
  const dataHome = (e && e.XDG_DATA_HOME) || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'applications');
}

/**
 * The desktop entry that makes notifications work at all on Linux.
 *
 * The notification daemon (gnome-shell on GNOME, and the same freedesktop.org convention
 * everywhere else) matches an incoming notification against an installed application's
 * desktop id. `app.setAppUserModelId` supplies the id on our side, but the other half is
 * a `.desktop` file existing on disk for that id. electron-builder only emits one for
 * installed/AppImage builds, so every other way of running the app — `pnpm start`, a
 * dev run, an extracted AppImage — had no entry, and gnome-shell dropped the popup with
 * nothing on screen and nothing in the log.
 *
 * The file name MUST equal the app id: that is the join key. `StartupWMClass` is what
 * ties it to the running window, so the daemon can also match a window to an app.
 */
function buildNotificationEntry({ appId, exec, iconName, name, comment }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${name}`,
    `Comment=${comment}`,
    `Exec=${exec}`,
    `Icon=${iconName}`,
    'Terminal=false',
    // Declaring a category is what lets the notification carry actions, and it keeps the
    // entry out of the "unrecognized application" bucket in the GNOME overview.
    'Categories=Network;InstantMessaging;',
    // Set by Electron at runtime; matching on it is how the daemon resolves the id.
    `StartupWMClass=${appId}`,
    // The entry exists to carry the notification identity, not to offer a second way to
    // launch the app, so keep it out of the menus.
    'NoDisplay=true',
    '',
  ].join('\n');
}

/**
 * Write the notification entry if it is missing or stale. Returns true when the entry on
 * disk matches what we want afterwards.
 *
 * Best effort by design: a read-only or full home directory must not stop the app from
 * starting, and the caller only logs. Rewritten whenever the content differs so an
 * upgraded build picks up a changed app id or icon without needing an uninstall.
 */
function ensureNotificationEntry({ env, appId, exec, iconName, name, comment }) {
  const file = path.join(applicationsDir(env), `${appId}.desktop`);
  const content = buildNotificationEntry({ appId, exec, iconName, name, comment });
  try {
    if (fs.readFileSync(file, 'utf8') === content) return true;
  } catch (e) { /* absent or unreadable: fall through and write it */ }
  return writeAutostartFile(file, content);
}
