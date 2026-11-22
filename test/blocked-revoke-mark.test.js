const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts, drainTimers } = require("./helpers/sandbox");

function load({ rules, realSave } = {}) {
    const sandbox = createSandbox({
        Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } },
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
    });
    loadScripts(sandbox, ["core/options_schema.js", "core/utils.js", "core/contact_rules.js", "core/edit_tracker.js", "core/node_handler.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    sandbox.WAIncognitoOptions = { ...sandbox.defaultOptions() };
    sandbox.optionsReceivedAt = Date.now();
    sandbox.contactRulesReceived = true;
    sandbox.contactRules = rules || {};
    // a page whose rows we control
    sandbox.rows = [];
    sandbox.document.querySelectorAll = (selector) => (sandbox.rows.filter((r) => selector.includes(r.id)));
    sandbox.notifyDeletedMessage = () => {};
    if (!realSave) sandbox.findDeletedMessageAndSaveContents = async () => {};
    return sandbox;
}

const row = (id) => ({ id, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
const message = { protocolMessage: { key: { id: "A1" } } };

test("a blocked revoke remembers the deleted message id (ids only, in memory)", () => {
    const s = load();
    s.onDeletionMessageBlocked(message, "111@c.us", "R1", "A1", "111@c.us");
    assert.strictEqual(s.blockedRevokedIds.has("A1"), true);
    assert.strictEqual(s.blockedRevokedIds.size, 1);
});

test("a row that appears after the block is marked by the re-tries", () => {
    const s = load();
    s.onDeletionMessageBlocked(message, "111@c.us", "R1", "A1", "111@c.us");
    const timers = [...s.__timers];
    // block time: the row does not exist yet
    timers[0].fn ? timers[0].fn() : timers[0]();
    const late = row("A1");
    s.rows.push(late);
    assert.strictEqual(late.attrs["data-incognito-deleted"], undefined);
    return drainTimers(s).then(() => assert.strictEqual(late.attrs["data-incognito-deleted"], "true"));
});

test("no mark when the contact turned markDeleted off", () => {
    const s = load({ rules: { "111@c.us": { markDeleted: "off" } } });
    const r = row("A1");
    s.rows.push(r);
    assert.strictEqual(s.markBlockedRevokeRows("A1", "111@c.us"), 0);
    assert.strictEqual(r.attrs["data-incognito-deleted"], undefined);
    assert.strictEqual(s.markBlockedRevokeRows("A1", "222@c.us"), 1, "other contacts still follow the default");
});

test("the save retries when the lookup throws, stays bounded, and never throws itself", async () => {
    const s = load({ realSave: true });
    let lookups = 0;
    s.getChatByJID = async () => { lookups++; throw new Error("chat not ready"); };
    await s.findDeletedMessageAndSaveContents(message, "111@c.us", "R1", "A1");
    const ran = await drainTimers(s);
    assert.strictEqual(ran, 30);
    assert.strictEqual(lookups, 31);
    assert.strictEqual(s.__timers.length, 0);
});

test("the original is saved once WhatsApp has it, and the success is reported", async () => {
    const s = load({ realSave: true });
    const chat = { msgs: { getModelsArray: () => (chat.ready ? [{ id: { id: "A1" } }] : []) }, loadEarlierMsgs: async () => {} };
    s.getChatByJID = async () => chat;
    s.saved = [];
    s.saveDeletedMessage = async (m) => { s.saved.push(m.id.id); return true; };
    await s.findDeletedMessageAndSaveContents(message, "111@c.us", "R1", "A1");
    assert.strictEqual(s.saved.length, 0);
    chat.ready = true;
    await drainTimers(s);
    assert.deepStrictEqual([...s.saved], ["A1"]);
});

test("the page-world answer carries blockedRevoke and the UI marks such a row even without a DB record", () => {
    const fs = require("node:fs"), path = require("node:path");
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(/blockedRevokedIds\.has\(String\(msgID\)\)/.test(read("core/injected_ui.js")));
    assert.ok(/data\.blockedRevoke && messageData == undefined\)\s*\{[^}]*markMessageDeleted\(messageNode\)/.test(read("core/ui.js")));
});

test("the offline-sync log reports markedOnScreen and savedToDb for a blocked revoke (booleans only)", () => {
    const s = createSandbox({});
    loadScripts(s, ["core/offline_sync_log.js"]);
    s.OfflineSyncLog.record({ tag: "message", attrs: { id: "R1", from: "1@c.us" } }, { protocolMessage: { type: 0, key: { id: "A1" } } }, true, true);
    s.OfflineSyncLog.noteRevoke("A1", { markedOnScreen: false });
    s.OfflineSyncLog.noteRevoke("A1", { savedToDb: true });
    const entry = JSON.parse(JSON.stringify(s.OfflineSyncLog.snapshot())).entries[0];
    assert.deepStrictEqual([entry.markedOnScreen, entry.savedToDb], [false, true]);
    assert.ok(!JSON.stringify(entry).includes("A1"));
});
