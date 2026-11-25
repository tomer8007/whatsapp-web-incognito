// 
// Interception of WhatsApp packets and handling nodes
//

// Global enforcing variables (initialized from shared schema defaults when available)
var _waiDefaults = typeof WAISettingsSchema !== 'undefined' ? WAISettingsSchema.defaults('shared') : {};
var readConfirmationsHookEnabled = _waiDefaults.readConfirmationsHook !== undefined ? _waiDefaults.readConfirmationsHook : true;
var onlineUpdatesHookEnabled = _waiDefaults.onlineUpdatesHook !== undefined ? _waiDefaults.onlineUpdatesHook : false;
var typingUpdatesHookEnabled = _waiDefaults.typingUpdatesHook !== undefined ? _waiDefaults.typingUpdatesHook : false;
var saveDeletedMsgsHookEnabled = _waiDefaults.saveDeletedMsgs !== undefined ? _waiDefaults.saveDeletedMsgs : true;
var showDeviceTypesEnabled = _waiDefaults.showDeviceTypes !== undefined ? _waiDefaults.showDeviceTypes : true;
var stealthVoiceNotesEnabled = _waiDefaults.stealthVoiceNotes !== undefined ? _waiDefaults.stealthVoiceNotes : false;
var mediaAutoDownloadGuardEnabled = _waiDefaults.mediaAutoDownloadGuard !== undefined ? _waiDefaults.mediaAutoDownloadGuard : false;
var autoReceiptOnReplay = _waiDefaults.autoReceiptOnReplay !== undefined ? _waiDefaults.autoReceiptOnReplay : true;
var safetyDelay = _waiDefaults.safetyDelay !== undefined ? _waiDefaults.safetyDelay : 0;
var contactWhitelistRules = {};

var isInitializing = true;
var exceptionsList = [];

// One-time exception for a receipt: allow a user-requested "mark as read" to go out,
// then let the automatic blocks apply again.
function allowReceiptsFor(jid)
{
    var normalized = normalizeJID(jid);
    if (!normalized) return;
    exceptionsList.push(normalized);
    setTimeout(function ()
    {
        exceptionsList = exceptionsList.filter(function (i) { return i !== normalized; });
    }, 2000);
}
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
    // P5: upstream passed `isIncoming=false` inline at every call site. `isIncoming`
    // is never declared in this file, so each of those was an implicit global write on
    // the per-frame path. Hoisted to a real local; the value is unchanged.
    var isIncoming = false;

    var promise = async function(originalData) {

    if (WAPassthrough) return originalData;

    try
    {
        if (!(originalData instanceof ArrayBuffer || originalData instanceof Uint8Array)) return originalData;

        // encrytped binary payload
        var decryptedFrames = await MultiDevice.decryptNoisePacket(originalData, isIncoming);
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
                printNode(manipulatedNode, isIncoming, decryptedFrame.byteLength);
                if (WAPassthroughWithDebug) return originalData;
            }
        }

        var packedNode = await MultiDevice.encryptAndPackNodesForSending(decryptedFrames, isIncoming);

        // Debug-only: warn when the re-encoded frame looks different.
        if (WAdebugMode)
        {
            var looksEqual = isEqualArray(new Uint8Array(originalData), new Uint8Array(packedNode));
            if (!looksEqual && isAllowed)
            {
                console.warn("WhatsIncognito: re-encoded frame differs from the original");
            }
        }

        if (isInitializing)
        {
            isInitializing = false;
            console.log("WhatsIncognito: Interception is working.");
            WAIPageBus.emit('onInterceptionWorking', { isInterceptionWorking: true });
        }

        return packedNode;
    }
    catch (exception)
    {
        if (MultiDevice.isExpectedNoiseError(exception))
        {
            console.log(exception);
            return originalData;
        }
        
        console.error("WhatsIncognito: Dropping outgoing packet due to exception to prevent privacy leak:");
        console.error(exception);
        console.error("outgoing noise packet was:");
        console.error(originalData);
        try
        {
            if (typeof window !== "undefined" && window.dispatchEvent)
            {
                window.dispatchEvent(new CustomEvent('wai:interception_failure', { detail: { error: String(exception && exception.message || exception), direction: 'outgoing' } }));
            }
        }
        catch (_) {}
        return null;
    }

    };

    return MultiDevice.enqueuePromise(promise, originalData, false);
}

//
// a WebScoket frame was received from network.
//
wsHook.after = function (messageEvent, url)
{
    // P5: see the note in wsHook.before — hoisted out of the call sites.
    var isIncoming = true;

    var promise = async function(messageEvent) {
    
    if (WAPassthrough) return messageEvent;

    try
    {
        var originalData = messageEvent.data;

        if (!(originalData instanceof ArrayBuffer || originalData instanceof Uint8Array)) return messageEvent;

        var decryptedFrames = await MultiDevice.decryptNoisePacket(originalData, isIncoming);
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
                printNode(realNode, isIncoming, decryptedFrame.byteLength);
                
                if (WAPassthroughWithDebug) return messageEvent;
            }

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
        if (MultiDevice.isExpectedNoiseError(exception))
        {
            if (typeof(exception) == "string") console.log(exception);
            return messageEvent;
        }

        console.error("Passing-through incoming packet due to error:");
        console.error(exception);
        console.error("incoming noise packet was:");
        console.error(originalData);
        return messageEvent;
    };

    };

    return MultiDevice.enqueuePromise(promise, messageEvent, true);
}

//
// Message restore feauture
//


// called from node_handler.js when a message node is blocked
function onDeletionMessageBlocked(message, remoteJid, messageId, deletedMessageId)
{
    // do GUI operations after a small timeout. TODO: move it to injected_ui.js
    setTimeout(function()
    {
        try
        {
            // In case the message already appears on screen, mark it in red
            var messageNode = document.querySelector("[data-id*='" + deletedMessageId + "']");

            if (messageNode)
            {
                var bubbleElement = messageNode.querySelector(':scope [data-testid] > div');
                if (bubbleElement) bubbleElement.setAttribute("deleted-message", "true");     // mark the message in red
            }

            WAIPageBus.sendToHost('deletedMsg:pseudoAdded', { id: deletedMessageId });

            // Now, save the deleted message in the DB after a short wait
            var waitTime = window.WhatsAppAPI != undefined ? 100 : 5000;
            setTimeout(async function() 
            {
                await findDeletedMessageAndSaveContents(message, remoteJid, messageId, deletedMessageId);
            }, waitTime);
        }
        catch (e)
        {
            console.error(e);
        }
        
    }
    , 10);
}

var deletedMessageSaveAttempts = 0;
var MAX_DELETED_MSG_SAVE_ATTEMPTS = 30;

function scheduleDeletedMessageSave(message, remoteJid, messageId, deletedMessageId, why)
{
    if (deletedMessageSaveAttempts >= MAX_DELETED_MSG_SAVE_ATTEMPTS) return;
    console.warn("WAIncognito: Scheduling deleted message save for later (" + why + ")");
    deletedMessageSaveAttempts++;
    setTimeout(async function()
    {
        await findDeletedMessageAndSaveContents(message, remoteJid, messageId, deletedMessageId);
    }, 1000);
}

async function findDeletedMessageAndSaveContents(message, remoteJid, messageId, deletedMessageId)
{
    var chat = await getChatByJID(remoteJid);
    if (chat)
    {
        if (chat.loadEarlierMsgs)
            await chat.loadEarlierMsgs();
        else
            await WhatsAppAPI.LoadEarlierMessages.loadEarlierMsgs({chat: chat});

        var msgs = chat.msgs.getModelsArray();
    
        var foundOriginalMessage = false;
        for (let i = 0; i < msgs.length; i++)
        {
            if (msgs[i].id.id == deletedMessageId)
            {
                saveDeletedMessage(msgs[i], message.protocolMessage.key, messageId);
                foundOriginalMessage = true;
                break;
            }
        }

        if (!foundOriginalMessage)
            // We are probably starting up and the original message is not added yet to the message store,
            // just schedule the search for later
            scheduleDeletedMessageSave(message, remoteJid, messageId, deletedMessageId, "original message not in store yet");
    }
    else
    {
        console.warn("WAIncognito: Could not find chat for JID " + remoteJid + ", so did not save deleted message");
        scheduleDeletedMessageSave(message, remoteJid, messageId, deletedMessageId, "chat not found");
    }
}

async function saveDeletedMessage(deletedMessage, deletedMessageKey, revokeMessageID)
{
    // Determine author data
    var participant = deletedMessageKey.participant;
    var author = participant ? participant.split("@")[0].split(":")[0] : "";
    if (author == "")
    {
        // maybe it's an @lid or @g.us
        author = deletedMessageKey.remoteJid;
    }

    let body = "";
    let isMedia = false;

    // Stickers & Documents are not considered media for some reason, so we have to check if it has a mediaKey and also set isMedia == true
    if (deletedMessage.isMedia || deletedMessage.mediaKey)
    {
        isMedia = true;

        // get extended media key              
        try
        {
            const decryptedData = await WhatsAppAPI.downloadManager.downloadAndMaybeDecrypt({ directPath: deletedMessage.directPath, 
                encFilehash: deletedMessage.encFilehash, filehash: deletedMessage.filehash, mediaKey: deletedMessage.mediaKey, 
                type: deletedMessage.type, signal: (new AbortController).signal });

            body = arrayBufferToBase64(decryptedData);

        }
        catch (e) { console.error(e); }
    }
    else 
    {   
        body = deletedMessage.body;
    }

    let deletedMsgRecord = {}
    deletedMsgRecord.id = deletedMessage.id.id;
    deletedMsgRecord.originalID = deletedMessage.id.id;
    deletedMsgRecord.revokeMessageID = revokeMessageID;
    deletedMsgRecord.body = body;
    deletedMsgRecord.timestamp = deletedMessage.t;
    deletedMsgRecord.from = author;
    deletedMsgRecord.isMedia = isMedia;
    deletedMsgRecord.fileName = deletedMessage.filename;
    deletedMsgRecord.mimetype = deletedMessage.mimetype;
    deletedMsgRecord.type = deletedMessage.type;
    deletedMsgRecord.mediaText = deletedMessage.text;
    deletedMsgRecord.Jid = deletedMessageKey.remoteJid;
    deletedMsgRecord.lng = deletedMessage.lng;
    deletedMsgRecord.lat = deletedMessage.lat;

    const transcation = window.deletedMessagesDB.transaction('msgs', "readwrite");
    let request = transcation.objectStore("msgs").add(deletedMsgRecord);
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
        console.log("WhatsIncognito: Saved deleted message with original ID " + deletedMsgRecord.id + " from " + deletedMsgRecord.from + " successfully.");
    }
}

//
// View once feature
//

// When the WhatsApp API is not available yet, view-once interception retries this
// many times before giving up on the message (it still passes through).
var MAX_VIEW_ONCE_RETRIES = 3;

async function interceptViewOnceMessages(e2eMessage, messageId, retries = 0) 
{
    var body = "";
    var dataURI = "";
    var caption = null;

    var viewOnceMessage = e2eMessage.viewOnceMessageV2;
    var viewOnceMessageExtension = e2eMessage.viewOnceMessageV2Extension;
    if (viewOnceMessage == null && viewOnceMessageExtension == null)
        return;

    var retrievedMsg = null;
    var type = "";
    if (viewOnceMessage)
    {
        if (viewOnceMessage.message && viewOnceMessage.message.imageMessage != null) 
        {
            retrievedMsg = viewOnceMessage.message.imageMessage;
            type = "image";
        }
        else if (viewOnceMessage.message && viewOnceMessage.message.videoMessage != null)
        {
            retrievedMsg = viewOnceMessage.message.videoMessage;
            type = "video";
        }
        else
        {
            throw new Error("Unknown viewOnceMessageV2 type");
        }
    }
    else if (viewOnceMessageExtension && viewOnceMessageExtension.message && viewOnceMessageExtension.message.audioMessage != null) 
    {
        retrievedMsg = viewOnceMessageExtension.message.audioMessage;
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
        caption = retrievedMsg.caption;
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
            var viewOnceTransaction = viewOnceDB.transaction('msgs', "readwrite");
            var viewOnceRequest = viewOnceTransaction.objectStore("msgs").add({ id: messageId, dataURI: dataURI, caption});
            viewOnceRequest.onerror = (e) => {
                if (viewOnceRequest.error.name == "ConstraintError") {
                    if (WAdebugMode) {
                        console.log("WhatsIncognito: Not saving message because the message ID already exists");
                    }
                }

                else {
                    console.warn("WhatsIncignito: Unexpected error saving deleted message");
                }
            };
        };
    }
    else
    {
        // The WhatsApp API may appear later (the UI script loads after WA's main
        // bundle); retry a bounded number of times, then give up quietly — the
        // message is passed through unmodified either way.
        if (retries < MAX_VIEW_ONCE_RETRIES)
        {
            setTimeout(function ()
            {
                interceptViewOnceMessages(e2eMessage, messageId, retries + 1);
            }, 5000);
        }
    }
}



//
// Miscellaneous 
//

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

function applyOptionsToInterceptionGlobals(options)
{
    if (!options || typeof options !== 'object') return;
    if ('readConfirmationsHook' in options) readConfirmationsHookEnabled = options.readConfirmationsHook;
    if ('onlineUpdatesHook' in options) onlineUpdatesHookEnabled = options.onlineUpdatesHook;
    if ('typingUpdatesHook' in options) typingUpdatesHookEnabled = options.typingUpdatesHook;
    if ('safetyDelay' in options) safetyDelay = options.safetyDelay;
    if ('saveDeletedMsgs' in options) saveDeletedMsgsHookEnabled = options.saveDeletedMsgs;
    if ('showDeviceTypes' in options) showDeviceTypesEnabled = options.showDeviceTypes;
    if ('autoReceiptOnReplay' in options) autoReceiptOnReplay = options.autoReceiptOnReplay;
    if ('stealthVoiceNotes' in options) stealthVoiceNotesEnabled = options.stealthVoiceNotes;
    if ('mediaAutoDownloadGuard' in options) mediaAutoDownloadGuardEnabled = options.mediaAutoDownloadGuard;
    if ('contactWhitelistRules' in options && options.contactWhitelistRules && typeof options.contactWhitelistRules === 'object')
        contactWhitelistRules = options.contactWhitelistRules;
}

function subscribeToInterceptionOptions()
{
    document.addEventListener('onOptionsUpdate', function (e)
    {
        try
        {
            var options = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
            applyOptionsToInterceptionGlobals(options);
        }
        catch (err) {}
    });

    document.addEventListener('onContactWhitelistUpdate', function (e)
    {
        try
        {
            var rules = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
            if (rules && typeof rules === 'object') contactWhitelistRules = rules;
        }
        catch (err) {}
    });
}

function initialize()
{
    if (typeof window !== 'undefined' && window.__WAI__ && typeof window.__WAI__.getPrefs === 'function')
    {
        applyOptionsToInterceptionGlobals(window.__WAI__.getPrefs());
    }
    subscribeToInterceptionOptions();
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

    // P7: upstream ran this once, 2s after injection, with no guard at all. Two bugs:
    //
    //  a) `require("WALogger")` returns null until WhatsApp's webpack bundle has
    //     registered that module, so 2s after document_start this threw
    //     "Cannot read properties of null (reading 'LOG')" on every single launch — an
    //     uncaught error inside a setTimeout, which then also surfaced through the
    //     window.onunhandledrejection hook installed just above.
    //  b) `originalWALoggerDev` was assigned `.LOG` instead of `.DEV`, so
    //     hookedWALoggerDev called the *log* function's original with DEV arguments.
    //
    // The hook exists so WhatsApp's own error reports do not leak (see the comment at
    // the top of hookLogs), so it is worth getting right — but it is not worth throwing
    // over. Resolve the modules with a bounded retry; if they never appear, give up
    // quietly rather than throwing on the page.
    function installWALoggerHooks(attempt)
    {
        var WALogger = null, WAUtils = null;
        try { WALogger = require("WALogger"); } catch (e) { WALogger = null; }
        try { WAUtils = require("WALoggerUtils"); } catch (e) { WAUtils = null; }

        if (!WALogger)
        {
            if (attempt < 40) setTimeout(function () { installWALoggerHooks(attempt + 1); }, 500);
            return;
        }

        // P7b: DEV, not LOG.
        var originalWALoggerLog = WALogger.LOG;
        var originalWALoggerDev = WALogger.DEV;
        var originalWALoggerERROR = WALogger.ERROR;
        var originalWALoggerWARN = WALogger.WARN;

        WALogger.LOG = hookedWALoggerLog;
        WALogger.DEV = hookedWALoggerDev;
        WALogger.ERROR = hookedWALoggerError;
        WALogger.WARN = hookedWALoggerWarn;

        // rebuildTemplate is unavailable until WALoggerUtils registers, and can itself
        // throw on an unexpected template. Fall back to the raw arguments so a log line
        // is never lost to a null dereference.
        function rebuild(n, r)
        {
            if (WAUtils && typeof WAUtils.rebuildTemplate === 'function')
            {
                try { return WAUtils.rebuildTemplate(n, r); } catch (e) { /* fall through */ }
            }
            return String(n) + (r && r.length ? ' ' + r.join(' ') : '');
        }

        function hookedWALoggerDev(n)
        {
            if (WAdebugMode)
            {
                for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
                var logLine = rebuild(n, r)
                console.log("[WhatsApp DEV] " + logLine);
            }
            if (typeof originalWALoggerDev === 'function') return originalWALoggerDev.apply(null, arguments);
        }
        function hookedWALoggerLog(n)
        {
            if (WAdebugMode)
            {
                for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
                var logLine = rebuild(n, r)
                console.log("[WhatsApp LOG] " + logLine);
            }
            if (typeof originalWALoggerLog === 'function') return originalWALoggerLog.apply(null, arguments);
        }
        function hookedWALoggerError(n)
        {
            for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                r[a - 1] = arguments[a];
            var logLine = rebuild(n, r)
            console.error("[WhatsApp ERROR] " + logLine);
            if (typeof originalWALoggerERROR === 'function') return originalWALoggerERROR.apply(null, arguments);
        }
        function hookedWALoggerWarn(n)
        {
            for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                r[a - 1] = arguments[a];
            var logLine = rebuild(n, r)
            console.warn("[WhatsApp WARN] " + logLine);
            if (typeof originalWALoggerWARN === 'function') return originalWALoggerWARN.apply(null, arguments);
        }
    }

    setTimeout(function () { installWALoggerHooks(0); }, 2000);

    

    function hookedPromiseError(event)
    {
        console.error("Unhandled promise rejection:");
        console.error(event && event.reason);
        if (typeof originalOnUnhandledRejection === "function")
            return originalOnUnhandledRejection.call(event);
    }

    

    function hookedLog(errorLevel)
    {        
        return function(strings, values)
        {
            if (WAdebugMode || errorLevel > 2)
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
