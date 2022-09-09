// 
// Interception of WhatsApp packets and handling nodes
//

var readConfirmationsHookEnabled = true;
var presenceUpdatesHookEnabled = true;
var saveDeletedMsgsHookEnabled = false;
var safetyDelay = 0;

var isInitializing = true;
var exceptionsList = [];
var blinkingChats = {};
var chats = {};
var blockedChats = {};

// debugging flags
var WAdebugMode = false;
var WALogs = true;
var xmlDebugging = true;
var WAPassthrough = false;
var WAPassthroughWithDebug = false;

initialize();
 
//
// a WebSocket frame is about to be sent out.
//
wsHook.before = function (originalData, url)
{
    var promise = async function(originalData) {

    if (WAPassthrough) return originalData;

    try
    {
        var isMultiDevice = !WACrypto.isTagBasedPayload(originalData);

        var {tag, data} = isMultiDevice ? {tag: "", data: originalData} : WACrypto.parseWebSocketPayload(originalData);

        if (data instanceof ArrayBuffer || data instanceof Uint8Array)
        {
            // encrytped binary payload
            var decryptedFrames = await WACrypto.decryptWithWebCrypto(data, isMultiDevice, false);
            if (decryptedFrames == null) return originalData;

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
                    printNode(node, isIncoming=false, tag, decryptedFrame);
                    if (WAPassthroughWithDebug) return originalData;
                }

                var isAllowed = NodeHandler.isSentNodeAllowed(node, tag);
                var manipulatedNode = structuredClone(node);
                if (!isAllowed)
                {
                    if (!isMultiDevice) return null;
                    manipulatedNode.tag = "blocked_node";
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
        if (typeof(exception) == "string" && exception.includes("counter"))
        {
            console.log(exception);
            return originalData;
        }
        
        console.error("WhatsIncognito: Passing-through outgoing packet due to exception:");
        console.error(exception);
        return originalData;
    }

    };

    var isMultiDevice = !WACrypto.isTagBasedPayload(originalData);

    return isMultiDevice ? MultiDevice.enqueuePromise(promise, originalData, false) : promise(originalData);
}

//
// a WebScoket frame was received from network.
//
wsHook.after = function (messageEvent, url)
{
    var promise = async function(messageEvent) {
        
    if (WAPassthrough) return messageEvent;

    try
    {
        var isMultiDevice = !WACrypto.isTagBasedPayload(messageEvent.data);

        var {tag, data} = isMultiDevice ? {tag: "", data: messageEvent.data} : WACrypto.parseWebSocketPayload(messageEvent.data);

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
                    printNode(node, isIncoming=true, tag, decryptedFrame);

                    if (WAPassthroughWithDebug) return messageEvent;
                }

                var isAllowed = await NodeHandler.isReceivedNodeAllowed(node, isMultiDevice);
                var manipulatedNode = structuredClone(node);

                if (!isAllowed)
                {
                    if (!isMultiDevice) return null;
                    manipulatedNode.tag = "blocked_node";
                }

                manipulatedNode = await NodeHandler.manipulateReceivedNode(manipulatedNode, tag);
                decryptedFrames[i] = {node: manipulatedNode, counter: counter};
            }

            var packet = await WACrypto.packNodesForSending(decryptedFrames, isMultiDevice, true, tag);
            messageEvent.data = packet;
            return messageEvent;
            
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
    catch (exception)
    {
        if (exception.message && exception.message.includes("stream end")) return messageEvent;
        if (typeof(exception) == "string" && exception.includes("counter"))
        {
            console.log(exception);
            return messageEvent;
        }

        console.error("Passing-through incoming packet due to error:");
        console.error(exception);
        return messageEvent;
    };

    };

    var isMultiDevice = !WACrypto.isTagBasedPayload(messageEvent.data);

    return isMultiDevice ? MultiDevice.enqueuePromise(promise, messageEvent, true) : promise(messageEvent);
}

//
// Handling nodes
//

var NodeHandler = {};

NodeHandler.isSentNodeAllowed = function (node, tag)
{
    var subNodes = [node];
    if (Array.isArray(node.content)) 
    {
        subNodes = subNodes.concat(node.content);
    }

    for (var i = 0; i < subNodes.length; i++)
    {
        var child = subNodes[i];

        var action = child.tag;
        var data = child.attrs;
        var shouldBlock = 
            (readConfirmationsHookEnabled && action === "read") ||
            (readConfirmationsHookEnabled && action == "receipt" && data["type"] == "read") ||
            (readConfirmationsHookEnabled && action == "receipt" && data["type"] == "read-self") ||
            (readConfirmationsHookEnabled && action == "receipt" && data["type"] === "played") ||
            (readConfirmationsHookEnabled && action == "received" && data["type"] === "played") ||

            (presenceUpdatesHookEnabled && action === "presence" && data["type"] === "available") ||
            (presenceUpdatesHookEnabled && action == "presence" && data["type"] == "composing") ||
            (presenceUpdatesHookEnabled && action == "chatstate" && child.content[0].tag == "composing");

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

                        // exceptions are one-time operation, so remove it from the list after some time
                        setTimeout(function() {
                            exceptionsList = exceptionsList.filter(i => i !== jid);
                        }, 2000);

                        return true;
                    }
                    else
                    {
                        // We do not allow sending this read receipt.
                        // invoke the callback and fake a failure response from server
                        document.dispatchEvent(new CustomEvent('onReadConfirmationBlocked', { detail: jid }));

                        if (action == "read" && wsHook.onMessage)
                        {
                            // TODO: in multi-device, not sending an error message back to the client results in a lot of repeated attempts.
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
        if (node.tag == "message" || node.tag == "action")
        {
            // manipulating a message node

            if (isMultiDevice)
            {
                var participants = node.content[0];
                var children = participants.content;
                for (var i = 0; i < children.length; i++)
                {
                    var childNode = children[i];
                    if (childNode.tag != "to") continue;
    
                    var messageNode = childNode.content[0];
                    if (messageNode.tag == "enc")
                    {
                        childNode = await this.manipulateSentMessageNode(childNode, isMultiDevice);
                        children[i] = childNode;
                    }
                }
            }
            else if (node.tag == "action")
            {
                var children = node.content;
                for (var i = 0; i < children.length; i++)
                {
                    var child = children[i];
                    if (child.tag == "message")
                    {
                        var messageNode = await this.manipulateSentMessageNode(child, isMultiDevice);
                        children[i] = messageNode;
                    }
                }
            }
        }
        
    }
    catch (exception)
    {
        console.error("WhatsIncognito: Allowing WA packet due to exception:");
        console.error(exception);
        console.error(exception.stack);
        return node;
    }

    return node;
}

NodeHandler.manipulateSentMessageNode = async function (messageNode, isMultiDevice)
{
    var remoteJid = null;

    if (!isMultiDevice)
    {
        var message = (await getMessagesFromNode(messageNode, isMultiDevice))[0];
        if (WAdebugMode)
        {
            console.log("WAIncognito: Sending message:");
            console.log(message);
        }

        if (message == null || message.key == null) return;
        remoteJid = message.key.remoteJid;
    }
    else
    {
        // multi device
        if (messageNode.tag != "to") debugger;
        remoteJid = messageNode.attrs["jid"] ? messageNode.attrs["jid"]: messageNode.attrs["from"];
    }

    if (remoteJid && isChatBlocked(remoteJid))
    {
        // If the user replyed to a message from this JID,
        // It probably means we can send read receipts for it.

        var chat = await getChatByJID(remoteJid);
        var data = { jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
        setTimeout(function () { document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) })); }, 600);
    }

    // do message manipulation if needed
    //         ...
    var putBreakpointHere = 1;

    if (!isMultiDevice)
    {
        // TODO: following lines are commented out due to non-complete message types
        // re-assmble everything
        //messageBuffer = messageTypes.WebMessageInfo.encode(message).readBuffer();
        //messageNode.content = messageBuffer;
    }

    return messageNode;
}

NodeHandler.isReceivedNodeAllowed = async function (node, isMultiDevice)
{
    var isAllowed = true;

    var nodeTag = node.tag;
    var children = node.content;

    // if this node does not contain a message, it's allowed
    if (nodeTag != "action" && nodeTag != "message") return true;

    // scan for message nodes
    var messages = [];
    var nodes = [node];
    if (Array.isArray(children)) nodes = nodes.concat(children);

    var messageNodes = nodes.filter(node => node.tag == "message");

    for (var i = 0 ; i < messageNodes.length; i++)
    {
        var currentNode = messageNodes[i];

        var nodeMessages = await getMessagesFromNode(currentNode, isMultiDevice);
        for (var message of nodeMessages)
        {
            var remoteJid = null;
            if (!isMultiDevice)
            {
                // non multi-device
                remoteJid = message.key.remoteJid;
                messageId = message.key.id;
                message = message.message;
            }
            else if (currentNode.attrs != null)
            {
                remoteJid = currentNode.attrs["from"];
                messageId = currentNode.attrs["id"];
            }

            var isRevokeMessage = NodeHandler.checkForMessageDeletionNode(message, messageId, remoteJid);

            if (isRevokeMessage && nodeMessages.length == 1 && messageNodes.length == 1)
            {
                console.log("WhatsIncognito: --- Blocking message REVOKE action! ---");
                isAllowed = false;
                break;
            }
            else if (isRevokeMessage)
            {
                // TODO: edit the node to remove only the revoke messages
                console.log("WhatsIncognito: Not blocking node with revoked message because it will block other information.");
            }
        }

        messages = messages.concat(nodeMessages);
    }

    if (WAdebugMode && messages.length > 0)
    {
        console.log("Got messages:");
        console.log(messages);
    }

    return isAllowed;
}

NodeHandler.checkForMessageDeletionNode = function(message, messageId, remoteJid)
{
    //
    // Check if this is a message deletion node
    //
    var messageRevokeValue = ProtocolMessage.ProtocolMessageType.REVOKE.value;
    if (message && message.protocolMessage && message.protocolMessage.type == messageRevokeValue)
    {
        var deletedMessageId = message.protocolMessage.key.id;
        if (saveDeletedMsgsHookEnabled)
        {
            onDeletionMessageBlocked(message, remoteJid, messageId, deletedMessageId);
        }

        return true;
    }

    return false;
}

NodeHandler.manipulateReceivedNode = async function (node)
{
    var messages = [];
    var children = node.content;
    var type = node.attrs["type"];

    return node;
}

function printNode(node, isIncoming = false, tag="", decryptedFrame)
{
    var objectToPrint = xmlDebugging ? nodeToElement(node) : node;
    if (isIncoming)
    {
        console.log("[In] Received binary with tag '" + tag + "' (" + decryptedFrame.byteLength + " bytes, decrypted)): ");
    }
    else
    {
        console.log("[Out] Sending binary with tag '" + tag + "' (" + decryptedFrame.byteLength + " bytes, decrypted): ");
    }

    if (xmlDebugging)
    {
        console.dirxml(objectToPrint);
        objectToPrint.remove();
    }
    else
    {
        console.log(objectToPrint);
    }
}

function onDeletionMessageBlocked(message, remoteJid, messageId, deletedMessageId)
{
    // someone deleted a message, block and mark as deleted
    var messageNode = document.querySelector("[data-id*='" + deletedMessageId + "']");
    if (messageNode)
        messageNode.setAttribute("deleted-message", "true");

    document.dispatchEvent(new CustomEvent("pseudoMsgs", {
        detail: deletedMessageId
    }));

    // Now, save the deleted message in the DB after a short wait
    setTimeout(async function() {
        var chat = await getChatByJID(remoteJid);
        if (chat)
        {
            if (chat.loadEarlierMsgs)
                await chat.loadEarlierMsgs();
            else
                await WhatsAppAPI.LoadEarlierMessages.loadEarlierMsgs(chat);

            var msgs = chat.msgs.getModelsArray();
        
            for (let i = 0; i < msgs.length; i++)
            {
                if (msgs[i].id.id == deletedMessageId)
                {
                    saveDeletedMessage(msgs[i], message.protocolMessage.key, messageId);
                    break;
                }
            }
        }
    }, 4000);
}


async function getMessagesFromNode(node, isMultiDevice)
{
    if (!isMultiDevice)
    {
        // the message is not singal-encrypted, so just parse it
        switch (node.tag)
        {
            case "message":
                var message = WebMessageInfo.read(new Pbf(node.content));
                return [message];
            default:
                return [];
        }
    }
    else
    {
        // decrypt the signal message
        return MultiDevice.decryptE2EMessage(node);
    }
}

//
// Miscellaneous 
//

function exposeWhatsAppAPI()
{
    window.WhatsAppAPI = {};

    var moduleFinder = moduleRaid();
    window.WhatsAppAPI.downloadManager = moduleFinder.findModule("downloadManager")[0].downloadManager;
    window.WhatsAppAPI.Store = moduleFinder.findModule("Msg")[1].default;
    window.WhatsAppAPI.Seen = moduleFinder.findModule("sendSeen")[0];
    window.WhatsAppAPI.Communication = moduleFinder.findModule("getComms")[0].getComms();
    window.WhatsAppAPI.LoadEarlierMessages = moduleFinder.findModule("loadEarlierMsgs")[0];

    if (window.WhatsAppAPI.Seen == undefined)
    {
        console.error("WhatsAppWebIncognito: Can't find the WhatsApp API. Sending read receipts might not work.");
    }
}

function initialize()
{
    if (WALogs)
        hookLogs();
    initializeDeletedMessagesDB();
}

function hookLogs()
{
    // we don't want extension-related errors to be silently sent out

    var originalSendLogs = window.SEND_LOGS;
    var originalOnUnhandledRejction = window.onunhandledrejection;
    var originalLog = window.__LOG__;

    Object.defineProperty(window, 'onunhandledrejection', {
        set: function(value) { originalOnUnhandledRejction = value; },
        get: function() {return hookedPromiseError;}
    });
    Object.defineProperty(window, '__LOG__', {
        set: function(value) { originalLog = value; },
        get: function() {return hookedLog;}
    });

    function hookedPromiseError(event)
    {
        debugger;
        console.error("Unhandled promise rejection:");
        console.error(errorObject);
        return originalOnUnhandledRejction.call(event);
    }

    function hookedLog(errorLevel)
    {        
        return function(strings, values)
        {
            var message = "[WhatsApp][" + errorLevel + "] -- " + makeLogMessage(arguments);

            if (errorLevel <= 2 && WAdebugMode)
            {
                console.log(message);
            }
            else if (errorLevel > 2)
            {
                console.error(message);
            }

            var test = originalLog(errorLevel);
            return test.apply(null, arguments);
        };
    }
}

function initializeDeletedMessagesDB()
{
    var deletedDBOpenRequest = indexedDB.open("deletedMsgs", 1);

    deletedDBOpenRequest.onupgradeneeded = function (e)
    {
        // triggers if the client had no database
        // ...perform initialization...
        debugger;
        let db = deletedDBOpenRequest.result;
        switch (e.oldVersion)
        {
            case 0:
                db.createObjectStore('msgs', { keyPath: 'id' });
                console.log('WhatsIncognito: Deleted messages database generated');
                break;
        }
    };
    deletedDBOpenRequest.onerror = function ()
    {
        console.error("WhatsIncognito: Error opening database");
        console.error("Error", deletedDBOpenRequest);
    };
    deletedDBOpenRequest.onsuccess = () =>
    {
        window.deletedMessagesDB = deletedDBOpenRequest.result;
    }
}

async function saveDeletedMessage(retrievedMsg, deletedMessageKey, revokeMessageID)
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
            const decryptedData = await WhatsAppAPI.downloadManager.downloadAndDecrypt({ directPath: retrievedMsg.directPath, 
                encFilehash: retrievedMsg.encFilehash, filehash: retrievedMsg.filehash, mediaKey: retrievedMsg.mediaKey, 
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
        const transcation = window.deletedMessagesDB.transaction('msgs', "readwrite");
        let request = transcation.objectStore("msgs").add(deletedMsgContents);
        request.onerror = (e) =>
        {
            if (request.error.name == "ConstraintError")
            {
                // ConstraintError occurs when an object with the same id already exists
                // This will happen when we get the revoke message again from the server
                console.log("WhatsIncognito: Not saving message becuase the message ID already exists");
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

