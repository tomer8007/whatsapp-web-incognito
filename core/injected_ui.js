// ---------------------
// UI Event handlers
// ---------------------

document.addEventListener('onMainUIReady', function (e)
{
    setTimeout(exposeWhatsAppAPI, 100);
});

document.addEventListener('onPresenceOptionTicked', function (e)
{
    WhatsAppAPI.sendPresenceStatusProtocol({name:"",status:"unavailable"})
});

document.addEventListener('onPresenceOptionUnticked', function (e)
{
    WhatsAppAPI.sendPresenceStatusProtocol({name:"",status:"available"})
});


document.addEventListener('onIncognitoOptionsOpened', function (e)
{
    var drop = document.getElementsByClassName("drop")[0];
    fixCSSPositionIfNeeded(drop);
    Velocity(drop, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 100, easing: [.1, .82, .25, 1] });


    /*
    var safetyDelayPanel = document.getElementById("incognito-safety-delay-option-panel");
    if (!readConfirmationsHookEnabled)
    {
        safetyDelayPanel.style.opacity = 0;
        safetyDelayPanel.style.height = 0;
        safetyDelayPanel.style.marginTop = "-10px";
    }
    */
});

document.addEventListener('onIncognitoOptionsClosed', function (e)
{
    var drop = document.getElementsByClassName("drop")[0];
    fixCSSPositionIfNeeded(drop);
    Velocity(drop, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 100, easing: [.1, .82, .25, 1] });


    // if (!document.getElementById("incognito-radio-enable-safety-delay").checked) return;
    // validateSafetyDelay();
});

function validateSafetyDelay()
{
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
}

document.addEventListener('onOptionsUpdate', function (e)
{
    // update enforcing globals
    // TODO: move outside injected_ui.js
    var options = JSON.parse(e.detail);
    if ('readConfirmationsHook' in options) readConfirmationsHookEnabled = options.readConfirmationsHook;
    if ('onlineUpdatesHook' in options) onlineUpdatesHookEnabled = options.onlineUpdatesHook;
    if ('typingUpdatesHook' in options) typingUpdatesHookEnabled = options.typingUpdatesHook;
    if ('safetyDelay' in options) safetyDelay = options.safetyDelay;
    if ('saveDeletedMsgs' in options) saveDeletedMsgsHookEnabled = options.saveDeletedMsgs;
    if ('showDeviceTypes' in options) showDeviceTypesEnabled = options.showDeviceTypes;
    if ('autoReceiptOnReplay' in options) autoReceiptOnReplay = options.autoReceiptOnReplay;
    if ('allowStatusDownload' in options) allowStatusDownload = options.allowStatusDownload;

    // update graphics
    var safetyDelayPanel = document.getElementById("incognito-safety-delay-option-panel");
    var safetyDelayPanelExpectedHeight = 42; // be careful with this
    if (readConfirmationsHookEnabled)
    {
        // set unread counters to transperent
        setGlobalColorVaraibleString("--WDS-persistent-always-branded", 'rgba(9, 210, 97, 0.3)');
        if (safetyDelayPanel != null)
        {
            Velocity(safetyDelayPanel, { height: safetyDelayPanelExpectedHeight, opacity: 0.8, marginTop: 0 }, { defaultDuration: 200, easing: [.1, .82, .25, 1] });
        }
    }
    else
    {
        // set unread counters to solid
        setGlobalColorVaraibleString("--WDS-persistent-always-branded", 'rgba(9, 210, 97, 1)');
        if (safetyDelayPanel != null)
        {
            Velocity(safetyDelayPanel, { height: 0, opacity: 0, marginTop: -10 }, { defaultDuration: 200, easing: [.1, .82, .25, 1] });
        }
        var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ?
            document.getElementsByClassName("incognito-message")[0] : null;
        if (warningMessage != null)
        {
            Velocity(warningMessage, { scaleY: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
            setTimeout(function () { warningMessage.parentNode.removeChild(warningMessage); }, 300);
        }
    }

    var unreadCounters = document.getElementsByClassName(UIClassNames.UNREAD_COUNTER_CLASS);
    for (var i = 0; i < unreadCounters.length; i++)
    {
        unreadCounters[i].classList.remove("blocked-color");
    }
});

document.addEventListener('onReadConfirmationBlocked', async function (e)
{
    var blockedJid = e.detail;
    var blockedUser = blockedJid.substring(0, blockedJid.indexOf("@"));

    var chat = await getChatByJID(blockedJid);
    if (!chat) return;

    if (readConfirmationsHookEnabled && safetyDelay > 0 && chat.id.user == blockedUser)
    {
        markChatAsPendingReciptsSending(chat);
    }
    else if (readConfirmationsHookEnabled && chat.id.user == blockedUser)
    {
        markChatAsBlocked(chat);
    }
    else
    {
        console.warn("WAIncognito: Could not find chat for JID " + blockedJid);
    }

    if (!(chat.id in blockedChats))
    {
        // window.WhatsAppAPI.UI.scrollChatToBottom(chat);
    }

    blockedChats[chat.id] = chat;

});

document.addEventListener('onPaneChatOpened', function (e)
{
    var chat = getCurrentChat();
    chats[chat.id] = chat;
});

document.addEventListener('onDropdownOpened', function (e)
{
    // the user has opened a dropdown. Make sure clicking "Mark as read" triggers our code

    var dropdown = document.getElementsByClassName(UIClassNames.DROPDOWN_CLASS)[0];
    if (dropdown == undefined) return;

    var menuItems = dropdown.getElementsByClassName(UIClassNames.DROPDOWN_ENTRY_CLASS);
    var reactResult = FindReact(document.getElementsByClassName(UIClassNames.OUTER_DROPDOWN_CLASS)[0]);
    if (reactResult == null) return;
    if (reactResult.props.children.length == 0) return;

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
        var formattedName = props.chat.contact.name;
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
                var data = { name: name, formattedName: formattedName, jid: jid, lastMessageIndex: lastMessageIndex, 
                            fromMe: fromMe, unreadCount: unreadCount, isGroup: isGroup };

                document.dispatchEvent(new CustomEvent('onMarkAsReadClick', { detail: JSON.stringify(data) }));
            });
        }
    }
});

document.addEventListener('sendReadConfirmation', async function (e)
{
    var data = JSON.parse(e.detail);
    var messageIndex = data.index != undefined ? data.index : data.lastMessageIndex;
    var messageID = data.jid + messageIndex;

    var chat = await getChatByJID(data.jid);

    // add an exception and remove it after a short time at any case
    exceptionsList.push(normalizeJID(data.jid));
    setTimeout(function() { exceptionsList = exceptionsList.filter(i => i !== data.jid); }, 2000);
    
    WhatsAppAPI.Seen.sendSeen(chat).then(result =>
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
    });

    chat.unreadCount -= data.unreadCount;

    // animate out the incognito message
    var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
    if (warningMessage != null && warningMessage.messageID.startsWith(data.jid))
    {
        Velocity(warningMessage, { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
        setTimeout(function() {warningMessage.remove();}, 300);
    }

    //var node = ["action",{"type":"set","epoch":"30"},[["read",{"jid":data.jid,"index":data.index,"owner":"false","count":data.unreadCount.toString()},null]]];
    //WACrypto.sendNode(node);
});

document.addEventListener("getDeletedMessageByID", async function(e) 
{
    var data = JSON.parse(e.detail);
    var msgID = data.messageID;

    if (window.deletedMessagesDB == null) return;

    var transcation = window.deletedMessagesDB.transaction('msgs', "readonly");
    var msgsStore = transcation.objectStore("msgs");

    // search the message ID in both the original message ID and the revoked message ID
    let requestByID = msgsStore.get(msgID);
    
    requestByID.onsuccess = (e) =>
    {
        var messageData = requestByID.result;
        if (messageData)
        {
            document.dispatchEvent(new CustomEvent("onDeletedMessageReceived", {detail: JSON.stringify({messageData: messageData, messageID: msgID})}));
            return;
        }

        // Did not find the message data by revoked message ID. try by original message ID
        var originalIDIndex = msgsStore.index('originalID_index');
        var requestByOriginalID = originalIDIndex.get(msgID);
        requestByOriginalID.onsuccess = (e) =>
        {
            var messageData = requestByOriginalID.result;

            document.dispatchEvent(new CustomEvent("onDeletedMessageReceived", {detail: JSON.stringify({messageData: messageData, messageID: msgID})}));
        }
    }
    
});

document.addEventListener("getDeviceTypeForMessage", async function(e) 
{
    var data = JSON.parse(e.detail);
    var msgID = data.messageID;
    var deviceType = null;

    if (deviceTypesPerMessage[msgID] != undefined && showDeviceTypesEnabled)
        deviceType = deviceTypesPerMessage[msgID];

    setTimeout(function()
    {
        document.dispatchEvent(new CustomEvent("onDeviceTypeReceived", {detail: JSON.stringify({deviceType: deviceType, messageID: msgID})}));
    }, 20);
});

function markChatAsPendingReciptsSending(chat)
{
    if (chat.pendingSeenCount != 0) chat.pendingSeenCount = 0;

    if (chat.unreadCount == 0)
    {
        return;
    }

    var currentChat = getCurrentChat();
    if (currentChat.id.user != chat.id.user) 
    {
        return;
    }

    var messageID = chat.id + chat.lastReceivedKey.id;
    var previousMessage = document.getElementsByClassName("incognito-message").length > 0 ? 
                            document.getElementsByClassName("incognito-message")[0] : null;
    var seconds = safetyDelay;

    var chatWindow = getCurrentChatPanel();

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
        var unreadMarker = getUnreadMarkerElement(parent);
        if (unreadMarker != null)
            unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
        else
        {
            warningMessage.setAttribute('class', 'incognito-message');
            parent.appendChild(warningMessage);
        }
        Velocity(warningMessage, { height: warningMessage.clientHeight, opacity: 1, marginTop: [12, 0], marginBottom: [12, 0] },
            { defaultDuration: 400, easing: [.1, .82, .25, 1] });

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
                warningMessage.firstChild.textContent = "Sending read receipts in " + seconds + " seconds...";
                blinkingChats[chat.id] = { timerID: id, time: seconds, chat: chat };
            }
            else
            {
                // time's up, sending receipt
                clearInterval(id);
                var data = { jid: chat.id, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
                document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));

                var unreadCounter = blockedChatElem.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);
                unreadCounter.className = unreadCounter.className.replace("blocked-color", "").replace("blinking", "");
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
    if (chat.unreadCount == 0 && chat.pendingSeenCount == 0)
    {
        return;
    }

    var currentChat = getCurrentChat();
    var messageID = chat.id + chat.lastReceivedKey.id;

    if (currentChat.id.user == chat.id.user)
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
                formattedName: chat.contact.name
            };
            document.dispatchEvent(new CustomEvent('onMarkAsReadClick', { detail: JSON.stringify(data) }));
        };

        warningMessage.messageID = messageID;

        //
        // Put that warning in the chat panel, under the unread counter or at the bottom
        //

        var innerChatPanel = document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0];
        var unreadMarker = getUnreadMarkerElement(innerChatPanel);
        if (unreadMarker != null)
            unreadMarker.parentNode.insertBefore(warningMessage, unreadMarker.nextSibling);
        else
        {
            warningMessage.setAttribute('class', 'incognito-message');
            innerChatPanel.appendChild(warningMessage);
        }
    }
    else
    {
        console.warn("WAIncognito: Could not mark chat " + chat.id + " as blocked.");
    }

    //
    // turn the unread counter of the chat to red
    //

    var chatUnreadRead = chat.unreadCount;
    
    function markUnreadCounter()
    {
        var blockedChatElem = findChatEntryElementForJID(chat.id);
        chat.pendingSeenCount = 0;

        if (blockedChatElem != null)
        {
            var unreadCounter = blockedChatElem.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);
            if (unreadCounter && !unreadCounter.className.includes("blocked-color"))
                unreadCounter.classList.add("blocked-color");
        }
    }

    markUnreadCounter();
    setTimeout(markUnreadCounter, 200); // for multi-device pendingSeenCount
    

    // if it didn't exist previously, animate it in
    if (blockedChats[chat.id] == undefined || warningWasEmpty)
        Velocity(warningMessage, { scaleY: [1, 0], opacity: [1, 0] }, { defaultDuration: 400, easing: [.1, .82, .25, 1] });

    if (warningMessage)
        warningMessage.firstChild.textContent = "Read receipts were blocked.";
}

function setGlobalColorVaraibleString(variable, colorString)
{
    // TODO: I must think of a way to auto detect the selector, or set the global color in a better way
    //       it it currently very hacky

    var selector2 = ".xj6uduu.xj6uduu, .xj6uduu.xj6uduu:root";
    var selector3 = ".x8mwjyx.x8mwjyx, .x8mwjyx.x8mwjyx:root";
    var selector4 = ".x1h89ln0.x1h89ln0, .x1h89ln0.x1h89ln0:root";
    var selector5 = ".x9ux0ua.x9ux0ua, .x9ux0ua.x9ux0ua:root";
    
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

    var elements1 = parentElement.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS)
    var elements2 = parentElement.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS_2);
    var elements3 = parentElement.getElementsByClassName(UIClassNames.UNREAD_MARKER_CLASS_3);

    if (elements1.length > 0) return elements1[0];
    if (elements2.length > 0) return elements2[0];
    if (elements3.length > 0) return elements3[0];

    return null;
}

setTimeout(function() {
    if (!window.onerror) return;

    // WhatsApp hooks window.onerror.
    // This makes extension-related errors not printed out,
    // so make a hook-on-hook to print those first
    var originalOnError = window.onerror;
    window.onerror = function(message, source, lineno, colno, error)
    {
        console.error(error);
        originalOnError.call(window, message, source, lineno, colno, error);
    }
}, 1000);
