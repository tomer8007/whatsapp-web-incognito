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
        manipulatedNode.tag = "blocked_node";
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
    var shouldBlock = 
        (readConfirmationsHookEnabled && action === "read") ||
        (readConfirmationsHookEnabled && action == "receipt" && data["type"] == "read") ||
        (readConfirmationsHookEnabled && action == "receipt" && data["type"] == "read-self") ||
        (readConfirmationsHookEnabled && action == "receipt" && data["type"] === "played") ||
        (readConfirmationsHookEnabled && action == "received" && data["type"] === "played") ||

        (onlineUpdatesHookEnabled && action === "presence" && data["type"] === "available") ||
        (typingUpdatesHookEnabled && action == "presence" && data["type"] == "composing") ||
        (typingUpdatesHookEnabled && action == "chatstate" && node.content[0].tag == "composing");

    if (shouldBlock)
    {
        switch (action)
        {
            case "read":
            case "receipt":
                var jid = data.jid ? data.jid : data.to;
                jid = normalizeJID(jid.toString());

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
            var data = { jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
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

    // check for device type
    var looksLikePhone = participant.includes(":0@") || !participant.includes(":");
    var deviceType = looksLikePhone ? "phone" : "computer";
    deviceTypesPerMessage[messageId] = deviceType;

    var e2eMessagesAllowedStatus = [];

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
    
            var isNodeAllowed = true;
            for (var status of e2eMessagesAllowedStatus)
            {
                if (!status.isAllowed && status.indexInEncNodes == indexOfEncNode)
                {
                    isNodeAllowed = false;
                }
            }

            if (isNodeAllowed)
            {
                modifiedMessageNode.content.push(node);
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
    
    if (messageNode.attrs != null)
    {
        messageId = messageNode.attrs["id"];

        remoteJid = messageNode.attrs["from"].toString();
        participant = messageNode.attrs["participant"];
        participant = participant ? participant : remoteJid;

        if (messageNode.attrs["sender_pn"] != null)
        {
            // we prefer the full phone number JID over the possible LID
            remoteJid = messageNode.attrs["sender_pn"].toString();
        }
    }

    var isRevokeMessage = NodeHandler.checkForMessageDeletionNode(e2eMessage, messageId, remoteJid);
    await interceptViewOnceMessages(e2eMessage, messageId);

    if (!saveDeletedMsgsHookEnabled)
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

NodeHandler.checkForMessageDeletionNode = function(message, messageId, remoteJid)
{
    //
    // Check if this is a message deletion node
    //
    var messageRevokeValue = Message.ProtocolMessage.Type.REVOKE.value;
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