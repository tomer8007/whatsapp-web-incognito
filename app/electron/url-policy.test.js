'use strict';
// URL policy: the navigation lock and the window.open handler.
//
// These decide what this Electron wrapper is willing to navigate to and what it is
// willing to open. The refusals are the security surface, so they get most of the
// coverage; the accepted cases are here to pin the regression that motivated isInAppViewer.
//
// Background: WhatsApp Web previews a document by building a blob: URL from the decrypted
// media and window.open()ing it. The old handler returned {action:'deny'} for anything
// that was not http(s), so every PDF/doc preview silently did nothing while images — which
// are inline <img src="blob:..."> and never call window.open — kept working.

const test = require('node:test');
const assert = require('node:assert');

const { isAllowedNavigation, isOpenableExternal, isInAppViewer } = require('./url-policy');

// ---------------------------------------------------------------- isInAppViewer

test('a blob: document preview is WhatsApp viewer content, not an escape', () => {
  assert.strictEqual(isInAppViewer('blob:https://web.whatsapp.com/2b7f-4c1a'), true);
});

test('a blob: file: URL (what Chromium actually produced in the repro) is recognised', () => {
  assert.strictEqual(isInAppViewer('blob:file:///1676caa9-d9d8-4614-8598-319c343ed8c7'), true);
});

test('a data: PDF is recognised, because the viewer falls back to it', () => {
  assert.strictEqual(isInAppViewer('data:application/pdf;base64,JVBERi0xLjQK'), true);
});

test('scheme matching is case-insensitive', () => {
  assert.strictEqual(isInAppViewer('BLOB:https://web.whatsapp.com/x'), true);
  assert.strictEqual(isInAppViewer('DATA:application/pdf,x'), true);
});

test('isInAppViewer does not open the door to the dangerous schemes', () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'intent://scan/#Intent;scheme=zxing;end',
    'ws://web.whatsapp.com/socket',
    'about:blank',
    '',
    null,
    undefined,
  ]) {
    assert.strictEqual(isInAppViewer(url), false, `should refuse ${String(url)}`);
  }
});

// ---------------------------------------------------------------- isAllowedNavigation

test('web.whatsapp.com over https is the one allowed destination', () => {
  assert.strictEqual(isAllowedNavigation('https://web.whatsapp.com/'), true);
});

test('navigation to any other host is refused', () => {
  for (const url of [
    'https://web.whatsapp.com.evil.example/',
    'https://evil.example/web.whatsapp.com',
    'https://example.com/',
    'http://web.whatsapp.com/',
    'blob:https://web.whatsapp.com/x',
  ]) {
    assert.strictEqual(isAllowedNavigation(url), false, `should refuse ${url}`);
  }
});

test('malformed and empty input is refused rather than thrown on', () => {
  for (const url of ['', 'not a url', '://', null, undefined, {}]) {
    assert.strictEqual(isAllowedNavigation(url), false, `should refuse ${String(url)}`);
  }
});

// ---------------------------------------------------------------- isOpenableExternal

test('http(s) links are the ones handed to the OS browser', () => {
  assert.strictEqual(isOpenableExternal('https://example.com/article'), true);
  assert.strictEqual(isOpenableExternal('http://example.com/article'), true);
});

test('non-web schemes are never handed to the OS', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'intent://evil',
    'blob:https://web.whatsapp.com/x',
    '',
    null,
    undefined,
  ]) {
    assert.strictEqual(isOpenableExternal(url), false, `should refuse ${String(url)}`);
  }
});