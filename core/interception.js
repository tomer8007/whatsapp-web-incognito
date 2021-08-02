// global variables
var readConfirmationsHookEnabled = true;
var presenceUpdatesHookEnabled = true;
var saveDeletedMsgsHook = false
var safetyDelay = 0;
var WAdebugMode = false;
var isInitializing = true;
var exceptionsList = [];
var blinkingChats = {};
var chats = {};
var blockedChats = {};
var deletedDB = indexedDB.open("deletedMsgs", 1)

deletedDB.onupgradeneeded = function (e) {
    // triggers if the client had no database
    // ...perform initialization...
    let db = deletedDB.result
    switch (e.oldVersion) {
        case 0:
            db.createObjectStore('msgs', { keyPath: 'id' })
            console.log('WhatsIncognito: Deleted messages database generated')
    }
};
deletedDB.onerror = function () {
    console.log("WhatsIncognito: Error opening database")
    console.error("Error", deletedDB);
};
deletedDB.onsuccess = () => {
    console.log("WhatsIncognito: Database loaded")
}

// 
// Actual interception
// 


// As you scroll, a hook to load msgs is constantly called and hence the function below is called constantly
wsHook.before = function (originalData, url) {
    // a WebSocket frame is about to be sent out.

    if (!WACrypto.isWebSocketPayloadSupported(originalData)) {
        document.dispatchEvent(new CustomEvent('onBadProtocolDetected', {}));
        return resolve(messageEvent);
    }

    var payload = WACrypto.parseWebSocketPayload(originalData);
    var tag = payload.tag;
    var data = payload.data;

    return new Promise(function (resolve, reject) {
        if (data instanceof ArrayBuffer) {
            // encrytped binary payload
            WACrypto.decryptWithWebCrypto(data).then(function (decrypted) {
                if (decrypted == null) resolve(originalData);

                var nodeParser = new NodeParser();
                var node = nodeParser.readNode(new NodeBinaryReader(decrypted));

                if (isInitializing) {
                    isInitializing = false;
                    console.log("WhatsIncognito: Interception is working.");
                    document.dispatchEvent(new CustomEvent('isInterceptionWorking', { detail: true }));
                }

                // Checks if read receipts should be sent
                var isAllowed = NodeHandler.isSentNodeAllowed(node, tag);
                var manipulatedNode = NodeHandler.manipulateSentNode(node, tag);
                WACrypto.packNodeForSending(manipulatedNode, tag).then(function (packet) {
                    if (WAdebugMode) {
                        console.log("[Out] Sending binary with tag '" + tag + "' (" + decrypted.byteLength + " bytes, decrypted): ");
                        console.log(node);
                    }

                    var manipulatedData = packet.serialize();
                    if (isAllowed) resolve(manipulatedData);
                    else resolve(null);
                });
            });
        }
        else {
            // textual payload
            if (!(data instanceof ArrayBuffer)) {
                if (WAdebugMode) console.log("[Out] Sending message with tag '" + tag + "':");
                if (data != "" && WAdebugMode) console.log(data);
                resolve(originalData);
            }
        }
    });
}

wsHook.after = function (messageEvent, url) {
    // a WebScoket frame was received from network.

    return new Promise(function (resolve, reject) {
        var manipulatedMessageEvent = messageEvent;
        if (!WACrypto.isWebSocketPayloadSupported(messageEvent.data)) {
            document.dispatchEvent(new CustomEvent('onBadProtocolDetected', {}));
            return resolve(messageEvent);
        }

        var payload = WACrypto.parseWebSocketPayload(messageEvent.data);
        var tag = payload.tag;
        var data = payload.data;

        if (data instanceof ArrayBuffer) {
            WACrypto.decryptWithWebCrypto(data).then(function (decrypted) {
                if (decrypted == null) resolve(messageEvent);

                var nodeParser = new NodeParser();
                var node = nodeParser.readNode(new NodeBinaryReader(decrypted));

                if (WAdebugMode) {
                    console.log("[In] Received binary with tag '" + tag + "' (" + decrypted.byteLength + " bytes, decrypted)): ");
                    console.log(node);
                }

                var isAllowed = NodeHandler.isReceivedNodeAllowed(node, tag);
                if (isAllowed) resolve(messageEvent);
                else resolve(null);


                /*commented out due to a possible "Maximum call stack size exceeds" exception

                var manipulatedNode = NodeHandler.manipulateReceivedNode(node, tag);
                WACrypto.packNodeForSending(manipulatedNode, tag).then(function(packet)
                {
                    var manipulatedData = packet.serializeWithoutBinaryOpts();

                    manipulatedMessageEvent.data = manipulatedData;
                    if (isAllowed) resolve(s);
                    else resolve(null);
                });*/

            });
        }
        else {
            // textual payload
            if (WAdebugMode) console.log("[In] Received message with tag '" + tag + "':");
            if (data != "" && WAdebugMode)
                console.log(data);

            resolve(messageEvent);
        }

    });
}

//
// Handling nodes
//

var NodeHandler = {};

(function () {

    NodeHandler.isSentNodeAllowed = function (node, tag) {
        try {
            if (nodeReader.tag(node) != "action") return true;
            if (!Array.isArray(nodeReader.children(node))) return true;

            var children = nodeReader.children(node);
            for (var i = 0; i < children.length; i++) {
                var child = children[i];

                var action = child[0];
                var data = child[1];
                var shouldBlock = (readConfirmationsHookEnabled && action === "read" ||
                    readConfirmationsHookEnabled && action == "received" && data["type"] === "played") ||

                    (presenceUpdatesHookEnabled && action === "presence" && data["type"] === "available") ||
                    (presenceUpdatesHookEnabled && action == "presence" && data["type"] == "composing");

                if (shouldBlock) {
                    switch (action) {
                        case "read":
                            var isReadReceiptAllowed = exceptionsList.includes(data.jid);
                            if (isReadReceiptAllowed) {
                                // this is the user trying to send out a read receipt.
                                console.log("WhatsIncongito: Allowing read receipt to " + data.jid + " at index " + data.index);

                                // exceptions are one-time operation, so remove it from the list
                                exceptionsList = exceptionsList.filter(i => i !== data.jid)

                                return true;
                            }
                            else {
                                // We do not allow sending this read receipt.
                                // invoke the callback and fake a failure response from server
                                document.dispatchEvent(new CustomEvent('onReadConfirmationBlocked', {
                                    detail: data["jid"]
                                }));

                                var messageEvent = new MutableMessageEvent({ data: tag + ",{\"status\": 403}" });
                                wsHook.onMessage(messageEvent);
                            }
                            break;

                        case "presence":
                            var messageEvent = new MutableMessageEvent({ data: tag + ",{\"status\": 200}" });
                            wsHook.onMessage(messageEvent);
                            break;
                    }

                    console.log("WhatsIncognito: --- Blocking " + action.toUpperCase() + " action! ---");

                    return false;
                }
            }
        }
        catch (exception) {
            console.error("WhatsIncognito: Allowing WA packet due to exception:");
            console.error(exception);
            return true;
        }

        return true;
    }

    NodeHandler.manipulateSentNode = function (node, tag) {
        try {
            if (nodeReader.tag(node) != "action") return node;
            if (!Array.isArray(nodeReader.children(node))) return node;

            var children = nodeReader.children(node);
            for (var i = 0; i < children.length; i++) {
                var child = children[i];

                var action = child[0];
                var data = child[1];

                if (action == "message") {
                    var messageBuffer = child[2];
                    var message = parseMessage(child);

                    if (message != null) {
                        message = this.handleSentMessage(message);

                        // TODO: following lines are commented out because apperently the parsing above is not complete,
                        // so the message is not always restored identically

                        // re-assmble everything
                        // messageBuffer = messageTypes.WebMessageInfo.encode(message).readBuffer();
                        // child[2] = messageBuffer; children[i] = child; node[2] = children;
                    }


                    return node;
                }
            }
        }
        catch (exception) {
            console.error("WhatsIncognito: Allowing WA packet due to exception:");
            console.error(exception);
            return node;
        }

        return node;
    }

    NodeHandler.handleSentMessage = function (message) {
        if (message.key && message.key.remoteJid && isChatBlocked(message.key.remoteJid)) {
            // If the user replyed to a message from this JID,
            // It probably means we can send read receipts for it.

            var chat = getChatByJID(message.key.remoteJid);
            var data = { jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
            setTimeout(function () { document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) })); }, 600);
        }

        // do message manipulation if needed
        //         ...
        var putBreakpointHere = 1;

        return message;
    }


    NodeHandler.isReceivedNodeAllowed = function (node, tag) {
        try {
            var children = nodeReader.children(node);
            var tag = nodeReader.tag(node);
            var type = nodeReader.attr("type", node);
            if (tag != "action") return true;
            if (!Array.isArray(children)) return true;



            for (var i = 0; i < children.length; i++) {
                var child = children[i];

                var action = child[0];
                var data = child[1];

                var message = parseMessage(children[i]);
                if (message)
                    /*
                                                let queryString = ""
                                if (message.key.fromMe) {
                                    queryString = "[data-id='true_" + message.key.remoteJid + "_" + message.message.protocolMessage.key.id + "']"
                                }
                                else {
                                    queryString = "[data-id='false_" + message.key.remoteJid + "_" + message.message.protocolMessage.key.id + "']"
                                }
                                console.log(queryString)
                                const test = document.querySelector(queryString)
                                console.log(test)
                                if (test) {
                                    console.log(test.querySelector("." + UIClassNames.CHAT_BUBBLE))
                                    console.log(FindReact(document.querySelector(queryString)))
                                }
                    */


                    var messageRevokeValue = messageTypes.Message.ProtocolMessage.TYPE.REVOKE;
                if (message && message.message && message.message.protocolMessage && message.message.protocolMessage.type == messageRevokeValue) {
                    // someone deleted a message, block
                    if (saveDeletedMsgsHook) {
                        const chat = getChatByJID(message.key.remoteJid)
                        const msgs = chat.msgs.models
                        let deletedMsgContents = {}
                        for (let i = 0; i < msgs.length; i++) {
                            if (msgs[i].id.id == message.message.protocolMessage.key.id) {
                                deletedMsgContents.id = message.key.id
                                deletedMsgContents.originalID = msgs[i].id.id
                                deletedMsgContents.body = msgs[i].body
                                deletedMsgContents.timestamp = msgs[i].t
                                deletedMsgContents.from = msgs[i].author.user
                                deletedMsgContents.Jid = message.key.remoteJid
                                break
                            }
                        }
                        if ("id" in deletedMsgContents) {
                            const transcation = deletedDB.result.transaction('msgs', "readwrite")
                            let request = transcation.objectStore("msgs").add(deletedMsgContents)
                            request.onerror = (e) => {

                                // ConstraintError occurs when an object with the same id already exists
                                if (request.error.name == "ConstraintError") {
                                    console.log("WhatsIncognito: Error saving msg, msg ID already exists");
                                } else {
                                    console.log("WhatsIncognito: Unexpected error saving deleted msg")
                                }
                            };
                            request.onsuccess = (e) => {
                                console.log("WhatsIncognito: Saved deleted msg with ID " + deletedMsgContents.Jid + " from " + deletedMsgContents.from + " successfully.")
                            }
                        }
                        else {
                            console.log("WhatsIncognito: Deleted msg contents not found")
                        }
                    }

                    console.log("WhatsIncognito: --- Blocking message REVOKE action! ---");
                    return false;
                }
            }
        }
        catch (exception) {
            console.error("WhatsIncognito: Allowing WA packet due to exception:");
            console.error(exception);
            return true;
        }

        return true;
    }

    NodeHandler.manipulateReceivedNode = function (node) {
        var messages = [];
        var children = nodeReader.children(node);
        var tag = nodeReader.tag(node);
        var type = nodeReader.attr("type", node);

        if (Array.isArray(children)) {
            for (var i = 0; i < children.length; i++) {
                var child = children[i];
                var action = child[0];
                var data = child[1];

                var message = parseMessage(children[i]);
                if (message && (typeof message.message === "undefined")) {

                    console.log(message)
                }
                if (message) messages.push(message);
            }
        }



        /*
        if ("search" === type) {
            messages = { eof: "true" === nodeReader.attr("last", node), messages: messages };
        }

        if (messages.length > 0) {
            if (WAdebugMode) console.log("Got messages! (count: " + messages.length + " )");

            if (isScrappingMessages) {
                isScrappingMessages = false;
                messages = messages.concat(messages);

                if (WAdebugMode) console.log(JSON.parse(JSON.stringify(messages)));
                //handler.scrapMessages(t[0].key.remoteJid, t[0].key.id, 50);
            }
            else if (WAdebugMode) {
                console.log(JSON.parse(JSON.stringify(messages)))
            }
        }
        */

        return node;
    }

    var messages = [];
    var isScrappingMessages = false;
    var epoch = 8;

    NodeHandler.scrapMessages = function (jid, index, count) {
        messages = [];
        var startNode = ["query", {
            "type": "message", "kind": "before", "jid": jid, "count": count.toString(),
            "index": index, "owner": "true", "epoch": (epoch++).toString()
        }, null];
        WACrypto.sendNode(startNode);
        isScrappingMessages = true;
    }

    function parseMessage(e) {
        switch (nodeReader.tag(e)) {
            case "message":
                return messageTypes.WebMessageInfo.parse(nodeReader.children(e));
            case "groups_v2":
            case "broadcast":
            case "notification":
            case "call_log":
            case "security":
                return null;
            default:
                return null;
        }
    }

    var nodeReader =
    {
        tag: function (e) { return e && e[0] },
        attr: function (e, t) { return t && t[1] ? t[1][e] : void 0 },
        attrs: function (e) { return e[1] },
        child: function s(e, t) {
            var r = t[2];
            if (Array.isArray(r))
                for (var n = r.length, o = 0; o < n; o++) {
                    var s = r[o];
                    if (Array.isArray(s) && s[0] === e)
                        return s
                }
        },
        children: function (e) {
            return e && e[2]
        },
        dataStr: function (e) {
            if (!e) return "";
            var t = e[2];
            return "string" == typeof t ? t : t instanceof ArrayBuffer ? new BinaryReader(t).readString(t.byteLength) : void 0
        }
    }

})();

// ---------------------
// UI Event handlers
// ---------------------

document.addEventListener('onOptionsUpdate', function (e) {
    var options = JSON.parse(e.detail);
    if ('readConfirmationsHook' in options) readConfirmationsHookEnabled = options.readConfirmationsHook;
    if ('presenceUpdatesHook' in options) presenceUpdatesHookEnabled = options.presenceUpdatesHook;
    if ('safetyDelay' in options) safetyDelay = options.safetyDelay;
    if ('saveDeletedMsgs' in options) saveDeletedMsgsHook = options.saveDeletedMsgs;

    var safetyDelayPanel = document.getElementById("incognito-safety-delay-option-panel");
    var safetyDelayPanelExpectedHeight = 44; // be careful with this
    if (readConfirmationsHookEnabled) {
        getCSSRule('html[dir] .' + UIClassNames.UNREAD_COUNTER_CLASS).style.backgroundColor = 'rgba(9, 210, 97, 0.3)';
        if (safetyDelayPanel != null)
            Velocity(safetyDelayPanel, { height: safetyDelayPanelExpectedHeight, opacity: 1, marginTop: 15 },
                { defaultDuration: 200, easing: [.1, .82, .25, 1] });
    }
    else {
        getCSSRule('html[dir] .' + UIClassNames.UNREAD_COUNTER_CLASS).style.backgroundColor = 'rgba(9, 210, 97, 1)';
        if (safetyDelayPanel != null)
            Velocity(safetyDelayPanel, { height: 0, opacity: 0, marginTop: -10 }, { defaultDuration: 200, easing: [.1, .82, .25, 1] });
        var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ?
            document.getElementsByClassName("incognito-message")[0] : null;
        if (warningMessage != null) {
            Velocity(warningMessage, { scaleY: [0, 1], opacity: [0, 1] },
                { defaultDuration: 300, easing: [.1, .82, .25, 1] });
            setTimeout(function () { warningMessage.parentNode.removeChild(warningMessage); }, 300);
        }
    }

    if ('readConfirmationsHook' in options) {
        var unreadCounters = document.getElementsByClassName(UIClassNames.UNREAD_COUNTER_CLASS);
        for (var i = 0; i < unreadCounters.length; i++) {
            unreadCounters[i].className = UIClassNames.UNREAD_COUNTER_CLASS;
        }
    }
});

document.addEventListener('onReadConfirmationBlocked', function (e) {
    var blockedJid = e.detail;

    var chat = getCurrentChat();
    console.log("onReadConfirmationBlocked")

    if (readConfirmationsHookEnabled && safetyDelay > 0) {
        setTimeout(markChatAsPendingReciptsSending, 250);
    }
    else if (readConfirmationsHookEnabled && chat.id == blockedJid) {
        markChatAsBlocked(chat);
    }

    if (!(chat.id in blockedChats)) {
        // Temporarily removed due to react 16.0 changes
        /*
            var scrollToBottom = FindReact(document.getElementsByClassName("pane-chat-msgs")[0]).getScrollBottom();
                var messageVisiabillityDistance = warningMessage.clientHeight + parseFloat(getComputedStyle(warningMessage).marginBottom) + 
                                                parseFloat(getComputedStyle(warningMessage).marginTop) + parseFloat(getComputedStyle(warningMessage.parentNode).paddingBottom);
                if (scrollToBottom < messageVisiabillityDistance) 
                {
                    FindReact(document.getElementsByClassName("_9tCEa")[0].parentNode).scrollToBottom();
                }
        */

        // window.WhatsAppAPI.UI.scrollChatToBottom(chat);
    }

    blockedChats[chat.id] = chat;

});



document.addEventListener('onPaneChatOpened', function (e) {
    var chat = getCurrentChat();
    chats[chat.id] = chat;
});

function markChatAsPendingReciptsSending() {
    var chatWindow = document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0];
    var chat = getCurrentChat();
    var messageID = chat.id + chat.lastReceivedKey.id;
    var previousMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
    var seconds = safetyDelay;

    if (chatWindow != null && chat.unreadCount > 0 && (previousMessage == null || previousMessage.messageID != messageID)) {
        if (chat.id in blinkingChats) {
            seconds = blinkingChats[chat.id]["time"];
            clearInterval(blinkingChats[chat.id]["timerID"]);
        }

        // make a warning message at the chat panel
        var warningMessage = document.createElement('div');
        warningMessage.setAttribute('class', 'incognito-message middle');
        warningMessage.innerHTML = "Sending read receipts in " + seconds + " seconds...";
        warningMessage.messageID = messageID;

        var cancelButton = document.createElement('div');
        cancelButton.setAttribute('class', 'incognito-cancel-button');
        cancelButton.innerHTML = "Cancel";
        warningMessage.appendChild(cancelButton);

        // insert it under the unread counter, or at the end of the chat panel
        var parent = document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0];
        if (previousMessage != null)
            parent.removeChild(previousMessage);
        var unreadMarker = parent.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS).length > 0 ?
            parent.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS)[0] : null;
        if (unreadMarker != null)
            unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
        else {
            warningMessage.setAttribute('class', 'incognito-message');
            warningMessage.style = "padding-left: 9%; margin-bottom: 12px; margin-top: 10px;";
            parent.appendChild(warningMessage);
        }
        Velocity(warningMessage, { height: warningMessage.clientHeight, opacity: 1, marginTop: [12, 0], marginBottom: [12, 0] },
            { defaultDuration: 400, easing: [.1, .82, .25, 1] });

        // make the unread counter blink
        var blockedChat = findChatElementForJID(chat.id);
        if (blockedChat != null) {
            var unreadCounter = blockedChat.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);
            if (unreadCounter != null) {
                unreadCounter.className += " blinking";
            }
        }

        var id = setInterval(function () {
            seconds--;
            if (seconds > 0) {
                warningMessage.firstChild.textContent = "Sending read receipts in " + seconds + " seconds...";
                blinkingChats[chat.id] = { timerID: id, time: seconds, chat: chat };
            }
            else {
                // time's up, sending receipt
                clearInterval(id);
                var data = { jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
                document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));

                blockedChat.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS).className = UIClassNames.UNREAD_COUNTER_CLASS;
            }
        }, 1000);

        blinkingChats[chat.id] = { timerID: id, time: seconds, chat: chat };

        cancelButton.onclick = function () {
            clearInterval(id);
            delete blinkingChats[chat.id];

            markChatAsBlocked(chat);
        };
    }
}

function markChatAsBlocked(chat) {
    //
    // turn the unread counter of the chat to red
    //

    var blockedChat = findChatElementForJID(chat.id);
    if (blockedChat != null) {
        blockedChat.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS).className = UIClassNames.UNREAD_COUNTER_CLASS + " incognito";
    }
    var messageID = chat.id + chat.lastReceivedKey.id;

    //
    // Create a "receipts blocked" warning if needed
    //

    var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ?
        document.getElementsByClassName("incognito-message")[0] : null;
    var warningWasEmpty = warningMessage == null;
    if (warningMessage == null) {
        warningMessage = document.createElement('div');
        warningMessage.setAttribute('class', 'incognito-message middle');
        warningMessage.innerHTML = "Read receipts were blocked.";

        var sendButton = document.createElement('div');
        sendButton.setAttribute('class', 'incognito-send-button');
        sendButton.innerHTML = "Mark as read";
        warningMessage.appendChild(sendButton);
    }
    else {
        // we already have a warning message, remove it first
        warningMessage.remove();
    }

    var sendButton = warningMessage.lastChild;
    sendButton.setAttribute('class', 'incognito-send-button');
    sendButton.innerHTML = "Mark as read";
    sendButton.onclick = function () {
        var data = {
            name: chat.name, jid: chat.id, lastMessageIndex: chat.lastReceivedKey.id,
            fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount, isGroup: chat.isGroup,
            formattedName: chat.contact.formattedName
        };
        document.dispatchEvent(new CustomEvent('onMarkAsReadClick', { detail: JSON.stringify(data) }));
    };

    warningMessage.messageID = messageID;

    //
    // Put that warning under in the chat panel, under the unread counter or at the bottom
    //

    var parent = document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0];
    var unreadMarker = parent.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS).length > 0 ? parent.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS)[0] : null;
    if (unreadMarker != null)
        unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
    else {
        warningMessage.setAttribute('class', 'incognito-message');
        warningMessage.style = "padding-left: 9%; margin-bottom: 12px; margin-top: 10px;";
        parent.appendChild(warningMessage);
    }

    // if it didn't exist previously, animate it in
    if (blockedChats[chat.id] == undefined || warningWasEmpty)
        Velocity(warningMessage, { scaleY: [1, 0], opacity: [1, 0] }, { defaultDuration: 400, easing: [.1, .82, .25, 1] });
    warningMessage.firstChild.textContent = "Read receipts were blocked.";
}

function findChatElementForJID(jid) {
    var chatsShown = document.getElementsByClassName(UIClassNames.CHAT_ENTRY_CLASS);
    var blockedChat = null;
    for (var i = 0; i < chatsShown.length; i++) {
        var reactElement = FindReact(chatsShown[i]);
        if (reactElement.props.chat == undefined) continue;

        var id = reactElement.props.chat.id;

        var matches = false;
        if (typeof (jid) == "object" && id == jid) {
            matches = true;
        }
        else if (typeof (jid) == "string" && id.user == jid.split("@")[0]) {
            matches = true;
        }

        if (matches) {
            blockedChat = chatsShown[i];
            break;
        }

    }

    return blockedChat;
}

function getCurrentChat() {
    var elements = document.getElementsByClassName(UIClassNames.CHAT_PANEL_CLASS);
    if (elements.length == 0) return null;

    var reactResult = FindReact(elements[0]);
    var chat = null;
    if (Array.isArray(reactResult)) {
        for (var i = 0; i < reactResult.length; i++) {
            if (reactResult[i].props.chat !== undefined) {
                chat = reactResult[i].props.chat;
                break;
            }
        }
    }
    else {
        chat = reactResult.props.chat;
    }
    return chat;
}

function isChatBlocked(jid) {
    var user = jid.split("@")[0]

    for (jid in blockedChats) {
        if (jid.split("@")[0] == user)
            return true;
    }

    return false;
}

function getChatByJID(jid) {
    var chat = findChatElementForJID(jid);
    if (chat != null) {
        chat = FindReact(chat).props.chat;
    }
    else {
        chat = chats[jid];
    }

    return chat;
}

document.addEventListener('onDropdownOpened', function (e) {
    var menuItems = document.getElementsByClassName(UIClassNames.DROPDOWN_CLASS)[0].getElementsByClassName(UIClassNames.DROPDOWN_ENTRY_CLASS);
    var reactMenuItems = FindReact(document.getElementsByClassName(UIClassNames.OUTER_DROPDOWN_CLASS)[0])[0].props.children;
    var markAsReadButton = null;
    var props = null;
    for (var i = 0; i < reactMenuItems.length; i++) {
        if (reactMenuItems[i] == null) continue;

        if (reactMenuItems[i].key == ".$mark_unread") {
            markAsReadButton = menuItems[i];
            props = reactMenuItems[i].props;
            break;
        }
    }

    if (props != null) {
        var name = props.chat.name;
        var formattedName = props.chat.contact.formattedName;
        var jid = props.chat.id;
        var lastMessageIndex = props.chat.lastReceivedKey.id;
        var unreadCount = props.chat.unreadCount;
        var isGroup = props.chat.isGroup;
        var fromMe = props.chat.lastReceivedKey.fromMe;
        if (unreadCount > 0) {
            // this is mark-as-read button, not mark-as-unread
            markAsReadButton.addEventListener("mousedown", function (e) {
                var data = { name: name, formattedName: formattedName, jid: jid, lastMessageIndex: lastMessageIndex, fromMe: fromMe, unreadCount: unreadCount, isGroup: isGroup };
                document.dispatchEvent(new CustomEvent('onMarkAsReadClick', { detail: JSON.stringify(data) }));
            });
        }
    }
});

document.addEventListener('sendReadConfirmation', function (e) {
    var data = JSON.parse(e.detail);
    var messageIndex = data.index != undefined ? data.index : data.lastMessageIndex;
    var messageID = data.jid + messageIndex;

    var chat = getChatByJID(data.jid);

    exceptionsList.push(data.jid);
    WhatsAppAPI.Seen.sendSeen(chat).then(function (e) {
        if (data.jid in blinkingChats) {
            clearInterval(blinkingChats[data.jid]["timerID"]);
            delete blinkingChats[data.jid];
        }
        if (data.jid in blockedChats) {
            delete blockedChats[data.jid];
        }

        chat.unreadCount -= data.unreadCount;

    }).catch((error) => {
        console.error('Could not send read receipt');
        console.error(error.stack);
    });;

    var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
    if (warningMessage != null && warningMessage.messageID == messageID) {
        Velocity(warningMessage, { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
    }

    //var node = ["action",{"type":"set","epoch":"30"},[["read",{"jid":data.jid,"index":data.index,"owner":"false","count":data.unreadCount.toString()},null]]];
    //WACrypto.sendNode(node);
});

document.addEventListener('onIncognitoOptionsOpened', function (e) {
    var drop = document.getElementsByClassName("drop")[0];
    fixCSSPositionIfNeeded(drop);
    Velocity(drop, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 100, easing: [.1, .82, .25, 1] });

    var safetyDelayPanel = document.getElementById("incognito-safety-delay-option-panel");
    if (!readConfirmationsHookEnabled) {
        safetyDelayPanel.style.opacity = 0;
        safetyDelayPanel.style.height = 0;
        safetyDelayPanel.style.marginTop = "-10px"
    }
});

document.addEventListener('onIncognitoOptionsClosed', function (e) {
    var drop = document.getElementsByClassName("drop")[0];
    fixCSSPositionIfNeeded(drop);
    Velocity(drop, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 100, easing: [.1, .82, .25, 1] });

    if (!document.getElementById("incognito-radio-enable-safety-delay").checked) return;

    // validate safety delay
    var string = document.getElementById("incognito-option-safety-delay").value;
    var isValid = false;
    var number = Math.floor(Number(string));
    if ((String(number) === string && number >= 1 && number <= 30) || string == "") isValid = true;
    if (!isValid) {
        document.getElementById("incognito-option-safety-delay").disabled = true;
        document.getElementById("incognito-option-safety-delay").value = "";
        document.getElementById("incognito-radio-disable-safety-delay").checked = true;
        document.getElementById("incognito-radio-enable-safety-delay").checked = false;

        showToast("The safety delay must be an integer number in range 1-30 !");
    }
});

document.addEventListener('onMainUIReady', function (e) {
    exposeWhatsAppAPI();
});

// -------------------
// Helper functions
// --------------------

function showToast(message) {
    var appElement = document.getElementsByClassName("app-wrapper-web")[0];
    var toast = document.createElement("div");
    toast.setAttribute("class", "f1UZe");
    toast.style.transformOrigin = "left top";
    toast.innerHTML = "<div class=\"hYvJ8\">" + message + "</div>";
    appElement.insertBefore(toast, appElement.firstChild);
    Velocity(toast, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
    setTimeout(function () { Velocity(toast, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] }); }, 4000);
}

function getDeletedMsg() {

}

// Based on https://stackoverflow.com/a/39165137/1806873
// TODO: Update the function to support Reat 16+ in a good way
window.FindReact = function (dom) {
    for (var key in dom) {
        if (key.startsWith("__reactInternalInstance$")) {
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

function exposeWhatsAppAPI() {
    window.WhatsAppAPI = {}

    var moduleFinder = moduleRaid();
    window.WhatsAppAPI.Store = moduleFinder.findModule("Msg")[1];
    window.WhatsAppAPI.Seen = moduleFinder.findModule("sendSeen")[0];

    if (window.WhatsAppAPI.Seen == undefined) {
        console.error("WhatsAppWebIncognito: Can't find the WhatsApp API. Sending read receipts might not work.");
    }
}

function fixCSSPositionIfNeeded(drop) {
    if (drop.style.transform.includes("translateX") && drop.style.transform.includes("translateY")) {
        var matrix = drop.style.transform.replace(/[^0-9\-.,\s]/g, '').split(' ');
        drop.style.left = matrix[0] + "px";
        drop.style.top = matrix[1] + "px";
        drop.style.transform = "";
    }
}

function getCSSRule(ruleName) {
    var rules = {};
    var styleSheets = document.styleSheets;
    var styleSheetRules = null;
    for (var i = 0; i < styleSheets.length; ++i) {
        try {
            styleSheetRules = styleSheets[i].cssRules;
        }
        catch (e) {
            // Assume Chrome 64+ doesn't let us access this CSS due to security policies or whatever, just ignore
            continue;
        }
        if (styleSheetRules == null) continue;
        for (var j = 0; j < styleSheetRules.length; ++j)
            rules[styleSheetRules[j].selectorText] = styleSheetRules[j];
    }
    return rules[ruleName];
}