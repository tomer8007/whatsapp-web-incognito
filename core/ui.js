/*
This is a content script responsible for some UI.
*/


// Global variables
var mutationObserver = null;
var isInterceptionWorking = false;
var isUIClassesWorking = true;
var deletedMessagesDB = null;
var deletedMessageResponses = createResponseRouter(document, "onDeletedMessageReceived", 10000);
var deviceTypeResponses = createResponseRouter(document, "onDeviceTypeReceived", 10000);
var diagnosticsResponses = createResponseRouter(document, "waIncognitoDiagnosticsResult", 5000);

var vaultResponses = createResponseRouter(document, "waIncognitoVaultResult", 120000);

// Entries added to the context menu of a chat in the chat list. The page world (core/chat_menu_context.js) answers
// `onDropdownOpened` with the chat; run(context) gets {jids, primaryJid, name, isGroup}.
// Features append {id, label, run} below their own code.
var chatMenuEntries = [];
var chatMenuEntriesShown = 0;
var ephemeralResponses = createResponseRouter(document, "onEphemeralForChatReceived", 10000);
var ephemeralMediaResponses = createResponseRouter(document, "onEphemeralMediaReceived", 60000);

var contactRulesCache = {};
var receiptScheduler = createReceiptScheduler({
    now: function() { return Date.now(); },
    setTimer: function(fn, ms) { return setTimeout(fn, ms); },
    clearTimer: function(handle) { clearTimeout(handle); },
    store: createChromeListStore("scheduledReceipts"),
    send: function(jid) { document.dispatchEvent(new CustomEvent("sendReadConfirmationForJid", { detail: JSON.stringify({ jid: jid }) })); },
});
var receiptSchedulerRestored = false;
var sendTextResponses = createResponseRouter(document, "onSendTextResult", 35000);
var sendScheduler = createSendScheduler({
    now: function() { return Date.now(); },
    setTimer: function(fn, ms) { return setTimeout(fn, ms); },
    clearTimer: function(handle) { clearTimeout(handle); },
    store: createChromeListStore("scheduledMessages"),
    send: function(message) { return sendTextViaPageWorld(message); },
    onOverdue: function(items) { askAboutOverdueMessages(items); },
});

chatMenuEntries.push({ id: "schedule-message", labelKey: "menu.scheduleMessage", run: function(context) { openScheduleMessageModal(context); } });

chatMenuEntries.push({ id: "schedule-receipt", labelKey: "menu.scheduleReceipt", run: function(context) { openScheduleReceiptModal(context); } });

chatMenuEntries.push({ id: "contact-privacy", labelKey: "menu.contactPrivacy", run: function(context) { openContactPrivacyModal(context); } });
chatMenuEntries.push({ id: "ephemeral", labelKey: "menu.ephemeral", run: function(context) { openEphemeralModal(context); } });
var editHistoryResponses = createResponseRouter(document, "onEditHistoryReceived", 10000);

registerUIDiagnostics();

if (chrome != undefined) 
{
	var browser = chrome;
}

initialize();

// The language option: set the active language, the deleted-message label and the text direction of our own UI
function applyLanguage(preference)
{
    setLanguage(preference);
    document.documentElement.style.setProperty("--incognito-deleted-label", JSON.stringify(t("deleted.label")));
    var toasts = document.getElementById("incognito-toasts");
    if (toasts) toasts.setAttribute("dir", isRtlLanguage() ? "rtl" : "ltr");
}

document.addEventListener("onOptionsUpdate", function(e)
{
    try
    {
        var update = JSON.parse(e.detail);
        if (update && "language" in update) applyLanguage(update.language);
    }
    catch (exception) {}
});

function initialize()
{
    applyLanguage("auto"); // until the saved language arrives
    // load saved settings
    safeSendMessage({ name: "getOptions" }, function (options)
    {
        document.dispatchEvent(new CustomEvent('onOptionsUpdate',
        {
            detail: JSON.stringify(options)
        }));

        // ratify it
        var optionsMessage = options;
        optionsMessage.name = "setOptions";
        safeSendMessage(optionsMessage);
    });

    loadAndPushContactRules();

    // initialize mutation observer
    var appElem = document.getElementsByTagName("body")[0];
    if (!appElem) return;
    mutationObserver = new MutationObserver(onMutationsObserved);

    mutationObserver.observe(appElem, { childList: true, subtree: true });
}

function onMutationsObserved(mutations)
{
    var found = false;
    for (var i = 0; i < mutations.length; i++)
    {
        var mutation = mutations[i];
        var mutationType = mutations[i].type;
        var addedNodes = mutations[i].addedNodes;
        var removedNodes = mutations[i].removedNodes;

        // Scan for added nodes
        for (var j = 0; j < addedNodes.length; j++)
        {
            var addedNode = addedNodes[j];
            if (addedNode.classList == undefined) continue;

            if (addedNode.getElementsByClassName("two").length > 0)
            {
                // main app was added, UI is ready
                addIconIfNeeded();
                setTimeout(function () { onMainUIReady(); }, 100);

                found = true;
                break;
            }
            else if (addedNode.nodeName.toLowerCase() == "div" && addedNode.classList.contains(UIClassNames.OUTER_DROPDOWN_CLASS))
            {
                // dropdown was opened
                setTimeout(function ()
                {
                    document.dispatchEvent(new CustomEvent('onDropdownOpened', {}));

                }, 200);
            }

            // Scan for added message nodes and modify if needed
            function isMessageNode(node)
            {
                if (node.childNodes[0] && node.childNodes[0].getAttribute)
                {
                    if (node.childNodes[0].getAttribute("data-testid"))
                        return node.childNodes[0].getAttribute("data-testid").startsWith("conv-msg")
                }

                return false;
            }
            var msgNodes = [];
            if (isMessageNode(addedNode)) {
                msgNodes.push(addedNode);
            }
            msgNodes.push(...addedNode.querySelectorAll('[data-testid^="conv-msg"]'));

            for (let i = 0; i < msgNodes.length; i++)
            {
                const currentNode = msgNodes[i];
                onNewMessageNodeAdded(currentNode);
            }

            scanForEditedLabels(addedNode);
        }

        
        // Remove the menu item when the app is removed
        for (var j = 0; j < removedNodes.length; j++)
        {
            var removedNode = removedNodes[j];
            if (removedNode.classList == undefined) continue;
            if (removedNode.classList.contains("two"))
            {
                // main app was removed, remove our artifacts
                var menuItem = document.getElementsByClassName("menu-item-incognito")[0];
                var dropItem = document.getElementsByClassName("drop")[0];
                if (menuItem != undefined) menuItem.remove();
                if (dropItem != undefined) dropItem.remove();

                found = true;
                break;
            }

        }
        if (found) break;
    }

}

function onMainUIReady()
{
    document.dispatchEvent(new CustomEvent('onMainUIReady', {}));
    loadAndPushContactRules(); // the page world may not have been listening yet at startup
    if (!receiptSchedulerRestored)
    {
        receiptSchedulerRestored = true;
        // give the page world time to load its chats before overdue receipts are sent
        setTimeout(function() { receiptScheduler.restore().catch(function() { console.warn("WAIncognito: could not restore scheduled read receipts"); }); }, 4000);
        setTimeout(function() { sendScheduler.restore().catch(function() { console.warn("WAIncognito: could not restore scheduled messages"); }); }, 4500);
    }

    setTimeout(checkInterception, 1000);

    // if the menu item is gone somehow after a short period of time (e.g because the layout changes from right-to-left) add it again
    // TODO: a race can make the icon added twice
    setTimeout(addIconIfNeeded, 1000);
}

async function addIconIfNeeded()
{
    if (document.getElementsByClassName("menu-item-incognito").length > 0) return; // already added
    updateUIClassNamesIfNeeded();

    var firstMenuItem = document.getElementsByClassName(UIClassNames.MENU_ITEM_CLASS)[0];
    if (firstMenuItem != undefined)
    {
        var menuItemElem = await generateSVGElement(extensionUrl("images/incognito_gray_24_hollow_9.svg"), UIClassNames.MENU_ITEM_INNER_CLASS, "Incognito Options", 24, "button");
        menuItemElem.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");

        firstMenuItem.parentElement.insertBefore(menuItemElem, firstMenuItem);

        safeSendMessage({ name: "getOptions" }, function (options)
        {
            document.dispatchEvent(new CustomEvent('onOptionsUpdate', { detail: JSON.stringify(options) }));
        });

        menuItemElem.addEventListener("click", function() { openSettingsDialog(); });
        menuItemElem.addEventListener("keydown", function(e)
        {
            if (e.key == "Enter" || e.key == " ") { e.preventDefault(); openSettingsDialog(); }
        });
    }
    else if (isUIClassesWorking)
    {
        isUIClassesWorking = false;
        WAModal.fire({
            title: t("broken.title"),
            text: t("broken.body"),
            icon: "warning",
            width: 600,
            confirmButtonText: t("common.gotIt"),
        });
    }
}

document.addEventListener('onMarkAsReadClick', function (e)
{
    var data = JSON.parse(e.detail);
    safeSendMessage({ name: "getOptions" }, function (options)
    {
        if (options.readConfirmationsHook)
        {
            if (contactToggleFor(data.jid, "showReadWarning", options.showReadWarning))
            {
                WAModal.fire({
                    title: t("markRead.title"),
                    text: data.unreadCount > 1 ? t("markRead.many", { name: data.formattedName, count: data.unreadCount }) : t("markRead.one", { name: data.formattedName }),
                    input: 'checkbox',
                    inputValue: 0,
                    inputPlaceholder: t("markRead.dontShow"),
                    icon: "warning",
                    showCancelButton: true,
                    cancelButtonText: t("common.cancel"),
                    confirmButtonText: t("markRead.confirm"),
                }).then(result =>
                {
                    if (result.isConfirmed)
                    {
                        document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));
                        //swal("Sent!", "Messages were marked as read", "success");

                        var shouldShowReadWarning = result.value == 0;
                        safeSendMessage({ name: "setOptions", showReadWarning: shouldShowReadWarning });
                        document.dispatchEvent(new CustomEvent('onOptionsUpdate', { detail: JSON.stringify({ showReadWarning: shouldShowReadWarning }) }));
                    }
                });
            }
            else
            {
                // just send it withoung warning
                document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));
            }
        }
    });
});

document.addEventListener('onInterceptionWorking', function (e)
{
    var data = JSON.parse(e.detail);
    isInterceptionWorking = data.isInterceptionWorking;
});

//
// Diagnostics (see core/diagnostics.js): this world owns the DOM, so it checks the selectors
//
function classSelector(classNames)
{
    return "." + classNames.trim().split(/\s+/).join(".");
}

function registerSelectorDiagnostic(feature, id, selector)
{
    Diagnostics.register(feature, "selector", id, function() { return document.querySelectorAll(selector).length; });
}

function registerUIDiagnostics()
{
    var mainClasses = ["MENU_ITEM_CLASS", "CHAT_ENTRY_CLASS", "INNER_CHAT_PANEL_CLASS", "UNREAD_COUNTER_CLASS",
                       "OUTER_DROPDOWN_CLASS", "DROPDOWN_CLASS", "DROPDOWN_ENTRY_CLASS", "CHAT_MESSAGE_INNER_TEXT_DIV"];
    mainClasses.forEach(function(name)
    {
        if (UIClassNames[name]) registerSelectorDiagnostic("ui", "UIClassNames." + name, classSelector(UIClassNames[name]));
    });
    registerSelectorDiagnostic("ui", "message-node", '[data-testid^="conv-msg"]');
    Diagnostics.register("chat-menu", "hook", "chat-menu-entries", function() { return chatMenuEntriesShown; });
    Diagnostics.register("edits", "selector", "edited-label", function() { return document.getElementsByClassName("incognito-edit-original").length; });
    registerSelectorDiagnostic("contacts", "conversation-header (#main header)", "#main header");
    Diagnostics.register("contacts", "selector", "incognito-header-button", function() { return document.getElementsByClassName("incognito-header-button").length; });
    Diagnostics.register("ui", "hook", "incognito-menu-icon", function() { return document.getElementsByClassName("menu-item-incognito").length; });
}

function requestPageDiagnostics()
{
    return new Promise(function(resolve)
    {
        var requestId = "diag-" + Date.now() + "-" + Math.random();
        var done = false;
        diagnosticsResponses.waitFor(requestId, function(data) { done = true; resolve(data.results || []); });
        setTimeout(function()
        {
            if (!done) resolve([{feature: "core", kind: "hook", id: "page-world", status: "missing", detail: "page world tidak merespons"}]);
        }, 1500);
        document.dispatchEvent(new CustomEvent("waIncognitoDiagnosticsRequest", { detail: JSON.stringify({messageID: requestId}) }));
    });
}

function escapeHTML(text)
{
    return String(text == null ? "" : text).replace(/[&<>"']/g, function(c)
    {
        return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
}

//
// Vault (core/vault.js lives in the page world; the passphrase is sent there through waIncognitoVaultCommand)
//
function sendVaultCommand(cmd, passphrase)
{
    return new Promise(function(resolve)
    {
        var requestId = "vault-" + Date.now() + "-" + Math.random();
        vaultResponses.waitFor(requestId, resolve);
        document.dispatchEvent(new CustomEvent("waIncognitoVaultCommand", { detail: JSON.stringify({cmd: cmd, passphrase: passphrase, messageID: requestId}) }));
    });
}

function vaultThreatModelHTML() { return escapeHTML(t("vault.threat")); }

async function openVaultModal()
{
    var result = await sendVaultCommand("status");
    if (!result.ok || !result.status)
    {
        WAModal.fire({ title: t("vault.unavailable"), text: result.error || t("vault.pageNotReady"), icon: "error", confirmButtonText: t("common.ok") });
        return;
    }
    var status = result.status;

    if (!status.isSetUp)
    {
        var setup = await WAModal.fire({
            title: t("vault.create.title"),
            html: "<div style='font-size: 14px'>" + vaultThreatModelHTML() + "<br><br>" +
                  "<b style='color: var(--wam-danger)'>" + escapeHTML(t("vault.create.warning")) + "</b><br><br>" +
                  escapeHTML(t("vault.create.migrate")) + "</div>" +
                  "<input type='password' id='incognito-vault-pass1' class='wam-input' placeholder='" + escapeHTML(t("vault.pass1")) + "'>" +
                  "<input type='password' id='incognito-vault-pass2' class='wam-input' placeholder='" + escapeHTML(t("vault.pass2")) + "'>",
            showCancelButton: true,
            confirmButtonText: t("vault.create.confirm"),
            cancelButtonText: t("common.cancel"),
            preConfirm: function()
            {
                var pass1 = document.getElementById("incognito-vault-pass1").value;
                var pass2 = document.getElementById("incognito-vault-pass2").value;
                if (pass1.length < 8) { WAModal.showValidationMessage(t("vault.err.short")); return false; }
                if (pass1 !== pass2) { WAModal.showValidationMessage(t("vault.err.mismatch")); return false; }
                return pass1;
            },
        });
        if (!setup.isConfirmed) return;
        var setupResult = await sendVaultCommand("setup", setup.value);
        if (setupResult.ok)
            WAModal.fire({ title: t("vault.created.title"), text: t("vault.created.text", { count: setupResult.migrated }), icon: "success", confirmButtonText: t("common.ok") });
        else
            WAModal.fire({ title: t("vault.createFailed"), text: setupResult.error || "", icon: "error", confirmButtonText: t("common.ok") });
        return;
    }

    if (!status.isUnlocked)
    {
        var unlock = await WAModal.fire({
            title: t("vault.unlock.title"),
            html: "<div style='font-size: 14px'>" + vaultThreatModelHTML() + "</div>",
            input: "password",
            inputPlaceholder: t("vault.unlock.placeholder"),
            showCancelButton: true,
            confirmButtonText: t("vault.unlock.confirm"),
            cancelButtonText: t("common.cancel"),
        });
        if (!unlock.isConfirmed) return;
        var unlockResult = await sendVaultCommand("unlock", unlock.value);
        if (unlockResult.ok)
            WAModal.fire({ title: t("vault.unlocked.title"), text: t("vault.unlocked.text"), icon: "success", timer: 2500, confirmButtonText: t("common.ok") });
        else
            WAModal.fire({ title: t("vault.wrong"), icon: "error", confirmButtonText: t("common.ok") });
        return;
    }

    var info = await WAModal.fire({
        title: t("vault.unlocked.title"),
        html: "<div style='font-size: 14px'>" + vaultThreatModelHTML() + "<br><br>" +
              escapeHTML(t("vault.contents", { count: status.count, size: (status.bytes / (1024 * 1024)).toFixed(2) })) + "</div>",
        showCancelButton: true,
        confirmButtonText: t("vault.lock"),
        cancelButtonText: t("common.close"),
    });
    if (info.isConfirmed) await sendVaultCommand("lock");
}

//
// Edit history (core/edit_tracker.js): a small "Original" button next to WhatsApp's "Edited" label
//
// WhatsApp's own "Edited" label in the languages of this extension (its text varies, so the primary hook is the id set below)
var EDITED_LABEL_WORDS = ["edited", "diedit", "editado", "modifié", "bearbeitet", "изменено", "düzenlendi", "تم التعديل", "संपादित", "編集済み", "已编辑", "已編輯"];

function isEditedLabelText(text)
{
    var value = String(text || "").trim().toLowerCase();
    return value != "" && EDITED_LABEL_WORDS.indexOf(value) > -1;
}

// ids of messages the page world saw being edited (text independent hook)
var editedMessageIds = new Set();

function messageIdOfElement(element)
{
    var holder = element.closest ? element.closest("[data-id], [data-testid^='conv-msg']") : null;
    if (!holder) return null;
    var dataId = holder.getAttribute("data-id") || String(holder.getAttribute("data-testid") || "").replace(/^conv-msg-/, "");
    if (!dataId) return null;
    var parts = dataId.split("_");
    return { holder: holder, id: parts.length >= 3 ? parts[2] : dataId };
}

function scanForEditedLabels(root)
{
    if (!root || !root.querySelectorAll) return;
    var candidates = isEditedLabelText(root.textContent) && root.children.length == 0 ? [root] : Array.from(root.querySelectorAll("span"));
    for (var i = 0; i < candidates.length; i++)
    {
        var label = candidates[i];
        if (label.children.length > 0 || label.dataset.incognitoEditBtn) continue;
        if (!isEditedLabelText(label.textContent)) continue;
        addOriginalButton(label);
    }

    // messages known to be edited get the button even when WhatsApp's label is in a language we do not know
    if (editedMessageIds.size > 0)
    {
        var rows = root.matches && root.matches("[data-id], [data-testid^='conv-msg']") ? [root] : Array.from(root.querySelectorAll("[data-id], [data-testid^='conv-msg']"));
        rows.forEach(function(row)
        {
            var info = messageIdOfElement(row);
            if (info && editedMessageIds.has(info.id)) addOriginalButtonToMessage(info);
        });
    }
}

function makeOriginalButton(messageId)
{
    var button = document.createElement("span");
    button.className = "incognito-edit-original";
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.textContent = t("edit.original");
    button.title = t("edit.originalHint");
    function open(e) { e.stopPropagation(); e.preventDefault(); showEditHistory(messageId); }
    button.addEventListener("click", open);
    button.addEventListener("keydown", function(e) { if (e.key == "Enter" || e.key == " ") open(e); });
    return button;
}

function addOriginalButton(label)
{
    var info = messageIdOfElement(label);
    if (!info || info.holder.dataset.incognitoEditBtn) return;
    info.holder.dataset.incognitoEditBtn = "true";
    label.dataset.incognitoEditBtn = "true";
    label.parentNode.insertBefore(makeOriginalButton(info.id), label.nextSibling);
}

// no label found: put the button in the message's meta row (time + ticks), else at the end of the bubble
function addOriginalButtonToMessage(info)
{
    if (info.holder.dataset.incognitoEditBtn) return;
    info.holder.dataset.incognitoEditBtn = "true";
    var meta = info.holder.querySelector("[data-testid='msg-meta']");
    var button = makeOriginalButton(info.id);
    if (meta) meta.insertBefore(button, meta.firstChild);
    else info.holder.appendChild(button);
}

document.addEventListener("waIncognitoEdited", function(e)
{
    var data = JSON.parse(e.detail);
    if (!data.targetId) return;
    editedMessageIds.add(data.targetId);
    scanForEditedLabels(document.body);
});

function formatEditTime(ts)
{
    try { return new Date(ts).toLocaleString("id-ID"); }
    catch (e) { return String(ts); }
}

function showEditHistory(messageId)
{
    editHistoryResponses.waitFor(messageId, function(data)
    {
        if (data.locked)
        {
            WAModal.fire({ title: t("vault.locked"), text: t("edit.locked"), icon: "info", confirmButtonText: t("common.ok") });
            return;
        }
        var html;
        if (!data.edits || data.edits.length == 0)
        {
            html = escapeHTML(t("edit.noData"));
        }
        else
        {
            html = buildEditChain(data.edits).map(function(version)
            {
                var label = version.current ? t("edit.versionCurrent", { n: version.n }) : (version.n == 1 ? t("edit.versionOriginal", { n: version.n }) : t("edit.version", { n: version.n }));
                return "<div style='margin-bottom: 12px'><div style='font-weight: 500'>" + escapeHTML(label) + "</div>" +
                       (version.replacedAt ? "<div style='font-size: 12px; opacity: 0.7'>" + escapeHTML(t("edit.replacedAt", { time: formatEditTime(version.replacedAt) })) + "</div>" : "") +
                       "<div style='white-space: pre-wrap; margin-top: 2px'>" + escapeHTML(version.text) + "</div></div>";
            }).join("");
        }
        WAModal.fire({ title: t("edit.title"), html: html, confirmButtonText: t("common.close") });
    });
    document.dispatchEvent(new CustomEvent("getEditHistory", { detail: JSON.stringify({ messageID: messageId }) }));
}

//
// Chat context menu entries (see chatMenuEntries at the top)
//
document.addEventListener("waIncognitoChatMenuContext", function(e)
{
    var data = JSON.parse(e.detail);
    if (data.context) appendChatMenuEntries(data.context);
});

function appendChatMenuEntries(context)
{
    if (chatMenuEntries.length == 0) return;
    var dropdown = document.getElementsByClassName(UIClassNames.DROPDOWN_CLASS)[0];
    if (!dropdown || dropdown.getElementsByClassName("incognito-chat-menu-entry").length > 0) return;
    var template = dropdown.getElementsByClassName(UIClassNames.DROPDOWN_ENTRY_CLASS)[0];
    if (!template || !template.parentElement) return;

    chatMenuEntries.forEach(function(entry)
    {
        var item = document.createElement("div");
        item.className = UIClassNames.DROPDOWN_ENTRY_CLASS + " incognito-chat-menu-entry";
        item.setAttribute("role", "button");
        item.textContent = t(entry.labelKey);
        item.addEventListener("click", function(e)
        {
            e.stopPropagation();
            closeChatMenu();
            entry.run(context);
        });
        template.parentElement.appendChild(item);
    });
    chatMenuEntriesShown++;
}

// best effort: WhatsApp closes its menus on an outside click or Escape
function closeChatMenu()
{
    try
    {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
    catch (e) { /* the menu simply stays open */ }
}

//
// Saved disappearing messages of a chat (core/ephemeral_keeper.js)
//
function mimeToExtension(mimetype)
{
    var map = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "audio/ogg": "ogg",
                "audio/mpeg": "mp3", "audio/mp4": "m4a", "application/pdf": "pdf" };
    var base = String(mimetype || "").split(";")[0].trim().toLowerCase();
    return map[base] || (base.split("/")[1] || "bin").replace(/[^a-z0-9]/g, "");
}

function downloadBase64AsFile(b64, mimetype, fileName)
{
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], { type: mimetype || "application/octet-stream" }));
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
}

function requestEphemeralForChat(context)
{
    return new Promise(function(resolve)
    {
        var requestId = "eph-" + Date.now() + "-" + Math.random();
        ephemeralResponses.waitFor(requestId, resolve);
        setTimeout(function() { resolve({ items: [], locked: false, timedOut: true }); }, 10500);
        document.dispatchEvent(new CustomEvent("getEphemeralForChat", { detail: JSON.stringify({ messageID: requestId, chatJids: context.jids }) }));
    });
}

async function openEphemeralModal(context)
{
    var data = await requestEphemeralForChat(context);
    if (data.locked)
    {
        WAModal.fire({ title: t("vault.locked"), text: t("eph.locked"), icon: "info", confirmButtonText: t("common.ok") });
        return;
    }

    var html;
    if (!data.items || data.items.length == 0)
    {
        html = escapeHTML(t("eph.empty", { option: t("opt.keepDisappearing") }));
    }
    else
    {
        html = "<div style='max-height: 50vh; overflow-y: auto; text-align: left'>" + data.items.map(function(item)
        {
            var body = item.text ? "<div style='white-space: pre-wrap'>" + escapeHTML(item.text) + "</div>" : "<i>" + escapeHTML(t("eph.noText")) + "</i>";
            var button = item.hasMedia ?
                "<button class='wam-btn wam-btn-secondary wam-btn-small' style='margin-top: 6px' data-eph-id='" + escapeHTML(item.id) + "' data-eph-mime='" +
                escapeHTML(item.mimetype || "") + "'>" + escapeHTML(t("eph.download", { type: item.mediaType })) + "</button>" : "";
            return "<div style='margin-bottom: 12px'><div style='font-size: 11px; opacity: 0.7'>" + escapeHTML(formatEditTime(item.ts)) + "</div>" + body + button + "</div>";
        }).join("") + "</div>";
    }

    WAModal.fire({
        title: t("eph.title", { name: context.name || "" }),
        html: html,
        width: 600,
        confirmButtonText: t("common.close"),
        didOpen: function(popup)
        {
            popup.addEventListener("click", function(e)
            {
                var target = e.target.closest ? e.target.closest("[data-eph-id]") : null;
                if (!target) return;
                target.disabled = true;
                var requestId = "ephm-" + Date.now() + "-" + Math.random();
                ephemeralMediaResponses.waitFor(requestId, function(reply)
                {
                    target.disabled = false;
                    if (!reply.ok) { target.textContent = t("eph.failed", { error: reply.error || "" }); return; }
                    downloadBase64AsFile(reply.b64, reply.mimetype, "pesan-sementara_" + Date.now() + "." + mimeToExtension(reply.mimetype));
                });
                document.dispatchEvent(new CustomEvent("downloadEphemeralMedia", { detail: JSON.stringify({ messageID: requestId, id: target.dataset.ephId }) }));
            });
        },
    });
}

//
// Chats for the per-contact list, and the open chat (core/chat_menu_context.js answers; names only, never messages)
//
var chatsResponses = createResponseRouter(document, "waIncognitoChatsResult", 8000);
var activeChatResponses = createResponseRouter(document, "waIncognitoActiveChatResult", 4000);

function requestFromPageWorld(router, requestName, prefix, fallback)
{
    return new Promise(function(resolve)
    {
        var requestId = prefix + "-" + Date.now() + "-" + Math.random();
        var done = false;
        router.waitFor(requestId, function(data) { done = true; resolve(data); });
        setTimeout(function() { if (!done) resolve(fallback); }, 3000);
        document.dispatchEvent(new CustomEvent(requestName, { detail: JSON.stringify({ messageID: requestId }) }));
    });
}

function requestChatContexts()
{
    return requestFromPageWorld(chatsResponses, "waIncognitoChatsRequest", "chats", { chats: [] }).then(function(data) { return data.chats || []; });
}

function requestActiveChatContext()
{
    return requestFromPageWorld(activeChatResponses, "waIncognitoActiveChatRequest", "active", { context: null }).then(function(data) { return data.context || null; });
}

// An "Incognito" button in the header of the open conversation: opens the privacy settings of that contact.
// Hook: the <header> inside #main (verified on the live DOM structure), added once per header element.
function ensureConversationHeaderButton()
{
    var header = document.querySelector("#main header");
    if (!header || header.querySelector(".incognito-header-button")) return;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "incognito-header-button";
    button.title = t("header.button");
    button.setAttribute("aria-label", t("header.button"));
    var image = document.createElement("img");
    image.src = extensionUrl("images/incognito_gray_24_hollow_9.svg");
    image.alt = "";
    image.width = 22;
    image.height = 22;
    button.appendChild(image);
    button.addEventListener("click", async function(e)
    {
        e.stopPropagation();
        var context = await requestActiveChatContext();
        if (context) openContactPrivacyModal(context);
        else WAModal.fire({ title: t("header.noChat"), icon: "info", confirmButtonText: t("common.ok") });
    });
    header.appendChild(button);
}

setInterval(function() { try { ensureConversationHeaderButton(); } catch (e) {} }, 2000);

//
// Per-contact privacy (core/contact_rules.js). Rules live in chrome.storage.local["contactRules"] (background.js)
// and are pushed to the page world with onContactRulesUpdate.
//
function pushContactRules(rules)
{
    contactRulesCache = rules || {};
    document.dispatchEvent(new CustomEvent("onContactRulesUpdate", { detail: JSON.stringify(contactRulesCache) }));
}

function loadAndPushContactRules()
{
    safeSendMessage({ name: "getContactRules" }, function(rules) { pushContactRules(rules); });
}

function sendBackgroundMessage(message)
{
    return new Promise(function(resolve) { if (!safeSendMessage(message, resolve)) resolve(null); });
}

// The per-contact settings open as a page inside the big popup (core/settings_dialog.js)
function openContactPrivacyModal(context)
{
    openSettingsDialog({ category: "kontak", contact: context });
    return Promise.resolve();
}

// Stores one rule under every known form of the contact's JID (PN and LID); "default" removes it.
async function setContactRuleForContext(context, field, value)
{
    var rules = contactRulesCache;
    for (var i = 0; i < context.jids.length; i++)
        rules = await sendBackgroundMessage({ name: "setContactRule", jid: context.jids[i], field: field, value: value });
    pushContactRules(rules);
}

async function resetContactRulesForContext(context)
{
    var rules = await sendBackgroundMessage({ name: "clearContactRules", jids: context.jids });
    pushContactRules(rules);
}

// ---- consumers of the per-contact rules in this world ----

function chatJidOfMessageElement(element)
{
    var holder = element && element.closest ? element.closest("[data-id]") : null;
    var parts = holder ? String(holder.getAttribute("data-id")).split("_") : [];
    return parts.length >= 3 ? parts[1] : null;
}

function contactToggleFor(jid, field, globalValue)
{
    if (!jid || typeof resolveToggle != "function") return globalValue;
    return resolveToggle(contactRules, jidCandidates(jid, null), field, globalValue);
}

// A conversation can blur its own messages, media and avatars, or opt out of a global blur: attributes on #main (styles.css)
var contactBlurTimer = null;
function applyContactBlur()
{
    var main = document.getElementById("main");
    if (!main) return;
    if (typeof contactRules == "undefined" || Object.keys(contactRules).length == 0)
    {
        main.removeAttribute("data-incognito-blur");
        main.removeAttribute("data-incognito-noblur");
        return;
    }
    requestActiveChatContext().then(function(context)
    {
        var blur = [], noblur = [];
        if (context)
        {
            var candidates = context.jids;
            [["messages", "blurMessages"], ["media", "blurMedia"], ["avatars", "blurAvatars"]].forEach(function(pair)
            {
                var value = contactRuleValue(contactRules, candidates, pair[1]);
                if (value == "on") blur.push(pair[0]);
                else if (value == "off") noblur.push(pair[0]);
            });
        }
        main = document.getElementById("main");
        if (!main) return;
        if (blur.length) main.setAttribute("data-incognito-blur", blur.join(" ")); else main.removeAttribute("data-incognito-blur");
        if (noblur.length) main.setAttribute("data-incognito-noblur", noblur.join(" ")); else main.removeAttribute("data-incognito-noblur");
    });
}
setInterval(function() { try { applyContactBlur(); } catch (e) {} }, 1500);

// Blue ticks that were held back are scheduled automatically for contacts with an "autoSchedule" rule
document.addEventListener("onReadConfirmationBlocked", function(e)
{
    try
    {
        var jid = String(e.detail);
        var minutes = Number(resolveChoice(contactRules, jidCandidates(jid, null), "autoSchedule", 0));
        if (!(minutes > 0)) return;
        var candidates = jidCandidates(jid, null);
        var already = receiptScheduler.list().some(function(item) { return candidates.indexOf(item.jid) > -1; });
        if (!already) receiptScheduler.schedule(jid, Date.now() + minutes * 60 * 1000);
    }
    catch (exception) { console.warn("WAIncognito: could not auto-schedule the blue ticks"); }
});

//
// Scheduled blue ticks (core/receipt_scheduler.js)
//
document.addEventListener("onScheduleReceiptClick", function(e)
{
    var data = JSON.parse(e.detail);
    if (data.context) openScheduleReceiptModal(data.context);
});

async function openScheduleReceiptModal(context)
{
    var jid = context.primaryJid;
    var existing = receiptScheduler.list().find(function(item) { return item.jid == jid; });

    var result = await WAModal.fire({
        title: t("rcpt.title"),
        html: "<div style='font-size: 14px'><b>" + escapeHTML(context.name) + "</b><br><br>" +
              (existing ? escapeHTML(t("rcpt.existing", { time: formatEditTime(existing.dueAt) })) + "<br><br>" : "") +
              "<select id='incognito-receipt-choice' class='wam-select' style='margin: 0 0 8px 0'>" +
              "<option value='15m'>" + escapeHTML(t("rcpt.m15")) + "</option><option value='1h'>" + escapeHTML(t("rcpt.h1")) + "</option><option value='3h'>" + escapeHTML(t("rcpt.h3")) + "</option>" +
              "<option value='time'>" + escapeHTML(t("rcpt.time")) + "</option></select><br>" +
              "<input type='time' id='incognito-receipt-time' class='wam-input' style='margin: 0; display: none'><br>" +
              "<span style='font-size: 12px; opacity: 0.8'>" + escapeHTML(t("rcpt.note")) + "</span></div>",
        showCancelButton: true,
        showDenyButton: !!existing,
        denyButtonText: t("rcpt.cancelSchedule"),
        confirmButtonText: t("rcpt.confirm"),
        cancelButtonText: t("common.close"),
        didOpen: function()
        {
            var choice = document.getElementById("incognito-receipt-choice");
            choice.addEventListener("change", function()
            {
                document.getElementById("incognito-receipt-time").style.display = choice.value == "time" ? "" : "none";
            });
        },
        preConfirm: function()
        {
            var dueAt = resolveScheduleChoice(document.getElementById("incognito-receipt-choice").value, Date.now(),
                                              document.getElementById("incognito-receipt-time").value);
            if (dueAt == null) { WAModal.showValidationMessage(t("rcpt.invalidTime")); return false; }
            return dueAt;
        },
    });

    if (result.isDenied) await receiptScheduler.cancel(jid);
    else if (result.isConfirmed) await receiptScheduler.schedule(jid, result.value);
}

//
// Screen lock passcode (core/privacy_screen.js). Only {salt, hash} is stored, in chrome.storage.local["lockPasscode"].
//
async function openLockSetupModal()
{
    var stored = await extensionStorageGet(["lockPasscode"]);
    var hasPasscode = !!stored.lockPasscode;

    var result = await WAModal.fire({
        title: hasPasscode ? t("lock.title") : t("lock.createTitle"),
        html: "<div style='font-size: 14px'>" + escapeHTML(t("lock.disclaimer")) + "<br><br>" +
              escapeHTML(t("lock.enableHint", { option: t("opt.lockEnabled") })) +
              (hasPasscode ? "<br><br>" + escapeHTML(t("lock.existing")) : "") + "</div>" +
              "<input type='password' id='incognito-lock-pass1' class='wam-input' placeholder='" + escapeHTML(t("lock.pass1")) + "'>" +
              "<input type='password' id='incognito-lock-pass2' class='wam-input' placeholder='" + escapeHTML(t("lock.pass2")) + "'>",
        showCancelButton: true,
        showDenyButton: hasPasscode,
        denyButtonText: t("lock.now"),
        confirmButtonText: t("lock.saveBtn"),
        cancelButtonText: t("common.close"),
        preConfirm: function()
        {
            var pass1 = document.getElementById("incognito-lock-pass1").value;
            var pass2 = document.getElementById("incognito-lock-pass2").value;
            if (pass1.length < 4) { WAModal.showValidationMessage(t("lock.err.short")); return false; }
            if (pass1 !== pass2) { WAModal.showValidationMessage(t("lock.err.mismatch")); return false; }
            return pass1;
        },
    });

    if (result.isDenied)
    {
        if (window.WAIncognitoLock) window.WAIncognitoLock.lockNow();
    }
    else if (result.isConfirmed)
    {
        await savePasscode(result.value);
        WAModal.fire({ title: t("lock.saved"), icon: "success", timer: 2000, confirmButtonText: t("common.ok") });
    }
}

async function savePasscode(code)
{
    var saltBytes = crypto.getRandomValues(new Uint8Array(16));
    var salt = btoa(String.fromCharCode.apply(null, saltBytes));
    var hash = await hashPasscode(code, salt);
    await extensionStorageSet({ lockPasscode: { salt: salt, hash: hash } });
}

//
// Scheduled messages (core/send_scheduler.js). The page world sends through WhatsApp's own function.
//
function showScheduleToast(title, icon)
{
    WAModal.fire({ toast: true, position: "bottom-end", icon: icon, title: title, showConfirmButton: false, timer: 7000 });
}

function sendTextViaPageWorld(message)
{
    return new Promise(function(resolve)
    {
        var requestId = "send-" + Date.now() + "-" + Math.random();
        var finished = false;
        function finish(result)
        {
            if (finished) return;
            finished = true;
            if (!result.ok) showScheduleToast(t("sched.failed", { error: result.error || t("sched.unknown") }), "error");
            resolve(result);
        }
        sendTextResponses.waitFor(requestId, finish);
        setTimeout(function() { finish({ ok: false, error: t("sched.noAnswer") }); }, 30000);
        document.dispatchEvent(new CustomEvent("waIncognitoSendText", { detail: JSON.stringify({ id: requestId, jid: message.jid, text: message.text }) }));
    });
}

function toDateTimeLocalValue(ms)
{
    var date = new Date(ms);
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function scheduledMessagesHTML(items)
{
    if (items.length == 0) return "";
    return "<div style='margin-top: 12px; font-size: 13px'><b>" + escapeHTML(t("sched.list")) + "</b>" + items.map(function(item)
    {
        var status = item.status == "error" ? " " + escapeHTML(t("sched.error", { error: item.error || "" })) : (item.status == "overdue" ? " " + escapeHTML(t("sched.overdueTag")) : "");
        return "<div style='margin-top: 6px'>" + escapeHTML(formatEditTime(item.dueAt)) + status + "<br><span style='opacity: 0.8'>" +
               escapeHTML(item.text.length > 60 ? item.text.slice(0, 60) + "…" : item.text) + "</span> " +
               "<button class='wam-btn wam-btn-secondary wam-btn-small' style='margin-left: 8px' data-sched-cancel='" + escapeHTML(item.id) + "'>" + escapeHTML(t("common.cancel")) + "</button></div>";
    }).join("") + "</div>";
}

async function openScheduleMessageModal(context)
{
    var mine = sendScheduler.list().filter(function(item) { return context.jids.indexOf(item.jid) > -1; });

    await WAModal.fire({
        title: t("sched.title"),
        html: "<div style='text-align: left; font-size: 14px'><b>" + escapeHTML(context.name) + "</b></div>" +
              "<textarea id='incognito-sched-text' class='wam-textarea' placeholder='" + escapeHTML(t("sched.placeholder")) + "' style='margin: 8px 0'></textarea>" +
              "<input type='datetime-local' id='incognito-sched-time' class='wam-input' style='margin: 0' value='" + toDateTimeLocalValue(Date.now() + 10 * 60 * 1000) + "'>" +
              "<div style='font-size: 12px; opacity: 0.8; margin-top: 8px'>" + escapeHTML(t("sched.note")) + "</div>" +
              "<div id='incognito-sched-list'>" + scheduledMessagesHTML(mine) + "</div>",
        width: 560,
        showCancelButton: true,
        confirmButtonText: t("rcpt.confirm"),
        cancelButtonText: t("common.close"),
        didOpen: function(popup)
        {
            popup.addEventListener("click", async function(e)
            {
                var button = e.target.closest ? e.target.closest("[data-sched-cancel]") : null;
                if (!button) return;
                await sendScheduler.cancel(button.dataset.schedCancel);
                button.parentElement.remove();
            });
        },
        preConfirm: function()
        {
            var text = document.getElementById("incognito-sched-text").value;
            var dueAt = new Date(document.getElementById("incognito-sched-time").value).getTime();
            if (!text.trim()) { WAModal.showValidationMessage(t("sched.err.empty")); return false; }
            if (!isFinite(dueAt) || dueAt < Date.now() + 5000) { WAModal.showValidationMessage(t("sched.err.future")); return false; }
            return { text: text, dueAt: dueAt };
        },
    }).then(async function(result)
    {
        if (!result.isConfirmed) return;
        await sendScheduler.add(context.primaryJid, result.value.text, result.value.dueAt, context.name);
        showScheduleToast(t("sched.done", { time: formatEditTime(result.value.dueAt) }), "success");
    });
}

// scheduled messages that came due while the tab was closed are never sent on their own
async function askAboutOverdueMessages(items)
{
    for (var i = 0; i < items.length; i++)
    {
        var item = items[i];
        var answer = await WAModal.fire({
            title: t("overdue.title"),
            html: "<div style='font-size: 14px'>" + escapeHTML(t("overdue.body", { time: formatEditTime(item.dueAt) })) +
                  (item.name ? " " + escapeHTML(t("overdue.to")) + " <b>" + escapeHTML(item.name) + "</b>" : "") + ":<br><br><div style='white-space: pre-wrap'>" + escapeHTML(item.text) + "</div></div>",
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: t("overdue.sendNow"),
            denyButtonText: t("common.cancel"),
            cancelButtonText: t("overdue.later"),
            allowOutsideClick: false,
        });
        if (answer.isConfirmed) await sendScheduler.sendNow(item.id);
        else if (answer.isDenied) await sendScheduler.cancel(item.id);
    }
}

function setOptionFromMenu(key, value)
{
    var message = { name: "setOptions" };
    message[key] = value;
    safeSendMessage(message);

    var update = {};
    update[key] = value;
    document.dispatchEvent(new CustomEvent('onOptionsUpdate', { detail: JSON.stringify(update) }));

    // side effects the old menu had
    if (key == "onlineUpdatesHook")
    {
        document.dispatchEvent(new CustomEvent(value ? 'onPresenceOptionTicked' : 'onPresenceOptionUnticked'));
    }
    else if (key == "readConfirmationsHook" && !value)
    {
        var redChats = document.getElementsByClassName("icon-meta unread-count incognito");
        for (var i = redChats.length - 1; i >= 0; i--) redChats[i].className = 'icon-meta unread-count';
    }
}

async function generateSVGElement(svgImagePath, clazz="", title="", size=24, role="")
{
    var response = await fetch(svgImagePath);
    var text = await response.text();
    var viewBoxText = text.split('viewBox="')[1].split('"')[0];
    var viewboxSize = parseInt(text.split('viewBox="')[1].split(' ')[2]);

    var menuItemElem = document.createElement("div");

    menuItemElem.innerHTML = `<div aria-disabled="false" role="${role}" tabindex="0" class="${clazz}" title="${title}" \
                            aria-label="${title}"><span data-testid="menu" data-icon="menu" class=""><svg viewBox="${viewBoxText}" \
                            width="${size}" height="${size}" class=""><path fill="currentColor" d=""></path></svg></span></div><span></span>`;
    var path = menuItemElem.getElementsByTagName("path")[0];
    var svg = menuItemElem.getElementsByTagName("svg")[0];

    var dom = new DOMParser().parseFromString(text, 'text/html');
    var svgHtml = dom.getElementsByTagName("svg")[0].innerHTML;
    svg.innerHTML = svgHtml;

    return menuItemElem;
}

function onNewMessageNodeAdded(messageNode)
{
    var data_id = messageNode.getAttribute("data-id");
    if (!data_id) data_id = messageNode.parentElement.parentElement.parentElement.getAttribute("data-id");
    if (data_id == null) return;

    var msgID = data_id.includes("_") ? data_id.split("_")[2] : data_id;

    // check if there are any view-once messages for this message ID
    // open viewOnce indexedDB
    restoreViewOnceMessageIfNeeded(messageNode, msgID);

    restoreDeletedMessageIfNeeded(messageNode, msgID);

    markMessageNodeDeviceIfPossible(messageNode, msgID);
}

function restoreViewOnceMessageIfNeeded(messageNode, msgID) 
{
    var viewOnceDBOpenRequest = window.indexedDB.open("viewOnce", 2);
    viewOnceDBOpenRequest.onupgradeneeded = function (event) 
    {
        const db = event.target.result;
        var store = db.createObjectStore('msgs', { keyPath: 'id' });
        console.log('WhatsIncognito: Created viewOnce database.');
        store.createIndex("id_index", "id");
    };

    viewOnceDBOpenRequest.onsuccess = function () 
    {
        var viewOnceDB = viewOnceDBOpenRequest.result;
        var keys = viewOnceDB.transaction('msgs', "readonly").objectStore("msgs").getAll();
        keys.onsuccess = () => {
            keys.result.forEach((value) => 
            {
                if (value.id == msgID) 
                {
                    // we found a view-once message for this message ID
                    // mark the message node as view-once
                    // get the place that we want to place the link
                    // this is a bit hacky, if the viewonce is the most recent message displayed it has to use the second one
                    var viewOnceExplanation = null;
                    // find all div elements in the message node
                    var aElements = messageNode.getElementsByTagName("a");
                    // loop through
                    for (var i = 0; i < aElements.length; i++) 
                    {
                        // if the innerHtml indicates it's the "Learn more" link
                        if (aElements[i].innerHTML.includes("Learn more")) 
                        {
                            // set the viewOnceExplanation to the parent div
                            viewOnceExplanation = aElements[i].parentElement;
                        }
                    }
                    // set innerHTML to empty
                    viewOnceExplanation.innerHTML = "";
                    // if value.dataURI starts with "data:image"
                    if (value.dataURI.startsWith("data:image")) 
                    {
                        // create an image elemnt
                        var img = document.createElement("img");
                        // set the source to the value.dataURI
                        img.src = value.dataURI;
                        // set the width to 100%
                        img.style.cssText = "width: 100%;";
                        // append the image to the viewOnceExplanation
                        viewOnceExplanation.appendChild(img);
                    } 
                    else if (value.dataURI.startsWith("data:video")) 
                    {
                        // create a video element
                        var video = document.createElement("video");
                        // set the controls to true
                        video.controls = true;
                        video.src = value.dataURI;
                        // append the video to the viewOnceExplanation
                        viewOnceExplanation.appendChild(video);
                    } else if (value.dataURI.startsWith("data:audio")) {
                        // create an audio element
                        var audio = document.createElement("audio");
                        // set the controls to true
                        audio.controls = true;
                        audio.src = value.dataURI;
                        // append the audio to the viewOnceExplanation
                        viewOnceExplanation.appendChild(audio);
                    }

                    // check if there is a caption stored and render it
                    if(value.caption != null){
                        var textSpan = document.createElement("span");
                        var textSpanStyle = "font-style: normal; color: rgba(241, 241, 242, 0.95); margin-top: 10px; margin-bottom: 10px;";
                        textSpan.style.cssText = textSpanStyle;
                        textSpan.className = "copyable-text selectable-text";
                        textSpan.textContent = value.caption;
                        viewOnceExplanation.appendChild(textSpan);
                    }

                    // add a learn more link below that opens a sweetalert
                    var learnMore = document.createElement("a");
                    // give it the class of incognito-view-once-learn-more so styles can be applied
                    learnMore.className = "incognito-view-once-learn-more";
                    learnMore.href = "#";
                    learnMore.textContent = t("viewonce.learn");
                    learnMore.addEventListener("click", function () {
                        WAModal.fire({
                            title: t("viewonce.title"),
                            text: t("viewonce.body"),
                            icon: "info",
                            width: 600,
                            confirmButtonText: t("common.gotIt"),
                        });
                    });
                    viewOnceExplanation.appendChild(learnMore);
                }
            });
        };
    };
}

// This function gets called on every new message node that gets added to the screen,
// and takes care of "deleted" messages - 
// attempts to syntethise a message that was deleted from our DB / just mark it in red
// Red tint, left border and a "Dihapus" label (styles.css) on the message row. The row is the element with data-id: that hook
// is stable, unlike the bubble's classes. The label text comes from the --incognito-deleted-label variable (see applyLanguage).
function markMessageDeleted(node)
{
    var row = node.closest ? (node.closest("[data-id]") || node) : node;
    if (!contactToggleFor(chatJidOfMessageElement(row), "markDeleted", true)) return; // this contact opted out of the red mark
    row.setAttribute("data-incognito-deleted", "true");
}

function restoreDeletedMessageIfNeeded(messageNode, msgID) 
{
    deletedMessageResponses.waitFor(msgID, function(data)
    {
        var messageData = data.messageData;

        if (data.locked)
        {
            // archived in the vault, but the vault is locked: show that instead of the content
            markMessageDeleted(messageNode);
            if (!messageNode.textContent.includes("message was deleted")) return;

            var lockedSubElement = messageNode.getElementsByClassName(UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV)[0];
            if (!lockedSubElement) return;
            lockedSubElement.textContent = t("restore.locked") + " ";
            var unlockButton = document.createElement("button");
            unlockButton.className = "incognito-vault-unlock-button";
            unlockButton.textContent = t("vault.unlock.title");
            unlockButton.addEventListener("click", function(e) { e.stopPropagation(); openVaultModal(); });
            lockedSubElement.appendChild(unlockButton);
            return;
        }

        var span = document.createElement("span");
        var textSpan = document.createElement("span");
        span.className = UIClassNames.DELETED_MESSAGE_SPAN;

        var didFindInDeletedMessagesDB = messageData != undefined;
        var shouldTryToSyntehesizeMessage  = messageNode.textContent.includes("message was deleted"); // TODO: other locales?

        if (!didFindInDeletedMessagesDB && !shouldTryToSyntehesizeMessage)
        {
            // This is just a regular messsage. move on.
            return;
        }

        if (didFindInDeletedMessagesDB)
        {
            // This message was deleted and we have the original data.
            markMessageDeleted(messageNode); // mark the message in red
            
            if (!shouldTryToSyntehesizeMessage)
            {
                // doesn't loook like a we need to restore anything becuase deletion was blocked already
                return;
            }
        }

        var messageSubElement = messageNode.getElementsByClassName(UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV)[0]; // oh well
        if (!messageSubElement) return;

        if (!didFindInDeletedMessagesDB && shouldTryToSyntehesizeMessage)
        {
            messageSubElement.textContent = "";
            textSpan.textContent = t("restore.failed");
            messageSubElement.appendChild(textSpan);
            messageSubElement.appendChild(span);
            markMessageDeleted(messageNode); // mark the message in red
            return;
        }

        //
        // If we reached this point, it means that for some reason we couldn't just block the REVOKE message eariler
        // This might happen if other stuff were sent in the relevant packet (see onMessageNodeReceived)
        // So ideally, the following code should be redundant.
        //

        // Now try to synthesize the message from the DB (best effort)
        tryToSynthesizeMessage(messageSubElement, messageData);
    });
    document.dispatchEvent(new CustomEvent("getDeletedMessageByID", {detail: JSON.stringify({messageID: msgID})}));
}

function tryToSynthesizeMessage(messageSubElement, messageData)
{
    messageSubElement.textContent = "";

    var titleSpan = document.createElement("span");
    var textSpan = document.createElement("span");

    var textSpanStyle = "font-style: normal; color: rgba(241, 241, 242, 0.95)";
    var titleSpanStyle = "font-style: normal; color: rgb(128, 128, 128)";
    textSpan.style.cssText = textSpanStyle;
    textSpan.className = "copyable-text selectable-text";
    
    titleSpan.style.cssText = titleSpanStyle;
    if (messageData.isMedia)
    {
        titleSpan.textContent = t("restore.media") + "\n";
        messageSubElement.appendChild(titleSpan); // Top title span

        if (messageData.mediaText) textSpan.textContent = "\n" + messageData.mediaText; //caption text span
        if (messageData.type === "image")
        {
            const imgTag = document.createElement("img");
            imgTag.style.cssText = "width: 100%;";
            //imgTag.className = UIClassNames.IMAGE_IMESSAGE_IMG;
            imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(imgTag);
        }
        else if (messageData.type === "sticker")
        {
            const imgTag = document.createElement("img");
            imgTag.className = UIClassNames.STICKER_MESSAGE_TAG;
            imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(imgTag);
        }
        else if (messageData.type === "video")
        {
            const vidTag = document.createElement("video");
            vidTag.controls = true;
            vidTag.style.cssText = "width: 100%;";
            const sourceTag = document.createElement("source");
            sourceTag.type = messageData.mimetype;
            sourceTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            vidTag.appendChild(sourceTag);
            messageSubElement.appendChild(vidTag);
        }
        else if (messageData.type === "document")
        {
            const aTag = document.createElement("a");
            aTag.download = messageData.fileName;
            aTag.href = "data:" + messageData.mimetype + ";base64," + messageData.body;
            aTag.textContent = "Download \"" + messageData.fileName + "\"";
            messageSubElement.appendChild(aTag);
        }
        else if (messageData.type === "ptt") // audio file
        {
            const audioTag = document.createElement("audio");
            audioTag.controls = true;
            const sourceTag = document.createElement("source");
            sourceTag.type = messageData.mimetype;
            sourceTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            audioTag.appendChild(sourceTag);
            messageSubElement.appendChild(audioTag);
        }
    }
    else
    {
        if (messageData.type === "vcard") // contact cards
        {
            let vcardBody = messageData.body;
            vcardBody = vcardBody.split(":");
            var phone = vcardBody[vcardBody.length - 2].slice(0, -4);
            var aTagPhone = document.createElement("a");
            aTagPhone.href = "tel:" + phone;
            aTagPhone.textContent = phone;
            aTagPhone.target = "_blank";
            aTagPhone.rel = "noopener noreferrer";
            var name = vcardBody[4].split(";")[0].slice(0, -4);

            titleSpan.textContent = t("restore.contact") + "\r\n";
            textSpan.textContent = "Name: " + name + "\n" + "Contact No.: ";

            messageSubElement.appendChild(titleSpan);
            textSpan.appendChild(aTagPhone);

        }
        else if (messageData.type === "location")
        {
            titleSpan.textContent = t("restore.location") + "\n";
            var imgTag = document.createElement("img");
            imgTag.style.cssText = "width: 100%;";
            //imgTag.className = UIClassNames.IMAGE_IMESSAGE_IMG;
            imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(imgTag);

            var locationLink = document.createElement("a");
            locationLink.target = "_blank";
            locationLink.rel = "noopener noreferrer";
            locationLink.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(messageData.lat + " " + messageData.lng);
            locationLink.textContent = "Google Maps Link";
            messageSubElement.appendChild(locationLink);
        }
        else
        {
            titleSpan.textContent = t("restore.message") + "\n";
            textSpan.textContent = messageData.body;
            messageSubElement.appendChild(titleSpan);
        }

    }
        
    messageSubElement.appendChild(textSpan);
}

function markMessageNodeDeviceIfPossible(messageNode, msgID)
{
    var isOutgoingMessage = messageNode.className.includes("message-out"); // TODO: this class name does not exist anymore, condition will always be true
    isOutgoingMessage = messageNode.innerHTML.includes("aria-label=\"You:\"");
    if (isOutgoingMessage)
    {
        // we don't want to mark our own messages
        return;
    }

    deviceTypeResponses.waitFor(msgID, async function(data)
    {
        var messageID = data.messageID;
        var deviceType = data.deviceType;

        var possibleNodes = document.querySelectorAll('[data-id*="' + messageID +'"]');
        if (possibleNodes.length > 0 )
            messageNode = possibleNodes[0].childNodes[0];

        if (messageNode.getElementsByClassName("device-type-image").length > 0) return;
        
        var imageURL = "";
        if (deviceType == "computer")
            imageURL = extensionUrl("images/computer.svg");
        else if (deviceType == "phone")
            imageURL = extensionUrl("images/phone.svg");
        else
            return;

        var imageElement = await generateSVGElement(imageURL, "", t("device.title", { device: t(deviceType == "computer" ? "device.computer" : "device.phone") }), 19);
        imageElement.className = "device-type-image";

        var topMessageNode = messageNode.parentNode.parentNode.parentNode;
        var previousNode = topMessageNode.previousElementSibling;
        var possibleAvatarElement = previousNode ? previousNode : topMessageNode;

        if (possibleAvatarElement.innerHTML.includes("chat-profile-picture") || possibleAvatarElement.innerHTML.includes("Open chat details"))
        {
            imageElement.className += " below-profile-picture";
        }

        messageNode.insertBefore(imageElement, messageNode.firstChild);
    });
    document.dispatchEvent(new CustomEvent("getDeviceTypeForMessage", {detail: JSON.stringify({messageID: msgID, chatJid: chatJidOfMessageElement(messageNode)})}));
}

function checkInterception()
{
    if (!isInterceptionWorking)
    {
        WAModal.fire({
            title: t("intercept.title"),
            text: t("intercept.body"),
            icon: "error",
            width: 600,
            confirmButtonText: t("common.ok"),
        });
        return false;
    }

    return true;
}

function updateUIClassNamesIfNeeded()
{
    // this function is meant to support multiples versions of WhatsApp with different GUI element names in the sae time.
    // but it does not sync with injected_ui.js. I need to find a way to share it

    var isOlderWAversion = false;

    if (isOlderWAversion)
    {
        UIClassNames.MENU_ITEM_CLASS = "x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 x1q0g3np x1cy8zhl x100vrsf x1vqgdyp xhslqc4 x1ekkm8c x1143rjc xum4auv xj21bgg x1277o0a x13i9f1t xr9ek0c xjpr12u";
        UIClassNames.MENU_ITEM_INNER_CLASS = "xjb2p0i xk390pu x1heor9g x1ypdohk xjbqb8w x972fbf x10w94by x1qhh985 x14e42zd xtnn1bt x9v5kkp xmw7ebm xrdum7p xt8t1vi x1xc408v x129tdwq x15urzxu xh8yej3 x1iorvi4 x11lfxj5 xjkvuk6 x135b78x"; // inner button
        UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS = " xhslqc4 x14ug900 xzs022t"; // you need to find the differences between the classes groups
        
        UIClassNames.OUTER_DROPDOWN_CLASS = "_ak4w _ap4- _ap4_"; // outside class of dropdown with "mark as unread"
        UIClassNames.DROPDOWN_CLASS = "_ap4_";
        UIClassNames.DROPDOWN_ENTRY_CLASS = "_aj-r _aj-q _aj-_ _asi6 _ap51";
        
        UIClassNames.UNREAD_COUNTER_CLASS = "xyp3urf"; // the span class that sets background-color to var(--unread-marker-background)
        
        UIClassNames.CHAT_PANEL_CLASS = "x14yy4lh"; // the outermost chat panel class (was used in the past for safety delay feature)
        UIClassNames.INNER_CHAT_PANEL_CLASS = "x3psx0u"; // the innermost chat panel class ('conversation-panel-messages')
        
        UIClassNames.CHAT_ENTRY_CLASS = "x10l6tqk xh8yej3 x1g42fcv "; // the chat entry in the chats list
        UIClassNames.UNREAD_MARKER_CLASS = "xqhmz9w"; // the "X unread messages" warning inside the chat panel; the class inside the top-level item
        UIClassNames.UNREAD_MARKER_CLASS_2 = "x1mnlqng"; // HACKKKKKKKK 
        UIClassNames.UNREAD_MARKER_CLASS_3 = "xhsao0n"; // HACKKKKK 2

        UIClassNames.GLOBAL_COLORS_CONTAINER_SELECTOR = ".x1h89ln0.x1h89ln0, .x1h89ln0.x1h89ln0:root"; // look for the selector in which the unread counter's color is defined
        
        UIClassNames.CHAT_MESSAGE = "messag-in";
        UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV = "x1lliihq xh8yej3";
    }

}
