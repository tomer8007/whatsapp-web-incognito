//
// Bulk status download (page world). The isolated world (status_download.js) asks with `getStatusMediaForContact`;
// the media of that contact's statuses is downloaded and decrypted here, then sent back one by one with
// `onStatusMediaItem` {index, total, name, mimetype, b64} and finally `onStatusMediaDone` {total, failed, error?}.
//

var STATUS_EXTENSIONS = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
                          "video/mp4": "mp4", "video/3gpp": "3gp", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a" };

function statusExtension(mimetype)
{
    var base = String(mimetype || "").split(";")[0].trim().toLowerCase();
    if (STATUS_EXTENSIONS[base]) return STATUS_EXTENSIONS[base];
    var subtype = (base.split("/")[1] || "").replace(/[^a-z0-9]/g, "");
    return subtype || "bin";
}

function pad2(number) { return (number < 10 ? "0" : "") + number; }

// status_<safe-name>_<YYYYMMDD-HHMMSS>_<n>.<ext>   (ts: WhatsApp seconds or milliseconds)
function statusFileName(contactName, ts, index, mimetype)
{
    var safeName = String(contactName || "").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");
    if (!safeName) safeName = "contact";

    var date = new Date(ts > 1e11 ? ts : ts * 1000);
    var stamp = date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) + "-" +
                pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds());
    return "status_" + safeName + "_" + stamp + "_" + index + "." + statusExtension(mimetype);
}

// text statuses have no media: skip them
function collectStatusMediaMessages(messages)
{
    return messages.filter(function(message) { return message && (message.isMedia || message.mediaKey); });
}

// Downloads one by one (keeps memory low). A failing item is counted and skipped.
async function runStatusBulk(job)
{
    var total = job.messages.length;
    var failed = 0;
    for (var i = 0; i < total; i++)
    {
        var message = job.messages[i];
        try
        {
            var data = await job.download(message);
            job.emitItem({ index: i + 1, total: total, name: statusFileName(job.contactName, message.t, i + 1, message.mimetype),
                           mimetype: message.mimetype, b64: job.toBase64(data) });
        }
        catch (e)
        {
            failed++;
        }
    }
    job.emitDone({ total: total, failed: failed });
}

var statusBulkRunning = false;

function dispatchStatusBulkEvent(name, detail)
{
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
}

// jid: the contact whose statuses to download; without one, the contact of the status on screen.
async function getStatusMediaForContact(jid)
{
    if (statusBulkRunning) return;
    statusBulkRunning = true;
    try
    {
        var viewedMessage = null;
        if (!jid)
        {
            var viewer = document.querySelector("[data-animate-status-viewer]");
            var fiberKey = viewer ? Object.keys(viewer).find(function(key) { return key.startsWith("__reactFiber$"); }) : null;
            viewedMessage = fiberKey ? findStatusMessageInFiber(viewer[fiberKey]) : null;
            var sender = viewedMessage && (viewedMessage.author || viewedMessage.from || (viewedMessage.id && viewedMessage.id.participant));
            jid = sender ? sender.toString() : null;
        }

        var entry = jid ? findStatusEntry(jid) : null;
        if (!entry || !entry.msgs || !entry.msgs.getModelsArray)
        {
            dispatchStatusBulkEvent("onStatusMediaDone", { total: 0, failed: 0, error: "status-not-found" });
            return;
        }

        var chat = null;
        try { chat = await getChatByJID(jid); } catch (e) { /* the name is optional */ }
        var contactName = getChatDisplayName(chat, jid);

        await runStatusBulk({
            messages: collectStatusMediaMessages(entry.msgs.getModelsArray()),
            contactName: contactName,
            download: function(message)
            {
                return WhatsAppAPI.downloadManager.downloadAndMaybeDecrypt({ directPath: message.directPath, encFilehash: message.encFilehash,
                    filehash: message.filehash, mediaKey: message.mediaKey, type: message.type, signal: (new AbortController).signal });
            },
            toBase64: arrayBufferToBase64,
            emitItem: function(item) { dispatchStatusBulkEvent("onStatusMediaItem", item); },
            emitDone: function(result) { dispatchStatusBulkEvent("onStatusMediaDone", result); },
        });
    }
    catch (exception)
    {
        console.warn("WAIncognito: bulk status download failed");
        dispatchStatusBulkEvent("onStatusMediaDone", { total: 0, failed: 0, error: "status-download-failed" });
    }
    finally
    {
        statusBulkRunning = false;
    }
}

if (typeof document !== "undefined" && document.addEventListener)
{
    document.addEventListener("getStatusMediaForContact", function(e)
    {
        var data = e.detail ? JSON.parse(e.detail) : {};
        getStatusMediaForContact(data.jid || null);
    });
}
