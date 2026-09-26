'use strict';
// Tests for the user-agent rewrite. Run: npm test
//
// The bar is "indistinguishable from a real Chrome UA for the engine we actually embed",
// not merely "Electron is gone" — a half-cleaned string would be shipped silently and is
// worse than not touching it.

const test = require('node:test');
const assert = require('node:assert');

const { buildChromeUserAgent, validate } = require('./user-agent.js');

// Electron's real stock format, per platform. Note the `Chrome/130.0.0.0` placeholder:
// Electron deliberately reports 0.0.0.0 there rather than the true Chromium build.
const LINUX_ELECTRON_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'WAIncognito/2.5.6 Chrome/130.0.0.0 Electron/33.4.11 Safari/537.36';
const MAC_ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'WAIncognito/2.5.6 Chrome/130.0.0.0 Electron/33.4.11 Safari/537.36';
const WINDOWS_ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'WAIncognito/2.5.6 Chrome/130.0.0.0 Electron/33.4.11 Safari/537.36';

const V = { appName: 'WAIncognito', appVersion: '2.5.6', electronVersion: '33.4.11', chromeVersion: '130.0.6723.191' };

test('produces a plausible Chrome UA and drops every Electron/app token', () => {
  const ua = buildChromeUserAgent(LINUX_ELECTRON_UA, V);
  assert.ok(ua, 'should return a UA');
  assert.ok(!/Electron/i.test(ua), 'Electron must be gone');
  assert.ok(!ua.includes('WAIncognito'), 'the app name must be gone');
  assert.ok(ua.startsWith('Mozilla/5.0 (X11; Linux x86_64)'), 'platform comment preserved');
  assert.ok(ua.includes('AppleWebKit/537.36'), 'WebKit token preserved');
  assert.ok(ua.includes('Safari/537.36'), 'real Chrome UAs do carry Safari');
  assert.ok(ua.endsWith('Safari/537.36'), 'Safari is the final token, as in real Chrome');
});

test('reports the REAL embedded Chromium version, not the 0.0.0.0 placeholder', () => {
  const ua = buildChromeUserAgent(LINUX_ELECTRON_UA, V);
  assert.ok(ua.includes('Chrome/130.0.6723.191'), `got: ${ua}`);
  assert.ok(!ua.includes('Chrome/130.0.0.0'), 'the Electron placeholder must be replaced');
});

test('no doubled or leftover spacing', () => {
  for (const ua of [LINUX_ELECTRON_UA, MAC_ELECTRON_UA, WINDOWS_ELECTRON_UA]) {
    const out = buildChromeUserAgent(ua, V);
    assert.ok(!/\s{2,}/.test(out), `double space in: ${out}`);
    assert.ok(!/^\s|\s$/.test(out), `leading/trailing space in: ${out}`);
  }
});

test('exactly one Chrome token', () => {
  const ua = buildChromeUserAgent(LINUX_ELECTRON_UA, V);
  assert.strictEqual((ua.match(/Chrome\//g) || []).length, 1);
});

test('preserves each platform comment rather than hardcoding one', () => {
  assert.ok(buildChromeUserAgent(MAC_ELECTRON_UA, V).includes('Macintosh; Intel Mac OS X 10_15_7'));
  assert.ok(buildChromeUserAgent(WINDOWS_ELECTRON_UA, V).includes('Windows NT 10.0; Win64; x64'));
});

test('handles an app name/version containing regex metacharacters', () => {
  const v = { ...V, appName: 'WA.Incognito (Beta)+', appVersion: '2.5.6-rc.1' };
  const input = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'WA.Incognito (Beta)+/2.5.6-rc.1 Chrome/130.0.0.0 Electron/33.4.11 Safari/537.36';
  const ua = buildChromeUserAgent(input, v);
  assert.ok(ua, 'metacharacters in the app name must not break the rewrite');
  assert.ok(!/Electron/i.test(ua));
  assert.ok(!ua.includes('Beta'), `got: ${ua}`);
});

test('a missing Electron token (other Electron versions) is still handled', () => {
  const input = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'WAIncognito/2.5.6 Chrome/130.0.0.0 Safari/537.36';
  const ua = buildChromeUserAgent(input, V);
  assert.ok(ua && !ua.includes('WAIncognito') && ua.includes('Chrome/130.0.6723.191'));
});

test('an app name that is already absent is a no-op, not a corruption', () => {
  const alreadyClean =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const ua = buildChromeUserAgent(alreadyClean, V);
  assert.strictEqual(ua, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36');
});

test('refuses to return an untrustworthy UA rather than shipping a broken one', () => {
  // No Chrome version available: we cannot claim to be Chrome, so decline.
  assert.strictEqual(buildChromeUserAgent(LINUX_ELECTRON_UA, { ...V, chromeVersion: undefined }), null);
  // Garbage input.
  assert.strictEqual(buildChromeUserAgent('', V), null);
  assert.strictEqual(buildChromeUserAgent(null, V), null);
  assert.strictEqual(buildChromeUserAgent(undefined, V), null);
});

test('validate rejects the specific ways this can go wrong', () => {
  const v = { appName: 'WAIncognito', electronVersion: '33.4.11', chromeVersion: '130.0.6723.191' };
  assert.strictEqual(validate('Electron/33.4.11', v), false, 'still names Electron');
  assert.strictEqual(validate('WAIncognito Chrome/130.0.6723.191', v), false, 'leaks app name');
  assert.strictEqual(validate('Mozilla/5.0 Chrome/129.0.0.0', v), false, 'wrong Chrome version');
  assert.strictEqual(validate('Mozilla/5.0 Chrome/130.0.6723.191 Chrome/130.0.6723.191', v), false, 'doubled token');
  assert.strictEqual(validate('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36', v), true);
});

test('the result is accepted by the same validator used in production', () => {
  const v = { appName: 'WAIncognito', electronVersion: '33.4.11', chromeVersion: '130.0.6723.191' };
  for (const input of [LINUX_ELECTRON_UA, MAC_ELECTRON_UA, WINDOWS_ELECTRON_UA]) {
    assert.ok(validate(buildChromeUserAgent(input, V), v), `rejected: ${buildChromeUserAgent(input, V)}`);
  }
});
