// This is the background service worker.
// It keeps track of the preferences/settings in chrome.storage.local.

if (typeof chrome !== "undefined") {
  var browser = chrome;
}

importScripts("core/options_schema.js");

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
