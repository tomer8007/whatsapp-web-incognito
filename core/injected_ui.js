// ---------------------
// UI Event handlers
// ---------------------

const EXTENDED_DELETE_WINDOW = 10 * 365 * 24 * 60 * 60;
let extendDeleteForEveryone = false;
let restoreSenderRevokeCheck;
let keepEditedMessages = false;
let editMessageStore;

function updateEditHistoryListener()
{
    if (!keepEditedMessages)
    {
        editMessageStore?.off("change:body", recordMessageBodyEdit);
        editMessageStore?.off("change:caption", recordMessageCaptionEdit);
        editMessageStore = undefined;
        return;
    }
    if (editMessageStore || typeof window.require !== "function") return;
    try
    {
        const store = window.require("WAWebCollections").Msg;
        if (typeof store?.on !== "function" || typeof store.off !== "function") return;
        store.on("change:body", recordMessageBodyEdit);
        store.on("change:caption", recordMessageCaptionEdit);
        editMessageStore = store;
    }
    catch (error)
    {
        console.warn("WAIncognito: Edit history listener is unavailable", error);
    }
}

function serializedEditMessageId(key)
{
    const id = typeof key === "string" ? key : key?._serialized ?? key?.$1;
    return typeof id === "string" && id.length > 0 && id.length <= 512 ? id : undefined;
}

function recordMessageBodyEdit(message, next, previous)
{
    if (message.type === "chat") recordMessageEdit(message, "body", next, previous);
}

function recordMessageCaptionEdit(message, next, previous)
{
    recordMessageEdit(message, "caption", next ?? "", previous ?? "");
}

function recordMessageEdit(message, field, next, previous)
{
    if (!keepEditedMessages || message.type === "revoked" || message.type === "ciphertext") return;
    const id = serializedEditMessageId(message.id);
    if (!id || typeof previous !== "string" || typeof next !== "string" || previous === next) return;
    const keyAtChange = message.latestEditMsgKey;
    const timestampAtChange = message.latestEditSenderTimestampMs;

    // The model can update the edit metadata after emitting the text change.
    queueMicrotask(async () =>
    {
        if (!keepEditedMessages || message.type === "revoked") return;
        const isCurrentChange = (message[field] ?? "") === next;
        if (!keyAtChange && !timestampAtChange && !isCurrentChange) return;
        const key = isCurrentChange ? message.latestEditMsgKey ?? keyAtChange : keyAtChange;
        const editId = serializedEditMessageId(key) ?? serializedEditMessageId(key?.id);
        const timestamp = isCurrentChange ? message.latestEditSenderTimestampMs || timestampAtChange : timestampAtChange;
        if (typeof editId !== "string" && !(Number.isFinite(timestamp) && timestamp > 0)) return;
        try
        {
            const db = await openMessageArchive("waIncognitoEditedMsgs");
            if (!keepEditedMessages) return;
            const transaction = db.transaction("msgs", "readwrite");
            const store = transaction.objectStore("msgs");
            const request = store.get(id);
            transaction.onabort = () => console.error("WAIncognito: Could not save edit history", transaction.error);
            request.onsuccess = () =>
            {
                if (!keepEditedMessages) return;
                const edits = request.result?.edits ?? [];
                if (edits.some(edit => editId ? edit.editId === editId
                    : edit.timestamp === timestamp && edit.previous === previous && edit.next === next))
                    return;

                edits.push({ editId, timestamp, previous, next });
                if (edits.every(edit => Number.isFinite(edit.timestamp)))
                    edits.sort((a, b) => a.timestamp - b.timestamp);
                store.put({ id, edits });
                transaction.oncomplete = () => document.dispatchEvent(new CustomEvent("onEditHistorySaved", { detail: id }));
            };
        }
        catch (error)
        {
            console.error("WAIncognito: Could not open edit history", error);
        }
    });
}

document.addEventListener("onEditHistoryPreference", function (event)
{
    keepEditedMessages = event.detail === true;
    updateEditHistoryListener();
});
document.dispatchEvent(new CustomEvent("onEditHistoryPreferenceRequested"));

document.addEventListener("getEditHistoryMessageId", function (event)
{
    const node = event.target;
    if (!node.matches?.('[data-testid^="conv-msg"]')) return;
    const fiberKey = Object.keys(node).find(key => key.startsWith("__reactFiber$"));
    let fiber = node[fiberKey];
    // shortcut: resolve nearby message props, use a stable bubble ID when WhatsApp exposes one.
    for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return)
    {
        const props = fiber.memoizedProps;
        const message = props?.msg ?? props?.message;
        const id = serializedEditMessageId(message?.id ?? message?.__x_id) ?? serializedEditMessageId(props?.msgKey);
        if (!id) continue;
        document.dispatchEvent(new CustomEvent("onEditHistoryMessageId", { detail: id }));
        return;
    }
});

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
    updateEditHistoryListener();
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


document.addEventListener('onOptionsUpdate', function (e)
{
    // update enforcing globals
    // TODO: move outside injected_ui.js
    var options = JSON.parse(e.detail);
    if ('readConfirmationsHook' in options) readConfirmationsHookEnabled = options.readConfirmationsHook;
    if ('onlineUpdatesHook' in options) onlineUpdatesHookEnabled = options.onlineUpdatesHook;
    if ('typingUpdatesHook' in options) typingUpdatesHookEnabled = options.typingUpdatesHook;
    if ('saveDeletedMsgs' in options) saveDeletedMsgsHookEnabled = options.saveDeletedMsgs;
    if (typeof options.keepEditedMessages === "boolean")
    {
        keepEditedMessages = options.keepEditedMessages;
        updateEditHistoryListener();
    }
    if ('showDeviceTypes' in options) showDeviceTypesEnabled = options.showDeviceTypes;
    if ('autoReceiptOnReplay' in options) autoReceiptOnReplay = options.autoReceiptOnReplay;
    if ('allowStatusDownload' in options) allowStatusDownload = options.allowStatusDownload;
    if (typeof options.extendDeleteForEveryone === "boolean")
    {
        extendDeleteForEveryone = options.extendDeleteForEveryone;
        updateExtendedDelete();
    }

    // update graphics
    if (readConfirmationsHookEnabled)
    {
        // set unread counters to transperent
        setGlobalColorVaraibleString("--WDS-persistent-always-branded", 'rgba(9, 210, 97, 0.3)');
    }
    else
    {
        // set unread counters to solid
        setGlobalColorVaraibleString("--WDS-persistent-always-branded", 'rgba(9, 210, 97, 1)');
        var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ?
            document.getElementsByClassName("incognito-message")[0] : null;
        if (warningMessage != null && !getContactPrivacy(warningMessage.dataset?.jid)?.readConfirmationsHook)
        {
            Velocity(warningMessage, { scaleY: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
            setTimeout(function () { warningMessage.remove(); }, 300);
        }
    }

    var unreadCounters = document.getElementsByClassName(UIClassNames.UNREAD_COUNTER_CLASS);
    for (var i = 0; i < unreadCounters.length; i++)
    {
        if (!getContactPrivacy(unreadCounters[i].dataset?.incognitoBlockedJid)?.readConfirmationsHook)
            unreadCounters[i].classList.remove("blocked-color");
    }
});

document.addEventListener("onContactPrivacyUpdate", function (event)
{
    let rules;
    try { rules = JSON.parse(event.detail); }
    catch { return; }
    if (!Array.isArray(rules)) return;
    contactPrivacyByJid.clear();
    for (const rule of rules)
    {
        if (!Array.isArray(rule?.jids) || typeof rule.readConfirmationsHook !== "boolean"
            || typeof rule.typingUpdatesHook !== "boolean") continue;
        for (const value of rule.jids)
        {
            const jid = contactPrivacyJid(value);
            if (jid) contactPrivacyByJid.set(jid, rule);
        }
    }
    const warning = document.getElementsByClassName("incognito-message")[0];
    if (warning?.dataset?.jid)
    {
        if (!blocksReadReceipts(warning.dataset.jid)) warning.remove();
        else warning.lastChild.hidden = getContactPrivacy(warning.dataset.jid)?.readConfirmationsHook === true;
    }
    for (const counter of Array.from(document.getElementsByClassName("blocked-color")))
        if (counter.dataset.incognitoBlockedJid && !blocksReadReceipts(counter.dataset.incognitoBlockedJid))
            counter.classList.remove("blocked-color");
});

document.addEventListener("getActiveContactPrivacyTarget", function (event)
{
    const row = event.target;
    const fiberKey = Object.keys(row).find(key => key.startsWith("__reactFiber$"));
    let chat;
    // shortcut: use the mute row's React props, fall back to the active chat if the drawer has no model.
    for (let fiber = row[fiberKey], depth = 0; fiber && depth < 12; fiber = fiber.return, depth++)
    {
        const props = fiber.memoizedProps;
        chat = props?.chat ?? props?.contact;
        if (chat?.id) break;
    }
    if (!chat?.id) chat = getCurrentChat();
    if (!chat?.id || chat.isGroup) return;
    const jids = contactPrivacyJids(chat);
    if (!jids.length) return;
    const name = chat.contact?.name || chat.name || jids[0];
    document.dispatchEvent(new CustomEvent("onActiveContactPrivacyTarget", { detail: JSON.stringify({ jids, name }) }));
});

document.addEventListener('onReadConfirmationBlocked', async function (e)
{
    if (typeof e.detail !== "string") return;
    var blockedJid = normalizeJID(e.detail);
    var blockedUser = blockedJid.substring(0, blockedJid.indexOf("@"));

    var chat = await getChatByJID(blockedJid);
    if (!chat)
    {
        const activeChat = getCurrentChat();
        if (activeChat && contactPrivacyJids(activeChat).includes(blockedJid)) chat = activeChat;
    }
    if (!chat) 
    {
        console.warn("WAIncognito: Did not find chat for JID " + blockedJid);
        return;
    }
    if (!blocksReadReceipts(blockedJid)) return;

    if (chat.id.user == blockedUser || getJidOfChat(chat) === blockedJid || contactPrivacyJids(chat).includes(blockedJid))
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

document.addEventListener('onPaneChatOpened', function ()
{
    const chat = getCurrentChat();
    if (chat && isChatBlocked(getJidOfChat(chat)))
    {
        setTimeout(function ()
        {
            if (blocksReadReceipts(getJidOfChat(chat)) && getCurrentChat() === chat && isChatBlocked(getJidOfChat(chat)))
                markChatAsBlocked(chat);
        }, 200);
    }
});

const chatReadMenuClass = "incognito-chat-read-menu-item";
const chatMenuItemSelector = 'button[role="menuitem"]';
const chatReadIcon = document.currentScript?.src
    ? new URL("../images/incognito_gray_24_hollow_9.svg", document.currentScript.src).href : "";

document.addEventListener("onDropdownOpened", async function (event)
{
    const menu = event.target;
    if (!globalThis.readConfirmationsHookEnabled || !menu.matches?.('[role="menu"]') ||
        menu.querySelector("." + chatReadMenuClass)) return;

    for (const row of menu.querySelectorAll(chatMenuItemSelector))
    {
        if (row.closest('[role="menu"]') !== menu) continue;
        const fiberKey = Object.keys(row).find(key => key.startsWith("__reactFiber$"));
        for (let fiber = row[fiberKey]; fiber && fiber.stateNode !== menu; fiber = fiber.return)
        {
            if (fiber.key !== "mark_unread") continue;
            const props = fiber.memoizedProps;
            const chatId = props?.chatId?._serialized ?? props?.chatId?.toString();
            const chat = props?.chat ?? (typeof chatId === "string" && chatId.includes("@") ? await getChatByJID(chatId) : null);
            const nativeLabel = row.getAttribute("aria-label")?.trim() || row.textContent.trim();
            // shortcut: recognize English and Spanish at zero unread, use a native action marker when WhatsApp exposes one.
            const canMarkAsRead = chat?.unreadCount > 0 || /^(mark as read|marcar como leído)$/i.test(nativeLabel);
            if (!chat?.id || getChatContactPrivacy(chat)?.readConfirmationsHook ||
                !canMarkAsRead || !row.isConnected ||
                row.closest('[role="menu"]') !== menu || menu.querySelector("." + chatReadMenuClass)) return;

            const button = createChatReadMenuItem(row);
            button.addEventListener("click", click =>
            {
                click.stopPropagation();
                row.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                requestMarkAsRead(chat);
            });
            row.after(button);
            menu.addEventListener("keydown", navigateChatReadMenuItem, true);
            return;
        }
    }
});

function createChatReadMenuItem(row)
{
    const button = row.cloneNode(true);
    const label = "Mark as read · Incognito";
    const nativeLabel = row.getAttribute("aria-label")?.trim();
    const nativeIcon = button.querySelector("svg");
    const text = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let labelNode = text.nextNode();
    while (labelNode && labelNode.textContent.trim() !== nativeLabel) labelNode = text.nextNode();

    const icon = document.createElement("span");
    icon.className = "incognito-chat-read-menu-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.style.maskImage = 'url("' + chatReadIcon + '")';
    icon.style.width = (Number(nativeIcon?.getAttribute("width")) || 20) + "px";
    icon.style.height = (Number(nativeIcon?.getAttribute("height")) || 20) + "px";

    button.classList.add(chatReadMenuClass);
    button.tabIndex = -1;
    button.removeAttribute("aria-describedby");
    button.setAttribute("aria-label", label);
    if (nativeIcon && labelNode)
    {
        nativeIcon.replaceWith(icon);
        labelNode.textContent = label;
    }
    else
    {
        button.classList.add("incognito-chat-read-menu-fallback");
        button.replaceChildren(icon, label);
    }
    for (const element of [button, ...button.querySelectorAll("[id], [data-testid], [data-icon]")])
    {
        element.removeAttribute("id");
        element.removeAttribute("data-testid");
        element.removeAttribute("data-icon");
    }
    return button;
}

function navigateChatReadMenuItem(event)
{
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const menu = event.currentTarget;
    const items = Array.from(menu.querySelectorAll(chatMenuItemSelector + ":not(:disabled)"))
        .filter(item => item.closest('[role="menu"]') === menu && item.getAttribute("aria-disabled") !== "true");
    const current = items.indexOf(event.target);
    if (current === -1) return;
    const next = items[current + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next || !(event.target.classList.contains(chatReadMenuClass) || next.classList.contains(chatReadMenuClass))) return;
    event.preventDefault();
    event.stopPropagation();
    next.focus();
}

function requestMarkAsRead(chat)
{
    if (getChatContactPrivacy(chat)?.readConfirmationsHook) return;
    const data = {
        jid: chat.id.toString(),
        unreadCount: chat.unreadCount,
        formattedName: chat.contact?.name || chat.name || "This contact"
    };
    document.dispatchEvent(new CustomEvent("onMarkAsReadClick", { detail: JSON.stringify(data) }));
}

document.addEventListener('sendReadConfirmation', async function (e)
{
    const data = JSON.parse(e.detail);
    if (typeof data?.jid !== "string" || !data.jid.includes("@")) return;
    const jid = normalizeJID(data.jid);
    if (getContactPrivacy(jid)?.readConfirmationsHook) return;
    const chat = await getChatByJID(jid);
    if (!chat)
    {
        console.warn("WAIncognito: Could not find the chat for Mark as read");
        return;
    }
    if (getChatContactPrivacy(chat)?.readConfirmationsHook) return;
    const chatJid = getJidOfChat(chat);

    const aliases = blockedChats.get(jid) ?? blockedChats.get(chatJid);
    const receiptJids = new Set([jid, chatJid, normalizeJID(chat.id.toString()), ...(aliases ?? [])]);
    const exception = { expiresAt: Date.now() + 2000 };
    function expireException()
    {
        for (const receiptJid of receiptJids)
            if (readReceiptExceptions.get(receiptJid) === exception) readReceiptExceptions.delete(receiptJid);
    }
    const expiryTimer = setTimeout(expireException, 2000);
    for (const receiptJid of receiptJids) readReceiptExceptions.set(receiptJid, exception);
    const unreadCount = chat.unreadCount;
    try
    {
        const marked = await window.WhatsAppAPI.Seen.sendSeen({ chat, afterAvailable: false });
        if (marked === false || (unreadCount > 0 && chat.unreadCount >= unreadCount))
            throw new Error("WhatsApp did not update the unread count");
    }
    catch (error)
    {
        clearTimeout(expiryTimer);
        expireException();
        console.warn("WAIncognito: Could not send read receipt", error);
        return;
    }

    if (aliases)
        for (const alias of aliases)
            if (blockedChats.get(alias) === aliases) blockedChats.delete(alias);
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

function markChatAsBlocked(chat)
{
    if (chat.unreadCount == 0 && chat.pendingSeenCount == 0)
    {
        return;
    }

    var currentChat = getCurrentChat();
    var messageID = getJidOfChat(chat) + (chat.lastReceivedKey?.id ?? "");

    if (currentChat?.id && getJidOfChat(currentChat) === getJidOfChat(chat))
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
        sendButton.onclick = () => requestMarkAsRead(chat);
        sendButton.hidden = getChatContactPrivacy(chat)?.readConfirmationsHook === true;

        warningMessage.messageID = messageID;
        warningMessage.dataset.jid = getJidOfChat(chat);

        //
        // Put that warning in the chat panel, under the unread counter or at the bottom
        //

        var innerChatPanel = document.querySelector('[data-testid="conversation-panel-messages"]')
            || document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0]
            || document.getElementById("main");
        if (!innerChatPanel) return;
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
            if (unreadCounter)
            {
                unreadCounter.dataset.incognitoBlockedJid = getJidOfChat(chat);
                unreadCounter.classList.add("blocked-color");
            }
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
