;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else { root.WAIErrorHook = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var installed = false;

  // Installs a hook-on-hook so extension-related errors are printed first:
  // WhatsApp hooks window.onerror, and the extension wraps it to log the error
  // before the original handler runs. Runs after 1s, and only when the host
  // already set window.onerror.
  function installErrorHook() {
    if (installed) return;
    installed = true;
    setTimeout(function () {
      if (!window || !window.onerror) return;
      var originalOnError = window.onerror;
      window.onerror = function (message, source, lineno, colno, error)
      {
        console.error(error);
        originalOnError.call(window, message, source, lineno, colno, error);
      };
    }, 1000);
  }

  return { installErrorHook: installErrorHook };
});
