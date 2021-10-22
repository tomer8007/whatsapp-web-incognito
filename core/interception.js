// global variables
var readConfirmationsHookEnabled = true;
var presenceUpdatesHookEnabled = true;
var saveDeletedMsgsHookEnabled = false;
var safetyDelay = 0;

var isInitializing = true;
var exceptionsList = [];
var blinkingChats = {};
var chats = {};
var blockedChats = {};

var WAPassthrough = false;
var WAdebugMode = true;

// 
// Actual interception
// 

wsHook.before = function (originalData, url)
{
    //
    // a WebSocket frame is about to be sent out.
    //

    var isMultiDevice = !WACrypto.isTagBasedPayload(originalData);

    var promise = async function(originalData)
    {
        if (WAPassthrough) return originalData;

        try
        {
            var data = originalData;
            var isMultiDevice = !WACrypto.isTagBasedPayload(data);
    
            var tag = "";
            if (!isMultiDevice)
            {
                payload = WACrypto.parseWebSocketPayload(data);
                tag = payload.tag;
                data = payload.data;
            }
    
            if (data instanceof ArrayBuffer || data instanceof Uint8Array)
            {
                // encrytped binary payload
                var decryptedFrames =  await WACrypto.decryptWithWebCrypto(data, isMultiDevice, false);
                if (decryptedFrames == null) 
                {
                    return originalData;
                }
    
                for (var i = 0; i < decryptedFrames.length; i++)
                {
                    var decryptedFrameInfo = decryptedFrames[i];
                    var decryptedFrame = decryptedFrameInfo.frame;
                    var counter = decryptedFrameInfo.counter;
    
                    var nodeParser = new NodeParser(isMultiDevice);
                    var node = nodeParser.readNode(new NodeBinaryReader(decryptedFrame));
    
                    if (isInitializing)
                    {
                        isInitializing = false;
                        console.log("WhatsIncognito: Interception is working.");
                        document.dispatchEvent(new CustomEvent('onInterceptionWorking', 
                                { detail: JSON.stringify({isInterceptionWorking: true, isMultiDevice: isMultiDevice}) }));
                    }
                    
                    if (WAdebugMode)
                    {
                        console.log("[Out] Sending binary with tag '" + tag + "' (" + decryptedFrame.byteLength + " bytes, decrypted): ");
                        console.log(node);
                    }
    
                    var isAllowed = NodeHandler.isSentNodeAllowed(node, tag);
                    var manipulatedNode = node.slice();
                    if (!isAllowed)
                    {
                        if (!isMultiDevice) return null;
                        manipulatedNode[0] = "blocked_node";
                    }
    
                    manipulatedNode = await NodeHandler.manipulateSentNode(manipulatedNode, isMultiDevice);
                    decryptedFrames[i] = {node: manipulatedNode, counter: counter};
                }
    
                return WACrypto.packNodesForSending(decryptedFrames, isMultiDevice, false, tag);
                
            }
            else
            {
                // textual payload
                if (WAdebugMode) console.log("[Out] Sending message with tag '" + tag + "':");
                if (data != "" && WAdebugMode) console.log(data);
                return originalData;
            }
        }
        catch (exception)
        {
            console.error("WhatsIncognito: Passing-through outgoing packet due to exception:");
            console.error(exception);
            return originalData;
        }
    };

    return isMultiDevice ? MultiDevice.enqueuePromise(promise, originalData, false) : promise(originalData);
}

wsHook.after = function (messageEvent, url)
{
    //
    // a WebScoket frame was received from network.
    //

    var data = messageEvent.data;
    var isMultiDevice = !WACrypto.isTagBasedPayload(data);

    var promise = async function(messageEvent)
    {
        var data = messageEvent.data;
        var isMultiDevice = !WACrypto.isTagBasedPayload(data);

        if (WAPassthrough) return messageEvent;

        try
        {
            var tag = "";
            if (!isMultiDevice)
            {
                payload = WACrypto.parseWebSocketPayload(data);
                tag = payload.tag;
                data = payload.data;
            }
    
            if (data instanceof ArrayBuffer || data instanceof Uint8Array)
            {
                var decryptedFrames = await WACrypto.decryptWithWebCrypto(data, isMultiDevice, true);
                if (decryptedFrames == null) return messageEvent;
    
                for (var i = 0; i < decryptedFrames.length; i++)
                {
                    var decryptedFrameInfo = decryptedFrames[i];
                    var decryptedFrame = decryptedFrameInfo.frame;
                    var counter = decryptedFrameInfo.counter;
    
                    var nodeParser = new NodeParser(isMultiDevice);
                    var node = nodeParser.readNode(new NodeBinaryReader(decryptedFrame));
    
                    if (WAdebugMode)
                    {
                        console.log("[In] Received binary with tag '" + tag + "' (" + decryptedFrame.byteLength + " bytes, decrypted)): ");
                        console.log(node);
                    }
    
                    var isAllowed = await NodeHandler.isReceivedNodeAllowed(node, tag);
                    var manipulatedNode = node.slice();
                    if (!isAllowed)
                    {
                        if (!isMultiDevice) return null;
                        manipulatedNode[0] = "blocked_node";
                    }
    
                    manipulatedNode = await NodeHandler.manipulateReceivedNode(manipulatedNode, tag);
                    decryptedFrames[i] = {node: manipulatedNode, counter: counter};
                }
    
                return WACrypto.packNodesForSending(decryptedFrames, isMultiDevice, true, tag).then(function (packet)
                {
                    messageEvent.data = packet;
                    return messageEvent;
                });
                
            }
            else
            {
                // textual payload
                if (WAdebugMode) console.log("[In] Received message with tag '" + tag + "':");
                if (data != "" && WAdebugMode)
                    console.log(data);
    
                return messageEvent;
            }
        }
        catch (e)
        {
            console.error("Passing-through incoming packet due to error:");
            console.error(e);
            return messageEvent;
        };
    };

    return isMultiDevice ? MultiDevice.enqueuePromise(promise, messageEvent, true) : promise(messageEvent);
}

//
// Handling nodes
//

var NodeHandler = {};

(function ()
{
    NodeHandler.isSentNodeAllowed = function (node, tag)
    {
        var subNodes = [node];
        if (Array.isArray(nodeReader.children(node))) 
        {
            subNodes = subNodes.concat(nodeReader.children(node));
        }

        for (var i = 0; i < subNodes.length; i++)
        {
            var child = subNodes[i];

            var action = child[0];
            var data = child[1];
            var shouldBlock = 
                (readConfirmationsHookEnabled && action === "read" ||
                readConfirmationsHookEnabled && action == "receipt" && data["type"] == "read" ||
                readConfirmationsHookEnabled && action == "received" && data["type"] === "played") ||

                (presenceUpdatesHookEnabled && action === "presence" && data["type"] === "available") ||
                (presenceUpdatesHookEnabled && action == "presence" && data["type"] == "composing") ||
                (presenceUpdatesHookEnabled && action == "chatstate" && child[2][0][0] == "composing");

            if (shouldBlock)
            {
                switch (action)
                {
                    case "read":
                    case "receipt":
                        var jid = data.jid ? data.jid : data.to;
                        var isReadReceiptAllowed = exceptionsList.includes(jid);
                        if (isReadReceiptAllowed)
                        {
                            // this is the user trying to send out a read receipt.
                            console.log("WhatsIncongito: Allowing read receipt to " + jid);

                            // exceptions are one-time operation, so remove it from the list
                            exceptionsList = exceptionsList.filter(i => i !== jid)

                            return true;
                        }
                        else
                        {
                            // We do not allow sending this read receipt.
                            // invoke the callback and fake a failure response from server
                            document.dispatchEvent(new CustomEvent('onReadConfirmationBlocked', {
                                detail: jid
                            }));

                            if (action == "read" && wsHook.onMessage)
                            {
                                var messageEvent = new MutableMessageEvent({ data: tag + ",{\"status\": 403}" });
                                wsHook.onMessage(messageEvent);
                            }

                        }
                        break;

                    case "presence":
                        //var messageEvent = new MutableMessageEvent({ data: tag + ",{\"status\": 200}" });
                        //wsHook.onMessage(messageEvent);
                        break;
                }

                console.log("WhatsIncognito: --- Blocking " + action.toUpperCase() + " action! ---");
                console.log(node);

                return false;
            }
        }

        return true;
    }

    NodeHandler.manipulateSentNode = async function (node, isMultiDevice)
    {
        try
        {
            if (nodeReader.tag(node) != "message" && nodeReader.tag(node) != "action") return node;

            if (isMultiDevice)
            {
                var participants = nodeReader.children(node)[0];
                var children = nodeReader.children(participants);
                for (var i = 0; i < children.length; i++)
                {
                    var childNode = children[i];
                    if (nodeReader.tag(childNode) != "to") continue;

                    var messageNode = nodeReader.children(childNode)[0];
                    if (nodeReader.tag(messageNode) == "enc")
                    {
                        childNode = await this.manipulateSentMessageNode(childNode);
                        children[i] = childNode;
                    }
                }
            }
            else if (nodeReader.tag(node) == "action")
            {
                var children = nodeReader.children(node);
                for (var i = 0; i < children.length; i++)
                {
                    var child = children[i];
                    if (nodeReader.tag(child) == "message")
                    {
                        var messageNode = await this.manipulateSentMessageNode(child);
                        children[i] = messageNode;
                    }
                }
            }
            
        }
        catch (exception)
        {
            console.error("WhatsIncognito: Allowing WA packet due to exception:");
            console.error(exception);
            return node;
        }

        return node;
    }

    NodeHandler.manipulateSentMessageNode = async function (messageNode)
    {
        var remoteJid = null;
        if (messageNode[1] == undefined)
        {
            var message = await parseMessage(messageNode);
            if (WAdebugMode)
            {
                console.log("WAIncognito: Sending message:");
                console.log(message);
            }

            // non muti-device.
            if (message == null || message.key == null) return;
            remoteJid = message.key.remoteJid;
        }
        else
        {
            // multi device
            if (nodeReader.tag(messageNode) != "to") debugger;
            remoteJid = messageNode[1]["jid"] ? messageNode[1]["jid"]: messageNode[1]["from"];
        }

        if (remoteJid && isChatBlocked(remoteJid))
        {
            // If the user replyed to a message from this JID,
            // It probably means we can send read receipts for it.

            var chat = getChatByJID(remoteJid);
            var data = { jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
            setTimeout(function () { document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) })); }, 600);
        }

        // do message manipulation if needed
        //         ...
        var putBreakpointHere = 1;

        // TODO: following lines are commented out because apperently the message parsing above is not complete,
        // so the message is not always restored identically

        // re-assmble everything
        // messageBuffer = messageTypes.WebMessageInfo.encode(message).readBuffer();
        // subNode[2] = messageBuffer; children[i] = subNode; node[2] = children;

        return messageNode;
    }


    NodeHandler.isReceivedNodeAllowed = async function (node, tag)
    {
        var isAllowed = true;

        try
        {
            var nodeTag = nodeReader.tag(node);
            var children = nodeReader.children(node);
            if (nodeTag != "action" && nodeTag != "message") return true;

            // scan for message nodes
            var messages = [];
            var nodes = [node];
            if (Array.isArray(children)) nodes = nodes.concat(children);
            for (var i = 0 ; i < nodes.length; i++)
            {
                var node = nodes[i];
                if (nodeReader.tag(node) != "message") continue;

                var childs = nodeReader.children(node);
                var isMultiDevice = Array.isArray(childs) && nodeReader.tag(childs[0]) == "enc";

                var message = await parseMessage(node);
                messages.push(message);

                var remoteJid = null;
                if (!isMultiDevice)
                {
                    // non multi-device
                    remoteJid = message.key.remoteJid;
                    messageId = message.key.id;
                    message = message.message;
                }
                else if (node[1] != null)
                {
                    remoteJid = node[1]["from"];
                    messageId = node[1]["id"];
                }

                //
                // Check if this is a message deletion node
                //
                var messageRevokeValue = messageTypes.Message.ProtocolMessage.TYPE.REVOKE;
                if (message && message.protocolMessage && message.protocolMessage.type == messageRevokeValue)
                {
                    var deletedMessageId = message.protocolMessage.key.id;
                    
                    // someone deleted a message, block
                    if (saveDeletedMsgsHookEnabled)
                    {
                        const chat = getChatByJID(remoteJid);
                        if (chat)
                        {
                            const msgs = chat.msgs.models;
                        
                            for (let i = 0; i < msgs.length; i++)
                            {
                                if (msgs[i].id.id == deletedMessageId)
                                {
                                    saveDeletedMessage(msgs[i], message.protocolMessage.key, messageId);
                                    break;
                                }
                            }
                        }

                        console.log("WhatsIncognito: --- Blocking message REVOKE action! ---");
                        isAllowed = false;
                        break;
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

        if (WAdebugMode && messages.length > 0)
        {
            console.log("Got messages:");
            console.log(messages);
        }

        return isAllowed;
    }

    NodeHandler.manipulateReceivedNode = async function (node)
    {
        var messages = [];
        var children = nodeReader.children(node);
        var type = nodeReader.attr("type", node);

        return node;
    }

    var messages = [];
    var isScrappingMessages = false;
    var epoch = 8;

    NodeHandler.scrapMessages = function (jid, index, count)
    {
        messages = [];
        var startNode = ["query", {
            "type": "message", "kind": "before", "jid": jid, "count": count.toString(),
            "index": index, "owner": "true", "epoch": (epoch++).toString()
        }, null];
        WACrypto.sendNode(startNode);
        isScrappingMessages = true;
    }

    async function parseMessage(e)
    {
        var children = nodeReader.children(e);
        var isMultiDevice = Array.isArray(children) && nodeReader.tag(children[0]) == "enc";

        if (!isMultiDevice)
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
                    return null;
                default:
                    return null;
            }
        }
        else
        {
            return decryptE2EMessage(e);
        }
    }

    async function decryptE2EMessage(messageNode)
    {
        if (messageNode[2][0][0] != "enc") return null;

        var remoteJid = messageNode[1]["jid"] ? messageNode[1]["jid"] : messageNode[1]["from"];

        var ciphertext = messageNode[2][0][2];
        var chiphertextType = messageNode[2][0][1]["type"];

        var storage = new moduleRaid().findModule("SessionStoreWriteBackCache")[0].default;
        storage.flushBufferToDiskIfNotMemOnlyMode();

        // back up the signal database
        var signalDBRequest = indexedDB.open("signal-storage", 70);
        var signalDB = await new Promise((resolve, reject) => { signalDBRequest.onsuccess = () => { resolve(signalDBRequest.result); }
            signalDBRequest.onerror = () => {console.error("can't open signal-storage."); reject(false);}
        });
        var exported = await exportIdbDatabase(signalDB);

        // decrypt the message
        var address = new libsignal.SignalProtocolAddress(remoteJid.substring(0, remoteJid.indexOf("@")), 0);
        var sessionCipher = new libsignal.SessionCipher(storage, address);
        var message = chiphertextType == "pkmsg" ? await sessionCipher.decryptPreKeyWhisperMessage(ciphertext)
                                : await sessionCipher.decryptWhisperMessage(ciphertext);
        
        // unpad the message
        message = new Uint8Array(message);
        message = new Uint8Array(message.buffer,message. byteOffset,message.length - message[message.length - 1]);
        
        // restore the signal database
        await clearDatabase(signalDB);
        importToIdbDatabase(signalDB, exported);
        await new Promise((resolve, reject) => { setTimeout(() => {signalDB.close(); resolve();}, 80); });

        storage.deleteAllCache();

        return messageTypes.Message.parse(message);
        
    }

    var nodeReader =
    {
        tag: function (e) { return e && e[0] },
        attr: function (e, t) { return t && t[1] ? t[1][e] : void 0 },
        attrs: function (e) { return e[1] },
        child: function s(e, t)
        {
            var r = t[2];
            if (Array.isArray(r))
                for (var n = r.length, o = 0; o < n; o++)
                {
                    var s = r[o];
                    if (Array.isArray(s) && s[0] === e)
                        return s
                }
        },
        children: function (e)
        {
            return e && e[2]
        },
        dataStr: function (e)
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

document.addEventListener('onOptionsUpdate', function (e)
{
    // update options
    var options = JSON.parse(e.detail);
    if ('readConfirmationsHook' in options) readConfirmationsHookEnabled = options.readConfirmationsHook;
    if ('presenceUpdatesHook' in options) presenceUpdatesHookEnabled = options.presenceUpdatesHook;
    if ('safetyDelay' in options) safetyDelay = options.safetyDelay;
    if ('saveDeletedMsgs' in options) saveDeletedMsgsHookEnabled = options.saveDeletedMsgs;

    // update graphics
    var safetyDelayPanel = document.getElementById("incognito-safety-delay-option-panel");
    var safetyDelayPanelExpectedHeight = 42; // be careful with this
    var cssRule = getCSSRule('html[dir] .' + UIClassNames.UNREAD_COUNTER_CLASS);
    if (readConfirmationsHookEnabled)
    {
        if (cssRule != undefined)
        {
            cssRule.style.backgroundColor = 'rgba(9, 210, 97, 0.3)';
        }
        if (safetyDelayPanel != null)
        {
            Velocity(safetyDelayPanel, { height: safetyDelayPanelExpectedHeight, opacity: 1, marginTop: 0 },
                { defaultDuration: 200, easing: [.1, .82, .25, 1] });
        }
    }
    else
    {
        if (cssRule != undefined)
        {
            cssRule.style.backgroundColor = 'rgba(9, 210, 97, 1)';
        }
        if (safetyDelayPanel != null)
        {
            Velocity(safetyDelayPanel, { height: 0, opacity: 0, marginTop: -10 }, { defaultDuration: 200, easing: [.1, .82, .25, 1] });
        }
        var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ?
            document.getElementsByClassName("incognito-message")[0] : null;
        if (warningMessage != null)
        {
            Velocity(warningMessage, { scaleY: [0, 1], opacity: [0, 1] },
                { defaultDuration: 300, easing: [.1, .82, .25, 1] });
            setTimeout(function () { warningMessage.parentNode.removeChild(warningMessage); }, 300);
        }
    }

    if ('readConfirmationsHook' in options)
    {
        var unreadCounters = document.getElementsByClassName(UIClassNames.UNREAD_COUNTER_CLASS);
        for (var i = 0; i < unreadCounters.length; i++)
        {
            unreadCounters[i].className = UIClassNames.UNREAD_COUNTER_CLASS;
        }
    }
});

document.addEventListener('onReadConfirmationBlocked', function (e)
{
    var blockedJid = e.detail;

    var chat = getChatByJID(blockedJid);
    if (readConfirmationsHookEnabled && safetyDelay > 0)
    {
        setTimeout(markChatAsPendingReciptsSending, 250);
    }
    else if (readConfirmationsHookEnabled && chat.id == blockedJid)
    {
        markChatAsBlocked(chat);
    }

    if (!(chat.id in blockedChats))
    {
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


document.addEventListener('onPaneChatOpened', function (e)
{
    var chat = getCurrentChat();
    chats[chat.id] = chat;
});

function markChatAsPendingReciptsSending()
{
    var chatWindow = document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0];
    var chat = getCurrentChat();
    var messageID = chat.id + chat.lastReceivedKey.id;
    var previousMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
    var seconds = safetyDelay;

    if (chatWindow != null && chat.unreadCount > 0 && (previousMessage == null || previousMessage.messageID != messageID))
    {
        if (chat.id in blinkingChats)
        {
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
        else
        {
            warningMessage.setAttribute('class', 'incognito-message');
            warningMessage.style = "padding-left: 9%; margin-bottom: 12px; margin-top: 10px;";
            parent.appendChild(warningMessage);
        }
        Velocity(warningMessage, { height: warningMessage.clientHeight, opacity: 1, marginTop: [12, 0], marginBottom: [12, 0] },
            { defaultDuration: 400, easing: [.1, .82, .25, 1] });

        // make the unread counter blink
        var blockedChat = findChatElementForJID(chat.id);
        if (blockedChat != null)
        {
            var unreadCounter = blockedChat.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);
            if (unreadCounter != null)
            {
                unreadCounter.className += " blinking";
            }
        }

        var id = setInterval(function ()
        {
            seconds--;
            if (seconds > 0)
            {
                warningMessage.firstChild.textContent = "Sending read receipts in " + seconds + " seconds...";
                blinkingChats[chat.id] = { timerID: id, time: seconds, chat: chat };
            }
            else
            {
                // time's up, sending receipt
                clearInterval(id);
                var data = { jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
                document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));

                blockedChat.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS).className = UIClassNames.UNREAD_COUNTER_CLASS;
            }
        }, 1000);

        blinkingChats[chat.id] = { timerID: id, time: seconds, chat: chat };

        cancelButton.onclick = function ()
        {
            clearInterval(id);
            delete blinkingChats[chat.id];

            markChatAsBlocked(chat);
        };
    }
}

function markChatAsBlocked(chat)
{
    //
    // turn the unread counter of the chat to red
    //

    var chatUnreadRead = chat.unreadCount;
    
    var currentChat = getCurrentChat();
    
    function mark()
    {
        var blockedChatElem = findChatElementForJID(chat.id);
        chat.pendingSeenCount = 0;

        if (blockedChatElem != null)
        {
            var unreadCounter = blockedChatElem.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);
            if (unreadCounter)
                unreadCounter.className = UIClassNames.UNREAD_COUNTER_CLASS + " incognito";
        }
    }

    mark();
    setTimeout(mark, 200); // for multi-device pendingSeenCount

    var messageID = chat.id + chat.lastReceivedKey.id;

    if (currentChat.id == chat.id)
    {

        //
        // Create a "receipts blocked" warning if needed
        //

        var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ?
        document.getElementsByClassName("incognito-message")[0] : null;
        var warningWasEmpty = warningMessage == null;
        if (warningMessage == null)
        {
            warningMessage = document.createElement('div');
            warningMessage.setAttribute('class', 'incognito-message middle');
            warningMessage.innerHTML = "Read receipts were blocked.";

            var sendButton = document.createElement('div');
            sendButton.setAttribute('class', 'incognito-send-button');
            sendButton.innerHTML = "Mark as read";
            warningMessage.appendChild(sendButton);
        }
        else
        {
            // we already have a warning message, remove it first
            warningMessage.remove();
        }

        var sendButton = warningMessage.lastChild;
        sendButton.setAttribute('class', 'incognito-send-button');
        sendButton.innerHTML = "Mark as read";
        sendButton.onclick = function ()
        {
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
        else
        {
            warningMessage.setAttribute('class', 'incognito-message');
            warningMessage.style = "padding-left: 9%; margin-bottom: 12px; margin-top: 10px;";
            parent.appendChild(warningMessage);
        }
    }
    

    // if it didn't exist previously, animate it in
    if (blockedChats[chat.id] == undefined || warningWasEmpty)
        Velocity(warningMessage, { scaleY: [1, 0], opacity: [1, 0] }, { defaultDuration: 400, easing: [.1, .82, .25, 1] });

    if (warningMessage)
        warningMessage.firstChild.textContent = "Read receipts were blocked.";
}

document.addEventListener('onDropdownOpened', function (e)
{
    var menuItems = document.getElementsByClassName(UIClassNames.DROPDOWN_CLASS)[0].getElementsByClassName(UIClassNames.DROPDOWN_ENTRY_CLASS);
    var reactResult = FindReact(document.getElementsByClassName(UIClassNames.OUTER_DROPDOWN_CLASS)[0]);
    var reactMenuItems = reactResult.props.children[0].props.children;
    if (reactMenuItems.props == undefined) return;
    reactMenuItems = reactMenuItems.props.children;

    var markAsReadButton = null;
    var props = null;
    for (var i = 0; i < reactMenuItems.length; i++)
    {
        if (reactMenuItems[i] == null) continue;

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
        var formattedName = props.chat.contact.formattedName;
        var jid = props.chat.id;
        var lastMessageIndex = props.chat.lastReceivedKey.id;
        var unreadCount = props.chat.unreadCount;
        var isGroup = props.chat.isGroup;
        var fromMe = props.chat.lastReceivedKey.fromMe;
        if (unreadCount > 0)
        {
            // this is mark-as-read button, not mark-as-unread
            markAsReadButton.addEventListener("mousedown", function (e)
            {
                var data = { name: name, formattedName: formattedName, jid: jid, lastMessageIndex: lastMessageIndex, fromMe: fromMe, unreadCount: unreadCount, isGroup: isGroup };
                document.dispatchEvent(new CustomEvent('onMarkAsReadClick', { detail: JSON.stringify(data) }));
            });
        }
    }
});

document.addEventListener('sendReadConfirmation', function (e)
{
    var data = JSON.parse(e.detail);
    var messageIndex = data.index != undefined ? data.index : data.lastMessageIndex;
    var messageID = data.jid + messageIndex;

    var chat = getChatByJID(data.jid);

    exceptionsList.push(data.jid);
    WhatsAppAPI.Seen.sendSeen(chat).then(function (e)
    {
        if (data.jid in blinkingChats)
        {
            clearInterval(blinkingChats[data.jid]["timerID"]);
            delete blinkingChats[data.jid];
        }
        if (data.jid in blockedChats)
        {
            delete blockedChats[data.jid];
        }

        chat.unreadCount -= data.unreadCount;

    }).catch((error) =>
    {
        console.error('Could not send read receipt');
        console.error(error.stack);
    });;

    var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
    if (warningMessage != null && warningMessage.messageID == messageID)
    {
        Velocity(warningMessage, { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
    }

    //var node = ["action",{"type":"set","epoch":"30"},[["read",{"jid":data.jid,"index":data.index,"owner":"false","count":data.unreadCount.toString()},null]]];
    //WACrypto.sendNode(node);
});

document.addEventListener('onIncognitoOptionsOpened', function (e)
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

document.addEventListener('onIncognitoOptionsClosed', function (e)
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

        showToast("The safety delay must be an integer number in range 1-30 !");
    }
});

document.addEventListener('onMainUIReady', function (e)
{
    setTimeout(exposeWhatsAppAPI, 100);
});

// -------------------
// Helper functions
// --------------------

function findChatElementForJID(jid)
{
    var chatsShown = document.getElementsByClassName(UIClassNames.CHAT_ENTRY_CLASS);
    var blockedChat = null;
    for (var i = 0; i < chatsShown.length; i++)
    {
        var reactElement = FindReact(chatsShown[i]);
        if (reactElement.props.data == undefined) continue;

        var id = reactElement.props.data.data.id;

        var matches = false;
        if (typeof (jid) == "object" && id == jid)
        {
            matches = true;
        }
        else if (typeof (jid) == "string" && id.user == jid.split("@")[0])
        {
            matches = true;
        }

        if (matches)
        {
            blockedChat = chatsShown[i];
            break;
        }

    }

    return blockedChat;
}

function getCurrentChat()
{
    var elements = document.getElementsByClassName(UIClassNames.CHAT_PANEL_CLASS);
    if (elements.length == 0) return null;

    var reactResult = FindReact(elements[0]);
    var chat = null;
    if (Array.isArray(reactResult))
    {
        for (var i = 0; i < reactResult.length; i++)
        {
            if (reactResult[i].props.chat !== undefined)
            {
                chat = reactResult[i].props.chat;
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

function isChatBlocked(jid)
{
    var user = jid.split("@")[0]

    for (jid in blockedChats)
    {
        if (jid.split("@")[0] == user)
            return true;
    }

    return false;
}

function getChatByJID(jid)
{
    var chat = findChatElementForJID(jid);
    if (chat != null)
    {
        chat = FindReact(chat).props.data.data;
    }
    else
    {
        chat = chats[jid];
    }

    return chat;
}


var deletedDB = indexedDB.open("deletedMsgs", 1);

deletedDB.onupgradeneeded = function (e)
{
    // triggers if the client had no database
    // ...perform initialization...
    let db = deletedDB.result;
    switch (e.oldVersion)
    {
        case 0:
            db.createObjectStore('msgs', { keyPath: 'id' });
            console.log('WhatsIncognito: Deleted messages database generated');
            break;
    }
};
deletedDB.onerror = function ()
{
    console.error("WhatsIncognito: Error opening database");
    console.error("Error", deletedDB);
};
deletedDB.onsuccess = () =>
{
    console.log("WhatsIncognito: Database loaded");
}

const saveDeletedMessage = async (retrievedMsg, deletedMessageKey, revokeMessageID) =>
{
    // Determine author data
    let author = "";
    if (deletedMessageKey.fromMe || !retrievedMsg.isGroupMsg) 
        author = retrievedMsg.from.user;
    else 
        author = retrievedMsg.author.user;

    let body = "";
    let isMedia = false;

    // Stickers & Documents are not considered media for some reason, so we have to check if it has a mediaKey and also set isMedia == true
    if (retrievedMsg.isMedia || retrievedMsg.mediaKey)
    {
        isMedia = true;

        // get extended media key              
        try
        {
            const decryptedData = await WhatsAppAPI.downloadManager.default.downloadAndDecrypt({ directPath: retrievedMsg.directPath, 
                                                                                            encFilehash: retrievedMsg.encFilehash, 
                                                                                            filehash: retrievedMsg.filehash, 
                                                                                            mediaKey: retrievedMsg.mediaKey, 
                                                                                            type: retrievedMsg.type, signal: (new AbortController).signal });
            body = arrayBufferToBase64(decryptedData);

        }
        catch (e) { console.error(e); }
    }
    else 
    {   
        body = retrievedMsg.body;
    }

    let deletedMsgContents = {}
    deletedMsgContents.id = revokeMessageID;
    deletedMsgContents.originalID = retrievedMsg.id.id;
    deletedMsgContents.body = body;
    deletedMsgContents.timestamp = retrievedMsg.t;
    deletedMsgContents.from = author;
    deletedMsgContents.isMedia = isMedia;
    deletedMsgContents.fileName = retrievedMsg.filename;
    deletedMsgContents.mimetype = retrievedMsg.mimetype;
    deletedMsgContents.type = retrievedMsg.type;
    deletedMsgContents.mediaText = retrievedMsg.text;
    deletedMsgContents.Jid = deletedMessageKey.remoteJid;
    deletedMsgContents.lng = retrievedMsg.lng;
    deletedMsgContents.lat = retrievedMsg.lat;

    if ("id" in deletedMsgContents)
    {
        const transcation = deletedDB.result.transaction('msgs', "readwrite");
        let request = transcation.objectStore("msgs").add(deletedMsgContents);
        request.onerror = (e) =>
        {

            // ConstraintError occurs when an object with the same id already exists
            if (request.error.name == "ConstraintError")
            {
                console.log("WhatsIncognito: Error saving message, message ID already exists");
            } 
            else
            {
                console.log("WhatsIncognito: Unexpected error saving deleted message");
            }
        };
        request.onsuccess = (e) =>
        {
            console.log("WhatsIncognito: Saved deleted message with ID " + deletedMsgContents.id + " from " + deletedMsgContents.from + " successfully.");
        }
    }
    else
    {
        console.log("WhatsIncognito: Deleted message contents not found");
    }

}

const arrayBufferToBase64 = (buffer) =>
{
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++)
    {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function showToast(message)
{
    var appElement = document.getElementsByClassName("app-wrapper-web")[0];
    var toast = document.createElement("div");
    toast.setAttribute("class", "f1UZe");
    toast.style.transformOrigin = "left top";
    toast.innerHTML = "<div class=\"hYvJ8\">" + message + "</div>";
    appElement.insertBefore(toast, appElement.firstChild);
    Velocity(toast, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
    setTimeout(function () { Velocity(toast, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] }); }, 4000);
}

function exportIdbDatabase(idbDatabase) {
    return new Promise((resolve, reject) => {
      const exportObject = {}
      if (idbDatabase.objectStoreNames.length === 0) {
        resolve(JSON.stringify(exportObject))
      } else {
        const transaction = idbDatabase.transaction(
          idbDatabase.objectStoreNames,
          'readonly'
        )
  
        transaction.addEventListener('error', reject)
  
        for (const storeName of idbDatabase.objectStoreNames) {
          const allObjects = []
          transaction
            .objectStore(storeName)
            .openCursor()
            .addEventListener('success', event => {
              const cursor = event.target.result
              if (cursor) {
                // Cursor holds value, put it into store data
                allObjects.push(cursor.value)
                cursor.continue();
              } else {
                // No more values, store is done
                exportObject[storeName] = allObjects
  
                // Last store was handled
                if (idbDatabase.objectStoreNames.length === Object.keys(exportObject).length) {
                  resolve(exportObject);
                }
              }
            })
        }
      }
    })
  }

function importToIdbDatabase(idbDatabase, importObject) {
    return new Promise((resolve, reject) => {
      const transaction = idbDatabase.transaction(
        idbDatabase.objectStoreNames,
        'readwrite'
      )
      transaction.addEventListener('error', reject)
  
      for (const storeName of idbDatabase.objectStoreNames) {
        let count = 0
        for (const toAdd of importObject[storeName]) {
          const request = transaction.objectStore(storeName).add(toAdd)
          request.addEventListener('success', () => {
            count++
            if (count === importObject[storeName].length) {
              // Added all objects for this store
              delete importObject[storeName]
              if (Object.keys(importObject).length === 0) {
                // Added all object stores
                resolve()
              }
            }
          })
        }
      }
    })
  }

  function clearDatabase(idbDatabase) {
    return new Promise((resolve, reject) => {
      const transaction = idbDatabase.transaction(
        idbDatabase.objectStoreNames,
        'readwrite'
      )
      transaction.addEventListener('error', reject)
  
      let count = 0
      for (const storeName of idbDatabase.objectStoreNames) {
        transaction
          .objectStore(storeName)
          .clear()
          .addEventListener('success', () => {
            count++
            if (count === idbDatabase.objectStoreNames.length) {
              // Cleared all object stores
              resolve()
            }
          })
      }
    })
}

// Based on https://stackoverflow.com/a/39165137/1806873
function FindReact(dom, traverseUp = 0) 
{
    const key = Object.keys(dom).find(key=>{
        return key.startsWith("__reactFiber$") // react 17+
            || key.startsWith("__reactInternalInstance$"); // react <17
    });
    const domFiber = dom[key];
    if (domFiber == null) return null;

    // react <16
    if (domFiber._currentElement) {
        let compFiber = domFiber._currentElement._owner;
        for (let i = 0; i < traverseUp; i++) {
            compFiber = compFiber._currentElement._owner;
        }
        return compFiber._instance;
    }

    // react 16+
    const GetCompFiber = fiber=>{
        //return fiber._debugOwner; // this also works, but is __DEV__ only
        let parentFiber = fiber.return;
        while (typeof parentFiber.type == "string") {
            parentFiber = parentFiber.return;
        }
        return parentFiber;
    };
    let compFiber = GetCompFiber(domFiber);
    for (let i = 0; i < traverseUp; i++) {
        compFiber = GetCompFiber(compFiber);
    }
    return compFiber.stateNode;
}

function exposeWhatsAppAPI()
{
    window.WhatsAppAPI = {}

    var moduleFinder = moduleRaid();
    window.WhatsAppAPI.downloadManager = moduleFinder.findModule("downloadAndDecrypt")[0];
    window.WhatsAppAPI.Store = moduleFinder.findModule("Msg")[1];
    window.WhatsAppAPI.Seen = moduleFinder.findModule("sendSeen")[0];

    if (window.WhatsAppAPI.Seen == undefined)
    {
        console.error("WhatsAppWebIncognito: Can't find the WhatsApp API. Sending read receipts might not work.");
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
    for (var i = 0; i < styleSheets.length; ++i)
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
        for (var j = 0; j < styleSheetRules.length; ++j)
            rules[styleSheetRules[j].selectorText] = styleSheetRules[j];
    }
    return rules[ruleName];
}