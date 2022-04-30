// This is the background page.
// it keeps track of prefrences/settings in localStorage

if (typeof chrome !== "undefined") {
  var browser = chrome;
}

browser.runtime.onMessage.addListener(function (messageEvent, sender, callback)
{
    if (messageEvent.name == "setOptions")
    {
        if ("presenceUpdatesHook" in messageEvent)
		{
            chrome.storage.local.set({"presenceUpdatesHook": messageEvent.presenceUpdatesHook});
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
    }
    else if (messageEvent.name == "getOptions")
    {
        // these are the default values. we will update them according to the storage
		var presenceUpdatesHook = true;
        var readConfirmationsHook = true;
        var showReadWarning = true;
		var safetyDelay = 0;
        var saveDeletedMsgs = false;

        chrome.storage.local.get(['presenceUpdatesHook', 'readConfirmationsHook', 'showReadWarning', 'safetyDelay', 'saveDeletedMsgs']).then(function(storage)
        {
            if (storage["presenceUpdatesHook"] != undefined)
            {
                presenceUpdatesHook = storage["presenceUpdatesHook"];
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
            callback(
            {
                presenceUpdatesHook: presenceUpdatesHook,
                readConfirmationsHook: readConfirmationsHook,
                showReadWarning: showReadWarning,
                safetyDelay: safetyDelay,
                saveDeletedMsgs: saveDeletedMsgs
            });
        });   
    }
    
    return true;
});

browser.action.onClicked.addListener(function(activeTab)
{
    var newURL = "https://web.whatsapp.com";
    browser.tabs.create({ url: newURL });
});
