//
// Handling nodes
//

var NodeHandler = {};

NodeHandler.interceptOutgoingNode = async function (node)
{
    var isAllowed = NodeHandler.isSentNodeAllowed(node);
    if (!isAllowed)
    {
        var manipulatedNode = deepClone(node);
        manipulatedNode.tag = "iq";
        return [isAllowed, manipulatedNode];
    }

    //
    // Check for message nodes
    //
    if (node.tag == "message")
    {
        // manipulating a message node
        node = await NodeHandler.onOutgoingMessageNode(node);
    }

    return [true, node];
}

// The global setting, unless a rule for this contact (pn or lid form) says otherwise.
NodeHandler.isBlockedForContact = function (jid, field, globalBlocked)
{
    if (!jid || typeof resolveRule != "function") return globalBlocked;
    try
    {
        return resolveRule(contactRules, jidCandidates(jid, lidPnMap), field, globalBlocked);
    }
    catch (exception)
    {
        return globalBlocked;
    }
}

NodeHandler.isSentNodeAllowed = function (node)
{
    var action = node.tag;
    var data = node.attrs;

    var jid = data.jid ? data.jid : data.to;
    if (jid) jid = normalizeJID(jid.toString());

    // read receipts and typing can be overridden per contact (core/contact_rules.js). Online presence stays global.
    var readBlocked = NodeHandler.isBlockedForContact(jid, "readReceipts", readConfirmationsHookEnabled);
    var typingBlocked = NodeHandler.isBlockedForContact(jid, "typing", typingUpdatesHookEnabled);
    var explicitReadBlock = NodeHandler.isBlockedForContact(jid, "readReceipts", false);

    var shouldBlock = 
        (readBlocked && action === "read") ||
        (readBlocked && action == "receipt" && data["type"] == "read") ||
        (readBlocked && action == "receipt" && data["type"] == "read-self") ||
        (readBlocked && action == "receipt" && data["type"] === "played" && (isChatBlocked(jid) || explicitReadBlock)) ||

        (onlineUpdatesHookEnabled && action === "presence" && data["type"] === "available") ||
        (typingBlocked && action == "presence" && data["type"] == "composing") ||
        (typingBlocked && action == "chatstate" && node.content[0].tag == "composing");

    if (shouldBlock)
    {
        switch (action)
        {
            case "read":
            case "receipt":

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

                    // TODO: Is the unsent message problem due to blocking read-self?
                    // why there are read receipts we need to block after sending a message to a lot of people?
                    setTimeout(function()
                    {
                        if (WhatsAppAPI.Communication)
                        {
                            console.log("Clearing ack expections after blocking a receipt.");
                            // clear expectations for acks that will never be received (becase we blocked them earlier)
                            WhatsAppAPI.Communication.ackHandlers = WhatsAppAPI.Communication.ackHandlers.filter(ack => !(ack.stanza.attrs.type == "read" && 
                                                                                                                    ack.stanza.attrs.to.toString() == jid));
                        }
            
                    }, 200);

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


    return true;
}

NodeHandler.onOutgoingMessageNode = async function (messageNode)
{
    var childNodes = messageNode.content;
    for (var i = 0; i < childNodes.length; i++)
    {
        var childNode = childNodes[i];

        try
        {
            if (childNode.tag == "enc")
            {
                childNodes[i] = await this.onSentEncNode(childNode, messageNode.attrs["to"].toString());
            }

            // list of devices to which a copy of the message is sent
            // say, in a message to a group, will contain copies of the message for each group participant.
            // in a private chat, will contain copies for the recipient and for the sender's real device
            if (childNode.tag == "participants")
            {
                var participants = childNode.content;
                for (var j = 0; j < participants.length; j++)
                {
                    var participant = participants[j];
                    if (participant.tag != "to") continue;
    
                    var encNode = participant.content[0];
                    if (encNode.tag == "enc")
                    {
                        var toJID = participant.attrs["jid"] ? participant.attrs["jid"]: participant.attrs["from"];

                        encNode = await this.onSentEncNode(encNode, toJID.toString());
                        participant.content[0] = encNode;
                        participants[j] = participant;
                    }
                }
            }
        }
        catch (exception)
        {
            console.error("WhatsIncognito: Allowing WA packet due to exception:");
            console.error(exception);
            console.error(exception.stack);
            return [true, messageNode]
        }
    }

    return messageNode;
}

//
// `enc` nodes seem to represnet an encryption of the message for one device.
// <message id="..." to="....@s.whatsapp.net" type="text">
//   <participants>
//      <to jid="...@s.whatsapp.net">               // <----- your own phone
//          <enc v="2" type="msg">...</enc>
//      </to>
//      <to jid="...@s.whatsapp.net">               // <---  one device of the recipant
//          <enc v="2" type="msg">...</enc>
//      </to>
//  </participants>
//  </message>
//
//  or
// <message id="..." to="....@s.whatsapp.net" type="text">
//     <enc v="2" type="pkmsg">...</enc>
// </message>
NodeHandler.onSentEncNode = async function (encNode, remoteJid)
{
    if (remoteJid && isChatBlocked(remoteJid) && autoReceiptOnReplay)
    {
        // If the user replyed to a message from this JID,
        // It probably means we can send read receipts for it.

        // don't try to send receipts for multiple devices
        if (!remoteJid.includes(":"))
        {
            var chat = await getChatByJID(remoteJid);
            var data = { jid: getJidOfChat(chat), index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
            setTimeout(function () { document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) })); }, 600);
        }
    }

    // do message manipulation if needed
    //         ...
    var putBreakpointHere = 1;

    return encNode;
}

NodeHandler.interceptReceivedNode = async function (node)
{
    var isAllowed = true;

    if (node.tag == "message")
    {
        var [isAllowed, node] = await NodeHandler.onReceivedMessageNode(node);
    }

    return [isAllowed, node];
}

NodeHandler.onReceivedMessageNode = async function(messageNode)
{
    var isAllowed = true;

    var messageId = messageNode.attrs["id"];
    var remoteJid = messageNode.attrs["from"];
    var participant = messageNode.attrs["participant"];
    participant = participant ? participant : remoteJid;
    participant = participant.toString();

    // remember which lid belongs to which phone number (per-contact rules can be stored under either)
    try
    {
        if (messageNode.attrs["sender_pn"] != null && typeof rememberLidPair == "function")
            rememberLidPair(lidPnMap, remoteJid.toString(), messageNode.attrs["sender_pn"].toString());
    }
    catch (exception) { /* best effort */ }

    // check for device type
    var looksLikePhone = participant.includes(":0@") || !participant.includes(":");
    var deviceType = looksLikePhone ? "phone" : "computer";
    deviceTypesPerMessage[messageId] = deviceType;

    var e2eMessagesAllowedStatus = [];

    // Decrypt the inner messages and decide if we want to block some of them
    var e2eMessages = await MultiDevice.decryptE2EMessagesFromMessageNode(messageNode);
    for (var i = 0; i < e2eMessages.length ;i++)
    {
        var e2eMessage = e2eMessages[i];
        var isE2EMessageAllowed = await NodeHandler.onReceivedE2EMessage(messageNode, e2eMessage);
        e2eMessagesAllowedStatus.push({e2eMessage: e2eMessage, isAllowed: isE2EMessageAllowed, indexInEncNodes : i});
    }

    var numOfE2EMessagesBlocked = e2eMessagesAllowedStatus.filter(status => !status.isAllowed).length;
    if (numOfE2EMessagesBlocked > 0)
    {
        console.log("WhatsIncogito: Blocking incoming REVOKE message node.");
        isAllowed = false;
    }

    if (WAdebugMode && e2eMessages.length > 0)
    {
        console.log("Got messages:");
        console.log(e2eMessages);
    }

    //
    // Now, edit the message node so that "enc" sub-nodes that we don't like will be ignored by the original WA client
    //

    var modifiedMessageNode = messageNode;
    
    if (!isAllowed)
    {
        modifiedMessageNode = deepClone(messageNode);
        modifiedMessageNode.content = [];

        var indexOfEncNode = 0;
        for (var i = 0; i < messageNode.content.length; i++)
        {
            var node = messageNode.content[i];
            if (node.tag != "enc") 
            {
                modifiedMessageNode.content.push(node);
                continue;
            }
    
            // Check if this specific "enc" message node is allowed, as was decided previously.
            var isNodeAllowed = true;
            for (var status of e2eMessagesAllowedStatus)
            {
                if (!status.isAllowed && status.indexInEncNodes == indexOfEncNode)
                {
                    isNodeAllowed = false;
                }
            }

            // If the "enc" is allowed, include it in our modified clone  
            if (isNodeAllowed)
            {
                modifiedMessageNode.content.push(node);
            }
            else
            {
                // TODO: simply removing the <enc> from the <message> might result in WhatsApp saying "[WhatsApp LOG] failedParsingMessage: '....' (XmppParsingFailure)"
                //      and uploading logs. We could find a better way to edit the message
                
            }
    
            indexOfEncNode++;
        }
    }

    return [isAllowed, modifiedMessageNode];
}

NodeHandler.onReceivedE2EMessage = async function(messageNode, e2eMessage)
{
    var isAllowed = true;
    var remoteJid = null;
    var participant = null;
    var messageId = null;
    var isStatusNode = false;

    if (messageNode.attrs != null)
    {
        messageId = messageNode.attrs["id"];

        remoteJid = messageNode.attrs["from"].toString();
        participant = messageNode.attrs["participant"];
        participant = participant ? participant : remoteJid;

        isStatusNode = remoteJid == STATUS_BROADCAST_JID;

        // (for a status, "from" is status@broadcast and the sender is the participant: keep it that way)
        if (messageNode.attrs["sender_pn"] != null && !isStatusNode)
        {
            // we prefer the full phone number JID over the possible LID
            remoteJid = messageNode.attrs["sender_pn"].toString();
        }
    }

    var isRevokeMessage = NodeHandler.checkForMessageDeletionNode(e2eMessage, messageId, remoteJid, participant ? participant.toString() : null);
    try
    {
        await interceptViewOnceMessages(e2eMessage, messageId);
    }
    catch (exception)
    {
        // A view-once failure must not make the whole packet pass through unmodified (that would let REVOKEs through)
        console.error("WhatsIncognito: Ignoring error while handling a view-once message:");
        console.error(exception);
    }

    NodeHandler.trackEdits(e2eMessage, messageId, remoteJid);
    NodeHandler.keepEphemeral(e2eMessage, messageId, remoteJid, participant ? participant.toString() : remoteJid);

    if (!NodeHandler.shouldBlockRevoke(remoteJid))
    {
        isAllowed = true;
    }
    else if (isRevokeMessage)
    {
        console.log("WhatsIncognito: --- Detected message REVOKE action! ---");
        isAllowed = false;
    }

    return isAllowed;
}

// Revokes in chats are blocked with "saveDeletedMsgs". Revokes of statuses are blocked with "saveDeletedStatus" or "saveDeletedMsgs".
NodeHandler.shouldBlockRevoke = function(remoteJid)
{
    if (saveDeletedMsgsHookEnabled) return true;
    return remoteJid == STATUS_BROADCAST_JID && !!(window.WAIncognitoOptions || {}).saveDeletedStatus;
}

NodeHandler.checkForMessageDeletionNode = function(message, messageId, remoteJid, participant)
{
    //
    // Check if this is a message deletion node
    //
    var messageRevokeValue = Message.ProtocolMessage.Type.REVOKE.value;
    if (message && message.protocolMessage && message.protocolMessage.type == messageRevokeValue)
    {
        var deletedMessageId = message.protocolMessage.key.id;
        if (NodeHandler.shouldBlockRevoke(remoteJid))
        {
            onDeletionMessageBlocked(message, remoteJid, messageId, deletedMessageId, participant);
        }

        return true;
    }

    return false;
}

//
// Edit tracking (core/edit_tracker.js). Edits are never blocked: WhatsApp still shows the new version.
// Active when "saveEdits" (keep the original) or "toastOnEdit" (notify) is on. Never throws.
//
NodeHandler.trackEdits = function(e2eMessage, messageId, remoteJid)
{
    try
    {
        var options = window.WAIncognitoOptions || {};
        if (!options.saveEdits && !options.toastOnEdit) return;
        if (typeof EditTracker == "undefined") return;

        var edit = EditTracker.detectEdit(e2eMessage);
        if (!edit)
        {
            var text = extractText(e2eMessage);
            if (text != null && messageId) EditTracker.remember(messageId, text, Date.now());
            return;
        }

        NodeHandler.processEdit(edit, remoteJid, options).catch(function() { console.warn("WAIncognito: edit tracking failed"); });
    }
    catch (exception)
    {
        console.warn("WAIncognito: edit tracking failed");
    }
}

// An edit was detected. Always notifies (toast); keeps the original when it is known: from the 20-minute cache, or else from
// WhatsApp's own message model (chat.msgs), which still holds the old body at this point.
// Versions we already stored per message id (to drop duplicate packets of the same edit)
NodeHandler.lastEditBefore = new Map();
var EDIT_DUPLICATE_WINDOW_MS = 5000;

// How long to watch WhatsApp's own message model for the edited text (secret edits carry none)
NodeHandler.editPoll = { intervalMs: 250, maxMs: 6000, sleep: function(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); } };

NodeHandler.processEdit = async function(edit, remoteJid, options)
{
    // Secret edits carry no text, and WhatsApp has already decrypted the earlier edits itself: its own message model
    // holds the CURRENT body (the version this edit is about to replace). That is the most reliable "before", so it wins
    // when the edit has no text. With text, the cache holds the latest version we saw; the model is the fallback.
    var recalled = EditTracker.recall(edit.targetId);
    var chat = null;
    var fromModel = null;
    if (!recalled || edit.newText == null)
    {
        try { chat = await getChatByJID(remoteJid); fromModel = readOriginalFromChatModel(chat, edit.targetId); }
        catch (e) { fromModel = null; }
    }
    var original = edit.newText == null ? (fromModel ? resolveEditOriginal(null, fromModel) : resolveEditOriginal(recalled, null))
                                        : resolveEditOriginal(recalled, fromModel);

    var ts = Date.now();
    var previous = NodeHandler.lastEditBefore.get(edit.targetId);
    var duplicate = !!(original && previous && previous.text === original.text && ts - previous.ts < EDIT_DUPLICATE_WINDOW_MS);
    if (duplicate) return;

    document.dispatchEvent(new CustomEvent("waIncognitoEdited", { detail: JSON.stringify({ targetId: edit.targetId }) }));

    var newText = edit.newText;
    var samePreview = original && newText != null && newText === original.text; // e.g. a link preview update
    var record = null;

    if (original && !samePreview && options.saveEdits)
    {
        record = { kind: "edit", id: "edit:" + edit.targetId + ":" + ts, targetId: edit.targetId, original: original.text,
                   newText: newText, ts: ts, originalTs: original.ts, chatJid: remoteJid };
        saveArchiveRecord(record, "edits").catch(function() { console.warn("WAIncognito: could not save the original of an edited message"); });
    }
    if (original) NodeHandler.lastEditBefore.set(edit.targetId, { text: original.text, ts: ts });

    // a secret edit has no text: watch the message model until WhatsApp shows the edited body
    if (newText == null && original && chat)
    {
        var watched = await waitForBodyChange(function()
        {
            var model = readOriginalFromChatModel(chat, edit.targetId);
            return model ? model.text : null;
        }, original.text, NodeHandler.editPoll);
        if (watched != null)
        {
            newText = watched;
            if (record)
            {
                record.newText = watched;
                saveArchiveRecord(record, "edits").catch(function() { console.warn("WAIncognito: could not update an edit record"); });
            }
        }
    }

    if (typeof WAdebugMode != "undefined" && WAdebugMode)
    {
        console.log("WAIncognito: edit detected", { hasNewText: edit.newText != null, cacheHit: !!recalled, modelHit: !!fromModel,
                                                   original: original ? original.source : "unknown", afterKnown: newText != null,
                                                   saveEdits: !!options.saveEdits, toastOnEdit: !!options.toastOnEdit });
    }

    // the next edit of the same message starts from this version
    if (newText != null) EditTracker.remember(edit.targetId, newText, Date.now());

    if (!samePreview) notifyEditedMessage(remoteJid, newText != null ? newText : (original ? original.text : ""), edit.targetId, original ? original.text : null, newText != null);
}

//
// Disappearing messages (core/ephemeral_keeper.js): keep a copy when "keepDisappearing" is on. Never throws.
//
NodeHandler.keepEphemeral = function(e2eMessage, messageId, remoteJid, from)
{
    try
    {
        if (!(window.WAIncognitoOptions || {}).keepDisappearing) return;
        if (typeof isEphemeralMessage == "undefined" || !messageId || !isEphemeralMessage(e2eMessage)) return;

        // chats are looked up by their normalized JID (the same form the chat menu context uses)
        var chatJid = (typeof normalizeJID == "function" && remoteJid) ? normalizeJID(String(remoteJid)) : remoteJid;
        var snapshot = buildEphemeralSnapshot(e2eMessage, { messageId: messageId, chatJid: chatJid, from: from, ts: Date.now() });
        saveArchiveRecord(snapshot, "ephemeral").catch(function() { console.warn("WAIncognito: could not save a disappearing message"); });
    }
    catch (exception)
    {
        console.warn("WAIncognito: keeping a disappearing message failed");
    }
}
