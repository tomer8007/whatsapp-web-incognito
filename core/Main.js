// global variables
var readConfirmationsHookEnabled = true;
var presenceUpdatesHookEnabled = true;
var safetyDelay = 0;
var WAdebugMode = false;
var isInitializing = true;
var exceptionsList = [];
var blinkingChats = {};
var chats = {};
var blockedChats = {};

// ---------------------
// Actual interception
// ---------------------

wsHook.before = function(originalData, url) 
{
	var payload = WACrypto.parseWebSocketPayload(originalData);
	var tag = payload.tag;
	var data = payload.data;
	
	return new Promise(function(resolve, reject)
	{
		if (data instanceof ArrayBuffer)
		{
			// encrytped binary payload
			WACrypto.decryptWithWebCrypto(data).then(function(decrypted)
			{
				if (decrypted == null) resolve(originalData);
				if (WAdebugMode) console.log("[Out] Sending binary with tag '" + tag + "' (" + decrypted.byteLength + " bytes, decrypted): ");
				
				var nodeParser = new NodeParser();
				var node = nodeParser.readNode(new NodeBinaryReader(decrypted));
				if (WAdebugMode) console.log(node);

				if (isInitializing)
				{
					isInitializing = false;
					console.log("WhatsIncognito: Interception is working.");
					document.dispatchEvent(new CustomEvent('isInterceptionWorking', {detail: true}));
				}
				
				var isAllowed = NodeHandler.handleSentNode(node, tag);
				if (isAllowed) resolve(originalData);
				else resolve(null);
			});
		}
		else
		{
			// textual payload
			if (!(data instanceof ArrayBuffer))
			{
				if (WAdebugMode) console.log("[Out] Sending message with tag '" + tag +"':");
				if (data != "" && WAdebugMode) console.log(data);
				resolve(originalData);
			}
		}
	});
}

wsHook.after = function(messageEvent, url) 
{
	var payload = WACrypto.parseWebSocketPayload(messageEvent.data);
	var tag = payload.tag;
	var data = payload.data;
	
	if (data instanceof ArrayBuffer)
	{
		WACrypto.decryptWithWebCrypto(data).then(function(decrypted)
		{		 
			if (WAdebugMode) console.log("[In] Received binary with tag '" + tag + "' (" +  decrypted.byteLength + " bytes, decrypted)): ");
			
			var nodeParser = new NodeParser();
			var node = nodeParser.readNode(new NodeBinaryReader(decrypted));
			if (WAdebugMode) console.log(node);
			NodeHandler.handleReceivedNode(node);
		});
   }
   else
	{
		if (WAdebugMode) console.log("[In] Received message with tag '" + tag +"':");
		if (data != "" && WAdebugMode)
			console.log(data);
	}
	
}

var NodeHandler = {};

(function() {
	
	var messages = [];
	var isScrappingMessages = false;
	var epoch = 8;

	NodeHandler.handleSentNode = function(node, tag)
	{
		try
		{
			if (nodeReader.tag(node) == "action")
			{
				var children = node[2];
				if (Array.isArray(children))
				{
					for (var n = children.length, o = 0; o < n; o++) 
					{
						var action = children[o][0];
						var data = children[o][1];
						var shouldBlock = (readConfirmationsHookEnabled && action === "read") ||
										(presenceUpdatesHookEnabled && action === "presence" && data["type"] === "available") || 
										(presenceUpdatesHookEnabled && action == "presence" && data["type"] == "composing");

						if (shouldBlock)
						{
							console.log("WhatsIncognito: --- Blocking " + action.toUpperCase() + " action! ---");
							switch (action)
							{
								case "read":
									var isReadReceiptAllowed = exceptionsList.includes(data.jid+data.index);
									if (isReadReceiptAllowed)
									{
										// this is the user trying to send out a read receipt.
										return true;
									}
									else
									{
										// We do not allow sending this read receipt.
										// invoke the callback and fake a failure response from server
										document.dispatchEvent(new CustomEvent('onReadConfirmationBlocked', {
											detail: data["jid"]
										}));

										var messageEvent = new MutableMessageEvent({data: tag + ",{\"status\": 403}"});
										wsHook.onMessage(messageEvent);
									}
								break;
								
								case "presence":
									var messageEvent = new MutableMessageEvent({data: tag + ",{\"status\": 200}"});
									wsHook.onMessage(messageEvent);
								break;
							}

							return false;
						}
						if (isReadReceiptAllowed)
						{
							// exceptions are one-time operation
							console.log("WhatsIncognito: --- Allowing " + action.toUpperCase() + " action ---");
							exceptionsList.splice(exceptionsList.indexOf(data.jid+data.index), 1);
						}
					}
				}
			}
		}
		catch (exception)
		{
			console.error("WhatsIncognito: Allowing WA packet due to exception:");
			console.error(exception);
			return true;
		}
		
		return true;
	}

	NodeHandler.handleReceivedNode = function(e)
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
			else if (WAdebugMode)
			{
				console.log(JSON.parse(JSON.stringify(t)))
			}
		}
	}

	NodeHandler.scrapMessages = function(jid, index, count)
	{
		messages = [];
		var startNode = ["query",{"type":"message","kind":"before","jid":jid,"count":count.toString(),"index":index,"owner":"true","epoch":(epoch++).toString()},null];
		WACrypto.sendNode(startNode);
		isScrappingMessages = true;
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

// ---------------------
// UI Event handlers
// ---------------------

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
		getCSSRule('html[dir] .P6z4j').style.backgroundColor = 'rgba(9, 210, 97, 0.3)';
		if (safetyDelayPanel != null)
			Velocity(safetyDelayPanel, { height: safetyDelayPanelExpectedHeight, opacity: 1, marginTop: 15} , { defaultDuration: 200, easing: [.1, .82, .25, 1] });
	}
	else 
	{
		getCSSRule('html[dir] .P6z4j').style.backgroundColor = 'rgba(9, 210, 97, 1)';
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
		var unreadCounters = document.getElementsByClassName("P6z4j");
		for (var i=0;i<unreadCounters.length;i++)
		{
			unreadCounters[i].className = "P6z4j";
		}
	}
});

document.addEventListener('onReadConfirmationBlocked', function(e) 
{
	var blockedJid = e.detail;
	
	var chatWindow = document.getElementsByClassName("_1_q7u")[0];
	var chat = getCurrentChat();
	
	if (readConfirmationsHookEnabled && safetyDelay > 0)
	{
		putWarningAndStartCounting();
	}
	else if (readConfirmationsHookEnabled && chat.id == blockedJid)
	{
		markChatAsBlocked(chat);
	}
	
});

function putWarningAndStartCounting()
{
	var chatWindow = document.getElementsByClassName("_1_q7u")[0];
	var chat = getCurrentChat();
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
		
		var parent = document.getElementsByClassName("_1ays2")[0];
		if (previousMessage != null) 
			parent.removeChild(previousMessage);
		var unreadMarker = parent.getElementsByClassName("_1lo-H").length > 0 ? parent.getElementsByClassName("_1lo-H")[0] : null;
		if (unreadMarker != null)
			unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
		else
		{
            warningMessage.setAttribute('class', 'incognito-message vW7d1');
			parent.appendChild(warningMessage);
		}
		Velocity(warningMessage, { height: warningMessage.clientHeight, opacity: 1, marginTop: [12, 0], marginBottom: [12, 0]} , { defaultDuration: 400, easing: [.1, .82, .25, 1] });
		
		// Temporarily removed due to react 16.0 changes
		/*
			var scrollToBottom = FindReact(document.getElementsByClassName("pane-chat-msgs")[0]).getScrollBottom();
			var messageVisiabillityDistance = warningMessage.clientHeight + parseFloat(getComputedStyle(warningMessage).marginBottom) + parseFloat(getComputedStyle(warningMessage).marginTop) + parseFloat(getComputedStyle(warningMessage.parentNode).paddingBottom);
			if (scrollToBottom < messageVisiabillityDistance) 
			{
				FindReact(document.getElementsByClassName("_9tCEa")[0].parentNode).scrollToBottom();
			}
		*/
		
		var blockedChat = findChatElementForJID(chat.id);
		if (blockedChat != null)
			blockedChat.querySelector("html[dir] .P6z4j").className += " blinking";
		
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
				var data = {jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount};
				document.dispatchEvent(new CustomEvent('sendReadConfirmation', {detail: JSON.stringify(data)}));
				
				blockedChat.querySelector("html[dir] .P6z4j").className = "P6z4j";
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
	var chatWindow = document.getElementsByClassName("_1_q7u")[0];
	var chat = getCurrentChat();
	chats[chat.id] = chat;
});

function markChatAsBlocked(chat)
{
	var blockedChat = findChatElementForJID(chat.id);
	if (blockedChat != null)
	{
		// turn the unread counter of the chat to red
		blockedChat.querySelector("html[dir] .P6z4j").className = "P6z4j incognito";
	}
	var messageID = chat.id + chat.lastReceivedKey.id;
	
	var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
	var warningWasEmpty = warningMessage == null;
	if (warningMessage == null)
	{
		warningMessage = document.createElement('div');
		warningMessage.setAttribute('class', 'incognito-message middle');
		warningMessage.innerHTML = "Read receipts were blocked.";
		warningMessage.messageID = messageID;
		var sendButton = document.createElement('div');
		sendButton.setAttribute('class', 'incognito-send-button');
		sendButton.innerHTML = "Mark as read";
		warningMessage.appendChild(sendButton);
		
		var parent = document.getElementsByClassName("_1ays2")[0];
		var unreadMarker = parent.getElementsByClassName("_1lo-H").length > 0 ? parent.getElementsByClassName("_1lo-H")[0] : null;
		if (unreadMarker != null)
			unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
		else
		{
            warningMessage.setAttribute('class', 'incognito-message vW7d1');
			parent.appendChild(warningMessage);
		}
	}
	
	var cancelButton = warningMessage.lastChild;
	if (blockedChats[chat.id] == undefined || warningWasEmpty)
		Velocity(warningMessage, {  scaleY: [1,0], opacity: [1, 0]} , { defaultDuration: 400, easing: [.1, .82, .25, 1] });
	warningMessage.firstChild.textContent = "Read receipts were blocked.";
	cancelButton.setAttribute('class', 'incognito-send-button');
	cancelButton.innerHTML = "Mark as read";
	cancelButton.onclick = function()
	{
		if (chat.unreadCount > 0)
		{
			var data = {name: chat.name, jid: chat.id, lastMessageIndex: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe,unreadCount: chat.unreadCount, isGroup: chat.isGroup, formattedName: chat.contact.formattedName};
			document.dispatchEvent(new CustomEvent('onMarkAsReadClick', {detail: JSON.stringify(data)}));
		}
	};
	
	if (!(chat.id in blockedChats)) 
	{
		// Temporarily removed due to react 16.0 changes
		/*
			var scrollToBottom = FindReact(document.getElementsByClassName("pane-chat-msgs")[0]).getScrollBottom();
				var messageVisiabillityDistance = warningMessage.clientHeight + parseFloat(getComputedStyle(warningMessage).marginBottom) + parseFloat(getComputedStyle(warningMessage).marginTop) + parseFloat(getComputedStyle(warningMessage.parentNode).paddingBottom);
				if (scrollToBottom < messageVisiabillityDistance) 
				{
					FindReact(document.getElementsByClassName("_9tCEa")[0].parentNode).scrollToBottom();
				}
		*/
	}
	
	blockedChats[chat.id] = chat;
}

function findChatElementForJID(jid)
{
    var chatsShown = document.getElementsByClassName("X7YrQ");
	var blockedChat = null;
	for (var i=0;i<chatsShown.length;i++)
	{
		var reactElement = FindReact(chatsShown[i]);
		if (reactElement.props.chat == undefined) continue;
		
		var id = reactElement.props.chat.id;
		if (id == jid)
		{
			blockedChat = chatsShown[i];
			break;
		}

	}
	
	return blockedChat;
}

function getCurrentChat() 
{
	var elements = document.getElementsByClassName("_1_q7u");
    if (elements.length == 0) return null;

    var reactResult = FindReact(elements[0]);
	var chat = null;
	if (Array.isArray(reactResult))
	{
		for (var i = 0; i < reactArray.length; i++)
		{
			if (reactArray[i].props.chat !== undefined)
			{
				chat = reactArray[i].props.chat;
				break;
			}
		}
	}
	else
	{
		chat = reactResult.props.chat;
	}
    
    return chat;
}

function getChatByJID(jid)
{
	var chat = findChatElementForJID(jid);
	if (chat != null)
	{
		chat = FindReact(chat).props.chat;
	}
	else
	{
		chat = chats[jid];
	}
	
	return chat;
}

document.addEventListener('onDropdownOpened', function(e) 
{
	var menuItems = document.getElementsByClassName("_3z3lc")[0].getElementsByClassName("_3cfBY ");
	var reactMenuItems = FindReact(document.getElementsByClassName("_2hHc6")[0])[0].props.children;
	var markAsReadButton = null;
	var props = null;
	for (var i=0;i<reactMenuItems.length;i++)
	{
		if (reactMenuItems[i] == null) continue;

		if (reactMenuItems[i].key == ".$mark_unread")
		{
			markAsReadButton = menuItems[i];
			props = reactMenuItems[i].props;
			break;
		}
	}
	if (props != null)
	{
		var name = props.chat.name;
		var formattedName = props.chat.contact.formattedName;
		var jid = props.chat.id;
		var lastMessageIndex = props.chat.lastReceivedKey.id;
		var unreadCount = props.chat.unreadCount;
		var isGroup = props.chat.isGroup;
		var fromMe = props.chat.lastReceivedKey.fromMe;
		if (unreadCount > 0)
		{
			// this is mark-as-read button, not mark-as-unread
			markAsReadButton.addEventListener("mousedown", function(e) 
			{
				var data = {name: name, formattedName: formattedName, jid: jid, lastMessageIndex: lastMessageIndex, fromMe: fromMe, unreadCount: unreadCount, isGroup: isGroup};
				document.dispatchEvent(new CustomEvent('onMarkAsReadClick', {detail: JSON.stringify(data)}));
			});
		}
	}
});

document.addEventListener('sendReadConfirmation', function(e)
{
	var data = JSON.parse(e.detail);
	var index = data.index != undefined ? data.index : data.lastMessageIndex;
	var t = {id: index, fromMe: data.fromMe, participant: null};
	var messageID = data.jid + index;

    var chat = getChatByJID(data.jid);
	
	exceptionsList.push(messageID);
	//chat.sendSeen().bind(this).then(function(e) 
	WhatsAppAPI.Wap.sendConversationSeen(data.jid, t, data.unreadCount, false).then(function(e) 
	{
		var chat = null;
		if (data.jid in chats)
			chat = chats[data.jid];
		if (data.jid in blinkingChats)
		{
			chat = blinkingChats[data.jid]["chat"]
			clearInterval(blinkingChats[data.jid]["timerID"]);
			delete blinkingChats[data.jid];
		}
		if (data.jid in blockedChats)
		{
			delete blockedChats[data.jid];
		}
			
		if (e.status == 200)
		{
			chat.unreadCount -= data.unreadCount;
		}
		else if (e.status != 200)
		{
			
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
		
		var appElement = document.getElementsByClassName("app-wrapper-web")[0];
		var toast = document.createElement("div");
		toast.setAttribute("class", "f1UZe");
		toast.style.transformOrigin = "left top";
		toast.innerHTML = "<div class=\"hYvJ8\">The safety delay must be an integer number in range 1-30 !</div>";
		appElement.insertBefore(toast, appElement.firstChild);
		Velocity(toast, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
		setTimeout(function() { Velocity(toast, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] }); }, 4000); 
	}
});

document.addEventListener('onMainUIReady', function(e)
{
	exposeWhatsAppAPI();
});

// -------------------
// Helper functions
// --------------------

window.FindReact = function(dom) 
{
    for (var key in dom)
	{
        if (key.startsWith("__reactInternalInstance$")) 
		{
			var reactElement = dom[key];
			
			return reactElement.memoizedProps.children;
			
            var compInternals = dom[key]._currentElement;
            var compWrapper = compInternals._owner;
			if (compWrapper == null) return compInternals;
            var comp = compWrapper._instance;
            return comp;
        }
	}
    return null;
};

function exposeWhatsAppAPI()
{

	if (window._)
	{
		// taken from https://gist.github.com/phpRajat/a6422922efae32914f4dbd1082f3f412

		function getAllWebpackModules() {
			return new Promise((resolve) => {
				const id = _.uniqueId("fakeModule_");
				window["webpackJsonp"](
					[],
					{
						[id]: function(module, exports, __webpack_require__) {
							resolve(__webpack_require__.c);
						}
					},
					[id]
				);
		});
	  }
	  
	  WAModules = getAllWebpackModules()._value;
	  
	  for (var key in WAModules) {
		if (WAModules[key].exports) {

		  // find the Store module
		  if (WAModules[key].exports.default) {
			if (WAModules[key].exports.default.Chat) {
				window.WhatsAppAPI = WAModules[key].exports.default;
			}
		  }

		// find the web module
		  if (WAModules[key].exports.VERSION_STR) {
			var versionString = WAModules[key].exports.VERSION_STR;
			console.log("WhatsIncognito: WhatsApp Web verison is " + versionString);
			break;
		}
		}
	  }
	}
	else
	{
		// iterate the modules in a different way
		// taken from https://github.com/danielcardeenas/sulla/blob/master/src/lib/wapi.js
		
		var foundModules = [];

		function iterateModules(modules) {
			for (let idx in modules) {
				if ((typeof modules[idx] === "object") && (modules[idx] !== null)) {
					let first = Object.values(modules[idx])[0];
					if ((typeof first === "object") && (first.exports)) {
						for (let idx2 in modules[idx]) {
							let module = modules(idx2);
							if (!module) continue;
							foundModules.push(module);

							// find the Store module
							if (module.Chat && module.Msg)
							{
								window.WhatsAppAPI = module;
							}

							// find the web module
							if (module.VERSION_STR)
							{
								console.log("WhatsIncognito: WhatsApp Web verison is " + module.VERSION_STR);
							}
						}
					}
				}
			}
		}

		webpackJsonp([], { 'parasite': (x, y, z) => iterateModules(z) }, ['parasite']);
	}

	
}

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

function getCSSRule(ruleName)
{
  var rules = {}; 
  var styleSheets = document.styleSheets;
  var styleSheetRules = null;
  for (var i=0;i<styleSheets.length;++i)
  {
	try 
	{
		styleSheetRules = styleSheets[i].cssRules;
	}
	catch (e)
	{
		// Assume Chrome 64+ doesn't let us access this CSS due to security policies or whatever, just ignore
		continue;
	}
	if (styleSheetRules == null) continue;
	for (var j=0;j<styleSheetRules.length;++j) 
		rules[styleSheetRules[j].selectorText] = styleSheetRules[j];
  }
  return rules[ruleName];
}