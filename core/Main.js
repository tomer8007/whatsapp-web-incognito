// Main
// Actual interception

var readConfirmationsHookEnabled = true;
var presenceUpdatesHookEnabled = true;
var safetyDelay = 0;
var WAdebugMode = false;
var isInitializing = true;
var exceptionsList = [];
var blinkingChats = {};

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
				if (decrypted == null) resolve(originalData);
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

document.addEventListener('onOptionsUpdate', function(e) 
{
	var options = JSON.parse(e.detail);
   	if ('readConfirmationsHook' in options) readConfirmationsHookEnabled = options.readConfirmationsHook;
   	if ('presenceUpdatesHook' in options) presenceUpdatesHookEnabled = options.presenceUpdatesHook;
	if ('safetyDelay' in options) safetyDelay = options.safetyDelay;
	
	var safetyDelayPanel = document.getElementById("incognito-safety-delay-option-panel");
	var safetyDelayPanelExpectedHeight = 44; // be careful with this
	if (readConfirmationsHookEnabled) 
	{
		getCSSRule('html[dir] .OUeyt').style.backgroundColor = 'rgba(9, 210, 97, 0.3)';
		if (safetyDelayPanel != null)
			Velocity(safetyDelayPanel, { height: safetyDelayPanelExpectedHeight, opacity: 1, marginTop: 15} , { defaultDuration: 200, easing: [.1, .82, .25, 1] });
	}
	else 
	{
		getCSSRule('html[dir] .OUeyt').style.backgroundColor = 'rgba(9, 210, 97, 1)';
		if (safetyDelayPanel != null)
			Velocity(safetyDelayPanel, { height: 0, opacity: 0, marginTop: -10} , { defaultDuration: 200, easing: [.1, .82, .25, 1] });
		var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
		if (warningMessage != null)
		{
			Velocity(warningMessage, { scaleY: [0,1], opacity: [0, 1]} , { defaultDuration: 300, easing: [.1, .82, .25, 1] });
			setTimeout(function() {warningMessage.parentNode.removeChild(warningMessage);}, 300);
		}
	}
	
	if ('readConfirmationsHook' in options)
	{
		var unreadCounters = document.getElementsByClassName("OUeyt");
		for (var i=0;i<unreadCounters.length;i++)
		{
			unreadCounters[i].className = "OUeyt";
		}
	}
});

document.addEventListener('onReadConfirmationBlocked', function(e) 
{
	var blockedJid = e.detail;
	
	// turn the unread counter of the chat to red
    var chatsShown = document.getElementsByClassName("unread chat");
	var blockedChat = null;
	for (var i=0;i<chatsShown.length;i++)
	{
		var id = FindReact(chatsShown[i]).props.children[0].props.children.props.id;
		if (id == blockedJid)
		{
			blockedChat = chatsShown[i];
			break;
		}
	}
	
	if (readConfirmationsHookEnabled && safetyDelay > 0)
	{
		putWarningAndStartCounting();
	}
	else if (readConfirmationsHookEnabled)
	{
		blockedChat.querySelector("html[dir] .OUeyt").className += " incognito";
	}
});

function putWarningAndStartCounting()
{
	var chatWindow = document.querySelector("#main > div.pane-chat-tile");
	var chat = chatWindow != undefined ? FindReact(chatWindow).props.chat : null;
	var messageID = chat.id + chat.lastReceivedKey.id;
	var previousMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
	var seconds = safetyDelay;
	
	if (chatWindow != null && chat.unreadCount > 0  && (previousMessage == null || previousMessage.messageID != messageID))
	{
		if (chat.id in blinkingChats)
		{
			seconds = blinkingChats[chat.id]["time"];
			clearInterval(blinkingChats[chat.id]["timerID"]);
		}
		
		// put a warning message at the chat panel
		var warningMessage = document.createElement('div');
		warningMessage.setAttribute('class', 'incognito-message middle');
		warningMessage.innerHTML = "Sending read receipts in " + seconds + " seconds...";
		warningMessage.messageID = messageID;
		var cancelButton = document.createElement('div');
		cancelButton.setAttribute('class', 'incognito-cancel-button');
		cancelButton.innerHTML = "Cancel";
		warningMessage.appendChild(cancelButton);
		
		var parent = document.getElementsByClassName("_9tCEa")[0];
		if (previousMessage != null) 
			parent.removeChild(previousMessage);
		var unreadMessage = parent.getElementsByClassName("L89LI").length > 0 ? parent.getElementsByClassName("L89LI")[0] : null;
		if (unreadMessage != null)
			unreadMessage.parentNode.insertBefore(warningMessage, unreadMessage.nextSibling);
		else
		{
			warningMessage.setAttribute('class', 'incognito-message msg');
			parent.appendChild(warningMessage);
		}
		Velocity(warningMessage, { height: warningMessage.clientHeight, opacity: 1, marginTop: [12, 0], marginBottom: [12, 0]} , { defaultDuration: 400, easing: [.1, .82, .25, 1] });
		
		var scrollToBottom = FindReact(document.getElementsByClassName("pane-chat-msgs")[0]).getScrollBottom();
		var messageVisiabillityDistance = warningMessage.clientHeight + parseFloat(getComputedStyle(warningMessage).marginBottom) + parseFloat(getComputedStyle(warningMessage).marginTop) + parseFloat(getComputedStyle(warningMessage.parentNode).paddingBottom);
		if (scrollToBottom < messageVisiabillityDistance) 
		{
			FindReact(document.getElementsByClassName("_9tCEa")[0]).scrollToBottom();
		}
		
		var blockedChat = findUnreadChatElementForJID(chat.id);
		blockedChat.querySelector("html[dir] .OUeyt").className += " blinking";
		
    	var id = setInterval(function()
		{ 
        	seconds--;
			if (seconds > 0)
			{
				warningMessage.firstChild.textContent = "Sending read receipts in " + seconds + " seconds...";
				blinkingChats[chat.id] = {timerID: id, time: seconds, chat: chat};
			}
      		else
			{
				// time's up, sending receipt
        		clearInterval(id);
				var data = {jid: chat.id, index: chat.lastReceivedKey.id, count: chat.unreadCount};
				document.dispatchEvent(new CustomEvent('sendReadConfirmation', {detail: JSON.stringify(data)}));
				
				blockedChat.querySelector("html[dir] .OUeyt").className = "OUeyt";
       		}
    	}, 1000);
		blinkingChats[chat.id] = {timerID: id, time: seconds, chat: chat};
		
		cancelButton.onclick = function() 
		{
			clearInterval(id);
			delete blinkingChats[chat.id];
			
			markChatAsBlocked(chat);
		};
	}
}

document.addEventListener('onPaneChatOpened', function(e)
{
	
});

function markChatAsBlocked(chat)
{
	var blockedChat = findUnreadChatElementForJID(chat.id);
	if (blockedChat != null)
		blockedChat.querySelector("html[dir] .OUeyt").className = "OUeyt";
	
	var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
	var cancelButton = warningMessage.lastChild;
	if (warningMessage != null)
	{
		Velocity(warningMessage, {  scaleY: [1,0], opacity: [1, 0]} , { defaultDuration: 400, easing: [.1, .82, .25, 1] });
		warningMessage.firstChild.textContent = "Read receipts were blocked.";
		cancelButton.setAttribute('class', 'incognito-send-button');
		cancelButton.innerHTML = "Mark as read";
		cancelButton.onclick = function()
		{
			if (chat.unreadCount > 0)
			{
				var data = {name: chat.name, jid: chat.id, lastMessageIndex: chat.lastReceivedKey.id, unreadCount: chat.unreadCount, isGroup: chat.isGroup, formattedName: chat.contact.formattedName};
				document.dispatchEvent(new CustomEvent('onMarkAsReadClick', {detail: JSON.stringify(data)}));
			}
		};
	}
}

function findUnreadChatElementForJID(jid)
{
	var chatsShown = document.getElementsByClassName("unread chat");
	var blockedChat = null;
	for (var i=0;i<chatsShown.length;i++)
	{
		var id = FindReact(chatsShown[i]).props.children[0].props.children.props.id;
		if (id == jid)
		{
			blockedChat = chatsShown[i];
			break;
		}
	}
	
	return blockedChat;
}

document.addEventListener('onDropdownOpened', function(e) 
{
	var menuItems = document.getElementsByClassName("dropdown")[0].getElementsByClassName("dropdown-item");
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
				var data = {name: name, jid: jid, lastMessageIndex: lastMessageIndex, unreadCount: unreadCount, isGroup: isGroup};
				document.dispatchEvent(new CustomEvent('onMarkAsReadClick', {detail: JSON.stringify(data)}));
			});
		}
	}
});

document.addEventListener('sendReadConfirmation', function(e)
{
	var data = JSON.parse(e.detail);
	var index = data.index != undefined ? data.index : data.lastMessageIndex;
	var t = {id: index, fromMe: false, participant: null};
	var messageID = data.jid + index;
	
	exceptionsList.push(messageID);
	Store.Wap.sendConversationSeen(data.jid, t, data.count, false).bind(this).then(function(e) 
	{
		if (data.jid in blinkingChats)
		{
			var chat = blinkingChats[data.jid]["chat"]
			if (chat.markSeen != undefined && e.status == 200)
				chat.markSeen(data.count);
			clearInterval(blinkingChats[data.jid]["timerID"]);
			delete blinkingChats[data.jid];
		}
    });
	
	var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
	if (warningMessage != null && warningMessage.messageID == messageID)
	{
		Velocity(warningMessage, { height: 0, opacity: 0, marginTop: 0, marginBottom: 0} , { defaultDuration: 300, easing: [.1, .82, .25, 1] });
	}
	
	
	//var node = ["action",{"type":"set","epoch":"30"},[["read",{"jid":data.jid,"index":data.index,"owner":"false","count":data.unreadCount.toString()},null]]];
	//WACrypto.sendNode(node);
});

document.addEventListener('onIncognitoOptionsOpened', function(e)
{
	var drop = document.getElementsByClassName("drop")[0];
	fixCSSPositionIfNeeded(drop);
	Velocity(drop, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 100, easing: [.1, .82, .25, 1] });
	
	var safetyDelayPanel = document.getElementById("incognito-safety-delay-option-panel");
	if (!readConfirmationsHookEnabled)
	{
		safetyDelayPanel.style.opacity = 0;
		safetyDelayPanel.style.height = 0;
		safetyDelayPanel.style.marginTop = "-10px"
	}
});

document.addEventListener('onIncognitoOptionsClosed', function(e)
{	
	var drop = document.getElementsByClassName("drop")[0];
	fixCSSPositionIfNeeded(drop);
	Velocity(drop, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 100, easing: [.1, .82, .25, 1] });
	
	if (!document.getElementById("incognito-radio-enable-safety-delay").checked) return;
	
	// validate safety delay
	var string = document.getElementById("incognito-option-safety-delay").value;
	var isValid = false;
    var number = Math.floor(Number(string));
    if ((String(number) === string && number >= 1 && number <= 30) || string == "") isValid = true;
	if (!isValid)
	{
		document.getElementById("incognito-option-safety-delay").disabled = true;
		document.getElementById("incognito-option-safety-delay").value = "";
		document.getElementById("incognito-radio-disable-safety-delay").checked = true;
		document.getElementById("incognito-radio-enable-safety-delay").checked = false;
		
		var appElement = document.getElementsByClassName("app-wrapper app-wrapper-web app-wrapper-main")[0];
		var toast = document.createElement("div");
		toast.setAttribute("class", "_3iZUg");
		toast.style.transformOrigin = "left top";
		toast.textContent = "The safety delay must be an integer number in range 1-30 !";
		appElement.insertBefore(toast, appElement.firstChild);
		Velocity(toast, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
		setTimeout(function() { Velocity(toast, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] }); }, 4000); 
	}
});

function fixCSSPositionIfNeeded(drop)
{
	if (drop.style.transform.includes("translateX") && drop.style.transform.includes("translateY"))
	{
		var matrix = drop.style.transform.replace(/[^0-9\-.,\s]/g, '').split(' ');
 		drop.style.left = matrix[0] + "px"; 
 		drop.style.top = matrix[1] + "px"; 
		drop.style.transform = "";
	}
}

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
						console.log("WhatsAppIncognito: --- Allowing " + action.toUpperCase() + " action due to exception ---");
						exceptionsList.remove(exceptionsList.indexOf(data.jid+data.index));
					}
				}
			}
		}
	}
	catch (exception)
	{
		console.error("WhatsAppIncognito: Allowing WA packet due to exception:");
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
		case "broadcast":
		case "notification":
		case "call_log":
		case "security":
			return e;
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
	children: function(e) 
	{
		return e && e[2]
	},
	dataStr: function(e) 
	{
		if (!e) return "";
		var t = e[2];
		return "string" == typeof t ? t : t instanceof ArrayBuffer ? new BinaryReader(t).readString(t.byteLength) : void 0
	}
}

})();

window.FindReact = function(dom) 
{
    for (var key in dom)
	{
        if (key.startsWith("__reactInternalInstance$")) 
		{
            var compInternals = dom[key]._currentElement;
            var compWrapper = compInternals._owner;
			if (compWrapper == null) return compInternals;
            var comp = compWrapper._instance;
            return comp;
        }
	}
    return null;
};

function getCSSRule(ruleName)
{
  var rules = {}; 
  var styleSheets = document.styleSheets;
  for (var i=0;i<styleSheets.length;++i)
  {
	var styleSheetRules = styleSheets[i].cssRules;
	if (styleSheetRules == null) continue;
	for (var j=0;j<styleSheetRules.length;++j) 
		rules[styleSheetRules[j].selectorText] = styleSheetRules[j];
  }
  return rules[ruleName];
}