//
// Remembers recently received message texts, so that when the sender edits a message we can keep the original.
// Page world. Pure logic, no WhatsApp internals: the wiring lives in node_handler.js.
//

var SECRET_ENC_TYPE_MESSAGE_EDIT = 2;      // not in the local WAProto.proto enum (only EVENT_EDIT = 1)
var PROTOCOL_MESSAGE_TYPE_MESSAGE_EDIT = 14;
var EDIT_TRACKER_TTL_MS = 20 * 60 * 1000;
var EDIT_TRACKER_MAX_ENTRIES = 5000;

// Wrappers that carry the real message in `.message`
var MESSAGE_WRAPPER_KEYS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
                            "documentWithCaptionMessage", "editedMessage"];

// Returns the innermost message, looking through ephemeral / view-once / document-with-caption wrappers.
function unwrapMessage(message)
{
    for (var depth = 0; depth < 6 && message; depth++)
    {
        var inner = null;
        for (var i = 0; i < MESSAGE_WRAPPER_KEYS.length; i++)
        {
            var wrapper = message[MESSAGE_WRAPPER_KEYS[i]];
            if (wrapper && wrapper.message) { inner = wrapper.message; break; }
        }
        if (!inner) break;
        message = inner;
    }
    return message || null;
}

// conversation | extendedTextMessage.text | image/video/document caption | null
function extractText(message)
{
    message = unwrapMessage(message);
    if (!message) return null;

    if (typeof message.conversation == "string" && message.conversation !== "") return message.conversation;
    if (message.extendedTextMessage && typeof message.extendedTextMessage.text == "string" && message.extendedTextMessage.text !== "")
        return message.extendedTextMessage.text;

    var captionKeys = ["imageMessage", "videoMessage", "documentMessage"];
    for (var i = 0; i < captionKeys.length; i++)
    {
        var media = message[captionKeys[i]];
        if (media && typeof media.caption == "string" && media.caption !== "") return media.caption;
    }
    return null;
}

// The original text of a message as WhatsApp's own model still holds it (chat.msgs), or null. Used when the 20-minute cache
// does not know the message (received before the tab was opened). Never throws.
function readOriginalFromChatModel(chat, targetId)
{
    try
    {
        if (!chat || !chat.msgs || !chat.msgs.getModelsArray || !targetId) return null;
        var model = chat.msgs.getModelsArray().find(function(m) { return m && m.id && m.id.id == targetId; });
        if (!model) return null;
        if (typeof model.body == "string" && model.body !== "" && !model.isMedia) return { text: model.body, ts: model.t ? model.t * 1000 : null };
        if (typeof model.caption == "string" && model.caption !== "") return { text: model.caption, ts: model.t ? model.t * 1000 : null };
    }
    catch (e) {}
    return null;
}

// -> {text, ts, source: "cache"|"model"} | null. The cache wins: it holds the latest version we saw.
function resolveEditOriginal(recalled, fromModel)
{
    if (recalled) return { text: recalled.text, ts: recalled.ts, source: "cache" };
    if (fromModel) return { text: fromModel.text, ts: fromModel.ts, source: "model" };
    return null;
}

// Polls `readBody()` until it returns a text different from `before`, for up to `maxMs`. -> the new text, or null.
// `sleep(ms)` is injectable so tests do not wait.
async function waitForBodyChange(readBody, before, poll)
{
    var intervalMs = poll.intervalMs, maxMs = poll.maxMs;
    for (var waited = 0; waited <= maxMs; waited += intervalMs)
    {
        var current = null;
        try { current = readBody(); } catch (e) { current = null; }
        if (typeof current == "string" && current !== "" && current !== before) return current;
        await poll.sleep(intervalMs);
    }
    return null;
}

function isEditProtocolType(type)
{
    return type === PROTOCOL_MESSAGE_TYPE_MESSAGE_EDIT || type === "MESSAGE_EDIT";
}

function createEditTracker(options)
{
    var now = options.now;
    var ttlMs = options.ttlMs || EDIT_TRACKER_TTL_MS;
    var maxEntries = options.max || EDIT_TRACKER_MAX_ENTRIES;
    var entries = new Map(); // messageId -> {text, ts, storedAt}. Map keeps insertion order: the first key is the oldest.

    return {
        remember: function(messageId, text, ts)
        {
            if (!messageId || typeof text != "string") return;
            entries.delete(messageId); // re-insert at the end
            entries.set(messageId, { text: text, ts: ts, storedAt: now() });
            while (entries.size > maxEntries)
                entries.delete(entries.keys().next().value);
        },

        // -> {text, ts} | null
        recall: function(messageId)
        {
            var entry = entries.get(messageId);
            if (!entry) return null;
            if (now() - entry.storedAt > ttlMs)
            {
                entries.delete(messageId);
                return null;
            }
            return { text: entry.text, ts: entry.ts };
        },

        size: function() { return entries.size; },

        // -> {targetId, newText|null} | null
        detectEdit: function(e2eMessage)
        {
            if (!e2eMessage) return null;

            // the edit can sit inside an ephemeral / view-once wrapper (disappearing chats)
            var candidates = [e2eMessage, unwrapMessage(e2eMessage)];
            for (var i = 0; i < candidates.length; i++)
            {
                var message = candidates[i];
                if (!message) continue;

                var protocol = message.protocolMessage;
                if (protocol && isEditProtocolType(protocol.type) && protocol.key && protocol.key.id)
                    return { targetId: protocol.key.id, newText: extractText(protocol.editedMessage) };

                var secret = message.secretEncryptedMessage;
                if (secret && (secret.secretEncType === SECRET_ENC_TYPE_MESSAGE_EDIT || secret.secretEncType === "MESSAGE_EDIT") && secret.targetMessageKey && secret.targetMessageKey.id)
                    return { targetId: secret.targetMessageKey.id, newText: null };
            }

            return null;
        },
    };
}

var EditTracker = createEditTracker({ now: function() { return Date.now(); } });
