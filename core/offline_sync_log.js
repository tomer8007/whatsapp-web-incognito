//
// Offline sync log (page world). A privacy-safe, in-memory record of HOW incoming messages arrive, so we can tell what
// WhatsApp sends when the tab reopens after a message was sent and deleted while it was closed: the original, then a
// revoke, only the revoke, or both in one packet.
//
// Only enums, booleans and counters are recorded: never a JID, name, number, message id or content. The ids of the messages
// seen this page load are kept in a private Set (ids only, never exposed) to answer "was the revoked original seen?".
// Memory only, capped, never persisted, never sent anywhere, never logged. Every entry point swallows its own errors.
//

var OFFLINE_SYNC_LOG_CAP = 200;
var OFFLINE_SYNC_SEEN_CAP = 5000;

function createOfflineSyncLog(deps)
{
    var now = deps && deps.now ? deps.now : function() { return Date.now(); };
    var startedAt = now();
    var entries = [];
    var seenIds = new Set();
    var sequence = 0;
    var counters = { messages: 0, revokes: 0, revokesBlocked: 0, revokesWithOriginalSeen: 0, revokesWithoutOriginal: 0, offlineNodes: 0, batched: 0, errors: 0 };
    var batch = { index: 0, size: 1 };

    function chatKind(jid)
    {
        var value = String(jid || "");
        if (value == "status@broadcast") return "status";
        if (/@g\.us$/.test(value)) return "group";
        if (/@(c\.us|s\.whatsapp\.net|lid)$/.test(value)) return "user";
        return "other";
    }

    // short fixed enum values only (for example type="text"); anything else is dropped
    function enumValue(value)
    {
        return typeof value == "string" && /^[a-z_]{1,16}$/.test(value) ? value : null;
    }

    function messageKind(message)
    {
        if (!message) return "other";
        var protocol = message.protocolMessage;
        if (protocol)
        {
            if (protocol.type == (deps && deps.revokeType != null ? deps.revokeType : 0)) return "revoke";
            if (protocol.editedMessage || protocol.type == 14) return "edit";
            return "other";
        }
        if (message.editedMessage) return "edit";
        if (message.reactionMessage) return "reaction";
        if (message.conversation != null || message.extendedTextMessage) return "text";
        var mediaKeys = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "ptvMessage"];
        for (var i = 0; i < mediaKeys.length; i++) if (message[mediaKeys[i]]) return "media";
        return "other";
    }

    function remember(id)
    {
        if (id == null) return;
        seenIds.add(String(id));
        if (seenIds.size > OFFLINE_SYNC_SEEN_CAP) seenIds.delete(seenIds.values().next().value);
    }

    return {
        // the position of the frame being handled inside its decrypted packet
        setBatch: function(index, size)
        {
            try { batch = { index: Number(index) || 0, size: Number(size) || 1 }; } catch (e) { /* ignore */ }
        },

        // messageNode: the <message> stanza, message: the decoded E2E message, blocked: the allow/block result
        record: function(messageNode, message, blocked, shouldBlock)
        {
            try
            {
                var attrs = (messageNode && messageNode.attrs) || {};
                var kind = messageKind(message);
                var entry = {
                    seq: ++sequence,
                    t: now() - startedAt,
                    tag: enumValue(messageNode && messageNode.tag) || "other",
                    offline: attrs["offline"] != null,
                    type: enumValue(attrs["type"]),
                    category: enumValue(attrs["category"]),
                    chat: chatKind(attrs["from"]),
                    kind: kind,
                    batchIndex: batch.index,
                    batchSize: batch.size,
                };
                // settings state at that moment (booleans and a number only)
                var state = deps && deps.getState ? deps.getState() : {};
                entry.hookOn = !!state.hookOn;
                entry.shouldBlock = !!shouldBlock;
                entry.optionsSeen = state.optionsReceivedAt != null;
                entry.msSinceOptions = state.optionsReceivedAt != null ? now() - state.optionsReceivedAt : null;
                counters.messages++;
                if (entry.offline) counters.offlineNodes++;
                if (batch.size > 1) counters.batched++;

                if (kind == "revoke")
                {
                    var targetId = message.protocolMessage && message.protocolMessage.key ? message.protocolMessage.key.id : null;
                    entry.originalSeenThisSession = targetId != null && seenIds.has(String(targetId));
                    entry.blocked = !!blocked;
                    counters.revokes++;
                    if (entry.blocked) counters.revokesBlocked++;
                    if (entry.originalSeenThisSession) counters.revokesWithOriginalSeen++; else counters.revokesWithoutOriginal++;
                }
                else
                {
                    remember(attrs["id"]);
                }

                entries.push(entry);
                if (entries.length > OFFLINE_SYNC_LOG_CAP) entries.shift();
            }
            catch (e) { counters.errors++; }
        },

        snapshot: function()
        {
            return { counters: Object.assign({}, counters), entries: entries.map(function(entry) { return Object.assign({}, entry); }) };
        },
    };
}

var OfflineSyncLog = createOfflineSyncLog({
    now: function() { return Date.now(); },
    getState: function()
    {
        return {
            hookOn: typeof saveDeletedMsgsHookEnabled != "undefined" ? saveDeletedMsgsHookEnabled : false,
            optionsReceivedAt: typeof optionsReceivedAt != "undefined" ? optionsReceivedAt : null,
        };
    },
    revokeType: typeof Message != "undefined" && Message.ProtocolMessage ? Message.ProtocolMessage.Type.REVOKE.value : 0,
});

if (typeof Diagnostics != "undefined")
    Diagnostics.register("sync", "hook", "offline-sync", function() { return OfflineSyncLog.snapshot().counters.messages; });
