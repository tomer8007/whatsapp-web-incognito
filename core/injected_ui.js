// ---------------------
// UI Event handlers (page world)
// ---------------------

WAIPageBus.onPageMessage('ui:mainReady', function ()
{
    setTimeout(exposeWhatsAppAPI, 100);
    setTimeout(function ()
    {
        if (typeof readConfirmationsHookEnabled !== "undefined")
        {
            setGlobalColorVariableString(
                "--WDS-persistent-always-branded",
                readConfirmationsHookEnabled ? 'rgba(9, 210, 97, 0.3)' : 'rgba(9, 210, 97, 1)'
            );
        }
    }, 150);
});

WAIPageBus.onPageMessage('presence:set', function (data)
{
    if (!window.WhatsAppAPI || typeof WhatsAppAPI.sendPresenceStatusProtocol !== 'function') return;
    var status = (data && data.status) ? String(data.status) : 'available';
    WhatsAppAPI.sendPresenceStatusProtocol({ name: "", status: status });
});

WAIPageBus.onPageMessage('ui:paneChatOpened', function ()
{
    var chat = typeof getCurrentChat === "function" ? getCurrentChat() : null;
    if (chat && chat.id) chats[chat.id] = chat;
});

WAIPageBus.onPageMessage('ui:dropdownOpened', function ()
{
    // the user has opened a dropdown. Make sure clicking "Mark as read" triggers our code
    var dropdown = document.getElementsByClassName(UIClassNames.DROPDOWN_CLASS)[0];
    if (dropdown == undefined) return;

    var menuItems = dropdown.getElementsByClassName(UIClassNames.DROPDOWN_ENTRY_CLASS);
    var outerDropdown = document.getElementsByClassName(UIClassNames.OUTER_DROPDOWN_CLASS)[0];
    if (!outerDropdown) return;
    var reactResult = FindReact(outerDropdown);
    if (reactResult == null || !reactResult.props || !Array.isArray(reactResult.props.children) || reactResult.props.children.length == 0) return;

    var firstChild = reactResult.props.children[0];
    var reactMenuItems = firstChild && firstChild.props ? firstChild.props.children : null;
    if (!reactMenuItems || reactMenuItems.props == undefined || !Array.isArray(reactMenuItems.props.children)) return;

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

    if (props != null && props.chat && markAsReadButton)
    {
        var chatObj = props.chat;
        var name = chatObj.name;
        var formattedName = (chatObj.contact && chatObj.contact.name) || name;
        var jid = getJidOfChat(chatObj);
        var lastKey = chatObj.lastReceivedKey || {};
        var lastMessageIndex = lastKey.id;
        var unreadCount = chatObj.unreadCount || 0;
        var isGroup = chatObj.isGroup;
        var fromMe = lastKey.fromMe;
        if (unreadCount > 0)
        {
            // this is mark-as-read button, not mark-as-unread
            markAsReadButton.addEventListener("mousedown", function ()
            {
                var data = {
                    name: name,
                    formattedName: formattedName,
                    jid: jid,
                    lastMessageIndex: lastMessageIndex,
                    fromMe: fromMe,
                    unreadCount: unreadCount,
                    isGroup: isGroup
                };

                WAIPageBus.sendToHost('receipt:markAsReadClick', data);
            });
        }
    }
});

WAIPageBus.onPageMessage('receipt:send', async function (data)
{
    if (!data || !data.jid) return;
    var chat = await getChatByJID(data.jid);
    if (!chat) return;
    var chatContainer = { chat: chat };

    // The user asked for receipts; allow one to go out (see allowReceiptsFor in interception.js)
    allowReceiptsFor(data.jid);

    WhatsAppAPI.Seen.sendSeen(chatContainer).then(function ()
    {
        // TODO: remove the old blinking chats code
        if (data.jid in blinkingChats)
        {
            clearInterval(blinkingChats[data.jid]["timerID"]);
            delete blinkingChats[data.jid];
        }
        if (data.jid in blockedChats)
        {
            delete blockedChats[data.jid];
        }
    });

    if (typeof chat.unreadCount === "number" && typeof data.unreadCount === "number")
    {
        chat.unreadCount = Math.max(0, chat.unreadCount - data.unreadCount);
    }

    // animate out the incognito message
    var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
    if (warningMessage != null && warningMessage.messageID && warningMessage.messageID.startsWith(data.jid))
    {
        if (typeof Velocity === "function")
        {
            Velocity(warningMessage, { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
            setTimeout(function () { if (warningMessage.parentNode) warningMessage.remove(); }, 300);
        }
        else if (warningMessage.parentNode)
        {
            warningMessage.remove();
        }
    }
});

WAIPageBus.onPageMessage('deletedMsg:lookup', function (data)
{
    var msgID = data && data.messageID;
    if (!msgID) return;

    if (window.deletedMessagesDB == null)
    {
        WAIPageBus.sendToHost('deletedMsg:result', { messageData: undefined, messageID: msgID });
        return;
    }

    try
    {
        var transaction = window.deletedMessagesDB.transaction('msgs', "readonly");
        var msgsStore = transaction.objectStore("msgs");

        // search the message ID in both the original message ID and the revoked message ID
        var requestByID = msgsStore.get(msgID);

        requestByID.onsuccess = function ()
        {
            var messageData = requestByID.result;
            if (messageData)
            {
                WAIPageBus.sendToHost('deletedMsg:result', { messageData: messageData, messageID: msgID });
                return;
            }

            // Did not find the message data by revoked message ID. try by original message ID
            var originalIDIndex = msgsStore.index('originalID_index');
            var requestByOriginalID = originalIDIndex.get(msgID);
            requestByOriginalID.onsuccess = function ()
            {
                WAIPageBus.sendToHost('deletedMsg:result', { messageData: requestByOriginalID.result, messageID: msgID });
            };
            requestByOriginalID.onerror = function ()
            {
                WAIPageBus.sendToHost('deletedMsg:result', { messageData: undefined, messageID: msgID });
            };
        };
        requestByID.onerror = function ()
        {
            WAIPageBus.sendToHost('deletedMsg:result', { messageData: undefined, messageID: msgID });
        };
    }
    catch (err)
    {
        WAIPageBus.sendToHost('deletedMsg:result', { messageData: undefined, messageID: msgID });
    }
});

WAIPageBus.onPageMessage('deviceType:lookup', function (data)
{
    var msgID = data && data.messageID;
    if (!msgID) return;
    var deviceType = null;

    if (deviceTypesPerMessage[msgID] != undefined && showDeviceTypesEnabled)
        deviceType = deviceTypesPerMessage[msgID];

    setTimeout(function ()
    {
        WAIPageBus.sendToHost('deviceType:result', { deviceType: deviceType, messageID: msgID });
    }, 20);
});

document.addEventListener('onOptionsUpdate', function (e)
{
    var options = {};
    try
    {
        options = typeof e.detail === "string" ? JSON.parse(e.detail) : (e.detail || {});
    }
    catch (err) { return; }
    if (!options || typeof options !== "object") return;

    var isReadHookActive = ('readConfirmationsHook' in options)
        ? Boolean(options.readConfirmationsHook)
        : (typeof readConfirmationsHookEnabled !== "undefined" ? Boolean(readConfirmationsHookEnabled) : true);

    // update graphics
    if (isReadHookActive)
    {
        // set unread counters to transparent
        setGlobalColorVariableString("--WDS-persistent-always-branded", 'rgba(9, 210, 97, 0.3)');
    }
    else
    {
        for (var chatId in blinkingChats)
        {
            if (blinkingChats[chatId] && blinkingChats[chatId].timerID)
            {
                clearInterval(blinkingChats[chatId].timerID);
            }
            delete blinkingChats[chatId];
        }

        // set unread counters to solid
        setGlobalColorVariableString("--WDS-persistent-always-branded", 'rgba(9, 210, 97, 1)');
        var warningMessage = document.getElementsByClassName("incognito-message").length > 0
            ? document.getElementsByClassName("incognito-message")[0]
            : null;
        if (warningMessage != null)
        {
            if (typeof Velocity === "function")
            {
                Velocity(warningMessage, { scaleY: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
                setTimeout(function () { if (warningMessage.parentNode) warningMessage.parentNode.removeChild(warningMessage); }, 300);
            }
            else if (warningMessage.parentNode)
            {
                warningMessage.parentNode.removeChild(warningMessage);
            }
        }

        var unreadCounters = document.getElementsByClassName(UIClassNames.UNREAD_COUNTER_CLASS);
        for (var i = 0; i < unreadCounters.length; i++)
        {
            unreadCounters[i].classList.remove("blocked-color");
        }
    }
});

document.addEventListener('onReadConfirmationBlocked', async function (e)
{
    var blockedJid = e && e.detail ? String(e.detail) : "";
    if (!blockedJid) return;
    var atIdx = blockedJid.indexOf("@");
    var blockedUser = atIdx !== -1 ? blockedJid.substring(0, atIdx) : blockedJid;

    var chat = await getChatByJID(blockedJid);
    if (!chat)
    {
        console.warn("WAIncognito: Did not find chat for JID " + blockedJid);
        return;
    }

    var chatUser = chat.id ? chat.id.user : null;
    var chatLid = chat.accountLid ? chat.accountLid.toString() : "";

    if (readConfirmationsHookEnabled && safetyDelay > 0 && chatUser == blockedUser)
    {
        markChatAsPendingReciptsSending(chat);
    }
    else if (readConfirmationsHookEnabled && (chatUser == blockedUser || chatLid == blockedJid))
    {
        markChatAsBlocked(chat);
    }
    else
    {
        console.warn("WAIncognito: Could not find chat for JID " + blockedJid);
    }

    if (chat.id != null) blockedChats[chat.id] = chat;
});

function markChatAsPendingReciptsSending(chat)
{
    if (!chat || !chat.id) return;
    if (chat.pendingSeenCount != 0) chat.pendingSeenCount = 0;

    if (chat.unreadCount == 0)
    {
        return;
    }

    var currentChat = getCurrentChat();
    if (!currentChat || !currentChat.id || currentChat.id.user != chat.id.user)
    {
        return;
    }

    var lastKey = chat.lastReceivedKey || {};
    var messageID = getJidOfChat(chat) + (lastKey.id || "");
    var previousMessage = document.getElementsByClassName("incognito-message").length > 0
        ? document.getElementsByClassName("incognito-message")[0]
        : null;
    var seconds = safetyDelay;

    var chatWindow = getCurrentChatPanel();
    var parent = document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0];

    if (chatWindow != null && parent != null && chat.unreadCount > 0 && (previousMessage == null || previousMessage.messageID != messageID))
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
        if (previousMessage != null && previousMessage.parentNode === parent)
            parent.removeChild(previousMessage);
        else if (previousMessage != null && previousMessage.parentNode)
            previousMessage.parentNode.removeChild(previousMessage);

        var unreadMarker = getUnreadMarkerElement(parent);
        if (unreadMarker != null && unreadMarker.parentNode)
            unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
        else
        {
            warningMessage.setAttribute('class', 'incognito-message');
            parent.appendChild(warningMessage);
        }

        if (typeof Velocity === "function")
        {
            Velocity(warningMessage, { height: warningMessage.clientHeight, opacity: 1, marginTop: [12, 0], marginBottom: [12, 0] },
                { defaultDuration: 400, easing: [.1, .82, .25, 1] });
        }

        var blockedChatElem = findChatEntryElementForJID(chat.id);

        function makeUnreadCounterBlink()
        {
            chat.pendingSeenCount = 0;

            if (blockedChatElem != null)
            {
                var unreadCounter = blockedChatElem.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);
                if (unreadCounter != null)
                {
                    unreadCounter.classList.add("blinking");
                }
            }
        }

        makeUnreadCounterBlink();
        setTimeout(makeUnreadCounterBlink, 200); // for multi-device pendingSeenCount

        var id = setInterval(function ()
        {
            chat.pendingSeenCount = 0;

            seconds--;
            if (seconds > 0)
            {
                if (warningMessage.firstChild)
                {
                    warningMessage.firstChild.textContent = "Sending read receipts in " + seconds + " seconds...";
                }
                blinkingChats[chat.id] = { timerID: id, time: seconds, chat: chat };
            }
            else
            {
                // time's up, sending receipt
                clearInterval(id);
                var currentLastKey = chat.lastReceivedKey || {};
                var data = {
                    jid: getJidOfChat(chat),
                    index: currentLastKey.id,
                    fromMe: currentLastKey.fromMe,
                    unreadCount: chat.unreadCount
                };
                WAIPageBus.sendToPage('receipt:send', data);

                var unreadCounter = blockedChatElem ? blockedChatElem.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS) : null;
                if (unreadCounter)
                {
                    unreadCounter.className = unreadCounter.className.replace("blocked-color", "").replace("blinking", "");
                }
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
    if (!chat || !chat.id) return;
    if (chat.unreadCount == 0 && chat.pendingSeenCount == 0)
    {
        return;
    }

    var currentChat = getCurrentChat();
    var lastKey = chat.lastReceivedKey || {};
    var messageID = getJidOfChat(chat) + (lastKey.id || "");
    var warningMessage = null;
    var warningWasEmpty = false;

    if (currentChat && currentChat.id && currentChat.id.user == chat.id.user)
    {
        //
        // Create a "receipts blocked" warning if needed
        //

        warningMessage = document.getElementsByClassName("incognito-message").length > 0
            ? document.getElementsByClassName("incognito-message")[0]
            : null;
        warningWasEmpty = warningMessage == null;
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

        var sendBtn = warningMessage.lastChild;
        if (sendBtn)
        {
            sendBtn.setAttribute('class', 'incognito-send-button');
            sendBtn.innerHTML = "Mark as read";
            sendBtn.onclick = function ()
            {
                var currentLastKey = chat.lastReceivedKey || {};
                var data = {
                    name: chat.name,
                    jid: getJidOfChat(chat),
                    lastMessageIndex: currentLastKey.id,
                    fromMe: currentLastKey.fromMe,
                    unreadCount: chat.unreadCount,
                    isGroup: chat.isGroup,
                    formattedName: (chat.contact && chat.contact.name) || chat.name || ""
                };
                WAIPageBus.sendToHost('receipt:markAsReadClick', data);
            };
        }

        warningMessage.messageID = messageID;

        //
        // Put that warning in the chat panel, under the unread counter or at the bottom
        //

        var innerChatPanel = document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0];
        if (innerChatPanel)
        {
            var unreadMarker = getUnreadMarkerElement(innerChatPanel);
            if (unreadMarker != null && unreadMarker.parentNode)
                unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
            else
            {
                warningMessage.setAttribute('class', 'incognito-message');
                innerChatPanel.appendChild(warningMessage);
            }
        }
    }
    else
    {
        console.warn("WAIncognito: Could not mark chat " + chat.id + " as blocked.");
    }

    //
    // turn the unread counter of the chat to red
    //

    function markUnreadCounter()
    {
        var blockedChatElem = findChatEntryElementForJID(chat.id);
        chat.pendingSeenCount = 0;

        if (blockedChatElem != null)
        {
            var unreadCounter = blockedChatElem.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);
            if (unreadCounter && typeof unreadCounter.className === "string" && !unreadCounter.className.includes("blocked-color"))
                unreadCounter.classList.add("blocked-color");
        }
    }

    markUnreadCounter();
    setTimeout(markUnreadCounter, 200); // for multi-device pendingSeenCount

    // if it didn't exist previously, animate it in
    if (warningMessage)
    {
        if ((blockedChats[chat.id] == undefined || warningWasEmpty) && typeof Velocity === "function")
            Velocity(warningMessage, { scaleY: [1, 0], opacity: [1, 0] }, { defaultDuration: 400, easing: [.1, .82, .25, 1] });

        if (warningMessage.firstChild)
            warningMessage.firstChild.textContent = "Read receipts were blocked.";
    }
}

function setGlobalColorVariableString(variable, colorString)
{
    var selector2 = ".xj6uduu.xj6uduu, .xj6uduu.xj6uduu:root";
    var selector3 = ".x8mwjyx.x8mwjyx, .x8mwjyx.x8mwjyx:root";
    var selector4 = ".x1h89ln0.x1h89ln0, .x1h89ln0.x1h89ln0:root";
    var selector5 = ".xul6ihk.xul6ihk, .xul6ihk.xul6ihk:root";
    var selector6 = ".x1646n1n.x1646n1n,.x1646n1n.x1646n1n:root";
    var selector7 = ".x8rilwt.x8rilwt, .x8rilwt.x8rilwt:root";
    var selector8 = ".xfmqtgv.xfmqtgv, .xfmqtgv.xfmqtgv:root";

    if (document.querySelector(selector8))
        document.querySelector(selector8).style.setProperty(variable, colorString);

    if (document.querySelector(selector6))
        document.querySelector(selector6).style.setProperty(variable, colorString);
    if (document.querySelector(selector7))
        document.querySelector(selector7).style.setProperty(variable, colorString);

    if (document.querySelector(selector2))
        document.querySelector(selector2).style.setProperty(variable, colorString);

    if (document.querySelector(selector5))
        document.querySelector(selector5).style.setProperty(variable, colorString);

    if (document.querySelector(UIClassNames.GLOBAL_COLORS_CONTAINER_SELECTOR))
    {
        document.querySelector(UIClassNames.GLOBAL_COLORS_CONTAINER_SELECTOR).style.setProperty(variable, colorString);
    }

    if (document.querySelector(selector3))
    {
        document.querySelector(selector3).style.setProperty(variable, colorString);
    }

    if (document.querySelector(":root"))
    {
        document.querySelector(':root').style.setProperty(variable, colorString);
    }

    if (document.querySelector(".color-refresh"))
    {
        document.querySelector('.color-refresh').style.setProperty(variable, colorString);
    }
}

function getUnreadMarkerElement(parentElement = null)
{
    if (parentElement == null) parentElement = document;

    var elements1 = parentElement.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS);
    var elements2 = parentElement.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS_2);
    var elements3 = parentElement.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS_3);

    if (elements1.length > 0) return elements1[0];
    if (elements2.length > 0) return elements2[0];
    if (elements3.length > 0) return elements3[0];

    return null;
}

WAIErrorHook.installErrorHook();
