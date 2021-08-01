// This is the background page.
// it keeps track of prefrences/settings in localStorage

if (typeof chrome !== "undefined") {
  var browser = chrome;
}

browser.runtime.onMessage.addListener(onMessage);

function onMessage(messageEvent, sender, callback)
{
    if (messageEvent.name == "setOptions")
    {
        if ("presenceUpdatesHook" in messageEvent)
		{
			localStorage["presenceUpdatesHook"] = messageEvent.presenceUpdatesHook;
		}
		if ("readConfirmationsHook" in messageEvent)
		{
			localStorage["readConfirmationsHook"] = messageEvent.readConfirmationsHook;
		}
		if ("safetyDelay" in messageEvent)
		{
			localStorage["safetyDelay"] = messageEvent.safetyDelay;
        }
        if ("showReadWarning" in messageEvent)
        {
            localStorage["showReadWarning"] = messageEvent.showReadWarning;
        }
        if ("saveDeletedMsgs" in messageEvent)
        {
            localStorage["saveDeletedMsgs"] = messageEvent.saveDeletedMsgs;
        }
    }
    else if (messageEvent.name == "getOptions")
    {
		var presenceUpdatesHook = true;
        var readConfirmationsHook = true;
        var showReadWarning = false;
		var safetyDelay = 0;
        var saveDeletedMsgs = false
        if (localStorage["presenceUpdatesHook"] == "true" || localStorage["presenceUpdatesHook"] == "false")
        {
            presenceUpdatesHook = localStorage["presenceUpdatesHook"] == "true";
        }
        if (localStorage["readConfirmationsHook"] == "true" || localStorage["readConfirmationsHook"] == "false")
        {
            readConfirmationsHook = localStorage["readConfirmationsHook"] == "true";
        }
        if (localStorage["showReadWarning"] == "true" || localStorage["showReadWarning"] == "false")
        {
            showReadWarning = localStorage["showReadWarning"] == "true";
        }
		if (localStorage["safetyDelay"] != undefined && localStorage["safetyDelay"] != null)
		{
			safetyDelay = localStorage["safetyDelay"];
		}
        if (localStorage["saveDeletedMsgs"] != undefined && localStorage["saveDeletedMsgs"] != null)
		{
			saveDeletedMsgs = localStorage["saveDeletedMsgs"];
		}
        callback(
        {
            presenceUpdatesHook: presenceUpdatesHook,
            readConfirmationsHook: readConfirmationsHook,
            showReadWarning: showReadWarning,
			safetyDelay: safetyDelay,
            saveDeletedMsgs: saveDeletedMsgs
        });
    }
}

browser.browserAction.onClicked.addListener(function(activeTab)
{
    var newURL = "https://web.whatsapp.com";
    browser.tabs.create({ url: newURL });
});
