;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else if (root && root.WAIPageBus && root.WAIPageBus.__isWaiPageBus) { /* reuse existing instance in realm */ }
  else { root.WAIPageBus = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TO_PAGE_EVENT = 'wai:bridge:to-page';
  var TO_HOST_EVENT = 'wai:bridge:to-host';

  var DOM_OBSERVE_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
    attributeOldValue: true,
  };

  function safeParse(raw) {
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function dispatchBridgeEvent(eventName, channel, payload) {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function' || !document.dispatchEvent) {
      return false;
    }
    try {
      var detail = JSON.stringify({
        channel: String(channel),
        payload: payload === undefined ? null : payload,
      });
      document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function createBridgeRegistry(eventName) {
    var channels = Object.create(null);
    var totalListeners = 0;
    var attached = false;

    function onEvent(ev) {
      var msg = safeParse(ev && ev.detail);
      if (!msg || typeof msg !== 'object' || typeof msg.channel !== 'string') return;
      var list = channels[msg.channel];
      if (!list || list.length === 0) return;
      var snapshot = list.slice();
      for (var i = 0; i < snapshot.length; i++) {
        try {
          snapshot[i](msg.payload, ev);
        } catch (err) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('WAIPageBus handler error (' + msg.channel + '):', err);
          }
        }
      }
    }

    function ensureAttached() {
      if (attached || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
      document.addEventListener(eventName, onEvent);
      attached = true;
    }

    function maybeDetach() {
      if (!attached || totalListeners > 0 || typeof document === 'undefined' || typeof document.removeEventListener !== 'function') return;
      document.removeEventListener(eventName, onEvent);
      attached = false;
    }

    function subscribe(channel, handler) {
      if (typeof handler !== 'function' || !channel) return function () {};
      var key = String(channel);
      if (!channels[key]) channels[key] = [];
      channels[key].push(handler);
      totalListeners++;
      ensureAttached();

      var active = true;
      return function unsubscribe() {
        if (!active) return;
        active = false;
        var arr = channels[key];
        if (!arr) return;
        var idx = arr.indexOf(handler);
        if (idx !== -1) {
          arr.splice(idx, 1);
          totalListeners = Math.max(0, totalListeners - 1);
        }
        if (arr.length === 0) delete channels[key];
        maybeDetach();
      };
    }

    return {
      subscribe: subscribe,
      listenerCount: function () { return totalListeners; },
    };
  }

  var pageRegistry = createBridgeRegistry(TO_PAGE_EVENT);
  var hostRegistry = createBridgeRegistry(TO_HOST_EVENT);

  function sendToPage(channel, payload) {
    return dispatchBridgeEvent(TO_PAGE_EVENT, channel, payload);
  }

  function sendToHost(channel, payload) {
    return dispatchBridgeEvent(TO_HOST_EVENT, channel, payload);
  }

  function onPageMessage(channel, handler) {
    return pageRegistry.subscribe(channel, handler);
  }

  function onHostMessage(channel, handler) {
    return hostRegistry.subscribe(channel, handler);
  }

  function emit(eventName, detail) {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function' || !document.dispatchEvent) {
      return false;
    }
    try {
      if (detail === undefined) {
        document.dispatchEvent(new CustomEvent(eventName));
      } else if (typeof detail === 'string') {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
      } else {
        document.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(detail) }));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function onJson(eventName, handler) {
    if (typeof handler !== 'function' || typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return function () {};
    }
    function listener(ev) {
      var data = safeParse(ev && ev.detail);
      if (data === null && (ev && typeof ev.detail === 'object' && ev.detail !== null)) {
        data = ev.detail;
      }
      if (data === null || data === undefined) return;
      handler(data, ev);
    }
    document.addEventListener(eventName, listener);
    return function () {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener(eventName, listener);
      }
    };
  }

  // Merged body MutationObserver shared across UI modules in the same JS realm
  var domSubscribers = [];
  var sharedObserver = null;
  var waitingForBody = false;

  function dispatchMutations(mutations, obs) {
    if (domSubscribers.length === 0) return;
    var snapshot = domSubscribers.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](mutations, obs);
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('WAIPageBus.DOMObserver handler error:', err);
        }
      }
    }
  }

  function startObservingIfReady() {
    if (sharedObserver || domSubscribers.length === 0) return true;
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return false;
    var target = document.body;
    if (!target) return false;
    sharedObserver = new MutationObserver(dispatchMutations);
    sharedObserver.observe(target, DOM_OBSERVE_OPTIONS);
    return true;
  }

  function ensureObserving() {
    if (startObservingIfReady()) return;
    if (waitingForBody || typeof document === 'undefined') return;
    waitingForBody = true;

    function onReady() {
      waitingForBody = false;
      if (domSubscribers.length > 0) {
        startObservingIfReady();
      }
    }

    if (typeof document.addEventListener === 'function' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else if (typeof setTimeout === 'function') {
      setTimeout(onReady, 20);
    }
  }

  function disconnectDomObserver() {
    domSubscribers.length = 0;
    if (sharedObserver) {
      try { sharedObserver.disconnect(); } catch (e) {}
      sharedObserver = null;
    }
  }

  var DOMObserver = {
    OPTIONS: DOM_OBSERVE_OPTIONS,
    subscribe: function (handler) {
      if (typeof handler !== 'function') return function () {};
      if (domSubscribers.indexOf(handler) === -1) {
        domSubscribers.push(handler);
      }
      ensureObserving();

      var active = true;
      return function unsubscribe() {
        if (!active) return;
        active = false;
        var idx = domSubscribers.indexOf(handler);
        if (idx !== -1) domSubscribers.splice(idx, 1);
        if (domSubscribers.length === 0 && sharedObserver) {
          try { sharedObserver.disconnect(); } catch (e) {}
          sharedObserver = null;
        }
      };
    },
    subscriberCount: function () {
      return domSubscribers.length;
    },
    isObserving: function () {
      return sharedObserver !== null;
    },
    disconnect: disconnectDomObserver,
  };

  return {
    __isWaiPageBus: true,
    TO_PAGE_EVENT: TO_PAGE_EVENT,
    TO_HOST_EVENT: TO_HOST_EVENT,
    sendToPage: sendToPage,
    sendToHost: sendToHost,
    onPageMessage: onPageMessage,
    onHostMessage: onHostMessage,
    emit: emit,
    onJson: onJson,
    DOMObserver: DOMObserver,
  };
});
