(function () {
  try {
    if (!window.__WAI_WD__) {
      window.__WAI_WD__ = { blocked: 0, interceptionWorking: false, held: 0, since: Date.now() };
      document.addEventListener('onReadConfirmationBlocked', function () { window.__WAI_WD__.blocked++; });
      document.addEventListener('onInterceptionWorking', function () { window.__WAI_WD__.interceptionWorking = true; });
    }
    var wd = window.__WAI_WD__;
    try { wd.held = (typeof exceptionsList !== 'undefined' && exceptionsList && exceptionsList.length) || 0; } catch (e) {}
    var st = (window.__WAI__ && window.__WAI__.state) ? window.__WAI__.state() : null;
    var vendorAlive = (typeof window.pako === 'object' && window.pako !== null && typeof window.pako.inflate === 'function') && (typeof window.Pbf === 'function');
    return {
      ok: true, state: st, wd: wd, vendorAlive: vendorAlive,
      hasWai: !!(window.__WAI__ && window.__WAI__.state),
      url: location.href, readyState: document.readyState
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
})()
