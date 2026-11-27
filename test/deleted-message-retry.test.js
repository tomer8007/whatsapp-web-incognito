const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts, drainTimers } = require("./helpers/sandbox");

function loadInterception() {
    const sandbox = loadScripts(createSandbox(), ["core/interception.js"]);
    sandbox.__timers.length = 0; // drop the logger-hook timer queued at load
    return sandbox;
}

test("each deleted message gets its own retry budget", async () => {
    const sandbox = loadInterception();
    let lookups = 0;
    sandbox.getChatByJID = async () => { lookups++; return null; };

    await sandbox.findDeletedMessageAndSaveContents({}, "111@s.whatsapp.net", "R1", "A");
    await drainTimers(sandbox);
    assert.strictEqual(lookups, 31, "first message: 1 attempt + 30 retries");

    await sandbox.findDeletedMessageAndSaveContents({}, "222@s.whatsapp.net", "R2", "B");
    assert.strictEqual(sandbox.__timers.length, 1, "second message must still schedule a retry");
});

test("stops retrying once the original message is found", async () => {
    const sandbox = loadInterception();
    const saved = [];
    sandbox.saveDeletedMessage = (msg) => saved.push(msg.id.id);
    sandbox.getChatByJID = async () => ({
        loadEarlierMsgs: async () => {},
        msgs: { getModelsArray: () => [{ id: { id: "A" } }] },
    });

    await sandbox.findDeletedMessageAndSaveContents({ protocolMessage: { key: {} } }, "111@s.whatsapp.net", "R1", "A");
    assert.deepStrictEqual(saved, ["A"]);
    assert.strictEqual(sandbox.__timers.length, 0);
});
