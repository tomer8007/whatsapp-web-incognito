//
// Edit history chain (isolated world). Turns the stored edit records of one message into a clean list of versions:
// Version 1 (original) -> Version 2 -> ... -> current. Pure, unit-tested.
//   records: [{ts, original, newText}] (any order)  ->  [{n, text, replacedAt: ms | null, current: bool}]
//

function buildEditChain(records)
{
    var sorted = (records || []).filter(function(r) { return r && typeof r.original == "string"; })
                                .sort(function(a, b) { return a.ts - b.ts; });
    var versions = [];
    var lastText = null; // the newest version we know (the text after the previous edit)

    sorted.forEach(function(record)
    {
        var before = record.original;
        // a record whose "before" repeats the previous "before" although the previous edit produced something else is stale
        // (WhatsApp's model was not updated yet): the previous edit's result is the real "before"
        if (versions.length > 0 && lastText != null && before === versions[versions.length - 1].text && lastText !== before)
            before = lastText;
        versions.push({ n: versions.length + 1, text: before, replacedAt: record.ts, current: false });
        lastText = record.newText != null ? record.newText : null;
    });

    if (versions.length > 0 && lastText != null)
        versions.push({ n: versions.length + 1, text: lastText, replacedAt: null, current: true });
    return versions;
}
