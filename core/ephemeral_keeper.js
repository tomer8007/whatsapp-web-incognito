//
// Keeps a copy of disappearing (ephemeral) messages when they arrive. Page world. Depends on core/edit_tracker.js
// (unwrapMessage, extractText). Media is NOT downloaded on arrival: only what is needed to download it later is kept.
//

var EPHEMERAL_MEDIA_KEYS = [["imageMessage", "image"], ["videoMessage", "video"], ["audioMessage", "audio"],
                            ["documentMessage", "document"], ["stickerMessage", "sticker"]];

function mediaBytesToBase64(bytes)
{
    if (bytes == null) return null;
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// An ephemeralMessage wrapper, or contextInfo.expiration > 0 on whatever message the wrapper(s) contain.
function isEphemeralMessage(e2eMessage)
{
    if (!e2eMessage) return false;
    if (e2eMessage.ephemeralMessage && e2eMessage.ephemeralMessage.message) return true;

    var inner = unwrapMessage(e2eMessage);
    if (!inner) return false;
    var keys = Object.keys(inner);
    for (var i = 0; i < keys.length; i++)
    {
        var part = inner[keys[i]];
        if (part && typeof part == "object" && part.contextInfo && part.contextInfo.expiration > 0) return true;
    }
    return false;
}

// {directPath, mediaKey (b64), fileEncSha256 (b64), fileSha256 (b64), mimetype, type} | null
function extractMediaMeta(e2eMessage)
{
    var inner = unwrapMessage(e2eMessage);
    if (!inner) return null;
    for (var i = 0; i < EPHEMERAL_MEDIA_KEYS.length; i++)
    {
        var media = inner[EPHEMERAL_MEDIA_KEYS[i][0]];
        if (!media) continue;
        var type = EPHEMERAL_MEDIA_KEYS[i][1];
        if (type == "audio" && media.ptt) type = "ptt";
        return {
            directPath: media.directPath,
            mediaKey: mediaBytesToBase64(media.mediaKey),
            fileEncSha256: mediaBytesToBase64(media.fileEncSha256),
            fileSha256: mediaBytesToBase64(media.fileSha256),
            mimetype: media.mimetype,
            type: type,
        };
    }
    return null;
}

// The id is prefixed so it can never collide with an archived deleted message of the same id (that would mark it as deleted).
function buildEphemeralSnapshot(e2eMessage, info)
{
    return {
        kind: "ephemeral",
        id: "eph:" + info.messageId,
        messageId: info.messageId,
        chatJid: info.chatJid,
        from: info.from,
        ts: info.ts,
        text: extractText(e2eMessage),
        mediaMeta: extractMediaMeta(e2eMessage),
    };
}

// What the chat modal needs: oldest first, no media keys.
function summarizeEphemeralRecords(records)
{
    return records.slice().sort(function(a, b) { return a.ts - b.ts; }).map(function(record)
    {
        return {
            id: record.id,
            from: record.from,
            ts: record.ts,
            text: record.text,
            hasMedia: !!record.mediaMeta,
            mediaType: record.mediaMeta ? record.mediaMeta.type : null,
            mimetype: record.mediaMeta ? record.mediaMeta.mimetype : null,
        };
    });
}
