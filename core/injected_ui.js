// ---------------------
// UI Event handlers
// ---------------------

const EXTENDED_DELETE_WINDOW = 72 * 60 * 60;
let extendDeleteForEveryone = false;
let restoreSenderRevokeCheck;

function updateExtendedDelete()
{
    if (!extendDeleteForEveryone)
    {
        restoreSenderRevokeCheck?.();
        restoreSenderRevokeCheck = undefined;
        return;
    }
    if (restoreSenderRevokeCheck || typeof window.require !== "function") return;

    try
    {
        const capability = window.require("WAWebMsgActionCapability");
        const limits = window.require("WAWebRevokeMsgConstants");
        const canSenderRevoke = capability.canSenderRevokeMsg;
        const source = String(canSenderRevoke);
        if (!source.includes(".REVOKE_WINDOW") || !source.includes("WAWebRevokeMsgConstants")
            || !Object.getOwnPropertyDescriptor(limits, "REVOKE_WINDOW")?.writable)
            return;

        function extendedSenderRevokeCheck(...args)
        {
            const nativeWindow = limits.REVOKE_WINDOW;
            if (!extendDeleteForEveryone || !Number.isFinite(nativeWindow) || nativeWindow >= EXTENDED_DELETE_WINDOW)
                return canSenderRevoke.apply(this, args);

            // Change the sender check's time limit for this call only.
            limits.REVOKE_WINDOW = EXTENDED_DELETE_WINDOW;
            try
            {
                return canSenderRevoke.apply(this, args);
            }
            finally
            {
                limits.REVOKE_WINDOW = nativeWindow;
            }
        }

        capability.canSenderRevokeMsg = extendedSenderRevokeCheck;
        if (capability.canSenderRevokeMsg !== extendedSenderRevokeCheck) return;
        restoreSenderRevokeCheck = () =>
        {
            if (capability.canSenderRevokeMsg === extendedSenderRevokeCheck)
                capability.canSenderRevokeMsg = canSenderRevoke;
        };
    }
    catch (error)
    {
        console.warn("WAIncognito: Extended Delete for everyone is unavailable", error);
    }
}

document.addEventListener("onExtendedDeletePreference", function (event)
{
    extendDeleteForEveryone = event.detail === true;
    updateExtendedDelete();
});
document.dispatchEvent(new CustomEvent("onExtendedDeletePreferenceRequested"));

document.addEventListener('onMainUIReady', function (e)
{
    updateExtendedDelete();
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
    var drop = document.querySelector(".drop.drop-theme-incognito");
    if (!drop) return;
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
    var drop = document.querySelector(".drop.drop-theme-incognito");
    if (!drop) return;
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
    if (typeof options.extendDeleteForEveryone === "boolean")
    {
        extendDeleteForEveryone = options.extendDeleteForEveryone;
        updateExtendedDelete();
    }

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
        if (typeof blinkingChats !== "undefined")
            for (const jid of blinkingChats.keys()) stopReceiptCountdown(jid);

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
            setTimeout(function () { warningMessage.remove(); }, 300);
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
    if (typeof e.detail !== "string") return;
    var blockedJid = normalizeJID(e.detail);
    var blockedUser = blockedJid.substring(0, blockedJid.indexOf("@"));

    var chat = await getChatByJID(blockedJid);
    if (!chat) 
    {
        console.warn("WAIncognito: Did not find chat for JID " + blockedJid);
        return;
    }
    if (!readConfirmationsHookEnabled) return;

    if (safetyDelay > 0 && chat.id.user == blockedUser)
    {
        markChatAsPendingReciptsSending(chat);
    }
    else if (chat.id.user == blockedUser || getJidOfChat(chat) === blockedJid)
    {
        markChatAsBlocked(chat);
    }
    else
    {
        console.warn("WAIncognito: Could not find chat for JID " + blockedJid);
        return;
    }

    const aliases = new Set([normalizeJID(chat.id.toString()), getJidOfChat(chat), blockedJid]);
    const previousAliases = blockedChats.get(getJidOfChat(chat));
    if (previousAliases)
        for (const alias of previousAliases) aliases.add(alias);
    for (const alias of aliases) blockedChats.set(alias, aliases);
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
        var jid = getJidOfChat(props.chat);
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
    const data = JSON.parse(e.detail);
    if (typeof data?.jid !== "string" || !data.jid.includes("@")) return;
    const jid = normalizeJID(data.jid);
    stopReceiptCountdown(jid);
    const chat = await getChatByJID(jid);
    if (!chat) return;
    const chatJid = getJidOfChat(chat);
    stopReceiptCountdown(chatJid);

    const receiptJids = new Set([jid, chatJid, normalizeJID(chat.id.toString())]);
    const exception = { expiresAt: Date.now() + 2000 };
    function expireException()
    {
        for (const receiptJid of receiptJids)
            if (readReceiptExceptions.get(receiptJid) === exception) readReceiptExceptions.delete(receiptJid);
    }
    const expiryTimer = setTimeout(expireException, 2000);
    for (const receiptJid of receiptJids) readReceiptExceptions.set(receiptJid, exception);
    const unreadCount = chat.unreadCount;
    const aliases = blockedChats.get(jid);
    try
    {
        await window.WhatsAppAPI.Seen.sendSeen({chat});
    }
    catch (error)
    {
        clearTimeout(expiryTimer);
        expireException();
        console.warn("WAIncognito: Could not send read receipt", error);
        const warning = document.getElementsByClassName("incognito-message")[0];
        if (warning?.messageID?.startsWith(chatJid) && warning.querySelector(".incognito-cancel-button"))
            markChatAsBlocked(chat);
        return;
    }

    if (aliases && blockedChats.get(jid) === aliases)
        for (const alias of aliases) blockedChats.delete(alias);
    if (chat.unreadCount === unreadCount)
        chat.unreadCount = Math.max(0, unreadCount - (data.unreadCount ?? 0));
    const warningMessage = document.getElementsByClassName("incognito-message")[0];
    if (warningMessage?.messageID?.startsWith(chatJid))
    {
        Velocity(warningMessage, { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
        setTimeout(function() {warningMessage.remove();}, 300);
    }

});

document.addEventListener("getDeviceTypeForMessage", function(e)
{
    var data = JSON.parse(e.detail);
    var msgID = data.messageID;
    var deviceType = typeof deviceTypesPerMessage !== "undefined" && showDeviceTypesEnabled
        ? deviceTypesPerMessage.get(msgID) ?? null
        : null;

    document.dispatchEvent(new CustomEvent("onDeviceTypeReceived", {detail: JSON.stringify({deviceType: deviceType, messageID: msgID})}));
});

const blockedStatusDeletions = new Set();

function recordBlockedStatusDeletion(id)
{
    if (blockedStatusDeletions.has(id)) return;
    blockedStatusDeletions.add(id);
    // shortcut: keep 1,000 revokes in the current tab, use an archive if reload persistence is needed.
    if (blockedStatusDeletions.size > 1000)
        blockedStatusDeletions.delete(blockedStatusDeletions.values().next().value);
    document.dispatchEvent(new CustomEvent("onStatusDeletionBlocked"));
}

function statusMessageId(key)
{
    if (typeof key === "string")
        return /^(?:true|false)_status@broadcast_(.+?)(?:_[^_]+@[^_]+)?$/.exec(key)?.[1];
    if (key?.remote?.toString() === "status@broadcast" && typeof key.id === "string")
        return key.id;
}

function statusMessageFromProps(props)
{
    return props?.msg ?? props?.message ?? props?.statusMessage ?? props?.currentMsg;
}

document.addEventListener("getStatusViewerInfo", function (event)
{
    const node = event.target;
    const viewer = node.closest?.('[data-animate-status-viewer], [data-testid="status-video"]');
    if (!viewer) return;

    let id = statusMessageId(node.closest("[data-id]")?.getAttribute("data-id"));
    let name;
    let timestamp;
    let mimeType;
    for (const element of node === viewer ? [node] : [node, viewer])
    {
        const fiberKey = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
        let fiber = element[fiberKey];
        // shortcut: check nearby React props, use a stable viewer API if WhatsApp exposes one.
        for (let depth = 0; fiber && depth < 16 && (!id || !name || !timestamp || !mimeType); depth++, fiber = fiber.return)
        {
            const props = fiber.memoizedProps;
            const message = statusMessageFromProps(props);
            const messageId = statusMessageId(message?.id ?? message?.__x_id);
            id ??= messageId ?? statusMessageId(props?.msgKey) ?? statusMessageId(props?.msgId);
            if (messageId && messageId === id)
            {
                const sentAt = message.t ?? message.__x_t;
                if (Number.isFinite(sentAt) && sentAt > 0) timestamp ??= sentAt;
                const format = message.mimetype ?? message.__x_mimetype ?? message.mediaData?.mimetype;
                if (typeof format === "string" && format) mimeType ??= format;
            }
            const contact = props?.contact ?? props?.status?.contact ?? props?.initialStatus?.contact;
            const displayName = contact?.formattedName ?? contact?.name ?? contact?.pushname;
            if (!name && typeof displayName === "string") name = displayName;
        }
    }

    if (!id && node === viewer && blockedStatusDeletions.size)
    {
        // shortcut: text statuses have no media element, inspect the viewer's first 200 fibers until it exposes the active ID.
        const fiberKey = Object.keys(viewer).find(key => key.startsWith("__reactFiber$"));
        const child = viewer[fiberKey]?.child;
        const pending = child ? [child] : [];
        for (let count = 0; pending.length && count < 200; count++)
        {
            const fiber = pending.pop();
            const props = fiber.memoizedProps;
            const message = statusMessageFromProps(props);
            const candidate = statusMessageId(message?.id ?? message?.__x_id) ?? statusMessageId(props?.msgKey) ?? statusMessageId(props?.msgId);
            if (candidate && id && candidate !== id)
            {
                id = undefined;
                break;
            }
            id ??= candidate;
            if (fiber.sibling) pending.push(fiber.sibling);
            if (fiber.child) pending.push(fiber.child);
        }
        if (pending.length) id = undefined;
    }

    document.dispatchEvent(new CustomEvent("onStatusViewerInfo", {
        detail: JSON.stringify({ name, timestamp, mimeType, deleted: Boolean(id && blockedStatusDeletions.has(id)) })
    }));
});

function stopReceiptCountdown(jid)
{
    const countdown = blinkingChats.get(jid);
    if (!countdown) return;
    clearInterval(countdown.timerID);
    blinkingChats.delete(jid);
    countdown.unreadCounter?.classList.remove("blinking");
    return countdown.time;
}

function markChatAsPendingReciptsSending(chat)
{
    if (chat.pendingSeenCount != 0) chat.pendingSeenCount = 0;

    if (chat.unreadCount == 0)
    {
        return;
    }

    var currentChat = getCurrentChat();
    if (currentChat?.id.user != chat.id.user)
    {
        return;
    }

    const jid = getJidOfChat(chat);
    var messageID = jid + chat.lastReceivedKey.id;
    var previousMessage = document.getElementsByClassName("incognito-message").length > 0 ? 
                            document.getElementsByClassName("incognito-message")[0] : null;
    var seconds = safetyDelay;

    var chatWindow = getCurrentChatPanel();

    if (chatWindow != null && chat.unreadCount > 0 && (previousMessage == null || previousMessage.messageID != messageID))
    {
        seconds = stopReceiptCountdown(jid) ?? seconds;

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
        previousMessage?.remove();
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

        const unreadCounter = findChatEntryElementForJID(chat.id)?.querySelector("html[dir] ." + UIClassNames.UNREAD_COUNTER_CLASS);

        function makeUnreadCounterBlink()
        {
            chat.pendingSeenCount = 0;
    
            if (blinkingChats.has(jid)) unreadCounter?.classList.add("blinking");
        }
    
        var id = setInterval(function ()
        {
            chat.pendingSeenCount = 0;

            seconds--;
            if (seconds > 0)
            {
                warningMessage.firstChild.textContent = "Sending read receipts in " + seconds + " seconds...";
                blinkingChats.get(jid).time = seconds;
            }
            else
            {
                // time's up, sending receipt
                stopReceiptCountdown(jid);
                var data = { jid, index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
                document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));

            }
        }, 1000);

        blinkingChats.set(jid, { timerID: id, time: seconds, unreadCounter });
        makeUnreadCounterBlink();
        setTimeout(makeUnreadCounterBlink, 200); // for multi-device pendingSeenCount

        cancelButton.onclick = function ()
        {
            stopReceiptCountdown(jid);
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
    var messageID = getJidOfChat(chat) + chat.lastReceivedKey.id;

    if (currentChat?.id.user == chat.id.user)
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
                name: chat.name, jid: getJidOfChat(chat), lastMessageIndex: chat.lastReceivedKey.id,
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
    if (warningMessage && (!isChatBlocked(getJidOfChat(chat)) || warningWasEmpty))
        Velocity(warningMessage, { scaleY: [1, 0], opacity: [1, 0] }, { defaultDuration: 400, easing: [.1, .82, .25, 1] });

    if (warningMessage)
        warningMessage.firstChild.textContent = "Read receipts were blocked.";
}

function setGlobalColorVaraibleString(variable, colorString)
{
    // TODO: I must think of a way to auto detect the selector, or set the global color in a better way
    //       it it currently very hacky
    // To get the new selector, look in e.g https://static.whatsapp.net/rsrc.php/v5/yK/l/0,cross/W3PYxWkG2-yfN1x-cay_sOU0sr-k7QgkZlwij8nbyzl0.css
    // search for --WDS-persistent-always-branded

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
