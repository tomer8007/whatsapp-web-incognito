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

    var name = chat.formattedTitle || chat.name || (chat.contact && (chat.contact.name || chat.contact.pushname)) || "";
    return { jids: jids, primaryJid: jids[0], name: String(name), isGroup: !!chat.isGroup || chat.id.server == "g.us" };
}

document.addEventListener("onDropdownOpened", function()
{
    var context = null;
    try
    {
        context = buildChatMenuContext(findChatInMenuItems(getOpenDropdownMenuItems()));
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
        if (context && context.name) contexts.push(context);
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
