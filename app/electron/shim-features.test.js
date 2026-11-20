'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHIM_BUILT = path.join(__dirname, '..', '.build', 'shim.js');

function loadShimSandbox(bootstrap, ipcOverrides) {
  const src = fs.readFileSync(SHIM_BUILT, 'utf8');
  const dispatched = [];
  const ipcCalls = [];

  const ipc = Object.assign({
    booted(info) { ipcCalls.push(['booted', info]); },
    setPrefs(patch) { ipcCalls.push(['setPrefs', patch]); },
    resetPrefs() { ipcCalls.push(['resetPrefs']); },
    setWhitelistRule(payload) { ipcCalls.push(['setWhitelistRule', payload]); },
    setNote(payload) { ipcCalls.push(['setNote', payload]); },
    deleteNote(payload) { ipcCalls.push(['deleteNote', payload]); },
    clearNotes() { ipcCalls.push(['clearNotes']); },
    async exportEphemeralChat(payload) {
      ipcCalls.push(['exportEphemeralChat', payload]);
      return { ok: true, filePath: '/tmp/chat-sanitized.md' };
    },
    reportFailure(r, d) { ipcCalls.push(['reportFailure', r, d]); },
  }, ipcOverrides || {});

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise,
    CustomEvent: function (type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    document: {
      createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, textContent: '' }),
      body: null,
      documentElement: null,
      readyState: 'complete',
      dispatchEvent(e) { dispatched.push(e); return true; },
    },
    navigator: { userAgent: 'test-ua' },
    location: { href: 'https://web.whatsapp.com/', protocol: 'https:' },
    WAIJidUtils: require('../../shared/jid_utils.js'),
    __WAI_BOOTSTRAP__: bootstrap,
    __WAI_IPC__: ipc,
    JSON, Object, Math, Date, RegExp, Error, TypeError, Array, String, Number, Boolean,
    parseInt, isNaN,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'shim.js' });
  return { sandbox, dispatched, ipcCalls };
}

test('shim boots from __WAI_BOOTSTRAP__ for prefs, whitelist, and notes', () => {
  const { sandbox } = loadShimSandbox({
    prefs: {
      readConfirmationsHook: false,
      privacyScreenLockEnabled: true,
      privacyScreenLockIdleMinutes: 15,
      privacyScreenLockPIN: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    },
    whitelist: { '15551234567@c.us': 'always' },
    notes: { '15551234567@c.us': 'secret' },
  });

  sandbox.chrome.runtime.sendMessage({ name: 'getInitialState' }, (res) => {
    assert.strictEqual(res.options.readConfirmationsHook, false);
    assert.strictEqual(res.options.privacyScreenLockEnabled, true);
    assert.strictEqual(res.options.privacyScreenLockIdleMinutes, 15);
    assert.deepStrictEqual(res.contactWhitelistRules, { '15551234567@c.us': 'always' });
    assert.deepStrictEqual(res.ephemeralNotes, { '15551234567@c.us': 'secret' });
  });
});

test('shim relays whitelist and ephemeral note mutations to host IPC', () => {
  const { sandbox, ipcCalls } = loadShimSandbox({ prefs: {}, whitelist: {}, notes: {} });

  sandbox.browser.runtime.sendMessage({
    name: 'setContactWhitelistRule',
    jid: '15551234567:2@s.whatsapp.net',
    rule: 'never',
  }, (rules) => {
    assert.deepStrictEqual(rules, { '15551234567@c.us': 'never' });
  });

  sandbox.browser.runtime.sendMessage({
    name: 'setEphemeralNote',
    jid: '15551234567@s.whatsapp.net',
    note: 'Remember this',
  }, (notes) => {
    assert.deepStrictEqual(notes, { '15551234567@c.us': 'Remember this' });
  });

  sandbox.browser.runtime.sendMessage({
    name: 'deleteEphemeralNote',
    jid: '15551234567@c.us',
  }, (notes) => {
    assert.deepStrictEqual(notes, {});
  });

  sandbox.browser.runtime.sendMessage({ name: 'resetOptions' }, (opts) => {
    assert.strictEqual(opts.readConfirmationsHook, true);
    assert.strictEqual(opts.safetyDelay, 0);
  });

  assert.deepStrictEqual(
    ipcCalls.filter((c) => ['setWhitelistRule', 'setNote', 'deleteNote', 'resetPrefs'].includes(c[0])).map((c) => c[0]),
    ['setWhitelistRule', 'setNote', 'deleteNote', 'resetPrefs']
  );
});

test('shim forwards host whitelist/notes updates and openOptions({ focus }) detail', async () => {
  const { sandbox, dispatched } = loadShimSandbox({ prefs: {}, whitelist: {}, notes: {} });

  sandbox.__WAI__.setWhitelist({ '100@c.us': 'always' });
  sandbox.__WAI__.setNotes({ '100@c.us': 'note 1' });

  const wlEv = dispatched.find((e) => e.type === 'onContactWhitelistUpdate');
  const noteEv = dispatched.find((e) => e.type === 'onEphemeralNotesUpdate');
  assert.ok(wlEv && JSON.parse(wlEv.detail)['100@c.us'] === 'always');
  assert.ok(noteEv && JSON.parse(noteEv.detail)['100@c.us'] === 'note 1');

  sandbox.__WAI__.openOptions({ focus: 'privacyScreenLockPIN' });
  const openEv = dispatched.find((e) => e.type === 'onOpenIncognitoOptions');
  assert.deepStrictEqual(JSON.parse(openEv.detail), { focus: 'privacyScreenLockPIN' });

  const exportRes = await new Promise((resolve) => {
    sandbox.browser.runtime.sendMessage({ name: 'exportEphemeralChat', contactJid: '100@c.us' }, resolve);
  });
  assert.deepStrictEqual(exportRes, { ok: true, filePath: '/tmp/chat-sanitized.md' });
});
