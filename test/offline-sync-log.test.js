const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load() {
    const sandbox = createSandbox({
        Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } },
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
    });
    sandbox.STATUS_BROADCAST_JID = "status@broadcast";
    sandbox.saveDeletedMsgsHookEnabled = false;
    sandbox.optionsReceivedAt = null;
    loadScripts(sandbox, ["core/offline_sync_log.js", "core/options_schema.js", "core/contact_rules.js", "core/edit_tracker.js", "core/node_handler.js"]);
    sandbox.__timers.length = 0;
    return sandbox;
}

const node = (id, from = "111@c.us", extra = {}) => ({ tag: "message", attrs: { id, from, type: "text", offline: "3", ...extra } });
const text = (t) => ({ conversation: t, protocolMessage: null });
const revoke = (id) => ({ protocolMessage: { type: 0, key: { id } } });
const plain = (v) => JSON.parse(JSON.stringify(v));

test("entries carry enums, booleans and counters only: no id, jid or text", () => {
    const s = load();
    s.OfflineSyncLog.setBatch(0, 2);
    s.OfflineSyncLog.record(node("SECRETID1", "628123456@c.us"), text("secret words"), false);
    s.OfflineSyncLog.record(node("G1", "120363@g.us"), { imageMessage: {} }, false);
    s.OfflineSyncLog.record(node("S1", "status@broadcast"), text("x"), false);
    const snap = plain(s.OfflineSyncLog.snapshot());
    const json = JSON.stringify(snap);
    for (const bad of ["SECRETID1", "628123456", "secret words", "120363", "@"]) assert.ok(!json.includes(bad), bad);
    assert.deepStrictEqual(snap.entries.map((e) => [e.chat, e.kind, e.offline, e.batchIndex, e.batchSize]),
        [["user", "text", true, 0, 2], ["group", "media", true, 0, 2], ["status", "text", true, 0, 2]]);
    assert.ok(snap.entries.every((e) => typeof e.seq == "number" && typeof e.t == "number"));
    for (const entry of snap.entries) for (const key of Object.keys(entry)) assert.ok(!["id", "jid", "text", "from", "name"].includes(key));
});

test("the log is capped at the last 200 entries", () => {
    const s = load();
    for (let i = 0; i < 250; i++) s.OfflineSyncLog.record(node("M" + i), text("a"), false);
    const snap = plain(s.OfflineSyncLog.snapshot());
    assert.strictEqual(snap.entries.length, 200);
    assert.strictEqual(snap.entries[0].seq, 51);
    assert.strictEqual(snap.counters.messages, 250);
});

test("a revoke whose original was seen this session is flagged, and so is a blocked one without original", () => {
    const s = load();
    s.OfflineSyncLog.record(node("A1"), text("hi"), false);
    s.OfflineSyncLog.record(node("R1"), revoke("A1"), true);
    s.OfflineSyncLog.record(node("R2"), revoke("NEVERSEEN"), true);
    s.OfflineSyncLog.record(node("R3"), revoke("A1"), false);
    const snap = plain(s.OfflineSyncLog.snapshot());
    const [, r1, r2, r3] = snap.entries;
    assert.deepStrictEqual([r1.kind, r1.originalSeenThisSession, r1.blocked], ["revoke", true, true]);
    assert.deepStrictEqual([r2.originalSeenThisSession, r2.blocked], [false, true]);
    assert.strictEqual(r3.blocked, false);
    assert.strictEqual(snap.counters.revokes, 3);
    assert.strictEqual(snap.counters.revokesWithOriginalSeen, 2);
});

test("a failing recorder never changes the allow/block result of onReceivedE2EMessage", async () => {
    const s = load();
    s.optionsReceivedAt = Date.now(); s.contactRulesReceived = true;
    s.NodeHandler.shouldBlockRevoke = () => true;
    s.onDeletionMessageBlocked = () => {};
    const healthy = await s.NodeHandler.onReceivedE2EMessage(node("R9"), revoke("A1"));
    s.OfflineSyncLog.record = () => { throw new Error("recorder broke"); };
    const broken = await s.NodeHandler.onReceivedE2EMessage(node("R9"), revoke("A1"));
    const brokenText = await s.NodeHandler.onReceivedE2EMessage(node("T9"), text("hello"));
    assert.strictEqual(healthy, false);
    assert.strictEqual(broken, false);
    assert.strictEqual(brokenText, true);
    // and malformed input is swallowed inside the recorder itself
    const fresh = load();
    assert.doesNotThrow(() => fresh.OfflineSyncLog.record(null, null, false));
});

test("the diagnostic is registered and the hooks are wired", () => {
    const fs = require("node:fs"), path = require("node:path");
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(/Diagnostics\.register\("sync", "hook", "offline-sync"/.test(read("core/offline_sync_log.js")));
    assert.ok(read("core_injection.js").includes("core/offline_sync_log.js"));
    assert.ok(/OfflineSyncLog\.setBatch\(i, decryptedFrames\.length\)/.test(read("core/interception.js")));
});

test("entries record the settings state as booleans and numbers: hookOn, shouldBlock, optionsSeen, msSinceOptions", () => {
    const s = load();
    s.OfflineSyncLog.record(node("A"), revoke("X"), false, false);
    s.optionsReceivedAt = Date.now() - 50; s.saveDeletedMsgsHookEnabled = true;
    s.OfflineSyncLog.record(node("B"), revoke("X"), true, true);
    const [before, after] = plain(s.OfflineSyncLog.snapshot()).entries;
    assert.deepStrictEqual([before.hookOn, before.shouldBlock, before.optionsSeen, before.msSinceOptions], [false, false, false, null]);
    assert.deepStrictEqual([after.hookOn, after.shouldBlock, after.optionsSeen], [true, true, true]);
    assert.ok(after.msSinceOptions >= 40);
});

function e2eSandbox() {
    const s = load();
    s.deletedCalls = [];
    s.onDeletionMessageBlocked = (...args) => s.deletedCalls.push(args);
    return s;
}

test("before the first options update a revoke is blocked and its original is saved (onDeletionMessageBlocked runs)", async () => {
    const s = e2eSandbox();
    assert.strictEqual(await s.NodeHandler.onReceivedE2EMessage(node("R1"), revoke("A1")), false);
    assert.strictEqual(s.deletedCalls.length, 1);
    assert.strictEqual(await s.NodeHandler.onReceivedE2EMessage(node("T1"), text("hello")), true, "text messages are untouched");
});

test("options without the deleted-messages setting keep the window open: only a full options object counts", () => {
    const code = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "core", "injected_ui.js"), "utf8");
    assert.ok(/'saveDeletedMsgs' in options && optionsReceivedAt == null\) optionsReceivedAt = Date\.now\(\)/.test(code));
});

test("after options with saveDeletedMsgs off a revoke is allowed; with it on it is blocked", async () => {
    const off = e2eSandbox();
    off.optionsReceivedAt = Date.now(); off.contactRulesReceived = true; off.saveDeletedMsgsHookEnabled = false;
    assert.strictEqual(await off.NodeHandler.onReceivedE2EMessage(node("R1"), revoke("A1")), true);
    assert.strictEqual(off.deletedCalls.length, 0);
    const on = e2eSandbox();
    on.optionsReceivedAt = Date.now(); on.contactRulesReceived = true; on.saveDeletedMsgsHookEnabled = true;
    assert.strictEqual(await on.NodeHandler.onReceivedE2EMessage(node("R1"), revoke("A1")), false);
    assert.strictEqual(on.deletedCalls.length, 1);
});

test("the contact rules window: options received but rules not yet pushed still blocks; the rules event opens it", async () => {
    const s = e2eSandbox();
    s.optionsReceivedAt = Date.now(); s.saveDeletedMsgsHookEnabled = false;
    assert.strictEqual(s.NodeHandler.shouldBlockRevoke("1@c.us"), true);
    s.contactRulesReceived = true;
    assert.strictEqual(s.NodeHandler.shouldBlockRevoke("1@c.us"), false);
});
