//
// Encrypted vault for archived messages (page world). WebCrypto only.
//
// Threat model: protects what is stored on disk / in the browser profile. It does NOT protect from WhatsApp Web itself,
// which holds the plaintext anyway.
//
// Hybrid design, so new records can be stored while the vault is locked:
//  - setup: an ECDH P-256 key pair. The public key is stored as-is. The private key (PKCS8) is encrypted with AES-GCM-256
//    using a key derived from the passphrase (PBKDF2-SHA256, 600000 iterations, 16-byte random salt).
//  - put: a fresh ephemeral ECDH pair per record; ECDH(ephemeral private, vault public) -> AES-GCM-256 key -> encrypt the
//    JSON record. Only {id, kind, ts, chatHash, size} are stored in plaintext (indexes and retention).
//  - reading needs the passphrase, which unwraps the private key into memory for this session only.
//

var VAULT_PBKDF2_ITERATIONS = 600000;

function vaultBytesToBase64(bytes)
{
    bytes = new Uint8Array(bytes);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function vaultBase64ToBytes(text)
{
    var binary = atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

var Vault = (function()
{
    var storage = null;
    var legacy = null;
    var iterations = VAULT_PBKDF2_ITERATIONS;
    var publicKey = null;
    var privateKey = null;

    var ECDH = { name: "ECDH", namedCurve: "P-256" };
    var LEGACY_KINDS = { msgs: "deleted", edits: "edit", ephemeral: "ephemeral" };

    function subtle() { return crypto.subtle; }

    function randomBytes(length)
    {
        var bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return bytes;
    }

    function requireStorage()
    {
        if (!storage) throw new Error("Vault is not initialized");
        return storage;
    }

    function requireUnlocked()
    {
        if (!privateKey) throw new Error("Vault is locked");
    }

    async function chatHash(chatJid)
    {
        if (!chatJid) return null;
        var digest = await subtle().digest("SHA-256", new TextEncoder().encode("waincognito-chat:" + chatJid));
        return Array.from(new Uint8Array(digest)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
    }

    async function deriveWrappingKey(passphrase, salt, iterationCount)
    {
        var base = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
        return subtle().deriveKey({ name: "PBKDF2", salt: salt, iterations: iterationCount, hash: "SHA-256" },
                                  base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    }

    async function getPublicKey()
    {
        if (publicKey) return publicKey;
        var meta = await requireStorage().getMeta();
        if (!meta) throw new Error("Vault is not set up");
        publicKey = await subtle().importKey("jwk", meta.publicKeyJwk, ECDH, true, []);
        return publicKey;
    }

    async function decryptStored(stored)
    {
        requireUnlocked();
        var ephemeralPublic = await subtle().importKey("jwk", stored.epk, ECDH, false, []);
        var key = await subtle().deriveKey({ name: "ECDH", public: ephemeralPublic }, privateKey,
                                           { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
        var plaintext = await subtle().decrypt({ name: "AES-GCM", iv: vaultBase64ToBytes(stored.iv) }, key, new Uint8Array(stored.ct));
        return JSON.parse(new TextDecoder().decode(plaintext));
    }

    async function decryptAll(storedRecords)
    {
        var records = [];
        storedRecords.sort(function(a, b) { return a.ts - b.ts; });
        for (var i = 0; i < storedRecords.length; i++) records.push(await decryptStored(storedRecords[i]));
        return records;
    }

    return {
        init: function(options)
        {
            storage = options.storage;
            legacy = options.legacy || null;
            iterations = options.iterations || VAULT_PBKDF2_ITERATIONS;
            publicKey = null;
            privateKey = null;
        },

        isSetUp: async function()
        {
            return (await requireStorage().getMeta()) != null;
        },

        setup: async function(passphrase)
        {
            if (!passphrase) throw new Error("Empty passphrase");
            if (await this.isSetUp()) throw new Error("Vault is already set up");

            var pair = await subtle().generateKey(ECDH, true, ["deriveKey"]);
            var publicKeyJwk = await subtle().exportKey("jwk", pair.publicKey);
            var pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
            var salt = randomBytes(16);
            var iv = randomBytes(12);
            var wrappingKey = await deriveWrappingKey(passphrase, salt, iterations);
            var wrapped = await subtle().encrypt({ name: "AES-GCM", iv: iv }, wrappingKey, pkcs8);

            await requireStorage().setMeta({
                publicKeyJwk: publicKeyJwk,
                wrappedPrivateKey: vaultBytesToBase64(wrapped),
                salt: vaultBytesToBase64(salt),
                iv: vaultBytesToBase64(iv),
                iterations: iterations,
            });

            publicKey = pair.publicKey;
            privateKey = await subtle().importKey("pkcs8", pkcs8, ECDH, false, ["deriveKey"]);
        },

        unlock: async function(passphrase)
        {
            var meta = await requireStorage().getMeta();
            if (!meta) return false;
            try
            {
                var wrappingKey = await deriveWrappingKey(passphrase, vaultBase64ToBytes(meta.salt), meta.iterations || iterations);
                var pkcs8 = await subtle().decrypt({ name: "AES-GCM", iv: vaultBase64ToBytes(meta.iv) }, wrappingKey,
                                                   vaultBase64ToBytes(meta.wrappedPrivateKey));
                privateKey = await subtle().importKey("pkcs8", pkcs8, ECDH, false, ["deriveKey"]);
                return true;
            }
            catch (e)
            {
                return false; // wrong passphrase: AES-GCM authentication fails
            }
        },

        lock: function() { privateKey = null; },

        isUnlocked: function() { return privateKey != null; },

        // works while locked
        put: async function(record)
        {
            if (!record || !record.id) throw new Error("A vault record needs an id");
            var vaultPublic = await getPublicKey();
            var ephemeral = await subtle().generateKey(ECDH, true, ["deriveKey"]);
            var key = await subtle().deriveKey({ name: "ECDH", public: vaultPublic }, ephemeral.privateKey,
                                               { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
            var iv = randomBytes(12);
            var ct = await subtle().encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(JSON.stringify(record)));

            await requireStorage().putRecord({
                id: String(record.id),
                kind: record.kind || "unknown",
                ts: typeof record.ts == "number" ? record.ts : Date.now(),
                chatHash: await chatHash(record.chatJid),
                size: ct.byteLength,
                epk: await subtle().exportKey("jwk", ephemeral.publicKey),
                iv: vaultBytesToBase64(iv),
                ct: new Uint8Array(ct),
            });
        },

        has: async function(id)
        {
            return (await requireStorage().getRecord(String(id))) != null;
        },

        get: async function(id)
        {
            requireUnlocked();
            var stored = await requireStorage().getRecord(String(id));
            return stored ? decryptStored(stored) : null;
        },

        listByChat: async function(chatJid, kind)
        {
            requireUnlocked();
            var hash = await chatHash(chatJid);
            var stored = (await requireStorage().listRecords()).filter(function(r)
            {
                return r.chatHash == hash && (!kind || r.kind == kind);
            });
            return decryptAll(stored);
        },

        listByIdPrefix: async function(prefix)
        {
            requireUnlocked();
            var stored = (await requireStorage().listRecords()).filter(function(r) { return r.id.indexOf(prefix) == 0; });
            return decryptAll(stored);
        },

        stats: async function()
        {
            var all = await requireStorage().listRecords();
            return { count: all.length, bytes: all.reduce(function(sum, r) { return sum + (r.size || 0); }, 0) };
        },

        // oldest first: everything older than maxDays, then the oldest until the total size is within maxBytes
        enforceRetention: async function(limits)
        {
            var now = limits.now != null ? limits.now : Date.now();
            var cutoff = now - limits.maxDays * 24 * 60 * 60 * 1000;
            var all = (await requireStorage().listRecords()).sort(function(a, b) { return a.ts - b.ts; });
            var removed = 0;
            var kept = [];
            for (var i = 0; i < all.length; i++)
            {
                if (all[i].ts < cutoff) { await requireStorage().deleteRecord(all[i].id); removed++; }
                else kept.push(all[i]);
            }
            var total = kept.reduce(function(sum, r) { return sum + (r.size || 0); }, 0);
            while (kept.length > 0 && total > limits.maxBytes)
            {
                var oldest = kept.shift();
                total -= oldest.size || 0;
                await requireStorage().deleteRecord(oldest.id);
                removed++;
            }
            return removed;
        },

        // deletedMsgs (plaintext IndexedDB) -> vault, then clear the old stores
        migrateFromPlaintextDB: async function()
        {
            if (!legacy) return 0;
            var items = await legacy.readAll();
            for (var i = 0; i < items.length; i++)
            {
                var record = Object.assign({}, items[i].record);
                record.kind = LEGACY_KINDS[items[i].store] || items[i].store;
                record.chatJid = record.chatJid || record.Jid;
                if (typeof record.ts != "number") record.ts = Date.now();
                await this.put(record);
            }
            await legacy.clearAll();
            return items.length;
        },
    };
})();

// In-memory storage (tests, and a fallback when IndexedDB is unavailable).
function createMemoryVaultStorage()
{
    var meta = null;
    var records = new Map();
    return {
        getMeta: async function() { return meta; },
        setMeta: async function(value) { meta = value; },
        putRecord: async function(record) { records.set(record.id, record); },
        getRecord: async function(id) { return records.has(id) ? records.get(id) : null; },
        deleteRecord: async function(id) { records.delete(id); },
        listRecords: async function() { return Array.from(records.values()); },
    };
}

// IndexedDB `waIncognitoVault`: store `meta` ({key: "main", ...}) and store `records` (keyPath id; indexes kind, ts, chatHash).
function createIndexedDBVaultStorage()
{
    var dbPromise = null;

    function open()
    {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function(resolve, reject)
        {
            var request = indexedDB.open("waIncognitoVault", 1);
            request.onupgradeneeded = function()
            {
                var db = request.result;
                if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
                if (!db.objectStoreNames.contains("records"))
                {
                    var records = db.createObjectStore("records", { keyPath: "id" });
                    records.createIndex("kind", "kind");
                    records.createIndex("ts", "ts");
                    records.createIndex("chatHash", "chatHash");
                }
            };
            request.onsuccess = function() { createIndexedDBVaultStorage.isOpen = true; resolve(request.result); };
            request.onerror = function() { reject(request.error); };
        });
        return dbPromise;
    }

    function run(storeName, mode, action)
    {
        return open().then(function(db)
        {
            return new Promise(function(resolve, reject)
            {
                var request = action(db.transaction(storeName, mode).objectStore(storeName));
                request.onsuccess = function() { resolve(request.result); };
                request.onerror = function() { reject(request.error); };
            });
        });
    }

    return {
        getMeta: async function()
        {
            var meta = await run("meta", "readonly", function(store) { return store.get("main"); });
            return meta || null;
        },
        setMeta: function(meta) { return run("meta", "readwrite", function(store) { return store.put(Object.assign({ key: "main" }, meta)); }); },
        putRecord: function(record) { return run("records", "readwrite", function(store) { return store.put(record); }); },
        getRecord: async function(id)
        {
            var record = await run("records", "readonly", function(store) { return store.get(id); });
            return record || null;
        },
        deleteRecord: function(id) { return run("records", "readwrite", function(store) { return store.delete(id); }); },
        listRecords: function() { return run("records", "readonly", function(store) { return store.getAll(); }); },
    };
}

// The old plaintext `deletedMsgs` database (opened by interception.js as window.deletedMessagesDB).
function createLegacyDeletedMsgsAdapter()
{
    var storeNames = ["msgs", "edits", "ephemeral"];

    function existingStores()
    {
        var db = window.deletedMessagesDB;
        if (!db) return [];
        return storeNames.filter(function(name) { return db.objectStoreNames.contains(name); });
    }

    function request(storeName, mode, action)
    {
        return new Promise(function(resolve, reject)
        {
            var req = action(window.deletedMessagesDB.transaction(storeName, mode).objectStore(storeName));
            req.onsuccess = function() { resolve(req.result); };
            req.onerror = function() { reject(req.error); };
        });
    }

    return {
        readAll: async function()
        {
            var items = [];
            var stores = existingStores();
            for (var i = 0; i < stores.length; i++)
            {
                var records = await request(stores[i], "readonly", function(store) { return store.getAll(); });
                records.forEach(function(record) { items.push({ store: stores[i], record: record }); });
            }
            return items;
        },
        clearAll: async function()
        {
            var stores = existingStores();
            for (var i = 0; i < stores.length; i++)
                await request(stores[i], "readwrite", function(store) { return store.clear(); });
        },
    };
}
