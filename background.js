// Background script / Chrome MV3 Service Worker
// Persists preferences, per-contact whitelist rules, and ephemeral notes.

if (typeof chrome !== 'undefined' && typeof browser === 'undefined') {
  globalThis.browser = chrome;
}

if (
  typeof importScripts === 'function' &&
  (typeof WAIJidUtils === 'undefined' || typeof WAISettingsSchema === 'undefined')
) {
  importScripts('shared/jid_utils.js', 'shared/settings_schema.js');
}

(function () {
  'use strict';

  var runtimeApi = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : chrome.runtime;
  var storageApi = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
    ? chrome.storage.local
    : ((typeof browser !== 'undefined' && browser.storage && browser.storage.local) ? browser.storage.local : null);
  var tabsApi = (typeof chrome !== 'undefined' && chrome.tabs)
    ? chrome.tabs
    : ((typeof browser !== 'undefined' && browser.tabs) ? browser.tabs : null);

  var SHARED_KEYS = WAISettingsSchema.allKeys('shared');
  var SHARED_DEFAULTS = WAISettingsSchema.defaults('shared');

  function resolveStoredOptions(storage) {
    var base = Object.assign({}, SHARED_DEFAULTS);
    if (!storage || typeof storage !== 'object') return base;
    for (var i = 0; i < SHARED_KEYS.length; i++) {
      var key = SHARED_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(storage, key) || storage[key] === undefined) continue;
      var coerced = WAISettingsSchema.coerceSetting(key, storage[key], base[key]);
      if (coerced !== undefined) base[key] = coerced;
    }
    return base;
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      if (!storageApi || typeof storageApi.get !== 'function') {
        resolve({});
        return;
      }
      try {
        var maybePromise = storageApi.get(keys, function (res) {
          resolve(res || {});
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(function (res) { resolve(res || {}); }, function () { resolve({}); });
        }
      } catch (e) {
        Promise.resolve(storageApi.get(keys)).then(function (res) { resolve(res || {}); }, function () { resolve({}); });
      }
    });
  }

  function storageSet(values) {
    return new Promise(function (resolve) {
      if (!storageApi || typeof storageApi.set !== 'function') {
        resolve();
        return;
      }
      try {
        var maybePromise = storageApi.set(values, function () { resolve(); });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(function () { resolve(); }, function () { resolve(); });
        }
      } catch (e) {
        Promise.resolve(storageApi.set(values)).then(function () { resolve(); }, function () { resolve(); });
      }
    });
  }

  function notifyWhatsAppTabs(payload, excludeTabId) {
    if (!tabsApi || typeof tabsApi.query !== 'function' || typeof tabsApi.sendMessage !== 'function') return;
    try {
      tabsApi.query({ url: 'https://web.whatsapp.com/*' }, function (tabs) {
        if (!Array.isArray(tabs)) return;
        for (var i = 0; i < tabs.length; i++) {
          var t = tabs[i];
          if (!t || t.id === undefined || t.id === excludeTabId) continue;
          try {
            var p = tabsApi.sendMessage(t.id, payload);
            if (p && typeof p.catch === 'function') p.catch(function () {});
          } catch (e) {}
        }
      });
    } catch (e) {}
  }

  runtimeApi.onMessage.addListener(function (messageEvent, sender, callback) {
    if (!messageEvent || typeof messageEvent !== 'object') return false;
    var senderTabId = sender && sender.tab && sender.tab.id !== undefined ? sender.tab.id : undefined;

    if (messageEvent.name === 'setOptions') {
      storageGet(SHARED_KEYS).then(function (storage) {
        var current = resolveStoredOptions(storage);
        var patchInput = {};
        for (var k in messageEvent) {
          if (k !== 'name' && Object.prototype.hasOwnProperty.call(messageEvent, k)) {
            patchInput[k] = messageEvent[k];
          }
        }
        var result = WAISettingsSchema.validatePatch(patchInput, current, 'shared');
        var finish = function () {
          if (result.applied.length > 0) {
            notifyWhatsAppTabs({
              name: 'wai:optionsUpdated',
              options: result.prefs,
              patch: result.patch,
            }, senderTabId);
          }
          callback({ ok: true, options: result.prefs, applied: result.applied, rejected: result.rejected });
        };
        if (result.applied.length > 0) {
          storageSet(result.patch).then(finish);
        } else {
          finish();
        }
      });
      return true;
    }

    if (messageEvent.name === 'getOptions') {
      storageGet(SHARED_KEYS).then(function (storage) {
        callback(resolveStoredOptions(storage));
      });
      return true;
    }

    if (messageEvent.name === 'resetOptions') {
      var resetObj = Object.assign({}, SHARED_DEFAULTS);
      storageSet(resetObj).then(function () {
        notifyWhatsAppTabs({
          name: 'wai:optionsUpdated',
          options: resetObj,
          patch: resetObj,
        }, senderTabId);
        callback(resetObj);
      });
      return true;
    }

    if (messageEvent.name === 'getInitialState') {
      storageGet(SHARED_KEYS.concat(['contact_whitelist_rules', 'ephemeral_notes'])).then(function (storage) {
        callback({
          options: resolveStoredOptions(storage),
          contactWhitelistRules: (storage && storage.contact_whitelist_rules) || {},
          ephemeralNotes: (storage && storage.ephemeral_notes) || {},
        });
      });
      return true;
    }

    if (messageEvent.name === 'getContactWhitelist') {
      storageGet(['contact_whitelist_rules']).then(function (storage) {
        callback((storage && storage.contact_whitelist_rules) || {});
      });
      return true;
    }

    if (messageEvent.name === 'setContactWhitelistRule') {
      storageGet(['contact_whitelist_rules']).then(function (storage) {
        var rules = Object.assign({}, (storage && storage.contact_whitelist_rules) || {});
        var jid = WAIJidUtils.normalizeJid(messageEvent.jid);
        var rule = messageEvent.rule;
        if (jid && (rule === 'always' || rule === 'never' || rule === 'default')) {
          if (rule === 'default') {
            delete rules[jid];
          } else {
            rules[jid] = rule;
          }
          storageSet({ contact_whitelist_rules: rules }).then(function () {
            notifyWhatsAppTabs({ name: 'wai:whitelistUpdated', rules: rules }, senderTabId);
            callback(rules);
          });
        } else {
          callback(rules);
        }
      });
      return true;
    }

    if (messageEvent.name === 'getEphemeralNotes') {
      storageGet(['ephemeral_notes']).then(function (storage) {
        callback((storage && storage.ephemeral_notes) || {});
      });
      return true;
    }

    if (messageEvent.name === 'setEphemeralNote') {
      storageGet(['ephemeral_notes']).then(function (storage) {
        var notes = Object.assign({}, (storage && storage.ephemeral_notes) || {});
        var jid = WAIJidUtils.normalizeJid(messageEvent.jid);
        if (jid) {
          if (messageEvent.note === null || messageEvent.note === undefined || messageEvent.note === '') {
            delete notes[jid];
          } else {
            notes[jid] = String(messageEvent.note);
          }
        }
        storageSet({ ephemeral_notes: notes }).then(function () {
          notifyWhatsAppTabs({ name: 'wai:notesUpdated', notes: notes }, senderTabId);
          callback(notes);
        });
      });
      return true;
    }

    if (messageEvent.name === 'deleteEphemeralNote') {
      storageGet(['ephemeral_notes']).then(function (storage) {
        var notes = Object.assign({}, (storage && storage.ephemeral_notes) || {});
        var jid = WAIJidUtils.normalizeJid(messageEvent.jid);
        if (jid) delete notes[jid];
        storageSet({ ephemeral_notes: notes }).then(function () {
          notifyWhatsAppTabs({ name: 'wai:notesUpdated', notes: notes }, senderTabId);
          callback(notes);
        });
      });
      return true;
    }

    if (messageEvent.name === 'clearEphemeralNotes') {
      storageSet({ ephemeral_notes: {} }).then(function () {
        notifyWhatsAppTabs({ name: 'wai:notesUpdated', notes: {} }, senderTabId);
        callback({});
      });
      return true;
    }

    return false;
  });

  // Fallback click handler only when no default_popup is configured
  try {
    var manifestData = runtimeApi && typeof runtimeApi.getManifest === 'function' ? runtimeApi.getManifest() : null;
    var hasPopup = Boolean(manifestData && manifestData.action && manifestData.action.default_popup);
    if (!hasPopup && typeof browser !== 'undefined' && browser.action && browser.action.onClicked && tabsApi) {
      browser.action.onClicked.addListener(function () {
        tabsApi.create({ url: 'https://web.whatsapp.com' });
      });
    }
  } catch (e) {}

  // Scheduled message outbox (HAG-64): only mark sent when a live tab explicitly acknowledges execution.
  if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.create && tabsApi) {
    try { chrome.alarms.create('scheduled-message-check', { periodInMinutes: 1 }); } catch (e) {}
    chrome.alarms.onAlarm.addListener(function (alarm) {
      if (!alarm || alarm.name !== 'scheduled-message-check') return;
      storageGet(['scheduled_messages']).then(function (res) {
        var queue = Array.isArray(res && res.scheduled_messages) ? res.scheduled_messages : [];
        if (!queue.length) return;
        var now = Date.now();
        var due = queue.filter(function (q) { return q && q.status === 'pending' && q.scheduled_timestamp <= now; });
        if (!due.length) return;

        tabsApi.query({ url: 'https://web.whatsapp.com/*' }, function (tabs) {
          if (!Array.isArray(tabs) || tabs.length === 0) return;
          var targetTab = tabs.find(function (t) { return t && t.active; }) || tabs[0];
          if (!targetTab || targetTab.id === undefined) return;

          var pendingAck = due.length;
          var changed = false;
          due.forEach(function (item) {
            try {
              tabsApi.sendMessage(targetTab.id, { name: 'sendScheduled', item: item }, function (reply) {
                var lastErr = runtimeApi && runtimeApi.lastError;
                if (!lastErr && reply && reply.ok === true) {
                  item.status = 'sent';
                  item.sent_at = Date.now();
                  changed = true;
                }
                pendingAck--;
                if (pendingAck === 0 && changed) {
                  storageSet({ scheduled_messages: queue });
                }
              });
            } catch (e) {
              pendingAck--;
            }
          });
        });
      });
    });
  }
})();
