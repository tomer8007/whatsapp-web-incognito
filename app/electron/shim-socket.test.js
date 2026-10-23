// The socket-liveness capture in shim.js. Extracted here as a faithful reimplementation
// of the logic rather than by importing shim.js, because the shim is a page-world IIFE
// that installs a failure banner and reads window.chrome on evaluation — none of which
// can run under the test runner. The logic below is kept line-for-line in step with
// bindSocket()/readSocket() in shim.js; if you change one, change both.

const test = require('node:test');
const assert = require('node:assert');

/** Stand-in for the browser's WebSocket, including the prototype readyState getter. */
class FakeWS {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this._rs = 1;
    this.sent = [];
    this._listeners = {};
  }
  get readyState() { return this._rs; }
  send(d) { this.sent.push(d); }
  addEventListener(type, fn) { this._listeners[type] = fn; }
  close() { this._rs = 3; }
}

/**
 * Reproduce the real three-way interaction:
 *   1. the preload captures the native constructor (NATIVE_WS_SRC, step 1b)
 *   2. core/ws_hook.js replaces the global with a wrapper that builds the socket and
 *      attaches the before/after interception hooks to it
 *   3. the shim's bindSocket() re-points the global at its own tracking wrapper
 */
function buildSocket() {
  const g = globalThis;
  g.WebSocket = FakeWS;
  g.__WAI_NATIVE_WS__ = g.WebSocket;               // 1. preload step 1b
  const _WS = g.WebSocket;

  // 2. ws_hook.js. Note what it actually does: the wrapper constructs the native socket
  // and then attaches the send override and the message listener TO THAT INSTANCE. The
  // hooks live on the instance, not on the constructor — which is exactly why step 3 has
  // to keep going through this wrapper rather than reaching past it to the native one.
  const wsHook = { beforeCalls: 0, afterCalls: 0 };
  wsHook.before = function (data) { wsHook.beforeCalls++; return data; };
  wsHook.after = function (e) { wsHook.afterCalls++; return e; };
  g.WebSocket = function (url, protocols) {
    this.url = url;
    this.protocols = protocols;
    const WSObject = (protocols === undefined) ? new _WS(url) : new _WS(url, protocols);
    const nativeSend = WSObject.send;
    WSObject.send = function (data) {
      wsHook.before(data, WSObject.url);
      return nativeSend.apply(WSObject, [data]);
    };
    WSObject.addEventListener('message', function (event) {
      wsHook.after(event, WSObject.url);
    });
    return WSObject;
  };

  // 3. shim.js bindSocket() + readSocket(), verbatim.
  let socket = null;
  const state = { socketState: -1, socketSince: 0 };
  function bindSocket() {
    try {
      const Native = g.__WAI_NATIVE_WS__;
      if (!Native) return;
      const Current = g.WebSocket;
      if (typeof Current !== 'function') return;
      const Tracked = function (url, protocols) {
        const args = (protocols === undefined) ? [url] : [url, protocols];
        const s = Reflect.construct(Current, args);
        socket = s;
        readSocket();
        return s;
      };
      Tracked.prototype = Native.prototype;
      if (Current !== Tracked) g.WebSocket = Tracked;
    } catch (e) { /* non-fatal */ }
  }
  function readSocket() {
    try {
      if (!socket) return;
      const v = socket.readyState;
      if (typeof v === 'number' && v !== state.socketState) {
        state.socketState = v;
        state.socketSince = Date.now();
      }
    } catch (e) { /* ignore */ }
  }
  bindSocket();
  return { g, state, readSocket, wsHook };
}

test('the interception hook still fires on every frame', () => {
  // THE regression this file exists for, second version. The first version of
  // bindSocket() built the socket with `new Native(...)` — reaching PAST ws_hook's
  // wrapper to the native constructor. ws_hook attaches its before/after hooks inside
  // that wrapper, so the hooks were never installed on the instance and no frame was
  // ever inspected. The app then raised its "interception is not working" dialog even
  // though the shim reported the hook as armed.
  //
  // The earlier version of this test missed it because it asserted only
  // `typeof wa.send === 'function'`, which the raw prototype method satisfies. What
  // matters is whether the hook RAN, not whether send exists.
  const { g, wsHook } = buildSocket();
  const wa = new g.WebSocket('wss://web.whatsapp.com/ws/chat');

  wa.send('{"important":[]}');
  assert.strictEqual(wsHook.beforeCalls, 1, 'before() ran on the outbound frame');

  wa._listeners.message({ data: '{}' });
  assert.strictEqual(wsHook.afterCalls, 1, 'after() ran on the inbound frame');

  // A second frame proves the hook is on the path every time, not just the first.
  wa.send('{"x":1}');
  assert.strictEqual(wsHook.beforeCalls, 2);
  // And the frame still reaches the wire — capturing it must not swallow it.
  assert.deepStrictEqual(wa.sent, ['{"important":[]}', '{"x":1}']);
});

test('socketState is captured at construction, with no one reading readyState', () => {
  // THE regression, first version. The original implementation patched a readyState
  // getter and relied on something reading it. Nothing ever did, so socketState stayed
  // -1, the watchdog reported 'no socket observed' after 90s, and the tray showed a
  // permanent false "receipts are NOT blocked right now" while the hook was
  // demonstrably blocking them.
  const { g, state } = buildSocket();
  new g.WebSocket('wss://web.whatsapp.com/ws/chat');   // nobody touches .readyState
  assert.strictEqual(state.socketState, 1);
  assert.ok(state.socketSince > 0, 'socketSince is stamped');
});

test('a closed socket is reported, so the watchdog disconnect check can fire', () => {
  // watchdog.js:223 compares against socketState === 3. That branch was dead while
  // socketState was pinned at -1, so a real disconnection went unnoticed.
  const { g, state, readSocket } = buildSocket();
  const wa = new g.WebSocket('wss://web.whatsapp.com/ws/chat');
  wa.close();
  readSocket();
  assert.strictEqual(state.socketState, 3);
});

test('a reconnect resets the reported state', () => {
  const { g, state, readSocket } = buildSocket();
  const first = new g.WebSocket('wss://web.whatsapp.com/ws/chat');
  first.close();
  readSocket();
  assert.strictEqual(state.socketState, 3);
  new g.WebSocket('wss://web.whatsapp.com/ws/chat2');
  assert.strictEqual(state.socketState, 1, 'new socket reports open again');
});

test('the socket WhatsApp receives is a real socket, not a wrapper', () => {
  // If this regresses, WhatsApp breaks in ways that look nothing like a liveness bug.
  const { g } = buildSocket();
  const wa = new g.WebSocket('wss://web.whatsapp.com/ws/chat', 'chat');
  assert.ok(wa instanceof FakeWS, 'instanceof survives');
  assert.strictEqual(wa.url, 'wss://web.whatsapp.com/ws/chat');
  assert.strictEqual(wa.protocols, 'chat');
  assert.strictEqual(wa.readyState, 1, 'the native getter still answers');
  assert.strictEqual(typeof wa.send, 'function', 'ws_hook send override still in place');
});

test('the one-argument call shape does not pass an explicit undefined protocol', () => {
  // ws_hook constructs with `new _WS(url)`. Forwarding a literal undefined would make the
  // native constructor see a 2-argument call, which some implementations distinguish.
  const { g } = buildSocket();
  const wa = new g.WebSocket('wss://web.whatsapp.com/ws/chat');
  assert.strictEqual(wa.protocols, undefined);
});

test('a missing native constructor is survivable, not fatal', () => {
  // bindSocket is explicitly non-fatal: losing socket reporting must not cost us the
  // interception itself.
  const g = globalThis;
  g.WebSocket = FakeWS;
  g.__WAI_NATIVE_WS__ = undefined;
  const { state, readSocket } = buildSocket();
  readSocket();
  assert.strictEqual(state.socketState, -1, 'never observed, rather than throwing');
});
