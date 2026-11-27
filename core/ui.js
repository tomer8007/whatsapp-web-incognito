/*
This is a content script responsible for some UI.
*/


// Global variables
let mainUI;
let messagePanel;
let messageObserver;
let menu;
const messageSelector = '[data-testid^="conv-msg"]';
const messageObservation = { childList: true, subtree: true, attributeFilter: ["data-id"] };
const editHistoryObservation = { ...messageObservation, attributeFilter: ["data-id", "data-testid"], characterData: true };
const deviceIconTemplates = new Map();
const defaultAccentColor = "#1daa61";
const accentColorPattern = /^#[0-9a-f]{6}$/i;
const quickActivitySettings = [
    ["read-confirmations", "readConfirmationsHook", "Block read receipts", "Show a manual Mark as read button. Also applies to statuses and audio messages."],
    ["online-status", "onlineUpdatesHook", "Hide online status", "Prevents others from seeing when you’re online and hides their online status from you."],
    ["typing-status", "typingUpdatesHook", "Hide typing status", "Stops sending typing updates."]
];
const restoreDeletedMessagesSetting = ["save-deleted-msgs", "saveDeletedMsgs", "Restore deleted messages", "Keeps deleted messages visible and marks them in red."];
const contactPrivacyAnchor = '[data-testid="block-mute"]';
let extendedDeletePreference;
let keepEditedMessages = false;
const pendingEditHistory = new WeakMap();
let messageEventToast;
let messageEventToastTimeout;
var isInterceptionWorking = false;
var isUIClassesWorking = true;
var renderedMessages = new WeakMap();

if (chrome != undefined) 
{
	var browser = chrome;
}

document.addEventListener("onExtendedDeletePreferenceRequested", function ()
{
    if (extendedDeletePreference !== undefined)
        document.dispatchEvent(new CustomEvent("onExtendedDeletePreference", { detail: extendedDeletePreference }));
});

document.addEventListener("onEditHistoryPreferenceRequested", function ()
{
    document.dispatchEvent(new CustomEvent("onEditHistoryPreference", { detail: keepEditedMessages }));
});

document.addEventListener("onOptionsUpdate", function (event)
{
    const options = JSON.parse(event.detail);
    if (menu?.options && options)
    {
        menu.options = { ...menu.options, ...options };
        for (const panel of [menu.quickOptions, menu.dialog])
            for (const control of panel?.querySelectorAll('input[role="switch"]') ?? [])
                if (typeof options[control.name] === "boolean") control.checked = options[control.name];
    }
    if (typeof options?.readConfirmationsHook === "boolean")
        document.documentElement?.style.setProperty("--incognito-branded-opacity", options.readConfirmationsHook ? "0.3" : "1");
    if (typeof options?.hideMetaAI === "boolean")
        document.documentElement?.toggleAttribute("data-incognito-hide-meta-ai", options.hideMetaAI);
    const enabled = options?.keepEditedMessages;
    if (typeof enabled !== "boolean" || enabled === keepEditedMessages) return;
    keepEditedMessages = enabled;
    if (messagePanel?.isConnected)
        messageObserver.observe(messagePanel, enabled ? editHistoryObservation : messageObservation);
    if (enabled)
        refreshEditHistoryButtons();
    else
        for (const button of messagePanel?.querySelectorAll(".incognito-edit-history") ?? []) button.remove();
});

document.addEventListener("onEditHistorySaved", event =>
{
    refreshEditHistoryButtons(event.detail);
    showMessageEventToast("Message edited");
});
document.addEventListener("onChatMessageDeletionBlocked", () => showMessageEventToast("Message deletion blocked"));
document.addEventListener("onViewOnceMediaSaved", event =>
{
    if (typeof event.detail !== "string") return;
    for (const node of messagePanel?.querySelectorAll(messageSelector) ?? [])
    {
        const dataID = node.closest("[data-id]")?.getAttribute("data-id");
        if (messageIdFromDataId(dataID) === event.detail)
            restoreViewOnceMessageIfNeeded(node, event.detail, dataID);
    }
});

initialize();

function showMessageEventToast(text)
{
    // The settings dialog sits above the page while it is open.
    const container = menu?.dialog?.open ? menu.dialog : document.body;
    if (!container) return;
    if (!messageEventToast)
    {
        messageEventToast = document.createElement("div");
        messageEventToast.className = "incognito-message-toast";
        messageEventToast.setAttribute("role", "status");
    }
    if (messageEventToast.parentNode !== container)
    {
        messageEventToast.textContent = "";
        container.appendChild(messageEventToast);
    }

    clearTimeout(messageEventToastTimeout);
    // Let the live region mount before announcing its first update.
    messageEventToastTimeout = setTimeout(() =>
    {
        messageEventToast.textContent = text;
        messageEventToastTimeout = setTimeout(() => { messageEventToast.textContent = ""; }, 4000);
    }, 0);
}

function initialize()
{
    // load saved settings
    browser.runtime.sendMessage({ name: "getOptions" }, function (options)
    {
        extendedDeletePreference = options?.extendDeleteForEveryone === true;
        applyAccentColor(options?.accentColor);
        document.dispatchEvent(new CustomEvent('onOptionsUpdate',
        {
            detail: JSON.stringify(options)
        }));

        // ratify it
        var optionsMessage = options;
        optionsMessage.name = "setOptions";
        browser.runtime.sendMessage(optionsMessage);
    });

    if (!document.body) return;
    new MutationObserver(onMutationsObserved).observe(document.body, { childList: true, subtree: true });
    onMutationsObserved([]);
}

function applyAccentColor(color)
{
    const root = document.documentElement;
    const rgb = typeof color === "string" && accentColorPattern.test(color)
        ? color.slice(1).match(/../g).map(channel => parseInt(channel, 16))
        : null;
    if (!rgb && !root?.hasAttribute("data-incognito-accent")) return;

    const mix = (target, weight) => rgb?.map((channel, index) =>
        Math.round(channel * weight + target[index] * (1 - weight))).join(", ");
    const white = [255, 255, 255];
    const luminance = rgb?.reduce((total, channel, index) =>
    {
        const value = channel / 255;
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return total + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const shades = {
        "": rgb?.join(", "),
        "-soft": mix(white, 0.18),
        "-strong": mix([0, 0, 0], 0.42),
        "-soft-dark": mix([17, 27, 33], 0.24),
        "-strong-dark": mix(white, 0.45),
        "-text": rgb && (luminance > 0.179 ? "0, 0, 0" : "255, 255, 255")
    };
    for (const [shade, value] of Object.entries(shades))
    {
        const token = "--incognito-accent" + shade + "-rgb";
        if (value) root.style.setProperty(token, value);
        else root.style.removeProperty(token);
    }
    root.toggleAttribute("data-incognito-accent", Boolean(rgb));
}

function onMutationsObserved(mutations)
{
    if (!mutations.length) addContactPrivacyItem(document.querySelector(contactPrivacyAnchor));
    if (!mainUI?.isConnected)
    {
        mainUI = document.querySelector(".two");
        if (mainUI)
        {
            addIconIfNeeded();
            setTimeout(onMainUIReady, 100);
        }
    }

    if (menu && (!menu.anchor.isConnected || (menu.target && !menu.target.isConnected)))
    {
        removeMenu();
        if (mainUI) addIconIfNeeded();
    }

    if (!messagePanel?.isConnected)
    {
        messageObserver?.disconnect();
        messagePanel = document.querySelector('[data-testid="conversation-panel-messages"]')
            || document.getElementsByClassName(UIClassNames.INNER_CHAT_PANEL_CLASS)[0]
            || document.getElementById("main");
        if (messagePanel)
        {
            messageObserver ??= new MutationObserver(records =>
            {
                for (const record of records)
                {
                    if (record.type === "attributes") scanMessageNodes(record.target);
                    else if (record.type === "childList")
                    {
                        for (const node of record.addedNodes) scanMessageNodes(node);
                    }

                    if (!keepEditedMessages) continue;
                    const target = record.type === "characterData" ? record.target.parentElement : record.target;
                    const bubble = target?.closest?.(messageSelector);
                    if (bubble) renderEditHistoryButton(bubble);
                }
            });
            messageObserver.observe(messagePanel, keepEditedMessages ? editHistoryObservation : messageObservation);
            scanMessageNodes(messagePanel);
            document.dispatchEvent(new CustomEvent('onPaneChatOpened'));
        }
    }

    const popupSelector = '[data-menu-content="true"] [role="menu"]';
    const popups = new Set();
    for (const mutation of mutations)
    {
        if (messagePanel?.contains(mutation.target)) continue;
        const popup = mutation.target.closest?.(popupSelector);
        if (popup)
        {
            popups.add(popup);
            continue;
        }
        for (const node of mutation.addedNodes)
        {
            if (node.nodeType !== 1) continue;
            addContactPrivacyItem(node.matches(contactPrivacyAnchor) ? node : node.querySelector?.(contactPrivacyAnchor));
            if (node.matches(popupSelector)) popups.add(node);
            if (node.firstElementChild)
                for (const popup of node.querySelectorAll(popupSelector)) popups.add(popup);
        }
    }
    for (const popup of popups)
        popup.dispatchEvent(new CustomEvent("onDropdownOpened", { bubbles: true }));
}

function addContactPrivacyItem(mute)
{
    const row = mute?.closest('[role="none"]') ?? mute;
    if (!row?.isConnected || row.previousElementSibling?.classList.contains("incognito-contact-privacy-row")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "incognito-contact-privacy-row";
    button.setAttribute("aria-haspopup", "dialog");
    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("images/incognito_gray_24_hollow_9.svg");
    icon.alt = "";
    button.append(icon, "Contact privacy");
    button.addEventListener("click", () =>
    {
        let target;
        const receive = event =>
        {
            try { target = JSON.parse(event.detail); }
            catch { }
        };
        document.addEventListener("onActiveContactPrivacyTarget", receive);
        try { mute.dispatchEvent(new CustomEvent("getActiveContactPrivacyTarget", { bubbles: true })); }
        finally { document.removeEventListener("onActiveContactPrivacyTarget", receive); }
        if (!Array.isArray(target?.jids) || !target.jids.some(contactPrivacyJid))
        {
            showMessageEventToast("Could not identify this contact.");
            return;
        }
        showContactPrivacy(target);
    });
    row.before(button);
}

async function showContactPrivacy(target)
{
    const dialogId = "incognito-contact-privacy";
    const jids = [...new Set(target.jids.map(contactPrivacyJid).filter(Boolean))];
    if (!jids.length || document.getElementById(dialogId)) return;

    await contactPrivacyReady;
    const existing = Array.from(savedContactPrivacy).find(([, rule]) =>
        Array.isArray(rule?.jids) && rule.jids.some(jid => jids.includes(jid)));
    const [key, rule] = existing ?? [contactPrivacyPrefix + jids[0]];
    const isEnabled = Boolean(rule && rule.enabled !== false);
    const options = rule ?? menu?.options ?? await new Promise(resolve =>
        browser.runtime.sendMessage({ name: "getOptions" }, resolve));
    if (document.getElementById(dialogId)) return;
    const name = typeof target.name === "string" && target.name.trim() ? target.name.trim().slice(0, 200) : jids[0];
    const dialog = document.createElement("dialog");
    dialog.id = dialogId;
    dialog.className = "incognito-settings incognito-contact-privacy-dialog";
    dialog.setAttribute("aria-labelledby", "incognito-contact-privacy-title");
    dialog.innerHTML = `
        <div class="incognito-settings-shell" dir="ltr">
            <header class="incognito-settings-header">
                <h1 id="incognito-contact-privacy-title">Contact privacy</h1>
                <button class="incognito-settings-close" type="button" aria-label="Close contact privacy">×</button>
            </header>
            <form class="incognito-settings-pane">
                <h2 class="incognito-contact-name"></h2>
                <p>Turn this off to use your global settings for this contact.</p>
                ${renderSettings([["enable-privacy", "enabled", "Enable contact privacy", "", false]], { enabled: isEnabled }, "incognito-contact")}
                <fieldset class="incognito-contact-options" ${isEnabled ? "" : "disabled"}>
                    ${renderSettings([quickActivitySettings[0], quickActivitySettings[2]], options ?? {}, "incognito-contact")}
                </fieldset>
                <p role="status" class="incognito-contact-error" hidden>Could not save contact privacy. Try again.</p>
                <div class="incognito-contact-actions">
                    <button type="button" class="incognito-contact-reset" ${rule ? "" : "hidden"}>Remove override</button>
                    <button type="submit" class="incognito-contact-save">Save</button>
                </div>
            </form>
        </div>`;
    dialog.querySelector(".incognito-contact-name").textContent = name;
    const form = dialog.querySelector("form");
    const enabled = form.elements.namedItem("enabled");
    const contactOptions = form.querySelector("fieldset");
    enabled.addEventListener("change", () => { contactOptions.disabled = !enabled.checked; });
    const reset = form.querySelector(".incognito-contact-reset");
    const save = form.querySelector(".incognito-contact-save");
    const error = form.querySelector(".incognito-contact-error");
    async function persist(remove)
    {
        reset.disabled = save.disabled = true;
        error.hidden = true;
        try
        {
            if (remove) await chrome.storage.local.remove(key);
            else if (enabled.checked || rule) await chrome.storage.local.set({ [key]: {
                jids: [...new Set([...jids, ...(rule?.jids ?? [])])],
                name,
                enabled: enabled.checked,
                readConfirmationsHook: form.elements.namedItem("readConfirmationsHook").checked,
                typingUpdatesHook: form.elements.namedItem("typingUpdatesHook").checked
            } });
            dialog.close();
        }
        catch
        {
            error.hidden = false;
            reset.disabled = save.disabled = false;
        }
    }
    form.addEventListener("submit", event => event.preventDefault());
    save.addEventListener("click", event => { if (event.isTrusted) persist(false); });
    reset.addEventListener("click", event => { if (event.isTrusted) persist(true); });
    bindDialogDismissal(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
}

function renderContactPrivacyList(dialog)
{
    const list = dialog?.querySelector(".incognito-contact-list");
    if (!list) return;
    list.replaceChildren();
    for (const rule of savedContactPrivacy.values())
    {
        if (!Array.isArray(rule?.jids) || !rule.jids.length) continue;
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-haspopup", "dialog");
        button.textContent = (rule.name || rule.jids[0]) + (rule.enabled === false ? " (uses global settings)" : "");
        button.addEventListener("click", () => showContactPrivacy(rule));
        item.appendChild(button);
        list.appendChild(item);
    }
    dialog.querySelector(".incognito-contact-empty").hidden = list.childElementCount > 0;
}

document.addEventListener("onContactPrivacyUpdate", () => renderContactPrivacyList(menu?.dialog));

function scanMessageNodes(node)
{
    if (node.nodeType !== 1) return;
    if (node.matches(messageSelector)) onNewMessageNodeAdded(node);
    for (const messageNode of node.querySelectorAll(messageSelector)) onNewMessageNodeAdded(messageNode);
}

function onMainUIReady()
{
    document.dispatchEvent(new CustomEvent('onMainUIReady', {}));

    setTimeout(checkInterception, 1000);

    // if the menu item is gone somehow after a short period of time (e.g because the layout changes from right-to-left) add it again
    setTimeout(addIconIfNeeded, 1000);
}

function removeMenu()
{
    if (!menu) return;

    const { target, tooltip, quickOptions, dialog } = menu;
    menu = null;
    if (dialog?.open) dialog.close();
    dialog?.remove();
    quickOptions?.remove();
    tooltip?.remove();
    target?.remove();
}

async function addIconIfNeeded()
{
    if (menu) return;
    updateUIClassNamesIfNeeded();

    const anchor = document.getElementsByClassName(UIClassNames.MENU_ITEM_CLASS)[0];
    if (!anchor)
    {
        if (isUIClassesWorking)
        {
            isUIClassesWorking = false;
            Swal.fire({
                title: "WAIncognito is temporarily broken",
                html: "It seems that due to a recent WhatsApp Web update some graphical elements of the extension will not appear. Please be patient for a few days until a newer compatible version will be released.",
                icon: "warning",
                width: 600,
                confirmButtonColor: "#DD6B55",
                confirmButtonText: "Got it",
            });
        }
        return;
    }

    const setup = menu = { anchor };
    try
    {
        const label = "Incognito options";
        const target = await generateSVGElement(chrome.runtime.getURL("images/incognito_gray_24_hollow_9.svg"), UIClassNames.MENU_ITEM_INNER_CLASS, label, 24, "button");
        const options = await new Promise(resolve => browser.runtime.sendMessage({ name: "getOptions" }, resolve));
        if (menu !== setup) return;
        if (!anchor.isConnected)
        {
            removeMenu();
            return;
        }
        if (!options) throw new Error("Options are unavailable");

        setup.options = options;
        document.dispatchEvent(new CustomEvent("onOptionsUpdate", { detail: JSON.stringify(options) }));
        setup.target = target;
        target.className = UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito";
        const nativeButton = anchor.closest('button, [role="button"], [role="tab"]') ?? anchor;
        const wrapper = nativeButton.parentElement;
        const tooltipWrapper = wrapper?.matches('[title], [aria-describedby], [data-tooltip], [data-testid*="tooltip"]');
        let insertionPoint = tooltipWrapper ? wrapper : nativeButton;
        const nextItem = Array.from(document.getElementsByClassName(UIClassNames.MENU_ITEM_CLASS))
            .find(item => !insertionPoint.contains(item));
        if (nextItem)
        {
            // Insert beside the native item even when its tooltip wrapper has no identifying attributes.
            for (let branch = insertionPoint, depth = 0; branch.parentElement && depth < 3; branch = branch.parentElement, depth++)
            {
                if (!branch.parentElement.contains(nextItem)) continue;
                insertionPoint = branch;
                break;
            }
        }
        insertionPoint.before(target);

        const tooltip = setup.tooltip = document.createElement("div");
        tooltip.className = "incognito-menu-tooltip";
        tooltip.textContent = label;
        tooltip.setAttribute("aria-hidden", "true");
        const button = target.firstElementChild;
        const quickOptions = setup.quickOptions = document.createElement("div");
        quickOptions.id = "incognito-quick-options";
        quickOptions.className = "incognito-quick-options";
        quickOptions.dir = "ltr";
        quickOptions.setAttribute("popover", "auto");
        quickOptions.setAttribute("role", "dialog");
        quickOptions.setAttribute("aria-labelledby", "incognito-quick-options-title");
        quickOptions.innerHTML = `
            <h2 id="incognito-quick-options-title">Quick Incognito Options</h2>
            <p class="incognito-settings-notice" role="status" hidden>Waiting for WhatsApp to connect.</p>
            ${renderSettings([...quickActivitySettings, restoreDeletedMessagesSetting], setup.options, "incognito-quick")}
            <button class="incognito-quick-more" type="button" aria-haspopup="dialog" aria-controls="incognito-settings">More</button>`;
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-controls", quickOptions.id);
        button.setAttribute("popovertarget", quickOptions.id);
        bindToggleSettings(quickOptions);
        updateSettingsAvailability(quickOptions);
        document.body.appendChild(quickOptions);
        function showTooltip()
        {
            if (tooltip.isConnected || quickOptions.matches(":popover-open") || setup.dialog?.open) return;
            const rect = button.getBoundingClientRect();
            tooltip.style.left = rect.right + 4 + "px";
            tooltip.style.top = rect.top + rect.height / 2 + "px";
            document.body.appendChild(tooltip);
        }
        for (const event of ["mouseover", "pointerover", "focusin"])
            target.addEventListener(event, event => event.stopPropagation());
        target.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") showTooltip(); });
        target.addEventListener("pointerleave", () => tooltip.remove());
        button.addEventListener("focus", () => { if (button.matches(":focus-visible")) showTooltip(); });
        button.addEventListener("blur", () => tooltip.remove());
        button.addEventListener("keydown", event => { if (event.key === "Escape") tooltip.remove(); });

        function updateActiveButton()
        {
            const active = quickOptions.matches(":popover-open") || setup.dialog?.open;
            target.className = UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito"
                + (active ? " " + UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS + " active" : "");
        }
        quickOptions.addEventListener("beforetoggle", event =>
        {
            if (event.newState !== "open") return;
            tooltip.remove();
            const rect = button.getBoundingClientRect();
            quickOptions.style.setProperty("--quick-options-left", rect.right + 8 + "px");
            quickOptions.style.setProperty("--quick-options-top", rect.top + "px");
        });
        quickOptions.addEventListener("toggle", updateActiveButton);
        quickOptions.querySelector(".incognito-quick-more").addEventListener("click", () =>
        {
            quickOptions.hidePopover();
            if (!setup.dialog)
            {
                const dialog = setup.dialog = createOptionsDialog(setup.options);
                dialog.addEventListener("close", () =>
                {
                    if (dialog.open || menu !== setup) return;
                    updateActiveButton();
                    button.focus();
                });
                document.body.appendChild(dialog);
            }
            if (setup.dialog.open) return;
            updateSettingsAvailability(setup.dialog);
            renderContactPrivacyList(setup.dialog);
            setup.dialog.showModal();
            updateActiveButton();
        });
    }
    catch (error)
    {
        if (menu === setup) removeMenu();
        console.error("WAIncognito: Could not create options menu", error);
    }
}

function bindDialogDismissal(dialog)
{
    dialog.querySelector(".incognito-settings-close").addEventListener("click", () => dialog.close());
    let backdropPressed = false;
    dialog.addEventListener("pointerdown", event => { backdropPressed = event.target === dialog; });
    dialog.addEventListener("click", event =>
    {
        if (backdropPressed && event.target === dialog) dialog.close();
        backdropPressed = false;
    });
}

function createOptionsDialog(options)
{
    const dialog = document.createElement("dialog");
    dialog.id = "incognito-settings";
    dialog.className = "incognito-settings";
    dialog.setAttribute("aria-labelledby", "incognito-settings-title");
    dialog.innerHTML = generateOptionsContent(options);
    bindDialogDismissal(dialog);

    const sections = dialog.querySelectorAll("[aria-controls]");
    for (const section of sections)
        section.addEventListener("click", () =>
        {
            for (const item of sections)
            {
                const selected = item === section;
                item.setAttribute("aria-pressed", String(selected));
                dialog.querySelector("#" + item.getAttribute("aria-controls")).hidden = !selected;
            }
        });

    bindToggleSettings(dialog);

    const accentInput = dialog.querySelector("#incognito-accent-color");
    const accentValue = dialog.querySelector("#incognito-accent-value");
    let savedAccent = typeof options.accentColor === "string" && accentColorPattern.test(options.accentColor)
        ? options.accentColor : "";
    function previewAccent(color)
    {
        applyAccentColor(color);
        accentValue.textContent = color.toUpperCase();
    }
    function saveAccent(color)
    {
        savedAccent = color;
        previewAccent(color);
        browser.runtime.sendMessage({ name: "setOptions", accentColor: color });
    }
    accentInput.addEventListener("input", () => previewAccent(accentInput.value));
    accentInput.addEventListener("change", () => saveAccent(accentInput.value));
    dialog.querySelector("#incognito-reset-accent").addEventListener("click", () =>
    {
        accentInput.value = defaultAccentColor;
        saveAccent("");
    });
    dialog.addEventListener("close", () =>
    {
        if (dialog.open) return;
        accentInput.value = savedAccent || defaultAccentColor;
        previewAccent(savedAccent);
    });
    return dialog;
}

function saveToggleSetting(name, enabled)
{
    if (name === "extendDeleteForEveryone") extendedDeletePreference = enabled;
    if (name === "onlineUpdatesHook")
        document.dispatchEvent(new CustomEvent(enabled ? "onPresenceOptionTicked" : "onPresenceOptionUnticked"));
    if (name === "readConfirmationsHook" && !enabled)
        for (const chat of Array.from(document.getElementsByClassName("icon-meta unread-count incognito")))
            chat.classList.remove("incognito");

    const options = { [name]: enabled };
    browser.runtime.sendMessage({ name: "setOptions", ...options });
    document.dispatchEvent(new CustomEvent("onOptionsUpdate", { detail: JSON.stringify(options) }));
}

function bindToggleSettings(panel)
{
    for (const control of panel.querySelectorAll('input[role="switch"]'))
        control.addEventListener("change", () => saveToggleSetting(control.name, control.checked));
}

function updateSettingsAvailability(panel)
{
    panel.querySelector(".incognito-settings-notice").hidden = isInterceptionWorking;
    for (const control of panel.querySelectorAll("[data-needs-interception]"))
        control.disabled = !isInterceptionWorking;
}

function renderSettings(items, options, prefix = "incognito")
{
    const quick = prefix !== "incognito";
    return items.map(([id, name, label, description, needsInterception = true]) => `
        <label class="incognito-setting">
            <span class="incognito-setting-copy">
                <span id="${prefix}-${id}-label">${label}</span>
                ${quick ? "" : `<span id="${prefix}-${id}-note">${description}</span>`}
            </span>
            <input id='${prefix}-${id}' type='checkbox' ${options[name] === true ? "checked" : ""}
                ${quick ? "" : `aria-describedby='${prefix}-${id}-note'`} aria-labelledby="${prefix}-${id}-label"
                name="${name}" role="switch" ${needsInterception ? "data-needs-interception" : ""}>
        </label>`).join("");
}

function generateOptionsContent(options)
{
    const customAccent = typeof options.accentColor === "string" && accentColorPattern.test(options.accentColor);
    const accent = customAccent ? options.accentColor : defaultAccentColor;
    const activity = [
        ...quickActivitySettings,
        ["auto-receipt", "autoReceiptOnReplay", "Send read receipts on reply", "Automatically marks the chat as read when you reply."]
    ];
    const messages = [
        restoreDeletedMessagesSetting,
        ["show-device-type", "showDeviceTypes", "Show device of messages", "Shows whether new messages were sent from a phone or a computer."],
        ["status-downloading", "allowStatusDownload", "Allow status downloading", "Adds a download button to statuses."],
        ["extend-delete", "extendDeleteForEveryone", "Extend “Delete for everyone” to 3 days", "Applies to your messages. WhatsApp may reject the request, and recipients may still see the message.", false],
        ["keep-edits", "keepEditedMessages", "Keep edited messages", "Saves text and caption edits in this browser and adds an Edit history button.", false]
    ];
    return `
        <div class="incognito-settings-shell" dir="ltr">
            <header class="incognito-settings-header">
                <h1 id="incognito-settings-title">Incognito options</h1>
                <button class="incognito-settings-close" type="button" aria-label="Close settings" autofocus>×</button>
            </header>
            <div class="incognito-settings-layout">
                <nav class="incognito-settings-nav" aria-label="Settings sections">
                    <button type="button" aria-controls="incognito-privacy" aria-pressed="true">Privacy</button>
                    <button type="button" aria-controls="incognito-appearance" aria-pressed="false">Appearance</button>
                    <button type="button" aria-controls="incognito-misc" aria-pressed="false">Misc</button>
                    <button type="button" aria-controls="incognito-contacts" aria-pressed="false">Contacts</button>
                </nav>
                <section class="incognito-settings-pane" id="incognito-privacy" aria-labelledby="incognito-privacy-title">
                    <h2 id="incognito-privacy-title">Privacy</h2>
                    <p class="incognito-settings-notice" role="status" hidden>Some settings are unavailable until the extension connects to WhatsApp. If this persists, reload WhatsApp Web.</p>
                    <h3>Activity</h3>
                    ${renderSettings(activity, options)}
                    <h3>Messages and statuses</h3>
                    ${renderSettings(messages, options)}
                </section>
                <section class="incognito-settings-pane" id="incognito-appearance" aria-labelledby="incognito-appearance-title" hidden>
                    <h2 id="incognito-appearance-title">Appearance</h2>
                    <div class="incognito-appearance-card">
                        <div class="incognito-setting-copy">
                            <label for="incognito-accent-color">Accent color</label>
                            <span>Changes highlights, links, and selected filters.</span>
                        </div>
                        <div class="incognito-accent-actions">
                            <input id='incognito-accent-color' type='color' value='${accent}'>
                            <span id="incognito-accent-value">${customAccent ? accent.toUpperCase() : ""}</span>
                            <button id="incognito-reset-accent" type="button">Use default</button>
                        </div>
                        <div class="incognito-accent-preview" aria-label="Accent shades">
                            <div><span class="incognito-accent-soft"></span>Soft</div>
                            <div><span class="incognito-accent-base"></span>Accent</div>
                            <div><span class="incognito-accent-strong"></span>Strong</div>
                        </div>
                    </div>
                </section>
                <section class="incognito-settings-pane" id="incognito-misc" aria-labelledby="incognito-misc-title" hidden>
                    <h2 id="incognito-misc-title">Misc</h2>
                    ${renderSettings([["hide-meta-ai", "hideMetaAI", "Hide Meta AI", "Hides Meta AI buttons on the home screen and in the sidebar.", false]], options)}
                </section>
                <section class="incognito-settings-pane" id="incognito-contacts" aria-labelledby="incognito-contacts-title" hidden>
                    <h2 id="incognito-contacts-title">Contacts</h2>
                    <p class="incognito-contact-empty">Set contact privacy from a chat’s contact info.</p>
                    <ul class="incognito-contact-list"></ul>
                </section>
            </div>
        </div>`;
}

document.addEventListener('onMarkAsReadClick', function (e)
{
    var data = JSON.parse(e.detail);
    browser.runtime.sendMessage({ name: "getOptions" }, function (options)
    {
        if (options.readConfirmationsHook)
        {
            if (options.showReadWarning)
            {
                Swal.fire({
                    title: "Mark as read?",
                    text: data.unreadCount > 0
                        ? data.formattedName + " will be able to tell you read the last " +
                            (data.unreadCount > 1 ? data.unreadCount + " messages." : " message.")
                        : "This may send a read receipt to " + data.formattedName + ".",
                    input: 'checkbox',
                    inputValue: 0,
                    inputPlaceholder: "Don't show this warning again",
                    icon: "warning",
                    showCancelButton: true,
                    confirmButtonColor: "#DD6B55",
                    confirmButtonText: "Yes, send receipt",
                }).then(result =>
                {
                    if (result.isConfirmed)
                    {
                        document.dispatchEvent(new CustomEvent('sendReadConfirmation', { detail: JSON.stringify(data) }));
                        //swal("Sent!", "Messages were marked as read", "success");

                        var shouldShowReadWarning = result.value == 0;
                        browser.runtime.sendMessage({ name: "setOptions", showReadWarning: shouldShowReadWarning });
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
    if (menu?.quickOptions) updateSettingsAvailability(menu.quickOptions);
    if (menu?.dialog?.open) updateSettingsAvailability(menu.dialog);
});

function getTheme() 
{
    // light/dark mode detection
    if (localStorage["theme"] != "null" && localStorage["theme"] != undefined) 
        return localStorage["theme"]
    else 
    {
        // this is if there is no theme selected by default (null)
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches || 
            document.getElementsByClassName("web")[0].classList.contains("dark")) 
            return "\"dark\"";
        else 
            return "\"light\"";
    }
}

//
// Utils
//

async function generateSVGElement(svgImagePath, clazz="", title="", size=24, role="")
{
    var response = await fetch(svgImagePath);
    var text = await response.text();
    var viewBoxText = text.split('viewBox="')[1].split('"')[0];

    var menuItemElem = document.createElement("div");
    const tag = role === "button" ? "button" : "div";
    const attributes = tag === "button" ? 'type="button"' : `tabindex="0" title="${title}"`;
    menuItemElem.innerHTML = `<${tag} ${attributes} class="${clazz}" aria-label="${title}">\
                            <span><svg viewBox="${viewBoxText}" width="${size}" height="${size}"><path fill="currentColor" d="">\
                            </path></svg></span></${tag}><span></span>`;
    var svg = menuItemElem.getElementsByTagName("svg")[0];

    var dom = new DOMParser().parseFromString(text, 'text/html');
    var svgHtml = dom.getElementsByTagName("svg")[0].innerHTML;
    svg.innerHTML = svgHtml;

    return menuItemElem;
}

function onNewMessageNodeAdded(messageNode)
{
    if (keepEditedMessages) renderEditHistoryButton(messageNode);

    const wrapper = messageNode.closest("[data-id]");
    const dataID = wrapper?.getAttribute("data-id");
    const previousID = renderedMessages.get(messageNode);
    if (!dataID || previousID === dataID) return;

    const msgID = messageIdFromDataId(dataID);
    if (!msgID) return;
    if (previousID)
        (wrapper.firstElementChild || messageNode).querySelector(":scope > .device-type-image")?.remove();

    renderedMessages.set(messageNode, dataID);
    restoreViewOnceMessageIfNeeded(messageNode, msgID, dataID);
    restoreDeletedMessageIfNeeded(messageNode, msgID, dataID);
    markMessageNodeDeviceIfPossible(messageNode, msgID, dataID);
}

function messageIdFromDataId(dataID)
{
    return dataID?.includes("_") ? dataID.split("_")[2] : dataID;
}

function editHistoryMessageId(node)
{
    let id;
    const receive = event => { if (typeof event.detail === "string") id = event.detail; };
    document.addEventListener("onEditHistoryMessageId", receive);
    try
    {
        node.dispatchEvent(new CustomEvent("getEditHistoryMessageId", { bubbles: true }));
    }
    finally
    {
        document.removeEventListener("onEditHistoryMessageId", receive);
    }

    if (id) return id;
    const ownId = node.getAttribute("data-id");
    if (ownId) return ownId;
    const wrapper = node.closest("[data-id]");
    return wrapper?.querySelectorAll(messageSelector).length === 1 ? wrapper.getAttribute("data-id") : undefined;
}

function refreshEditHistoryButtons(id)
{
    if (!keepEditedMessages) return;
    for (const node of messagePanel?.querySelectorAll(messageSelector) ?? [])
        renderEditHistoryButton(node, id);
}

async function renderEditHistoryButton(node, requestedId)
{
    if (!node.isConnected || node.querySelector(messageSelector)) return;
    const id = editHistoryMessageId(node);
    const bubble = node.querySelector('[data-testid="msg-container"]');
    const existing = node.querySelector(".incognito-edit-history");
    if (id && bubble && existing?.dataset.messageId === id)
    {
        if (existing.parentElement !== bubble) bubble.appendChild(existing);
        return;
    }
    existing?.remove();
    if (!bubble || (requestedId && id !== requestedId)) return;
    if (!id || pendingEditHistory.get(node)?.id === id) return;

    const pending = { id };
    pendingEditHistory.set(node, pending);
    try
    {
        const db = await openMessageArchive("waIncognitoEditedMsgs");
        const request = db.transaction("msgs", "readonly").objectStore("msgs").getKey(id);
        request.onsuccess = () =>
        {
            if (pendingEditHistory.get(node) !== pending) return;
            pendingEditHistory.delete(node);
            if (!request.result || !keepEditedMessages || !node.isConnected || editHistoryMessageId(node) !== id) return;

            const currentBubble = node.querySelector('[data-testid="msg-container"]');
            if (!currentBubble) return;
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Edit history";
            button.setAttribute("aria-haspopup", "dialog");
            button.className = id.startsWith("true_")
                ? "incognito-edit-history incognito-edit-history-outgoing" : "incognito-edit-history";
            button.dataset.messageId = id;
            button.addEventListener("click", event =>
            {
                event.stopPropagation();
                if (keepEditedMessages && editHistoryMessageId(node) === id) showEditHistory(id);
            });
            currentBubble.appendChild(button);
        };
        request.onerror = () =>
        {
            if (pendingEditHistory.get(node) === pending) pendingEditHistory.delete(node);
            console.error("WAIncognito: Could not check edit history", request.error);
        };
    }
    catch (error)
    {
        if (pendingEditHistory.get(node) === pending) pendingEditHistory.delete(node);
        console.error("WAIncognito: Could not check edit history", error);
    }
}

async function showEditHistory(id)
{
    try
    {
        const db = await openMessageArchive("waIncognitoEditedMsgs");
        const request = db.transaction("msgs", "readonly").objectStore("msgs").get(id);
        request.onsuccess = () =>
        {
            if (!keepEditedMessages || !request.result?.edits.length) return;
            const list = document.createElement("ol");
            list.className = "incognito-edit-history-list";
            let last;
            for (const edit of request.result.edits)
            {
                for (const text of [edit.previous, edit.next])
                {
                    if (text === last) continue;
                    const item = document.createElement("li");
                    item.textContent = text || "(empty)";
                    list.appendChild(item);
                    last = text;
                }
            }
            let dialog = document.getElementById("incognito-edit-history-dialog");
            if (!dialog)
            {
                dialog = document.createElement("dialog");
                dialog.id = "incognito-edit-history-dialog";
                dialog.className = "incognito-settings incognito-edit-history-dialog";
                dialog.setAttribute("aria-labelledby", "incognito-edit-history-title");
                dialog.innerHTML = `
                    <div class="incognito-settings-shell">
                        <header class="incognito-settings-header">
                            <h1 id="incognito-edit-history-title">Edit history</h1>
                            <button class="incognito-settings-close" type="button" aria-label="Close edit history" autofocus>×</button>
                        </header>
                        <div class="incognito-settings-pane"></div>
                    </div>`;
                bindDialogDismissal(dialog);
                document.body.appendChild(dialog);
            }
            dialog.querySelector(".incognito-settings-pane").replaceChildren(list);
            if (!dialog.open) dialog.showModal();
        };
        request.onerror = () => console.error("WAIncognito: Could not load edit history", request.error);
    }
    catch (error)
    {
        console.error("WAIncognito: Could not open edit history", error);
    }
}

function isCurrentMessageNode(messageNode, dataID)
{
    return messageNode.isConnected && messageNode.closest("[data-id]")?.getAttribute("data-id") === dataID;
}

async function restoreViewOnceMessageIfNeeded(messageNode, msgID, dataID)
{
    try
    {
        const db = await openMessageArchive("viewOnce");
        if (!isCurrentMessageNode(messageNode, dataID)) return;
        const request = db.transaction("msgs", "readonly").objectStore("msgs").get(msgID);
        request.onsuccess = () =>
        {
            if (request.result && isCurrentMessageNode(messageNode, dataID))
                renderViewOnceMessage(messageNode, request.result);
        };
        request.onerror = () => console.error("WAIncognito: Could not read view-once archive", request.error);
    }
    catch (error)
    {
        console.error("WAIncognito: Could not open view-once archive", error);
    }
}

function renderViewOnceMessage(messageNode, value)
{
    var viewOnceExplanation = null;
    // find all div elements in the message node
    var aElements = messageNode.getElementsByTagName("a");
    // loop through
    for (var i = 0; i < aElements.length; i++)
    {
        if (aElements[i].classList?.contains("incognito-view-once-learn-more")) return;
        // if the innerHtml indicates it's the "Learn more" link
        if (aElements[i].innerHTML.includes("Learn more"))
        {
            // set the viewOnceExplanation to the parent div
            viewOnceExplanation = aElements[i].parentElement;
        }
    }
    if (!viewOnceExplanation) return;
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
    learnMore.innerHTML = "Sent as view once: Learn more";
    learnMore.addEventListener("click", function () {
        Swal.fire({
            title: "View-once message",
            html: 'This message was sent as a view-once. \
            <br><br> Note that the recipient\'s device will show this as unopened \
            <br><br> You can view this message multiple times and screenshot, and the recipient will not be notified. ',
            icon: "info",
            width: 600,
            confirmButtonColor: "#000",
            confirmButtonText: "Got it",
        });
    });
    viewOnceExplanation.appendChild(learnMore);
}

async function restoreDeletedMessageIfNeeded(messageNode, msgID, dataID)
{
    try
    {
        const db = await openMessageArchive("deletedMsgs");
        if (!isCurrentMessageNode(messageNode, dataID)) return;

        const transaction = db.transaction("msgs", "readonly");
        transaction.onabort = () => console.error("WAIncognito: Could not read deleted-message archive", transaction.error);
        const store = transaction.objectStore("msgs");
        const request = store.get(msgID);
        request.onsuccess = () =>
        {
            if (!isCurrentMessageNode(messageNode, dataID)) return;
            if (request.result)
            {
                renderDeletedMessage(messageNode, request.result);
                return;
            }

            const original = store.index("originalID_index").get(msgID);
            original.onsuccess = () =>
            {
                if (isCurrentMessageNode(messageNode, dataID))
                    renderDeletedMessage(messageNode, original.result);
            };
        };
    }
    catch (error)
    {
        console.error("WAIncognito: Could not open deleted-message archive", error);
    }
}

function renderDeletedMessage(messageNode, messageData)
{
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
        var bubbleElement = messageNode.querySelector(':scope > div, :scope [data-testid] > div');
        if (bubbleElement) bubbleElement.setAttribute("deleted-message", "true");     // mark the message in red

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
        var span = document.createElement("span");
        var textSpan = document.createElement("span");
        span.className = UIClassNames.DELETED_MESSAGE_SPAN;
        messageSubElement.textContent = "";
        textSpan.textContent = "Failed to restore message";
        messageSubElement.appendChild(textSpan);
        messageSubElement.appendChild(span);
        if (messageNode.parentNode)
            messageNode.parentNode.setAttribute("deleted-message", "true");     // mark the message in red
        return;
    }

    //
    // If we reached this point, it means that for some reason we couldn't just block the REVOKE message eariler
    // This might happen if other stuff were sent in the relevant packet (see onMessageNodeReceived)
    // So ideally, the following code should be redundant.
    //

    // Now try to synthesize the message from the DB (best effort)
    tryToSynthesizeMessage(messageSubElement, messageData);
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
        titleSpan.textContent = "Restored media: \n";
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

            titleSpan.textContent = "Restored contact card: \r\n";
            textSpan.textContent = "Name: " + name + "\n" + "Contact No.: ";

            messageSubElement.appendChild(titleSpan);
            textSpan.appendChild(aTagPhone);

        }
        else if (messageData.type === "location")
        {
            titleSpan.textContent = "Restored location: \n";
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
            titleSpan.textContent = "Restored message: \n";
            textSpan.textContent = messageData.body;
            messageSubElement.appendChild(titleSpan);
        }

    }
        
    messageSubElement.appendChild(textSpan);
}

async function markMessageNodeDeviceIfPossible(messageNode, msgID, dataID)
{
    if (messageNode.querySelector('[aria-label="You:"]')) return;

    let deviceType;
    function receiveDeviceType(event)
    {
        const data = JSON.parse(event.detail);
        if (data.messageID === msgID) deviceType = data.deviceType;
    }

    // The page replies before dispatchEvent returns.
    document.addEventListener("onDeviceTypeReceived", receiveDeviceType);
    try
    {
        document.dispatchEvent(new CustomEvent("getDeviceTypeForMessage", {detail: JSON.stringify({messageID: msgID})}));
    }
    finally
    {
        document.removeEventListener("onDeviceTypeReceived", receiveDeviceType);
    }

    if (deviceType !== "computer" && deviceType !== "phone") return;
    try
    {
        if (!deviceIconTemplates.has(deviceType))
        {
            const template = generateSVGElement(chrome.runtime.getURL("images/" + deviceType + ".svg"), "", "This message was sent from a " + deviceType, 19)
                .catch(error =>
                {
                    deviceIconTemplates.delete(deviceType);
                    throw error;
                });
            deviceIconTemplates.set(deviceType, template);
        }
        const template = await deviceIconTemplates.get(deviceType);
        if (!isCurrentMessageNode(messageNode, dataID)) return;

        const target = messageNode.closest("[data-id]").firstElementChild || messageNode;
        if (target.querySelector(".device-type-image")) return;
        const imageElement = template.cloneNode(true);
        imageElement.className = "device-type-image";

        const topMessageNode = target.parentElement?.parentElement?.parentElement;
        const avatar = topMessageNode?.previousElementSibling || topMessageNode;
        if (avatar?.querySelector('.chat-profile-picture, [data-testid="chat-profile-picture"], [aria-label="Open chat details"], [title="Open chat details"]'))
            imageElement.className += " below-profile-picture";

        target.insertBefore(imageElement, target.firstChild);
    }
    catch (error)
    {
        console.error("WAIncognito: Could not display message device", error);
    }
}

function checkInterception()
{
    if (!isInterceptionWorking)
    {
        if (menu?.dialog?.open || menu?.quickOptions?.matches(":popover-open")) return false;
        Swal.fire({
            title: "Oops...",
            html: "WhatsApp Web Incognito has detected that interception is not working. \
                   Please try refreshing this page, or, if the problem presists, writing back to the developer.",
            icon: "error",
            width: 600,
            confirmButtonColor: "#DD6B55",
            confirmButtonText: "OK",
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
        
        
        UIClassNames.UNREAD_COUNTER_CLASS = "xyp3urf"; // the span class that sets background-color to var(--unread-marker-background)
        
        UIClassNames.CHAT_PANEL_CLASS = "x14yy4lh"; // the outermost chat panel class
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

function isNumberKey(evt)
{
    var charCode = (evt.which) ? evt.which : event.keyCode
    if (charCode > 31 && (charCode < 48 || charCode > 57))
        return false;
    return true;
}
