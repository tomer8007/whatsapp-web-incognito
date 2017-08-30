// Main
// Actual interception

var readConfirmationsHookEnabled = true;
var presenceUpdatesHookEnabled = true;
var WAdebugMode = false;
var isInitializing = true;
var exceptionsList = [];

wsHook.before = function(originalData, url) 
{
	var payload = WACrypto.parseWebSocketPayload(originalData);
	var tag = payload.tag;
	var data = payload.data;
	
	return new Promise(function(resolve, reject)
	{
		if (!(data instanceof ArrayBuffer))
		{
			if (WAdebugMode) console.log("[Out] Sent message with tag '" + tag +"':");
			if (data != "" && WAdebugMode) console.log(data);
			resolve(originalData);
		}
		else
		{
			WACrypto.decryptWithWebCrypto(data).then(function(decrypted)
			{
				if (WAdebugMode) console.log("[Out] Sent binary with tag '" + tag + "' (" + decrypted.byteLength + " bytes, decrypted): ");
				
				var nodeParser = new NodeParser();
				var node = nodeParser.readNode(new NodeBinaryReader(decrypted));
				if (WAdebugMode) console.log(node);
				if (isInitializing)
				{
					isInitializing = false;
					console.log("WhatsAppIncognito: Interception is working.");
					document.dispatchEvent(new CustomEvent('isInterceptionWorking', {detail: true}));
				}
				
				var isAllowed = handler.handleSentNode(node, tag);
				if (isAllowed) resolve(originalData);
				else resolve(null);
			});
		}
	});
}

wsHook.after = function(messageEvent, url) 
{
	var payload = WACrypto.parseWebSocketPayload(messageEvent.data);
	var tag = payload.tag;
	var data = payload.data;
	
    if (!(data instanceof ArrayBuffer))
	{
    	if (WAdebugMode) console.log("[In] Received message with tag '" + tag +"':");
		if (data != "" && WAdebugMode)
			console.log(data);
	}
	else
	{
		 WACrypto.decryptWithWebCrypto(data).then(function(decrypted)
		 {		 
			 if (WAdebugMode) console.log("[In] Received binary with tag '" + tag + "' (" +  decrypted.byteLength + " bytes, decrypted)): ");
			 
			 var nodeParser = new NodeParser();
			 var node = nodeParser.readNode(new NodeBinaryReader(decrypted));
			 if (WAdebugMode) console.log(node);
			 handler.handleReceivedNode(node);
		 });
	}
}

document.addEventListener('onOptionsUpdate', function(e) {
	var options = JSON.parse(e.detail);
   	if ('readConfirmationsHook' in options) readConfirmationsHookEnabled = options.readConfirmationsHook;
   	if ('presenceUpdatesHook' in options) presenceUpdatesHookEnabled = options.presenceUpdatesHook;
	
	if (readConfirmationsHookEnabled) getCSSRule('.unread-count').style.backgroundColor = 'rgba(9, 210, 97, 0.3)';
	else getCSSRule('.unread-count').style.backgroundColor = 'rgba(9, 210, 97, 1)';
	
	if ('readConfirmationsHook' in options)
	{
		var unreadCounters = document.getElementsByClassName("icon-meta unread-count");
		for (var i=0;i<unreadCounters.length;i++)
		{
			unreadCounters[i].className = "icon-meta unread-count";
		}
	}
});

document.addEventListener('onReadConfirmationBlocked', function(e) {
	var blockedJid = e.detail;
    var chatsShown = document.getElementsByClassName("unread chat");
	for (var i=0;i<chatsShown.length;i++)
	{
		var id = FindReact(chatsShown[i]).props.id;
		if (id == blockedJid)
		{
			chatsShown[i].getElementsByClassName("icon-meta unread-count")[0].className += " incognito";
		}
	}
});

document.addEventListener('onDropdownOpened', function(e) {
	var menuItems = document.getElementsByClassName("dropdown")[0].getElementsByClassName("menu-horizontal-item");
	var reactMenuItems = FindReact(document.getElementsByClassName("dropdown")[0]).props.children[0].props.children;
	var markAsReadButton = null;
	var props = null;
	for (var i=0;i<reactMenuItems.length;i++)
	{
		if (reactMenuItems[i].key == "mark_unread")
		{
			markAsReadButton = menuItems[i];
			props = reactMenuItems[i].props;
			break;
		}
	}
	if (props != null)
	{
		var name = props.chat.name;
		var jid = props.chat.id;
		var lastMessageIndex = props.chat.lastReceivedKey.id;
		var unreadCount = props.chat.unreadCount;
		var isGroup = props.chat.isGroup;
		if (unreadCount > 0)
		{
			// this is mark-as-read button, not mark-as-unread
			markAsReadButton.addEventListener("mousedown", function(e) 
			{
				var data = {name: name, jid: jid, lastMessageInde: lastMessageIndex, unreadCount: unreadCount, isGroup: isGroup};
				document.dispatchEvent(new CustomEvent('onMarkAsReadClick', {detail: JSON.stringify(data)}));
			});
		}
	}
});

document.addEventListener('sendReadConfirmation', function(e)
{
	var data = JSON.parse(e.detail);
	var t = {id: data.index, fromMe: false, participant: null};
	exceptionsList.push(data.jid + data.index);
	Store.Wap.sendConversationSeen(data.jid, t, data.count, false);
	
	//var node = ["action",{"type":"set","epoch":"30"},[["read",{"jid":data.jid,"index":data.index,"owner":"false","count":data.unreadCount.toString()},null]]];
	//WACrypto.sendNode(node);
});

var handler = {};

(function() {
	
var messages = [];
var isScrappingMessages = false;
var epoch = 8;

handler.scrapMessages = function(jid, index, count)
{
	messages = [];
	var startNode = ["query",{"type":"message","kind":"before","jid":jid,"count":count.toString(),"index":index,"owner":"true","epoch":(epoch++).toString()},null];
	WACrypto.sendNode(startNode);
	isScrappingMessages = true;
}

handler.handleSentNode = function(node, tag)
{
	try
	{
		if (nodeReader.tag(node) == "action")
		{
			var arr = node[2];
			if (Array.isArray(arr))
			{
				for (var n = arr.length, o = 0; o < n; o++) 
				{
					var action = arr[o][0];
					var data = arr[o][1];
					var isException = exceptionsList.includes(data.jid+data.index);
					var shouldBlock = (readConfirmationsHookEnabled && action === "read" && !isException) || (presenceUpdatesHookEnabled && action === "presence");
					if (shouldBlock)
					{
						console.log("WhatsAppIncognito: --- Blocking " + action.toUpperCase() + " action! ---");
						switch (action)
						{
							case "read":
								document.dispatchEvent(new CustomEvent('onReadConfirmationBlocked', {
									detail: data["jid"]
								}));
								var messageEvent = new MutableMessageEvent({data: tag + ",{\"status\": 403}"});
								wsHook.onMessage(messageEvent);
							break;
							case "presence":
								var messageEvent = new MutableMessageEvent({data: tag + ",{\"status\": 200}"});
								wsHook.onMessage(messageEvent);
							break;
						}

						return false;
					}
					if (isException)
					{
						// exceptions are one-time operation
						console.log("WhatsAppIncognito: --- Allowing " + action.toUpperCase() + " exception ---");
						exceptionsList.remove(exceptionsList.indexOf(data.jid+data.index));
					}
				}
			}
		}
	}
	catch (exception)
	{
		console.error("Allowing WA packet due to exception:");
		console.error(exception);
		return true;
	}
	
	return true;
}

handler.handleReceivedNode = function(e)
{
	var t = [], o = nodeReader.children(e);
	if ("response" === nodeReader.tag(e) && ("message" === nodeReader.attr("type", e) || "star" === nodeReader.attr("type", e) 
	    || "search" === nodeReader.attr("type", e) || "media_message" === nodeReader.attr("type", e))) 
	{
		if (Array.isArray(o)) 
		{
			var a, i = o.length;
			for (a = 0; a < i; a++) 
			{
				var d = handleMessage(o[a], "response");
				d && t.push(d)
			}
		}
		"search" === nodeReader.attr("type", e) && (t = 
		{
			eof: "true" === nodeReader.attr("last", e),
			messages: t
		})
		
		if (WAdebugMode) console.log("Got messages! (count: " +t.length+" )");
		if (isScrappingMessages)
		{
			isScrappingMessages = false;
			messages = t.concat(messages)
			if (WAdebugMode) console.log(JSON.parse(JSON.stringify(messages)));
			//handler.scrapMessages(t[0].key.remoteJid, t[0].key.id, 50);
		}
	}
}

function handleMessage(e, t)
{
	switch (nodeReader.tag(e)) 
	{
		case "message":
			return messageTypes.WebMessageInfo.parse(nodeReader.children(e));
		case "groups_v2":
			return e;
			//return parseMsgGp2(e);
		case "broadcast":
			return e;
			//return parseMsgBroadcast(e);
		case "notification":
			return e;
			//return parseMsgNotification(e);
		case "call_log":
			return e;
			//return parseMsgCallLog(e);
		case "security":
			return e;
			//return parseMsgSecurity(e);
		default:
			return null;
	}
}

var nodeReader = 
{
	tag: function(e) { return e && e[0] },
	attr: function(e, t) { return t && t[1] ? t[1][e] : void 0},
	attrs: function(e) { return e[1]},
	child: function s(e, t) {
		var r = t[2];
		if (Array.isArray(r))
			for (var n = r.length, o = 0; o < n; o++) {
				var s = r[o];
				if (Array.isArray(s) && s[0] === e)
					return s
			}
	},
	children: function(e) {
		return e && e[2]
	},
	dataStr: function(e) {
		if (!e)
			return "";
		var t = e[2];
		return "string" == typeof t ? t : t instanceof ArrayBuffer ? new BinaryReader(t).readString(t.byteLength) : void 0
	}
}

})();

window.FindReact = function(dom) {
    for (var key in dom)
        if (key.startsWith("__reactInternalInstance$")) {
            var compInternals = dom[key]._currentElement;
            var compWrapper = compInternals._owner;
            var comp = compWrapper._instance;
            return comp;
        }
    return null;
};

function getCSSRule(ruleName)
{
  var rules = {}; 
  var styleSheets = document.styleSheets;
  for (var i=0;i<styleSheets.length;++i){
	var styleSheetRules = styleSheets[i].cssRules;
	if (styleSheetRules == null) continue;
	for (var j=0;j<styleSheetRules.length;++j) 
		rules[styleSheetRules[j].selectorText] = styleSheetRules[j];
  }
  return rules[ruleName];
}