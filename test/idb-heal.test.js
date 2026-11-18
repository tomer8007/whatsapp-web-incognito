const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");
const { createFakeIndexedDB } = require("./helpers/fake_idb");

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const realTimers = { setTimeout };

function load(initial) {
    const fake = createFakeIndexedDB(initial);
    const s = createSandbox({ indexedDB: fake, setTimeout: realTimers.setTimeout, clearTimeout });
    loadScripts(s, ["core/utils.js", "core/interception.js"]);
    return { s, fake };
}
const stores = (fake, name) => [...fake.dbs.get(name).stores].sort();
const ALL = ["edits", "ephemeral", "msgs"];

test("deletedMsgs: fresh install creates every store", async () => {
    const { s, fake } = load({});
    await s.initializeDeletedMessagesDB();
    assert.deepStrictEqual(stores(fake, "deletedMsgs"), ALL);
    assert.ok(s.window.deletedMessagesDB);
});

test("deletedMsgs: v2 with only msgs is upgraded, msgs kept", async () => {
    const { s, fake } = load({ deletedMsgs: { version: 2, stores: ["msgs"] } });
    await s.initializeDeletedMessagesDB();
    assert.deepStrictEqual(stores(fake, "deletedMsgs"), ALL);
    assert.strictEqual(fake.dbs.get("deletedMsgs").version, 3);
});

test("deletedMsgs: v3 WITHOUT the new stores self-heals to v4", async () => {
    const { s, fake } = load({ deletedMsgs: { version: 3, stores: ["msgs"] } });
    await s.initializeDeletedMessagesDB();
    assert.deepStrictEqual(stores(fake, "deletedMsgs"), ALL);
    assert.strictEqual(fake.dbs.get("deletedMsgs").version, 4);
    assert.strictEqual(s.window.deletedMessagesDB.version, 4);
    assert.ok(s.isDeletedMsgsDBHealthy(s.window.deletedMessagesDB));
});

test("deletedMsgs: healthy v3 and higher versions are left alone", async () => {
    for (const version of [3, 7]) {
        const { s, fake } = load({ deletedMsgs: { version, stores: ALL } });
        await s.initializeDeletedMessagesDB();
        assert.strictEqual(fake.dbs.get("deletedMsgs").version, version);
        assert.strictEqual(fake.log.length, 0);
    }
});

test("an old connection that gets versionchange closes, so it never blocks the upgrade", async () => {
    const { s, fake } = load({ deletedMsgs: { version: 2, stores: ["msgs"] } });
    // an old v2 connection from another tab that cooperates
    const old = fake.open("deletedMsgs");
    await wait();
    old.result.onversionchange = () => old.result.close();
    await s.initializeDeletedMessagesDB();
    assert.deepStrictEqual(stores(fake, "deletedMsgs"), ALL);
});

test("when another tab upgrades, our connection closes and reopens", async () => {
    const { s, fake } = load({ deletedMsgs: { version: 3, stores: ALL } });
    await s.initializeDeletedMessagesDB();
    const first = s.window.deletedMessagesDB;
    const other = fake.open("deletedMsgs", 4);
    other.onupgradeneeded = () => {};
    await wait(60);
    assert.ok(first.closed);
    assert.ok(s.window.deletedMessagesDB && !s.window.deletedMessagesDB.closed);
    assert.strictEqual(s.window.deletedMessagesDB.version, 4);
});

test("vault DB is created and heals through the same opener", async () => {
    const fake = createFakeIndexedDB({ waIncognitoVault: { version: 1, stores: ["meta"] } });
    const s = createSandbox({ indexedDB: fake, setTimeout: realTimers.setTimeout, clearTimeout });
    loadScripts(s, ["core/utils.js", "core/vault.js"]);
    const storage = s.createIndexedDBVaultStorage();
    await storage.getMeta().catch(() => {}); // fake has no transactions; only the open matters
    assert.deepStrictEqual(stores(fake, "waIncognitoVault"), ["meta", "records"]);
});
