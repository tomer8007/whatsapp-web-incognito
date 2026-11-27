// 
// Interception of WhatsApp packets and handling nodes
//

// Global enforcing variables
var readConfirmationsHookEnabled = true;
var onlineUpdatesHookEnabled = false;
var typingUpdatesHookEnabled = false;
var saveDeletedMsgsHookEnabled = false;
// When the first real options update reached this world (ms timestamp), null before. Until then the defaults above are only
// placeholders: right after a reconnect the offline backlog can arrive before the options do (see NodeHandler.shouldBlockRevoke).
var optionsReceivedAt = null;
var showDeviceTypesEnabled = true;
var autoReceiptOnReplay = true;
var safetyDelay = 0;

var STATUS_BROADCAST_JID = "status@broadcast";

var isInitializing = true;
var exceptionsList = [];
var blinkingChats = {};
var chats = {};
var blockedChats = {};
var deviceTypesPerMessage = {};

// the first frames after startup can arrive before WhatsApp's modules are loaded: log that once, as a note, not an error per frame
var notReadyLogged = false;
function logNotReadyOnce()
{
    if (notReadyLogged) return;
    notReadyLogged = true;
    console.log("WhatsIncognito: WhatsApp is still loading, early packets are passed through until the hook is ready.");
}

// debugging flags
var WAdebugMode = false;
var WALogs = true;
var xmlDebugging = true;
var WAPassthrough = false;
var WAPassthroughWithDebug = false;

initialize();
registerCoreDiagnostics();

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
        var decryptedFrames = await MultiDevice.decryptNoisePacket(originalData, /* isIncoming */ false);
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
                printNode(manipulatedNode, /* isIncoming */ false, decryptedFrame.byteLength);
                if (WAPassthroughWithDebug) return originalData;
            }

            // sanity check that our node parsing is complete (decodes + re-encodes the frame; runs in every mode)
            await checkNodeEncoderSanity(decryptedFrameOriginal, /* isIncoming */ false);
        }

        var packedNode = await MultiDevice.encryptAndPackNodesForSending(decryptedFrames, /* isIncoming */ false);

        var looksEqual = isEqualArray(new Uint8Array(originalData), new Uint8Array(packedNode));
        if (!looksEqual && isAllowed)
        {
            waDebugBreak();
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
        if (isWhatsAppAPINotReady(exception))
        {
            logNotReadyOnce();
            return originalData;
        }
        
        console.error("WhatsIncognito: Passing-through outgoing packet due to exception:");
        console.error(exception);
        console.error("outgoing noise packet was:");
        console.error(originalData);
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

        var decryptedFrames = await MultiDevice.decryptNoisePacket(originalData, /* isIncoming */ true);
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
                printNode(realNode, /* isIncoming */ true, decryptedFrame.byteLength);
                
                if (WAPassthroughWithDebug) return messageEvent;
            }

            // sanity check that our node parsing is deterministic (decodes + re-encodes the frame; runs in every mode)
            await checkNodeEncoderSanity(decryptedFrameOriginal, /* isIncoming */ true);

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
        if (isWhatsAppAPINotReady(exception))
        {
            logNotReadyOnce();
            return messageEvent;
        }

        console.error("Passing-through incoming packet due to error:");
        console.error(exception);
        console.error("incoming noise packet was:");
        console.error(originalData);
        //debugger;
        return messageEvent;
    };

    };

    return MultiDevice.enqueuePromise(promise, messageEvent, true);
}

//
// Message restore feauture
//


// Ids (only ids) of the messages whose revoke we blocked this page load. The row of such a message may be rendered long after the
// block (offline backlog: the original and its revoke arrive in one packet), so the "Deleted" mark must not depend on the row
// existing at block time: see markBlockedRevokeRows (re-tried) and the getDeletedMessageByID answer (injected_ui.js).
var blockedRevokedIds = new Set();
var BLOCKED_REVOKED_IDS_CAP = 2000;
var BLOCKED_REVOKE_REMARK_DELAYS_MS = [1000, 3000, 6000, 10000];

function rememberBlockedRevoke(deletedMessageId)
{
    if (deletedMessageId == null) return;
    blockedRevokedIds.add(String(deletedMessageId));
    if (blockedRevokedIds.size > BLOCKED_REVOKED_IDS_CAP) blockedRevokedIds.delete(blockedRevokedIds.values().next().value);
}

// Marks the rendered rows of a deleted message in red (styles.css). Honors the contact's "markDeleted" toggle. Returns how many rows were marked.
function markBlockedRevokeRows(deletedMessageId, remoteJid)
{
    try
    {
        if (!NodeHandler.contactToggle(remoteJid, "markDeleted", true)) return 0;
        var rows = document.querySelectorAll("[data-id*='" + deletedMessageId + "']");
        for (var n = 0; n < rows.length; n++) rows[n].setAttribute("data-incognito-deleted", "true");
        return rows.length;
    }
    catch (e) { return 0; }
}

// called from node_handler.js when a message node is blocked
function onDeletionMessageBlocked(message, remoteJid, messageId, deletedMessageId, participant)
{
    var isStatus = remoteJid == STATUS_BROADCAST_JID;
    if (!isStatus) rememberBlockedRevoke(deletedMessageId);

    // do GUI operations after a small timeout. TODO: move it to injected_ui.js
    setTimeout(function()
    {
        try
        {
            if (isStatus)
            {
                // a status the sender deleted: tell the user, and keep it only if saveDeletedStatus is on
                notifyDeletedMessage("status-delete", remoteJid, deletedMessageId, participant);
                if ((window.WAIncognitoOptions || {}).saveDeletedStatus)
                {
                    var statusWaitTime = window.WhatsAppAPI != undefined ? 100 : 5000;
                    setTimeout(async function()
                    {
                        try { await findDeletedMessageAndSaveContents(message, remoteJid, messageId, deletedMessageId, 0, participant); }
                        catch (e) { console.warn("WAIncognito: saving a deleted status failed"); }
                    }, statusWaitTime);
                }
                return;
            }

            // In case the message already appears on screen, mark it in red; rows that appear later are marked when they render
            markBlockedRevokeRows(deletedMessageId, remoteJid);
            BLOCKED_REVOKE_REMARK_DELAYS_MS.forEach(function(delay)
            {
                setTimeout(function() { markBlockedRevokeRows(deletedMessageId, remoteJid); }, delay);
            });

            notifyDeletedMessage("delete", remoteJid, deletedMessageId);

            // Now, save the deleted message in the DB after a short wait
            var waitTime = window.WhatsAppAPI != undefined ? 100 : 5000;
            setTimeout(async function() 
            {
                try { await findDeletedMessageAndSaveContents(message, remoteJid, messageId, deletedMessageId); }
                catch (e) { console.warn("WAIncognito: saving a deleted message failed"); }
            }, waitTime);
        }
        catch (e)
        {
            console.error(e);
        }
        
    }
    , 10);
}

// Asks the isolated world (core/toast.js) to show a toast. Best effort: never throws.
function dispatchIncognitoToast(kind, chatName, preview, targetId, before)
{
    document.dispatchEvent(new CustomEvent("waIncognitoToast", { detail: JSON.stringify({kind: kind, chatName: chatName, preview: preview || "", targetId: targetId || null, before: before || null}) }));
}

function getChatDisplayName(chat, fallbackJid)
{
    if (chat)
    {
        var name = chat.formattedTitle || chat.name || (chat.contact && (chat.contact.name || chat.contact.pushname));
        if (name) return String(name);
    }
    return fallbackJid ? String(fallbackJid).split("@")[0] : "";
}

async function notifyDeletedMessage(kind, chatJid, deletedMessageId, nameJid)
{
    try
    {
        var options = NodeHandler.optionsFor(nameJid || chatJid);
        if (!options.toastOnDelete) return; // nothing would be shown, skip the lookups

        var chat = await getChatByJID(nameJid || chatJid, deletedMessageId);
        var preview = "";
        if (chat && chat.msgs && chat.msgs.getModelsArray)
        {
            var original = chat.msgs.getModelsArray().find(function(m) { return m.id && m.id.id == deletedMessageId; });
            if (original && typeof original.body == "string" && !original.isMedia) preview = original.body;
            else if (original && original.caption) preview = original.caption;
        }
        dispatchIncognitoToast(kind, getChatDisplayName(chat, nameJid || chatJid), preview);
    }
    catch (e)
    {
        console.warn("WAIncognito: could not build the deletion toast");
    }
}

async function notifyEditedMessage(chatJid, preview, targetId, before, afterKnown)
{
    try
    {
        var options = NodeHandler.optionsFor(chatJid);
        if (!options.toastOnEdit) return;

        var chat = await getChatByJID(chatJid, targetId);
        dispatchIncognitoToast("edit", getChatDisplayName(chat, chatJid), preview, targetId, afterKnown ? before : null);
    }
    catch (e)
    {
        console.warn("WAIncognito: could not build the edit toast");
    }
}

var MAX_DELETED_MSG_SAVE_ATTEMPTS = 30;

// The status collection (see wa-js): StatusV3CollectionImpl || StatusV3Collection || StatusCollection
function getStatusCollection()
{
    try
    {
        var statusModule = require("WAWebStatusCollection");
        var collection = statusModule && (statusModule.StatusV3CollectionImpl || statusModule.StatusV3Collection || statusModule.StatusCollection);
        if (collection) return collection;
    }
    catch (e) { /* module not loaded */ }

    try
    {
        if (typeof findExport == "function") return findExport("StatusV3Collection");
    }
    catch (e) { /* not found */ }
    return null;
}

// The statuses of one contact (the collection entry, with .msgs), from the statuses that are loaded. null when not found.
function findStatusEntry(participantJid)
{
    var collection = getStatusCollection();
    if (!collection || !participantJid) return null;

    var jid = String(participantJid).replace(/:\d+@/, "@");
    var user = jid.split("@")[0];
    var entry = null;
    try
    {
        var wid = (isUserJid(jid) && window.WhatsAppAPI && WhatsAppAPI.WAWebWidFactory && WhatsAppAPI.WAWebWidFactory.createWid) ? WhatsAppAPI.WAWebWidFactory.createWid(jid) : jid;
        entry = collection.get(wid);
    }
    catch (e) { /* fall back to a scan */ }

    if (!entry && collection.getModelsArray)
    {
        entry = collection.getModelsArray().find(function(m) { return m.id && m.id.user == user; });
    }
    return entry || null;
}

// The message of a status the sender has deleted, from the statuses that are still loaded. null when not found (yet).
function findStatusMessage(participantJid, deletedMessageId)
{
    var entry = findStatusEntry(participantJid);
    if (!entry || !entry.msgs || !entry.msgs.getModelsArray) return null;

    return entry.msgs.getModelsArray().find(function(m) { return m.id && m.id.id == deletedMessageId; }) || null;
}

// `attempt` counts retries for this one deleted message, so deleted messages don't share a retry budget.
// `participant` is only used for statuses (remoteJid == status@broadcast): the sender of the status.
async function findDeletedMessageAndSaveContents(message, remoteJid, messageId, deletedMessageId, attempt = 0, participant = null)
{
    if (remoteJid == STATUS_BROADCAST_JID)
    {
        var statusMessage = findStatusMessage(participant, deletedMessageId);
        if (statusMessage)
        {
            saveDeletedMessage(statusMessage, { participant: participant, remoteJid: remoteJid }, messageId, "status");
            return;
        }
    }
    else
    {
        try
        {
            var chat = await getChatByJID(remoteJid, deletedMessageId);
            if (chat)
            {
                if (chat.loadEarlierMsgs)
                    await chat.loadEarlierMsgs();
                else
                    await WhatsAppAPI.LoadEarlierMessages.loadEarlierMsgs({chat: chat});

                var msgs = chat.msgs.getModelsArray();
                for (let i = 0; i < msgs.length; i++)
                {
                    if (msgs[i].id.id == deletedMessageId)
                    {
                        var saved = await saveDeletedMessage(msgs[i], message.protocolMessage.key, messageId);
                        if (saved) markBlockedRevokeRows(deletedMessageId, remoteJid);
                        return;
                    }
                }
                // We are probably starting up and the original message is not added yet to the message store
            }
            else
            {
                console.warn("WAIncognito: Could not find the chat of a deleted message yet");
            }
        }
        catch (e)
        {
            // a failed lookup must not end the retries (the chat may simply not be ready yet)
            console.warn("WAIncognito: looking up a deleted message failed, will retry");
        }
    }

    if (attempt >= MAX_DELETED_MSG_SAVE_ATTEMPTS)
    {
        console.warn("WAIncognito: Giving up on saving a deleted message");
        return;
    }

    console.warn("WAIncognito: Scheduling deleted message save for later");
    // short waits first (the original usually shows up within a few seconds), then once a second; still bounded by MAX_DELETED_MSG_SAVE_ATTEMPTS
    var retryDelay = attempt < 4 ? 500 : 1000;
    setTimeout(async function() 
    {
        try { await findDeletedMessageAndSaveContents(message, remoteJid, messageId, deletedMessageId, attempt + 1, participant); }
        catch (e) { console.warn("WAIncognito: saving a deleted message failed"); }
    }, retryDelay);
}

async function saveDeletedMessage(deletedMessage, deletedMessageKey, revokeMessageID, kind = "deleted")
{
    // Determine author data
    var author = deletedMessageKey.participant.split("@")[0].split(":")[0]
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
    deletedMsgRecord.chatId = deletedMessage.id && deletedMessage.id.remote ? String(deletedMessage.id.remote) : null; // the resolved chat (PN or LID)
    deletedMsgRecord.lng = deletedMessage.lng;
    deletedMsgRecord.lat = deletedMessage.lat;
    if (kind != "deleted") deletedMsgRecord.kind = kind; // "status": the plaintext `msgs` store holds it too, so keep the kind

    if ("id" in deletedMsgRecord && await isVaultSetUp())
    {
        try
        {
            await Vault.put(Object.assign({ kind: kind, ts: Date.now(), chatJid: deletedMsgRecord.Jid }, deletedMsgRecord));
            console.log("WhatsIncognito: Saved a deleted message to the vault.");
            return true;
        }
        catch (e)
        {
            console.error("WhatsIncognito: Could not save deleted message to the vault");
            console.error(e);
        }
    }
    else if ("id" in deletedMsgRecord)
    {
        return await new Promise(function(resolve)
        {
            const transcation = window.deletedMessagesDB.transaction('msgs', "readwrite");
            let request = transcation.objectStore("msgs").add(deletedMsgRecord);
            request.onerror = (e) =>
            {
                if (request.error.name == "ConstraintError")
                {
                    // ConstraintError occurs when an object with the same id already exists
                    // This will happen when we get the revoke message again from the server
                    console.log("WhatsIncognito: Not saving message becuase the message ID already exists");
                    resolve(true); // it is in the DB
                } 
                else
                {
                    console.log("WhatsIncognito: Unexpected error saving deleted message");
                    resolve(false);
                }
            };
            request.onsuccess = (e) =>
            {
                console.log("WhatsIncognito: Saved a deleted message successfully.");
                resolve(true);
            }
        });
    }
    else
    {
        console.log("WhatsIncognito: Deleted message contents not found");
    }
    return false;
}

//
// View once feature
//

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

            var body = arrayBufferToBase64(decryptedData);
            var dataURI = "data:" + retrievedMsg.mimetype + ";base64," + body;
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



//
// Miscellaneous 
//

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
        waDebugBreak();
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
    initializeVault();
}

//
// Vault (core/vault.js)
//

var VAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

function initializeVault()
{
    if (typeof Vault == "undefined" || typeof indexedDB == "undefined") return;

    Vault.init({ storage: createIndexedDBVaultStorage(), legacy: createLegacyDeletedMsgsAdapter() });
    if (typeof Diagnostics != "undefined")
        Diagnostics.register("vault", "db", "waIncognitoVault", function() { return createIndexedDBVaultStorage.isOpen === true; });

    // on load (once the options arrived) and then every hour
    setTimeout(runVaultRetention, 30 * 1000);
}

async function runVaultRetention()
{
    try
    {
        if (await isVaultSetUp())
        {
            var options = window.WAIncognitoOptions || defaultOptions();
            var removed = await Vault.enforceRetention({ maxDays: options.vaultRetentionDays,
                                                         maxBytes: options.vaultMaxMB * 1024 * 1024, now: Date.now() });
            if (removed > 0) console.log("WAIncognito: vault retention removed " + removed + " records");
        }
    }
    catch (e)
    {
        console.warn("WAIncognito: vault retention failed");
        console.warn(e);
    }
    setTimeout(runVaultRetention, VAULT_RETENTION_INTERVAL_MS);
}

async function isVaultSetUp()
{
    if (typeof Vault == "undefined") return false;
    try { return await Vault.isSetUp(); }
    catch (e) { return false; }
}

// Saves an archive record (deleted / edit / ephemeral / status) to the vault when it is set up,
// otherwise to the given plaintext store of the deletedMsgs DB (the old behavior).
async function saveArchiveRecord(record, legacyStoreName)
{
    if (await isVaultSetUp())
    {
        await Vault.put(record);
        return "vault";
    }

    if (window.deletedMessagesDB == null || !window.deletedMessagesDB.objectStoreNames.contains(legacyStoreName))
    {
        console.warn("WAIncognito: archive database is not open, record not saved");
        return null;
    }

    return new Promise(function(resolve)
    {
        var request = window.deletedMessagesDB.transaction(legacyStoreName, "readwrite").objectStore(legacyStoreName).put(record);
        request.onsuccess = function() { resolve("legacy"); };
        request.onerror = function() { console.warn("WAIncognito: could not save archive record"); resolve(null); };
    });
}

// All saved versions of an edited message, oldest first. -> {edits: [...], locked: bool}
async function loadEditHistory(targetId)
{
    if (await isVaultSetUp())
    {
        if (!Vault.isUnlocked()) return { edits: [], locked: true };
        return { edits: await Vault.listByIdPrefix("edit:" + targetId + ":"), locked: false };
    }

    var db = window.deletedMessagesDB;
    if (db == null || !db.objectStoreNames.contains("edits")) return { edits: [], locked: false };

    return new Promise(function(resolve)
    {
        var request = db.transaction("edits", "readonly").objectStore("edits").index("targetId_index").getAll(targetId);
        request.onsuccess = function()
        {
            resolve({ edits: request.result.sort(function(a, b) { return a.ts - b.ts; }), locked: false });
        };
        request.onerror = function() { resolve({ edits: [], locked: false }); };
    });
}

// All saved disappearing messages of the chats with these JIDs (pn and lid forms). -> {records: [...], locked: bool}
async function loadEphemeralForChats(chatJids)
{
    if (await isVaultSetUp())
    {
        if (!Vault.isUnlocked()) return { records: [], locked: true };
        var all = [];
        for (var i = 0; i < chatJids.length; i++)
            all = all.concat(await Vault.listByChat(chatJids[i], "ephemeral"));
        return { records: all, locked: false };
    }

    var db = window.deletedMessagesDB;
    if (db == null || !db.objectStoreNames.contains("ephemeral")) return { records: [], locked: false };

    var records = [];
    for (var j = 0; j < chatJids.length; j++)
    {
        records = records.concat(await new Promise(function(resolve)
        {
            var request = db.transaction("ephemeral", "readonly").objectStore("ephemeral").index("chatJid_index").getAll(chatJids[j]);
            request.onsuccess = function() { resolve(request.result); };
            request.onerror = function() { resolve([]); };
        }));
    }
    return { records: records, locked: false };
}

// One saved disappearing message by id (vault must be unlocked when it is set up)
async function loadEphemeralRecord(id)
{
    if (await isVaultSetUp()) return Vault.isUnlocked() ? Vault.get(id) : null;

    var db = window.deletedMessagesDB;
    if (db == null || !db.objectStoreNames.contains("ephemeral")) return null;
    return new Promise(function(resolve)
    {
        var request = db.transaction("ephemeral", "readonly").objectStore("ephemeral").get(id);
        request.onsuccess = function() { resolve(request.result || null); };
        request.onerror = function() { resolve(null); };
    });
}

// The id of the status shown in the status viewer, from the props of its React fibers. null when not found.
var statusViewerIdResolutions = 0;
function findStatusMessageIdInFiber(fiber)
{
    var message = findStatusMessageInFiber(fiber);
    return message ? message.id.id : null;
}

// The message model of the status shown in the status viewer, from the props of its React fibers. null when not found.
function findStatusMessageInFiber(fiber)
{
    var propNames = ["msg", "statusMsg", "message", "currentMsg"];
    for (var depth = 0; fiber && depth < 40; depth++, fiber = fiber.return)
    {
        var props = fiber.memoizedProps;
        if (!props || typeof props != "object") continue;
        for (var i = 0; i < propNames.length; i++)
        {
            var candidate = props[propNames[i]];
            if (candidate && candidate.id && typeof candidate.id.id == "string") return candidate;
        }
    }
    return null;
}

// Is there an archived copy (vault or plaintext) of this message id? Never throws.
async function isMessageArchived(messageId)
{
    try
    {
        if (await isVaultSetUp()) return await Vault.has(messageId);
        var db = window.deletedMessagesDB;
        if (!db || !db.objectStoreNames.contains("msgs")) return false;
        return await new Promise(function(resolve)
        {
            var request = db.transaction("msgs", "readonly").objectStore("msgs").get(messageId);
            request.onsuccess = function() { resolve(request.result != null); };
            request.onerror = function() { resolve(false); };
        });
    }
    catch (e)
    {
        return false;
    }
}

// Sends a text message through WhatsApp's own send function (found with findExport). -> {ok, error?}. Never throws.
// In the live build (2.3000.x) the exports sit in lazily loaded modules, so the lookup needs a name hint to force the require:
//   WAWebSendTextMsgChatAction.sendTextMsgToChat(chat, text, options)   (arity 3, preferred)
//   WAWebSendMsgChatAction.addAndSendMsgToChat(chat, message, options)  (fallback)
// The call itself was never exercised against a real chat (signature only inspected).
var SEND_TEXT_MODULE_HINT = /SendTextMsgChatAction/;
var SEND_MSG_MODULE_HINT = /SendMsgChatAction/;
function requireExport(moduleName, exportName)
{
    try { var exported = require(moduleName); return exported && typeof exported[exportName] == "function" ? exported[exportName] : null; }
    catch (e) { return null; }
}
function findSendTextFunction() { return requireExport("WAWebSendTextMsgChatAction", "sendTextMsgToChat") || findExport("sendTextMsgToChat", SEND_TEXT_MODULE_HINT); }
function findAddAndSendFunction() { return requireExport("WAWebSendMsgChatAction", "addAndSendMsgToChat") || findExport("addAndSendMsgToChat", SEND_MSG_MODULE_HINT); }

async function sendTextToChat(jid, text)
{
    try
    {
        var sendText = findSendTextFunction();
        var addAndSend = sendText ? null : findAddAndSendFunction();
        if (!sendText && !addAndSend) return { ok: false, error: "send-function-not-found" };

        var chat = await getChatByJID(jid);
        if (!chat) return { ok: false, error: "chat-not-found" };

        if (sendText) await sendText(chat, text, {});
        else await addAndSend(chat, { type: "chat", body: text, t: Math.floor(Date.now() / 1000), local: true, isNewMsg: true }, {});
        return { ok: true };
    }
    catch (e)
    {
        return { ok: false, error: String(e && e.message ? e.message : e) };
    }
}

// the WhatsApp internals the core features depend on (see core/diagnostics.js)
function registerCoreDiagnostics()
{
    if (typeof Diagnostics == "undefined") return;

    // every require() in exposeWhatsAppAPI, plus the logger hooks
    var modules = ["WAWebDownloadManager", "WAWebChatCollection", "WAWebUpdateUnreadChatAction", "WAComms",
        "WAWebChatLoadMessages", "WASendPresenceStatusProtocol", "WAWebSignalProtocolStore", "WAWebSignalCommonUtils",
        "WAWebWidFactory", "WAWebWidToJid", "WALogger", "WALoggerUtils"];
    modules.forEach(function(name)
    {
        Diagnostics.register("core", "module", name, function() { return require(name) != null; });
    });
    Diagnostics.register("status", "module", "WAWebStatusCollection", function() { return getStatusCollection() != null; });
    Diagnostics.register("status", "module", "downloadManager (bulk status)", function() { return window.WhatsAppAPI != null && WhatsAppAPI.downloadManager != null; });
    Diagnostics.register("status", "hook", "status-viewer-id", function() { return statusViewerIdResolutions; });
    Diagnostics.register("send", "export", "sendTextMsgToChat", function() { return findSendTextFunction() != null; });
    Diagnostics.register("send", "export", "addAndSendMsgToChat", function() { return findAddAndSendFunction() != null; });
    Diagnostics.register("core", "hook", "interception", function() { return isInitializing === false; });
    Diagnostics.register("core", "db", "deletedMsgs", function() { return window.deletedMessagesDB != null; });
    Diagnostics.register("archive", "db", "deletedMsgs v3 stores", function()
    {
        var db = window.deletedMessagesDB;
        return db != null && db.objectStoreNames.contains("edits") && db.objectStoreNames.contains("ephemeral");
    });
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

    setTimeout(() => {
        var originalWALoggerLog = require("WALogger").LOG;
        var originalWALoggerDev = require("WALogger").DEV;
        var originalWALoggerWarn = require("WALogger").WARN;
        var originalWALoggerERROR = require("WALogger").ERROR;

        require("WALogger").LOG = hookedWALoggerLog;
        require("WALogger").DEV = hookedWALoggerDev;
        require("WALogger").ERROR = hookedWALoggerError;
        require("WALogger").WARN = hookedWALoggerWarn;

        function hookedWALoggerDev(n)
        {
            if (WAdebugMode)
            {
                for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
                var logLine = require("WALoggerUtils").rebuildTemplate(n, r)
                console.log("[WhatsApp DEV] " + logLine);
            }
            return originalWALoggerDev.apply(null, arguments);
        }
        function hookedWALoggerLog(n)
        {
            if (WAdebugMode)
            {
                for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
                var logLine = require("WALoggerUtils").rebuildTemplate(n, r)
                console.log("[WhatsApp LOG] " + logLine);
            }
            return originalWALoggerLog.apply(null, arguments);
        }
        function hookedWALoggerError(n)
        {
            for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
            var logLine = require("WALoggerUtils").rebuildTemplate(n, r)
            console.error("[WhatsApp ERROR] " + logLine);
            return originalWALoggerERROR.apply(null, arguments);
        }
        function hookedWALoggerWarn(n)
        {
            for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
            var logLine = require("WALoggerUtils").rebuildTemplate(n, r)
            console.warn("[WhatsApp WARN] " + logLine);
            return originalWALoggerWarn.apply(null, arguments);
        }
        
    }, 2000);

    

    function hookedPromiseError(event)
    {
        console.error("Unhandled promise rejection:");
        console.error(event ? event.reason : event);
        if (typeof originalOnUnhandledRejection == "function")
            return originalOnUnhandledRejection.call(window, event);
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

// Schema of the plaintext `deletedMsgs` DB.
//   v1: msgs   v2: msgs.originalID_index   v3: edits + ephemeral stores
// The stores are created whenever they are missing, whatever the old version says, because some users
// have a v3 database that was bumped without the new stores. See openDatabaseHealing (core/idb_open.js).
var DELETED_MSGS_DB_VERSION = 3;

function upgradeDeletedMsgsDB(db, txn, oldVersion)
{
    if (!db.objectStoreNames.contains('msgs'))
    {
        var store = db.createObjectStore('msgs', { keyPath: 'id' });
        console.log('WhatsIncognito: Deleted messages database generated');
        store.createIndex("originalID_index", "originalID");
    }
    else if (oldVersion < 2 && txn)
    {
        txn.objectStore("msgs").createIndex("originalID_index", "originalID");
    }

    if (!db.objectStoreNames.contains("edits"))
    {
        var edits = db.createObjectStore('edits', { keyPath: 'id' });
        edits.createIndex("targetId_index", "targetId");
    }
    if (!db.objectStoreNames.contains("ephemeral"))
    {
        var ephemeral = db.createObjectStore('ephemeral', { keyPath: 'id' });
        ephemeral.createIndex("chatJid_index", "chatJid");
    }
}

function isDeletedMsgsDBHealthy(db)
{
    return db.objectStoreNames.contains("msgs") && db.objectStoreNames.contains("edits") && db.objectStoreNames.contains("ephemeral");
}

function initializeDeletedMessagesDB()
{
    return openDatabaseHealing({
        indexedDB: indexedDB,
        name: "deletedMsgs",
        upgrade: upgradeDeletedMsgsDB,
        isHealthy: isDeletedMsgsDBHealthy,
        onOpen: function(db) { window.deletedMessagesDB = db; },
        onClose: function(db) { if (window.deletedMessagesDB === db) window.deletedMessagesDB = null; },
        log: function() { console.warn.apply(console, arguments); },
    }).catch(function(e)
    {
        console.error("WhatsIncognito: Error opening database");
        console.error(e);
    });
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
        waDebugBreak();
    }
    if (!looksGood && isIncoming)
    {
        // This can sometimes hit because on the encoding path, strings that represent numbers are always encoded with NIBBLE_8 (255) encoding.
        // But on the decoding path, WhatsApp servers could send us number strings encoded with regular BINARY_8 (252) encoding, 
        // which we will re-encode as NIBBLE_8 (255).
        //debugger;
    }
}