const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load(options, rules) {
    const sandbox = createSandbox({
        Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } },
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
    });
    loadScripts(sandbox, ["core/options_schema.js", "core/utils.js", "core/contact_rules.js", "core/edit_tracker.js", "core/node_handler.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    sandbox.WAIncognitoOptions = { ...sandbox.defaultOptions(), ...options };
    sandbox.contactRules = rules || {};
    sandbox.optionsReceivedAt = Date.now(); sandbox.contactRulesReceived = true; // settings are loaded
    return sandbox;
}

test("a contact can force saving deleted messages on, or switch it off, against the global setting", () => {
    const on = load({}, { "1@c.us": { saveDeletedMsgs: "on" } });
    on.saveDeletedMsgsHookEnabled = false;
    assert.strictEqual(on.NodeHandler.shouldBlockRevoke("1@c.us"), true);
    assert.strictEqual(on.NodeHandler.shouldBlockRevoke("2@c.us"), false);
    const off = load({}, { "1@c.us": { saveDeletedMsgs: "off" } });
    off.saveDeletedMsgsHookEnabled = true;
    assert.strictEqual(off.NodeHandler.shouldBlockRevoke("1@c.us"), false);
    assert.strictEqual(off.NodeHandler.shouldBlockRevoke("2@c.us"), true);
    assert.strictEqual(off.NodeHandler.shouldBlockRevoke("status@broadcast"), true, "statuses ignore contact rules");
});

test("edit tracking and toasts use the contact's own options", async () => {
    const s = load({ saveEdits: false, toastOnEdit: false }, { "1@c.us": { saveEdits: "on", toastOnEdit: "on" } });
    s.saved = []; s.toasts = [];
    s.saveArchiveRecord = async (record) => { s.saved.push(record); };
    s.notifyEditedMessage = (jid, preview) => { s.toasts.push(preview); };
    s.NodeHandler.editPoll = { intervalMs: 1, maxMs: 2, sleep: async () => {} };
    const edit = (id, text) => ({ protocolMessage: { type: 14, key: { id }, editedMessage: { conversation: text } } });
    // contact 1 has the rules: the message is remembered and the edit saved although the global options are off
    s.NodeHandler.trackEdits({ conversation: "a" }, "M1", "1@c.us");
    s.NodeHandler.trackEdits(edit("M1", "b"), "E1", "1@c.us");
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(s.saved.length, 1);
    assert.strictEqual(s.toasts.length, 1);
    // another contact follows the global options (off): nothing happens
    s.NodeHandler.trackEdits({ conversation: "a" }, "M2", "2@c.us");
    s.NodeHandler.trackEdits(edit("M2", "b"), "E2", "2@c.us");
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(s.saved.length, 1);
});

test("keepDisappearing and autoReceiptOnReplay follow the contact", () => {
    const s = load({ keepDisappearing: false }, { "1@c.us": { keepDisappearing: "on", autoReceiptOnReplay: "off" } });
    assert.strictEqual(s.NodeHandler.optionsFor("1@c.us").keepDisappearing, true);
    assert.strictEqual(s.NodeHandler.optionsFor("2@c.us").keepDisappearing, false);
    assert.strictEqual(s.NodeHandler.contactToggle("1@c.us", "autoReceiptOnReplay", true), false);
    assert.strictEqual(s.NodeHandler.contactToggle("2@c.us", "autoReceiptOnReplay", true), true);
});

