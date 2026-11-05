'use strict';
// Deep link parsing.
//
// This is a security boundary, not a convenience: the URI arrives from the OS — argv on a
// cold start, the second-instance argv, or macOS's open-url event — and this app did not
// create it. buildDeepLinkUrl decides whether it becomes a loadURL call, so the refusal
// cases are the interesting ones and get most of the coverage here.

const test = require('node:test');
const assert = require('node:assert');

const { buildDeepLinkUrl, isDeepLink } = require('./deep-link');

// ---------------------------------------------------------------- accepted

test('a send link with a phone number becomes a web.whatsapp.com URL', () => {
  assert.strictEqual(
    buildDeepLinkUrl('whatsapp://send?phone=15551234567'),
    'https://web.whatsapp.com/send?phone=15551234567&text=',
  );
});

test('a send link carries its text through', () => {
  const url = buildDeepLinkUrl('whatsapp://send?phone=15551234567&text=hello%20there');
  assert.strictEqual(url, 'https://web.whatsapp.com/send?phone=15551234567&text=hello%20there');
});

test('a send link with neither parameter still produces a usable URL', () => {
  assert.strictEqual(buildDeepLinkUrl('whatsapp://send'), 'https://web.whatsapp.com/send?phone=&text=');
});

test('the ported WhatsLNX shape is still accepted', () => {
  // `whatsapp://send` on its own, which is what the reference implementation documents.
  assert.match(buildDeepLinkUrl('whatsapp://send'), /^https:\/\/web\.whatsapp\.com\/send\?/);
});

// ---------------------------------------------------------------- refused

test('an unknown host is refused rather than passed through', () => {
  // The allowlist is the point. A denylist would have to enumerate every way a link can
  // be made to resolve somewhere unexpected.
  for (const raw of [
    'whatsapp://evil.example.com/?phone=1',
    'whatsapp://web.whatsapp.com.evil.test/send?phone=1',
    'whatsapp://CALL?phone=1',
  ]) {
    assert.strictEqual(buildDeepLinkUrl(raw), null, raw);
  }
});

test('a different scheme is refused', () => {
  for (const raw of [
    'https://web.whatsapp.com/send?phone=1',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>',
  ]) {
    assert.strictEqual(buildDeepLinkUrl(raw), null, raw);
  }
});

test('something that is not a URL at all is refused without throwing', () => {
  for (const raw of ['', 'whatsapp://', 'not a url', '://', null, undefined, 0, {}]) {
    assert.doesNotThrow(() => buildDeepLinkUrl(raw), String(raw));
    assert.strictEqual(buildDeepLinkUrl(raw), null, String(raw));
  }
});

test('a crafted body cannot smuggle a second parameter into the built URL', () => {
  // The parameters are re-encoded rather than concatenated, so an encoded & or # stays
  // data instead of becoming structure.
  const url = buildDeepLinkUrl('whatsapp://send?phone=1&text=a%26phone%3D999');
  assert.strictEqual(url, 'https://web.whatsapp.com/send?phone=1&text=a%26phone%3D999');

  const parsed = new URL(url);
  assert.strictEqual(parsed.searchParams.get('phone'), '1', 'phone is still 1');
  assert.strictEqual(parsed.searchParams.get('text'), 'a&phone=999', 'the & stayed inside the text');
  assert.strictEqual(parsed.origin, 'https://web.whatsapp.com');
  assert.strictEqual(parsed.pathname, '/send');
});

test('a fragment in the body cannot truncate the URL', () => {
  const url = buildDeepLinkUrl('whatsapp://send?phone=1&text=a%23b');
  const parsed = new URL(url);
  assert.strictEqual(parsed.hash, '', 'no fragment leaked out of the text');
  assert.strictEqual(parsed.searchParams.get('text'), 'a#b');
});

test('the origin is fixed and never taken from the input', () => {
  for (const raw of ['whatsapp://send?phone=1', 'whatsapp://send?phone=1#x']) {
    const parsed = new URL(buildDeepLinkUrl(raw));
    assert.strictEqual(parsed.origin, 'https://web.whatsapp.com', raw);
    assert.strictEqual(parsed.protocol, 'https:', raw);
  }
});

test('the host comparison is case-sensitive, and that is deliberate', () => {
  // `whatsapp:` is a non-special scheme, so URL does NOT lowercase its host the way it
  // does for http/https — `new URL('WHATSAPP://SEND').hostname` is literally "SEND". A
  // case-insensitive compare here would need an explicit toLowerCase(). It is left strict
  // because the reference implementation this was ported from is strict too, and every
  // real producer of these links (whatsapp:// links on the web, the official client)
  // emits a lowercase host. This test exists so that if someone later loosens it, the
  // loosening is a decision rather than an accident.
  assert.strictEqual(new URL('WHATSAPP://SEND?phone=1').hostname, 'SEND', 'premise still holds');
  assert.strictEqual(buildDeepLinkUrl('WHATSAPP://SEND?phone=1'), null);
  assert.match(buildDeepLinkUrl('whatsapp://send?phone=1'), /^https:\/\//, 'lowercase still works');
});

// ---------------------------------------------------------------- argv filtering

test('isDeepLink only matches the scheme, so argv can be filtered with it', () => {
  assert.strictEqual(isDeepLink('whatsapp://send?phone=1'), true);
  assert.strictEqual(isDeepLink('--no-sandbox'), false);
  assert.strictEqual(isDeepLink('/usr/bin/electron'), false);
  assert.strictEqual(isDeepLink(undefined), false);
  assert.strictEqual(isDeepLink(null), false);
  assert.strictEqual(isDeepLink(42), false);
});
