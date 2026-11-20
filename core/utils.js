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
        else if (data.data.accountLid && data.data.accountLid.toString() == jid)
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
        var possibleLid = blockedChats[jid].accountLid ? blockedChats[jid].accountLid.toString() : "";
        if (jid.split("@")[0].split(":")[0] == user || possibleLid.split("@")[0].split(":")[0] == user)
            return true;
    }

    return false;
}

//
// Chat lookup that understands both phone-number (PN) and LID ids. WhatsApp keys most chats by LID now, but incoming nodes
// are rewritten to the sender's PN, and ChatCollection.get(pnWid) returns nothing for a LID chat (verified on the live build:
// 0 of 40 found by PN, 40 of 40 through toLid). Order: the JID as given, its LID/PN counterpart (WAWebLidMigrationUtils, then our
// own lidPnMap), and as a last resort a scan of the loaded chats for the message id (known for edits and revokes).
//
// deps: { collection: {get(wid), getModelsArray()}, createWid(jid), lidUtils: {toLid(wid), toPn(wid)}, lidPnMap: Map }
function lookupCandidateJids(jid, deps)
{
    var candidates = [];
    function add(value)
    {
        if (value == null) return;
        var text = normalizeJID(String(value));
        if (candidates.indexOf(text) == -1) candidates.push(text);
    }

    add(jid);
    var server = String(jid).split("@")[1];
    try
    {
        if (deps.lidUtils && deps.createWid)
        {
            var wid = deps.createWid(normalizeJID(String(jid)));
            if (server == "c.us" || server == "s.whatsapp.net") add(deps.lidUtils.toLid(wid));
            else if (server == "lid") add(deps.lidUtils.toPn(wid));
        }
    }
    catch (e) { /* no mapping known */ }
    if (deps.lidPnMap) add(deps.lidPnMap.get(normalizeJID(String(jid))));
    return candidates;
}

function resolveChat(deps, jid, messageId)
{
    var collection = deps.collection;
    if (!collection) return null;

    var candidates = lookupCandidateJids(jid, deps);
    for (var i = 0; i < candidates.length; i++)
    {
        try
        {
            var chat = collection.get(deps.createWid(candidates[i]));
            if (chat) return chat;
        }
        catch (e) { /* try the next form */ }
    }

    if (messageId && collection.getModelsArray)
    {
        var chats = collection.getModelsArray();
        for (var c = 0; c < chats.length; c++)
        {
            try
            {
                var models = chats[c].msgs && chats[c].msgs.getModelsArray ? chats[c].msgs.getModelsArray() : [];
                for (var m = 0; m < models.length; m++)
                    if (models[m].id && models[m].id.id == messageId) return chats[c];
            }
            catch (e) { /* skip this chat */ }
        }
    }
    return null;
}

// the live dependencies, or null while WhatsApp is not ready
function liveChatLookupDeps()
{
    if (!window.WhatsAppAPI || !WhatsAppAPI.ChatCollection || !WhatsAppAPI.WAWebWidFactory) return null;
    var lidUtils = null;
    try { lidUtils = require("WAWebLidMigrationUtils"); } catch (e) { lidUtils = null; }
    return {
        collection: WhatsAppAPI.ChatCollection,
        createWid: function(jid) { return WhatsAppAPI.WAWebWidFactory.createWid(jid); },
        lidUtils: lidUtils,
        lidPnMap: typeof lidPnMap != "undefined" ? lidPnMap : null,
    };
}

// the other id forms of a JID (LID for a PN, PN for a LID) from WhatsApp's own mapping; [] when unknown
function liveLidCounterparts(jid)
{
    var deps = liveChatLookupDeps();
    if (!deps) return [];
    var normalized = normalizeJID(String(jid));
    return lookupCandidateJids(jid, { lidUtils: deps.lidUtils, createWid: deps.createWid, lidPnMap: null }).filter(function(c) { return c != normalized; });
}

// The PN form of a chat's id (for LID chats), as a normalized JID, or null
function chatPnJid(chat)
{
    try
    {
        if (!chat || !chat.id || chat.id.server != "lid") return null;
        var lidUtils = require("WAWebLidMigrationUtils");
        var pn = lidUtils.toPn(chat.id);
        return pn ? normalizeJID(pn.toString()) : null;
    }
    catch (e) { return null; }
}

// jid: a PN or LID JID. messageId (optional): lets the lookup fall back to scanning the loaded chats.
async function getChatByJID(jid, messageId)
{
    if (jid == undefined) waDebugBreak();
    jid = normalizeJID(jid);

    var deps = liveChatLookupDeps();
    if (deps)
    {
        var resolved = resolveChat(deps, jid, messageId);
        if (resolved) return resolved;
    }

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
    var jid = chat.accountLid ? chat.accountLid.toString() : chat.id.toString();
    return normalizeJID(jid);
}

// does this chat belong to the JID? Compares every form of the chat (its id, its LID and its PN)
function chatMatchesJid(chat, jid)
{
    if (!chat || !chat.id || jid == null) return false;
    var wanted = normalizeJID(String(jid));
    var forms = [chat.id, chat.accountLid, chatPnJid(chat)];
    for (var i = 0; i < forms.length; i++)
    {
        if (forms[i] && normalizeJID(forms[i].toString()) == wanted) return true;
    }
    return !!(chat.id.user && chat.id.user == wanted.split("@")[0]);
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
        waDebugBreak();
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

// Pauses in the debugger only in debug mode (type `WAdebugMode = true` in the console).
function waDebugBreak()
{
    if (window.WAdebugMode)
    {
        debugger;
    }
}

// Returns the first loaded module export named `exportName` (optionally only in modules whose name matches `nameHint`), or null.
// Uses the Meta module system map (require("__debug").modulesMap). Modules that are not initialized yet are only
// required when their name matches `nameHint`. Hits are cached; all errors are swallowed.
var findExportCache = new Map();
function findExport(exportName, nameHint)
{
    var cacheKey = exportName + "|" + (nameHint ? String(nameHint) : "");
    if (findExportCache.has(cacheKey)) return findExportCache.get(cacheKey);

    var modulesMap = null;
    try
    {
        modulesMap = require("__debug").modulesMap;
    }
    catch (e)
    {
        return null;
    }
    if (!modulesMap) return null;

    var names = Object.keys(modulesMap);
    for (var i = 0; i < names.length; i++)
    {
        var name = names[i];
        try
        {
            var record = modulesMap[name];
            var exports = record ? record.exports : null;
            if ((exports == null || typeof exports != "object") && nameHint && nameHint.test(name))
            {
                exports = require(name);
            }
            if (exports != null && (typeof exports == "object" || typeof exports == "function") && exports[exportName] != null)
            {
                findExportCache.set(cacheKey, exports[exportName]);
                return exports[exportName];
            }
        }
        catch (e)
        {
            // module failed to load: skip it
        }
    }

    return null;
}

//
// IndexedDB helper. It lives here (not in its own file) so it is always loaded before vault.js and interception.js.
//
// Self-healing IndexedDB opener (page world). Never deletes data.
//
// openDatabaseHealing({ indexedDB, name, upgrade, isHealthy, onOpen, onClose, log })
//   1. Opens `name` WITHOUT a version, so any existing version works (2, 3 with or without the stores, higher).
//      A database that does not exist yet is created at v1 and `upgrade(db, txn, 0)` builds the whole schema.
//   2. If `isHealthy(db)` is false (a store is missing), closes and reopens at db.version + 1 and runs
//      `upgrade(db, txn, oldVersion)`. `upgrade` must create only what is missing (guard with contains()).
//   3. Installs `onversionchange` (close, so another tab or an old connection never blocks an upgrade)
//      and re-opens afterwards (unless `reopenOnVersionChange: false`, for lazy openers). `onOpen(db)` is called for every usable connection, `onClose(db)` when it is released.
// Resolves with the open connection, rejects when the open fails.
function openDatabaseHealing(options)
{
    var idb = options.indexedDB;
    var log = options.log || function() {};
    var healAttempts = 0;

    function request(version)
    {
        return new Promise(function(resolve, reject)
        {
            var req = version == null ? idb.open(options.name) : idb.open(options.name, version);
            req.onupgradeneeded = function(event)
            {
                options.upgrade(req.result, req.transaction, event.oldVersion || 0);
            };
            req.onblocked = function()
            {
                // Another connection still holds an older version. It will get versionchange and close;
                // this request then continues by itself.
                log("WhatsIncognito: database '" + options.name + "' upgrade is waiting for other connections to close");
            };
            req.onerror = function() { reject(req.error); };
            req.onsuccess = function() { resolve(req.result); };
        });
    }

    function attach(db)
    {
        db.onversionchange = function()
        {
            try { db.close(); } catch (e) {}
            if (options.onClose) options.onClose(db);
            // Re-open once whoever is upgrading is done. Errors are not fatal: the next page load opens it again.
            if (options.reopenOnVersionChange !== false)
            {
                openDatabaseHealing(options).catch(function(e) { log("WhatsIncognito: reopening '" + options.name + "' failed", e); });
            }
        };
        db.onclose = function() { if (options.onClose) options.onClose(db); };
        if (options.onOpen) options.onOpen(db);
        return db;
    }

    return request(null).then(function(db)
    {
        var healthy = true;
        try { healthy = options.isHealthy(db); } catch (e) { healthy = false; }
        if (healthy || healAttempts++ > 0)
        {
            return attach(db);
        }
        var nextVersion = db.version + 1;
        db.close();
        log("WhatsIncognito: healing database '" + options.name + "' (v" + db.version + " -> v" + nextVersion + ")");
        return request(nextVersion).then(attach);
    });
}
