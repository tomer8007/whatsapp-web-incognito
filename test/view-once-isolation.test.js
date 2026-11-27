const test = require("node:test");
const assert = require("node:assert");
const { loadHandlers, brokenViewOnce, revoke, messageNode } = require("./helpers/handlers");

test("an unexpected view-once shape does not throw", async () => {
    const sandbox = loadHandlers();
    const allowed = await sandbox.NodeHandler.onReceivedE2EMessage(messageNode(), brokenViewOnce());
    assert.strictEqual(allowed, true);
});

test("a revoke is still blocked when another message in the node is a broken view-once", async () => {
    const sandbox = loadHandlers();
    sandbox.MultiDevice = { decryptE2EMessagesFromMessageNode: async () => [brokenViewOnce(), revoke()] };

    const [isAllowed, node] = await sandbox.NodeHandler.onReceivedMessageNode(messageNode());

    assert.strictEqual(isAllowed, false);
    assert.strictEqual(node.content.length, 1, "only the revoke's <enc> is dropped");
});
