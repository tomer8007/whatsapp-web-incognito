/*
This is a content script responsible for WAIncognito's in-page UI and Privacy Screen Lock.
*/

// Global variables (keep var at column 0 per A2/A11 bundle rules)
var isInterceptionWorking = false;
var isUIClassesWorking = true;
var pseudoMsgsIDs = new Set();
var isMainUIInitialized = false;
var privacyScreenLockEnabled = false;
var privacyScreenLockPIN = "";
var privacyScreenLockIdleMinutes = 5;
var isPrivacyScreenLocked = false;
var privacyListenersAttached = false;
var waiPrivacyLock = null; // PrivacyIdleLock (shared/privacy_lock.js), set by initializeUI
var waiCurrentOptions = null;
var waiLastOnlineUpdatesHook = null;
var waiModalController = null;
var waiModalBackdrop = null;
var waiPreviousFocusEl = null;
var waiPendingDeletedMsgs = new Map();
var waiPendingDeviceTypes = new Map();
var svgCache = {};
var cachedViewOnceDB = null;

if (typeof chrome !== "undefined" && typeof browser === "undefined")
{
    var browser = chrome;
}

initializeUI();

function getDefaultOptionsMap()
{
    if (typeof WAISettingsSchema !== "undefined" && typeof WAISettingsSchema.defaults === "function")
    {
        return WAISettingsSchema.defaults("shared");
    }
    return {};
}

function sendExtMessage(payload, callback)
{
    var runtime = (typeof browser !== "undefined" && browser && browser.runtime) ? browser.runtime : (typeof chrome !== "undefined" && chrome ? chrome.runtime : null);
    if (!runtime || typeof runtime.sendMessage !== "function")
    {
        if (callback) callback(null, new Error("runtime.sendMessage unavailable"));
        return;
    }

    var settled = false;
    function done(res, err)
    {
        if (settled) return;
        settled = true;
        if (callback) callback(res, err || null);
    }

    try
    {
        var maybePromise = runtime.sendMessage(payload, function (res)
        {
            var err = runtime.lastError ? new Error(runtime.lastError.message || String(runtime.lastError)) : null;
            done(res, err);
        });
        if (maybePromise && typeof maybePromise.then === "function")
        {
            maybePromise.then(
                function (res) { done(res, null); },
                function (err) { done(null, err || new Error("sendMessage rejected")); }
            );
        }
    }
    catch (err)
    {
        try
        {
            Promise.resolve(runtime.sendMessage(payload)).then(
                function (res) { done(res, null); },
                function (err2) { done(null, err2); }
            );
        }
        catch (err3)
        {
            done(null, err3);
        }
    }
}

function dispatchOptionsUpdate(patch)
{
    document.dispatchEvent(new CustomEvent('onOptionsUpdate', {
        detail: JSON.stringify(patch || {})
    }));
}

function applyOptionSideEffects(prevOpts, nextOpts, patch)
{
    if (!nextOpts || typeof nextOpts !== "object") return;
    var p = patch && typeof patch === "object" ? patch : nextOpts;

    if ("readConfirmationsHook" in p && !nextOpts.readConfirmationsHook)
    {
        var redChats = document.getElementsByClassName("icon-meta unread-count incognito");
        for (var i = 0; i < redChats.length; i++)
        {
            redChats[i].className = 'icon-meta unread-count';
        }
    }

    if ("onlineUpdatesHook" in p && waiLastOnlineUpdatesHook !== null && nextOpts.onlineUpdatesHook !== waiLastOnlineUpdatesHook)
    {
        WAIPageBus.sendToPage('presence:set', {
            status: nextOpts.onlineUpdatesHook ? 'unavailable' : 'available'
        });
    }
    if (typeof nextOpts.onlineUpdatesHook === "boolean")
    {
        waiLastOnlineUpdatesHook = nextOpts.onlineUpdatesHook;
    }

    syncPrivacyScreenLockFromOptions(nextOpts);
}

function syncPrivacyScreenLockFromOptions(opts)
{
    if (!opts || typeof opts !== "object") return;
    var enabledChanged = "privacyScreenLockEnabled" in opts;
    var idleChanged = "privacyScreenLockIdleMinutes" in opts;

    if ("privacyScreenLockPIN" in opts)
    {
        privacyScreenLockPIN = opts.privacyScreenLockPIN || "";
    }
    if (idleChanged)
    {
        privacyScreenLockIdleMinutes = opts.privacyScreenLockIdleMinutes || 5;
    }
    if (enabledChanged)
    {
        privacyScreenLockEnabled = Boolean(opts.privacyScreenLockEnabled);
    }

    if (privacyScreenLockEnabled)
    {
        setupPrivacyScreenActivityListeners();
        if (enabledChanged || idleChanged)
        {
            waiPrivacyLock.arm();
        }
    }
    else if (enabledChanged)
    {
        waiPrivacyLock.disarm();
        removePrivacyScreenActivityListeners();
        unlockPrivacyScreen();
    }
}

function mergeIntoCurrentOptions(patch)
{
    if (!waiCurrentOptions) waiCurrentOptions = getDefaultOptionsMap();
    if (!patch || typeof patch !== "object") return waiCurrentOptions;

    var prev = Object.assign({}, waiCurrentOptions);
    if (typeof WAISettingsSchema !== "undefined" && typeof WAISettingsSchema.validatePatch === "function")
    {
        var validated = WAISettingsSchema.validatePatch(patch, prev, "shared");
        waiCurrentOptions = validated.prefs;
    }
    else
    {
        waiCurrentOptions = Object.assign({}, prev, patch);
    }
    return waiCurrentOptions;
}

function handleMarkAsReadClick(data)
{
    if (!data || typeof data !== "object") return;
    sendExtMessage({ name: "getOptions" }, function (options)
    {
        if (options && options.readConfirmationsHook)
        {
            if (options.showReadWarning)
            {
                Swal.fire({
                    title: "Mark as read?",
                    text: (data.formattedName || data.name || "This contact") + " will be able to tell you read the last " +
                          (data.unreadCount > 1 ? data.unreadCount + " messages." : " message."),
                    input: 'checkbox',
                    inputValue: 0,
                    inputPlaceholder: "Don't show this warning again",
                    icon: "warning",
                    showCancelButton: true,
                    confirmButtonColor: "#DD6B55",
                    confirmButtonText: "Yes, send receipt",
                }).then(function (result)
                {
                    if (result.isConfirmed)
                    {
                        WAIPageBus.sendToPage('receipt:send', data);

                        var shouldShowReadWarning = result.value == 0;
                        sendExtMessage({ name: "setOptions", showReadWarning: shouldShowReadWarning });
                        dispatchOptionsUpdate({ showReadWarning: shouldShowReadWarning });
                    }
                });
            }
            else
            {
                WAIPageBus.sendToPage('receipt:send', data);
            }
        }
    });
}

function initializeUI()
{
    waiCurrentOptions = getDefaultOptionsMap();

    waiPrivacyLock = new WAIPrivacyLock.PrivacyIdleLock({
        onLock: lockPrivacyScreen,
        isLocked: function () { return isPrivacyScreenLocked; },
        isEnabled: function () { return privacyScreenLockEnabled; },
        getIdleMinutes: function () { return privacyScreenLockIdleMinutes; }
    });

    // Single startup handshake for options, whitelist, and ephemeral notes
    sendExtMessage({ name: "getInitialState" }, function (initialState)
    {
        if (initialState && initialState.options)
        {
            var merged = mergeIntoCurrentOptions(initialState.options);
            waiLastOnlineUpdatesHook = Boolean(merged.onlineUpdatesHook);
            dispatchOptionsUpdate(merged);
            syncPrivacyScreenLockFromOptions(merged);

            if (initialState.contactWhitelistRules)
            {
                document.dispatchEvent(new CustomEvent('onContactWhitelistUpdate', {
                    detail: JSON.stringify(initialState.contactWhitelistRules)
                }));
            }
            return;
        }

        // Compatibility fallback if host does not implement getInitialState
        sendExtMessage({ name: "getOptions" }, function (options)
        {
            var merged = mergeIntoCurrentOptions(options);
            waiLastOnlineUpdatesHook = Boolean(merged.onlineUpdatesHook);
            dispatchOptionsUpdate(merged);
            syncPrivacyScreenLockFromOptions(merged);
        });
        sendExtMessage({ name: "getContactWhitelist" }, function (rules)
        {
            if (rules)
            {
                document.dispatchEvent(new CustomEvent('onContactWhitelistUpdate', { detail: JSON.stringify(rules) }));
            }
        });
    });

    // Listen for live updates pushed from extension popup or background
    var runtime = (typeof browser !== "undefined" && browser && browser.runtime) ? browser.runtime : (typeof chrome !== "undefined" && chrome ? chrome.runtime : null);
    if (runtime && runtime.onMessage && typeof runtime.onMessage.addListener === "function")
    {
        runtime.onMessage.addListener(function (msg)
        {
            if (!msg || typeof msg !== "object") return;
            if (msg.name === "wai:optionsUpdated" && msg.options)
            {
                var prev = Object.assign({}, waiCurrentOptions);
                var next = mergeIntoCurrentOptions(msg.options);
                var patch = msg.patch && typeof msg.patch === "object" ? msg.patch : msg.options;
                applyOptionSideEffects(prev, next, patch);
                dispatchOptionsUpdate(patch);
                if (waiModalController)
                {
                    waiModalController.update(next);
                }
            }
            else if (msg.name === "wai:whitelistUpdated" && msg.rules)
            {
                document.dispatchEvent(new CustomEvent('onContactWhitelistUpdate', {
                    detail: JSON.stringify(msg.rules)
                }));
            }
        });
    }

    // Listen for options changes originating outside this panel (e.g. Electron tray/menu via shim)
    document.addEventListener('onOptionsUpdate', function (e)
    {
        try
        {
            var patch = JSON.parse(e.detail);
            if (!patch || typeof patch !== "object") return;
            var prev = Object.assign({}, waiCurrentOptions);
            var next = mergeIntoCurrentOptions(patch);
            applyOptionSideEffects(prev, next, patch);
            if (waiModalController)
            {
                waiModalController.update(next);
            }
        }
        catch (err) {}
    });

    WAIPageBus.onHostMessage('receipt:markAsReadClick', handleMarkAsReadClick);

    WAIPageBus.onHostMessage('deletedMsg:pseudoAdded', function (data)
    {
        if (data && data.id) pseudoMsgsIDs.add(data.id);
    });

    WAIPageBus.onHostMessage('deletedMsg:result', function (data)
    {
        var msgID = data && data.messageID;
        if (!msgID || !waiPendingDeletedMsgs.has(msgID)) return;
        var entries = waiPendingDeletedMsgs.get(msgID);
        waiPendingDeletedMsgs.delete(msgID);
        for (var i = 0; i < entries.length; i++)
        {
            clearTimeout(entries[i].timer);
            try { entries[i].callback(data.messageData); } catch (err) {}
        }
    });

    WAIPageBus.onHostMessage('deviceType:result', function (data)
    {
        var msgID = data && data.messageID;
        if (!msgID || !waiPendingDeviceTypes.has(msgID)) return;
        var entries = waiPendingDeviceTypes.get(msgID);
        waiPendingDeviceTypes.delete(msgID);
        for (var i = 0; i < entries.length; i++)
        {
            clearTimeout(entries[i].timer);
            try { entries[i].callback(data.deviceType); } catch (err) {}
        }
    });

    // Global shortcut Alt+Shift+I toggles the unified settings modal; Escape closes it.
    document.addEventListener('keydown', function (e)
    {
        if (e.key === "Escape" && isOptionsModalOpen())
        {
            closeIncognitoOptionsModal();
            return;
        }
        if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === "i" || e.key === "I"))
        {
            e.preventDefault();
            if (isOptionsModalOpen()) closeIncognitoOptionsModal();
            else openIncognitoOptions();
        }
    });

    // Initialize shared body mutation observer
    if (document.getElementsByClassName("two").length > 0)
    {
        isMainUIInitialized = true;
        addIconIfNeeded();
        setTimeout(function () { onMainUIReady(); }, 100);
    }

    WAIPageBus.DOMObserver.subscribe(onMutationsObserved);
}

function isMessageNode(node)
{
    var firstChild = node.firstElementChild || node.childNodes[0];
    if (firstChild && firstChild.getAttribute)
    {
        var testId = firstChild.getAttribute("data-testid");
        if (testId) return testId.startsWith("conv-msg");
    }
    return false;
}

function onMutationsObserved(mutations)
{
    var found = false;
    for (var i = 0; i < mutations.length; i++)
    {
        var mutation = mutations[i];
        if (mutation.type !== "childList") continue;
        var addedNodes = mutation.addedNodes;

        // Scan for added nodes
        for (var j = 0; j < addedNodes.length; j++)
        {
            var addedNode = addedNodes[j];
            if (addedNode.nodeType !== 1) continue;

            if (!isMainUIInitialized && (addedNode.classList.contains("two") || (addedNode.firstElementChild && addedNode.getElementsByClassName("two").length > 0)))
            {
                // main app was added, UI is ready
                isMainUIInitialized = true;
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
                    WAIPageBus.sendToPage('ui:dropdownOpened', {});
                }, 200);
            }

            // Scan for added message nodes and modify if needed
            if (isMessageNode(addedNode))
            {
                onNewMessageNodeAdded(addedNode);
            }
            if (addedNode.nodeName === "HEADER" || (addedNode.firstElementChild && addedNode.querySelector && addedNode.querySelector("header")))
            {
                WAIPageBus.sendToPage('ui:paneChatOpened', {});
            }
            if (addedNode.firstElementChild && addedNode.querySelectorAll)
            {
                var subMsgNodes = addedNode.querySelectorAll('[data-testid^="conv-msg"]');
                for (var k = 0; k < subMsgNodes.length; k++)
                {
                    onNewMessageNodeAdded(subMsgNodes[k]);
                }
            }
        }

        if (found) break;
    }

    // Remove the menu item when the app unmounts
    if (isMainUIInitialized && document.getElementsByClassName("two").length === 0)
    {
        isMainUIInitialized = false;
        var menuItem = document.getElementsByClassName("menu-item-incognito")[0];
        var fallbackTrigger = document.getElementById("wai-fallback-trigger");
        if (menuItem != undefined) menuItem.remove();
        if (fallbackTrigger != undefined) fallbackTrigger.remove();
        closeIncognitoOptionsModal();
    }
}

function onMainUIReady()
{
    WAIPageBus.sendToPage('ui:mainReady', {});

    setTimeout(checkInterception, 1000);

    // Retry adding the icon shortly after layout stabilizes (e.g. RTL adjustments)
    setTimeout(addIconIfNeeded, 1000);

    syncPrivacyScreenLockFromOptions(waiCurrentOptions);
}

function lockPrivacyScreen()
{
    if (isPrivacyScreenLocked || !privacyScreenLockEnabled) return;
    isPrivacyScreenLocked = true;

    // Blur main app
    var app = document.getElementById("app");
    if (app) app.classList.add("privacy-locked-app");

    // Create overlay
    var overlay = document.createElement("div");
    overlay.id = "incognito-privacy-lock-overlay";
    overlay.className = "privacy-blur-overlay";

    var container = document.createElement("div");
    container.className = "privacy-lock-container";

    var title = document.createElement("div");
    title.className = "privacy-lock-title";
    title.textContent = "WhatsApp is Locked";

    var input = document.createElement("input");
    input.type = "password";
    input.className = "privacy-pin-input";
    input.maxLength = 4;
    input.placeholder = "****";

    var errorLabel = document.createElement("div");
    errorLabel.className = "privacy-pin-error";
    errorLabel.id = "incognito-privacy-unlock-error";

    container.appendChild(title);
    container.appendChild(input);
    container.appendChild(errorLabel);
    overlay.appendChild(container);

    document.body.appendChild(overlay);

    setTimeout(function ()
    {
        input.focus();
    }, 100);

    input.addEventListener("input", async function (e)
    {
        var val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val;

        if (val.length === 4)
        {
            var hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(val));
            var hashArray = Array.from(new Uint8Array(hashBuffer));
            var hashHex = hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');

            if (hashHex === privacyScreenLockPIN || !privacyScreenLockPIN)
            {
                unlockPrivacyScreen();
            }
            else
            {
                errorLabel.textContent = "Incorrect PIN";
                e.target.value = "";
                setTimeout(function () { errorLabel.textContent = ""; }, 2000);
            }
        }
    });
}

function unlockPrivacyScreen()
{
    isPrivacyScreenLocked = false;
    var overlay = document.getElementById("incognito-privacy-lock-overlay");
    if (overlay) overlay.remove();
    var app = document.getElementById("app");
    if (app) app.classList.remove("privacy-locked-app");
    waiPrivacyLock.arm();
}

function handlePrivacyScreenActivity(e)
{
    if (e.type === "keydown" && e.altKey && (e.key === "l" || e.key === "L"))
    {
        lockPrivacyScreen();
        return;
    }
    waiPrivacyLock.arm();
}

function setupPrivacyScreenActivityListeners()
{
    if (privacyListenersAttached) return;
    privacyListenersAttached = true;
    window.addEventListener("mousemove", handlePrivacyScreenActivity);
    window.addEventListener("keydown", handlePrivacyScreenActivity);
    window.addEventListener("click", handlePrivacyScreenActivity);
    window.addEventListener("scroll", handlePrivacyScreenActivity);
}

function removePrivacyScreenActivityListeners()
{
    if (!privacyListenersAttached) return;
    privacyListenersAttached = false;
    window.removeEventListener("mousemove", handlePrivacyScreenActivity);
    window.removeEventListener("keydown", handlePrivacyScreenActivity);
    window.removeEventListener("click", handlePrivacyScreenActivity);
    window.removeEventListener("scroll", handlePrivacyScreenActivity);
}

async function ensureFallbackTrigger()
{
    if (document.getElementById("wai-fallback-trigger")) return;
    if (!document.body) return;

    var btn = document.createElement("button");
    btn.id = "wai-fallback-trigger";
    btn.type = "button";
    btn.title = "WAIncognito Settings (Alt+Shift+I)";
    btn.setAttribute("aria-label", "WAIncognito Settings");

    try
    {
        var iconUrl = chrome.runtime.getURL("images/incognito_gray_24_hollow_9.svg");
        var iconWrap = await generateSVGElement(iconUrl, "", "Incognito", 20, "");
        if (!document.body || document.getElementById("wai-fallback-trigger")) return;
        var svg = iconWrap.querySelector("svg");
        if (svg) btn.appendChild(svg);
    }
    catch (err) {}

    btn.addEventListener("click", function ()
    {
        if (isOptionsModalOpen()) closeIncognitoOptionsModal();
        else openIncognitoOptions();
    });

    document.body.appendChild(btn);
}

async function addIconIfNeeded()
{
    if (document.getElementsByClassName("menu-item-incognito").length > 0) return;

    var firstMenuItem = document.getElementsByClassName(UIClassNames.MENU_ITEM_CLASS)[0];
    if (firstMenuItem != undefined)
    {
        isUIClassesWorking = true;
        var fallbackTrigger = document.getElementById("wai-fallback-trigger");
        if (fallbackTrigger) fallbackTrigger.remove();

        var menuItemElem = await generateSVGElement(
            chrome.runtime.getURL("images/incognito_gray_24_hollow_9.svg"),
            UIClassNames.MENU_ITEM_INNER_CLASS,
            "Incognito Options (Alt+Shift+I)",
            24,
            "button"
        );
        if (document.getElementsByClassName("menu-item-incognito").length > 0) return;
        menuItemElem.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");
        firstMenuItem.parentElement.insertBefore(menuItemElem, firstMenuItem);

        menuItemElem.addEventListener("click", function ()
        {
            if (isOptionsModalOpen()) closeIncognitoOptionsModal();
            else openIncognitoOptions();
        });
    }
    else
    {
        if (isUIClassesWorking)
        {
            isUIClassesWorking = false;
            console.warn("WhatsIncognito: menu anchor class not found; using fallback settings trigger (Alt+Shift+I).");
        }
        ensureFallbackTrigger();
    }
}

//
// Unified In-Page Settings Modal (powered by shared/settings_renderer.js)
//

function setToolbarButtonActive(active)
{
    var menuItem = document.getElementsByClassName("menu-item-incognito")[0];
    if (!menuItem) return;
    if (active)
    {
        menuItem.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " " + UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS + " active menu-item-incognito");
    }
    else
    {
        menuItem.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");
    }
}

function isOptionsModalOpen()
{
    return Boolean(waiModalBackdrop && waiModalBackdrop.parentNode);
}

function closeIncognitoOptionsModal()
{
    if (waiModalController)
    {
        waiModalController.destroy();
        waiModalController = null;
    }
    if (waiModalBackdrop)
    {
        if (waiModalBackdrop.parentNode) waiModalBackdrop.parentNode.removeChild(waiModalBackdrop);
        waiModalBackdrop = null;
    }
    setToolbarButtonActive(false);
    if (waiPreviousFocusEl && typeof waiPreviousFocusEl.focus === "function" && document.contains(waiPreviousFocusEl))
    {
        try { waiPreviousFocusEl.focus(); } catch (e) {}
    }
    waiPreviousFocusEl = null;
}

function handleModalSettingChange(patch)
{
    var prev = Object.assign({}, waiCurrentOptions);
    var next = mergeIntoCurrentOptions(patch);
    applyOptionSideEffects(prev, next, patch);
    sendExtMessage(Object.assign({ name: "setOptions" }, patch));
    dispatchOptionsUpdate(patch);
}

function handleModalReset()
{
    sendExtMessage({ name: "resetOptions" }, function (resetPrefs)
    {
        var prev = Object.assign({}, waiCurrentOptions);
        var next = mergeIntoCurrentOptions(resetPrefs || getDefaultOptionsMap());
        applyOptionSideEffects(prev, next, next);
        dispatchOptionsUpdate(next);
        if (waiModalController)
        {
            waiModalController.update(next);
        }
    });
}

/**
 * Open the unified settings modal without clicking its icon.
 * Returns whether the modal is open afterwards.
 */
function openIncognitoOptions(modalOpts)
{
    if (typeof WAISettingsRenderer === "undefined" || typeof WAISettingsRenderer.mount !== "function")
    {
        return false;
    }
    var mountParent = document.body || document.documentElement;
    if (!mountParent) return false;

    var focusTarget = modalOpts && typeof modalOpts === "object" ? modalOpts.focus : null;

    if (isOptionsModalOpen())
    {
        if (focusTarget && waiModalController)
        {
            waiModalController.focusKey(focusTarget);
        }
        return true;
    }

    waiPreviousFocusEl = document.activeElement;

    var backdrop = document.createElement("div");
    backdrop.id = "wai-settings-backdrop";

    var dialog = document.createElement("div");
    dialog.id = "wai-settings-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Incognito Options");

    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", function (e)
    {
        if (e.target === backdrop) closeIncognitoOptionsModal();
    });

    mountParent.appendChild(backdrop);
    waiModalBackdrop = backdrop;

    var statusBanner = null;
    if (isMainUIInitialized && !isInterceptionWorking)
    {
        statusBanner = {
            text: "Interception probe has not seen socket traffic yet.",
            tone: "warn"
        };
    }

    waiModalController = WAISettingsRenderer.mount(dialog, {
        prefs: waiCurrentOptions || getDefaultOptionsMap(),
        scope: "shared",
        title: "Incognito Options",
        status: statusBanner,
        focusKey: focusTarget || null,
        onChange: handleModalSettingChange,
        onReset: handleModalReset,
        onClose: closeIncognitoOptionsModal
    });

    setToolbarButtonActive(true);

    // Refresh synchronously (Electron) or asynchronously (extension) in case storage changed
    sendExtMessage({ name: "getOptions" }, function (fresh)
    {
        if (!fresh || typeof fresh !== "object") return;
        var merged = mergeIntoCurrentOptions(fresh);
        if (waiModalController)
        {
            waiModalController.update(merged);
        }
    });

    return true;
}

// The shim asks for the panel by dispatching this and reading the result straight after.
document.addEventListener('onOpenIncognitoOptions', function (e)
{
    var parsedOpts = null;
    if (e && e.detail)
    {
        try
        {
            parsedOpts = typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail;
        }
        catch (err)
        {
            parsedOpts = null;
        }
    }
    window.__WAI_PANEL_OPEN_RESULT__ = openIncognitoOptions(parsedOpts);
});

document.addEventListener('onInterceptionWorking', function (e)
{
    var data = JSON.parse(e.detail);
    isInterceptionWorking = data.isInterceptionWorking;
    if (isInterceptionWorking && waiModalController)
    {
        waiModalController.setStatus(null);
    }

    var deletedDBOpenRequest = indexedDB.open("deletedMsgs");
    deletedDBOpenRequest.onsuccess = function ()
    {
        var deletedMsgsDB = deletedDBOpenRequest.result;
        var keys = deletedMsgsDB.transaction('msgs', "readonly").objectStore("msgs").getAll();
        keys.onsuccess = function ()
        {
            keys.result.forEach(function (value)
            {
                pseudoMsgsIDs.add(value.originalID);
            });
        };
        deletedMsgsDB.close();
    };
    deletedDBOpenRequest.onerror = function ()
    {
        console.log("WhatsIncognito: could not read the deleted messages database; " +
                    "restoring will be unavailable until it is created");
    };
});

//
// Utils
//

async function generateSVGElement(svgImagePath, clazz="", title="", size=24, role="")
{
    var cached = svgCache[svgImagePath];
    if (!cached)
    {
        var response = await fetch(svgImagePath);
        var text = await response.text();
        var viewBoxMatch = text.match(/viewBox="([^"]+)"/);
        var viewBoxText = viewBoxMatch ? viewBoxMatch[1] : "0 0 24 24";
        var dom = new DOMParser().parseFromString(text, 'text/html');
        var svgHtml = dom.getElementsByTagName("svg")[0]?.innerHTML || "";
        cached = svgCache[svgImagePath] = { viewBoxText: viewBoxText, svgHtml: svgHtml };
    }

    var menuItemElem = document.createElement("div");

    menuItemElem.innerHTML = `<div aria-disabled="false" role="${role}" tabindex="0" class="${clazz}" title="${title}" \
                            aria-label="${title}"><span data-testid="menu" data-icon="menu" class=""><svg viewBox="${cached.viewBoxText}" \
                            width="${size}" height="${size}" class=""><path fill="currentColor" d=""></path></svg></span></div><span></span>`;
    var svg = menuItemElem.getElementsByTagName("svg")[0];
    svg.innerHTML = cached.svgHtml;

    return menuItemElem;
}

function onNewMessageNodeAdded(messageNode)
{
    var data_id = messageNode.getAttribute("data-id");
    if (!data_id && messageNode.parentElement && messageNode.parentElement.parentElement && messageNode.parentElement.parentElement.parentElement)
        data_id = messageNode.parentElement.parentElement.parentElement.getAttribute("data-id");
    if (data_id == null) return;

    var msgID = data_id.includes("_") ? data_id.split("_")[2] : data_id;

    restoreViewOnceMessageIfNeeded(messageNode, msgID);
    restoreDeletedMessageIfNeeded(messageNode, msgID);
    markMessageNodeDeviceIfPossible(messageNode, msgID);
}

function getViewOnceDB(callback)
{
    if (cachedViewOnceDB)
    {
        callback(cachedViewOnceDB);
        return;
    }
    var viewOnceDBOpenRequest = window.indexedDB.open("viewOnce", 2);
    viewOnceDBOpenRequest.onupgradeneeded = function (event)
    {
        var db = event.target.result;
        var store = db.createObjectStore('msgs', { keyPath: 'id' });
        console.log('WhatsIncognito: Created viewOnce database.');
        store.createIndex("id_index", "id");
    };

    viewOnceDBOpenRequest.onsuccess = function ()
    {
        cachedViewOnceDB = viewOnceDBOpenRequest.result;
        cachedViewOnceDB.onclose = function () { cachedViewOnceDB = null; };
        callback(cachedViewOnceDB);
    };
    viewOnceDBOpenRequest.onerror = function () {};
}

function restoreViewOnceMessageIfNeeded(messageNode, msgID)
{
    getViewOnceDB(function (viewOnceDB)
    {
        try
        {
            var tx = viewOnceDB.transaction('msgs', "readonly");
            var req = tx.objectStore("msgs").get(msgID);
            req.onsuccess = function ()
            {
                var value = req.result;
                if (!value) return;

                var viewOnceExplanation = null;
                var aElements = messageNode.getElementsByTagName("a");
                for (var i = 0; i < aElements.length; i++)
                {
                    if (aElements[i].innerHTML.includes("Learn more"))
                    {
                        viewOnceExplanation = aElements[i].parentElement;
                    }
                }
                if (!viewOnceExplanation) return;
                viewOnceExplanation.innerHTML = "";
                if (value.dataURI.startsWith("data:image"))
                {
                    var img = document.createElement("img");
                    img.src = value.dataURI;
                    img.style.cssText = "width: 100%;";
                    viewOnceExplanation.appendChild(img);
                }
                else if (value.dataURI.startsWith("data:video"))
                {
                    var video = document.createElement("video");
                    video.controls = true;
                    video.src = value.dataURI;
                    viewOnceExplanation.appendChild(video);
                }
                else if (value.dataURI.startsWith("data:audio"))
                {
                    var audio = document.createElement("audio");
                    audio.controls = true;
                    audio.src = value.dataURI;
                    viewOnceExplanation.appendChild(audio);
                }

                if (value.caption != null)
                {
                    var textSpan = document.createElement("span");
                    var textSpanStyle = "font-style: normal; color: rgba(241, 241, 242, 0.95); margin-top: 10px; margin-bottom: 10px;";
                    textSpan.style.cssText = textSpanStyle;
                    textSpan.className = "copyable-text selectable-text";
                    textSpan.textContent = value.caption;
                    viewOnceExplanation.appendChild(textSpan);
                }

                var learnMore = document.createElement("a");
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
            };
        }
        catch (e) {}
    });
}

// One-shot callback scheduled to fire (or be dropped) after a timeout, tracked in
// a shared per-key map so callers deduplicate by key and the entry is removed on fire.
function createPendingEntry(map, key, callback, timeoutMs)
{
    var entry = { callback: callback, timer: null };
    entry.timer = setTimeout(function ()
    {
        var list = map.get(key);
        if (!list) return;
        var next = list.filter(function (item) { return item !== entry; });
        if (next.length > 0) map.set(key, next);
        else map.delete(key);
    }, timeoutMs);

    var existing = map.get(key);
    if (existing) existing.push(entry);
    else map.set(key, [entry]);
    return entry;
}

function restoreDeletedMessageIfNeeded(messageNode, msgID)
{
    if (!msgID) return;

    function onDeletedMessageReceived(messageData)
    {
        var span = document.createElement("span");
        var textSpan = document.createElement("span");
        span.className = UIClassNames.DELETED_MESSAGE_SPAN;

        var didFindInDeletedMessagesDB = messageData != undefined;
        var shouldTryToSyntehesizeMessage = messageNode.textContent.includes("message was deleted");

        if (!didFindInDeletedMessagesDB && !shouldTryToSyntehesizeMessage)
        {
            return;
        }

        if (didFindInDeletedMessagesDB)
        {
            var bubbleElement = messageNode.querySelector(':scope [data-testid] > div');
            if (bubbleElement) bubbleElement.setAttribute("deleted-message", "true");

            if (!shouldTryToSyntehesizeMessage)
            {
                return;
            }
        }

        var messageSubElement = messageNode.getElementsByClassName(UIClassNames.CHAT_MESSAGE_INNER_TEXT_DIV)[0];
        if (!messageSubElement) return;

        if (!didFindInDeletedMessagesDB && shouldTryToSyntehesizeMessage)
        {
            messageSubElement.textContent = "";
            textSpan.textContent = "Failed to restore message";
            messageSubElement.appendChild(textSpan);
            messageSubElement.appendChild(span);
            if (messageNode.parentNode)
                messageNode.parentNode.setAttribute("deleted-message", "true");
            return;
        }

        tryToSynthesizeMessage(messageSubElement, messageData);
    }

    createPendingEntry(waiPendingDeletedMsgs, msgID, onDeletedMessageReceived, 10000);

    WAIPageBus.sendToPage('deletedMsg:lookup', { messageID: msgID });
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
        messageSubElement.appendChild(titleSpan);

        if (messageData.mediaText) textSpan.textContent = "\n" + messageData.mediaText;
        if (messageData.type === "image")
        {
            var imgTag = document.createElement("img");
            imgTag.style.cssText = "width: 100%;";
            imgTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(imgTag);
        }
        else if (messageData.type === "sticker")
        {
            var stickerTag = document.createElement("img");
            stickerTag.className = UIClassNames.STICKER_MESSAGE_TAG;
            stickerTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(stickerTag);
        }
        else if (messageData.type === "video")
        {
            var vidTag = document.createElement("video");
            vidTag.controls = true;
            vidTag.style.cssText = "width: 100%;";
            var vidSourceTag = document.createElement("source");
            vidSourceTag.type = messageData.mimetype;
            vidSourceTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            vidTag.appendChild(vidSourceTag);
            messageSubElement.appendChild(vidTag);
        }
        else if (messageData.type === "document")
        {
            var aTag = document.createElement("a");
            aTag.download = messageData.fileName;
            aTag.href = "data:" + messageData.mimetype + ";base64," + messageData.body;
            aTag.textContent = "Download \"" + messageData.fileName + "\"";
            messageSubElement.appendChild(aTag);
        }
        else if (messageData.type === "ptt")
        {
            var audioTag = document.createElement("audio");
            audioTag.controls = true;
            var audioSourceTag = document.createElement("source");
            audioSourceTag.type = messageData.mimetype;
            audioSourceTag.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            audioTag.appendChild(audioSourceTag);
            messageSubElement.appendChild(audioTag);
        }
    }
    else
    {
        if (messageData.type === "vcard")
        {
            var vcardBody = messageData.body.split(":");
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
            var locImg = document.createElement("img");
            locImg.style.cssText = "width: 100%;";
            locImg.src = "data:" + messageData.mimetype + ";base64," + messageData.body;
            messageSubElement.appendChild(locImg);

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

function markMessageNodeDeviceIfPossible(messageNode, msgID)
{
    if (!msgID) return;
    var isOutgoingMessage = messageNode.classList.contains("message-out") ||
                            (messageNode.querySelector && messageNode.querySelector('[aria-label="You:"]') !== null);
    if (isOutgoingMessage)
    {
        return;
    }

    function onDeviceTypeReceived(deviceType)
    {
        if (!deviceType) return;
        try
        {
            var possibleNodes = document.querySelectorAll('[data-id*="' + CSS.escape(String(msgID)) + '"]');
            if (possibleNodes.length > 0 && possibleNodes[0].childNodes.length > 0)
                messageNode = possibleNodes[0].childNodes[0];
        }
        catch (err) {}

        if (!messageNode || messageNode.getElementsByClassName("device-type-image").length > 0) return;

        var imageURL = "";
        if (deviceType == "computer")
            imageURL = chrome.runtime.getURL("images/computer.svg");
        else if (deviceType == "phone")
            imageURL = chrome.runtime.getURL("images/phone.svg");
        else
            return;

        generateSVGElement(imageURL, "", "This message was sent from a " + deviceType, 19).then(function (imageElement)
        {
            imageElement.className = "device-type-image";

            var topMessageNode = messageNode.parentNode && messageNode.parentNode.parentNode && messageNode.parentNode.parentNode.parentNode;
            var previousNode = topMessageNode ? topMessageNode.previousElementSibling : null;
            var possibleAvatarElement = previousNode ? previousNode : topMessageNode;

            if (possibleAvatarElement && (possibleAvatarElement.innerHTML.includes("chat-profile-picture") || possibleAvatarElement.innerHTML.includes("Open chat details")))
            {
                imageElement.className += " below-profile-picture";
            }

            messageNode.insertBefore(imageElement, messageNode.firstChild);
        });
    }

    createPendingEntry(waiPendingDeviceTypes, msgID, onDeviceTypeReceived, 5000);

    WAIPageBus.sendToPage('deviceType:lookup', { messageID: msgID });
}

function checkInterception()
{
    if (!isInterceptionWorking)
    {
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

WAIErrorHook.installErrorHook();
