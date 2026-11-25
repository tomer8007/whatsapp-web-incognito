(function () {
  if (window.__WAI_NOTIF_PATCHED__) return;
  window.__WAI_NOTIF_PATCHED__ = true;
  var _OriginalNotification = window.Notification;

  var _lastTag = null;
  var _lastTagAt = 0;
  var TAG_TTL = 5000;

  function relay(title, options) {
    options = options || {};
    var tag = options.tag || '';
    if (tag) {
      var now = Date.now();
      if (tag === _lastTag && (now - _lastTagAt) < TAG_TTL) return;
      _lastTag = tag;
      _lastTagAt = now;
    }
    try {
      if (window.__WAI_IPC__ && window.__WAI_IPC__.sendNotification) {
        window.__WAI_IPC__.sendNotification({
          title: title || 'Whatsapp Incognito',
          body: options.body || '',
          iconUrl: options.icon || '',
          silent: options.silent === true,
          tag: tag,
        });
      }
    } catch (e) {}
  }

  window.Notification = function (title, options) {
    relay(title, options);
    var target = (typeof EventTarget !== 'undefined') ? new EventTarget() : {};
    target.title = title || '';
    target.close = function () {};
    target.onclick = null;
    target.onerror = null;
    target.onclose = null;
    target.onshow = null;
    if (typeof target.addEventListener !== 'function') {
      target.addEventListener = function () {};
      target.removeEventListener = function () {};
      target.dispatchEvent = function () { return true; };
    }
    return target;
  };
  window.Notification.requestPermission = function () { return Promise.resolve('granted'); };
  Object.defineProperty(window.Notification, 'permission', {
    get: function () { return 'granted'; },
    configurable: true,
  });
  if (_OriginalNotification) window.Notification.prototype = _OriginalNotification.prototype;

  if ('ServiceWorkerRegistration' in window && ServiceWorkerRegistration.prototype.showNotification) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      relay(title, options);
      return Promise.resolve();
    };
  }
})();
