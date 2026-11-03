// This is the background page.
// it keeps track of prefrences/settings in localStorage

if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  globalThis.browser = chrome;
}

// TODO: We need to remove this bad code dupliation
browser.runtime.onMessage.addListener(function (messageEvent, sender, callback)
{
    if (messageEvent.name == "setOptions")
    {
        if ("onlineUpdatesHook" in messageEvent)
		{
            chrome.storage.local.set({"onlineUpdatesHook": messageEvent.onlineUpdatesHook});
		}
        if ("typingUpdatesHook" in messageEvent)
		{
            chrome.storage.local.set({"typingUpdatesHook": messageEvent.typingUpdatesHook});
		}
		if ("readConfirmationsHook" in messageEvent)
		{
            chrome.storage.local.set({"readConfirmationsHook": messageEvent.readConfirmationsHook});
		}
		if ("safetyDelay" in messageEvent)
		{
            chrome.storage.local.set({"safetyDelay": messageEvent.safetyDelay});
        }
        if ("showReadWarning" in messageEvent)
        {
            chrome.storage.local.set({"showReadWarning": messageEvent.showReadWarning});
        }
        if ("saveDeletedMsgs" in messageEvent)
        {
            chrome.storage.local.set({"saveDeletedMsgs": messageEvent.saveDeletedMsgs});
        }
        if ("showDeviceTypes" in messageEvent)
        {
            chrome.storage.local.set({"showDeviceTypes": messageEvent.showDeviceTypes});
        }
        if ("autoReceiptOnReplay" in messageEvent)
        {
            chrome.storage.local.set({"autoReceiptOnReplay": messageEvent.autoReceiptOnReplay});
        }
        if ("allowStatusDownload" in messageEvent)
        {
            chrome.storage.local.set({"allowStatusDownload": messageEvent.allowStatusDownload});
        }
        if ("stealthVoiceNotes" in messageEvent)
        {
            chrome.storage.local.set({"stealthVoiceNotes": messageEvent.stealthVoiceNotes});
        }
        if ("mediaAutoDownloadGuard" in messageEvent)
        {
            chrome.storage.local.set({"mediaAutoDownloadGuard": messageEvent.mediaAutoDownloadGuard});
        }
    }
    else if (messageEvent.name == "getOptions")
    {
        // these are the default values. we will update them according to the storage
		var onlineUpdatesHook = false;
        var typingUpdatesHook = false;
        var readConfirmationsHook = true;
        var showReadWarning = true;
		var safetyDelay = 0;
        // On by default: without it core/node_handler.js returns before it ever sees a
        // REVOKE, so deleted messages are never captured and "restore deleted messages"
        // silently does nothing. Both the browser extension and the Electron build derive
        // their default from this literal (scripts/build.mjs deriveDefaults), so this is
        // the single switch for the feature.
        var saveDeletedMsgs = true;
        var showDeviceTypes = true;
        var autoReceiptOnReplay = true;
        var allowStatusDownload = true;
        var stealthVoiceNotes = false;
        var mediaAutoDownloadGuard = false;
        var privacyScreenLockEnabled = false;
        var privacyScreenLockPIN = "";
        var privacyScreenLockIdleMinutes = 5;

        chrome.storage.local.get(['onlineUpdatesHook',
                                'typingUpdatesHook',
                                'readConfirmationsHook', 
                                'showReadWarning', 
                                'safetyDelay', 
                                'saveDeletedMsgs', 
                                'showDeviceTypes',
                                'autoReceiptOnReplay',
                                'allowStatusDownload',
                                'stealthVoiceNotes',
                                'mediaAutoDownloadGuard',
                                'privacyScreenLockEnabled',
                                'privacyScreenLockPIN',
                                'privacyScreenLockIdleMinutes']).then(function(storage)
        {
            if (storage["onlineUpdatesHook"] != undefined)
            {
                onlineUpdatesHook = storage["onlineUpdatesHook"];
            }
            if (storage["typingUpdatesHook"] != undefined)
            {
                typingUpdatesHook = storage["typingUpdatesHook"];
            }
            if (storage["readConfirmationsHook"] != undefined)
            {
                readConfirmationsHook = storage["readConfirmationsHook"];
            }
            if (storage["showReadWarning"] != undefined)
            {
                showReadWarning = storage["showReadWarning"];
            }
            if (storage["safetyDelay"] != undefined)
            {
                safetyDelay = storage["safetyDelay"];
            }
            if (storage["saveDeletedMsgs"] != undefined)
            {
                saveDeletedMsgs = storage["saveDeletedMsgs"];
            }
            if (storage["showDeviceTypes"] != undefined)
            {
                showDeviceTypes = storage["showDeviceTypes"];
            }
            if (storage["autoReceiptOnReplay"] != undefined)
            {
                autoReceiptOnReplay = storage["autoReceiptOnReplay"];
            }
            if (storage["allowStatusDownload"] != undefined)
            {
                allowStatusDownload = storage["allowStatusDownload"];
            }
            if (storage["stealthVoiceNotes"] != undefined)
            {
                stealthVoiceNotes = storage["stealthVoiceNotes"];
            }
            if (storage["mediaAutoDownloadGuard"] != undefined)
            {
                mediaAutoDownloadGuard = storage["mediaAutoDownloadGuard"];
            }
            if (storage["privacyScreenLockEnabled"] != undefined)
            {
                privacyScreenLockEnabled = storage["privacyScreenLockEnabled"];
            }
            if (storage["privacyScreenLockPIN"] != undefined)
            {
                privacyScreenLockPIN = storage["privacyScreenLockPIN"];
            }
            if (storage["privacyScreenLockIdleMinutes"] != undefined)
            {
                privacyScreenLockIdleMinutes = storage["privacyScreenLockIdleMinutes"];
            }
            callback(
            {
                onlineUpdatesHook: onlineUpdatesHook,
                typingUpdatesHook: typingUpdatesHook,
                readConfirmationsHook: readConfirmationsHook,
                showReadWarning: showReadWarning,
                safetyDelay: safetyDelay,
                saveDeletedMsgs: saveDeletedMsgs,
                showDeviceTypes: showDeviceTypes,
                autoReceiptOnReplay: autoReceiptOnReplay,
                allowStatusDownload: allowStatusDownload,
                stealthVoiceNotes: stealthVoiceNotes,
                mediaAutoDownloadGuard: mediaAutoDownloadGuard,
                privacyScreenLockEnabled: privacyScreenLockEnabled,
                privacyScreenLockPIN: privacyScreenLockPIN,
                privacyScreenLockIdleMinutes: privacyScreenLockIdleMinutes
            });
        });   
    }
    else if (messageEvent.name == "getContactWhitelist")
    {
        chrome.storage.local.get(['contact_whitelist_rules']).then(function(storage)
        {
            callback(storage["contact_whitelist_rules"] || {});
        });
        return true;
    }
    else if (messageEvent.name == "setContactWhitelistRule")
    {
        chrome.storage.local.get(['contact_whitelist_rules']).then(function(storage)
        {
            var rules = storage["contact_whitelist_rules"] || {};
            var jid = messageEvent.jid;
            var rule = messageEvent.rule;
            if (rule === "default") {
                delete rules[jid];
            } else {
                rules[jid] = rule;
            }
            chrome.storage.local.set({"contact_whitelist_rules": rules}).then(function() {
                callback(rules);
            });
        });
        return true;
    }
    
    return true;
});

browser.action.onClicked.addListener(function(activeTab)
{
    var newURL = "https://web.whatsapp.com";
    browser.tabs.create({ url: newURL });
});

// Scheduled message outbox (HAG-64)
if (typeof chrome !== "undefined" && chrome.alarms && chrome.alarms.create) {
    try { chrome.alarms.create("scheduled-message-check", { periodInMinutes: 1 }); } catch (e) {}
    chrome.alarms.onAlarm.addListener(function(alarm) {
        if (!alarm || alarm.name !== "scheduled-message-check") return;
        chrome.storage.local.get("scheduled_messages").then(function(res) {
            var queue = res && res.scheduled_messages ? res.scheduled_messages : [];
            var now = Date.now();
            var changed = false;
            queue.forEach(function(q) {
                if (q && q.status === "pending" && q.scheduled_timestamp <= now) {
                    chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, function(tabs) {
                        (tabs || []).forEach(function(t) {
                            try { chrome.tabs.sendMessage(t.id, { name: "sendScheduled", item: q }); } catch (e) {}
                        });
                    });
                    q.status = "sent";
                    q.sent_at = now;
                    changed = true;
                }
            });
            if (changed) chrome.storage.local.set({ scheduled_messages: queue });
        });
    });
}
