// -------------------
// Helper functions
// --------------------


// TODO: this function currently does not support @lid JIDs, 
//       I need to find a way to get the React element's LID
function findChatEntryElementForJID(jid)
{
    var chatsShown = document.getElementsByClassName(UIClassNames.CHAT_ENTRY_CLASS);
    var blockedChat = null;
    for (var i = 0; i < chatsShown.length; i++)
    {
        var reactElement = FindReact(chatsShown[i]);
        if (!reactElement || !reactElement.props || reactElement.props.data == undefined) continue;

        var data = reactElement.props.data;
        if (data.data == undefined && data.chat == undefined) continue;

        var id = data.data ? data.data.id : data.chat.id;
        if (!id) continue;

        var matches = false;
        if (typeof (jid) == "object" && id == jid)
        {
            matches = true;
        }
        else if (typeof (jid) == "string" && id.user == getPrefixFromJID(jid))
        {
            matches = true;
        }
        else if (data.data && data.data.accountLid && data.data.accountLid.toString() == jid)
        {
            matches = true;
        }

        if (matches)
        {
            blockedChat = chatsShown[i];
            break;
        }
    }

    return blockedChat;
}

function nodeToElement(node)
{
    if (!node.tag) 
    {
        var element = document.createElement("unknown");
        element.innerHTML = node.toString();
        return element;
    }

    if (node.tag == "0") node.tag = "zero"; // prevent "The tag name provided ('0') is not a valid name."
    else if (node.tag == "1") node.tag = "one"; // prevent "The tag name provided ('1') is not a valid name."
    else if (node.tag.startsWith("1") || node.tag.startsWith("0")) node.tag = "number_" + node.tag; //" The tag name provided ('109') is not a valid name."

    var element = document.createElement(node.tag);

    for (var attribute in node.attrs)
    {
        element.setAttribute(attribute, node.attrs[attribute]);
    }

    if (node.content)
    {
        if (Array.isArray(node.content))
        {
            for (var subNode of node.content)
            {
                element.appendChild(nodeToElement(subNode));
            }
        }
        else
        {
            element.appendChild(nodeToElement(node.content));
        }
    }

    return element;
}

function getCurrentChat()
{
    if (window.WhatsAppAPI && WhatsAppAPI.ChatCollection && WhatsAppAPI.ChatCollection.getActive)
        return WhatsAppAPI.ChatCollection.getActive();

    // fallback to old method. TODO: this is not currently working
    var elements = document.getElementsByClassName(UIClassNames.CHAT_PANEL_CLASS);
    if (!elements || elements.length === 0) return null;
    var reactResult = FindReact(elements[0], traverseUp = 2);
    var chat = reactResult && reactResult.props && reactResult.props.children &&
        reactResult.props.children.props && reactResult.props.children.props.children &&
        reactResult.props.children.props.children.props
        ? reactResult.props.children.props.children.props.chat
        : null;

    return chat;
}

function getCurrentChatPanel()
{
    var elements = document.getElementsByClassName(UIClassNames.CHAT_PANEL_CLASS);
    return elements[0];
}

function getPrefixFromJID(jid)
{
    return WAIJidUtils.prefixOfJid(jid);
}

function isChatBlocked(jid)
{
    var user = getPrefixFromJID(jid);

    for (var blockedJid in blockedChats)
    {
        var possibleLid = blockedChats[blockedJid].accountLid ? blockedChats[blockedJid].accountLid.toString() : "";
        if (getPrefixFromJID(blockedJid) == user || (possibleLid && getPrefixFromJID(possibleLid) == user))
            return true;
    }

    return false;
}

async function getChatByJID(jid)
{
    if (jid == undefined) console.warn("WhatsIncognito: unexpected condition: jid == undefined");
    jid = normalizeJID(jid);

    if (window.WhatsAppAPI && WhatsAppAPI.ChatCollection && WhatsAppAPI.ChatCollection.find)
    {
        try
        {
            var chat = await WhatsAppAPI.ChatCollection.find(jid);
            if (chat != null)
                return chat;
        }
        catch (e)
        {
            // fallback to old method
        }
    }

    // try to get it thorugh GUI
    var chatElem = findChatEntryElementForJID(jid);
    if (chatElem != null)
    {
        var data = FindReact(chatElem).props.data;
        if (data.data) chat = data.data;
        else chat = data.chat;
    }
    else
    {
        chat = chats[jid];
    }

    return chat;
}

function getJidOfChat(chat)
{
    if (!chat) return "";
    var jid = chat.accountLid ? chat.accountLid.toString() : (chat.id ? chat.id.toString() : "");
    return jid ? normalizeJID(jid) : "";
}

function normalizeJID(jid)
{
    return WAIJidUtils.normalizeJid(jid);
}

const arrayBufferToBase64 = (buffer) =>
{
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    var binary = '';
    var CHUNK_SIZE = 8192;
    for (var i = 0; i < len; i += CHUNK_SIZE)
    {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)));
    }
    return btoa(binary);
}

// Based on https://stackoverflow.com/a/39165137/1806873
function FindReact(dom, traverseUp = 0) 
{
    if (!dom) return null;
    const key = Object.keys(dom).find(key=>{
        return key.startsWith("__reactFiber$") // react 17+
            || key.startsWith("__reactInternalInstance$"); // react <17
    });
    const domFiber = key ? dom[key] : null;
    if (domFiber == null) return null;

    // react <16
    if (domFiber._currentElement) {
        let compFiber = domFiber._currentElement._owner;
        for (let i = 0; i < traverseUp && compFiber; i++) {
            compFiber = compFiber._currentElement ? compFiber._currentElement._owner : null;
        }
        return compFiber ? compFiber._instance : null;
    }

    // react 16+
    const GetCompFiber = fiber=>{
        //return fiber._debugOwner; // this also works, but is __DEV__ only
        let parentFiber = fiber ? fiber.return : null;
        while (parentFiber && typeof parentFiber.type == "string") {
            parentFiber = parentFiber.return;
        }
        return parentFiber;
    };
    let compFiber = GetCompFiber(domFiber);
    for (let i = 0; i < traverseUp && compFiber; i++) {
        compFiber = GetCompFiber(compFiber);
    }
    if (!compFiber) return null;

    var reactElement = null;

    if (compFiber.props != null)
    {
        reactElement = compFiber;
    }
    if (compFiber.memoizedProps != null)
    {
        compFiber.props = compFiber.memoizedProps;
        reactElement = compFiber;
    }
    
    if (compFiber.props == null && compFiber.memoizedProps == null)
    {
        reactElement = compFiber.stateNode;
    }

    return reactElement;
}

function makeLogMessage(args) 
{
    function mergeArrays(e, t)  {
        const n = [] , r = e.length , i = t.length , a = Math.max(r, i);
        for (let o = 0; o < a; o++)
            o < r && n.push(e[o]),
            o < i && n.push(t[o]);
        return n
    }

    for (var l = new Array(args.length > 1 ? args.length - 1 : 0), d = 1; d < args.length; d++)
        l[d - 1] = args[d];

    var strings = args[0]; var params = l;

    var message = mergeArrays(strings, params.map(String)).join("");
    return message;
}

function isEqualArray(a, b) 
{ 
    if (a.length != b.length) return false; 
    for (let i = 0; i < a.length; i++) 
        if (a[i] != b[i]) 
            return false; 
    
    return true; 
}

async function gzipInflate(buffer) 
{
    return toArrayBuffer(pako.inflate(new Uint8Array(buffer)));
}

function deepClone(object)
{
    // https://stackoverflow.com/questions/41474986/how-to-clone-a-javascript-es6-class-instance
    return Object.assign(Object.create(Object.getPrototypeOf(object)), object)
}


// Mobile and Waydroid viewport compatibility
(function ensureMobileCompatibility() {
    try {
        if (typeof document !== 'undefined' && !document.querySelector('meta[name="viewport"]')) {
            var meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes';
            (document.head || document.documentElement).appendChild(meta);
        }
    } catch (e) {}
})();