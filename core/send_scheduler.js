//
// Scheduled messages (isolated world). Pure scheduling logic: time, timers, storage and the send action are injected.
// The send action asks the page world (`waIncognitoSendText`) to send through WhatsApp's own send function.
// The WhatsApp Web tab must stay open for a message to go out.
//

var SEND_SCHEDULER_MAX_TIMER_MS = 2147483647; // setTimeout fires immediately above this

// items: [{id, jid, text, dueAt, name?, status: "pending" | "overdue" | "error", error?}]
function createSendScheduler(deps)
{
    var minIntervalMs = deps.minIntervalMs != null ? deps.minIntervalMs : 60000;
    var items = [];
    var handles = new Map(); // id -> timer handle
    var lastSentAt = null;
    var nextSequence = 1;

    function persist() { return deps.store.set(items); }

    function findItem(id)
    {
        return items.find(function(item) { return item.id === id; }) || null;
    }

    function disarm(id)
    {
        if (handles.has(id))
        {
            deps.clearTimer(handles.get(id));
            handles.delete(id);
        }
    }

    function arm(item, delay)
    {
        disarm(item.id);
        handles.set(item.id, deps.setTimer(function() { return attempt(item.id, false); }, Math.min(Math.max(0, delay), SEND_SCHEDULER_MAX_TIMER_MS)));
    }

    // Sends one item, keeping at least minIntervalMs between two sends. `manual` skips the due time check.
    async function attempt(id, manual)
    {
        handles.delete(id);
        var item = findItem(id);
        if (!item) return;

        if (!manual && item.dueAt > deps.now())
        {
            arm(item, item.dueAt - deps.now()); // fired early (very long timer): wait again
            return;
        }

        if (lastSentAt != null && deps.now() - lastSentAt < minIntervalMs)
        {
            arm(item, lastSentAt + minIntervalMs - deps.now());
            return;
        }

        lastSentAt = deps.now();
        try
        {
            var result = await deps.send({ jid: item.jid, text: item.text });
            if (result && result.ok === false) throw new Error(result.error || "gagal mengirim");
            items = items.filter(function(other) { return other.id !== id; });
        }
        catch (e)
        {
            item.status = "error";
            item.error = String(e && e.message ? e.message : e);
        }
        await persist();
    }

    return {
        add: async function(jid, text, dueAt, name)
        {
            var id = "msg-" + deps.now() + "-" + (nextSequence++);
            var item = { id: id, jid: jid, text: text, dueAt: dueAt, status: "pending" };
            if (name) item.name = name;
            items.push(item);
            arm(item, dueAt - deps.now());
            await persist();
            return id;
        },

        cancel: async function(id)
        {
            disarm(id);
            items = items.filter(function(item) { return item.id !== id; });
            await persist();
        },

        list: function()
        {
            return items.map(function(item) { return Object.assign({}, item); });
        },

        // Sends an item right away (overdue or failed ones, after the user agreed), still spaced by the minimum interval.
        sendNow: async function(id)
        {
            disarm(id);
            var item = findItem(id);
            if (!item) return;
            item.status = "pending";
            delete item.error;
            await attempt(id, true);
        },

        // Overdue items are NOT sent: they are handed to onOverdue so the user decides. Future items are armed again.
        restore: async function()
        {
            var stored = await deps.store.get();
            handles.forEach(function(handle) { deps.clearTimer(handle); });
            handles.clear();
            items = [];

            var overdue = [];
            stored.forEach(function(entry)
            {
                var item = Object.assign({}, entry);
                if (item.dueAt <= deps.now())
                {
                    item.status = "overdue";
                    overdue.push(Object.assign({}, item));
                }
                else
                {
                    item.status = item.status == "error" ? "error" : "pending";
                    arm(item, item.dueAt - deps.now());
                }
                items.push(item);
            });
            await persist();
            if (overdue.length > 0 && deps.onOverdue) deps.onOverdue(overdue);
        },
    };
}
