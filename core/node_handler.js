//
// Handling nodes
//

var NodeHandler = {};
const MAX_DEVICE_LABELS = 10000;

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

NodeHandler.isSentNodeAllowed = function (node)
{
    var action = node.tag;
    var data = node.attrs;

    var jid = data.jid ? data.jid : data.to;
    if (jid) jid = normalizeJID(jid.toString());

    var shouldBlock = 
        (readConfirmationsHookEnabled && action === "read") ||
        (readConfirmationsHookEnabled && action == "receipt" && data["type"] == "read") ||
        (readConfirmationsHookEnabled && action == "receipt" && data["type"] == "read-self") ||
        (readConfirmationsHookEnabled && action == "receipt" && data["type"] === "played" && isChatBlocked(jid)) ||

        (onlineUpdatesHookEnabled && action === "presence" && data["type"] === "available") ||
        (typingUpdatesHookEnabled && action == "presence" && data["type"] == "composing") ||
        (typingUpdatesHookEnabled && action == "chatstate" && node.content[0].tag == "composing");

    if (shouldBlock)
    {
        switch (action)
        {
            case "read":
            case "receipt":

                var isReadReceiptAllowed = readReceiptExceptions.get(jid)?.expiresAt > Date.now();
                if (isReadReceiptAllowed)
                {
                    // this is the user trying to send out a read receipt.
                    console.log("WhatsIncongito: Allowing read receipt to " + jid);

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
    if (autoReceiptOnReplay && isChatBlocked(remoteJid))
    {
        // If the user replyed to a message from this JID,
        // It probably means we can send read receipts for it.

        // don't try to send receipts for multiple devices
        if (!remoteJid.includes(":"))
        {
            var chat = await getChatByJID(remoteJid);
            if (!chat?.lastReceivedKey) return encNode;
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

    if (showDeviceTypesEnabled && messageId)
    {
        const looksLikePhone = participant.includes(":0@") || !participant.includes(":");
        deviceTypesPerMessage.set(messageId, looksLikePhone ? "phone" : "computer");
        // shortcut: keep recent labels in memory, use a durable cache if older history needs labels.
        if (deviceTypesPerMessage.size > MAX_DEVICE_LABELS)
            deviceTypesPerMessage.delete(deviceTypesPerMessage.keys().next().value);
    }

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

        indexOfEncNode = 0;
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
    const messageId = messageNode.attrs?.id;
    await interceptViewOnceMessages(e2eMessage, messageId);
    const sourceJid = messageNode.attrs?.from?.toString();
    const remoteJid = messageNode.attrs?.sender_pn?.toString() ?? sourceJid;
    if (saveDeletedMsgsHookEnabled && NodeHandler.checkForMessageDeletionNode(e2eMessage, messageId, remoteJid, sourceJid))
    {
        console.log("WhatsIncognito: --- Detected message REVOKE action! ---");
        return false;
    }
    return true;
}

NodeHandler.checkForMessageDeletionNode = function(message, messageId, remoteJid, sourceJid)
{
    //
    // Check if this is a message deletion node
    //
    var messageRevokeValue = Message.ProtocolMessage.Type.REVOKE.value;
    if (message && message.protocolMessage && message.protocolMessage.type == messageRevokeValue)
    {
        const key = message.protocolMessage.key;
        if (key?.id)
        {
            if (sourceJid === "status@broadcast" || key.remoteJid === "status@broadcast")
                recordBlockedStatusDeletion(key.id);
            else
                onDeletionMessageBlocked(message, remoteJid, messageId, key.id);
        }

        return true;
    }

    return false;
}
