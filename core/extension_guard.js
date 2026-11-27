//
// Extension context guard (isolated world). After the extension is reloaded or updated, the old content script of an open tab
// keeps running with a dead chrome.runtime ("Extension context invalidated"). Every chrome.runtime / chrome.storage call of the
// UI goes through these helpers, so nothing throws uncaught; the user gets ONE popup asking to reload the tab instead.
//

function isExtensionContextValid()
{
    try { return typeof chrome !== "undefined" && !!chrome && !!chrome.runtime && !!chrome.runtime.id; }
    catch (e) { return false; }
}

function isContextInvalidatedError(error)
{
    var text = String(error && error.message ? error.message : error);
    return /Extension context invalidated|message channel closed|Receiving end does not exist|Cannot read properties of undefined/i.test(text);
}

var extensionNoticeShown = false;

function showExtensionUpdatedNotice()
{
    if (extensionNoticeShown) return;
    extensionNoticeShown = true;
    try
    {
        WAModal.fire({
            title: t("extension.updated.title"),
            text: t("extension.updated.text"),
            icon: "warning",
            allowOutsideClick: false,
            confirmButtonText: t("extension.reload"),
        }).then(function(result) { if (result.isConfirmed) location.reload(); });
    }
    catch (e)
    {
        console.warn("WAIncognito: the extension was updated, reload this tab");
    }
}

// true when the context is usable; otherwise shows the notice (once) and returns false
function ensureExtensionContext()
{
    if (isExtensionContextValid()) return true;
    showExtensionUpdatedNotice();
    return false;
}

// chrome.runtime.sendMessage that never throws. -> true when the message was sent
function safeSendMessage(message, callback)
{
    if (!ensureExtensionContext()) return false;
    try
    {
        chrome.runtime.sendMessage(message, function(response)
        {
            try { void chrome.runtime.lastError; } catch (e) { /* context gone while waiting */ }
            if (callback) callback(response);
        });
        return true;
    }
    catch (e)
    {
        if (isContextInvalidatedError(e)) { extensionNoticeShown = false; showExtensionUpdatedNotice(); }
        else console.warn("WAIncognito: could not reach the extension", e);
        return false;
    }
}

async function extensionStorageGet(keys)
{
    if (!ensureExtensionContext()) return {};
    try { return await chrome.storage.local.get(keys); }
    catch (e) { if (isContextInvalidatedError(e)) showExtensionUpdatedNotice(); return {}; }
}

async function extensionStorageSet(values)
{
    if (!ensureExtensionContext()) return false;
    try { await chrome.storage.local.set(values); return true; }
    catch (e) { if (isContextInvalidatedError(e)) showExtensionUpdatedNotice(); return false; }
}

function extensionUrl(path)
{
    try { return isExtensionContextValid() ? chrome.runtime.getURL(path) : ""; }
    catch (e) { return ""; }
}
