const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts, drainTimers } = require("./helpers/sandbox");

const SENDER = "628123@s.whatsapp.net";

function load({ collection } = {}) {
    const sandbox = createSandbox({
        Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } },
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
        require: (name) => (name == "WAWebStatusCollection" && collection ? { StatusV3CollectionImpl: collection } : {}),
    });
    loadScripts(sandbox, ["core/options_schema.js", "core/edit_tracker.js", "core/node_handler.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    sandbox.WAIncognitoOptions = { ...sandbox.defaultOptions() };
    sandbox.optionsReceivedAt = Date.now(); // settings are loaded
    return sandbox;
}

function fakeCollection(messages) {
    const calls = [];
    return {
        calls,
        get: (wid) => { calls.push(String(wid)); return { msgs: { getModelsArray: () => messages } }; },
        getModelsArray: () => [],
    };
}

test("a status revoke looks in the status collection, never in getChatByJID", async () => {
    const collection = fakeCollection([{ id: { id: "S1" }, t: 5 }, { id: { id: "OTHER" } }]);
    const s = load({ collection });
    let chatLookups = 0;
    s.getChatByJID = async () => { chatLookups++; return null; };
    const saved = [];
    s.saveDeletedMessage = (msg, key, revokeId, kind) => saved.push({ id: msg.id.id, kind, participant: key.participant, remoteJid: key.remoteJid });

    await s.findDeletedMessageAndSaveContents({ protocolMessage: { key: {} } }, "status@broadcast", "R1", "S1", 0, SENDER);

    assert.strictEqual(chatLookups, 0);
    assert.strictEqual(collection.calls.length, 1);
    assert.deepStrictEqual(saved.map((x) => ({ ...x })), [{ id: "S1", kind: "status", participant: SENDER, remoteJid: "status@broadcast" }]);
    assert.strictEqual(s.__timers.length, 0, "found: no retry");
});

test("a missing status collection retries and finally gives up", async () => {
    const s = load({});
    let chatLookups = 0;
    s.getChatByJID = async () => { chatLookups++; return null; };

    await s.findDeletedMessageAndSaveContents({ protocolMessage: { key: {} } }, "status@broadcast", "R1", "S1", 0, SENDER);
    const ran = await drainTimers(s);

    assert.strictEqual(chatLookups, 0);
    assert.strictEqual(ran, 30, "30 retries, then it stops");
    assert.strictEqual(s.__timers.length, 0);
});

test("a status that is not in the collection yet is retried", async () => {
    const s = load({ collection: fakeCollection([]) });
    await s.findDeletedMessageAndSaveContents({ protocolMessage: { key: {} } }, "status@broadcast", "R1", "S1", 0, SENDER);
    assert.strictEqual(s.__timers.length, 1);
});

test("a revoke of a status is blocked when only saveDeletedStatus is on", () => {
    const s = load({});
    s.saveDeletedMsgsHookEnabled = false;
    assert.strictEqual(s.NodeHandler.shouldBlockRevoke("status@broadcast"), false);
    s.WAIncognitoOptions.saveDeletedStatus = true;
    assert.strictEqual(s.NodeHandler.shouldBlockRevoke("status@broadcast"), true);
    assert.strictEqual(s.NodeHandler.shouldBlockRevoke("111@c.us"), false, "chat revokes follow saveDeletedMsgs only");
});

test("a revoke of a status is also blocked when saveDeletedMsgs is on", () => {
    const s = load({});
    s.saveDeletedMsgsHookEnabled = true;
    assert.strictEqual(s.NodeHandler.shouldBlockRevoke("status@broadcast"), true);
    assert.strictEqual(s.NodeHandler.shouldBlockRevoke("111@c.us"), true);
});

test("the status node keeps status@broadcast as remoteJid even with sender_pn, and passes the participant", async () => {
    const s = load({});
    s.WAIncognitoOptions.saveDeletedStatus = true;
    const seen = [];
    s.onDeletionMessageBlocked = (message, remoteJid, messageId, deletedId, participant) => seen.push({ remoteJid, deletedId, participant });
    const node = { tag: "message", attrs: { id: "R1", from: "status@broadcast", participant: SENDER, sender_pn: "628123@s.whatsapp.net" }, content: [] };
    const revoke = { protocolMessage: { type: 0, key: { id: "S1", participant: SENDER } }, viewOnceMessageV2: null, viewOnceMessageV2Extension: null };

    const allowed = await s.NodeHandler.onReceivedE2EMessage(node, revoke);

    assert.strictEqual(allowed, false);
    assert.deepStrictEqual(seen.map((x) => ({ ...x })), [{ remoteJid: "status@broadcast", deletedId: "S1", participant: SENDER }]);
});

test("the toast for a deleted status is sent even if the status is not saved", async () => {
    const s = load({});
    s.WAIncognitoOptions.saveDeletedStatus = false;
    s.saveDeletedMsgsHookEnabled = true; // blocked through saveDeletedMsgs
    const toasts = [];
    s.notifyDeletedMessage = (kind, jid, id, nameJid) => toasts.push({ kind, jid, nameJid });
    let saves = 0;
    s.findDeletedMessageAndSaveContents = async () => { saves++; };

    s.onDeletionMessageBlocked({ protocolMessage: { key: {} } }, "status@broadcast", "R1", "S1", SENDER);
    await drainTimers(s);

    assert.deepStrictEqual(toasts.map((x) => ({ ...x })), [{ kind: "status-delete", jid: "status@broadcast", nameJid: SENDER }]);
    assert.strictEqual(saves, 0, "not saved without saveDeletedStatus");
});

test("findStatusMessageIdInFiber finds the viewed status id in the React props chain", () => {
    const s = load({});
    const fiber = { memoizedProps: {}, return: { memoizedProps: { foo: 1 }, return: { memoizedProps: { msg: { id: { id: "S9", remote: "status@broadcast" } } }, return: null } } };
    assert.strictEqual(s.findStatusMessageIdInFiber(fiber), "S9");
    assert.strictEqual(s.findStatusMessageIdInFiber({ memoizedProps: {}, return: null }), null);
    assert.strictEqual(s.findStatusMessageIdInFiber(null), null);
});

test("legacy migration respects an explicit record kind", async () => {
    const sandbox = createSandbox({ crypto: globalThis.crypto, TextEncoder, TextDecoder, atob });
    loadScripts(sandbox, ["core/vault.js"]);
    const storage = sandbox.createMemoryVaultStorage();
    const legacy = {
        readAll: async () => [{ store: "msgs", record: { id: "S1", kind: "status", Jid: "status@broadcast", body: "x" } },
                              { store: "msgs", record: { id: "D1", Jid: "1@c.us", body: "y" } }],
        clearAll: async () => {},
    };
    sandbox.Vault.init({ storage, legacy, iterations: 1000 });
    await sandbox.Vault.setup("pw");
    await sandbox.Vault.migrateFromPlaintextDB();
    assert.strictEqual((await sandbox.Vault.get("S1")).kind, "status");
    assert.strictEqual((await sandbox.Vault.get("D1")).kind, "deleted");
});
