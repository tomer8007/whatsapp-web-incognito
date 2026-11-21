// Socket liveness tracking for the page shim (app/electron/shim.js).
//
// Loaded by the preload as an artifact *before* the shim runs. The tracker
// records the socket instance the native WebSocket constructor handed out
// (window.__WAI_NATIVE_WS__, installed by page-hooks/native-ws.js) and mirrors
// its readyState, so the shim's `state.socketState`/`state.socketSince`
// (what the watchdog and the self-test read) track it without polling.
//
// In the page world this file runs as a classic script and attaches
// `window.WAISocketTracker`; under node:test it is `require`d, so it is a
// CommonJS module too. One instance per realm.
;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else { root.WAISocketTracker = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var tracker = {
    socket: null,
    socketState: -1,
    socketSince: 0
  };

  function readSocket() {
    try {
      if (!tracker.socket) return;
      var v = tracker.socket.readyState;
      if (typeof v === 'number' && v !== tracker.socketState) {
        tracker.socketState = v;
        tracker.socketSince = Date.now();
      }
    } catch (e) { /* ignore */ }
  }

  function bindSocket() {
    try {
      var Native = globalThis.__WAI_NATIVE_WS__;
      if (!Native) return;
      var Current = globalThis.WebSocket;
      if (typeof Current !== 'function') return;

      var Tracked = function (url, protocols) {
        var args = (protocols === undefined) ? [url] : [url, protocols];
        var s = Reflect.construct(Current, args);
        tracker.socket = s;
        readSocket();
        return s;
      };
      Tracked.prototype = Native.prototype;
      if (Current !== Tracked) globalThis.WebSocket = Tracked;
    } catch (e) { /* non-fatal: we just lose socket reporting */ }
  }

  tracker.readSocket = readSocket;
  tracker.bindSocket = bindSocket;
  return tracker;
});
