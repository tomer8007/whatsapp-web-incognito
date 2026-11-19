//
// Hidetag (page world): a text message to a group whose contextInfo.mentionedJid lists ALL members while the visible text has no "@name".
// Opt-in (option hidetagEnabled). The shape was found on the live build (2.3000.x): WhatsApp's own text sender takes
//   WAWebSendTextMsgChatAction.sendTextMsgToChat(chat, text, { mentionedJidList: [wid...], groupMentions: [] })
// (the same option keys the message editor uses) and createTextMsgData(chat, text, options) builds the message without sending it.
// Pure builders first (unit-tested), live wiring below.
//

var HIDETAG_BIG_GROUP = 256; // above this the UI warns: that is a lot of notifications

// The participants of a group chat as an array of models/objects with an `id` wid, or null when the metadata is not loaded
function groupParticipantsOf(chat)
{
    var metadata = chat && chat.groupMetadata;
    var participants = metadata && metadata.participants;
    if (!participants) return null;
    return participants.getModelsArray ? participants.getModelsArray() : (Array.isArray(participants) ? participants : null);
}

function isGroupChat(chat)
{
    return !!(chat && chat.id && (chat.id.server == "g.us" || chat.isGroup === true));
}

// selfForms: normalized JID strings of the user (PN and LID). -> {ok, error?, wids, count, big}
function buildHidetagPlan(chat, selfForms)
{
    if (!isGroupChat(chat)) return { ok: false, error: "not-a-group", wids: [], count: 0, big: false };
    var participants = groupParticipantsOf(chat);
    if (!participants) return { ok: false, error: "no-metadata", wids: [], count: 0, big: false };

    var skip = {};
    (selfForms || []).forEach(function(jid) { if (jid) skip[normalizeJID(String(jid))] = true; });

    var seen = {};
    var wids = [];
    participants.forEach(function(participant)
    {
        var wid = participant && participant.id;
        if (!wid) return;
        var jid = normalizeJID(wid.toString());
        if (skip[jid] || seen[jid]) return; // the user already knows; no duplicates
        seen[jid] = true;
        wids.push(wid);
    });
    return { ok: true, wids: wids, count: wids.length, big: wids.length > HIDETAG_BIG_GROUP };
}

// the options WhatsApp's text sender reads
function buildHidetagOptions(plan)
{
    return { mentionedJidList: plan.wids, groupMentions: [] };
}

// only structure: key names and the length of the mention list, never the text
function summarizeMessageData(data, text)
{
    return {
        keys: data ? Object.keys(data).slice(0, 40) : [],
        mentionedJidListLength: data && data.mentionedJidList ? data.mentionedJidList.length : 0,
        hasGroupMentions: !!(data && "groupMentions" in data),
        bodyIsText: !!data && data.body === text,
    };
}

//
// Live wiring
//
function hidetagSelfForms()
{
    var forms = [];
    try
    {
        var me = require("WAWebUserPrefsMeUser");
        ["getMaybeMeLidUser", "getMaybeMePnUser"].forEach(function(name)
        {
            if (typeof me[name] == "function") { var wid = me[name](); if (wid) forms.push(wid.toString()); }
        });
    }
    catch (e) { /* unknown: the user stays in the list, which is harmless */ }
    return forms;
}

function findCreateTextMsgData()
{
    try { var module = require("WAWebSendTextMsgChatAction"); return typeof module.createTextMsgData == "function" ? module.createTextMsgData : null; }
    catch (e) { return null; }
}

// -> {ok, error?, count, big, dry?}. dryRun builds the message with WhatsApp's own function and reports its structure, sends nothing.
async function sendHidetag(chat, text, dryRun)
{
    try
    {
        var plan = buildHidetagPlan(chat, hidetagSelfForms());
        if (!plan.ok) return { ok: false, error: plan.error, count: 0, big: false };
        if (plan.count == 0) return { ok: false, error: "no-members", count: 0, big: false };
        if (typeof text != "string" || text.trim() == "") return { ok: false, error: "empty-text", count: plan.count, big: plan.big };
        var options = buildHidetagOptions(plan);

        if (dryRun)
        {
            var create = findCreateTextMsgData();
            if (!create) return { ok: false, error: "create function not found", count: plan.count, big: plan.big };
            var data = await create(chat, text, options);
            return { ok: true, dry: summarizeMessageData(data, text), count: plan.count, big: plan.big };
        }

        var sendText = findSendTextFunction();
        if (!sendText) return { ok: false, error: "send function not found", count: plan.count, big: plan.big };
        var result = await sendText(chat, text, options);
        var okValue = "OK";
        try { okValue = require("WAWebSendMsgResultAction").SendMsgResult.OK; } catch (e) { /* keep the default */ }
        var sent = !!result && result.messageSendResult === okValue;
        return { ok: sent, error: sent ? undefined : "send result " + String(result && result.messageSendResult), count: plan.count, big: plan.big };
    }
    catch (e)
    {
        return { ok: false, error: String(e && e.message ? e.message : e), count: 0, big: false };
    }
}

function replyHidetag(name, payload) { document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) })); }

if (typeof document !== "undefined" && document.addEventListener)
{
    // the member count for the modal
    document.addEventListener("waIncognitoHidetagPlan", async function(e)
    {
        var data = JSON.parse(e.detail);
        var reply = { messageID: data.messageID, ok: false, error: "unavailable", count: 0, big: false };
        try
        {
            var chat = await getChatByJID(data.jid);
            var plan = buildHidetagPlan(chat, hidetagSelfForms());
            reply = { messageID: data.messageID, ok: plan.ok, error: plan.error, count: plan.count, big: plan.big };
        }
        catch (exception) { /* the default reply says unavailable */ }
        replyHidetag("waIncognitoHidetagPlanResult", reply);
    });

    document.addEventListener("waIncognitoHidetagSend", async function(e)
    {
        var data = JSON.parse(e.detail);
        var result;
        if (!(window.WAIncognitoOptions || {}).hidetagEnabled) result = { ok: false, error: "disabled" };
        else
        {
            var chat = await getChatByJID(data.jid);
            result = await sendHidetag(chat, data.text, !!data.dryRun);
        }
        result.messageID = data.messageID;
        replyHidetag("waIncognitoHidetagResult", result);
    });
}

if (typeof Diagnostics !== "undefined")
{
    Diagnostics.register("hidetag", "export", "createTextMsgData", function() { return findCreateTextMsgData() != null; });
    Diagnostics.register("hidetag", "export", "sendTextMsgToChat (hidetag)", function() { return findSendTextFunction() != null; });
    Diagnostics.register("hidetag", "hook", "group-metadata", function()
    {
        var collection = window.WhatsAppAPI && WhatsAppAPI.ChatCollection;
        if (!collection || !collection.getModelsArray) return 0;
        return collection.getModelsArray().filter(function(chat) { return isGroupChat(chat) && groupParticipantsOf(chat) != null; }).length;
    });
}
