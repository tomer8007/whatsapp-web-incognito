'use strict';

const test = require('node:test');
const assert = require('node:assert');

const tracker = require('./socket_tracker.js');

/** Stand-in for the browser's WebSocket, including the prototype readyState getter. */
class FakeWS {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this._rs = 1;
    this.sent = [];
  }
  get readyState() { return this._rs; }
  send(d) { this.sent.push(d); }
  close() { this._rs = 3; }
}

function resetGlobals({ native = true } = {}) {
  tracker.socket = null;
  tracker.socketState = -1;
  tracker.socketSince = 0;
  globalThis.WebSocket = FakeWS;
  if (native) {
    globalThis.__WAI_NATIVE_WS__ = FakeWS;
  } else {
    delete globalThis.__WAI_NATIVE_WS__;
  }
}

test('the socket WhatsApp receives is a real socket, not a wrapper', () => {
  resetGlobals();
  tracker.bindSocket();
  const wa = new globalThis.WebSocket('wss://web.whatsapp.com/ws/chat', 'chat');
  assert.strictEqual(wa.url, 'wss://web.whatsapp.com/ws/chat');
  assert.strictEqual(wa.protocols, 'chat');
  assert.strictEqual(wa.readyState, 1, 'the native getter still answers');
  assert.strictEqual(typeof wa.send, 'function');
});

test('the one-argument call shape does not pass an explicit undefined protocol', () => {
  resetGlobals();
  tracker.bindSocket();
  const wa = new globalThis.WebSocket('wss://web.whatsapp.com/ws/chat');
  assert.strictEqual(wa.protocols, undefined);
});

test('the tracker records the constructed socket and captures readyState at construction', () => {
  resetGlobals();
  tracker.bindSocket();
  const wa = new globalThis.WebSocket('wss://web.whatsapp.com/ws/chat');
  assert.strictEqual(tracker.socket, wa, 'the tracker recorded the constructed socket');
  assert.strictEqual(tracker.socketState, 1);
  assert.ok(tracker.socketSince > 0, 'socketSince is stamped');
});

test('a closed socket is reported, so the watchdog disconnect check can fire', () => {
  resetGlobals();
  tracker.bindSocket();
  const wa = new globalThis.WebSocket('wss://web.whatsapp.com/ws/chat');
  wa.close();
  tracker.readSocket();
  assert.strictEqual(tracker.socketState, 3);
});

test('a reconnect replaces the tracked socket and re-stamps state', () => {
  resetGlobals();
  tracker.bindSocket();
  const first = new globalThis.WebSocket('wss://web.whatsapp.com/ws/chat');
  first.close();
  tracker.readSocket();
  assert.strictEqual(tracker.socketState, 3);

  const second = new globalThis.WebSocket('wss://web.whatsapp.com/ws/chat2');
  assert.strictEqual(tracker.socket, second, 'a reconnect is the new tracked socket');
  tracker.readSocket();
  assert.strictEqual(tracker.socketState, 1, 'new socket reports open again');
  assert.ok(tracker.socketSince > 0);
});

test('a missing native constructor is survivable, not fatal', () => {
  resetGlobals({ native: false });
  tracker.bindSocket();
  const wa = new globalThis.WebSocket('wss://web.whatsapp.com/ws/chat');
  assert.ok(wa instanceof FakeWS);
  assert.strictEqual(tracker.socket, null, 'nothing tracked when there is no native constructor');
  tracker.readSocket();
  assert.strictEqual(tracker.socketState, -1, 'never observed, rather than throwing');
});

test('readSocket is a no-op without a tracked socket', () => {
  resetGlobals();
  assert.doesNotThrow(() => tracker.readSocket());
});
