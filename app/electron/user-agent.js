'use strict';
// User-agent spoofing, so WhatsApp Web's browser gate lets the app in.
//
// Observed: with Electron's stock UA, web.whatsapp.com serves a "WhatsApp works with
// Google Chrome 100+" page instead of the app. That gate is a user-agent check, so this
// is the whole of the fix for it.
//
// Two rules, and the second is the one people get wrong:
//
//  1. Remove the `Electron/x.y.z` token. This is the token WhatsApp is objecting to.
//
//  2. Do NOT invent a Chrome version. Electron's UA already carries a `Chrome/` token
//     and the real embedded Chromium version is available as process.versions.chrome.
//     Claiming a Chrome NEWER than the engine actually running would invite feature
//     detection that then behaves differently from what the UA promised, which is a
//     much harder failure to diagnose than being blocked outright. So we keep the
//     platform comment, the WebKit token, and the real Safari token, and only substitute
//     the true Chromium version.
//
// Scope, stated plainly: this is a browser-gate bypass, and it is the only thing that
// changes. It is NOT anonymity. Electron remains detectable by other means — the user
// agent is one signal among many, and fingerprinting surface (renderer strings, feature
// quirks, TLS/HTTP2 fingerprint) is untouched by this. The extension targets are
// unaffected: they run in a real browser and already send a real UA.
//
// No Electron imports and no I/O, so the string handling is unit-testable
// (user-agent.test.js). main.js supplies the real values.

/** Escape a string for literal use inside a RegExp. */
function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove an exact `Name/Version` product token wherever it appears. */
function removeToken(ua, name, version) {
  if (!name) return ua;
  // Version is optional: Electron omits it in some configurations.
  const patterns = [
    new RegExp(`\\s*\\b${esc(name)}(?:/${esc(version)})?(?=\\s|;|$)`, 'g'),
    new RegExp(`\\b${esc(name)}/${esc(version)}\\b`, 'g'),
  ];
  let out = ua;
  for (const re of patterns) out = out.replace(re, '');
  return out;
}

/**
 * @param {string} defaultUA        Electron's stock user agent for this app.
 * @param {object} versions
 * @param {string} versions.appName        product name, e.g. 'WAIncognito'
 * @param {string} versions.appVersion     e.g. '2.5.6'
 * @param {string} versions.electronVersion
 * @param {string} versions.chromeVersion  process.versions.chrome, e.g. '130.0.6723.191'
 * @returns {string|null} the cleaned UA, or null if the result cannot be trusted.
 */
function buildChromeUserAgent(defaultUA, versions) {
  const { appName, appVersion, electronVersion, chromeVersion } = versions || {};
  if (!defaultUA || typeof defaultUA !== 'string') return null;
  if (!chromeVersion) return null;

  let ua = defaultUA.trim();

  // Order matters: the app token first, because the app name could in principle contain
  // a browser name, and then Electron, then the version fix-up.
  ua = removeToken(ua, appName, appVersion);
  ua = removeToken(ua, 'Electron', electronVersion);

  // Substitute the REAL embedded Chromium version for the placeholder Electron uses.
  ua = ua.replace(/\bChrome\/[\d.]+/, `Chrome/${chromeVersion}`);

  // Tidy the whitespace left behind by the removals, without touching the inside of a
  // comment such as "(KHTML, like Gecko)".
  ua = ua.replace(/[ \t]{2,}/g, ' ').trim();

  return validate(ua, { appName, electronVersion, chromeVersion }) ? ua : null;
}

/**
 * Refuse to hand back a UA that would make things worse. A half-cleaned string — still
 * naming Electron, or now missing Chrome entirely — is worse than no change at all,
 * because it would be shipped silently. Returning null makes the caller fall back to the
 * default UA and say so loudly.
 */
function validate(ua, { appName, electronVersion, chromeVersion }) {
  if (!ua) return false;
  if (/Electron/i.test(ua)) return false;
  if (appName && new RegExp(`\\b${esc(appName)}`, 'i').test(ua)) return false;
  if (!/Mozilla\/5\.0/.test(ua)) return false;
  if (!ua.includes(`Chrome/${chromeVersion}`)) return false;
  if (!/AppleWebKit/.test(ua)) return false;
  // A doubled product token is the classic bot tell.
  if (/\bChrome\/[\d.]+.*\bChrome\/[\d.]+/.test(ua)) return false;
  // Nothing outside the Mozilla/5.0 (…) comment should look like a stray product token
  // with no slash, e.g. a leftover "Electron" with its version stripped.
  if (/\s(?!Chrome|Safari)[A-Za-z]{3,}\s[A-Za-z]/.test(ua.replace(/\([^)]*\)/g, ''))) return false;
  void electronVersion;
  return true;
}

/**
 * The embedded Chromium must be recent enough for WhatsApp Web to load at all.
 *
 * Learned the hard way: Electron 33 embeds Chromium 130 (Oct 2024). With the UA fixed to
 * be honest, WhatsApp stopped complaining about the Electron token and instead refused to
 * load the app at all — the symptom was a page telling the user to update their browser,
 * with nothing in our own logs. The cause was simply that the engine was two years stale.
 *
 * So this is a startup check, not a comment. It turns "WhatsApp shows a browser-upgrade
 * page and I have no idea why" into one explicit line naming the actual problem, and it
 * fails LOUDLY at boot rather than silently at the first message.
 *
 * 140 is a floor, not a target. WhatsApp's minimum moves with Chrome's release cadence, so
 * the correct response to this warning is to upgrade Electron, not to raise the number.
 */
const MIN_CHROMIUM_MAJOR = 140;

/**
 * @param {string} chromeVersion  process.versions.chrome
 * @param {number} [minMajor]
 * @returns {{ok: boolean, major: number, minMajor: number, reason: string|null}}
 */
function assessEngine(chromeVersion, minMajor = MIN_CHROMIUM_MAJOR) {
  const raw = String(chromeVersion || '');
  const major = parseInt(raw.split('.')[0], 10);
  if (!Number.isFinite(major)) {
    return {
      ok: false, major: 0, minMajor,
      reason: `could not read the embedded Chromium version from ${JSON.stringify(raw)}`,
    };
  }
  if (major < minMajor) {
    return {
      ok: false, major, minMajor,
      reason: `embedded Chromium ${major} is older than the required ${minMajor}. ` +
              `WhatsApp Web will refuse to load and show a browser-upgrade page. ` +
              `Upgrade Electron (\`pnpm add -D electron@latest\`) — do NOT raise this ` +
              `number or lie about the user agent, because a UA that claims a newer ` +
              `engine than actually runs invites feature detection that then disagrees ` +
              `with reality.`,
    };
  }
  return { ok: true, major, minMajor, reason: null };
}

module.exports = {
  buildChromeUserAgent, removeToken, validate, esc,
  assessEngine, MIN_CHROMIUM_MAJOR,
};
