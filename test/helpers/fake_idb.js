// Minimal fake indexedDB: versions, object store names, versionchange/blocked semantics. No data storage.
function createFakeIndexedDB(initial = {}) {
    const dbs = new Map();
    for (const [name, { version, stores }] of Object.entries(initial)) dbs.set(name, { version, stores: new Set(stores), connections: new Set() });
    const log = [];

    function open(name, version) {
        const req = { result: null, error: null };
        setTimeout(() => {
            let rec = dbs.get(name);
            if (!rec) { rec = { version: 0, stores: new Set(), connections: new Set() }; dbs.set(name, rec); }
            const target = version == null ? (rec.version || 1) : version;
            if (target < rec.version) { req.error = { name: "VersionError" }; req.onerror && req.onerror(); return; }
            const upgrading = target > rec.version;
            const finish = () => {
                const oldVersion = rec.version;
                const conn = {
                    name, version: target, closed: false,
                    objectStoreNames: { contains: (n) => rec.stores.has(n) },
                    close() { this.closed = true; rec.connections.delete(this); },
                };
                if (upgrading) {
                    req.result = conn;
                    req.transaction = {};
                    const created = [];
                    conn.createObjectStore = (n) => { rec.stores.add(n); created.push(n); return { createIndex() {} }; };
                    rec.version = target;
                    log.push({ name, from: oldVersion, to: target });
                    req.onupgradeneeded && req.onupgradeneeded({ oldVersion });
                }
                rec.connections.add(conn);
                req.result = conn;
                setTimeout(() => req.onsuccess && req.onsuccess(), 0);
            };
            if (!upgrading) return finish();
            const others = [...rec.connections];
            others.forEach((c) => c.onversionchange && c.onversionchange());
            const stillOpen = others.filter((c) => !c.closed);
            if (stillOpen.length === 0) return finish();
            req.onblocked && req.onblocked();
            const poll = () => (stillOpen.every((c) => c.closed) ? finish() : setTimeout(poll, 1));
            setTimeout(poll, 1);
        }, 0);
        return req;
    }
    return { open, dbs, log };
}

module.exports = { createFakeIndexedDB };
