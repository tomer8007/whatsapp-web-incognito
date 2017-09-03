// this is the background page!
chrome.runtime.onMessage.addListener(onMessage);

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
    }
    else if (messageEvent.name == "getOptions")
    {
		var presenceUpdatesHook = true;
		var readConfirmationsHook = true;
		var safetyDelay = 0;
        if (localStorage["presenceUpdatesHook"] == "true" || localStorage["presenceUpdatesHook"] == "false")
        {
            presenceUpdatesHook = localStorage["presenceUpdatesHook"] == "true";
        }
        if (localStorage["readConfirmationsHook"] == "true" || localStorage["readConfirmationsHook"] == "false")
        {
            readConfirmationsHook = localStorage["readConfirmationsHook"] == "true";
        }
		if (localStorage["safetyDelay"] != undefined && localStorage["safetyDelay"] != null)
		{
			safetyDelay = localStorage["safetyDelay"];
		}
        callback(
        {
            presenceUpdatesHook: presenceUpdatesHook,
            readConfirmationsHook: readConfirmationsHook,
			safetyDelay: safetyDelay
        });
    }
}

chrome.browserAction.onClicked.addListener(function(activeTab)
{
    var newURL = "https://web.whatsapp.com";
    chrome.tabs.create({ url: newURL });
});