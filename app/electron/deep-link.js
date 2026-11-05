'use strict';
// The whatsapp:// deep link parser.
//
// Extracted from main.js purely so it can be tested: it is a pure function, and it is the
// only thing standing between a URL handed to us by the OS (argv, or the macOS open-url
// event — neither of which this app produced) and a loadURL call. Everything it rejects
// is a rejection that keeps that boundary honest, so the rejection cases are worth more
// than the happy path.

const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';

/**
 * Turn a `whatsapp://` URI into a web.whatsapp.com URL, or return null to refuse it.
 *
 * Only `send` is accepted. This is a deliberate allowlist rather than a denylist: the
 * scheme is a generic one that other apps also register, so an incoming URI is untrusted
 * input, and any host we have not explicitly taught ourselves to understand is refused
 * instead of being passed to loadURL.
 *
 * The phone number and body are re-encoded rather than concatenated, so a crafted link
 * cannot smuggle a second query parameter (`&`, `#`) into the URL we build.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function buildDeepLinkUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch (e) {
    return null;                       // not a URL at all
  }
  if (parsed.protocol !== 'whatsapp:') return null;
  if (parsed.hostname !== 'send') return null;

  const phone = parsed.searchParams.get('phone') || '';
  const text = parsed.searchParams.get('text') || '';
  return `${WHATSAPP_ORIGIN}/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
}

/** True if `raw` looks like something this module would act on. Used to filter argv. */
function isDeepLink(raw) {
  return typeof raw === 'string' && raw.startsWith('whatsapp://');
}

module.exports = { buildDeepLinkUrl, isDeepLink, WHATSAPP_ORIGIN };
