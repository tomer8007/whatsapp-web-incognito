(function () {
  if (window.__WAI_DIAG__) return;
  window.__WAI_DIAG__ = { errors: 0, rejections: 0, console: 0 };
  var emit = function (kind, args) {
    window.__WAI_DIAG__[kind]++;
    try {
      if (window.__WAI_IPC__ && window.__WAI_IPC__.reportFailure) {
        window.__WAI_IPC__.reportFailure('uncaught ' + kind, String(args[0] || args));
      }
    } catch (e) {}
  };
  window.addEventListener('error', function (e) { emit('errors', [e && e.message]); });
  window.addEventListener('unhandledrejection', function (e) { emit('rejections', [e && e.reason]); });
  if (window.__WAI_LOG_PAGE__) {
    ['log', 'info', 'warn', 'error'].forEach(function (k) {
      var orig = console[k];
      console[k] = function () {
        try {
          if (window.__WAI_IPC__ && window.__WAI_IPC__.log) {
            window.__WAI_IPC__.log.apply(null, [k].concat(Array.prototype.slice.call(arguments)));
          }
        } catch (e) {}
        return orig.apply(console, arguments);
      };
    });
  }
})();
