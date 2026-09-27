'use strict';
// Preference storage owned by the shell.
//
// This replaces background.js for the Electron target. The extension keeps using
// chrome.storage.local via background.js; the app persists the interception keys as
// JSON in the OS user-data dir, so behaviour is identical in both targets. main.js
// merges SHELL_DEFAULTS (e.g. `autostart`) over the build-derived defaults for
// shell-only settings the extension must never see.
//
// Two rules keep the targets honest:
//   1. The DEFAULTS are not written here. They are derived from background.js at build
//      time and arrive via buildDefaults(), so the two targets cannot disagree about
//      what a default is. An upstream change to those defaults propagates on rebuild.
//   2. Writes are atomic (tmp file + rename) and schema-checked. A half-written prefs
//      file would silently reset a user's choices, which for this app means silently
//      re-enabling read receipts.

const fs = require('node:fs');
const path = require('node:path');

const FILE_VERSION = 1;

class PrefsStore {
  /**
   * @param {string} userDataDir  Electron's app.getPath('userData')
   * @param {object} defaults      Derived from background.js by scripts/build.mjs
   * @param {string} [filePath]    Override, for tests
   */
  constructor(userDataDir, defaults, filePath) {
    if (!userDataDir) throw new Error('PrefsStore: userDataDir is required');
    if (!defaults || typeof defaults !== 'object') {
      throw new Error('PrefsStore: defaults object is required (derive it from background.js)');
    }
    this.dir = userDataDir;
    this.file = filePath || path.join(userDataDir, 'prefs.json');
    this.defaults = Object.freeze({ ...defaults });
    this.keys = Object.keys(this.defaults);
    this.prefs = { ...this.defaults };
    this.load();
  }

  // ---------------------------------------------------------------- load / save

  load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // A corrupt or unreadable file must not be silently ignored: keep a copy so the
        // user's settings are recoverable, then fall back to defaults.
        this._quarantine(`unreadable prefs file (${e.code})`);
      }
      return this.prefs;
    }

    let parsed;
    try {
      parsed = JSON.parse(stripBOM(raw));
    } catch (e) {
      this._quarantine(`prefs file is not valid JSON (${e.message})`);
      return this.prefs;
    }

    const stored = parsed && typeof parsed === 'object' ? parsed.prefs : null;
    if (!stored) return this.prefs;

    // Merge over defaults so a key added by a newer upstream release picks up its
    // default instead of coming back undefined, and validate every value by type.
    for (const k of this.keys) {
      if (Object.prototype.hasOwnProperty.call(stored, k)) {
        this.prefs[k] = coerce(this.defaults[k], stored[k], this.defaults[k]);
      }
    }
    return this.prefs;
  }

  _quarantine(reason) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const bak = `${this.file}.corrupt`;
      fs.renameSync(this.file, bak);
      safeError(`[prefs] ${reason}; previous file kept at ${bak}`);
    } catch (e) {
      safeError(`[prefs] ${reason}; could not quarantine: ${e.message}`);
    }
  }

  save() {
    const payload = { version: FILE_VERSION, prefs: this.prefs };
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(this.dir, { recursive: true });
    // tmp + rename is atomic on every platform we ship, so a crash mid-write leaves the
    // previous good file intact rather than a truncated one.
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // ---------------------------------------------------------------- api

  /** A copy, so callers cannot mutate internal state. */
  get() {
    return { ...this.prefs };
  }

  /**
   * Apply a partial patch. Unknown keys are rejected rather than stored, so a stale
   * build cannot accumulate junk, and a value of the wrong type is coerced or ignored.
   * @returns {{prefs: object, applied: string[], rejected: string[]}}
   */
  set(patch) {
    const applied = [];
    const rejected = [];
    if (!patch || typeof patch !== 'object') return { prefs: this.get(), applied, rejected };

    for (const [k, v] of Object.entries(patch)) {
      if (!Object.prototype.hasOwnProperty.call(this.defaults, k)) { rejected.push(k); continue; }
      const next = coerce(this.defaults[k], v, this.prefs[k]);
      if (next === undefined) { rejected.push(k); continue; }
      this.prefs[k] = next;
      applied.push(k);
    }

    if (applied.length) this.save();
    return { prefs: this.get(), applied, rejected };
  }

  /** Restore every default. Used by the tray's "reset" item. */
  reset() {
    this.prefs = { ...this.defaults };
    this.save();
    return this.get();
  }
}

/**
 * Validate a value against the type of its default.
 * @returns the coerced value, or undefined when the input is unusable.
 */
function coerce(defaultValue, value, currentValue) {
  if (typeof defaultValue === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    return undefined;
  }
  if (typeof defaultValue === 'number') {
    const n = typeof value === 'number' ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return undefined;
    // safetyDelay is the only numeric option and ui.js:1119 only offers 0-30, with 0
    // meaning disabled. Clamp rather than reject so a hand-edited file still loads.
    if (defaultValue === 0 && value === 0) return 0;
    if (n < 0 || n > 30) return currentValue ?? defaultValue;
    return n;
  }
  return value === undefined ? currentValue : value;
}

function stripBOM(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// stderr may be closed (dock/desktop launch without a terminal): a throwing
// console.error here would crash startup over a prefs backup notice.
function safeError(...args) {
  try { console.error(...args); } catch (e) { /* ignore */ }
}

module.exports = { PrefsStore, coerce };
