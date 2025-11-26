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
        if (reactElement.props.data == undefined) continue;

        var data = reactElement.props.data;
        if (data.data == undefined && data.chat == undefined) continue;

        var id = data.data ? data.data.id : data.chat.id;

        var matches = false;
        if (typeof (jid) == "object" && id == jid)
        {
            matches = true;
        }
        else if (typeof (jid) == "string" && id.user == jid.split("@")[0].split(":")[0])
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

function getModuleFinder()
{
    if (window.mR) return window.mR;

    window.mR = new moduleRaid();

    return window.mR;
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

function nodeToXML(node)
{
    if  (typeof(node) == ArrayBuffer)
        return "<ArrayBuffer (" + node.byteLength + " bytes)>";

    var text = "<" + node.tag + " ";
    for (var attribute in node.attrs)
    {
        text += attribute + "='" + node.attrs[attribute] + "' ";
    }
    text += ">";

    if (node.content)
    {
        for (var subNode of node.content)
        {
            text += "\r\n";
            text += nodeToXML(subNode);
        }
    }

    text += "\r\n</"+node.tag+">";

    return text;
}

function getCurrentChat()
{
    if (window.WhatsAppAPI &&  WhatsAppAPI.ChatCollection && WhatsAppAPI.ChatCollection.getActive)
        return WhatsAppAPI.ChatCollection.getActive();

    // fallback to old method. TODO: this is not currently working
    var elements = document.getElementsByClassName(UIClassNames.CHAT_PANEL_CLASS);
    var reactResult = FindReact(elements[0], traverseUp = 2);
    var chat = reactResult.props.children.props.children.props.chat;
    
    return chat;
}

function getCurrentChatPanel()
{
    var elements = document.getElementsByClassName(UIClassNames.CHAT_PANEL_CLASS);
    return elements[0];
}

function isChatBlocked(jid)
{
    var user = jid.split("@")[0].split(":")[0];

    for (jid in blockedChats)
    {
        if (jid.split("@")[0].split(":")[0] == user)
            return true;
    }

    return false;
}

async function getChatByJID(jid)
{
    if (jid == undefined) debugger;
    jid = normalizeJID(jid);

    if (window.WhatsAppAPI && WhatsAppAPI.ChatCollection && WhatsAppAPI.ChatCollection.find)
    {
        try
        {
            var chat = await WhatsAppAPI.ChatCollection.find(jid);
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

function normalizeJID(jid)
{
    if (jid.includes("@s.whatsapp.net")) jid = jid.replace("@s.whatsapp.net", "@c.us");
    var suffix = jid.split("@")[1];
    var prefix = jid.split("@")[0].split(":")[0];

    return prefix + "@" + suffix;
}

const arrayBufferToBase64 = (buffer) =>
{
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++)
    {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function showToast(message)
{
    var appElement = document.getElementsByClassName("app-wrapper-web")[0];
    var toast = document.createElement("div");
    toast.setAttribute("class", "f1UZe");
    toast.style.transformOrigin = "left top";
    toast.innerHTML = "<div class=\"hYvJ8\">" + message + "</div>";
    appElement.insertBefore(toast, appElement.firstChild);
    Velocity(toast, { scale: [1, 0], opacity: [1, 0] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] });
    setTimeout(function () { Velocity(toast, { scale: [0, 1], opacity: [0, 1] }, { defaultDuration: 300, easing: [.1, .82, .25, 1] }); }, 4000);
}

function exportIdbDatabase(idbDatabase) 
{
    return new Promise((resolve, reject) => 
    {
      const exportObject = {};
      if (idbDatabase.objectStoreNames.length === 0) 
      {
        resolve(JSON.stringify(exportObject));
      } 
      else 
      {
        const transaction = idbDatabase.transaction(idbDatabase.objectStoreNames,'readonly');
        transaction.addEventListener('error', reject);
  
        for (const storeName of idbDatabase.objectStoreNames) 
        {
          const allObjects = [];
          transaction.objectStore(storeName).openCursor().addEventListener('success', event => 
          {
              const cursor = event.target.result;
              if (cursor) {
                // Cursor holds value, put it into store data
                allObjects.push(cursor.value);
                cursor.continue();
              } 
              else 
              {
                // No more values, store is done
                exportObject[storeName] = allObjects;
  
                // Last store was handled
                if (idbDatabase.objectStoreNames.length === Object.keys(exportObject).length) {
                  resolve(exportObject);
                }
              }
            })
        }
      }
    })
}

function importToIdbDatabase(idbDatabase, importObject) 
{
    return new Promise((resolve, reject) => {
      const transaction = idbDatabase.transaction(
        idbDatabase.objectStoreNames,
        'readwrite'
      )
      transaction.addEventListener('error', reject)
  
      for (const storeName of idbDatabase.objectStoreNames) {
        let count = 0
        for (const toAdd of importObject[storeName]) {
          const request = transaction.objectStore(storeName).add(toAdd)
          request.addEventListener('success', () => {
            count++
            if (count === importObject[storeName].length) {
              // Added all objects for this store
              delete importObject[storeName]
              if (Object.keys(importObject).length === 0) {
                // Added all object stores
                resolve()
              }
            }
          })
        }
      }
    })
}

function clearDatabase(idbDatabase) 
{
    return new Promise((resolve, reject) => {
        const transaction = idbDatabase.transaction(
        idbDatabase.objectStoreNames,
        'readwrite'
        )
        transaction.addEventListener('error', reject)

        let count = 0
        for (const storeName of idbDatabase.objectStoreNames) {
        transaction
            .objectStore(storeName)
            .clear()
            .addEventListener('success', () => {
            count++
            if (count === idbDatabase.objectStoreNames.length) {
                // Cleared all object stores
                resolve()
            }
            })
        }
    })
}

// Based on https://stackoverflow.com/a/39165137/1806873
function FindReact(dom, traverseUp = 0) 
{
    const key = Object.keys(dom).find(key=>{
        return key.startsWith("__reactFiber$") // react 17+
            || key.startsWith("__reactInternalInstance$"); // react <17
    });
    const domFiber = dom[key];
    if (domFiber == null) return null;

    // react <16
    if (domFiber._currentElement) {
        let compFiber = domFiber._currentElement._owner;
        for (let i = 0; i < traverseUp; i++) {
            compFiber = compFiber._currentElement._owner;
        }
        return compFiber._instance;
    }

    // react 16+
    const GetCompFiber = fiber=>{
        //return fiber._debugOwner; // this also works, but is __DEV__ only
        let parentFiber = fiber.return;
        while (typeof parentFiber.type == "string") {
            parentFiber = parentFiber.return;
        }
        return parentFiber;
    };
    let compFiber = GetCompFiber(domFiber);
    for (let i = 0; i < traverseUp; i++) {
        compFiber = GetCompFiber(compFiber);
    }

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

    if (reactElement == null)
    {
        debugger;
    }

    return reactElement;
}

function fixCSSPositionIfNeeded(drop)
{
    if (drop.style.transform.includes("translateX") && drop.style.transform.includes("translateY"))
    {
        var matrix = drop.style.transform.replace(/[^0-9\-.,\s]/g, '').split(' ');
        drop.style.left = matrix[0] + "px";
        drop.style.top = matrix[1] + "px";
        drop.style.transform = "";
    }
}

function getCSSRule(ruleName)
{
    var rules = {};
    var styleSheets = document.styleSheets;
    var styleSheetRules = null;
    for (var i = 0; i < styleSheets.length; ++i)
    {
        try
        {
            styleSheetRules = styleSheets[i].cssRules;
        }
        catch (e)
        {
            // Assume Chrome 64+ doesn't let us access this CSS due to security policies or whatever, just ignore
            continue;
        }
        if (styleSheetRules == null) continue;
        for (var j = 0; j < styleSheetRules.length; ++j)
            rules[styleSheetRules[j].selectorText] = styleSheetRules[j];
    }
    return rules[ruleName];
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


function base64ToArrayBuffer(base64) 
{
    var binary_string =  window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++)        
    {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

function toArayBufer(array)
{
    return array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset);
}