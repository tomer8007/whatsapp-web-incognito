//
// Chat menu context (page world). When the user opens the context menu of a chat in the chat list, the isolated world
// (ui.js) needs to know which chat it is, to add its own entries (the keys menu.contactPrivacy, menu.scheduleMessage, ...).
// ui.js dispatches `onDropdownOpened`; this file answers with `waIncognitoChatMenuContext`
//   {context: {jids: [normalized pn, normalized lid], primaryJid, name, isGroup} | null}.
//

var chatMenuContextCount = 0;

// The React menu items of the open dropdown. null when the structure is not what we expect.
function getOpenDropdownMenuItems()
{
    var outer = document.getElementsByClassName(UIClassNames.OUTER_DROPDOWN_CLASS)[0];
    if (!outer) return null;
    var reactResult = FindReact(outer);
    if (!reactResult || !reactResult.props || !reactResult.props.children || reactResult.props.children.length == 0) return null;
    var menu = reactResult.props.children[0].props.children;
    if (!menu || !menu.props) return null;
    return menu.props.children;
}

// The chat the menu belongs to: the `chat` prop of any menu item.
function findChatInMenuItems(items)
{
    if (!items || typeof items.length != "number") return null;
    for (var i = 0; i < items.length; i++)
    {
        if (items[i] && items[i].props && items[i].props.chat) return items[i].props.chat;
    }
    return null;
}

// Only real conversations: people (c.us / lid) and groups. Status, broadcast lists and newsletters are not chats of a contact.
function isContactChatJid(jid)
{
    return /@(c\.us|lid|g\.us)$/.test(String(jid));
}

function contactNameFromCollection(wid)
{
    try
    {
        if (!wid || typeof require != "function") return "";
        var collection = require("WAWebContactCollection").ContactCollection;
        var contact = collection && collection.get ? collection.get(wid) : null;
        var name = contact && (contact.name || contact.shortName || contact.pushname || contact.formattedName);
        return name ? String(name) : "";
    }
    catch (e) { return ""; }
}

// A name for the list: the chat's own, else the contact book (by the chat id, then the PN/LID counterpart),
// else the phone number of the PN JID, else a translated "Unknown contact". Never empty.
function chatDisplayName(chat, jids)
{
    var name = chat.formattedTitle || chat.name || "";
    if (!name && chat.contact) name = chat.contact.name || chat.contact.pushname || chat.contact.formattedName || "";
    if (!name) name = contactNameFromCollection(chat.id);
    if (!name && chat.accountLid) name = contactNameFromCollection(chat.accountLid);
    if (!name)
    {
        var pn = chatPnJid(chat);
        if (pn) name = contactNameFromCollection(pn);
    }
    if (name) return String(name);

    var pnJid = jids.filter(function(jid) { return /@c\.us$/.test(jid); })[0];
    var digits = pnJid ? pnJid.split("@")[0].replace(/\D/g, "") : "";
    if (digits) return "+" + digits;
    return typeof t == "function" ? t("contact.unknown") : "Unknown contact";
}

function buildChatMenuContext(chat)
{
    if (!chat || !chat.id) return null;

    var jids = [];
    [chat.id, chat.accountLid, chatPnJid(chat)].forEach(function(wid)
    {
        if (!wid) return;
        var jid = normalizeJID(wid.toString());
        if (jids.indexOf(jid) == -1) jids.push(jid);
    });

    return { jids: jids, primaryJid: jids[0], name: chatDisplayName(chat, jids), isGroup: !!chat.isGroup || chat.id.server == "g.us" };
}

// WhatsApp Web 2.3000.x: the menu of the open conversation (header three-dot button) is a plain
// div[role=menu] of button[role=menuitem] without React `chat` props. Such a menu that sits over the
// conversation pane belongs to the open chat.
function isMenuOverConversationPane()
{
    var outer = document.getElementsByClassName(UIClassNames.OUTER_DROPDOWN_CLASS)[0];
    var main = document.getElementById("main");
    if (!outer || !main) return false;
    return outer.getBoundingClientRect().left >= main.getBoundingClientRect().left;
}

document.addEventListener("onDropdownOpened", function()
{
    var context = null;
    try
    {
        context = buildChatMenuContext(findChatInMenuItems(getOpenDropdownMenuItems()));
        if (!context && isMenuOverConversationPane()) context = activeChatContext();
        if (context) chatMenuContextCount++;
    }
    catch (exception)
    {
        console.warn("WAIncognito: could not read the chat of the open menu");
    }
    document.dispatchEvent(new CustomEvent("waIncognitoChatMenuContext", { detail: JSON.stringify({ context: context }) }));
});

//
// The user's chats (names only, never messages) for the "Per-contact privacy" list, and the chat that is open right now.
//   waIncognitoChatsRequest {messageID}      -> waIncognitoChatsResult {messageID, chats: [context...]}, newest first
//   waIncognitoActiveChatRequest {messageID} -> waIncognitoActiveChatResult {messageID, context | null}
//
function listChatContexts()
{
    var collection = window.WhatsAppAPI && WhatsAppAPI.ChatCollection;
    if (!collection || !collection.getModelsArray) return [];
    var chats = collection.getModelsArray().slice();
    chats.sort(function(a, b) { return (b.t || 0) - (a.t || 0); });
    var contexts = [];
    for (var i = 0; i < chats.length; i++)
    {
        var context = buildChatMenuContext(chats[i]);
        if (context && isContactChatJid(context.primaryJid)) contexts.push(context);
    }
    return contexts;
}

function activeChatContext()
{
    try { return buildChatMenuContext(getCurrentChat()); }
    catch (exception) { return null; }
}

function answerWithMessageID(request, reply, build)
{
    document.addEventListener(request, function(e)
    {
        var messageID = null;
        var payload = {};
        try { messageID = JSON.parse(e.detail).messageID; payload = build(); }
        catch (exception) { console.warn("WAIncognito: " + request + " failed"); }
        payload.messageID = messageID;
        document.dispatchEvent(new CustomEvent(reply, { detail: JSON.stringify(payload) }));
    });
}

answerWithMessageID("waIncognitoChatsRequest", "waIncognitoChatsResult", function() { return { chats: listChatContexts() }; });
answerWithMessageID("waIncognitoActiveChatRequest", "waIncognitoActiveChatResult", function() { return { context: activeChatContext() }; });

if (typeof Diagnostics != "undefined")
    Diagnostics.register("chat-menu", "hook", "chat-menu-context", function() { return chatMenuContextCount; });
if (typeof Diagnostics != "undefined")
    Diagnostics.register("contacts", "hook", "chat-list-source", function() { return listChatContexts().length; });
