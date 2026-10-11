'use strict';
// Linux SUID sandbox-helper check.
//
// Chromium requires `chrome-sandbox` (shipped next to the app binary) to be
// root-owned with mode 4755. Anything else aborts the whole app before its
// first window — and before any of its JavaScript runs, so no in-app
// workaround can save a launch that reaches that state:
//
//   [FATAL:sandbox/.../setuid_sandbox_host.cc] The SUID sandbox helper binary
//   was found, but is not configured correctly.
//
// That abort is the "clicking the icon does nothing" report: the menu and
// autostart entries launch the binary with no terminal and no extra flags, so
// the crash is silent. A .deb install gets correct permissions from postinst
// (app/packaging/linux/postinst, root on install and upgrade); a dev checkout
// or an AppImage can never have them.
//
// main.js consults this before deciding whether to append `--no-sandbox` —
// and deliberately does NOT append it when the helper is correct, so a fixed
// install keeps its sandbox. No Electron imports and no I/O of its own, so the
// predicate is unit-testable (sandbox.test.js); main.js supplies the stat.

/** Path of the helper shipped alongside the given executable. */
function sandboxHelperPath(execPath) {
  const path = require('node:path');
  return path.join(path.dirname(String(execPath)), 'chrome-sandbox');
}

/**
 * Is this helper stat correctly set up? `st` is an fs.Stats (or anything with
 * numeric `uid` and `mode`). Fail-open is the caller's choice; this predicate
 * itself is strict: root-owned AND exactly 4755, nothing else.
 */
function isHelperStatConfigured(st) {
  if (!st || typeof st.uid !== 'number' || typeof st.mode !== 'number') return false;
  return st.uid === 0 && (st.mode & 0o7777) === 0o4755;
}

/** stat the helper next to execPath; any doubt means "not configured". */
function isSandboxHelperConfigured(execPath) {
  try {
    const fs = require('node:fs');
    return isHelperStatConfigured(fs.statSync(sandboxHelperPath(execPath)));
  } catch (e) {
    return false;
  }
}

module.exports = {
  sandboxHelperPath,
  isHelperStatConfigured,
  isSandboxHelperConfigured,
};
