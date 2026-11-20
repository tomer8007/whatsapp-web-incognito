//
// Routes replies from the page context (injected_ui.js) to whoever asked for them.
// One listener per reply event, instead of one listener per rendered message that was never removed.
//
function createResponseRouter(target, responseEventName, timeoutMs)
{
    var pending = new Map(); // messageID -> array of callbacks

    function forget(messageID, callback)
    {
        var callbacks = pending.get(messageID);
        if (!callbacks) return;
        var index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
        if (callbacks.length == 0) pending.delete(messageID);
    }

    target.addEventListener(responseEventName, function(e)
    {
        var data = JSON.parse(e.detail);
        var callbacks = pending.get(data.messageID);
        if (!callbacks) return;
        pending.delete(data.messageID);
        callbacks.forEach(function(callback) { callback(data); });
    });

    return {
        waitFor: function(messageID, callback)
        {
            if (pending.has(messageID)) pending.get(messageID).push(callback);
            else pending.set(messageID, [callback]);

            // the responder may never answer (e.g. the deleted messages DB is not open yet)
            setTimeout(function() { forget(messageID, callback); }, timeoutMs);
        },
        pendingCount: function() { return pending.size; }
    };
}
