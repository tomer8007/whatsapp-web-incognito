//
// "Delete for everyone" without the time limit (page world). WhatsApp Web reads its revoke window from the exports of
// WAWebRevokeMsgConstants at call time (menu gate and action gate), so the option `deleteForEveryoneAnyTime` raises
// REVOKE_WINDOW and REVOKE_WINDOW_RECEIVER_MARGIN to a large finite value, and restores the originals when it is turned off.
// NEWSLETTER_REVOKE_WINDOW is never touched. Whether recipients honour a late revoke is outside our control.
//

var REVOKE_WINDOW_UNLIMITED_SECONDS = 10 * 365 * 24 * 60 * 60; // ten years, finite on purpose
var REVOKE_WINDOW_KEYS = ["REVOKE_WINDOW", "REVOKE_WINDOW_RECEIVER_MARGIN"];

// Pure: `constants` is the exports object, `saved` keeps the original values (filled on the first apply).
function applyRevokeWindow(constants, saved)
{
    if (!constants) return false;
    REVOKE_WINDOW_KEYS.forEach(function(key)
    {
        if (typeof constants[key] != "number") return;
        if (!(key in saved)) saved[key] = constants[key];
        constants[key] = Math.max(constants[key], REVOKE_WINDOW_UNLIMITED_SECONDS);
    });
    return true;
}

function restoreRevokeWindow(constants, saved)
{
    if (!constants) return false;
    REVOKE_WINDOW_KEYS.forEach(function(key)
    {
        if (key in saved) constants[key] = saved[key];
    });
    return true;
}

var revokeWindowSaved = {};
var revokeWindowActive = false;
var revokeWindowRetryTimer = null;

function revokeConstantsModule()
{
    try { return typeof require == "function" ? require("WAWebRevokeMsgConstants") : null; }
    catch (e) { return null; }
}

// Brings the module in line with the option. Retries quietly (up to ~2 minutes) while WhatsApp has not loaded the module.
function syncRevokeWindow(attempt)
{
    var enabled = !!(window.WAIncognitoOptions || {}).deleteForEveryoneAnyTime;
    var constants = revokeConstantsModule();
    if (constants)
    {
        if (enabled) { applyRevokeWindow(constants, revokeWindowSaved); revokeWindowActive = true; }
        else if (revokeWindowActive) { restoreRevokeWindow(constants, revokeWindowSaved); revokeWindowActive = false; }
        return;
    }
    if (!enabled && !revokeWindowActive) return;
    if (revokeWindowRetryTimer) clearTimeout(revokeWindowRetryTimer);
    if ((attempt || 0) < 40) revokeWindowRetryTimer = setTimeout(function() { syncRevokeWindow((attempt || 0) + 1); }, 3000);
}

if (typeof document != "undefined" && document.addEventListener)
{
    document.addEventListener("onOptionsUpdate", function() { try { syncRevokeWindow(0); } catch (e) { /* retried on the next update */ } });
    setTimeout(function() { try { syncRevokeWindow(0); } catch (e) {} }, 5000);
}

if (typeof Diagnostics != "undefined")
    Diagnostics.register("messages", "hook", "revoke-window", function()
    {
        var constants = revokeConstantsModule();
        return constants && typeof constants.REVOKE_WINDOW == "number" ? constants.REVOKE_WINDOW : 0;
    });
