//
// Diagnostics: every feature that depends on WhatsApp internals (modules, exports, DOM selectors, databases, hooks)
// registers that dependency here, so a WhatsApp update that breaks a feature is visible in the "Diagnostics" category.
//
// Loaded in both worlds: the page world registers modules/exports/db/hooks, the isolated world registers selectors
// (it owns the menu UI and merges both result lists).
//
var Diagnostics = (function()
{
    var entries = []; // {feature, kind, id, check}

    function register(feature, kind, id, check)
    {
        for (var i = 0; i < entries.length; i++)
        {
            if (entries[i].feature == feature && entries[i].kind == kind && entries[i].id == id)
            {
                entries[i].check = check;
                return;
            }
        }
        entries.push({feature: feature, kind: kind, id: id, check: check});
    }

    // selector and hook entries that never matched are "unseen" (the screen/action may just not have happened yet)
    function statusFor(kind, value)
    {
        var softFailure = (kind == "selector" || kind == "hook") ? "unseen" : "missing";
        if (typeof value == "number") return value > 0 ? "ok" : softFailure;
        if (value === true) return "ok";
        if (kind == "selector") return "unseen";
        return "missing";
    }

    function run()
    {
        var results = [];
        for (var i = 0; i < entries.length; i++)
        {
            var entry = entries[i];
            var result = {feature: entry.feature, kind: entry.kind, id: entry.id, status: "missing", detail: ""};
            try
            {
                var value = entry.check();
                result.status = statusFor(entry.kind, value);
                if (typeof value == "number") result.detail = String(value);
            }
            catch (e)
            {
                result.status = entry.kind == "selector" ? "unseen" : "missing";
                result.detail = String(e && e.message ? e.message : e);
            }
            results.push(result);
        }
        return results;
    }

    // never put message content, JIDs or phone numbers in a report
    function sanitize(text)
    {
        return String(text == null ? "" : text)
            .replace(/[^\s@]*@(s\.whatsapp\.net|c\.us|g\.us|lid|broadcast|newsletter)/g, "<jid>")
            .replace(/\d{6,}/g, "<n>")
            .slice(0, 120);
    }

    function report(results)
    {
        var counts = {ok: 0, missing: 0, unseen: 0};
        var lines = [];
        for (var i = 0; i < results.length; i++)
        {
            var r = results[i];
            counts[r.status] = (counts[r.status] || 0) + 1;
            lines.push("[" + r.status + "] " + sanitize(r.feature) + " / " + sanitize(r.kind) + " / " + sanitize(r.id) +
                       (r.detail ? " (" + sanitize(r.detail) + ")" : ""));
        }
        var header = typeof t == "function" ? t("diag.report", { ok: counts.ok, missing: counts.missing, unseen: counts.unseen })
                                            : "WAIncognito diagnostics: " + counts.ok + " ok, " + counts.missing + " missing, " + counts.unseen + " unseen";
        return header + "\n" + lines.join("\n");
    }

    return {register: register, run: run, report: report};
})();
