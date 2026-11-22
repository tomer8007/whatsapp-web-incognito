// ---------------------
// UI Event handlers
// ---------------------

window.WAIncognitoOptions = window.WAIncognitoOptions || defaultOptions();

document.addEventListener('onMainUIReady', function (e)
{
    setTimeout(exposeWhatsAppAPI, 100);
});

// the isolated world (ui.js) asks for the page-world half of the diagnostics
document.addEventListener('waIncognitoDiagnosticsRequest', function (e)
{
    var data = JSON.parse(e.detail);
    var results = [];
    try { results = Diagnostics.run(); } catch (exception) { console.error(exception); }
    document.dispatchEvent(new CustomEvent('waIncognitoDiagnosticsResult', { detail: JSON.stringify({messageID: data.messageID, results: results}) }));
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

    // the full options object (some updates only carry the changed keys, so merge)
    window.WAIncognitoOptions = Object.assign(window.WAIncognitoOptions || defaultOptions(), options);

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
    if (!chat) 
    {
        console.warn("WAIncognito: Did not find chat for JID " + blockedJid);
        return;
    }

    if (readConfirmationsHookEnabled && safetyDelay > 0 && chatMatchesJid(chat, blockedJid))
    {
        markChatAsPendingReciptsSending(chat);
    }
    else if ((readConfirmationsHookEnabled || NodeHandler.isBlockedForContact(blockedJid, "readReceipts", false)) && chatMatchesJid(chat, blockedJid))
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
        var jid = getJidOfChat(chat);
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
    var chatContainer = {chat: chat};

    // add an exception and remove it after a short time at any case
    exceptionsList.push(normalizeJID(data.jid));
    setTimeout(function() { exceptionsList = exceptionsList.filter(i => i !== data.jid); }, 2000);
    
    Promise.resolve().then(function() { return WhatsAppAPI.Seen.sendSeen(chatContainer); }).then(result =>
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

    if (chat) chat.unreadCount -= data.unreadCount;

    // animate out the incognito message
    var warningMessage = document.getElementsByClassName("incognito-message").length > 0 ? document.getElementsByClassName("incognito-message")[0] : null;
    if (warningMessage != null && String(warningMessage.messageID || "").startsWith(data.jid))
    {
        animateBarOutAndRemove(warningMessage, 300);
    }

    //var node = ["action",{"type":"set","epoch":"30"},[["read",{"jid":data.jid,"index":data.index,"owner":"false","count":data.unreadCount.toString()},null]]];
    //WACrypto.sendNode(node);
});

// A scheduled blue tick is due (core/receipt_scheduler.js, isolated world). Uses the newest state of the chat.
document.addEventListener("sendReadConfirmationForJid", async function(e)
{
    var data = JSON.parse(e.detail);
    var chat = null;
    for (var attempt = 0; attempt < 5 && !chat; attempt++)
    {
        chat = await getChatByJID(data.jid);
        if (!chat) await new Promise(function(resolve) { setTimeout(resolve, 2000); }); // right after startup the chats may not be loaded yet
    }
    if (!chat || !chat.unreadCount || !chat.lastReceivedKey) return;

    var payload = { jid: getJidOfChat(chat), index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
    document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(payload) }));
});

document.addEventListener("getDeletedMessageByID", async function(e) 
{
    var data = JSON.parse(e.detail);
    var msgID = data.messageID;

    // the vault (core/vault.js) holds the archive once it is set up
    if (await isVaultSetUp())
    {
        try
        {
            if (await Vault.has(msgID))
            {
                var reply = Vault.isUnlocked() ? {messageData: await Vault.get(msgID), messageID: msgID} : {locked: true, messageID: msgID};
                document.dispatchEvent(new CustomEvent("onDeletedMessageReceived", {detail: JSON.stringify(reply)}));
                return;
            }
        }
        catch (exception)
        {
            console.warn("WAIncognito: vault lookup failed");
            console.warn(exception);
        }
    }

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

// The status viewer asks whether the status on screen was deleted by its sender and is in the archive
document.addEventListener("waIncognitoStatusCheck", async function(e)
{
    var data = JSON.parse(e.detail);
    var reply = { messageID: data.messageID, archived: false };
    try
    {
        var viewer = document.querySelector("[data-animate-status-viewer]");
        var fiberKey = viewer ? Object.keys(viewer).find(function(key) { return key.startsWith("__reactFiber$"); }) : null;
        var statusId = fiberKey ? findStatusMessageIdInFiber(viewer[fiberKey]) : null;
        if (statusId)
        {
            statusViewerIdResolutions++;
            reply.archived = await isMessageArchived(statusId);
        }
    }
    catch (exception)
    {
        console.warn("WAIncognito: status check failed");
    }
    document.dispatchEvent(new CustomEvent("waIncognitoStatusCheckResult", { detail: JSON.stringify(reply) }));
});

// Disappearing messages saved for a chat (core/ephemeral_keeper.js): the list, and the media of one of them
document.addEventListener("getEphemeralForChat", async function(e)
{
    var data = JSON.parse(e.detail);
    var reply = { messageID: data.messageID, items: [], locked: false };
    try
    {
        var result = await loadEphemeralForChats(data.chatJids || []);
        reply.locked = result.locked;
        reply.items = summarizeEphemeralRecords(result.records);
    }
    catch (exception)
    {
        console.warn("WAIncognito: could not load the saved disappearing messages");
    }
    document.dispatchEvent(new CustomEvent("onEphemeralForChatReceived", { detail: JSON.stringify(reply) }));
});

document.addEventListener("downloadEphemeralMedia", async function(e)
{
    var data = JSON.parse(e.detail);
    var reply = { messageID: data.messageID, ok: false, error: null };
    try
    {
        var record = await loadEphemeralRecord(data.id);
        if (!record || !record.mediaMeta) throw new Error("no-media");
        var meta = record.mediaMeta;
        var decrypted = await WhatsAppAPI.downloadManager.downloadAndMaybeDecrypt({ directPath: meta.directPath, encFilehash: meta.fileEncSha256,
            filehash: meta.fileSha256, mediaKey: meta.mediaKey, type: meta.type, signal: (new AbortController).signal });
        reply.b64 = arrayBufferToBase64(decrypted);
        reply.mimetype = meta.mimetype;
        reply.ok = true;
    }
    catch (exception)
    {
        reply.error = "media-unavailable"; // for example expired on the server
    }
    document.dispatchEvent(new CustomEvent("onEphemeralMediaReceived", { detail: JSON.stringify(reply) }));
});

// A scheduled message is due (core/send_scheduler.js, isolated world)
document.addEventListener("waIncognitoSendText", async function(e)
{
    var data = JSON.parse(e.detail);
    var result = await sendTextToChat(data.jid, data.text);
    document.dispatchEvent(new CustomEvent("onSendTextResult", { detail: JSON.stringify({ id: data.id, messageID: data.id, ok: result.ok, error: result.error || null }) }));
});

// The original versions of an edited message (core/edit_tracker.js), asked for by the "Original" button
document.addEventListener("getEditHistory", async function(e)
{
    var data = JSON.parse(e.detail);
    var reply = { messageID: data.messageID, edits: [], locked: false };
    try
    {
        var history = await loadEditHistory(data.messageID);
        reply.edits = history.edits.map(function(edit) { return { original: edit.original, newText: edit.newText, ts: edit.ts, originalTs: edit.originalTs }; });
        reply.locked = history.locked;
    }
    catch (exception)
    {
        console.warn("WAIncognito: could not load the edit history");
    }
    document.dispatchEvent(new CustomEvent("onEditHistoryReceived", { detail: JSON.stringify(reply) }));
});

// Vault commands from the "Vault…" menu (isolated world). The passphrase only travels through this event.
document.addEventListener("waIncognitoVaultCommand", async function(e)
{
    var data = JSON.parse(e.detail);
    var reply = {messageID: data.messageID, ok: false, error: null};
    try
    {
        if (typeof Vault == "undefined") throw new Error("vault-not-loaded");
        if (data.cmd == "setup")
        {
            await Vault.setup(data.passphrase);
            reply.migrated = await Vault.migrateFromPlaintextDB();
            reply.ok = true;
        }
        else if (data.cmd == "unlock")
        {
            reply.ok = await Vault.unlock(data.passphrase);
            if (!reply.ok) reply.error = "wrong-passphrase";
        }
        else if (data.cmd == "lock")
        {
            Vault.lock();
            reply.ok = true;
        }
        else if (data.cmd == "status")
        {
            reply.ok = true;
        }

        var isSetUp = await Vault.isSetUp();
        var stats = isSetUp ? await Vault.stats() : {count: 0, bytes: 0};
        reply.status = {isSetUp: isSetUp, isUnlocked: Vault.isUnlocked(), count: stats.count, bytes: stats.bytes};
    }
    catch (exception)
    {
        reply.ok = false;
        reply.error = String(exception && exception.message ? exception.message : exception);
    }
    document.dispatchEvent(new CustomEvent("waIncognitoVaultResult", {detail: JSON.stringify(reply)}));
});

document.addEventListener("getDeviceTypeForMessage", async function(e)
{
    var data = JSON.parse(e.detail);
    var msgID = data.messageID;
    var deviceType = null;

    if (deviceTypesPerMessage[msgID] != undefined && NodeHandler.contactToggle(data.chatJid, "showDeviceTypes", showDeviceTypesEnabled))
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

    var messageID = getJidOfChat(chat) + chat.lastReceivedKey.id;
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
        warningMessage.textContent = t("receipt.sending", { n: seconds });
        warningMessage.messageID = messageID;

        var cancelButton = document.createElement('div');
        cancelButton.setAttribute('class', 'incognito-cancel-button');
        cancelButton.textContent = t("common.cancel");
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
                warningMessage.firstChild.textContent = t("receipt.sending", { n: seconds });
                blinkingChats[chat.id] = { timerID: id, time: seconds, chat: chat };
            }
            else
            {
                // time's up, sending receipt
                clearInterval(id);
                var data = { jid: getJidOfChat(chat), index: chat.lastReceivedKey.id, fromMe: chat.lastReceivedKey.fromMe, unreadCount: chat.unreadCount };
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
    var messageID = getJidOfChat(chat) + chat.lastReceivedKey.id;

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
            warningMessage.textContent = t("receipt.blocked");

            var sendButton = document.createElement('div');
            sendButton.setAttribute('class', 'incognito-send-button');
            sendButton.textContent = t("receipt.markRead");
            warningMessage.appendChild(sendButton);

            // "Send later…" (receipt.later): inserted BEFORE the send button, because the send button must stay the last child
            var scheduleButton = document.createElement('div');
            scheduleButton.setAttribute('class', 'incognito-send-button incognito-schedule-button');
            scheduleButton.textContent = t("receipt.later");
            warningMessage.insertBefore(scheduleButton, sendButton);
        }
        else
        {
            // we already have a warning message, remove it first
            warningMessage.remove();
        }

        var scheduleReceiptButton = warningMessage.querySelector(".incognito-schedule-button");
        if (scheduleReceiptButton)
        {
            scheduleReceiptButton.onclick = function ()
            {
                document.dispatchEvent(new CustomEvent('onScheduleReceiptClick', { detail: JSON.stringify({ context: buildChatMenuContext(chat) }) }));
            };
        }

        var sendButton = warningMessage.lastChild;
        sendButton.setAttribute('class', 'incognito-send-button');
        sendButton.textContent = t("receipt.markRead");
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
    if (blockedChats[chat.id] == undefined || warningWasEmpty)
        animateBarIn(warningMessage);

    if (warningMessage)
        warningMessage.firstChild.textContent = t("receipt.blocked");
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
