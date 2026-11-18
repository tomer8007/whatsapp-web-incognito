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
