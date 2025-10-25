// 
// Interception of WhatsApp packets and handling nodes
//

// Global enforcing variables
var readConfirmationsHookEnabled = true;
var onlineUpdatesHookEnabled = false;
var typingUpdatesHookEnabled = false;
var saveDeletedMsgsHookEnabled = false;
var showDeviceTypesEnabled = true;
var autoReceiptOnReplay = true;
var safetyDelay = 0;

var isInitializing = true;
var exceptionsList = [];
var blinkingChats = {};
var chats = {};
var blockedChats = {};
var deviceTypesPerMessage = {};

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
        if (!(originalData instanceof ArrayBuffer || originalData instanceof Uint8Array)) return originalData;

        // encrytped binary payload
        var decryptedFrames = await MultiDevice.decryptNoisePacket(originalData, isIncoming=false);
        if (decryptedFrames == null) return originalData;

        for (var i = 0; i < decryptedFrames.length; i++)
        {
            var decryptedFrameInfo = decryptedFrames[i];
            var decryptedFrame = decryptedFrameInfo.frame;
            var decryptedFrameOriginal = decryptedFrameInfo.frameUncompressed;
            var counter = decryptedFrameInfo.counter;

            var realNode = await nodeReaderWriter.decodeStanza(decryptedFrameOriginal, gzipInflate);
            
            var [isAllowed, manipulatedNode] = await NodeHandler.interceptOutgoingNode(realNode);
            decryptedFrames[i] = {node: manipulatedNode, counter: counter};

            if (WAdebugMode || WAPassthroughWithDebug)
            {
                printNode(manipulatedNode, isIncoming=false, decryptedFrame.byteLength);
                if (WAPassthroughWithDebug) return originalData;
            }

            // sanity check that our node parsing is complete
            await checkNodeEncoderSanity(decryptedFrameOriginal, isIncoming = false);
        }

        var packedNode = await MultiDevice.encryptAndPackNodesForSending(decryptedFrames, isIncoming=false);

        var looksEqual = isEqualArray(new Uint8Array(originalData), new Uint8Array(packedNode));
        if (!looksEqual && isAllowed)
        {
            debugger;
        }

        if (isInitializing)
        {
            isInitializing = false;
            console.log("WhatsIncognito: Interception is working.");
            document.dispatchEvent(new CustomEvent('onInterceptionWorking', { detail: JSON.stringify({isInterceptionWorking: true}) }));
        }

        return packedNode;
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

    return MultiDevice.enqueuePromise(promise, originalData, false);
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
        var originalData = messageEvent.data;

        if (!(originalData instanceof ArrayBuffer || originalData instanceof Uint8Array)) return messageEvent;

        var decryptedFrames = await MultiDevice.decryptNoisePacket(originalData, isIncoming=true);
        if (decryptedFrames == null) return messageEvent;

        var didBlockNode = false;
        for (var i = 0; i < decryptedFrames.length; i++)
        {
            var decryptedFrameInfo = decryptedFrames[i];
            var decryptedFrame = decryptedFrameInfo.frame;
            var decryptedFrameOriginal = decryptedFrameInfo.frameUncompressed;
            var counter = decryptedFrameInfo.counter;

            var realNode = await nodeReaderWriter.decodeStanza(decryptedFrameOriginal, gzipInflate);
            
            if (WAdebugMode || WAPassthroughWithDebug)
            {
                printNode(realNode, isIncoming=true, decryptedFrame.byteLength);
                
                if (WAPassthroughWithDebug) return messageEvent;
            }

            // sanity check that our node parsing is deterministic
            await checkNodeEncoderSanity(decryptedFrameOriginal, isIncoming = true);

            var [isAllowed, manipulatedNode] = await NodeHandler.interceptReceivedNode(realNode);

            if (!isAllowed)
            {
                didBlockNode = true;
            }

            decryptedFrames[i] = {node: manipulatedNode, counter: counter, decryptedFrame: decryptedFrame};
        }

        var packet = await MultiDevice.encryptAndPackNodesForSending(decryptedFrames, true);
        if (didBlockNode) messageEvent.data = packet;

        // TODO: compare the original `data` with `packet`

        return messageEvent;
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
        debugger;
        return messageEvent;
    };

    };

    return MultiDevice.enqueuePromise(promise, messageEvent, true);
}



function onDeletionMessageBlocked(message, remoteJid, messageId, deletedMessageId)
{
    // In case the message already appears on screen, mark it in red
    var messageNode = document.querySelector("[data-id*='" + deletedMessageId + "']");
    if (messageNode)
    {
        messageNode.setAttribute("deleted-message", "true");     // mark the message in red
    }

    document.dispatchEvent(new CustomEvent("pseudoMsgs", {
        detail: deletedMessageId
    }));

    // Now, save the deleted message in the DB after a short wait
    var waitTime = window.WhatsAppAPI != undefined ? 100 : 5000;
    setTimeout(async function() 
    {
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
    }, waitTime);
}

async function decryptE2EMessagesFromNode(node)
{
    // decrypt the signal message
    try
    {
        return MultiDevice.decryptE2EMessagesFromMessageNode(node);
    }
    catch (exception)
    {
        console.error("Could not decrypt E2E message with type " + node.attrs["type"] + " due to exception:");
        console.error(exception);
        debugger;
    }
}

async function interceptViewOnceMessages(e2eMessage, messageId) 
{
    if (e2eMessage.viewOnceMessageV2 !== null || e2eMessage.viewOnceMessageV2Extension !== null) 
    {
        var retrievedMsg = {};
        var type = "";
        if (e2eMessage.viewOnceMessageV2 !== null)
        {
            if (e2eMessage.viewOnceMessageV2.message.imageMessage !== null) 
            {
                retrievedMsg = e2eMessage.viewOnceMessageV2.message.imageMessage;
                type = "image";
            }
            else if (e2eMessage.viewOnceMessageV2.message.videoMessage !== null) 
            {
                retrievedMsg = e2eMessage.viewOnceMessageV2.message.videoMessage;
                type = "video";
            }
            else
            {
                throw new Error("Unknown viewOnceMessageV2 type");
            }
        }
        else if (e2eMessage.viewOnceMessageV2Extension?.message?.audioMessage !== null) 
        {
            retrievedMsg = e2eMessage.viewOnceMessageV2Extension.message.audioMessage;
            type = "audio";
        }
        else 
        {
            throw new Error("Unknown viewOnceMessageV2 or viewOnceMessageV2Extension type");
        }
        const mediaKeyEncoded = btoa(String.fromCharCode.apply(null, retrievedMsg.mediaKey));
        const encodedencFileHash = btoa(String.fromCharCode.apply(null, retrievedMsg.fileEncSha256));
        const encodedfileSha256 = btoa(String.fromCharCode.apply(null, retrievedMsg.fileSha256));
        
        if (window.WhatsAppAPI !== undefined)
        {
            const decryptedData = await WhatsAppAPI.downloadManager.downloadAndMaybeDecrypt({
                directPath: retrievedMsg.directPath,
                encFilehash: encodedencFileHash, filehash: encodedfileSha256, mediaKey: mediaKeyEncoded,
                type: type, signal: (new AbortController).signal
            });

            body = arrayBufferToBase64(decryptedData);
            dataURI = "data:" + retrievedMsg.mimetype + ";base64," + body;
            var caption = retrievedMsg.caption;
            // store in indexedDB called "view-once" messageID and dataURI 
            var viewOnceDBOpenRequest = indexedDB.open("viewOnce", 2);
            viewOnceDBOpenRequest.onupgradeneeded = function (event) {
                const db = event.target.result;
                var store = db.createObjectStore('msgs', { keyPath: 'id' });
                if (WAdebugMode) {
                    console.log('WhatsIncognito: Deleted messages database generated');
                }
                store.createIndex("id_index", "id");
            };
            viewOnceDBOpenRequest.onerror = function (e) {
                console.error("WhatsIncognito: Error opening database");
                console.error("Error", viewOnceDBOpenRequest);
                console.error(e);
            };
            viewOnceDBOpenRequest.onsuccess = () => {
                var viewOnceDB = viewOnceDBOpenRequest.result;
                var viewOnceTranscation = viewOnceDB.transaction('msgs', "readwrite");
                var viewOnceRequest = viewOnceTranscation.objectStore("msgs").add({ id: messageId, dataURI: dataURI, caption});
                viewOnceRequest.onerror = (e) => {
                    if (viewOnceRequest.error.name == "ConstraintError") {
                        if (WAdebugMode) {
                            console.log("WhatsIncognito: Not saving message becuase the message ID already exists");
                        }
                    }

                    else {
                        console.warn("WhatsIncognito: Unexpected error saving deleted message");
                    }
                };
            };
        }
        else
        {
            // retry in 5 seconds
            // don't know why it's 5 seconds, but that's what is done for decrypting deleted messages 
            setTimeout(function(){
                interceptViewOnceMessages(e2eMessage, messageId)
            }, 5000);
        }
    }
}

function printNode(node, isIncoming = false, decryptedFrameLength)
{
    var objectToPrint = xmlDebugging ? nodeToElement(node) : node;
    if (isIncoming)
    {
        console.log("[In] Received binary (" + decryptedFrameLength + " bytes, decrypted)): ");
    }
    else
    {
        console.log("[Out] Sending binary (" + decryptedFrameLength + " bytes, decrypted): ");
    }

    console.log(node);

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



//
// Miscellaneous 
//

function exposeWhatsAppAPI()
{
    window.WhatsAppAPI = {};

    // React Native
    window.WhatsAppAPI.downloadManager = require("WAWebDownloadManager").downloadManager;
    window.WhatsAppAPI.ChatCollection = require("WAWebChatCollection").ChatCollection;
    window.WhatsAppAPI.Seen = require("WAWebUpdateUnreadChatAction");
    window.WhatsAppAPI.Communication = require("WAComms").getComms();
    window.WhatsAppAPI.LoadEarlierMessages = require("WAWebChatLoadMessages");
    window.WhatsAppAPI.sendPresenceStatusProtocol = require("WASendPresenceStatusProtocol").sendPresenceStatusProtocol;
    window.WhatsAppAPI.SignalStore = require("WAWebSignalProtocolStore");
    window.WhatsAppAPI.WAWebSignalCommonUtils = require("WAWebSignalCommonUtils");
    window.WhatsAppAPI.WAWebWidFactory = require("WAWebWidFactory");
    window.WhatsAppAPI.WAWebWidToJid = require("WAWebWidToJid");

    if (window.WhatsAppAPI.Seen == undefined)
    {
        console.error("WhatsAppWebIncognito: Can't find the WhatsApp API. Stuff might not work.");
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
    var originalOnUnhandledRejection = window.onunhandledrejection;
    var originalLog = window.__LOG__; // TODO: Find log function for 2.3000 ( d("WALogger").LOG,  d("WALogger").ERROR ?)

    Object.defineProperty(window, 'onunhandledrejection', {
        set: function(value) { originalOnUnhandledRejection = value; },
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
        return originalOnUnhandledRejection.call(event);
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
            else if (errorLevel > 2 && WAdebugMode)
            {
                console.error(message);
            }
            else if (errorLevel > 2)
            {
                console.info(message);
            }

            if (originalLog)
            {
                var originalLogFn = originalLog(errorLevel);
                return originalLogFn.apply(null, arguments);
            }
            
        };
    }
}

function initializeDeletedMessagesDB()
{
    var deletedDBOpenRequest = indexedDB.open("deletedMsgs", 2);

    deletedDBOpenRequest.onupgradeneeded = function (event)
    {
        // triggers if the client had no database
        // ...perform initialization...
        debugger;

        // Get a reference to the request related to this event
        // @type IDBOpenRequest (a specialized type of IDBRequest)
        var request = event.target;

        // Get a reference to the IDBDatabase object for this request
        // @type IDBDatabase
        var db = request.result;

        // Get a reference to the implicit transaction for this request
        // @type IDBTransaction
        var txn = request.transaction;

        switch (event.oldVersion)
        {
            case 0:
                var store = db.createObjectStore('msgs', { keyPath: 'id' });
                console.log('WhatsIncognito: Deleted messages database generated');
                store.createIndex("originalID_index", "originalID");
                break;
            case 1:
                var store = txn.objectStore("msgs");
                
                store.createIndex("originalID_index", "originalID");
                break;
        }
    };
    deletedDBOpenRequest.onerror = function (e)
    {
        console.error("WhatsIncognito: Error opening database");
        console.error("Error", deletedDBOpenRequest);
        console.error(e);
    };
    deletedDBOpenRequest.onsuccess = () =>
    {
        window.deletedMessagesDB = deletedDBOpenRequest.result;
    }
}

async function saveDeletedMessage(retrievedMsg, deletedMessageKey, revokeMessageID)
{
    // Determine author data
    let author = deletedMessageKey.participant.split("@")[0].split(":")[0]

    let body = "";
    let isMedia = false;

    // Stickers & Documents are not considered media for some reason, so we have to check if it has a mediaKey and also set isMedia == true
    if (retrievedMsg.isMedia || retrievedMsg.mediaKey)
    {
        isMedia = true;

        // get extended media key              
        try
        {
            const decryptedData = await WhatsAppAPI.downloadManager.downloadAndMaybeDecrypt({ directPath: retrievedMsg.directPath, 
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

async function checkNodeEncoderSanity(originalFrame, isIncoming=false)
{
    var flags = new Uint8Array(originalFrame)[0];
    var decryptedFrameOpened = originalFrame.slice(1);
    if (flags & 2)
    {
        // zlib compressed. decompress
        decryptedFrameOpened = toArrayBuffer(pako.inflate(new Uint8Array(decryptedFrameOpened)));
    }

    var realNode = await nodeReaderWriter.decodeStanza(originalFrame, gzipInflate);

    // sanity check that our node parsing is deterministic
    var encodedNodeData = await nodeReaderWriter.encodeStanza(realNode, isIncoming);
    var looksGood = isEqualArray(new Uint8Array(decryptedFrameOpened), encodedNodeData.slice(1));
    if (!looksGood && !isIncoming)
    {
        debugger;
    }
    if (!looksGood && isIncoming)
    {
        // This can sometimes hit because on the encoding path, strings that represent numbers are always encoded with NIBBLE_8 (255) encoding.
        // But on the decoding path, WhatsApp servers could send us number strings encoded with regular BINARY_8 (252) encoding, 
        // which we will re-encode as NIBBLE_8 (255).
        //debugger;
    }
}