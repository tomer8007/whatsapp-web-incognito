'use strict';
// URL policy for the navigation lock and the window.open handler.
//
// These were inline in main.js, which is not requireable from `node --test` (it calls
// app.commandLine.appendSwitch at module scope), so the pure predicates live here where
// they can be tested directly. main.js imports them; the behaviour is unchanged.
//
// All three are security boundaries, so the refusal cases matter more than the accepted
// ones: main.js:360 says the lock exists so "a compromised or mistyped link must not turn
// the app window into a general browser with our preload attached".

/** The only host this app is ever allowed to be navigated to. */
const ALLOWED_NAV_HOST = 'web.whatsapp.com';

function isAllowedNavigation(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === ALLOWED_NAV_HOST;
  } catch (e) {
    return false;
  }
}

/** A genuine web link we are willing to hand to the OS browser. */
function isOpenableExternal(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

/**
 * Whether a window.open() target is WhatsApp's OWN in-app document/media viewer, which
 * this app must render itself rather than refuse or hand to the OS.
 *
 * WhatsApp Web previews an attachment by building a blob: URL from the decrypted media
 * and opening it. Images skip this entirely — they are inline <img src="blob:..."> — so
 * they kept working while every PDF, doc, and voice-note viewer silently did nothing.
 * Stock WhatsApp Web shows a preview; refusing these made this build differ from it, so
 * the native behaviour is the bug-compatible one.
 *
 * blob: is the common case and is safe to honour: it is scoped to the creating page and
 * revocable, so it can only ever show content WhatsApp itself just handed us. data: is
 * also permitted because the viewer falls back to it — it is untrusted content by
 * construction, which is why the window that renders it is locked down at the call site.
 */
function isInAppViewer(url) {
  return /^(blob|data):/i.test(String(url || ''));
}

module.exports = {
  ALLOWED_NAV_HOST,
  isAllowedNavigation,
  isOpenableExternal,
  isInAppViewer,
};