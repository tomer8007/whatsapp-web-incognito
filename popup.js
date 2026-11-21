(function () {
  'use strict';

  var ext = typeof browser !== 'undefined' ? browser : chrome;
  var WHATSAPP_URL = 'https://web.whatsapp.com/';
  var WHATSAPP_PATTERN = 'https://web.whatsapp.com/*';
  var rootEl = document.getElementById('wai-popup-root');
  var renderer = null;
  var activeWaTab = null;

  function sendRuntimeMessage(payload) {
    return new Promise(function (resolve) {
      try {
        var maybe = ext.runtime.sendMessage(payload, function (res) {
          resolve(res || null);
        });
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(function (res) { resolve(res || null); }, function () { resolve(null); });
        }
      } catch (e) {
        try {
          Promise.resolve(ext.runtime.sendMessage(payload)).then(
            function (res) { resolve(res || null); },
            function () { resolve(null); }
          );
        } catch (e2) {
          resolve(null);
        }
      }
    });
  }

  function queryWhatsAppTabs() {
    return new Promise(function (resolve) {
      if (!ext.tabs || typeof ext.tabs.query !== 'function') {
        resolve([]);
        return;
      }
      try {
        var maybe = ext.tabs.query({ url: WHATSAPP_PATTERN }, function (tabs) {
          resolve(Array.isArray(tabs) ? tabs : []);
        });
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(
            function (tabs) { resolve(Array.isArray(tabs) ? tabs : []); },
            function () { resolve([]); }
          );
        }
      } catch (e) {
        try {
          Promise.resolve(ext.tabs.query({ url: WHATSAPP_PATTERN })).then(
            function (tabs) { resolve(Array.isArray(tabs) ? tabs : []); },
            function () { resolve([]); }
          );
        } catch (e2) {
          resolve([]);
        }
      }
    });
  }

  function openOrSwitchWhatsApp() {
    if (!ext.tabs) return;
    if (activeWaTab && activeWaTab.id !== undefined) {
      try {
        ext.tabs.update(activeWaTab.id, { active: true });
        if (ext.windows && activeWaTab.windowId !== undefined) {
          ext.windows.update(activeWaTab.windowId, { focused: true });
        }
        window.close();
        return;
      } catch (e) {}
    }
    try {
      ext.tabs.create({ url: WHATSAPP_URL });
      window.close();
    } catch (e) {}
  }

  function buildStatusObject(tabs) {
    if (Array.isArray(tabs) && tabs.length > 0) {
      activeWaTab = tabs.find(function (t) { return t && t.active; }) || tabs[0];
      return {
        text: 'WhatsApp Web open (' + tabs.length + ' tab' + (tabs.length > 1 ? 's' : '') + ')',
        tone: 'ok',
        actionLabel: 'Switch to WhatsApp Web',
        onAction: openOrSwitchWhatsApp,
      };
    }
    activeWaTab = null;
    return {
      text: 'WhatsApp Web is not open in any tab',
      tone: 'warn',
      actionLabel: 'Open WhatsApp Web',
      onAction: openOrSwitchWhatsApp,
    };
  }

  function onMessage(msg) {
    if (!renderer || !msg || typeof msg !== 'object') return;
    if (msg.name === 'wai:optionsUpdated' && msg.options) {
      renderer.update(msg.options);
    }
  }

  function boot() {
    if (!rootEl || typeof WAISettingsSchema === 'undefined' || typeof WAISettingsRenderer === 'undefined') {
      return;
    }

    Promise.all([
      sendRuntimeMessage({ name: 'getOptions' }),
      queryWhatsAppTabs(),
    ]).then(function (results) {
      var prefs = results[0] || WAISettingsSchema.defaults('shared');
      var tabs = results[1] || [];

      renderer = WAISettingsRenderer.mount(rootEl, {
        prefs: prefs,
        scope: 'shared',
        schema: WAISettingsSchema,
        title: 'WAIncognito Settings',
        status: buildStatusObject(tabs),
        onChange: function (patch) {
          sendRuntimeMessage(Object.assign({ name: 'setOptions' }, patch)).then(function (reply) {
            if (renderer && reply && reply.options) {
              renderer.update(reply.options);
            }
          });
        },
        onReset: function () {
          sendRuntimeMessage({ name: 'resetOptions' }).then(function (reply) {
            if (renderer && reply) {
              renderer.update(reply);
            }
          });
        },
      });
    });

    if (ext.runtime && ext.runtime.onMessage && typeof ext.runtime.onMessage.addListener === 'function') {
      ext.runtime.onMessage.addListener(onMessage);
    }
  }

  window.addEventListener('unload', function () {
    if (renderer) {
      renderer.destroy();
      renderer = null;
    }
    try {
      if (ext.runtime && ext.runtime.onMessage && typeof ext.runtime.onMessage.removeListener === 'function') {
        ext.runtime.onMessage.removeListener(onMessage);
      }
    } catch (e) {}
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
