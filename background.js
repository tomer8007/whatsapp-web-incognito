// This is the background service worker.
// It keeps track of the preferences/settings in chrome.storage.local.

if (typeof chrome !== "undefined") {
  var browser = chrome;
}

importScripts("core/options_schema.js", "core/contact_rules.js");

// Default value of every option (from the shared schema). Stored values override these.
const DEFAULT_OPTIONS = defaultOptions();

browser.runtime.onMessage.addListener(function (messageEvent, sender, callback)
{
    if (messageEvent.name == "setOptions")
    {
        var toStore = {};
        for (var key of Object.keys(DEFAULT_OPTIONS))
        {
            if (key in messageEvent) toStore[key] = messageEvent[key];
        }
        if (Object.keys(toStore).length > 0) chrome.storage.local.set(toStore);
    }
    else if (messageEvent.name == "getContactRules")
    {
        chrome.storage.local.get(["contactRules"]).then(function(storage)
        {
            callback(storage.contactRules || {});
        });
    }
    else if (messageEvent.name == "setContactRule")
    {
        chrome.storage.local.get(["contactRules"]).then(async function(storage)
        {
            var rules = applyContactRule(storage.contactRules || {}, messageEvent.jid, messageEvent.field, messageEvent.value);
            await chrome.storage.local.set({ contactRules: rules });
            callback(rules);
        });
    }
    else if (messageEvent.name == "clearContactRules")
    {
        chrome.storage.local.get(["contactRules"]).then(async function(storage)
        {
            var rules = clearContactRules(storage.contactRules || {}, messageEvent.jids || []);
            await chrome.storage.local.set({ contactRules: rules });
            callback(rules);
        });
    }
    else if (messageEvent.name == "getOptions")
    {
        chrome.storage.local.get(Object.keys(DEFAULT_OPTIONS)).then(function(storage)
        {
            var options = {};
            for (var key of Object.keys(DEFAULT_OPTIONS))
            {
                options[key] = storage[key] != undefined ? storage[key] : DEFAULT_OPTIONS[key];
            }
            callback(options);
        });
    }

    return true;
});

browser.action.onClicked.addListener(function(activeTab)
{
    browser.tabs.create({ url: "https://web.whatsapp.com" });
});
