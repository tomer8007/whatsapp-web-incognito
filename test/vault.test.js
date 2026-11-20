const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

const FAST_ITERATIONS = 1000; // the real default (600000) is checked separately; tests use a small count for speed

function loadVault({ legacy } = {}) {
    const sandbox = createSandbox({ crypto: globalThis.crypto, TextEncoder, TextDecoder, atob });
    loadScripts(sandbox, ["core/vault.js"]);
    const storage = sandbox.createMemoryVaultStorage();
    sandbox.Vault.init({ storage, legacy, iterations: FAST_ITERATIONS });
    return { Vault: sandbox.Vault, storage, sandbox };
}

const DAY = 24 * 60 * 60 * 1000;

test("PBKDF2 uses 600000 iterations by default", () => {
    const sandbox = createSandbox({ crypto: globalThis.crypto, TextEncoder, TextDecoder, atob });
    loadScripts(sandbox, ["core/vault.js"]);
    assert.strictEqual(sandbox.VAULT_PBKDF2_ITERATIONS, 600000);
});

test("setup, put and get round-trip", async () => {
    const { Vault } = loadVault();
    assert.strictEqual(await Vault.isSetUp(), false);
    await Vault.setup("kata sandi panjang");
    assert.strictEqual(await Vault.isSetUp(), true);
    assert.strictEqual(Vault.isUnlocked(), true);

    await Vault.put({ id: "A1", kind: "deleted", ts: 1000, chatJid: "628111@c.us", body: "halo", media: "AAEC" });
    const record = await Vault.get("A1");
    assert.strictEqual(record.body, "halo");
    assert.strictEqual(record.media, "AAEC");
    assert.strictEqual(await Vault.get("missing"), null);
});

test("setup twice is refused", async () => {
    const { Vault } = loadVault();
    await Vault.setup("pw-1");
    await assert.rejects(Vault.setup("pw-2"));
});

test("a wrong passphrase is rejected, the right one unlocks", async () => {
    const { Vault } = loadVault();
    await Vault.setup("benar");
    Vault.lock();
    assert.strictEqual(Vault.isUnlocked(), false);
    assert.strictEqual(await Vault.unlock("wrong"), false);
    assert.strictEqual(Vault.isUnlocked(), false);
    assert.strictEqual(await Vault.unlock("benar"), true);
    assert.strictEqual(Vault.isUnlocked(), true);
});

test("put works while locked; get needs an unlock", async () => {
    const { Vault } = loadVault();
    await Vault.setup("pw");
    Vault.lock();

    await Vault.put({ id: "L1", kind: "deleted", ts: 5, chatJid: "1@c.us", body: "while locked" });
    assert.strictEqual(await Vault.has("L1"), true, "existence is visible while locked");
    await assert.rejects(Vault.get("L1"), /locked/);

    assert.strictEqual(await Vault.unlock("pw"), true);
    assert.strictEqual((await Vault.get("L1")).body, "while locked");
});

test("stored records hold no plaintext: chatHash is not the raw JID, body is encrypted", async () => {
    const { Vault, storage } = loadVault();
    await Vault.setup("pw");
    await Vault.put({ id: "P1", kind: "deleted", ts: 1, chatJid: "628999@c.us", body: "rahasia sekali" });

    const stored = await storage.getRecord("P1");
    assert.ok(stored.chatHash);
    assert.notStrictEqual(stored.chatHash, "628999@c.us");
    assert.ok(!stored.chatHash.includes("628999"));
    const dump = JSON.stringify(stored) + Buffer.from(stored.ct).toString("latin1");
    assert.ok(!dump.includes("rahasia sekali"));
    assert.ok(!dump.includes("628999"));
    assert.deepStrictEqual(Object.keys(stored).sort(), ["chatHash", "ct", "epk", "id", "iv", "kind", "size", "ts"]);
});

test("listByChat returns only that chat's records of that kind", async () => {
    const { Vault } = loadVault();
    await Vault.setup("pw");
    await Vault.put({ id: "e1", kind: "ephemeral", ts: 2, chatJid: "a@c.us", text: "satu" });
    await Vault.put({ id: "e2", kind: "ephemeral", ts: 1, chatJid: "a@c.us", text: "dua" });
    await Vault.put({ id: "e3", kind: "ephemeral", ts: 3, chatJid: "b@c.us", text: "lain" });
    await Vault.put({ id: "d1", kind: "deleted", ts: 4, chatJid: "a@c.us", body: "x" });

    const list = await Vault.listByChat("a@c.us", "ephemeral");
    assert.deepStrictEqual([...list.map((r) => r.id)], ["e2", "e1"], "sorted oldest first");
});

test("retention drops records older than maxDays", async () => {
    const { Vault } = loadVault();
    await Vault.setup("pw");
    const now = 100 * DAY;
    await Vault.put({ id: "old", kind: "deleted", ts: now - 91 * DAY, chatJid: "a@c.us" });
    await Vault.put({ id: "new", kind: "deleted", ts: now - 1 * DAY, chatJid: "a@c.us" });

    await Vault.enforceRetention({ maxDays: 90, maxBytes: 1e9, now });
    assert.strictEqual(await Vault.has("old"), false);
    assert.strictEqual(await Vault.has("new"), true);
});

test("retention drops the oldest records first when over the size limit", async () => {
    const { Vault, storage } = loadVault();
    await Vault.setup("pw");
    const big = "x".repeat(1000);
    await Vault.put({ id: "r1", kind: "deleted", ts: 1, chatJid: "a@c.us", body: big });
    await Vault.put({ id: "r2", kind: "deleted", ts: 2, chatJid: "a@c.us", body: big });
    await Vault.put({ id: "r3", kind: "deleted", ts: 3, chatJid: "a@c.us", body: big });
    const size = (await storage.getRecord("r3")).size;

    await Vault.enforceRetention({ maxDays: 100000, maxBytes: size * 2, now: 10 });
    assert.strictEqual(await Vault.has("r1"), false, "oldest goes first");
    assert.strictEqual(await Vault.has("r2"), true);
    assert.strictEqual(await Vault.has("r3"), true);
});

test("migration moves the plaintext DB into the vault and clears it", async () => {
    let cleared = false;
    const legacy = {
        readAll: async () => [
            { store: "msgs", record: { id: "m1", originalID: "m1", Jid: "628@c.us", body: "lama", isMedia: false } },
            { store: "edits", record: { id: "edit:t1:5", targetId: "t1", original: "original", ts: 5 } },
        ],
        clearAll: async () => { cleared = true; },
    };
    const { Vault } = loadVault({ legacy });
    await Vault.setup("pw");

    const moved = await Vault.migrateFromPlaintextDB();
    assert.strictEqual(moved, 2);
    assert.strictEqual(cleared, true);
    const migrated = await Vault.get("m1");
    assert.strictEqual(migrated.body, "lama");
    assert.strictEqual(migrated.kind, "deleted");
    assert.strictEqual((await Vault.get("edit:t1:5")).kind, "edit");
    assert.strictEqual((await Vault.listByChat("628@c.us", "deleted")).length, 1);
});

test("listByIdPrefix finds records by their plaintext id prefix", async () => {
    const { Vault } = loadVault();
    await Vault.setup("pw");
    await Vault.put({ id: "edit:T:1", kind: "edit", ts: 1, original: "a" });
    await Vault.put({ id: "edit:T:2", kind: "edit", ts: 2, original: "b" });
    await Vault.put({ id: "edit:U:1", kind: "edit", ts: 3, original: "c" });
    const list = await Vault.listByIdPrefix("edit:T:");
    assert.deepStrictEqual([...list.map((r) => r.original)], ["a", "b"]);
});
