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
    loadScripts(sandbox, ["core/options_schema.js", "core/contact_rules.js", "core/edit_tracker.js", "core/node_handler.js"]);
    sandbox.__timers.length = 0;
    return sandbox;
}

const node = (id, from = "111@c.us", extra = {}) => ({ tag: "message", attrs: { id, from, type: "text", offline: "3", ...extra } });
const text = (t) => ({ conversation: t, protocolMessage: null });
const revoke = (id) => ({ protocolMessage: { type: 0, key: { id } } });

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
