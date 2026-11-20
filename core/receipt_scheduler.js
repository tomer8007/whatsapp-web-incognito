//
// Scheduled blue ticks (isolated world). Pure scheduling logic: time, timers, storage and the send action are injected.
// The send action dispatches `sendReadConfirmationForJid` to the page world (see ui.js).
//

// Persists a list under chrome.storage.local[key]. Also used by core/send_scheduler.js.
function createChromeListStore(key)
{
    return {
        get: async function()
        {
            var stored = await extensionStorageGet([key]);
            return Array.isArray(stored[key]) ? stored[key] : [];
        },
        set: async function(items)
        {
            var update = {};
            update[key] = items;
            await extensionStorageSet(update);
        },
    };
}

function createReceiptScheduler(deps)
{
    var items = [];          // [{jid, dueAt}]
    var handles = new Map(); // jid -> timer handle

    function persist() { return deps.store.set(items); }

    function disarm(jid)
    {
        if (handles.has(jid))
        {
            deps.clearTimer(handles.get(jid));
            handles.delete(jid);
        }
    }

    function removeItem(jid)
    {
        items = items.filter(function(item) { return item.jid !== jid; });
    }

    async function fire(jid)
    {
        handles.delete(jid);
        removeItem(jid);
        await persist();
        try { deps.send(jid); }
        catch (e) { console.warn("WAIncognito: could not send a scheduled read receipt"); }
    }

    function arm(item)
    {
        disarm(item.jid);
        handles.set(item.jid, deps.setTimer(function() { return fire(item.jid); }, Math.max(0, item.dueAt - deps.now())));
    }

    return {
        schedule: async function(jid, dueAt)
        {
            removeItem(jid);
            items.push({ jid: jid, dueAt: dueAt });
            arm(items[items.length - 1]);
            await persist();
        },

        cancel: async function(jid)
        {
            disarm(jid);
            removeItem(jid);
            await persist();
        },

        list: function()
        {
            return items.map(function(item) { return { jid: item.jid, dueAt: item.dueAt }; });
        },

        // overdue items are sent immediately, the others are armed again
        restore: async function()
        {
            var stored = await deps.store.get();
            items = [];
            handles.forEach(function(handle) { deps.clearTimer(handle); });
            handles.clear();

            var overdue = [];
            stored.forEach(function(item)
            {
                if (item.dueAt <= deps.now()) overdue.push(item.jid);
                else { items.push({ jid: item.jid, dueAt: item.dueAt }); arm(items[items.length - 1]); }
            });
            await persist();
            overdue.forEach(function(jid)
            {
                try { deps.send(jid); }
                catch (e) { console.warn("WAIncognito: could not send a scheduled read receipt"); }
            });
        },
    };
}

// choice: "15m" | "1h" | "3h" | "time" (timeText "HH:MM": today if still ahead, otherwise tomorrow). null when invalid.
function resolveScheduleChoice(choice, nowMs, timeText)
{
    var minutes = { "15m": 15, "1h": 60, "3h": 180 }[choice];
    if (minutes) return nowMs + minutes * 60 * 1000;

    if (choice == "time")
    {
        var match = /^(\d{1,2}):(\d{2})$/.exec(timeText || "");
        if (!match) return null;
        var due = new Date(nowMs);
        due.setHours(Number(match[1]), Number(match[2]), 0, 0);
        if (due.getTime() <= nowMs) due.setDate(due.getDate() + 1);
        return due.getTime();
    }
    return null;
}
